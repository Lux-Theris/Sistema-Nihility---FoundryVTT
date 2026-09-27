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
