/**
 * Tratadores por alvo de Efeito (`entry.target`) de `applyEffectsToActor` (effects-apply.js).
 * Separados do laço em 1.8x sem mudar comportamento: a ORDEM das checagens e das escritas é a de antes.
 *
 * Cada tratador recebe `(entry, ctx, view)` e devolve:
 *  - `HANDLED`     — o efeito foi tratado (o laço faz `continue`);
 *  - `FALLTHROUGH` — não tratou, segue pelo caminho padrão (Active Effect).
 * `ctx` é montado uma vez por chamada (`buildEffectContext`); `view` (`{condition, targetLabel, sign}`) só existe
 * no estágio "post", depois que a Condição e o padrão dela foram resolvidos.
 *
 * Dois estágios, porque a Condição (Maldição, efeito padrão com valor 0) fica NO MEIO da ordem original:
 *  - "pre":  antes da Maldição/Condição  (ritmo do tempo, Marcar, Dissipar, Antimagia, PEM);
 *  - "post": depois delas               (curar/recuperar Mana na hora, Escudo).
 * Para um alvo novo: uma linha em `EFFECT_TARGET_HANDLERS` com o estágio certo.
 *
 * Ciclo de import com effects-apply.js: seguro, nada aqui roda na avaliação do módulo (só dentro das funções).
 */
import { sameActor, getEffectTargetLabels, isInterferenceEnabled, isSkillRangeEnabled } from "../core/config.js";
import { requestShieldLight } from "../combat/lights.js";
import { addShieldToPool } from "../combat/shield-pools.js";
import { isShipLike } from "../starship/ship-damage.js";
import { recordSustainedShield } from "./sustained-shields.js";
import { applyAntimagic, applyEmp, applyDissipate } from "./dispel.js";
import { protectingStructureKinds } from "../structures/structures.js";
import { vitalBase } from "./skill-xp.js";
import { applyTimeRateEntry, applyMark, restoreVital } from "./effects-apply.js";

export const HANDLED = "continue";
export const FALLTHROUGH = "fallthrough";

/** Ritmo do tempo (8e): Acelerar/Desacelerar; o fator enfraquece contra alvo mais forte que a Skill. */
async function handleTimeRate(entry, ctx) {
  const { mech, label, originSkill, origin, targetActor, subSkillIndex, sourceLevel, sourceMagic, sourceTech, appliedBy, xp, summary } = ctx;
  summary.push(await applyTimeRateEntry(entry, { mech, label, originSkill, origin, targetActor, subSkillIndex, sourceLevel, sourceMagic, sourceTech, appliedBy, xp }));
  return HANDLED;
}

/** Marcar (H4): quem usou passa a poder lançar Skills a partir do alvo. */
async function handleMark(entry, ctx) {
  const { originSkill, targetActor, sourceLevel, sourceTech, origin, summary, xp } = ctx;
  const caster = originSkill?.parent;
  if (!isSkillRangeEnabled()) summary.push("Marca: o recurso Alcance e Marcas está desligado");
  else if (!caster) summary.push("Marca: sem quem marcar");
  else if (sameActor(caster, targetActor)) summary.push("Marca: ninguém marca a si mesmo");
  else {
    summary.push(await applyMark(targetActor, caster, { rounds: Math.max(0, Number(entry.durationRounds) || 0), level: sourceLevel, tech: sourceTech, origin }));
    xp.push({ flat: true });
  }
  return HANDLED;
}

/** Dissipar (8d.2): termina só efeitos mágicos do alvo de nível ≤ o da Skill; não suprime nem desliga nada. */
async function handleDispelMagic(entry, ctx) {
  const { targetActor, sourceLevel, summary, xp } = ctx;
  if (targetActor.type !== "character") {
    summary.push(`Dissipar: não se aplica a ${targetActor.name}`);
    return HANDLED;
  }
  const dissipated = await applyDissipate(targetActor, { level: sourceLevel, scope: entry.dispelScope || "all", conditionId: entry.conditionId || "" });
  if (dissipated.length) summary.push(`Dissipar: ${dissipated.join("; ")}`);
  xp.push(...(dissipated.xp ?? []));
  return HANDLED;
}

/**
 * Antimagia (prancha 8) e PEM: cortam, desligam e suprimem — com o nível desta Skill. Camada do
 * tipo oposto (Escudo, ou Estrutura no caminho/em volta) protege o alvo.
 * PEM com o recurso Interferência desligado NÃO é tratado aqui: segue pelo caminho padrão, como sempre.
 */
