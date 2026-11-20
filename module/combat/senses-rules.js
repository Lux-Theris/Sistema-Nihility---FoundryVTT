/**
 * Sentidos e visibilidade (J4b) — as contas puras. O lado Foundry está em `senses.js`.
 *
 * Quatro sentidos, cada um é um modo de detecção do Token do Foundry (V14):
 *   senseTremor → feelTremor (sentido sísmico), senseInvisible → seeInvisibility (ver o invisível),
 *   senseTrue → seeAll (visão verdadeira), senseAll → senseAll (sentir tudo).
 * O alcance é em metros (unidade da cena); 0 ou menos = sem limite (guardado como um número grande
 * finito, nunca Infinity, que não vai para dentro de um Active Effect).
 */

/** Alvo de Efeito/Passivo → id do modo de detecção do Foundry. */
export const SENSE_MODES = Object.freeze({
  senseTremor: "feelTremor",
  senseInvisible: "seeInvisibility",
  senseTrue: "seeAll",
  senseAll: "senseAll"
});

export const SENSE_TARGETS = Object.freeze(Object.keys(SENSE_MODES));

export const SENSE_LABELS = Object.freeze({
  senseTremor: "Sentido sísmico",
  senseInvisible: "Ver o invisível",
  senseTrue: "Visão verdadeira",
  senseAll: "Sentir tudo"
});

/** "Sem limite" como número finito. */
export const SENSE_UNLIMITED = 1e6;

export function isSenseTarget(target) {
  return Object.prototype.hasOwnProperty.call(SENSE_MODES, target);
}

/** Alcance gravado no Token: ≤ 0 (ou lixo) = sem limite. */
export function senseRangeValue(amount) {
  const n = Number(amount);
  return Number.isFinite(n) && n > 0 ? n : SENSE_UNLIMITED;
}

/** "10 m" ou "sem limite". */
export function describeSenseRange(range) {
  const n = Number(range);
  return !Number.isFinite(n) || n <= 0 || n >= SENSE_UNLIMITED ? "sem limite" : `${Math.round(n * 100) / 100} m`;
}

/** Chave de Active Effect do modo (`token.` = muda o Token do Ator, V14). */
export function senseChangeKeys(target) {
  const mode = SENSE_MODES[target];
  if (!mode) return null;
  return { range: `token.detectionModes.${mode}.range`, enabled: `token.detectionModes.${mode}.enabled` };
}

/** Descreve uma chave `token.detectionModes.<modo>.<campo>` ("Sentido sísmico 10 m"), ou null. */
export function describeSenseChange(key, value) {
  const match = /^token\.detectionModes\.([A-Za-z]+)\.(range|enabled)$/.exec(String(key ?? ""));
  if (!match) return null;
  const target = SENSE_TARGETS.find(t => SENSE_MODES[t] === match[1]);
  const label = target ? SENSE_LABELS[target] : match[1];
  if (match[2] === "enabled") return `${label} (ligado)`;
  return `${label} ${describeSenseRange(value)}`;
}

/** Lista de sentidos de uma origem, só com modos válidos; o melhor alcance por modo (0 = sem limite). */
export function normalizeSenses(list) {
  const best = new Map();
  for (const s of Array.isArray(list) ? list : []) {
    if (!isSenseTarget(s?.mode)) continue;
    const range = Math.max(0, Number(s.range) || 0);
    const prev = best.get(s.mode);
    if (prev === undefined || senseRangeValue(range) > senseRangeValue(prev)) best.set(s.mode, range);
  }
  return [...best].map(([mode, range]) => ({ mode, range }));
}

/**
 * O melhor alcance por modo de detecção entre as camadas de origem (Espécie → Linhagem → Heranças).
 * @returns {Object<string, number>} modo do Foundry → alcance finito (sem limite = SENSE_UNLIMITED)
 */
export function originSenses(layers) {
  const out = {};
  for (const layer of layers ?? []) {
    for (const s of normalizeSenses(layer?.passives?.senses)) {
      const mode = SENSE_MODES[s.mode];
      out[mode] = Math.max(out[mode] ?? 0, senseRangeValue(s.range));
    }
  }
  return out;
}

