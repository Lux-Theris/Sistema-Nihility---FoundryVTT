/**
 * Efeitos Temporários: criar/renovar Active Effects e Condições num alvo, e os ticks periódicos (Veneno, cura).
 * (Separado de skill-effects.js na reorganização de pastas — mesma lógica de antes.)
 */
import { SYSTEM_ID, getActiveStatusConditions, getEffectTargetLabels, skillLevelBonuses, getDamageElement } from "../core/config.js";
import { makeAnchor, addAnchor, effectAnchors, finiteRemaining, serializeFinite, durationRemaining, refreshFiniteRounds, PERMANENT } from "../combat/effect-anchors.js";
import { applyStructuralDamage, damageCasco, repairModules } from "../starship/starship-power.js";
import { resolveConditionEffect, refreshReapplication } from "../combat/damage-rules.js";
import { requestShieldLight } from "../combat/lights.js";
import { addShieldToPool } from "../combat/shield-pools.js";
import { buildEffectChanges, createActiveEffects } from "../helpers/foundry-compat.js";
import { applyDamageReductions, averageElementContext } from "../combat/damage-roll.js";
import { SHIP_PERCENT_PATHS, resolveEffectChange } from "./effect-targets.js";
import { grantResistanceXp, registerResistanceExposure } from "../combat/resistance.js";
import { isShipLike, applyShipInstantEffect } from "../starship/ship-damage.js";
import { recordSustainedShield } from "./sustained-shields.js";
import { combatNow } from "./upkeep.js";

/**
 * Um efeito é "periódico" (veneno/cura contínua — bate um tick de `amount` em vez de aplicar
 * uma vez só) apenas quando o alvo é HP ou Energia — atributos de combate não têm um "tick"
 * que faça sentido (só buff/debuff de duração normal). Ver effectEntrySchema() em
 * data/item-models.js.
 */
function isPeriodicEntry(entry) {
  return Boolean(entry.periodic) && PERIODIC_TARGETS.includes(entry.target);
}

/** Alvos que aceitam Periódico: Vida/Mana de Personagem e Casco/Integridade de Nave (dano contínuo, reparo por rodada). */
const PERIODIC_TARGETS = ["hp", "energy", "shipCasco", "shipHull"];

/** Alvos de Efeito de Nave que agem NA HORA (sem Active Effect): Escudo, Casco, Integridade, Preparar para impacto. */
const SHIP_INSTANT_TARGETS = ["shipShieldRestore", "shipCasco", "shipHull", "shipDamageReduction"];

/** Mesmo conjunto de elementos, independente da ordem — usado só pra separar stacks de Veneno por elemento. */
function sameElementSet(a, b) {
  const setA = new Set(a ?? []);
  const setB = new Set(b ?? []);
  if (setA.size !== setB.size) return false;
  for (const el of setA) if (!setB.has(el)) return false;
  return true;
}

/**
 * Efeito já ativo no alvo com a MESMA Condição nomeada (mesmo `conditionId`, não vazio, E
 * mesma natureza periódica/não-periódica) que este sistema criou — usado pra decidir "estender
 * duração" em vez de "criar um segundo efeito" quando a mesma Condição é reaplicada em quem já
 * está afetado por ela (ex: 2º ataque de Veneno em quem já está Envenenado soma a
 * duração/ticks, não duplica o efeito). Exige a mesma "natureza" pra nunca tentar somar
 * `ticksRemaining` num efeito que não tem motor de tick (ou vice-versa) — um GM que reusar o
 * mesmo id de Condição ora periódico ora não simplesmente ganha dois efeitos independentes.
 *
 * Pra Periódico (Veneno/cura), também exige o MESMO conjunto de `damageElements`: Veneno+Gelo e
 * Veneno+Fogo são efeitos independentes que coexistem (cada elemento reduzido pela Resistência
 * certa) — só duas aplicações com EXATAMENTE os mesmos elementos somam duração/ticks entre si.
 */
