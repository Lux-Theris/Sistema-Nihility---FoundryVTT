/**
 * Empurrar/puxar (J1) e voo/altura/escavação (J4) — as contas puras, testadas em
 * `test/forced-movement.test.mjs`. O lado Foundry (mover Token, rolar, cards) fica em
 * `forced-movement.js` e `elevation.js`; aqui nada toca Ator, Token nem canvas.
 *
 * Unidades: METROS = unidade da cena (`grid.distance`); pixels só onde o nome diz. Elevação em metros.
 */

export const PUSH_DIRECTIONS = ["push", "pull", "choose"];

/** Quantos metros de altura ainda contam como "corpo a corpo" (alcance 0 = a mão). */
export const MELEE_VERTICAL_REACH = 1.5;
/** Queda de até estes metros não machuca. */
export const SAFE_FALL_METERS = 3;

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** "push" | "pull" | "choose"; qualquer outra coisa vira "push" (o padrão). */
export function normalizePushDirection(value) {
  return PUSH_DIRECTIONS.includes(value) ? value : "push";
}

/**
 * Metros que sobram depois das defesas do alvo, antes do teste de Defesa:
 * metros → Skill mágica × (1 − redução da Defesa Mágica) → elemento × (1 − Resistência encadeada)
 * → Traço imune = 0. Frações (0.3 = 30%); Resistência ≥ 1 imuniza.
 * @param {{meters:number, magical?:boolean, magicDefense?:number, elementResistance?:number, immune?:boolean}} args
 */
export function effectivePushMeters({ meters, magical = false, magicDefense = 0, elementResistance = 0, immune = false } = {}) {
  const base = Math.max(0, num(meters));
  if (immune || base <= 0) return 0;
  let result = base;
  if (magical) result *= 1 - Math.min(1, Math.max(0, num(magicDefense)));
  const resistance = Math.min(1, Math.max(0, num(elementResistance)));
  result *= 1 - resistance;
  return Math.max(0, Math.round(result * 100) / 100);
}

/** Resistência média (frações) de um conjunto de elementos: cada elemento pesa igual, como o dano dividido. */
export function averageResistance(resistances = []) {
  const list = (resistances ?? []).map(r => Math.min(1, Math.max(0, num(r))));
  return list.length ? list.reduce((sum, r) => sum + r, 0) / list.length : 0;
}

/**
 * Atributos do teste: quem empurra rola Magia (mágico), ou o atributo de escala da arma, ou Força;
 * o alvo rola Defesa. Devolve as CHAVES de atributo de combate.
 * @param {{magical?:boolean, scalingAttribute?:string}} args
 */
export function pushContestAttributes({ magical = false, scalingAttribute = "" } = {}) {
  return { pusher: magical ? "magic" : scalingAttribute || "strength", defender: "defense" };
}

/**
 * O teste: o alvo vence só se tirar MAIS que quem empurra (empate fica com quem empurra).
 * Quem vence é empurrado só metade dos metros.
 */
export function pushContest({ pusherTotal, defenderTotal } = {}) {
  const defenderWins = num(defenderTotal) > num(pusherTotal);
  return { defenderWins };
}

/** Metros finais: o alvo que venceu o teste anda metade. */
export function metersAfterContest(meters, defenderWins) {
  const base = Math.max(0, num(meters));
  return defenderWins ? Math.round((base / 2) * 100) / 100 : base;
}

/**
 * Destino (centro do Token, em pixels) de um empurrão em linha reta.
 *  - empurrar: para longe da origem; puxar: em direção a ela e SEM passar dela (pára nela);
 *  - sobre a origem (distância 0) não há direção: não se move.
 * @param {{origin:{x:number,y:number}, target:{x:number,y:number}, meters:number, direction:"push"|"pull", pxPerUnit:number}} args
 * @returns {{x:number, y:number, meters:number}} `meters` = quanto realmente anda (puxar é limitado pela distância)
 */
export function pushDestination({ origin, target, meters, direction = "push", pxPerUnit = 1 } = {}) {
  const scale = Math.max(1e-6, num(pxPerUnit, 1));
  const dx = num(target?.x) - num(origin?.x);
  const dy = num(target?.y) - num(origin?.y);
  const dist = Math.hypot(dx, dy);
  const wanted = Math.max(0, num(meters));
  if (dist < 1e-6 || wanted <= 0) return { x: num(target?.x), y: num(target?.y), meters: 0 };
  const distMeters = dist / scale;
  const moved = direction === "pull" ? Math.min(wanted, distMeters) : wanted;
  const sign = direction === "pull" ? -1 : 1;
  const ux = dx / dist;
  const uy = dy / dist;
  return {
    x: num(target.x) + sign * ux * moved * scale,
    y: num(target.y) + sign * uy * moved * scale,
    meters: moved
  };
}

