/**
 * "Usar Habilidade": aplica a mecânica de uma Skill (system.effectType).
 *  - "damage": rola `damageFormula` (fórmula livre do Foundry) e posta no chat
 *    PÚBLICO (diferente da Voz do Mundo, que é só pra progressão/meta).
 *  - "temporary": aplica cada entrada de `effects` — atributos/HP/Mana viram
 *    Active Effects de verdade com duração (expiram sozinhos, nunca alteram o
 *    HP/Mana Máximo mesmo quando o alvo é um atributo); "shield" é somado
 *    direto, sem duração, gasto na mão pelo jogador conforme absorve dano.
 */
import { getActiveStatusConditions, getEnergyLabelForActor, isEnergyPoolEnabled, effectiveSkillCost, isStructureMechanic, manaInvestmentPower, getManaInvestConfig, isMagicUse } from "../core/config.js";
import { manaDensityFor } from "../environment/environment.js";
import { castPowerFromDensity, densitySustainsMagic } from "../environment/environment-rules.js";
import { chargeAntimagic, placementTargets, fieldEndsEffectAt } from "../combat/antimagic.js";
import { suppressionLevel } from "../core/suppression.js";
import { skillIsMagic } from "../core/magic-rules.js";
import { createZone } from "../combat/area-effects.js";
import { grantSkillUseXp, vitalBase } from "./skill-xp.js";
import { blockIfIncapacitated } from "../combat/incapacitation.js";
import { playSkillAnimation } from "../core/vfx.js";
import { requestStructure, dispelStructuresInArea, structureEndedAtOnce } from "../structures/structures.js";
import { promptManaInvestment } from "../apps/mana-invest-dialog.js";
import { rollSkillDamage, rollSkillDamageArea } from "../combat/damage-roll.js";
import { applyEffectsToActor } from "./effects-apply.js";
import { isShipLike } from "../starship/ship-damage.js";
import { skillStateUpdate, energyValuePath, currentEnergyValue, warnInsufficientEnergy } from "./skill-state.js";
import { removeUpkeepLinkedEffects } from "./upkeep.js";
import { recordSkillUse } from "./skill-undo.js";
import { escapeHtml } from "../helpers/html.js";
import { runAsGm } from "../helpers/gm-relay.js";
import { RELAY_REASONS, refuse, relayFailureMessage } from "../helpers/gm-relay-rules.js";
import { applyEffectChoices, normalizeEffectRequest, splitByWriteAccess } from "./effect-relay-rules.js";

/**
 * Ponto de entrada único de "Usar Habilidade".
 *  - `targetType: "targeted"` (padrão): usa `options.targetActor` (1 Ator, escolhido via
 *    dropdown em actor-sheet.js) — comportamento de sempre.
 *  - `targetType: "emission"`: usa `options.targetActors` (lista já resolvida pela forma
 *    posicionada no canvas via module/area-effects.js) — sem alvo único envolvido.
 *  - `options.subSkillIndex`: quando a Skill tem Sub-Skills (só existe em Skills Fundidas —
 *    ver skill-economy.js#fuseSkills), a mecânica usada é a daquele componente específico
 *    (`system.subSkills[i]`, que carrega seu próprio effectType/damageFormula/effects/
 *    targetType/etc.) em vez da mecânica própria da Skill — igual as Skills Únicas do
 *    Tensura, que têm várias sub-habilidades nomeadas dentro de uma só Skill "guarda-chuva".
 *    `skills/skill-use-flow.js` já resolve qual índice antes de chamar isto (ver `promptSubSkillChoice`).
 *
 * Custo de Energia (`mech.cost`) é cobrado UMA VEZ aqui, sempre — inclusive em Skills
 * "Descritiva" (effectType "none"), que agora também são "usáveis" (postam um anúncio simples
 * no chat em vez de só um toast). Skills "Ativas" (`mech.hasUpkeep`) alternam ligado/desligado a
 * cada clique: ligar cobra `cost` e passa a drenar `upkeepCost` por rodada (ver
 * `tickActorUpkeepSkills`, chamada do hook `updateCombat`); desligar (clique com `mech.active`
 * já true) nunca cobra de novo nem re-executa a mecânica — só para o dreno.
 * @param {Actor} sourceActor - dono da skill
 * @param {string} skillId
 * @param {{targetActor?: Actor, targetActors?: Actor[], subSkillIndex?: number}} [options]
 */