function findStackableEffect(targetActor, conditionId, periodic, damageElements = []) {
  if (!conditionId) return null;
  return (
    targetActor.effects.find(e => {
      const flags = e.flags?.[SYSTEM_ID];
      if (!flags || flags.conditionId !== conditionId || Boolean(flags.periodic) !== periodic) return false;
      if (periodic && !sameElementSet(flags.tickDamageElements, damageElements)) return false;
      return true;
    }) ?? null
  );
}

/**
 * Aplica cada entrada de `mech.effects` num único Ator e devolve o resumo textual (sem postar
 * chat) — compartilhado entre alvo único e Emissão. `originSkill` só empresta `img`/`uuid` pro
 * Active Effect criado (mesmo quando `mech` é o snapshot de uma Sub-Skill). Reaplicar a mesma
 * Condição nomeada em quem já a tem estende a duração/ticks restantes em vez de duplicar.
 *
 * Qualquer entrada de `mech.effects` (buff/debuff comum OU Periódico/Veneno/cura) tem dois
 * modos de duração, decididos pela Skill inteira via `mech.hasUpkeep` — nunca por
 * `entry.durationRounds` quando esse for o caso:
 *  - Sem Habilidade Ativa: dura `entry.durationRounds` rounds/ticks (buff sem duração vira pra
 *    sempre, se 0), igual sempre foi — custo pago uma vez, sem acompanhamento nenhum depois.
 *  - Com Habilidade Ativa: contribui SEMPRE 0 de duração (nunca infla `durationRounds`/ticks de
 *    outra fonte) e vira uma "âncora" que segura o efeito vivo até a Skill ser desativada
 *    (manual ou por falta de Energia, ver `removeUpkeepLinkedEffects`/`useSkillEffect`/
 *    `tickActorUpkeepSkills`). Os dois tipos guardam as âncoras em `activeAnchors` (por uuid da
 *    Skill, ver effect-anchors.js). Buff/debuff comum ancorado fica sem duração do Foundry; o
 *    prazo de aplicações comuns da mesma Condição corre em paralelo na flag `finite`.
 *    Periódico (Veneno/cura): os ticks de OUTRAS fontes
 *    (finitas) continuam decaindo normalmente; quando chegam a 0, se ainda sobrar alguma âncora
 *    o efeito continua tickando (só sustentado por ela) em vez de expirar. Isso evita que
 *    reaplicar uma Skill Ativa em cima de um Veneno já ativo fique "estendendo" a duração pra
 *    sempre — ela só marca presença, quem realmente decai são as fontes de duração fixa.
 *    Duas aplicações de Veneno com elementos DIFERENTES (ex: Veneno+Gelo vs Veneno+Fogo) nunca
 *    somam entre si — só contam como a mesma "pilha" quando os elementos são exatamente iguais
 *    (ver `findStackableEffect`). Um alvo pego numa área de Emissão fica com o efeito mesmo
 *    saindo do lugar no canvas depois — a área só serviu pra ESCOLHER quem foi afetado no
 *    momento de usar, o efeito em si vive no Ator, não no espaço.
 */
