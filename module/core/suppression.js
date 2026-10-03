/**
 * Supressão por Antimagia (prancha 8) — o que a preparação da ficha e os coletores de bônus
 * consultam. Módulo leve de propósito (só config + regras puras): a ficha o importa sem puxar a
 * cadeia de efeitos/Skills.
 *
 * Enquanto o Ator tem a Condição "Suprimido (Antimagia)" de nível N: Skill mágica de nível ≤ N
 * (inclusive Resistências e passivos; Racial só se for mágica — ver skillIsMagic), Item Geral e
 * implante marcados Mágico param de contar. Título, Espécie e partes naturais nunca.
 */
import { SYSTEM_ID } from "./config.js";
import { skillIsMagic, isSuppressedBy } from "./magic-rules.js";

export const SUPPRESSION_FLAG = "suppression";

/** Nível de supressão ativo no Ator (null = nenhuma). */
export function suppressionLevel(actor) {
  let level = null;
  for (const e of actor?.effects ?? []) {
    if (e.disabled) continue;
    const value = e.flags?.[SYSTEM_ID]?.[SUPPRESSION_FLAG];
    if (value === undefined || value === null) continue;
    level = Math.max(level ?? 0, Number(value) || 0);
  }
  return level;
}

/**
 * Esta fonte de bônus está suprimida agora? `mod` = uma modificação/implante de Parte do Corpo.
 * @param {Actor} actor
 * @param {Item} item - Skill, Item Geral ou Parte do Corpo
 * @param {object|null} [mod]
 * @param {number|null} [level] - nível de supressão (calculado se não vier)
 */
export function sourceSuppressed(actor, item, mod = null, level = undefined) {
  const suppression = level === undefined ? suppressionLevel(actor) : level;
  if (suppression === null) return false;
  if (mod) return Boolean(mod.magic) && isSuppressedBy(0, suppression);
  if (item?.type === "skill") return skillIsMagic(item.system) && isSuppressedBy(item.system.level, suppression);
  if (item?.type === "item") return Boolean(item.system?.magic) && isSuppressedBy(0, suppression);
  return false;
}
