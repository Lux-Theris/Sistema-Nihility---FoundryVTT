/**
 * Manipulação do espaço (8f, lotes 1 e 2): as contas puras do efeito "Espaço" (Saltar e Trocar), da Âncora e da
 * Interdição de Naves. Sem Foundry; o lado Foundry (escolher o ponto, pedir ao Mestre, ler Condição/Estrutura/Região)
 * fica em `space.js`. Testado em test/space.test.mjs.
 *
 * O desenho do dono (22/11, `temp/ideias-novos-sistemas.md` "8f" e "Respostas do dono ao 8e/8f"):
 *  - Efeito de Skill "Espaço" com modos: **Saltar** (teleporte de si ou de um aliado a um ponto dentro do alcance da
 *    Skill, ou até uma Marca), **Trocar** (dois Tokens trocam de lugar), **Portal** (par de Regiões com o "Teleport
 *    Token" do core, com duração; lote 3), **Bolso** (o contêiner concedido por Skill com 100% de redução e espaços
 *    pelo nível; lote 4) e **Domínio** (Região que prende quem está dentro, com ritmo de tempo próprio opcional; lote 5).
 *  - A Skill com efeito de Espaço tem a marca **"espacial"** (derivada do efeito, como a "mágica" é derivada do custo): é o
 *    que as âncoras leem.
 *  - **Âncora** bloqueia o espacial como a Antimagia bloqueia o mágico: o teleporte que começa ou termina numa Âncora, ou
 *    de quem está Ancorado, falha com aviso e **nada é gasto**.
 *  - **Interdição** (Naves) reaproveita a conta, mas é outra coisa no jogo: um Módulo tecnológico que impede o salto FTL.
 */
import { pathStop } from "./forced-movement-rules.js";
import { inRange, pointDistance } from "./range-rules.js";

export const SPACE_TARGET = "space";

/** O id da Condição "Preso" (Domínio, 8f lote 5) no catálogo de fábrica. */
export const PRESO_CONDITION_ID = "trapped";

/** Os modos do efeito. `live` = o editor mostra e o uso funciona (os cinco, desde o lote 5). */
export const SPACE_MODES = [
  { id: "jump", label: "Saltar", live: true, hint: "Quem usa (ou um aliado) aparece num ponto dentro do alcance da Skill, sem passar pelo caminho." },
  { id: "swap", label: "Trocar", live: true, hint: "O alvo e quem usa (ou outro Token à escolha) trocam de lugar." },
  { id: "portal", label: "Portal", live: true, hint: "Abre um par de Regiões que se levam uma à outra, nos dois sentidos, pela duração. Pode ligar duas cenas." },
  { id: "pocket", label: "Bolso", live: true, hint: "Dá a quem tem a Skill um contêiner sem peso, com espaços que crescem pelo nível." },
  { id: "domain", label: "Domínio", live: true, hint: "Uma área onde quem está dentro não sai, com ritmo de tempo próprio (opcional)." }
];

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** O modo como id conhecido (lixo vira "jump"). */
export function normalizeSpaceMode(mode) {
  return SPACE_MODES.some(m => m.id === mode) ? mode : "jump";
}

/** Só os modos que o editor mostra neste lote. */
export function liveSpaceModes() {
  return SPACE_MODES.filter(m => m.live);
}

export function spaceModeLabel(mode) {
  return SPACE_MODES.find(m => m.id === normalizeSpaceMode(mode))?.label ?? "Saltar";
}

/** O modo funciona neste lote? */
export function spaceModeIsLive(mode) {
  return SPACE_MODES.find(m => m.id === mode)?.live === true;
}

/** Os efeitos "Espaço" de uma mecânica, com o índice na lista (o Mestre acha o mesmo efeito pelo índice). */
export function spaceEntriesOf(mech) {
  return (mech?.effects ?? [])
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry?.target === SPACE_TARGET);
}

/** A Skill é "espacial" (as âncoras a leem)? Hoje: tem um efeito de Espaço. */
export function skillIsSpatial(mech) {
  return spaceEntriesOf(mech).length > 0;
}

/** A Skill teleporta (Saltar, Trocar ou Portal)? É o que dá a quem a tem o direito de escapar de um Domínio. O Bolso e o Domínio em si não contam. */
export function skillTeleports(mech) {
  return spaceEntriesOf(mech).some(({ entry }) => ["jump", "swap", "portal"].includes(normalizeSpaceMode(entry?.spaceMode)));
}