/** Onde (0–1) o caminho `from → to` cruza o segmento `[x1, y1, x2, y2]`, ou `null`. Paralelos não contam. */
function crossing(from, to, [x1, y1, x2, y2]) {
  const rx = to.x - from.x;
  const ry = to.y - from.y;
  const sx = x2 - x1;
  const sy = y2 - y1;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((x1 - from.x) * sy - (y1 - from.y) * sx) / denom;
  const u = ((x1 - from.x) * ry - (y1 - from.y) * rx) / denom;
  return t < 0 || t > 1 || u < 0 || u > 1 ? null : t;
}

/**
 * Até onde o centro do Token chega em linha reta de `from` a `to` (pixels) antes da primeira parede,
 * parando rente a ela (recua `radiusPx`, a meia largura do Token, para o corpo não entrar na parede).
 * Só as paredes cortam o caminho; Tokens no meio não param ninguém.
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @param {Array<{id?:string, segment:number[], tag?:any}>} walls - `segment` = [x1, y1, x2, y2]
 * @param {number} [radiusPx]
 * @returns {{point:{x:number,y:number}, traveledPx:number, hit:object|null}}
 */
export function pathStop(from, to, walls = [], radiusPx = 0) {
  const length = Math.hypot(num(to?.x) - num(from?.x), num(to?.y) - num(from?.y));
  let best = null;
  for (const wall of walls ?? []) {
    const t = crossing(from, to, wall.segment);
    if (t !== null && (!best || t < best.t)) best = { t, wall };
  }
  if (!best || length < 1e-9) return { point: { x: num(to?.x), y: num(to?.y) }, traveledPx: length, hit: null };
  // O corpo (quadrado de meia largura `radiusPx`) encosta na parede antes do centro chegar nela: a folga ao longo do
  // caminho é a meia largura projetada na normal da parede ÷ o cosseno do ângulo (reta perpendicular: só a meia largura).
  const [wx1, wy1, wx2, wy2] = best.wall.segment.map(Number);
  const wallLen = Math.hypot(wx2 - wx1, wy2 - wy1) || 1;
  const nx = -(wy2 - wy1) / wallLen;
  const ny = (wx2 - wx1) / wallLen;
  const cos = Math.max(0.2, Math.abs(((num(to.x) - num(from.x)) / length) * nx + ((num(to.y) - num(from.y)) / length) * ny));
  const r = Math.max(0, num(radiusPx));
  const retreat = (r * (Math.abs(nx) + Math.abs(ny))) / cos;
  const traveledPx = Math.max(0, best.t * length - retreat);
  const k = traveledPx / length;
  return {
    point: { x: num(from.x) + (num(to.x) - num(from.x)) * k, y: num(from.y) + (num(to.y) - num(from.y)) * k },
    traveledPx,
    hit: best.wall
  };
}

/** Metros que sobraram ao bater: o pretendido menos o que andou de fato (nunca negativo). */
export function leftoverMeters(intended, moved) {
  const left = num(intended) - num(moved);
  return left > 0.05 ? Math.round(left * 100) / 100 : 0;
}

/** Dano de impacto: sobra × % da Vida máxima de quem bateu. Arredonda; 0 sem sobra. */
export function impactDamage({ leftover, maxHp, percent }) {
  const left = Math.max(0, num(leftover));
  if (!left) return 0;
  return Math.max(0, Math.round(left * (Math.max(0, num(percent)) / 100) * Math.max(0, num(maxHp))));
}

/** Dano de queda: (metros − 3) × % da Vida máxima; queda até 3 m não machuca. */
export function fallDamage({ meters, maxHp, percent, safe = SAFE_FALL_METERS }) {
  const over = Math.max(0, num(meters) - num(safe, SAFE_FALL_METERS));
  if (!over) return 0;
  return Math.max(0, Math.round(over * (Math.max(0, num(percent)) / 100) * Math.max(0, num(maxHp))));
}

/* ------------------------------------------------------------------ Voo, altura, escavação */

/** Distância 3D (hipotenusa) entre a distância no plano e a diferença de elevação, na mesma unidade. */
export function distance3d(planar, elevationDelta = 0) {
  return Math.hypot(num(planar), num(elevationDelta));
}