export async function useSkillEffect(sourceActor, skillId, options = {}) {
  // Desfazer uso (skill-undo.js): fotografa antes/depois e guarda o registro no card.
  return recordSkillUse(sourceActor, skillId, options, () => runSkillEffect(sourceActor, skillId, options));
}

async function runSkillEffect(sourceActor, skillId, options = {}) {
  const skill = sourceActor.items.get(skillId);
  if (!skill) return null;

  let mech = skill.system;
  let label = skill.name;
  if (options.subSkillIndex != null) {
    const sub = (skill.system.subSkills ?? [])[options.subSkillIndex];
    if (sub) {
      mech = sub;
      label = `${skill.name} — ${sub.name}`;
    }
  }

  if (mech.hasUpkeep && mech.active) {
    await skill.update(skillStateUpdate(skill, options.subSkillIndex, { active: false }));
    await removeUpkeepLinkedEffects(skill, options.subSkillIndex ?? null);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
      content: `<p><strong>${escapeHtml(sourceActor.name)}</strong> desativou <strong>${escapeHtml(label)}</strong>.</p>`
    });
    return true;
  }

  // Caído/Inconsciente (incapacitation.js): não usa Habilidade nenhuma.
  if (blockIfIncapacitated(sourceActor, "usar Habilidades")) return null;

  // Suprimido (Antimagia): Skill mágica de nível ≤ a supressão não se usa — nem liga, se for Ativa.
  const suppression = sourceActor.type === "character" ? suppressionLevel(sourceActor) : null;
  if (suppression !== null && skillIsMagic({ ...mech, tier: skill.system.tier }) && (Number(mech.level) || 0) <= suppression) {
    ui.notifications?.warn(`${sourceActor.name} está Suprimido (Antimagia nv ${suppression}): ${label} não funciona.`);
    return null;
  }

  // Densidade de mana do lugar (environment.js). Mana interna: quem lança usa a própria Mana, então
  // mana rarefeita não impede nem enfraquece o lançamento (só a Antimagia bloqueia); mana densa
  // reforça a Skill, junto com o investimento. O que não se sustenta em densidade 0 é a Habilidade
  // Ativa mágica: não liga aqui (e desliga no início do turno de quem está lá — upkeep.js).
  const rawDensity = isMagicUse(mech, sourceActor) ? manaDensityFor(sourceActor) : 1;
  if (mech.hasUpkeep && !densitySustainsMagic(rawDensity)) {
    ui.notifications?.warn(`Não há mana neste lugar para sustentar ${label}.`);
    return null;
  }
  const manaDensity = castPowerFromDensity(rawDensity);

  // Estrutura mágica que um campo antimagia desfaria na hora: recusa ANTES de gastar Mana ou pagar o extra.
  if (isStructureMechanic(mech) && options.structurePlacement && isMagicUse(mech, sourceActor)) {
    const doomed = structureEndedAtOnce(mech, options.structurePlacement);
    if (doomed) {
      ui.notifications?.warn(`O Campo de Antimagia desfaria ${doomed.label} na hora.`);
      return null;
    }
  }

  // Numa campanha sem pool de Mana/Energia (setting `energyPoolEnabled`), Personagem/Criatura
  // não paga Custo nenhum — a Habilidade continua funcionando, o recurso é que não existe.
  // Nave/Veículo ignora esse desligamento: o Grid de Energia é um sistema à parte.
  const chargesEnergy = isShipLike(sourceActor) || isEnergyPoolEnabled();
  // O Custo escrito na Skill é o do nível 1; o ciclo de nível vai descontando dele (ver
  // skillLevelBonuses em config.js). Sub-Skill usa o nível dela própria, não o da Skill-mãe.
  const cost = chargesEnergy ? effectiveSkillCost(mech.cost, mech.level) : 0;

  // Mana variável: quem usa escolhe quanto investir (sem teto; mínimo nas Regras da Mesa), e a
  // força da Skill segue `manaInvestmentPower`. Só pra quem paga com Mana (Nave paga com a Bateria).
  let paid = cost;
  let investRatio = 1;
  const investConfig = getManaInvestConfig();
  if (cost > 0 && mech.variableMana && !isShipLike(sourceActor)) {
    const available = currentEnergyValue(sourceActor);
    const minimum = Math.max(1, Math.ceil((cost * investConfig.minPercent) / 100));
    if (available < minimum) {
      await warnInsufficientEnergy(sourceActor, label, minimum);
      return null;
    }
    const invested =
      options.manaInvested ??
      (await promptManaInvestment({
        label,
        cost,
        available,
        minimum,
        exponent: investConfig.exponent,
        energyLabel: getEnergyLabelForActor(sourceActor)
      }));
    if (invested == null) return null;
    paid = invested;
    investRatio = invested / cost;
  }

  if (paid > 0) {
    const current = currentEnergyValue(sourceActor);
    if (current < paid) {
      await warnInsufficientEnergy(sourceActor, label, paid);
      return null;
    }
    await sourceActor.update({ [energyValuePath(sourceActor)]: current - paid });
  }
  if (mech.hasUpkeep) {
    // A razão investida fica guardada: o Custo por rodada é cobrado vezes ela enquanto ligada.
    await skill.update(skillStateUpdate(skill, options.subSkillIndex, { active: true, investRatio: investRatio }));
  }
  // Daqui pra frente a Skill carrega a força do investimento (dano, Efeitos, Vida de Estrutura).
  const investPower = manaInvestmentPower(investRatio, investConfig.exponent) * manaDensity;
  if (manaDensity > 1) ui.notifications?.info(`Mana densa aqui (×${manaDensity}): ${label} sai com essa força.`);
  if (investPower !== 1) mech = { ...(typeof mech.toObject === "function" ? mech.toObject() : mech), investPower };

  // Dispara e esquece — nunca aguardado, a animação não deve atrasar a mecânica/chat. Dano em alvo
  // único toca a animação dentro de `rollSkillDamage`, que sabe se uma Estrutura segurou o golpe
  // (a animação para na parede) e se sobrou dano pra seguir até o alvo.
  const damagesOneTarget = mech.effectType === "damage" && mech.targetType !== "emission" && mech.targetType !== "zone" && !isStructureMechanic(mech);
  if (!damagesOneTarget) playSkillAnimation(sourceActor, mech, { targetActor: options.targetActor ?? options.targetActors?.[0] ?? null });

  if (isStructureMechanic(mech)) {
    // Estrutura: a Skill ergue parede/bloco no mapa (ver structures.js). Sem mapa, só o cartão.
    // Antimagia (campo ou Selo): lançar uma Estrutura mágica para dentro ou através dele cobra o
    // extra, ou anula — a checagem é nos pontos onde ela nasceria e na linha de quem lança.
    const am = await chargeAntimagic(sourceActor, mech, placementTargets(options.structurePlacement?.points));
    if (am.nulled.size) return postAntimagicNulled(sourceActor, label, am.note);
    await postAntimagicPaid(sourceActor, label, am.note);
    // XP por uso: o fixo ao erguer; o dano que ela segurar conta depois (hitStructure).
    const raised = await requestStructure({
      sourceActor,
      skillId,
      subSkillIndex: options.subSkillIndex ?? null,
      structureId: mech.structureId,
      placement: options.structurePlacement ?? null,
      untilDeactivated: mech.hasUpkeep,
      label,
      power: mech.investPower ?? 1
    });
    if (raised) await grantSkillUseXp(skill, [{ flat: true }]);
    return raised;
  }

  if (mech.targetType === "zone") {
    // Zona: nada é aplicado agora — o efeito só cai em quem estiver DENTRO dela no início do
    // próprio turno (ver `tickZonesForCombatant`). Aqui só nasce a área na cena.
    if (!options.zonePlacement) return null;
    const zoneArea = options.zonePlacement.area;
    const am = await chargeAntimagic(sourceActor, mech, placementTargets(zoneArea ? [{ x: zoneArea.x, y: zoneArea.y }] : []));
    if (am.nulled.size) return postAntimagicNulled(sourceActor, label, am.note);
    await postAntimagicPaid(sourceActor, label, am.note);
    const created = await createZone(options.zonePlacement, {
      sourceActor,
      skillId,
      subSkillIndex: options.subSkillIndex ?? null,
      label,
      rounds: mech.zoneRounds,
      untilDeactivated: mech.hasUpkeep
    });
    // Sem Mestre ou recusada: o aviso já saiu em createZone; não anuncia uma Zona que não existe.
    if (!created) return false;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
      content: `<p><strong>${escapeHtml(sourceActor.name)}</strong> criou a zona <strong>${escapeHtml(label)}</strong> (${mech.hasUpkeep ? "até desativar" : `${mech.zoneRounds} rodada(s)`}) — afeta quem permanecer nela no início do próprio turno.</p>`
    });
    // XP por uso: o fixo ao criar; o que ela fizer em cada turno conta depois (tickZonesForCombatant).
    await grantSkillUseXp(skill, [{ flat: true }]);
    return true;
  }

  const isEmission = mech.targetType === "emission";

  if (mech.effectType === "damage") {
    const result = isEmission
      ? await rollSkillDamageArea(sourceActor, mech, label, options.targetActors ?? [], options.rollOptions ?? null)
      : await rollSkillDamage(sourceActor, mech, label, options.targetActor ?? null, options.rollOptions ?? null);
    await grantSkillUseXp(skill, damageXpMeasures(result, options.targetActor));
    return result;
  }
  if (mech.effectType === "temporary") {
    return isEmission
      ? applySkillEffectsArea(sourceActor, skill, mech, label, options.targetActors ?? [], options.subSkillIndex ?? null)
      : applySkillEffects(sourceActor, skill, mech, label, options.targetActor ?? sourceActor, options.subSkillIndex ?? null);
  }

  const upkeepNote = mech.hasUpkeep
    ? ` (ativada — drena ${effectiveSkillCost(mech.upkeepCost, mech.level)} de ${escapeHtml(getEnergyLabelForActor(sourceActor))} por rodada)`
    : "";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p><strong>${escapeHtml(sourceActor.name)}</strong> usou <strong>${escapeHtml(label)}</strong>${upkeepNote}.</p>`
  });
  return true;
}

const FIELD_ENDS_NOTE = " — anulado: o Campo de Antimagia o desfaria na hora";

/** Uso anulado pela antimagia (nada foi aplicado): um aviso no chat. Devolve false. */
async function postAntimagicNulled(sourceActor, label, note) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p><strong>${escapeHtml(sourceActor.name)}</strong> usou <strong>${escapeHtml(label)}</strong>${escapeHtml(note)}.</p>`
  });
  return false;
}

