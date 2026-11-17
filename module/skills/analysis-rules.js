/**
 * Análise (7b.1): as contas PURAS (testadas em test/analysis.test.mjs). Sem Foundry, sem imports.
 *
 * margem = nível efetivo da Análise − (nível da ficha do alvo + nível de Ocultação do alvo)
 *          + trunc((Percepção de quem analisa − Furtividade do alvo) ÷ degrau)
 * Análise mágica (inclui tecnomágica) perde nível pela Defesa Mágica do alvo, na mesma % do dano mágico;
 * a tecnológica ignora a Defesa Mágica.
 */

/** O nível da Análise depois da Defesa Mágica do alvo (só se a Análise é mágica). `reduction` é 0–1. */
export function effectiveAnalysisLevel(level, magic, reduction = 0) {
  const base = Math.max(0, Number(level) || 0);
  if (!magic) return base;
  const cut = Math.min(1, Math.max(0, Number(reduction) || 0));
  return Math.floor(base * (1 - cut));
}

/**
 * @param {object} input
 * @param {number} input.level - nível da Skill (ou da Sub-Skill) de Análise
 * @param {boolean} [input.magic] - a Análise é mágica (ou tecnomágica)
 * @param {number} [input.magicDefenseReduction] - 0–1, a redução da Defesa Mágica do alvo
 * @param {number} [input.targetLevel] - `system.attributes.level` do alvo
 * @param {number} [input.concealment] - nível de Ocultação do alvo
 * @param {number} [input.perception] - Percepção.total de quem analisa
 * @param {number} [input.stealth] - Furtividade.total do alvo
 * @param {number} [input.step] - pontos de diferença por degrau (padrão 10)
 */
export function analysisMargin({ level = 0, magic = false, magicDefenseReduction = 0, targetLevel = 0, concealment = 0, perception = 0, stealth = 0, step = 10 } = {}) {
  const effective = effectiveAnalysisLevel(level, magic, magicDefenseReduction);
  const unit = Math.max(1, Math.floor(Number(step) || 10));
  const attrSteps = Math.trunc(((Number(perception) || 0) - (Number(stealth) || 0)) / unit);
  return effective - ((Number(targetLevel) || 0) + (Number(concealment) || 0)) + attrSteps;
}

/** Degrau (0 = nada, 1…5) que a margem alcança: 0, 2, 4, 6, 8. */
export function analysisTier(margin) {
  const m = Number(margin);
  if (!Number.isFinite(m) || m < 0) return 0;
  if (m >= 8) return 5;
  if (m >= 6) return 4;
  if (m >= 4) return 3;
  if (m >= 2) return 2;
  return 1;
}

/** Seções que cada degrau revela (cumulativo). */
export const ANALYSIS_SECTIONS = {
  1: ["origin", "traits", "elements"],
  2: ["vitals", "conditions"],
  3: ["resistances", "weaknesses"],
  4: ["skills"],
  5: ["skillSentences", "attributes"]
};

/** Todas as seções reveladas até o degrau `tier`. */
export function analysisSections(tier) {
  const out = [];
  for (let t = 1; t <= Math.min(5, Math.max(0, Math.floor(Number(tier) || 0))); t++) out.push(...ANALYSIS_SECTIONS[t]);
  return out;
}

/** Rótulo curto do degrau, para o card. */
export function analysisTierLabel(tier) {
  return ["Nada", "Básico", "Estado", "Defesas", "Skills", "Completo"][Math.min(5, Math.max(0, Math.floor(Number(tier) || 0)))];
}

/**
 * Fraquezas: elementos de ataque cuja vantagem contra o corpo do alvo passa de 1.
 * @param {Array<{id: string, factor: number}>} rows - fator de cada elemento do catálogo contra o alvo
 * @returns {Array<{id: string, factor: number}>} do mais forte ao mais fraco
 */
export function weaknessRows(rows = []) {
  return rows.filter(r => Number(r?.factor) > 1).map(r => ({ id: r.id, factor: Number(r.factor) })).sort((a, b) => b.factor - a.factor);
}

/** Resistências efetivas por elemento: só as maiores que 0, do maior para o menor. `percent` é 0–1. */
export function resistanceRows(rows = []) {
  return rows.filter(r => Number(r?.percent) > 0).map(r => ({ id: r.id, percent: Math.min(1, Number(r.percent)) })).sort((a, b) => b.percent - a.percent);
}

/** "Resistência 30%" / "Imunidade" (100% ou mais). */
export function resistanceText(percent) {
  const p = Number(percent) || 0;
  return p >= 1 ? "Imunidade" : `Resistência ${Math.round(p * 100)}%`;
}