export async function applyEffectsToActor(mech, label, originSkill, targetActor, subSkillIndex = null) {
  const rawEntries = mech.effects ?? [];
  const summary = [];

  // O Poder do nível também vale pros valores de Efeito — um buff/veneno de Skill nível 10 é
  // mais forte que o mesmo de nível 1, igual acontece com o dano. Entrada de tipo "multiplicador"
  // (só os alvos de arma de Nave) fica de fora: ali `amount` é um percentual, e escalá-lo
  // significaria outra coisa.
  const levelPower = skillLevelBonuses(mech.level).power * (mech.investPower ?? 1);
  const entries =
    levelPower === 1
      ? rawEntries
      : rawEntries.map(entry =>
          entry.modifierType === "multiplier"
            ? entry
            : {
                ...entry,
                amount: Math.round((Number(entry.amount) || 0) * levelPower),
                shieldRegen: Math.round((Number(entry.shieldRegen) || 0) * levelPower),
                shieldCap: Math.round((Number(entry.shieldCap) || 0) * levelPower)
              }
        );

  // Condição aplicada por elemento (sem Skill de origem) — ícone e origem vêm da própria Condição.
  const origin = originSkill ?? { id: null, uuid: null, img: null };

  for (let entry of entries) {
    const condition = entry.conditionId ? getActiveStatusConditions().find(c => c.id === entry.conditionId) : null;
    // Condição com efeito padrão e valor 0 na entrada: usa o padrão da Condição (ver
    // resolveConditionEffect em damage-rules.js). Sem golpe de onde tirar "% do dano", fica só o ícone.
    if (condition?.effect?.kind && !Number(entry.amount)) {
      const resolved = resolveConditionEffect(condition, {
        hitDamage: entry.hitDamage,
        targetMax: { hp: targetActor.system?.attributes?.hp?.max ?? 0, energy: targetActor.system?.attributes?.energy?.max ?? 0 },
        attributeTotal: key => targetActor.system?.attributes?.combat?.[key]?.total ?? 0
      });
      if (resolved) entry = { ...entry, ...resolved };
    }
    const targetLabel = getEffectTargetLabels()[entry.target] ?? entry.target;
    const sign = entry.amount >= 0 ? "+" : "";

    if (entry.target === "shield") {
      // Escudo ignora Condição/Periódico/Duração — é sempre somado direto, gasto na mão. Numa
      // Habilidade Ativa com Regeneração ou Teto, vira um Escudo MANTIDO: entra até o teto,
      // regenera a cada turno de quem mantém e some ao desligar (ver sustainedShieldGain).
      if (!targetActor.system.attributes?.shield) {
        summary.push(`${targetLabel}: não se aplica a ${targetActor.name}`);
        continue;
      }
      const sustained = Boolean(mech.hasUpkeep) && (entry.shieldRegen > 0 || entry.shieldCap > 0) && entry.amount >= 0;
      // Cada Skill tem o seu pool de Escudo no alvo (ver shield-pools.js); sem Skill de origem
      // (Condição marcada à mão), vai pro avulso.
      // O Escudo pode ser de um elemento (Escudo de Água): o golpe usa a vantagem contra ele.
      const shieldElements = Array.isArray(entry.damageElements) ? entry.damageElements.filter(Boolean) : [];
      const source = originSkill?.parent ? { holderUuid: originSkill.parent.uuid, skillId: origin.id, subSkillIndex, label, elements: shieldElements } : null;
      let change;
      if (entry.amount >= 0) {
        change = await addShieldToPool(targetActor, source, entry.amount, { cap: sustained ? entry.shieldCap : 0 });
      } else {
        // Escudo negativo (debuff): tira do total; os pools se ajustam sozinhos (mais recente primeiro).
        const current = targetActor.system.attributes.shield.value ?? 0;
        change = Math.max(-current, entry.amount);
        await targetActor.update({ "system.attributes.shield.value": current + change });
      }
      if (sustained && originSkill?.parent) {
        await recordSustainedShield(originSkill.parent, {
          targetUuid: targetActor.uuid,
          elements: shieldElements,
          skillId: origin.id,
          subSkillIndex,
          regen: entry.shieldRegen,
          cap: entry.shieldCap,
          label
        });
      }
      // Luz do Escudo (opcional, ver lights.js): acende no Token do alvo; é apagada quando o
      // Escudo chega a 0 ou quando a Skill Ativa que o deu é desligada.
      if (entry.amount > 0 && entry.light?.enabled) {
        await requestShieldLight(targetActor, entry.light, {
          actorUuid: originSkill?.parent?.uuid ?? "",
          skillId: origin.id ?? "",
          subSkillIndex
        });
      }
      summary.push(sustained ? `Escudo +${change} (mantido${entry.shieldRegen ? `, +${entry.shieldRegen}/rodada` : ""}${entry.shieldCap ? `, teto ${entry.shieldCap}` : ""})` : `Escudo ${sign}${entry.amount}`);
      continue;
    }

    // Condição com tick de Vida que cai numa Nave (Queimadura de Plasma): a "Vida" da Nave é a
    // Integridade Estrutural.
    if (isShipLike(targetActor) && entry.periodic && entry.target === "hp") entry = { ...entry, target: "shipHull" };
    const shipTarget = SHIP_INSTANT_TARGETS.includes(entry.target);
    if (shipTarget && !isShipLike(targetActor)) {
      summary.push(`${targetLabel}: não se aplica a ${targetActor.name}`);
      continue;
    }
    if (shipTarget && !isPeriodicEntry(entry)) {
      summary.push(await applyShipInstantEffect(targetActor, entry, label));
      continue;
    }

    // Tick de Nave (Casco/Integridade) não mexe em campo nenhum por Active Effect: é só o flag
    // do tick, lido por tickPeriodicEffect.
    const change = shipTarget ? { isMultiplier: false } : resolveEffectChange(entry, targetActor);
    if (!change) {
      // Antes era silencioso: "Força" numa Nave virava um efeito que não fazia nada.
      summary.push(`${targetLabel}: não se aplica a ${targetActor.name}`);
      continue;
    }
    const isMultiplier = change.isMultiplier;

    const periodic = isPeriodicEntry(entry);
    const tiedToActive = Boolean(mech.hasUpkeep);
    const anchor = makeAnchor({ skillUuid: origin.uuid, skillId: origin.id, subSkillIndex });
    const existing = findStackableEffect(targetActor, entry.conditionId, periodic, entry.damageElements);

    if (existing) {
      const existingFlags = existing.flags[SYSTEM_ID];

      if (periodic) {
        // Uma aplicação "Ativa" nunca soma ticks (contribui 0 de duração) — só registra sua
        // própria fonte como uma "âncora" que segura o efeito vivo. Os ticks de outras fontes
        // (finitas) continuam contando normalmente; quando chegarem em 0, se ainda sobrar
        // alguma âncora, o efeito continua tickando (agora só sustentado por ela) em vez de
        // expirar — é assim que "até desativar" nunca fica refém de reaplicações infinitas.
        if (tiedToActive) {
          const anchors = existingFlags.activeAnchors ?? [];
          const next = addAnchor(anchors, anchor);
          if (next.length !== anchors.length) {
            await existing.update({ [`flags.${SYSTEM_ID}.activeAnchors`]: next });
          }
          summary.push(`${condition?.label ?? targetLabel}: mantido ativo (até desativar)`);
        } else {
          // Reaplicar RENOVA o contador, sem somar, e fica com o valor mais forte (ver
          // refreshReapplication em damage-rules.js).
          const next = refreshReapplication(
            { rounds: existingFlags.ticksRemaining ?? 0, amount: existingFlags.tickAmount ?? 0 },
            { rounds: Math.max(1, entry.durationRounds), amount: entry.amount }
          );
          await existing.update({
            [`flags.${SYSTEM_ID}.ticksRemaining`]: next.rounds,
            [`flags.${SYSTEM_ID}.tickAmount`]: next.amount
          });
          summary.push(`${condition?.label ?? targetLabel}: renovado (${next.rounds} tick(s))`);
        }
      } else {
        // Buff/debuff comum: mesmo modelo do periódico (effect-anchors.js). Cada Skill Ativa é uma
        // âncora a mais; uma aplicação comum renova o prazo finito, que conta em paralelo. Enquanto
        // houver âncora, a duração do Foundry fica vazia e o prazo mora na flag `finite`.
        const combat = game.combat;
        const now = combatNow();
        const anchors = effectAnchors(existingFlags, existing.origin);
        const current = anchors.length ? finiteRemaining(existingFlags.finite, now) : durationRemaining(existing.duration, combat ? combat.round ?? 0 : null);
        const nextAnchors = tiedToActive ? addAnchor(anchors, anchor) : anchors;
        const nextFinite = tiedToActive ? current : refreshFiniteRounds(current, entry.durationRounds);
        const name = condition?.label ?? targetLabel;

        if (nextAnchors.length) {
          await existing.update({
            duration: { rounds: null },
            [`flags.${SYSTEM_ID}.activeAnchors`]: nextAnchors,
            [`flags.${SYSTEM_ID}.tiedToActive`]: true,
            [`flags.${SYSTEM_ID}.finite`]: serializeFinite(nextFinite, now)
          });
          const finiteText = nextFinite === PERMANENT ? "sem prazo" : nextFinite > 0 ? `${nextFinite} rodada(s)` : "";
          summary.push(tiedToActive ? `${name}: mantido ativo (até desativar)` : `${name}: renovado${finiteText ? ` (${finiteText})` : ""}, mantido por Skill Ativa`);
        } else {
          const update = { "duration.rounds": nextFinite === PERMANENT ? null : nextFinite };
          if (combat) Object.assign(update, { "duration.startRound": combat.round ?? 0, "duration.startTurn": combat.turn ?? 0 });
          await existing.update(update);
          summary.push(`${name}: renovado (${nextFinite === PERMANENT ? "sem prazo" : `${nextFinite} rodada(s)`})`);
        }
      }
      continue;
    }

    if (periodic) {
      await targetActor.createEmbeddedDocuments("ActiveEffect", [
        {
          name: condition?.label ?? `${label}: ${targetLabel}`,
          img: entry.icon || condition?.icon || origin.img || "icons/svg/aura.svg",
          origin: origin.uuid ?? undefined,
          statuses: entry.conditionId ? [entry.conditionId] : [],
          flags: {
            [SYSTEM_ID]: {
              skillEffect: true,
              periodic: true,
              conditionId: entry.conditionId || "",
              tickTarget: entry.target,
              tickAmount: entry.amount,
              tickUnit: entry.tickUnit || "combatRound",
              // Uma aplicação "Ativa" começa com 0 de duração própria (nunca infla o contador) —
              // só existe indefinidamente porque `activeAnchors` não está vazio (ver
              // tickPeriodicEffect: só expira quando ticksRemaining chega a 0 E não sobra âncora).
              ticksRemaining: tiedToActive ? 0 : Math.max(1, entry.durationRounds),
              activeAnchors: tiedToActive ? [anchor] : [],
              // Snapshot no momento da aplicação (mesma filosofia de Sub-Skill) — só usado
              // quando o tick é dano (amount negativo); cura periódica nunca é reduzida.
              tickDamageElements: Array.isArray(entry.damageElements) ? entry.damageElements : []
            }
          }
        }
      ]);
      const unitLabel = entry.tickUnit === "manual" ? "manual" : "por rodada de combate";
      const durationLabel = tiedToActive ? "até desativar" : `${Math.max(1, entry.durationRounds)} tick(s)`;
      summary.push(`${condition?.label ?? targetLabel} ${sign}${entry.amount}/tick (${durationLabel}, ${unitLabel})`);
      continue;
    }

    await createActiveEffects(targetActor, [
      {
        name: condition?.label ?? (change.bodyElement ? `${label}: ${getDamageElement(change.bodyElement)?.label ?? change.bodyElement}` : `${label}: ${targetLabel} ${sign}${entry.amount}`),
        img: entry.icon || condition?.icon || origin.img || "icons/svg/aura.svg",
        origin: origin.uuid ?? undefined,
        statuses: entry.conditionId ? [entry.conditionId] : [],
        duration: !tiedToActive && entry.durationRounds > 0 ? { rounds: entry.durationRounds } : {},
        // Formato V13 (`changes` + `mode`) ou V14 (`system.changes` + `type`): ver foundry-compat.js.
        ...(change.key ? buildEffectChanges([{ key: change.key, mode: change.mode, value: change.value }]) : {}),
        flags: {
          [SYSTEM_ID]: {
            skillEffect: true,
            conditionId: entry.conditionId || "",
            tiedToActive,
            activeAnchors: tiedToActive ? [anchor] : [],
            sourceSkillId: origin.id,
            sourceSubSkillIndex: subSkillIndex,
            bodyElement: change.bodyElement ?? ""
          }
        }
      }
    ]);
    const valueText =
      ["weaponElement", "bodyElement"].includes(entry.target) ? `→ ${getDamageElement(entry.elementId)?.label ?? entry.elementId}`
      : ["weaponMagic", "weaponAbsolute"].includes(entry.target) ? ""
      : isMultiplier ? `×${(1 + entry.amount / 100).toFixed(2)}`
      : `${sign}${entry.amount}${SHIP_PERCENT_PATHS[entry.target] || entry.target === "movement" ? "%" : ""}`;
    summary.push(
      tiedToActive
        ? `${targetLabel} ${valueText} (até desativar)`
        : `${targetLabel} ${valueText}${entry.durationRounds > 0 ? ` (${entry.durationRounds} rounds)` : ""}`
    );
  }

  return summary;
}

