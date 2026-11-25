/**
 * Tamanho das áreas por nível e o ajuste na hora de usar (1.118.0). Puro e testado.
 *
 * **Regra:** tamanho efetivo (m) = base + "+ por nível" × (nível − 1). A base é `areaDistance` numa Emissão ou
 * Zona e o tamanho do catálogo (`structure.size`) numa Estrutura; o "+ por nível" é o campo `areaPerLevel` da
 * Skill/Sub-Skill. Nível 1 = a base; nível menor que 1 conta como 1. O tamanho efetivo é o **máximo** daquele
 * nível: na hora de pôr a área quem usa pode diminuir (Ctrl+roda, de 1 m até o máximo) e o tamanho escolhido
 * é o que vale — o custo não muda.
 */

/** Menor tamanho que o ajuste na colocação aceita (m). */
export const MIN_AREA_SIZE = 1;

const num = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Arredonda para centésimos (evita 2.9999999 de somas decimais como 0,5 por nível). */
const clean = value => Math.round(value * 100) / 100;

/**
 * O tamanho efetivo (m) de uma área no nível dado.
 * @param {{base:number, perLevel?:number, level?:number}} input
 */
export function effectiveAreaSize({ base = 0, perLevel = 0, level = 1 } = {}) {
  const lv = Math.max(1, Math.floor(num(level)) || 1);
  return Math.max(0, clean(num(base) + Math.max(0, num(perLevel)) * (lv - 1)));
}

/** O tamanho efetivo de uma Emissão/Zona a partir dos campos da Skill (`areaDistance`, `areaPerLevel`, `level`). */
export function mechAreaSize(mech) {
  return effectiveAreaSize({ base: mech?.areaDistance, perLevel: mech?.areaPerLevel, level: mech?.level });
}

/** O tamanho efetivo de uma Estrutura: o do catálogo + o "+ por nível" da Skill que a ergue. */
export function structureAreaSize(catalogSize, mech) {
  return effectiveAreaSize({ base: catalogSize, perLevel: mech?.areaPerLevel, level: mech?.level });
}

/**
 * O tamanho escolhido na colocação, preso entre 1 m e o máximo do nível (máximo menor que 1 m = o próprio
 * máximo). Sem escolha (`null`/inválido) vale o máximo.
 */
export function clampAreaSize(size, max) {
  const top = Math.max(0, num(max));
  if (top <= 0) return 0;
  if (size === null || size === undefined || size === "" || !Number.isFinite(Number(size))) return top;
  return clean(Math.min(top, Math.max(Math.min(MIN_AREA_SIZE, top), num(size))));
}

/** Um passo do Ctrl+roda: roda para cima (deltaY < 0) aumenta 1 m, para baixo diminui, preso em [1, máximo]. */
export function stepAreaSize(current, deltaY, max) {
  const direction = -Math.sign(num(deltaY));
  return clampAreaSize(num(current) + direction, max);
}

const meters = value => String(clean(num(value))).replace(".", ",");

/** "4 / 6 m". */
export function areaSizeLabel(size, max) {
  return `${meters(size)} / ${meters(max)} m`;
}

/**
 * A barra de dica da colocação: "Ctrl+roda: tamanho 4 / 6 m · Roda: gira (Cone/Linha) · Clique: confirma · Esc: cancela".
 * `turn` = a forma gira com a roda (cone e linha); `extras` = pedaços a mais (forma presa em quem lança, Marca…).
 */
export function placementHintText({ size, max, turn = false, extras = [] } = {}) {
  const parts = [];
  if (num(max) > MIN_AREA_SIZE) parts.push(`Ctrl+roda: tamanho ${areaSizeLabel(size, max)}`);
  if (turn) parts.push("Roda: gira (Cone/Linha)");
  parts.push("Clique: confirma", "Esc: cancela");
  return [...parts, ...extras.filter(Boolean)].join(" · ");
}

/** "+1 m por nível" (vazio quando a área não cresce). */
export function perLevelText(perLevel) {
  const n = clean(num(perLevel));
  return n > 0 ? `+${meters(n)} m por nível` : "";
}
