/**
 * Habilidades Ativas: âncoras ao desligar, dreno por rodada, Mana em 0 e o que some no próximo turno.
 * (Separado de skill-effects.js na reorganização de pastas — mesma lógica de antes.)
 */
import { SYSTEM_ID, getEnergyLabelForActor, isEnergyPoolEnabled, effectiveSkillCost, combatantIsActor, isMagicUse, isTechUse, isInterferenceEnabled, getHealingRules, actorManipulation } from "../core/config.js";
import { fieldUseOutcome } from "../core/magic-rules.js";
import { creditManipulation } from "../combat/antimagic.js";
import { runAsGm, owns } from "../helpers/gm-relay.js";
import { RELAY_REASONS, refuse } from "../helpers/gm-relay-rules.js";
import { makeAnchor, removeAnchor, effectAnchors, finiteRemaining, anchorLifetime, PERMANENT, ANCHORED_TARGETS_FLAG, ANCHORED_TARGETS_CAP, anchoredTargetsFor, forgetAnchoredTargets } from "../combat/effect-anchors.js";
import { worldActors, actorsFromUuids } from "../helpers/world-actors.js";
import { escapeHtml } from "../helpers/html.js";
import { removeZonesFor } from "../combat/area-effects.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";
import { removeStructuresFor, antimagicLevelAt, regenerateSustainedStructures } from "../structures/structures.js";
import { manaDensityFor } from "../environment/environment.js";
import { densitySustainsMagic } from "../environment/environment-rules.js";
import { isShipLike } from "../starship/ship-damage.js";
import { skillStateUpdate, energyValuePath, currentEnergyValue } from "./skill-state.js";
import { regenerateSustainedShields, dropSustainedShields } from "./sustained-shields.js";

/** "Agora" para o prazo finito dos efeitos ancorados (ver finiteRemaining em effect-anchors.js). */
export function combatNow() {
  const combat = game.combat;
  return combat?.started ? { round: combat.round ?? 0, combatId: combat.id } : {};
}

/**
 * Tira a âncora `anchor` de um efeito. Sem âncora sobrando, o efeito periódico continua se ainda
 * tiver ticks finitos; o comum volta a ter a duração do Foundry com o prazo finito que restava,
 * fica sem prazo se era permanente, ou é apagado.
 * @returns {Promise<boolean>} esta Skill segurava o efeito
 */
async function releaseAnchorOnEffect(effect, anchor) {
  const flags = effect.flags?.[SYSTEM_ID];
  if (!flags) return false;
  const { anchors, removed } = removeAnchor(effectAnchors(flags, effect.origin), anchor);
  if (!removed) return false;

  if (flags.periodic) {
    if (!anchors.length && (flags.ticksRemaining ?? 0) <= 0) await effect.delete();
    else await effect.update({ [`flags.${SYSTEM_ID}.activeAnchors`]: anchors });
    return true;
  }

  if (anchors.length) {
    await effect.update({ [`flags.${SYSTEM_ID}.activeAnchors`]: anchors });
    return true;
  }
  const finite = finiteRemaining(flags.finite, combatNow());
  if (!anchorLifetime({ anchors, finite }).alive) {
    await effect.delete();
    return true;
  }
  const combat = game.combat;
  const duration = finite === PERMANENT ? { rounds: null } : { rounds: finite, ...(combat ? { startRound: combat.round ?? 0, startTurn: combat.turn ?? 0 } : {}) };
  await effect.update({
    duration,
    [`flags.${SYSTEM_ID}.activeAnchors`]: [],
    [`flags.${SYSTEM_ID}.tiedToActive`]: false,
    [`flags.${SYSTEM_ID}.finite`]: null
  });
  return true;
}

/**
 * Tira a âncora `anchor` de todos os efeitos dos Atores dados. `canWrite(actor)` decide quem este
 * cliente pode alterar; os outros são devolvidos para o Mestre resolver (ver releaseSkillAnchorsAsGm).
 * @returns {Promise<Actor[]>} Atores com efeito desta Skill que este cliente não pôde escrever
 */