/**
 * Aplica uma Condição que o Mestre marcou À MÃO no token (item 02) — o caminho que não passa por
 * Skill nenhuma.
 *
 * Reaproveita `applyEffectsToActor` de propósito, com uma "Skill sintética" no lugar da origem:
 * assim a Condição manual nasce com exatamente a mesma forma de flags, `statuses`, duração e
 * empilhamento que uma vinda de Skill. Se fosse montada à parte, as duas divergiriam na primeira
 * mudança de schema — e aí reaplicar Veneno por Skill em quem o Mestre marcou à mão deixaria de
 * empilhar, que é justamente o que se espera que funcione.
 * @param {Actor} actor
 * @param {string} conditionId - id de getActiveStatusConditions()
 * @param {object} entry - uma entrada no formato de `effectEntrySchema` (ver data/item-models.js)
 */
export async function applyManualCondition(actor, conditionId, entry) {
  const condition = getActiveStatusConditions().find(c => c.id === conditionId);
  if (!condition) return [];

  const origin = { id: `manual:${conditionId}`, img: condition.icon, uuid: undefined };
  return applyEffectsToActor({ effects: [{ ...entry, conditionId }], hasUpkeep: false }, condition.label, origin, actor, null);
}

/**
 * Bate um único tick de um Active Effect periódico (veneno/cura contínua): aplica
 * `flags.tickAmount` direto em HP/Energia atual (clamped, sem passar pelo Máximo — igual um
 * dano/cura de verdade, não um buffDelta), decrementa `ticksRemaining` e apaga o efeito ao
 * chegar a 0. Compartilhado entre o hook automático de combate e o botão manual da ficha.
 *
 * Tick de DANO (`tickAmount` negativo) é reduzido por Resistência Geral + Elemental do próprio
 * Ator (`skipMagicDefense: true` — Defesa Mágica NUNCA reduz um tick, nem quando o Veneno é
 * mágico; decisão de balanceamento deliberada, diferente do dano "normal" de `rollSkillDamage`).
 * Tick de CURA (`tickAmount` positivo) sempre aplica o valor cheio, sem redução nenhuma — não
 * existe conceito de "resistir à própria cura" neste sistema.
 * @param {Actor} actor
 * @param {ActiveEffect} effect
 */