/* ------------------------------------------------------------------ Geometria */

/** Centro (pixels) de um Token dado pelo canto e o tamanho. */
export function centerOf({ x, y, w, h }) {
  return { x: num(x) + num(w) / 2, y: num(y) + num(h) / 2 };
}

/** O canto (x, y do documento) de um Token de tamanho `w`×`h` cujo centro vai a `center`. */
export function cornerFor(center, { w, h }) {
  return { x: Math.round(num(center?.x) - num(w) / 2), y: Math.round(num(center?.y) - num(h) / 2) };
}

/**
 * Trocar: cada Token vai para onde o outro está (centro no centro), cada um com o próprio tamanho. A elevação NÃO
 * troca (cada um mantém a sua; é o que `tokenElevation()` preserva).
 * @param {{x:number,y:number,w:number,h:number}} a - canto e tamanho em pixels
 * @param {{x:number,y:number,w:number,h:number}} b
 * @returns {{a:{x:number,y:number}, b:{x:number,y:number}}}
 */
export function swapDestinations(a, b) {
  return { a: cornerFor(centerOf(b), a), b: cornerFor(centerOf(a), b) };
}

/** O caminho em linha reta de `from` a `to` cruza alguma parede? (só vale quando a Skill respeita paredes) */
export function pathCrossesWalls(from, to, walls = []) {
  return pathStop(from, to, walls, 0).hit !== null;
}

/* ------------------------------------------------------------------ Alcance */

/**
 * Saltar: o ponto está no alcance? `distance` em metros do centro de quem usa; alcance 0 = sem limite. Pela Marca o
 * alcance conta em volta do Marcado (quem chama já resolveu isso com `placementVia`).
 */
export function jumpInRange(distance, range) {
  return inRange(distance, range);
}

/**
 * Trocar: quem precisa estar no alcance de quem usa. Quem usa não conta (ele é a origem); os outros, sim.
 * `others` = distâncias em metros (ou `null` quando não deu para medir: sem Token, não confere).
 * @returns {{ok:boolean, farthest:number}}
 */
export function swapInRange(others, range) {
  const list = (others ?? []).filter(d => d !== null && d !== undefined).map(d => num(d, Infinity));
  const farthest = list.length ? Math.max(...list) : 0;
  return { ok: list.every(d => inRange(d, range)), farthest };
}

/* ------------------------------------------------------------------ Âncora */

/**
 * Uma fonte de Âncora (`level`) segura um teleporte da Skill de nível `skillLevel`? A Âncora vence quando o nível dela é
 * igual ou maior que o da Skill (a Skill precisa ser mais forte para furar). Decisão do Claude, a confirmar.
 */
export function anchorHolds(anchorLevel, skillLevel) {
  const a = Math.floor(num(anchorLevel));
  return a > 0 && a >= Math.max(1, Math.floor(num(skillLevel, 1)));
}

/**
 * O teleporte passa pelas Âncoras? `endpoints` = cada ponta de cada Token movido:
 * `{name, role: "origin"|"destination", sources: [{kind: "condition"|"structure"|"region", level, label?}]}`.
 * Devolve a primeira ponta presa (a de maior nível) ou `{blocked: false}`.
 * @param {{skillLevel:number, endpoints:Array<object>}} args
 * @returns {{blocked:boolean, endpoint?:object, source?:object}}
 */
export function anchorVerdict({ skillLevel = 1, endpoints = [] } = {}) {
  let best = null;
  for (const endpoint of endpoints) {
    for (const source of endpoint?.sources ?? []) {
      if (!anchorHolds(source?.level, skillLevel)) continue;
      if (!best || num(source.level) > num(best.source.level)) best = { endpoint, source };
    }
  }
  return best ? { blocked: true, endpoint: best.endpoint, source: best.source } : { blocked: false };
}

