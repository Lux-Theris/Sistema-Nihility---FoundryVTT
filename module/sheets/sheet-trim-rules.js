/**
 * Ficha do jogador só com o que ele usa (backlog K3; canvas "Ferramentas da Mesa", prancha 2).
 * Puro e testado (test/table-tools.test.mjs).
 *
 * Um bloco vazio que o jogador não enche sozinho (Títulos, Pontos de Habilidade, moedas, nada
 * equipado, aba Anatomia sem partes) some para o JOGADOR — volta sozinho quando a primeira coisa
 * chega, e "mostrar" abre tudo. O Mestre vê sempre, com o bloco marcado "o jogador não vê".
 * Atributos, Habilidades, Vida/Mana, Inventário e Biografia nunca somem.
 */

/** Os blocos que podem sumir, na ordem da ficha. */
export const TRIM_BLOCKS = ["titles", "skillPoints", "gear", "economy", "anatomy"];

/**
 * @param {{isGM: boolean, showAll?: boolean, empty: Record<string, boolean>}} input
 *   `empty`: bloco → está vazio? (só os que estão LIGADOS na campanha entram)
 * @returns {Record<string, {hide: boolean, gmEmpty: boolean}> & {hiddenCount: number, emptyCount: number, showAll: boolean}}
 */
export function sheetTrim({ isGM, showAll = false, empty = {} }) {
  const out = { hiddenCount: 0, emptyCount: 0, showAll: Boolean(showAll) && !isGM };
  for (const key of TRIM_BLOCKS) {
    const isEmpty = Boolean(empty[key]);
    const hide = isEmpty && !isGM && !showAll;
    out[key] = { hide, gmEmpty: isEmpty && Boolean(isGM) };
    if (hide) out.hiddenCount += 1;
    if (isEmpty) out.emptyCount += 1;
  }
  return out;
}

/** Os Pontos de Habilidade estão todos zerados? */
export function allZero(record) {
  return Object.values(record ?? {}).every(value => !(Number(value) > 0));
}

/**
 * As faixas de Tier do bloco Habilidades: o jogador só vê as que têm Skill (o mockup mostra a
 * lista sem faixas vazias); o Mestre e o "mostrar" veem todas. Sem nenhuma Skill, nenhuma faixa —
 * o bloco Habilidades em si nunca some.
 * @param {string[]} tiers - os Tiers visíveis, em ordem
 * @param {Record<string, number>} counts - Tier → quantas Skills
 */
export function shownSkillTiers(tiers, counts, { isGM = false, showAll = false } = {}) {
  if (isGM || showAll) return [...tiers];
  return tiers.filter(tier => (counts?.[tier] ?? 0) > 0);
}