async function releaseAnchorOnActors(actors, anchor, canWrite) {
  const pending = [];
  for (const actor of actors) {
    for (const effect of [...actor.effects]) {
      const flags = effect.flags?.[SYSTEM_ID];
      if (!flags?.skillEffect) continue;
      if (!canWrite(actor)) {
        if (removeAnchor(effectAnchors(flags, effect.origin), anchor).removed && !pending.includes(actor)) pending.push(actor);
        continue;
      }
      await releaseAnchorOnEffect(effect, anchor);
    }
  }
  return pending;
}

/**
 * Onde procurar os efeitos desta âncora: os alvos que o Ator que segura a Skill registrou ao
 * aplicar (`anchoredTargets`, ver effect-anchors.js), ou o mundo inteiro quando não há registro
 * (Skill ligada antes da 1.78) — o caminho antigo, caro mas completo.
 * @returns {{actors: Actor[], listed: boolean}}
 */
function anchorSearchScope(holder, anchor) {
  const listed = anchoredTargetsFor(holder?.getFlag?.(SYSTEM_ID, ANCHORED_TARGETS_FLAG), anchor);
  if (!listed) return { actors: worldActors(), listed: false };
  return { actors: actorsFromUuids(listed), listed: true };
}

/** Apaga o registro de alvos desta âncora no Ator que segura a Skill (ela foi desligada). */
async function clearAnchoredTargets(holder, anchor) {
  if (!holder?.isOwner) return;
  const { records, changed } = forgetAnchoredTargets(holder.getFlag(SYSTEM_ID, ANCHORED_TARGETS_FLAG), anchor);
  if (!changed) return;
  // Lista inteira gravada de novo (não `-=`): ela é um array, e setFlag de um array substitui.
  await holder.setFlag(SYSTEM_ID, ANCHORED_TARGETS_FLAG, records);
}

/**
 * Lado do Mestre (relay `releaseSkillAnchors`): tira as âncoras de uma Skill dos Atores que quem
 * pediu não pode escrever. O payload não é confiável: a Skill tem que estar DESLIGADA (ou não
 * existir mais — então não há nada a proteger), senão um cliente apagaria efeitos de uma Skill ligada.
 *
 * `targetUuids` (opcional) são os Atores que quem pediu não pôde escrever; sem eles (pedido de
 * uma versão anterior, ou Skill sem registro de alvos), varre o mundo. Uma lista forjada só pode
 * fazer o Mestre soltar MENOS — a âncora solta é sempre a de uma Skill desligada.
 */
export async function releaseSkillAnchorsAsGm({ skillUuid, skillId, subSkillIndex, requesterId, targetUuids }) {
  if (typeof skillUuid !== "string") return;
  const index = Number.isInteger(subSkillIndex) ? subSkillIndex : null;
  const skill = await fromUuid(skillUuid);
  if (skill) {
    if (skill.type !== "skill") return;
    const mech = index == null ? skill.system : skill.system.subSkills?.[index];
    if (mech?.active) return;
  }
  const requester = game.users.get(requesterId);
  const anchor = makeAnchor({ skillUuid, skillId: typeof skillId === "string" ? skillId : null, subSkillIndex: index });
  const listed = Array.isArray(targetUuids) && targetUuids.length <= ANCHORED_TARGETS_CAP && targetUuids.every(u => typeof u === "string");
  const actors = listed ? actorsFromUuids(targetUuids) : worldActors();
  await releaseAnchorOnActors(actors, anchor, actor => !requester || !actor.testUserPermission(requester, "OWNER"));
}