/** O motivo de uma ponta presa, em pt-BR ("Gruk está dentro de uma Âncora (nível 8)"). */
export function anchorReason({ endpoint, source }) {
  const level = Math.floor(num(source?.level));
  const who = endpoint?.name || "Alguém";
  const thing = source?.label ? `${source.label} (nível ${level})` : `uma Âncora (nível ${level})`;
  if (source?.kind === "condition") return `${who} está Ancorado (nível ${level})`;
  if (endpoint?.role === "destination") return `o ponto de chegada de ${who} está dentro de ${thing}`;
  return `${who} está dentro de ${thing}`;
}

/** A frase do aviso na tela. Sem energia no texto de propósito (a energia não tem gênero fixo). */
export function anchorBlockText(label, verdict) {
  return `${label} não sai: ${anchorReason(verdict)}. Nada foi gasto.`;
}

/* ------------------------------------------------------------------ Interdição de Naves */

/**
 * Quem interdita a Nave: cada fonte `{name, range, point}` (alcance em unidades da cena, ponto em pixels) cujo círculo
 * contém `point`. Do mais perto ao mais longe.
 * @param {{point:{x:number,y:number}, sources:Array<object>, pxPerUnit:number}} args
 * @returns {Array<{name:string, distance:number, range:number}>}
 */
export function interdictors({ point, sources = [], pxPerUnit = 1 } = {}) {
  const scale = Math.max(1e-9, num(pxPerUnit, 1));
  return (sources ?? [])
    .map(source => ({ name: String(source?.name ?? "Interditor"), range: num(source?.range), distance: pointDistance(point, source?.point) / scale }))
    .filter(s => s.range > 0 && s.distance <= s.range + 1e-6)
    .sort((a, b) => a.distance - b.distance);
}

/** "Interditada por X (a 12 m, alcance 20 m): o salto FTL não carrega." */
export function interdictionText(shipName, list) {
  if (!list?.length) return "";
  const first = list[0];
  const more = list.length > 1 ? ` e mais ${list.length - 1}` : "";
  const m = n => String(Math.round(num(n) * 10) / 10).replace(".", ",");
  return `${shipName} está Interditada por ${first.name}${more} (a ${m(first.distance)} m, alcance ${m(first.range)} m): o salto FTL está bloqueado.`;
}

/* ------------------------------------------------------------------ Duração de Portal e Domínio (lotes 3 e 5) */

/** Segundos de uma rodada quando o relógio do mundo não diz (o `CONFIG.time.roundTime` do Foundry). */
export const SPACE_ROUND_SECONDS = 6;

/**
 * A vida de um Portal ou Domínio, na criação. Em combate conta em rodadas (`roundsLeft`, pelo turno de quem o abriu, como a
 * Zona); fora dele, pelo relógio do mundo (`expiresAt`, em segundos). Numa Skill Ativa sem rodadas, vive enquanto ligada.
 * Sem rodadas e sem Ativa: sem prazo (o Mestre fecha).
 * @returns {{roundsLeft:number|null, expiresAt:number|null, untilDeactivated:boolean}}
 */
export function spaceLife({ rounds = 0, hasUpkeep = false, inCombat = false, worldTime = 0, roundSeconds = SPACE_ROUND_SECONDS } = {}) {
  const n = Math.max(0, Math.floor(num(rounds)));
  if (n <= 0) return { roundsLeft: null, expiresAt: null, untilDeactivated: Boolean(hasUpkeep) };
  if (inCombat) return { roundsLeft: n, expiresAt: null, untilDeactivated: false };
  const per = num(roundSeconds) > 0 ? num(roundSeconds) : SPACE_ROUND_SECONDS;
  return { roundsLeft: null, expiresAt: num(worldTime) + n * per, untilDeactivated: false };
}

/**
 * Um turno começou: a vida anda? Como a Zona, conta pelo turno de quem abriu (se ele luta) ou pela virada da rodada (se não).
 * @returns {{life: object, expired: boolean}}
 */
export function advanceSpaceLife(life, { casterFighting = false, casterTurn = false, roundChanged = false } = {}) {
  if (!life || life.untilDeactivated || !(num(life.roundsLeft) > 0)) return { life, expired: false };
  if (casterFighting ? !casterTurn : !roundChanged) return { life, expired: false };
  const left = Math.floor(num(life.roundsLeft)) - 1;
  return left <= 0 ? { life: { ...life, roundsLeft: 0 }, expired: true } : { life: { ...life, roundsLeft: left }, expired: false };
}