async function handleAntimagicOrEmp(entry, ctx) {
  if (entry.target === "emp" && !isInterferenceEnabled()) return FALLTHROUGH;
  const { mech, originSkill, targetActor, sourceLevel, summary, xp } = ctx;
  const isEmp = entry.target === "emp";
  if (targetActor.type !== "character" && !(isEmp && isShipLike(targetActor))) {
    summary.push(`${isEmp ? "PEM" : "Antimagia"}: não se aplica a ${targetActor.name}`);
    return HANDLED;
  }
  const structureKinds = protectingStructureKinds(originSkill?.parent ?? null, targetActor, { origin: mech.viaMark?.origin ?? null });
  const dispelled = await (isEmp ? applyEmp : applyAntimagic)(targetActor, { level: sourceLevel, rounds: entry.durationRounds, structureKinds });
  summary.push(...dispelled);
  xp.push(...(dispelled.xp ?? []));
  return HANDLED;
}

/**
 * Curar Vida / Recuperar Mana NA HORA (poção, stimpack, Skill de cura instantânea). "HP"/"Mana"
 * sem Periódico são buff do MÁXIMO, não cura — por isso alvos à parte. A cura respeita os
 * bloqueios de cura e reparte nas Partes do Corpo, como o tick periódico.
 */
async function handleHealOrRestore(entry, ctx, view) {
  const { targetActor, sourceLevel, summary, xp } = ctx;
  const { targetLabel } = view;
  const key = entry.target === "heal" ? "hp" : "energy";
  const attr = targetActor.system?.attributes?.[key];
  if (targetActor.type !== "character" || !attr) {
    summary.push(`${targetLabel}: não se aplica a ${targetActor.name}`);
    return HANDLED;
  }
  const { change, note } = await restoreVital(targetActor, key, Number(entry.amount) || 0, { level: sourceLevel, focusPartId: entry.focusPartId || null });
  if (change) xp.push({ value: change, base: attr.max });
  if (entry.conditionId) xp.push({ flat: true });
  summary.push(`${key === "hp" ? "Vida" : getEffectTargetLabels().energy} ${change >= 0 ? "+" : ""}${change}${note ? ` (${note})` : ""}`);
  return HANDLED;
}

async function handleShield(entry, ctx, view) {
  const { mech, label, originSkill, origin, targetActor, subSkillIndex, summary, xp } = ctx;
  const { targetLabel, sign } = view;
  // Escudo ignora Condição/Periódico/Duração — é sempre somado direto, gasto na mão. Numa
  // Habilidade Ativa com Regeneração ou Teto, vira um Escudo MANTIDO: entra até o teto,
  // regenera a cada turno de quem mantém e some ao desligar (ver sustainedShieldGain).
  if (!targetActor.system.attributes?.shield) {
    summary.push(`${targetLabel}: não se aplica a ${targetActor.name}`);
    return HANDLED;
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
  // XP: Escudo lançado uma vez rende o fixo ao surgir; o de Skill Ativa rende pelo que segurar
  // (no Aplicar do dano, ver creditShieldBlocks em damage-apply.js). Negativo (tirar Escudo) é debuff.
  if (change > 0 && !mech.hasUpkeep) xp.push({ flat: true });
  else if (change < 0) xp.push({ value: change, base: vitalBase(targetActor), buff: true });
  summary.push(sustained ? `Escudo +${change} (mantido${entry.shieldRegen ? `, +${entry.shieldRegen}/rodada` : ""}${entry.shieldCap ? `, teto ${entry.shieldCap}` : ""})` : `Escudo ${sign}${entry.amount}`);
  return HANDLED;
}

/** Alvo de Efeito → `{ stage, run }`. Ver o cabeçalho para os dois estágios. */
export const EFFECT_TARGET_HANDLERS = {
  timeRate: { stage: "pre", run: handleTimeRate },
  mark: { stage: "pre", run: handleMark },
  dispelMagic: { stage: "pre", run: handleDispelMagic },
  antimagic: { stage: "pre", run: handleAntimagicOrEmp },
  emp: { stage: "pre", run: handleAntimagicOrEmp },
  heal: { stage: "post", run: handleHealOrRestore },
  restoreEnergy: { stage: "post", run: handleHealOrRestore },
  shield: { stage: "post", run: handleShield }
};

/** Roda o tratador do alvo se ele é do estágio pedido. Devolve `HANDLED` ou `FALLTHROUGH`. */
export async function runTargetHandler(stage, entry, ctx, view = null) {
  const handler = Object.hasOwn(EFFECT_TARGET_HANDLERS, entry.target) ? EFFECT_TARGET_HANDLERS[entry.target] : null;
  if (!handler || handler.stage !== stage) return FALLTHROUGH;
  return handler.run(entry, ctx, view);
}
