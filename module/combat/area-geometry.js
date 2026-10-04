/**
 * Geometria das áreas de Skill (Emissão e Zona), pura e testada.
 *
 * Existe porque a V14 removeu os Measured Templates (o documento e a camada `canvas.templates`):
 * antes, quem decidia "este Token está dentro?" era o `shape` do template. Agora a área é um
 * objeto simples em pixels de cena — `{shape, x, y, radius, angle, direction, width}` — e tudo
 * (prévia, alvos, Zona persistente) lê só isto, em qualquer versão. Só o documento que a Zona
 * deixa na cena muda por versão (Template na V13, Region na V14 — ver `zoneDocumentData`).
 *
 * Convenções (as mesmas do Measured Template, para a migração não girar nada):
 *  - coordenadas do canvas, y para baixo;
 *  - `direction` em graus, 0 = para a direita (leste), crescendo no sentido horário na tela;
 *  - `radius` = alcance (raio do círculo/cone, comprimento da linha), em pixels;
 *  - cone redondo (setor), linha = retângulo de largura `width` centrado no eixo.
 */

export const AREA_SHAPES = ["circle", "cone", "ray"];

const EPSILON = 1e-6;

const toRad = deg => (deg * Math.PI) / 180;

/** Diferença angular em graus, em [0, 180]. */
function angleGap(a, b) {
  const d = (((a - b) % 360) + 540) % 360 - 180;
  return Math.abs(d);
}

/**
 * Monta a área a partir dos campos da Skill (`areaShape`/`areaDistance`/`areaAngle`).
 * @param {{areaShape:string, areaDistance:number, areaAngle?:number}} mech
 * @param {{x:number, y:number}} origin - ponto em pixels
 * @param {{pxPerUnit:number, cellPx:number, direction?:number}} grid - px por metro (unidade da cena) e tamanho da célula
 */
export function areaFromSkill(mech, origin, { pxPerUnit, cellPx, direction = 0 }) {
  const shape = mech?.areaShape;
  if (!AREA_SHAPES.includes(shape)) throw new Error(`Formato de Área inválido: "${shape}".`);
  return normalizeArea({
    shape,
    x: origin.x,
    y: origin.y,
    radius: (Number(mech.areaDistance) || 0) * (Number(pxPerUnit) || 1),
    angle: shape === "cone" ? Number(mech.areaAngle) || 53 : 0,
    direction,
    width: shape === "ray" ? Number(cellPx) || 100 : 0
  });
}

/**
 * Área com os números limpos e limitados — o relay passa a área de um cliente para o Mestre,
 * então isto também é a validação do payload. Devolve null se a forma não existe.
 */
export function normalizeArea(area) {
  if (!area || !AREA_SHAPES.includes(area.shape)) return null;
  const num = (v, min, max, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
  };
  const direction = (((Number(area.direction) || 0) % 360) + 360) % 360;
  return {
    shape: area.shape,
    x: num(area.x, -1e6, 1e6),
    y: num(area.y, -1e6, 1e6),
    radius: num(area.radius, 0, 1e6),
    angle: area.shape === "cone" ? num(area.angle, 1, 360, 53) : 0,
    direction,
    width: area.shape === "ray" ? num(area.width, 1, 1e5, 100) : 0
  };
}

/**
 * O ponto está dentro da área? Borda conta como dentro. O vértice do cone e o começo da linha
 * (o ponto exato de onde a área sai) não contam — é ali que fica quem lança, e um Sopro não
 * atinge a própria boca.
 */
export function areaContains(area, point) {
  if (!area || !point) return false;
  const dx = point.x - area.x;
  const dy = point.y - area.y;
  const dist = Math.hypot(dx, dy);

  if (area.shape === "circle") return dist <= area.radius + EPSILON;

  if (dist < EPSILON) return false;

  if (area.shape === "cone") {
    if (dist > area.radius + EPSILON) return false;
    if (area.angle >= 360) return true;
    const pointAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
    return angleGap(pointAngle, area.direction) <= area.angle / 2 + EPSILON;
  }

  if (area.shape === "ray") {
    const ux = Math.cos(toRad(area.direction));
    const uy = Math.sin(toRad(area.direction));
    const along = dx * ux + dy * uy;
    const across = Math.abs(-dx * uy + dy * ux);
    return along >= -EPSILON && along <= area.radius + EPSILON && across <= area.width / 2 + EPSILON;
  }

  return false;
}

