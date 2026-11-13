/**
 * Alcance de Skill, arma e arremesso, e Marcas (backlog H4, 1.89.0) — as contas puras.
 * Nada aqui toca Foundry: distâncias entram prontas (na mesma unidade do alcance) e o ajuste
 * fino (passo do arremesso, etc.) entra como parâmetro. O lado Foundry está em `range.js`.
 *
 *  - `range` 0 = sem limite (tudo salvo antes continua igual).
 *  - Fora do alcance, uma Marca de quem lança (Condição "Marcado") com o alvo dentro do alcance DELA
 *    permite lançar de lá: custo × (distância de quem lança até o Marcado ÷ alcance)².
 */

/** Folga de arredondamento: 10,0 m medido como 10,0000001 ainda está dentro. */
const EPS = 1e-6;

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** O alcance como número ≥ 0 (lixo vira 0 = sem limite). */
export function normalizeRange(range) {
  return Math.max(0, num(range));
}

/** O ponto/alvo a `distance` está dentro do alcance? Alcance 0 = sempre. */
export function inRange(distance, range) {
  const r = normalizeRange(range);
  if (r <= 0) return true;
  return num(distance, Infinity) <= r + EPS;
}

/**
 * Fator do custo de lançar pela Marca: (distância ÷ alcance)², nunca menos que 1 (dentro do alcance
 * o custo é o normal). Sem alcance, 1.
 */
export function markCostFactor(distance, range) {
  const r = normalizeRange(range);
  if (r <= 0) return 1;
  const ratio = Math.max(0, num(distance)) / r;
  const factor = ratio * ratio;
  // Duas casas bastam e evitam 3.9999999999.
  return Math.max(1, Math.round(factor * 100) / 100);
}

/** O custo total pago pela Marca (inteiro, sempre para cima). */
export function markedCost(cost, factor) {
  return Math.ceil(Math.max(0, num(cost)) * Math.max(1, num(factor, 1)) - EPS);
}

/**
 * A forma (círculo/cone/linha) sai livre, posta onde se quiser? `areaOrigin` ausente/null/"free" =
 * livre (o comportamento de antes). "caster" sai de quem lança — e passa a ser livre a partir do
 * nível `areaFreeLevel` (0 = nunca).
 */
export function shapeIsFree({ areaOrigin = null, areaFreeLevel = 0, level = 1 } = {}) {
  if (areaOrigin === null || areaOrigin === undefined || areaOrigin === "" || areaOrigin === "free") return true;
  const from = Math.floor(num(areaFreeLevel));
  return from > 0 && num(level, 1) >= from;
}

/** Alcance de arremesso: base + ⌊Força total ÷ passo⌋ (passo ≥ 1). */
export function throwRange(base, strengthTotal, step = 5) {
  const s = Math.max(1, Math.floor(num(step, 5)) || 1);
  // Mínimo 1 m: alcance 0 quer dizer "sem limite", e um arremesso sempre tem um.
  return Math.max(1, Math.max(0, num(base)) + Math.floor(Math.max(0, num(strengthTotal)) / s));
}

/**
 * Prende um ponto ao círculo de alcance em volta de `center` (mesma unidade). Dentro do círculo
 * devolve o próprio ponto; fora, o ponto da borda na mesma direção. Alcance 0 = não prende.
 * @returns {{x: number, y: number, clamped: boolean}}
 */
export function clampToRange(point, center, range) {
  const r = normalizeRange(range);
  const p = { x: num(point?.x), y: num(point?.y) };
  if (r <= 0 || !center) return { ...p, clamped: false };
  const dx = p.x - num(center.x);
  const dy = p.y - num(center.y);
  const dist = Math.hypot(dx, dy);
  if (dist <= r + EPS) return { ...p, clamped: false };
  const k = r / dist;
  return { x: num(center.x) + dx * k, y: num(center.y) + dy * k, clamped: true };
}

/** Distância entre dois pontos {x, y}. */
export function pointDistance(a, b) {
  return Math.hypot(num(a?.x) - num(b?.x), num(a?.y) - num(b?.y));
}

/**
 * Cone/linha livres: quem está além do alcance de `origin` não sofre. `items` é uma lista de
 * qualquer coisa; `pointOf(item)` dá o ponto. Alcance 0 = ninguém sai.
 */
export function filterByReach(items, origin, range, pointOf = item => item) {
  const r = normalizeRange(range);
  if (r <= 0 || !origin) return [...items];
  return items.filter(item => inRange(pointDistance(origin, pointOf(item)), r));
}

/**
 * Quais Marcas servem a um alvo: as que têm o alvo dentro do alcance (em volta do Marcado).
 * `marks` = `[{uuid, point, name?}]`; `casterPoint` = onde quem lança está. Cada resultado traz o
 * fator do custo (distância de quem lança até a Marca) e vem do mais barato para o mais caro.
 * @returns {Array<{uuid: string, point: object, name?: string, distance: number, factor: number}>}
 */
export function marksReaching(marks, targetPoint, casterPoint, range) {
  const r = normalizeRange(range);
  if (r <= 0 || !targetPoint || !casterPoint) return [];
  return (marks ?? [])
    .filter(m => m?.point && inRange(pointDistance(m.point, targetPoint), r))
    .map(m => {
      const distance = pointDistance(casterPoint, m.point);
      return { ...m, distance, factor: markCostFactor(distance, r) };
    })
    .sort((a, b) => a.factor - b.factor);
}

/**
 * Pôr uma forma/Zona/Estrutura num ponto: dentro do alcance de quem lança → direto; senão, numa
 * Marca cujo círculo contém o ponto → pela Marca (o mais barato); senão, fora (`null`).
 * @returns {{via: null|object}|null}  `{via: null}` direto, `{via: marca}` pela Marca, `null` inválido
 */
export function placementVia(point, casterPoint, marks, range) {
  const r = normalizeRange(range);
  if (r <= 0) return { via: null };
  if (casterPoint && inRange(pointDistance(point, casterPoint), r)) return { via: null };
  const [best] = marksReaching(marks, point, casterPoint, r);
  return best ? { via: best } : null;
}

/** "10 m" / "2,5 m" — o texto de metros para avisos. */
export function meters(value) {
  const n = Math.round(num(value) * 10) / 10;
  return `${String(n).replace(".", ",")} m`;
}

/** A mensagem de recusa por distância. */
export function outOfRangeMessage(distance, range) {
  return `fora do alcance: ${meters(distance)} de ${meters(range)}`;
}

/** Uma Marca ainda vale? (o Ator marcado ainda tem o efeito de quem lança) */
export function markStillValid(effectFlagsList, casterUuid) {
  return (effectFlagsList ?? []).some(flags => flags?.markedBy === casterUuid);
}

/** Alcance de arma de Nave em quadrados → unidades da cena. */
export function shipRangeUnits(cells, gridDistance) {
  return Math.max(0, num(cells)) * Math.max(0, num(gridDistance, 1));
}