/**
 * Desliga a "âncora" desta Skill/Sub-Skill "Ativa" em todos os Atores que ela atingiu — chamado
 * ao desativar (clique manual ou falta de Energia, ver `useSkillEffect`/`tickActorUpkeepSkills`).
 * Não basta olhar quem usou a Skill: um Efeito de Emissão em área pode ter afetado vários Atores,
 * e o efeito vive em cada um deles, não no espaço (continua mesmo se saírem da área no canvas).
 * Quem foi atingido está no registro `anchoredTargets` de quem segura a Skill (gravado em
 * applyEffectsToActor); sem registro (Skill ligada antes da 1.78), varre o mundo como antes.
 *
 * Buff/debuff comum e periódico seguem o mesmo modelo (effect-anchors.js): esta Skill só sai da
 * lista de âncoras; o efeito continua se outra Skill Ativa ainda o segura ou se ainda há prazo
 * finito de uma aplicação comum. Quem desliga escreve nos Atores que possui; o resto vai pro Mestre.
 * @param {Item} skill
 * @param {number|null} subSkillIndex
 */
export async function removeUpkeepLinkedEffects(skill, subSkillIndex) {
  // Zona e Estrutura mantidas por esta Skill Ativa somem junto com ela.
  if (skill.parent) await removeZonesFor(skill.parent, skill.id, subSkillIndex);
  if (skill.parent) await removeStructuresFor(skill.parent, skill.id, subSkillIndex);
  // Escudo mantido por esta Skill: as camadas somem (até o teto) de quem as recebeu.
  if (skill.parent) await dropSustainedShields(skill.parent, skill.id, subSkillIndex);
  // Luz de Escudo que esta Skill acendeu é APAGADA (o Token volta à luz de antes), não desligada.
  if (skill.parent) await runAsGm("clearShieldLights", { actorUuid: skill.parent.uuid, skillId: skill.id, subSkillIndex: subSkillIndex ?? null });

  const anchor = makeAnchor({ skillUuid: skill.uuid, skillId: skill.id, subSkillIndex });
  const { actors, listed } = anchorSearchScope(skill.parent, anchor);
  const pending = await releaseAnchorOnActors(actors, anchor, actor => game.user.isGM || actor.isOwner);
  await clearAnchoredTargets(skill.parent, anchor);
  if (pending.length) {
    await runAsGm("releaseSkillAnchors", {
      skillUuid: skill.uuid,
      skillId: skill.id,
      subSkillIndex: anchor.sourceSubSkillIndex,
      requesterId: game.user.id,
      // Com registro, o Mestre resolve só quem este cliente não pôde escrever; sem, varre o mundo.
      ...(listed ? { targetUuids: pending.map(a => a.uuid) } : {})
    });
  }
}

/** Onde fica a lista de efeitos que vão sumir no início do próximo turno (Mana em 0 em combate). */
const PENDING_UPKEEP_FLAG = "pendingUpkeepRemoval";

/** O Ator está num combate iniciado? */
function actorInStartedCombat(actor) {
  return (game.combats ?? []).some(combat => combat.started && combat.combatants.some(c => combatantIsActor(c, actor)));
}

/**
 * Mana em 0 desliga TODAS as Habilidades Ativas do Personagem — regra geral, seja qual for o
 * motivo (custo por rodada, dano na Mana, barreira de mana, edição à mão). As Skills desligam na
 * hora (param de custar); os efeitos que elas mantinham somem no **início do próximo turno** de
 * quem as usava, se estiver em combate, ou na hora, fora de combate. Vale também pros efeitos
 * que a Skill aplicou em OUTROS Atores — inclusive uma Nave melhorada por um tripulante: ela
 * volta ao normal no mesmo tempo. Só o Mestre executa (chamado do hook `updateActor`).
 * @returns {Promise<string[]>} rótulos das Skills desligadas
 */
export async function shutdownActiveSkillsOnDepletion(actor) {
  return shutdownActiveSkills(actor);
}