/**
 * Próxima elevação pedida pelos botões ↑/↓ do Token HUD, ou `null` se não pode.
 *  - ↑: quem voa sobe sem teto; quem só cava sobe até 0 e pára;
 *  - ↓: quem cava desce sem piso; quem só voa desce até 0 e pára.
 * @param {{current:number, direction:"up"|"down", step:number, canFly:boolean, canBurrow:boolean}} args
 */
export function stepElevation({ current, direction, step, canFly = false, canBurrow = false } = {}) {
  const now = num(current);
  const size = Math.max(0, num(step));
  if (!size) return null;
  if (direction === "up") {
    const next = now + size;
    if (next <= 0) return canFly || canBurrow || now < 0 ? next : null;
    if (canFly) return next;
    // Sem voo: só até a superfície, e só se estava embaixo dela.
    return now < 0 ? 0 : null;
  }
  if (direction === "down") {
    const next = now - size;
    if (next >= 0) return canFly || canBurrow || now > 0 ? next : null;
    if (canBurrow) return next;
    // Sem escavar: só até a superfície, e só se estava no ar.
    return now > 0 ? 0 : null;
  }
  return null;
}

/**
 * Situação de quem está fora do chão sem poder: caindo (no ar, sem voo) ou soterrado (embaixo, sem cavar).
 * @returns {{falling:boolean, buried:boolean}}
 */
export function groundState({ elevation, canFly = false, canBurrow = false } = {}) {
  const e = num(elevation);
  return { falling: e > 0 && !canFly, buried: e < 0 && !canBurrow };
}

/** Aviso (texto) quando alguém põe a elevação à mão sem poder; `null` = nada a avisar. */
export function manualElevationWarning({ name = "O Token", elevation, canFly = false, canBurrow = false } = {}) {
  const state = groundState({ elevation, canFly, canBurrow });
  if (state.falling) return `${name} está a ${trim(elevation)} m de altura e não pode voar.`;
  if (state.buried) return `${name} está a ${trim(Math.abs(num(elevation)))} m debaixo da terra e não pode cavar.`;
  return null;
}

/** Quem está debaixo da terra (elevação < 0) não é alcançado por quem está na superfície ou no ar. */
export function hiddenUnderground(sourceElevation, targetElevation) {
  return num(targetElevation) < 0 && num(sourceElevation) >= 0;
}

/** Corpo a corpo (alcance 0) contra alvo mais alto/baixo que o alcance da mão: só avisa. */
export function meleeOutOfVerticalReach({ range = 0, sourceElevation = 0, targetElevation = 0, reach = MELEE_VERTICAL_REACH } = {}) {
  if (num(range) > 0) return false;
  return Math.abs(num(targetElevation) - num(sourceElevation)) > reach + 1e-6;
}

/* ------------------------------------------------------------------ Áreas em 3D */

/**
 * O alvo, já dentro da forma NO PLANO, também está dentro em 3D? Círculo = esfera: a distância 3D
 * ao centro cabe no raio; cone e linha: a distância 3D até o vértice cabe no comprimento. Quem está
 * debaixo da terra, com a área na superfície ou no ar, não é atingido.
 * @param {{shape:string, radiusUnits:number, planarUnits:number, areaElevation:number, targetElevation:number}} args
 */
export function areaReaches3d({ shape, radiusUnits, planarUnits, areaElevation = 0, targetElevation = 0 } = {}) {
  if (hiddenUnderground(areaElevation, targetElevation)) return false;
  const full = distance3d(planarUnits, num(targetElevation) - num(areaElevation));
  const limit = num(radiusUnits);
  if (shape === "circle" || shape === "cone" || shape === "ray") return full <= limit + 1e-6;
  return false;
}

function trim(value) {
  return String(Math.round(num(value) * 10) / 10).replace(".", ",");
}

/** Aviso de Deslocamento gasto: "Deslocamento desta rodada gasto: 6 de 7 m". Pura. */
export function movementSpentText(used, allowance) {
  const fmt = value => String(Math.round(num(value) * 10) / 10).replace(".", ",");
  return `Deslocamento desta rodada gasto: ${fmt(used)} de ${fmt(allowance)} m`;
}

/** Já passou o intervalo mínimo desde o último aviso? (agora/último em ms). Pura. */
export function shouldNotifyAgain(now, last, minGapMs = 4000) {
  return !Number.isFinite(last) || num(now) - num(last) >= minGapMs;
}
