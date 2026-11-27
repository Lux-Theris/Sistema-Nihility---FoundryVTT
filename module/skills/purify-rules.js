/**
 * Purificar (1.123.0), regras puras e testadas (`test/magic-pieces.test.mjs`).
 *
 * Efeito de Skill (alvo `purify`): tira do alvo as **Condições** de nível até o da Skill, mágicas ou não (o contrário
 * do Dissipar, que só alcança o mágico, e do Antimagia, que suprime). Buff e debuff numéricos sem Condição não são
 * Condições e ficam. Tira também o contador de exposição da Resistência a Condição (1.119.0) das Condições que saíram,
 * para a próxima exposição começar do zero.
 *
 * O que NUNCA se purifica, porque não é "mal" que a Skill cura: Caído/Inconsciente (a Vida 0 tem o seu fluxo),
 * a Marca de quem usa, Parado no tempo, Irradiado e os efeitos de ritmo do tempo. A quantidade do efeito é o máximo de
 * Condições a tirar (0 = todas); com uma Condição escolhida no efeito, só ela.
 */

/** Flags de Active Effect que a Purificação não toca. */
export const PURIFY_PROTECTED_FLAGS = ["incapacitation", "markedBy", "timeStop", "radiation", "timeRate", "timeRewind", "scry", "drainId"];

/**
 * Este efeito (`{conditionId, sourceLevel, flags...}`) pode ser tirado por uma Purificação de nível `level`?
 * @param {{conditionId?: string, sourceLevel?: number, protectedFlag?: boolean}} effect
 */
export function isPurifiable(effect, level) {
  if (!effect?.conditionId) return false;
  if (effect.protectedFlag) return false;
  return (Number(effect.sourceLevel) || 0) <= Math.max(0, Number(level) || 0);
}

/**
 * Quais efeitos tirar: os purificáveis, os de maior nível primeiro (e, no empate, a ordem da lista), até `max`
 * (0 = todos). `conditionId` não vazio restringe a essa Condição.
 * @param {Array<{id:string, conditionId?:string, sourceLevel?:number, protectedFlag?:boolean}>} effects
 * @param {{level?: number, max?: number, conditionId?: string}} options
 * @returns {string[]} ids dos efeitos a tirar
 */
export function pickPurified(effects, { level = 0, max = 0, conditionId = "" } = {}) {
  const list = (effects ?? [])
    .map((e, order) => ({ e, order }))
    .filter(({ e }) => isPurifiable(e, level) && (!conditionId || e.conditionId === conditionId))
    .sort((a, b) => (Number(b.e.sourceLevel) || 0) - (Number(a.e.sourceLevel) || 0) || a.order - b.order)
    .map(({ e }) => e.id);
  const cap = Math.max(0, Math.floor(Number(max) || 0));
  return cap > 0 ? list.slice(0, cap) : list;
}

/** Condições (ids, sem repetir) cujo contador de exposição zera: as dos efeitos que saíram. */
export function exposureToClear(removed) {
  return [...new Set((removed ?? []).map(e => e?.conditionId).filter(Boolean))];
}

/** "Purificar nível 5, até 2 Condições" para a frase da Skill (sem verbo): "purifica Condições até o nível 5". */
export function purifySentence({ max = 0, conditionLabel = "", level = 0 } = {}) {
  const what = conditionLabel ? conditionLabel : Number(max) > 0 ? `até ${Math.floor(max)} Condição(ões)` : "as Condições";
  return `purifica ${what}${level > 0 ? ` (até o nível ${level})` : ""}`;
}

/** A linha do resultado: "Purificou: Veneno, Cegueira" ou "Nada a purificar". */
export function purifyResultText(names, { blockedByLevel = 0 } = {}) {
  const list = (names ?? []).filter(Boolean);
  if (list.length) return `Purificou: ${list.join(", ")}`;
  return blockedByLevel > 0 ? `Nada purificado (${blockedByLevel} Condição(ões) forte(s) demais para esta Skill)` : "Nada a purificar";
}