/** Custo extra de antimagia pago: uma linha curta no chat (nada se perde, só custa mais). */
async function postAntimagicPaid(sourceActor, label, note) {
  if (!note) return;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p><strong>${escapeHtml(sourceActor.name)}</strong>: <strong>${escapeHtml(label)}</strong>${escapeHtml(note)}.</p>`
  });
}

/**
 * XP por uso de uma rolagem de dano: o dano final de cada alvo sobre a "Vida" dele (Nave: Escudo +
 * Casco + Integridade). Alvo único vem de `finalDamage`; área, de `hits`.
 */
export function damageXpMeasures(result, targetActor = null) {
  if (!result) return [];
  if (Array.isArray(result.hits)) return result.hits.filter(h => h.damage > 0).map(h => ({ value: h.damage, base: vitalBase(h.actor) }));
  return targetActor && result.finalDamage > 0 ? [{ value: result.finalDamage, base: vitalBase(targetActor) }] : [];
}

/** Entrada de Efeito que é cura de Vida (Periódico, valor positivo). */
function isHealEntry(entry) {
  if (entry?.target === "heal") return Number(entry.amount) > 0;
  return entry?.target === "hp" && Boolean(entry.periodic) && Number(entry.amount) > 0;
}

/** Condição cujo bloqueio de cura fica preso numa parte (Ferida Amaldiçoada). */
function blocksPartEntry(entry, conditions = getActiveStatusConditions()) {
  return conditions.find(c => c.id === entry?.conditionId)?.healBlock?.scope === "part";
}

/** A mecânica como objeto simples (o `system` de uma Skill é um DataModel). */
function plainMech(mech) {
  return typeof mech?.toObject === "function" ? mech.toObject() : { ...mech };
}

/** Põe na mecânica as escolhas feitas ao usar (parte focada da cura, parte do bloqueio). */
function withEffectChoices(mech, choices) {
  if (!choices?.focusPartId && !choices?.healBlockPartId) return mech;
  const conditions = getActiveStatusConditions();
  return { ...plainMech(mech), effects: applyEffectChoices(mech.effects, choices, { isHeal: isHealEntry, blocksPart: e => blocksPartEntry(e, conditions) }) };
}

/**
 * Aplica os Efeitos em cada alvo e devolve `[{actor, summary, applied}]` na ordem dos alvos.
 *
 * O Foundry só deixa um cliente gravar nos Atores de que é dono. Um jogador que põe Lentidão num
 * NPC, ou um buff no personagem de outro jogador, recebia "Falha ao usar a Habilidade" — às vezes
 * com metade aplicada. Os alvos que este cliente não grava vão num só pedido ao Mestre
 * (`applySkillEffects` no relay), que refaz a mecânica a partir da Skill do lado dele e aplica.
 * O mesmo modelo de dnd5e/Midi-QOL: quem tem a permissão grava.
 */
async function applyEffectsToTargets(skill, mech, label, targets, subSkillIndex, choices = {}) {
  const { local, remote } = splitByWriteAccess(targets, target => target.isOwner);
  const results = new Map();
  for (const target of local) results.set(target, { summary: await applyEffectsToActor(mech, label, skill, target, subSkillIndex), applied: true });

  if (remote.length) {
    const outcome = await runAsGm(
      "applySkillEffects",
      { sourceUuid: skill.uuid, subSkillIndex, targetUuids: remote.map(t => t.uuid), investPower: mech.investPower ?? 1, ...choices },
      { reply: true, timeout: 15000 }
    );
    const failure = relayFailureMessage(outcome, `aplicar ${label} em ${remote.map(t => t.name).join(", ")}`);
    if (failure) ui.notifications?.warn(failure);
    const byUuid = new Map((Array.isArray(outcome.value?.results) ? outcome.value.results : []).map(r => [r?.uuid, r]));
    const waiting = outcome.reason === RELAY_REASONS.timeout;
    for (const target of remote) {
      const got = byUuid.get(target.uuid);
      const summary = got ? (Array.isArray(got.summary) ? got.summary.map(String) : []) : [waiting ? "pedido enviado ao Mestre (sem resposta)" : "não aplicado"];
      summary.xp = got && Array.isArray(got.xp) ? got.xp : [];
      results.set(target, { summary, applied: Boolean(got) || waiting });
    }
  }
  return targets.map(actor => ({ actor, ...results.get(actor) }));
}

export async function applySkillEffects(sourceActor, skill, mech, label, targetActor, subSkillIndex = null) {
  if (!(mech.effects ?? []).length) {
    ui.notifications?.warn("Essa skill não tem nenhum Efeito configurado.");
    return null;
  }

  // Antimagia: Efeito mágico (buff, cura, Escudo) para dentro ou através de um campo cobra o extra, ou anula.
  // Se o campo desfaria o Efeito na hora (nível do campo ≥ o da Skill), anula sem cobrar o extra.
  if (fieldEndsEffectAt(sourceActor, mech, targetActor)) return postAntimagicNulled(sourceActor, label, FIELD_ENDS_NOTE);
  const am = await chargeAntimagic(sourceActor, mech, [targetActor]);
  if (am.nulled.has(targetActor.uuid)) return postAntimagicNulled(sourceActor, label, am.note);

  // Cura com Ferimentos por parte: quem usa pode focar numa parte (ela enche primeiro).
  const { promptHealFocus, promptTargetBodyPart } = await import("../species/anatomy.js");
  const focus = await promptHealFocus(targetActor, mech);
  const choices = {};
  if (focus) choices.focusPartId = focus.id;
  // Condição "Impede cura" presa na parte atingida (Ferida Amaldiçoada): quem usa escolhe a parte.
  if ((mech.effects ?? []).some(e => blocksPartEntry(e))) {
    const part = await promptTargetBodyPart(targetActor);
    if (part) choices.healBlockPartId = part.id;
  }
  const effective = withEffectChoices(mech, choices);
  const [{ summary, applied }] = await applyEffectsToTargets(skill, effective, label, [targetActor], subSkillIndex, choices);
  // Sem Mestre para aplicar num alvo alheio: o aviso já saiu, e não se anuncia o que não aconteceu.
  if (!applied) return false;
  await grantSkillUseXp(skill, summary.xp);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p><strong>${escapeHtml(sourceActor.name)}</strong> usou <strong>${escapeHtml(label)}</strong> em <strong>${escapeHtml(targetActor.name)}</strong>${focus ? ` (focando ${escapeHtml(focus.name)})` : ""}: ${summary.map(escapeHtml).join(", ")}${escapeHtml(am.note)}.</p>`
  });

  return true;
}