/** O prazo em segundos do mundo já passou? (só a vida fora de combate; as rodadas andam em `advanceSpaceLife`) */
export function spaceLifeExpired(life, worldTime) {
  return life?.expiresAt !== null && life?.expiresAt !== undefined && num(worldTime) >= num(life.expiresAt);
}

/** O combate acabou: o que ainda contava em rodadas passa a contar pelo relógio do mundo. */
export function spaceLifeToWorld(life, worldTime, roundSeconds = SPACE_ROUND_SECONDS) {
  if (!life || !(num(life.roundsLeft) > 0)) return life;
  const per = num(roundSeconds) > 0 ? num(roundSeconds) : SPACE_ROUND_SECONDS;
  return { roundsLeft: null, expiresAt: num(worldTime) + Math.floor(num(life.roundsLeft)) * per, untilDeactivated: false };
}

/** "3 rodadas", "até a Skill ser desligada" ou "sem prazo" (o Mestre fecha). */
export function spaceLifeText(life) {
  if (life?.untilDeactivated) return "até a Skill ser desligada";
  const n = Math.floor(num(life?.roundsLeft));
  if (n > 0) return `${n} ${n === 1 ? "rodada" : "rodadas"}`;
  if (life?.expiresAt !== null && life?.expiresAt !== undefined) return "pelo relógio do mundo";
  return "sem prazo (o Mestre fecha)";
}

/* ------------------------------------------------------------------ Portal (lote 3) */

/** Raio de uma ponta do Portal em metros (campo `spaceRadius`; 0 = 1 m, mais ou menos uma casa). */
export function portalRadiusMeters(entry) {
  const r = num(entry?.spaceRadius);
  return r > 0 ? r : 1;
}

/** "Portal não abre: a ponta A está dentro de uma Âncora (nível 8). Nada foi gasto." */
export function portalBlockText(label, verdict) {
  return `${label} não abre: ${anchorReason(verdict)}. Nada foi gasto.`;
}

/** A frase de quem tenta atravessar e está preso por uma Âncora. */
export function portalCrossText(name, verdict) {
  return `${name} não atravessa o portal: ${anchorReason(verdict)}.`;
}

/** Os dois pontos do Portal estão dentro do alcance de quem abre? `distances` em metros (null = não deu para medir). */
export function portalInRange(distances, range) {
  return swapInRange(distances, range);
}

/* ------------------------------------------------------------------ Bolso (lote 4) */

/** Os espaços de um Bolso sem nada preenchido: `base` no nível 1 e mais `perLevel` por nível (nível 4 → 5 + 3×5 = 20). */
export const POCKET_DEFAULTS = { base: 5, perLevel: 5 };

/** Os espaços do Bolso no nível `level` (nunca negativo, sempre inteiro). */
export function pocketSlots({ base = POCKET_DEFAULTS.base, perLevel = POCKET_DEFAULTS.perLevel, level = 1 } = {}) {
  const lv = Math.max(1, Math.floor(num(level, 1)));
  return Math.max(0, Math.floor(num(base) + num(perLevel) * (lv - 1)));
}

/** O efeito de Bolso da mecânica (o primeiro), ou null. */
export function pocketEntryOf(mech) {
  return spaceEntriesOf(mech).map(({ entry }) => entry).find(entry => normalizeSpaceMode(entry?.spaceMode) === "pocket") ?? null;
}

/**
 * O contêiner que o Bolso dá, no formato que o inventário lê (`{id, label, isSkill, unlimited, slots, weightReduction}`), ou
 * null se a Skill não tem Bolso. A redução de peso é sempre 100%: é o que faz dele um Bolso.
 */
export function pocketContainerOf(mech, { id, label } = {}) {
  const entry = pocketEntryOf(mech);
  if (!entry) return null;
  const slots = pocketSlots({ base: entry.pocketBase ?? POCKET_DEFAULTS.base, perLevel: entry.pocketPerLevel ?? POCKET_DEFAULTS.perLevel, level: mech.level });
  return { id, label, isSkill: true, unlimited: false, slots, weightReduction: 100, isPocket: true };
}

/** "Quem está Ancorado não abre o Bolso": a frase do aviso. Nada se perde; o que está dentro continua dentro. */
export function pocketBlockText(name, verdict) {
  return `${name} não abre o Bolso: ${anchorReason(verdict)}. Nada se perdeu; o que está dentro continua lá.`;
}