/**
 * Contorno da área como lista plana `[x0, y0, x1, y1, …]` em pixels — para desenhar a prévia e
 * para a Region da V14 (cone e linha viram polígono: a forma desenhada é exatamente a que
 * `areaContains` testa, sem depender de como a versão interpreta um cone nativo).
 * Círculo também sai como polígono aqui; quem puder desenhar um círculo de verdade deve preferir.
 */
export function areaPolygon(area, steps = 32) {
  if (!area) return [];
  const { x, y, radius, direction } = area;

  if (area.shape === "circle" || (area.shape === "cone" && area.angle >= 360)) {
    const pts = [];
    for (let i = 0; i < steps; i++) {
      const a = (2 * Math.PI * i) / steps;
      pts.push(x + radius * Math.cos(a), y + radius * Math.sin(a));
    }
    return pts.map(round2);
  }

  if (area.shape === "cone") {
    const half = area.angle / 2;
    const arcSteps = Math.max(2, Math.ceil((steps * area.angle) / 360));
    const pts = [x, y];
    for (let i = 0; i <= arcSteps; i++) {
      const a = toRad(direction - half + (area.angle * i) / arcSteps);
      pts.push(x + radius * Math.cos(a), y + radius * Math.sin(a));
    }
    return pts.map(round2);
  }

  if (area.shape === "ray") {
    const ux = Math.cos(toRad(direction));
    const uy = Math.sin(toRad(direction));
    const px = -uy * (area.width / 2);
    const py = ux * (area.width / 2);
    const ex = x + ux * radius;
    const ey = y + uy * radius;
    return [x + px, y + py, ex + px, ey + py, ex - px, ey - py, x - px, y - py].map(round2);
  }

  return [];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Centro de um Token a partir só do documento (x/y no canto, largura/altura em células). */
export function tokenDocCenter(tokenDoc, gridSize) {
  const size = Number(gridSize) || 100;
  return {
    x: (Number(tokenDoc?.x) || 0) + ((Number(tokenDoc?.width) || 1) * size) / 2,
    y: (Number(tokenDoc?.y) || 0) + ((Number(tokenDoc?.height) || 1) * size) / 2
  };
}

/**
 * Área de um Measured Template salvo (Zonas criadas na V13 antes desta versão, sem `area` no
 * flag). Template guarda alcance/largura em unidades da cena; aqui volta para pixels.
 */
export function areaFromTemplateData(data, pxPerUnit) {
  const t = data?.t;
  const shape = t === "rect" ? null : t;
  if (!AREA_SHAPES.includes(shape)) return null;
  const k = Number(pxPerUnit) || 1;
  return normalizeArea({
    shape,
    x: data.x,
    y: data.y,
    radius: (Number(data.distance) || 0) * k,
    angle: data.angle,
    direction: data.direction,
    width: (Number(data.width) || 1) * k
  });
}

/**
 * Dados do documento que a Zona deixa na cena, pela versão: V14 → `Region` (o tipo
 * MeasuredTemplate não existe mais), V13 → `MeasuredTemplate` (Region da V13 não tem cone e a
 * rota antiga já funcionava). A área em si viaja no flag — é dela que o sistema lê "quem está
 * dentro", nunca do documento.
 * @returns {{documentName: "Region"|"MeasuredTemplate", data: object}}
 */
export function zoneDocumentData(area, { generation, pxPerUnit, color, name, flags, visibility }) {
  if (generation >= 14) {
    const shapes =
      area.shape === "circle"
        ? [{ type: "circle", x: area.x, y: area.y, radius: area.radius }]
        : [{ type: "polygon", points: areaPolygon(area) }];
    return {
      documentName: "Region",
      data: { name, color, shapes, behaviors: [], visibility, flags }
    };
  }
  const k = Number(pxPerUnit) || 1;
  return {
    documentName: "MeasuredTemplate",
    data: {
      t: area.shape,
      x: area.x,
      y: area.y,
      direction: area.direction,
      distance: area.radius / k,
      angle: area.shape === "cone" ? area.angle : 53,
      width: area.shape === "ray" ? area.width / k : 1,
      fillColor: color,
      flags
    }
  };
}