/** Linhas para a UI ("Sentido sísmico 10 m (Espécie: X)"). */
export function originSenseRows(layers) {
  const rows = [];
  for (const layer of layers ?? []) {
    for (const s of normalizeSenses(layer?.passives?.senses)) {
      rows.push({ label: `${layer.kindLabel}: ${layer.label}`, sense: SENSE_LABELS[s.mode], range: describeSenseRange(s.range), mode: s.mode });
    }
  }
  return rows;
}

/**
 * Debaixo da terra conta como "escavando" e no ar como "voando" para o Foundry (sem gravar nada).
 * @returns {{burrow: boolean, fly: boolean}}
 */
export function groundStatuses({ elevation, elevationOn, sensesOn }) {
  if (!elevationOn || !sensesOn) return { burrow: false, fly: false };
  const e = Number(elevation) || 0;
  return { burrow: e < 0, fly: e > 0 };
}

/** O Token está escondido por um sentido (debaixo da terra ou invisível)? */
export function isHiddenBySense({ burrow = false, invisible = false } = {}) {
  return Boolean(burrow || invisible);
}

/** "No mapa" válido de uma Condição: "", "invisible" ou "blind". */
export function normalizeMapStatus(value) {
  return value === "invisible" || value === "blind" ? value : "";
}

/** O catálogo salvo ganha `mapStatus` dos padrões de fábrica só quando o campo falta (como `explanation`). */
export function fillMapStatus(condition, defaults) {
  if (!condition || condition.mapStatus !== undefined) return condition;
  const fallback = defaults?.[condition.id]?.mapStatus;
  return fallback ? { ...condition, mapStatus: fallback } : condition;
}

/**
 * Os status do core a acrescentar a um efeito, pelas Condições do catálogo que ele já traz.
 * @param {string[]} statuses - `effect.statuses`
 * @param {Array<{id:string, mapStatus?:string}>} catalog
 * @returns {string[]} ids a acrescentar (sem repetir o que o efeito já tem)
 */
export function mapStatusesToAdd(statuses, catalog) {
  const have = new Set(statuses ?? []);
  const out = [];
  for (const id of have) {
    const status = normalizeMapStatus((catalog ?? []).find(c => c.id === id)?.mapStatus);
    if (status && !have.has(status) && !out.includes(status)) out.push(status);
  }
  return out;
}

/**
 * Deve o combatente aparecer na lista de quem NÃO é o dono? (só quem está escondido por sentido some)
 * @param {object} input
 * @param {boolean} input.base - o `visible` do core
 * @param {boolean} input.isGM
 * @param {boolean} input.enabled - feature ligada
 * @param {boolean} input.isOwner
 * @param {boolean} input.onCanvasScene - o Token está na cena aberta
 * @param {boolean} input.tokenVision - a cena usa Visão de Token
 * @param {boolean} input.hiddenBySense
 * @param {boolean|undefined} input.tokenVisible - o `visible` do Token no mapa
 */
export function combatantVisibleFor({ base, isGM, enabled, isOwner, onCanvasScene, tokenVision, hiddenBySense, tokenVisible }) {
  // Dono, 20/11: some da lista quem o jogador não vê nem sente (fora da linha de visão também), não só
  // quem se esconde por sentido. `hiddenBySense` fica no contrato (quem chama ainda manda), mas não decide mais.
  if (isGM || !enabled || !base || isOwner || !onCanvasScene || !tokenVision) return base;
  return tokenVisible ?? base;
}

/** Os ids que mudaram de visibilidade (para saber se a lista precisa redesenhar). */
export function visibleSetChanged(previous, next) {
  const a = new Set(previous ?? []);
  const b = new Set(next ?? []);
  if (a.size !== b.size) return true;
  for (const id of a) if (!b.has(id)) return true;
  return false;
}

/**
 * Seletor de alvo: tira da lista de "Na cena" quem o personagem não percebe. Quem chama marca
 * `perceived` (false = o Token não está visível para o usuário); `self` e quem não tem Token na cena
 * aberta ficam sempre.
 * @param {Array<{perceived?: boolean, self?: boolean, onScene?: boolean}>} candidates
 */
export function filterPerceived(candidates, { isGM, enabled, tokenVision }) {
  if (isGM || !enabled || !tokenVision) return candidates;
  return candidates.filter(c => c.self || c.onScene === false || c.perceived !== false);
}