/**
 * Desliga TODAS as Habilidades Ativas do personagem de uma vez (Mana em 0, ou Caído/Inconsciente —
 * ver incapacitation.js). Mesma regra de sempre para o que elas seguravam: em combate, some no
 * início do próximo turno; fora, na hora. `reason` vira o texto do aviso.
 */
export async function shutdownActiveSkills(actor, { reason = null } = {}) {
  if (actor?.type !== "character") return [];
  const sources = collectActiveUpkeepSources(actor);
  if (!sources.length) return [];

  const updates = new Map();
  for (const { skill, subSkillIndex } of sources) {
    const update = updates.get(skill.id) ?? { _id: skill.id };
    if (subSkillIndex == null) {
      update["system.active"] = false;
    } else {
      update["system.subSkills"] ??= skillStateUpdate(skill, subSkillIndex, { active: false })["system.subSkills"];
      update["system.subSkills"][subSkillIndex].active = false;
    }
    updates.set(skill.id, update);
  }
  await actor.updateEmbeddedDocuments("Item", [...updates.values()]);

  if (actorInStartedCombat(actor)) {
    const pending = foundry.utils.deepClone(actor.getFlag(SYSTEM_ID, PENDING_UPKEEP_FLAG) ?? []);
    for (const source of sources) pending.push({ skillId: source.skill.id, subSkillIndex: source.subSkillIndex });
    await actor.setFlag(SYSTEM_ID, PENDING_UPKEEP_FLAG, pending);
  } else {
    for (const source of sources) await removeUpkeepLinkedEffects(source.skill, source.subSkillIndex);
  }

  const labels = sources.map(s => s.label);
  const energyLabel = getEnergyLabelForActor(actor);
  const owners = game.users.filter(u => u.isGM || actor.testUserPermission(u, "OWNER")).map(u => u.id);
  await ChatMessage.create({
    whisper: owners,
    speaker: ChatMessage.getSpeaker({ actor }),
    content:
      `<p><strong>${escapeHtml(actor.name)}</strong> ${escapeHtml(reason ?? `ficou sem ${energyLabel}`)}: ${labels.map(escapeHtml).join(", ")} desligada(s).` +
      `${actorInStartedCombat(actor) ? " Os efeitos somem no início do próximo turno." : ""}</p>`
  });
  return labels;
}

/** Início do turno: remove os efeitos das Skills que a Mana em 0 desligou no turno anterior. */
export async function processPendingUpkeepRemoval(actor) {
  const pending = actor?.getFlag(SYSTEM_ID, PENDING_UPKEEP_FLAG);
  if (!pending?.length) return;
  await actor.unsetFlag(SYSTEM_ID, PENDING_UPKEEP_FLAG);
  for (const { skillId, subSkillIndex } of pending) {
    const skill = actor.items.get(skillId);
    // Religada nesse meio-tempo: os efeitos são dela de novo, não remove.
    const active = subSkillIndex != null ? skill?.system.subSkills?.[subSkillIndex]?.active : skill?.system.active;
    if (skill && !active) await removeUpkeepLinkedEffects(skill, subSkillIndex ?? null);
  }
}

/** Toda Skill "Ativa" ligada no momento — top-level e cada Sub-Skill (fusões podem ter mais de uma ligada ao mesmo tempo). */
export function collectActiveUpkeepSources(actor) {
  const sources = [];
  for (const skill of actor.items) {
    if (skill.type !== "skill") continue;
    if (skill.system.hasUpkeep && skill.system.active) {
      sources.push({
        skill,
        subSkillIndex: null,
        label: skill.name,
        // Mana variável: o Custo por rodada é cobrado vezes a razão investida ao ligar.
        // Ligada pela Marca (H4): o fator da distância, fixado ao ligar, multiplica a manutenção.
        upkeepCost: Math.ceil(effectiveSkillCost(skill.system.upkeepCost, skill.system.level) * (skill.system.variableMana ? skill.system.investRatio ?? 1 : 1) * (skill.system.markFactor ?? 1))
      });
    }
    (skill.system.subSkills ?? []).forEach((sub, i) => {
      if (sub.hasUpkeep && sub.active) {
        sources.push({
          skill,
          subSkillIndex: i,
          label: `${skill.name} — ${sub.name}`,
          upkeepCost: Math.ceil(effectiveSkillCost(sub.upkeepCost, sub.level) * (sub.variableMana ? sub.investRatio ?? 1 : 1) * (sub.markFactor ?? 1))
        });
      }
    });
  }
  return sources;
}

