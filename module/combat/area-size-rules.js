/**
 * Tamanho das áreas por nível e o ajuste na hora de usar (1.118.0). Puro e testado.
 *
 * **Regra:** tamanho efetivo (m) = base + "+ por nível" × (nível − 1). A base é `areaDistance` numa Emissão ou
 * Zona e o tamanho do catálogo (`structure.size`) numa Estrutura; o "+ por nível" é o campo `areaPerLevel` da
 * Skill/Sub-Skill. Nível 1 = a base; nível menor que 1 conta como 1. Esse é o tamanho **padrão** do nível.
 *
 * **Concentração (1.119.0):** na hora de pôr a área quem usa muda o tamanho (Ctrl+roda, 1 m de cada vez) e isso troca
 * tamanho por potência, **sem custo** (nem para aumentar nem para diminuir): cada metro a menos que o padrão vale
 * +1 nível efetivo do efeito, cada metro a mais, −1. O máximo é o tamanho em que o nível efetivo chega a 1:
 * `min(5 × o padrão, padrão + (nível − 1) m)`; o mínimo é 1 m; o nível efetivo nunca fica abaixo de 1. O nível
 * efetivo vale para o efeito daquela área (o nível do campo numa Antimagia/Interferência; o Poder do nível no dano,
 * na cura e nos efeitos); o custo continua o do nível real.
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

/**
 * O tamanho padrão de uma Estrutura: o "Raio base" da própria Skill (`structureSize`, 1.119.0) quando preenchido, senão o
 * do catálogo, mais o "+ por nível" × (nível − 1).
 */
export function structureAreaSize(catalogSize, mech) {
  const own = num(mech?.structureSize);
  return effectiveAreaSize({ base: own > 0 ? own : catalogSize, perLevel: mech?.areaPerLevel, level: mech?.level });
}

/**
 * O tamanho escolhido na colocação, preso entre 1 m e `max` (máximo menor que 1 m = o próprio máximo). Sem escolha
 * (`null`/inválido) vale `fallback` (o máximo, por omissão; a concentração usa `resolveAreaSize`).
 */
export function clampAreaSize(size, max, fallback = max) {
  const top = Math.max(0, num(max));
  if (top <= 0) return 0;
  if (size === null || size === undefined || size === "" || !Number.isFinite(Number(size))) return clean(Math.min(top, Math.max(0, num(fallback))));
  return clean(Math.min(top, Math.max(Math.min(MIN_AREA_SIZE, top), num(size))));
}

/** Um passo do Ctrl+roda: roda para cima (deltaY < 0) aumenta 1 m, para baixo diminui, preso em [1, máximo]. */
export function stepAreaSize(current, deltaY, max) {
  const direction = -Math.sign(num(deltaY));
  return clampAreaSize(num(current) + direction, max);
}

const meters = value => String(clean(num(value))).replace(".", ",");

/** O tamanho máximo de uma área de tamanho padrão `defaultSize` no nível `level`: onde o nível efetivo chega a 1. */
export function areaMaxSize(defaultSize, level = 1) {
  const def = Math.max(0, num(defaultSize));
  const lv = Math.max(1, Math.floor(num(level)) || 1);
  return clean(Math.max(def, Math.min(def * 5, def + (lv - 1))));
}

/** Quantos níveis o tamanho escolhido vale: +1 por metro a menos que o padrão, −1 por metro a mais. */
export function areaLevelShift(defaultSize, size) {
  return Math.round(num(defaultSize) - num(size));
}

/**
 * Tudo da concentração de uma área: tamanho padrão, máximo, o tamanho escolhido (preso entre o mínimo e o máximo; sem
 * escolha vale o padrão), o desvio de nível e o nível efetivo (nunca abaixo de 1). Pura; o cliente a usa para mostrar e
 * o Mestre a refaz na ficha para valer.
 * @param {{base:number, perLevel?:number, level?:number, size?:number|null}} input
 * @returns {{defaultSize:number, maxSize:number, minSize:number, size:number, shift:number, level:number, effectiveLevel:number}}
 */