/**
 * Lado do Mestre do pedido `applySkillEffects` (ver `applyEffectsToTargets`). O pedido não é
 * confiável: a mecânica é refeita da Skill (ou do consumível) que está na ficha, quem pede tem de
 * ser dono dela, e do cliente só vêm os alvos, a força do investimento de Mana (limitada) e as
 * partes escolhidas. Devolve o resumo de cada alvo, para quem pediu postar o card e somar a XP.
 * @param {object} payload
 * @param {User} user - quem pediu (vem do servidor)
 */
export async function applySkillEffectsAsGm(payload, user) {
  const request = normalizeEffectRequest(payload);
  if (!request) return refuse(RELAY_REASONS.invalid);
  const origin = await fromUuid(request.sourceUuid);
  if (origin?.documentName !== "Item" || !origin.parent) return refuse(RELAY_REASONS.invalid);
  if (!user?.isGM && !origin.testUserPermission(user, "OWNER")) return refuse(RELAY_REASONS.permission);

  let mech;
  let label = origin.name;
  if (origin.type === "skill") {
    mech = origin.system;
    if (request.subSkillIndex != null) {
      const sub = (origin.system.subSkills ?? [])[request.subSkillIndex];
      if (!sub) return refuse(RELAY_REASONS.invalid);
      mech = sub;
      label = `${origin.name} — ${sub.name}`;
    }
  } else if (origin.system?.consumable?.enabled) {
    const { consumableMech } = await import("../economy/consumables.js");
    mech = consumableMech(origin);
  } else {
    return refuse(RELAY_REASONS.invalid);
  }
  if (mech.effectType !== "temporary") return refuse("isso não aplica Efeitos");

  mech = withEffectChoices({ ...plainMech(mech), investPower: request.investPower }, request);
  const results = [];
  for (const uuid of request.targetUuids) {
    const target = await fromUuid(uuid);
    if (target?.documentName !== "Actor") continue;
    const summary = await applyEffectsToActor(mech, label, origin, target, request.subSkillIndex);
    results.push({ uuid, summary: summary.map(String), xp: summary.xp ?? [] });
  }
  return { ok: true, value: { results } };
}