/** Desliga uma Skill/Sub-Skill Ativa e solta tudo que ela estava segurando (buffs, Veneno ancorado...). */
async function deactivateUpkeepSource(source) {
  await source.skill.update(skillStateUpdate(source.skill, source.subSkillIndex, { active: false }));
  await removeUpkeepLinkedEffects(source.skill, source.subSkillIndex);
}

/**
 * Personagem/Criatura: o Custo por Rodada sai da Mana/Energia de verdade, uma fonte por vez
 * (não tudo de uma vez) porque várias Skills Ativas competem pelo MESMO pool — a ordem importa
 * quando não sobra pra todas. A Energia nunca fica negativa: se não cobrir o Custo por Rodada
 * inteiro, drena só o que tem (até 0) e desativa a Skill sozinha.
 */
async function drainCharacterUpkeep(actor, sources, steps = 1) {
  // Acelerado (8e.2): `steps` turnos de custo, simulados em memória (as Ativas disputam o mesmo pool, na ordem
  // da ficha, volta a volta) e gravados uma vez; quem não é coberto desliga ali e para de pagar.
  let energy = currentEnergyValue(actor);
  const start = energy;
  const drained = new Map(sources.map(source => [source, 0]));
  const dropped = new Set();
  for (let turn = 0; turn < Math.max(1, steps); turn++) {
    let paying = 0;
    for (const source of sources) {
      if (dropped.has(source)) continue;
      if (energy <= 0) {
        dropped.add(source);
        continue;
      }
      paying++;
      const drain = Math.min(source.upkeepCost, energy);
      energy -= drain;
      drained.set(source, drained.get(source) + drain);
      if (drain < source.upkeepCost) dropped.add(source);
    }
    if (!paying) break;
  }
  if (energy !== start) await actor.update({ [energyValuePath(actor)]: energy });
  const results = [];
  for (const source of sources) {
    if (dropped.has(source)) await deactivateUpkeepSource(source);
    results.push({ label: source.label, drained: drained.get(source), deactivated: dropped.has(source) });
  }
  return results;
}

/**
 * Nave/Veículo: o Custo por Rodada NÃO é drenado de lugar nenhum — ele já sai da geração do
 * Reator continuamente, de forma derivada (`ShipSystemsDataModel.activeUpkeepDrain`, que
 * `prepareDerivedData` subtrai de `powerGrid.reactorOutput`). O que este tick faz é só aplicar
 * o TETO: se a soma das Skills ligadas passar da geração bruta do Reator
 * (`powerGrid.reactorBaseOutput`), a Nave não consegue sustentar todas — as que não couberem
 * são desligadas, na ordem em que aparecem na ficha. Sem esse teto, `reactorOutput` ficaria
 * preso em 0 e a Nave inteira entraria em fome de energia permanente.
 */
async function enforceShipUpkeepCapacity(actor, sources) {
  const capacity = actor.system.powerGrid.reactorBaseOutput ?? 0;
  const results = [];
  let reserved = 0;

  for (const source of sources) {
    if (reserved + source.upkeepCost <= capacity) {
      reserved += source.upkeepCost;
      results.push({ label: source.label, drained: source.upkeepCost, deactivated: false });
      continue;
    }
    await deactivateUpkeepSource(source);
    results.push({ label: source.label, drained: 0, deactivated: true });
  }
  return results;
}