export async function tickPeriodicEffect(actor, effect) {
  const flags = effect.flags?.[SYSTEM_ID];
  if (!flags?.periodic) return null;

  // Nave: dano contínuo (ou reparo por rodada) no Casco ou na Integridade Estrutural. O dano leva o
  // "Dano por camada" dos elementos do tick (Plasma +15% no Casco…); o reparo nunca é reduzido.
  if (flags.tickTarget === "shipCasco" || flags.tickTarget === "shipHull") {
    const layer = flags.tickTarget === "shipCasco" ? "casco" : "hull";
    let delta;
    if (flags.tickAmount < 0) {
      const ctx = averageElementContext(flags.tickDamageElements ?? [], actor);
      const damage = Math.floor(-flags.tickAmount * Math.max(0, 1 + (ctx.layers?.[layer] || 0)));
      const dealt = layer === "casco" ? await damageCasco(actor, damage) : (await applyStructuralDamage(actor, damage)).reduce((sum, h) => sum + h.damage, 0);
      delta = -dealt;
    } else {
      delta = await repairModules(actor, flags.tickAmount, layer === "casco" ? "armor" : null);
    }
    const anchored = (flags.activeAnchors ?? []).length > 0;
    const ticksRemaining = Math.max(0, (flags.ticksRemaining ?? 1) - 1);
    const expired = ticksRemaining <= 0 && !anchored;
    if (expired) await effect.delete();
    else await effect.update({ [`flags.${SYSTEM_ID}.ticksRemaining`]: ticksRemaining });
    return {
      attrKey: layer,
      delta,
      newValue: null,
      ticksRemaining: anchored && ticksRemaining <= 0 ? null : ticksRemaining,
      expired,
      effectName: effect.name,
      appliedReductions: []
    };
  }

  const attrKey = flags.tickTarget === "energy" ? "energy" : "hp";
  const attr = actor.system.attributes[attrKey];

  let delta = flags.tickAmount;
  let appliedReductions = [];
  if (delta < 0) {
    const mech = { damageElements: flags.tickDamageElements ?? [] };
    const reduction = applyDamageReductions(-delta, mech, actor, { skipMagicDefense: true, triggerConditions: false });
    delta = -reduction.finalDamage;
    appliedReductions = reduction.appliedReductions;
    await grantResistanceXp(reduction.defenders, actor);
    await registerResistanceExposure(actor, mech.damageElements, reduction.finalDamage);
  }

  const newValue = Math.clamp(attr.value + delta, 0, attr.max);
  await actor.update({ [`system.attributes.${attrKey}.value`]: newValue });

  // `activeAnchors` não-vazio = pelo menos uma Skill "Ativa" está segurando este efeito vivo
  // (reaplicações Ativas contribuem 0 de duração — só registram a âncora, ver
  // applyEffectsToActor). Os ticks de fontes finitas continuam decaindo normalmente; ao chegar
  // em 0, só expira de verdade se NENHUMA âncora sobrar — senão fica tickando no piso até
  // `removeUpkeepLinkedEffects` remover a(s) âncora(s) restante(s).
  const anchored = (flags.activeAnchors ?? []).length > 0;
  const ticksRemaining = Math.max(0, (flags.ticksRemaining ?? 1) - 1);
  const expired = ticksRemaining <= 0 && !anchored;

  if (expired) await effect.delete();
  else await effect.update({ [`flags.${SYSTEM_ID}.ticksRemaining`]: ticksRemaining });

  // Pro chamador (chat/UI), "até desativar" só faz sentido reportar quando os ticks já
  // zeraram e só a âncora está segurando — enquanto ainda há ticks finitos contando, mostra o
  // número normal mesmo que exista uma âncora em paralelo.
  const displayTicks = anchored && ticksRemaining <= 0 ? null : ticksRemaining;

  return { attrKey, delta, newValue, ticksRemaining: displayTicks, expired, effectName: effect.name, appliedReductions };
}

