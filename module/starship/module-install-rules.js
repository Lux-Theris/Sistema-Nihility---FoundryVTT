/**
 * Regras puras de instalação de Módulo em Nave/Veículo (sem Foundry): recebem números já
 * prontos e devolvem o veredito, com o que a mensagem de recusa precisa. Quem junta os dados do
 * Ator/Item e mostra o aviso é `module-install.js`.
 */

/**
 * Compatibilidade de Porte: o Módulo cabe se o Porte dele for igual ou menor ao da Nave.
 * Um `moduleRank` desconhecido (undefined) não cabe — a comparação é falsa, como sempre foi.
 * @param {{moduleRank: number, vesselRank: number}} p
 * @returns {boolean}
 */
export function moduleSizeFits({ moduleRank, vesselRank }) {
  return moduleRank <= vesselRank;
}

/**
 * Vagas por Categoria: `limit` 0 (ou ausente) é "sem limite"; senão ainda há vaga se
 * `used < limit`.
 * @param {{used: number, limit: number}} p
 * @returns {{ok: boolean, used: number, limit: number}}
 */
export function categorySlotCheck({ used, limit }) {
  if (!limit) return { ok: true, used, limit };
  return { ok: used < limit, used, limit };
}

/**
 * Espaço de Arma: primeiro o Porte máximo de Arma da Classe (`maxRank` indefinido = sem teto),
 * depois o orçamento do casco (`budget` não finito = sem limite). Cada Arma consome
 * `rank + 1` unidades; `thisUnit` é a desta e `usedByOthers` a soma das outras.
 * @param {{thisUnit: number, usedByOthers: number, budget: number, moduleRank: number, maxRank?: number}} p
 * @returns {{ok: boolean, reason: ("classMax"|"budget"|null), total?: number, budget?: number}}
 */
export function weaponBudgetCheck({ thisUnit, usedByOthers, budget, moduleRank, maxRank }) {
  if (maxRank !== undefined && moduleRank > maxRank) return { ok: false, reason: "classMax" };
  if (!Number.isFinite(budget)) return { ok: true, reason: null };
  const total = usedByOthers + thisUnit;
  if (total <= budget) return { ok: true, reason: null, total, budget };
  return { ok: false, reason: "budget", total, budget };
}
