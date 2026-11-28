/**
 * Supressão por Antimagia (prancha 8) — o que a preparação da ficha e os coletores de bônus
 * consultam. Módulo leve de propósito (só config + regras puras): a ficha o importa sem puxar a
 * cadeia de efeitos/Skills.
 *
 * O PEM é o espelho: a Condição "Suprimido (Tecnologia)" (flag `techSuppression`) segura Skill
 * tecnológica, Item Geral, implante e prótese marcados Tecnológico (e o aparelho do PAD). As duas
 * Supressões são independentes; tecnomágico sofre as duas.
 *
 * Enquanto o Ator tem a Condição "Suprimido (Antimagia)" de nível N: Skill mágica de nível ≤ N
 * (inclusive Resistências e passivos; Racial só se for mágica — ver skillIsMagic), Item Geral e
 * implante marcados Mágico param de contar. Título, Espécie e partes naturais nunca.
 */
import { SYSTEM_ID } from "./config.js";
import { skillIsMagic, skillIsTech, itemIsTech, itemIsMagic, isSuppressedBy } from "./magic-rules.js";

export const SUPPRESSION_FLAG = "suppression";
export const TECH_SUPPRESSION_FLAG = "techSuppression";

function maxFlag(actor, flag) {
  let level = null;
  for (const e of actor?.effects ?? []) {
    if (e.disabled) continue;
    const value = e.flags?.[SYSTEM_ID]?.[flag];
    if (value === undefined || value === null) continue;
    level = Math.max(level ?? 0, Number(value) || 0);
  }
  return level;
}

/** Nível de supressão (Antimagia) ativo no Ator (null = nenhuma). */
export function suppressionLevel(actor) {
  return maxFlag(actor, SUPPRESSION_FLAG);
}

/** Nível de supressão tecnológica (PEM) ativo no Ator (null = nenhuma). */
export function techSuppressionLevel(actor) {
  return maxFlag(actor, TECH_SUPPRESSION_FLAG);
}

/** As duas supressões do Ator de uma vez: `{magic, tech}` (null = nenhuma). */
export function suppressionState(actor) {
  return { magic: suppressionLevel(actor), tech: techSuppressionLevel(actor) };
}

/**
 * Esta fonte de bônus está suprimida agora? `mod` = uma modificação/implante de Parte do Corpo.
 * @param {Actor} actor
 * @param {Item} item - Skill, Item Geral ou Parte do Corpo
 * @param {object|null} [mod]
 * @param {{magic:number|null, tech:number|null}|number|null} [state] - de suppressionState (calculado
 *   se não vier); um número/null é lido como só a supressão mágica (chamadas antigas) e a
 *   tecnológica é calculada do Ator.
 */
export function sourceSuppressed(actor, item, mod = null, state = undefined) {
  let s = state;
  if (s === undefined) s = suppressionState(actor);
  else if (s === null || typeof s === "number") s = { magic: s, tech: techSuppressionLevel(actor) };
  if (s.magic === null && s.tech === null) return false;
  const magicHit = (flag, level) => flag && isSuppressedBy(level, s.magic);
  const techHit = (flag, level) => flag && isSuppressedBy(level, s.tech);
  if (mod) return Boolean(magicHit(mod.magic, 0) || techHit(mod.tech, 0));
  if (item?.type === "skill") {
    const level = item.system.level;
    return Boolean(magicHit(skillIsMagic(item.system), level) || techHit(skillIsTech(item.system), level));
  }
  if (item?.type === "item") return Boolean(magicHit(itemIsMagic(item.system), 0) || techHit(itemIsTech(item.system), 0));
  return false;
}