/**
 * Processa o Custo por Rodada de toda Skill "Ativa" (hasUpkeep + active) do Ator — chamada do
 * mesmo hook `updateCombat` (nihility-rpg-system.js) que já tica Veneno/cura contínua (ver
 * `tickCombatRoundEffects` acima), sempre que chega a vez desse Ator. O mecanismo difere por
 * tipo de Ator (ver as duas funções acima): Personagem drena o pool de verdade, Nave/Veículo só
 * confere se o Reator sustenta o que está ligado. Nos dois casos, o que não se sustenta é
 * desativado sozinho e avisado ao dono do Ator + Mestre pela Voz do Mundo (nunca público — é
 * meta-informação de recurso, não algo pra narrar na mesa).
 * @param {Actor} actor
 */
export async function tickActorUpkeepSkills(actor, { steps = 1, notes = null } = {}) {
  // Desacelerado: num turno em que o tempo dele não anda, a manutenção não é cobrada.
  if (steps <= 0) return [];
  let sources = collectActiveUpkeepSources(actor);
  if (!sources.length) return [];

  const shipLike = isShipLike(actor);
  // Mana interna: onde não há mana (densidade 0) nenhuma Habilidade Ativa mágica se sustenta. Desliga
  // antes de cobrar, pelo mesmo caminho da manutenção que falha (solta os efeitos e as Estruturas).
  if (!shipLike) {
    const density = manaDensityFor(actor);
    if (!densitySustainsMagic(density)) {
      const dropped = sources.filter(source => isMagicUse(source.subSkillIndex != null ? source.skill.system.subSkills?.[source.subSkillIndex] : source.skill.system, actor));
      if (dropped.length) {
        for (const source of dropped) await deactivateUpkeepSource(source);
        sources = sources.filter(source => !dropped.includes(source));
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<p><strong>${escapeHtml(actor.name)}</strong> está onde não há mana: ${dropped.map(s => escapeHtml(s.label)).join(", ")} desligada(s).</p>`
        });
        if (!sources.length) return [];
      }
    }
  }
  // Sem pool de Mana/Energia não há o que drenar nem o que desativar por falta de recurso: a
  // Habilidade Ativa vira um liga/desliga puramente narrativo (ver `energyPoolEnabled`). O Escudo
  // mantido regenera do mesmo jeito.
  if (!shipLike && !isEnergyPoolEnabled()) {
    await regenerateSustainedShields(actor);
    await regenerateSustainedStructures(actor);
    return [];
  }
  // Campo de Antimagia/Interferência (ou Selo): a Skill Ativa da natureza do campo paga o extra da
  // Manipulação por rodada (curva do bloqueio de cura, sobre o custo por rodada) ou desliga. Sem
  // Manipulação — e a tecnologia nunca tem — o campo vence: desliga.
  if (!shipLike) {
    const dropped = [];
    for (const kind of isInterferenceEnabled() ? ["magic", "tech"] : ["magic"]) {
      const level = antimagicLevelAt(actor, kind);
      if (level <= 0) continue;
      const manipulation = kind === "magic" ? actorManipulation(actor) : { skill: null, level: 0 };
      for (const source of [...sources]) {
        const mech = source.subSkillIndex != null ? source.skill.system.subSkills?.[source.subSkillIndex] : source.skill.system;
        if (!(kind === "magic" ? isMagicUse(mech, actor) : isTechUse(mech, actor))) continue;
        const outcome = fieldUseOutcome({ inside: true, kind, manipulationLevel: manipulation.level, fieldLevel: level, baseCost: source.upkeepCost, zeroMultiplier: getHealingRules().zeroMultiplier });
        if (outcome.action === "blocked") {
          await deactivateUpkeepSource(source);
          sources = sources.filter(x => x !== source);
          dropped.push(source);
          continue;
        }
        if (outcome.resisted) await creditManipulation(manipulation.skill);
        if (outcome.extra > 0) {
          source.antimagic = (source.antimagic ?? 0) + outcome.extra;
          source.upkeepCost += outcome.extra;
          source.label += ` (${kind === "magic" ? "antimagia" : "interferência"} +${outcome.extra})`;
        }
      }
    }
    if (dropped.length) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p><strong>${escapeHtml(actor.name)}</strong> está num campo que vence a Manipulação: ${dropped.map(s => escapeHtml(s.label)).join(", ")} desligada(s).</p>`
      });
      if (!sources.length) return [];
    }
  }
  const results = shipLike ? await enforceShipUpkeepCapacity(actor, sources) : await drainCharacterUpkeep(actor, sources, steps);
  // Depois do dreno: Skill que caiu por falta de Mana já tirou os Escudos dela, e não regenera.
  await regenerateSustainedShields(actor);
  await regenerateSustainedStructures(actor);

  const energyLabel = escapeHtml(getEnergyLabelForActor(actor));
  // Nave não "perde" a energia do upkeep — ela fica reservada enquanto a Skill estiver ligada
  // (e volta sozinha ao desligar), então o verbo no chat é outro.
  const rows = results.map(r => {
    const amount = shipLike ? `${r.drained} ${energyLabel} reservado(s) do Reator` : `-${r.drained} ${energyLabel}${steps > 1 ? ` em ${steps} turnos` : ""}`;
    if (notes && !shipLike && r.drained) notes.push({ label: r.label, text: `−${r.drained} ${getEnergyLabelForActor(actor)}${r.deactivated ? " · desligou" : ""}` });
    const reason = shipLike ? "Reator não sustenta" : `${energyLabel} insuficiente`;
    return `<li><strong>${escapeHtml(r.label)}</strong>: ${amount}${r.deactivated ? ` (desativada — ${reason})` : ""}</li>`;
  });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${escapeHtml(actor.name)}</strong> — início de turno, Habilidades Ativas:</p><ul>${rows.join("")}</ul>`
  });

  for (const r of results.filter(r => r.deactivated)) {
    await announceVoiceOfTheWorld(actor, {
      kind: "skill-deactivated",
      title: "Habilidade Desativada",
      body: shipLike
        ? `${r.label} foi desativada automaticamente — o Reator de ${actor.name} não tem geração suficiente pra sustentá-la.`
        // Texto puro (o template da Voz do Mundo já escapa com {{body}}): o rótulo sem escape.
        : `${r.label} foi desativada automaticamente — ${actor.name} ficou sem ${getEnergyLabelForActor(actor)} suficiente pra mantê-la.`
    });
  }

  return results;
}


// ---------------------------------------------------------------------------
// Ações do relay do Mestre (ver helpers/gm-relay.js). Juntadas em core/relay-actions.js.
// Todas recebem `(payload, user)`; `user` é dito pelo servidor, nunca pelo payload.
// ---------------------------------------------------------------------------
export const RELAY_HANDLERS = {
  /**
   * Desligar uma Skill Ativa: tira a âncora dela dos efeitos em Atores que quem desligou não
   * possui. Quem pede tem de ser dono da Skill — ou, se ela já foi apagada, do Ator que a tinha.
   */
  async releaseSkillAnchors(payload, user) {
    const skillUuid = payload?.skillUuid;
    if (typeof skillUuid !== "string") return refuse(RELAY_REASONS.invalid);
    const skill = await fromUuid(skillUuid);
    const holder = skill ?? (await fromUuid(skillUuid.split(".Item.")[0]));
    if (!holder) return refuse(RELAY_REASONS.invalid);
    if (!owns(user, holder)) return refuse(RELAY_REASONS.permission);
    // `requesterId` é sempre quem pediu de verdade, nunca o que veio no payload.
    await releaseSkillAnchorsAsGm({ ...payload, requesterId: user.id });
  }
};