/**
 * Tica todos os Efeitos Periódicos de `tickUnit: "combatRound"` de um Ator e posta um resumo
 * único no chat — chamado pelo hook `updateCombat` (nihility-rpg-system.js) sempre que chega a
 * vez desse Ator no combate. Efeitos `tickUnit: "manual"` nunca são tocados aqui (ver o botão
 * "Aplicar Tick" da ficha, actor-sheet.js).
 * @param {Actor} actor
 */
export async function tickCombatRoundEffects(actor) {
  const effects = actor.effects.filter(e => e.flags?.[SYSTEM_ID]?.periodic && e.flags[SYSTEM_ID].tickUnit !== "manual");
  const results = [];
  for (const effect of effects) {
    const result = await tickPeriodicEffect(actor, effect);
    if (result) results.push(result);
  }

  if (results.length) {
    const rows = results.map(r => {
      const attrLabel = { hp: "HP", casco: "Casco", hull: "Integridade" }[r.attrKey] ?? getEffectTargetLabels().energy;
      const statusText = r.expired ? "encerrou" : r.ticksRemaining === null ? "até desativar" : `${r.ticksRemaining} tick(s) restante(s)`;
      // Nunca revela NO CHAT que/quanto de Resistência foi aplicada no tick — só o delta final.
      return `<li><strong>${r.effectName}</strong>: ${r.delta >= 0 ? "+" : ""}${r.delta} ${attrLabel} (${statusText})</li>`;
    });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${actor.name}</strong> — início de turno, Condições ativas:</p><ul>${rows.join("")}</ul>`
    });
  }

  return results;
}
