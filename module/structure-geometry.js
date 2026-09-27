/**
 * Geometria pura das Estruturas (parede de pedra, bloco de gelo, barreira de mana…): transforma
 * a forma posicionada no mapa nos segmentos de Parede que o Foundry vai criar, respeitando o
 * tamanho máximo da Estrutura. Sem canvas nem Documento — testado em test/rules.test.mjs.
 *
 * Unidades: pontos em pixels da cena; `sizePx` já convertido de metros pelo chamador
 * (tamanho ÷ grid.distance × grid.size).
 */

/** Comprimento de uma polilinha. */
export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < (points?.length ?? 0); i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

/**
 * Corta uma polilinha no comprimento máximo: o último trecho é encurtado até caber. É o mesmo
 * "para no limite" do deslocamento — o traçado não passa do que a Estrutura permite.
 */
export function capPolyline(points, maxLength) {
  const pts = (points ?? []).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 2 || !(maxLength > 0)) return pts.slice(0, 1);
  const out = [pts[0]];
  let left = maxLength;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = out[out.length - 1];
    const [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len <= left) {
      out.push([bx, by]);
      left -= len;
      continue;
    }
    if (left > 0) out.push([ax + ((bx - ax) * left) / len, ay + ((by - ay) * left) / len]);
    break;
  }
  return out;
}

/** Segmentos `[x1, y1, x2, y2]` de uma polilinha aberta. */
export function polylineSegments(points) {
  const segments = [];
  for (let i = 1; i < points.length; i++) {
    segments.push([points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]].map(n => Math.round(n) || 0));
  }
  return segments.filter(([x1, y1, x2, y2]) => x1 !== x2 || y1 !== y2);
}

/**
 * Segmentos de Parede de uma Estrutura.
 * @param {"line"|"free"|"circle"|"rect"} shape
 * @param {Array<[number,number]>} points - linha/livre: o traçado; círculo/quadrado: `[centro]`
 * @param {number} sizePx - comprimento máximo (linha/livre), raio (círculo) ou lado (quadrado)
 * @param {number} [sides=16] - lados do polígono que aproxima o círculo
 */
export function structureSegments(shape, points, sizePx, sides = 16) {
  if (shape === "line" || shape === "free") {
    const pts = shape === "line" ? (points ?? []).slice(0, 2) : points;
    return polylineSegments(capPolyline(pts, sizePx));
  }
  const center = points?.[0];
  if (!center || !(sizePx > 0)) return [];
  const [cx, cy] = center;
  if (shape === "circle") {
    const ring = [];
    for (let i = 0; i <= sides; i++) {
      const angle = (i / sides) * Math.PI * 2;
      ring.push([cx + Math.cos(angle) * sizePx, cy + Math.sin(angle) * sizePx]);
    }
    return polylineSegments(ring);
  }
  if (shape === "rect") {
    const h = sizePx / 2;
    return polylineSegments([[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h], [cx - h, cy - h]]);
  }
  return [];
}

/**
 * `count` pontos espalhados por igual ao longo de uma linha quebrada (no meio de cada trecho de
 * mesmo comprimento) — onde vão as luzes de uma parede longa, pra ela brilhar inteira em vez de
 * ter um ponto de luz só no meio.
 * @param {Array<[number, number]>} points
 * @param {number} count
 * @returns {Array<[number, number]>}
 */
export function pointsAlongPolyline(points, count) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  if (!points?.length) return [];
  if (points.length === 1) return [[Math.round(points[0][0]) || 0, Math.round(points[0][1]) || 0]];
  const total = polylineLength(points);
  const result = [];
  for (let i = 0; i < n; i++) {
    let target = total * ((i + 0.5) / n);
    for (let k = 1; k < points.length; k++) {
      const [x1, y1] = points[k - 1];
      const [x2, y2] = points[k];
      const seg = Math.hypot(x2 - x1, y2 - y1);
      if (target <= seg || k === points.length - 1) {
        const t = seg ? Math.min(1, target / seg) : 0;
        result.push([Math.round(x1 + (x2 - x1) * t) || 0, Math.round(y1 + (y2 - y1) * t) || 0]);
        break;
      }
      target -= seg;
    }
  }
  return result;
}

/**
 * Onde (0–1) o caminho `from → to` cruza o segmento `[x1, y1, x2, y2]`, ou `null` se não cruza.
 * Encostar exatamente na ponta conta como cruzar (tiro rente à quina bate na parede).
 */
export function segmentCrossing(from, to, [x1, y1, x2, y2]) {
  const [px, py] = from;
  const rx = to[0] - px;
  const ry = to[1] - py;
  const sx = x2 - x1;
  const sy = y2 - y1;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null; // paralelos (ou colineares): não é atravessar
  const t = ((x1 - px) * sy - (y1 - py) * sx) / denom;
  const u = ((x1 - px) * ry - (y1 - py) * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

/**
 * A primeira Estrutura no caminho de um ataque (a mais perto de quem ataca), ou `null`.
 * Quem está do MESMO lado de uma forma fechada que o alvo não é bloqueado — o caminho não cruza
 * nenhum segmento dela.
 * @param {[number, number]} from - centro de quem ataca (ou a origem da área)
 * @param {[number, number]} to - centro do alvo
 * @param {{id: string, segments: number[][]}[]} structures
 * @returns {{id: string, t: number}|null}
 */
export function firstStructureOnPath(from, to, structures) {
  let best = null;
  for (const structure of structures ?? []) {
    for (const segment of structure.segments ?? []) {
      const t = segmentCrossing(from, to, segment);
      if (t !== null && (!best || t < best.t)) best = { id: structure.id, t };
    }
  }
  return best;
}

/** Quanto a Estrutura segura de um golpe (até a capacidade dela) e quanto passa pra frente. */
export function splitStructureHit(amount, capacity) {
  const total = Math.max(0, Math.round(Number(amount) || 0));
  const absorbed = Math.min(total, Math.max(0, Math.round(Number(capacity) || 0)));
  return { absorbed, passed: total - absorbed };
}