export function resolveAreaSize({ base = 0, perLevel = 0, level = 1, size = null } = {}) {
  const lv = Math.max(1, Math.floor(num(level)) || 1);
  const defaultSize = effectiveAreaSize({ base, perLevel, level: lv });
  if (defaultSize <= 0) return { defaultSize: 0, maxSize: 0, minSize: 0, size: 0, shift: 0, level: lv, effectiveLevel: lv };
  const maxSize = areaMaxSize(defaultSize, lv);
  const minSize = Math.min(MIN_AREA_SIZE, defaultSize);
  const chosen = size === null || size === undefined || size === "" || !Number.isFinite(Number(size)) ? defaultSize : clean(Math.min(maxSize, Math.max(minSize, num(size))));
  const shift = areaLevelShift(defaultSize, chosen);
  return { defaultSize, maxSize, minSize, size: chosen, shift, level: lv, effectiveLevel: Math.max(1, lv + shift) };
}

/** A concentração de uma Emissão/Zona a partir dos campos da Skill e do tamanho escolhido. */
export function resolveMechArea(mech, size = null) {
  return resolveAreaSize({ base: mech?.areaDistance, perLevel: mech?.areaPerLevel, level: mech?.level, size });
}

/** O mesmo para uma Estrutura (o tamanho do catálogo é substituído pelo "Raio base" da Skill quando preenchido). */
export function resolveStructureArea(catalogSize, mech, size = null) {
  const own = num(mech?.structureSize);
  return resolveAreaSize({ base: own > 0 ? own : catalogSize, perLevel: mech?.areaPerLevel, level: mech?.level, size });
}

/** O nível de um campo (Antimagia/Interferência) depois da concentração: o do catálogo + o desvio, nunca abaixo de 1 (0 = não é campo). */
export function fieldLevelWithShift(catalogLevel, shift) {
  const base = Math.max(0, Math.round(num(catalogLevel)));
  return base > 0 ? Math.max(1, base + Math.round(num(shift))) : 0;
}

/**
 * A nota do editor: "Padrão no nível 4: 6 m. Na hora de usar vai de 1 m até 9 m…" (quadro 8). `span` vem de
 * `resolveAreaSize`/`resolveMechArea`/`resolveStructureArea`; vazio quando a área não existe.
 */
export function concentrationNote(span) {
  if (!span || !(num(span.defaultSize) > 0)) return "";
  const lead = `Padrão no nível ${span.level}: ${meters(span.defaultSize)} m.`;
  if (!(num(span.maxSize) > MIN_AREA_SIZE)) return lead;
  return `${lead} Na hora de usar vai de ${meters(span.minSize)} m até ${meters(span.maxSize)} m (onde o nível do efeito chega a 1), sem custo: cada metro a menos que o padrão é +1 nível do efeito, cada metro a mais é −1.`;
}

const signed = n => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "");

/** "4 / 6 m". */
export function areaSizeLabel(size, max) {
  return `${meters(size)} / ${meters(max)} m`;
}

/**
 * A barra de dica da colocação (quadro 8 do mockup aprovado):
 * "Ctrl+roda: tamanho 2 m (padrão 6, máx. 9) · nível do efeito 8 (+4) · sem custo · Roda: gira (Cone/Linha) · Clique: confirma · Esc: cancela".
 * `turn` = a forma gira com a roda (cone e linha); `extras` = pedaços a mais (forma presa em quem lança, Marca…).
 * Sem `def` (colocação sem concentração) mostra só "tamanho 4 / 6 m". `levelWord` troca "efeito" por "campo".
 */
export function placementHintText({ size, max, def = null, level = null, effLevel = null, levelWord = "efeito", turn = false, extras = [] } = {}) {
  const parts = [];
  if (num(max) > MIN_AREA_SIZE) {
    if (def === null) parts.push(`Ctrl+roda: tamanho ${areaSizeLabel(size, max)}`);
    else {
      let text = `Ctrl+roda: tamanho ${meters(size)} m (padrão ${meters(def)}, máx. ${meters(max)})`;
      if (level !== null && effLevel !== null) {
        const delta = effLevel - level;
        text += ` · nível do ${levelWord} ${effLevel}${delta ? ` (${signed(delta)})` : ""}`;
      }
      parts.push(`${text} · sem custo`);
    }
  }
  if (turn) parts.push("Roda: gira (Cone/Linha)");
  parts.push("Clique: confirma", "Esc: cancela");
  return [...parts, ...extras.filter(Boolean)].join(" · ");
}

/** "+1 m por nível" (vazio quando a área não cresce). */
export function perLevelText(perLevel) {
  const n = clean(num(perLevel));
  return n > 0 ? `+${meters(n)} m por nível` : "";
}