/**
 * Versão em Emissão (área) de `applySkillEffects`: aplica a mesma lista de `effects` em cada
 * Ator encontrado na área, numa única mensagem de chat consolidada.
 * @param {Actor} sourceActor
 * @param {Item} skill
 * @param {object} mech
 * @param {string} label
 * @param {Actor[]} targetActors
 */
export async function applySkillEffectsArea(sourceActor, skill, mech, label, targetActors, subSkillIndex = null) {
  if (!(mech.effects ?? []).length) {
    ui.notifications?.warn("Essa skill não tem nenhum Efeito configurado.");
    return null;
  }
  // Antimagia em Emissão também desfaz as Estruturas que a área toca, mesmo sem ninguém dentro.
  const area = targetActors.area ?? null;
  const dispelsStructures = Boolean(area) && (mech.effects ?? []).some(e => e.target === "antimagic");
  if (!targetActors.length && !dispelsStructures) {
    ui.notifications?.warn("Nenhum alvo encontrado na área.");
    return null;
  }

  // Antimagia (campo ou Selo): paga o extra uma vez, ou anula os alvos sob ela.
  // Quem está num campo que desfaria o Efeito na hora é anulado sem cobrar o extra; o resto paga ou anula.
  const ended = targetActors.filter(t => fieldEndsEffectAt(sourceActor, mech, t));
  const rest = targetActors.filter(t => !ended.includes(t));
  const am = await chargeAntimagic(sourceActor, mech, rest, { origin: targetActors.origin ?? null });
  const live = rest.filter(t => !am.nulled.has(t.uuid));
  const rows = [
    ...ended.map(t => `<li><strong>${escapeHtml(t.name)}</strong>: anulado, o Campo de Antimagia o desfaria na hora</li>`),
    ...rest.filter(t => am.nulled.has(t.uuid)).map(t => `<li><strong>${escapeHtml(t.name)}</strong>: anulado pela antimagia</li>`)
  ];
  if (targetActors.length && !live.length) return postAntimagicNulled(sourceActor, label, am.note || FIELD_ENDS_NOTE);

  const results = live.length ? await applyEffectsToTargets(skill, mech, label, live, subSkillIndex) : [];
  // Ninguém recebeu nada (todos alheios e sem Mestre): o aviso já saiu.
  if (live.length && !results.some(r => r.applied)) return false;
  const xp = [];
  for (const { actor: targetActor, summary } of results) {
    xp.push(...(summary.xp ?? []));
    rows.push(`<li><strong>${escapeHtml(targetActor.name)}</strong>: ${summary.map(escapeHtml).join(", ")}</li>`);
  }
  if (dispelsStructures) {
    const lines = await dispelStructuresInArea(skill, subSkillIndex, area);
    for (const line of lines) {
      rows.push(`<li>${escapeHtml(line)}</li>`);
      xp.push({ flat: true });
    }
  }
  await grantSkillUseXp(skill, xp);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p><strong>${escapeHtml(sourceActor.name)}</strong> usou <strong>${escapeHtml(label)}</strong> (Emissão) em ${live.length} alvo(s)${escapeHtml(am.note)}:</p><ul>${rows.join("")}</ul>`
  });

  return true;
}