/* ------------------------------------------------------------------ Domínio (lote 5) */

/** Raio do Domínio em metros (campo `spaceRadius`; 0 = 10 m). */
export function domainRadiusMeters(entry) {
  const r = num(entry?.spaceRadius);
  return r > 0 ? r : 10;
}

/** O maior nível entre as Skills espaciais de quem está dentro (0 = nenhuma). `levels` = níveis de cada Skill espacial. */
export function bestSpatialLevel(levels = []) {
  return (levels ?? []).reduce((best, l) => Math.max(best, Math.floor(num(l))), 0);
}

/** Quem tem uma Skill espacial de nível MAIOR que o do Domínio escapa dele (o mesmo corte da Âncora). Sem Skill espacial, nunca. */
export function domainEscapes(domainLevel, escapeLevel) {
  return num(escapeLevel) > 0 && !anchorHolds(domainLevel, escapeLevel);
}

/**
 * O movimento é recusado? Quem começou dentro do Domínio e termina fora não sai, a não ser que escape. Quem já estava fora, ou
 * anda dentro da área, passa.
 */
export function domainBlocksMove({ startInside = false, endInside = false, escapes = false } = {}) {
  return Boolean(startInside) && !endInside && !escapes;
}

/** O ritmo próprio do Domínio: só vale com o bloco de tempo ligado e um fator diferente de 1 (limitado ao do relógio). */
export function domainTimeRate(entry, { timeEnabled = false } = {}) {
  const rate = num(entry?.spaceTimeRate, 1);
  if (!timeEnabled || !(rate > 0) || Math.abs(rate - 1) < 1e-9) return 1;
  return Math.min(1e6, Math.max(1e-10, rate));
}

export function domainBlockText(name, domainName) {
  return `${name} não sai: está Preso no Domínio${domainName ? ` "${domainName}"` : ""}.`;
}

/* ------------------------------------------------------------------ Textos */

const meters1 = n => String(Math.round(num(n) * 10) / 10).replace(".", ",");

function lifeSentence(entry) {
  const n = Math.max(0, Math.floor(num(entry?.durationRounds)));
  return n > 0 ? `por ${n} ${n === 1 ? "rodada" : "rodadas"}` : "enquanto a Skill estiver ligada (ou até o Mestre fechar)";
}

/** A frase do efeito no resumo da Skill. */
export function spaceSentence(entry, { range = 0 } = {}) {
  const reach = num(range) > 0 ? ` até ${String(num(range)).replace(".", ",")} m` : "";
  const walls = entry?.spaceWalls ? ", respeitando paredes" : ", atravessando paredes";
  const mode = normalizeSpaceMode(entry?.spaceMode);
  if (mode === "swap") return `troca de lugar com o alvo${entry?.spaceSwapOther ? " (ou entre dois Tokens à escolha)" : ""}${reach}${walls}`;
  if (mode === "jump") return `teleporta quem usa (ou o alvo)${reach ? ` a um ponto${reach}` : " a um ponto à escolha"}, ou até uma Marca${walls}`;
  if (mode === "portal") {
    return `abre um portal entre dois pontos${reach} ${lifeSentence(entry)}; quem entra numa ponta sai na outra${entry?.spaceOtherScene ? " (pode ligar outra cena)" : ""}`;
  }
  if (mode === "pocket") {
    const base = Math.floor(num(entry?.pocketBase, POCKET_DEFAULTS.base));
    const per = Math.floor(num(entry?.pocketPerLevel, POCKET_DEFAULTS.perLevel));
    return `dá um Bolso dimensional: ${base} espaços no nível 1${per > 0 ? ` e mais ${per} por nível` : ""}; o que está dentro não pesa`;
  }
  const rate = domainTimeRate(entry, { timeEnabled: true });
  return `ergue um Domínio de raio ${meters1(domainRadiusMeters(entry))} m ${lifeSentence(entry)}: quem está dentro não sai (só com uma Skill espacial de nível maior)${rate !== 1 ? `; o tempo lá dentro corre a ×${meters1(rate)}` : ""}`;
}

/** Resumo curto para o cartão do efeito na ficha. */
export function spaceShortLabel(entry) {
  return spaceModeLabel(entry?.spaceMode);
}
