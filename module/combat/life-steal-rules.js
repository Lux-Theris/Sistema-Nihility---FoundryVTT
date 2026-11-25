/**
 * Roubo de vida (1.119.0), regras puras e testadas (`test/condition-resist.test.mjs`).
 *
 * O efeito de dano de uma Skill, Sub-Skill ou arma pessoal ganha "Cura quem usa (% do dano)". A cura sai quando o
 * Mestre clica **Aplicar** no card de dano, sobre o que realmente entrou na **Vida** do alvo (depois de resistências,
 * fraquezas e Escudo: o que o Escudo absorveu não conta), e o Desfazer do card desfaz a cura junto. Em área, cada alvo
 * aplicado cura a própria parte (a soma, com arredondamento por alvo).
 */

/** Teto do campo (% do dano). */
export const MAX_LIFE_STEAL = 100;

/** O percentual guardado: inteiro de 0 a 100. */
export function normalizeLifeSteal(value) {
  const n = Math.round(Number(value) || 0);
  return Math.min(MAX_LIFE_STEAL, Math.max(0, n));
}

/** Quanto cura: o percentual do que entrou na Vida (inteiro; nada entrou, nada cura). */
export function lifeStealAmount(toHp, percent) {
  const p = normalizeLifeSteal(percent);
  const base = Math.max(0, Math.round(Number(toHp) || 0));
  return p > 0 && base > 0 ? Math.round((base * p) / 100) : 0;
}

/** "Cura quem usa: 50% do dano que entrou". */
export function lifeStealNote(percent) {
  return `Cura quem usa: ${normalizeLifeSteal(percent)}% do dano que entrou`;
}

/** O resultado no card: "+4 Vida em Kaito" (ou por que não curou). */
export function lifeStealResultText({ healed = 0, healerName = "", requested = 0 } = {}) {
  if (healed > 0) return `+${healed} Vida em ${healerName}`;
  if (requested > 0) return `${healerName} não recuperou Vida (cura bloqueada ou Vida cheia)`;
  return "";
}
