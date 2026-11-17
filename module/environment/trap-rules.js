/**
 * Armadilhas de Região (I1) — regras puras (sem Foundry), testadas em test/traps.test.mjs.
 *
 * Uma armadilha é o comportamento de Região "Armadilha (Nihility)" (`nihilityTrap`, traps.js): quem
 * entra na Região leva dano (com elementos, pelas defesas do alvo) e/ou uma Condição. Aqui ficam as
 * decisões que não precisam de documento: se dispara, se um campo ou uma Antimagia/PEM em área a
 * desarma, a geometria da Região e as referências a catálogos.
 */
import { pointInSegments, segmentsCross } from "../structures/structure-geometry.js";

export const TRAP_TRIGGERS = ["once", "always"];
export const TRAP_REACH = ["ground", "any"];
export const TRAP_TRIGGER_LABELS = { once: "Uma vez (depois se desliga)", always: "Toda vez que alguém entra" };
export const TRAP_REACH_LABELS = { ground: "Só quem pisa no chão", any: "Qualquer altura dentro da Região" };

/** Elevação (m) até onde alguém ainda "pisa no chão" (acima voa, abaixo está enterrado). */
export const GROUND_TOLERANCE = 0.5;

const list = value => [...new Set((Array.isArray(value) ? value : value instanceof Set ? [...value] : []).map(String).filter(Boolean))];

/** Os campos de uma armadilha, limpos e limitados (o que vem do comportamento da Região). */
export function normalizeTrap(raw = {}) {
  const level = Number(raw.level);
  return {
    formula: String(raw.formula ?? "").trim(),
    elements: list(raw.damageElements ?? raw.elements),
    magicDamage: Boolean(raw.isMagicDamage ?? raw.magicDamage),
    conditionId: String(raw.conditionId ?? ""),
    level: Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0,
    magic: Boolean(raw.magic),
    tech: Boolean(raw.tech),
    trigger: TRAP_TRIGGERS.includes(raw.trigger) ? raw.trigger : "once",
    reach: TRAP_REACH.includes(raw.reach) ? raw.reach : "ground",
    immuneTraits: list(raw.immuneTraits),
    reveal: Boolean(raw.reveal)
  };
}

/** A armadilha faz alguma coisa (dano ou Condição)? */
export function trapHasEffect(trap) {
  return Boolean(trap?.formula) || Boolean(trap?.conditionId);
}

/** Quem está nesta elevação pisa no chão? (`tolerance` em metros) */
export function trapGroundOk(elevation, tolerance = GROUND_TOLERANCE) {
  const e = Number(elevation);
  return !Number.isFinite(e) || Math.abs(e) <= tolerance + 1e-9;
}

/**
 * Esta armadilha dispara para quem entrou? Devolve `{fire, reason}`; `reason` (se não dispara):
 * "disarmed", "noEffect", "immune", "air" (voa/enterrado numa armadilha de chão).
 * @param {object} trap - de normalizeTrap
 * @param {{elevation?:number, immune?:boolean, disarmed?:boolean, elevationOn?:boolean}} who
 */
export function trapShouldFire(trap, { elevation = 0, immune = false, disarmed = false, elevationOn = true } = {}) {
  if (disarmed) return { fire: false, reason: "disarmed" };
  if (!trapHasEffect(trap)) return { fire: false, reason: "noEffect" };
  if (immune) return { fire: false, reason: "immune" };
  if (trap.reach === "ground" && elevationOn && !trapGroundOk(elevation)) return { fire: false, reason: "air" };
  return { fire: true, reason: null };
}

/** Quem tem algum dos Traços imunes da armadilha? */
export function trapImmune(trap, actorTraitIds = []) {
  const have = new Set(actorTraitIds ?? []);
  return (trap?.immuneTraits ?? []).some(id => have.has(id));
}

/**
 * Um campo (Antimagia para armadilha mágica, Interferência para tecnológica) desarma a armadilha?
 * Vale o campo de nível ≥ ao dela que a toca. Tecnomágica sofre os dois. Nível 0 da armadilha =
 * qualquer campo.
 * @param {{magic:boolean, tech:boolean, level:number}} trap
 * @param {{magic?:number, tech?:number}} fieldLevels - maior nível de campo tocando a Região, por tipo
 * @returns {"magic"|"tech"|null} qual campo venceu (para a mensagem)
 */
export function trapDisarmedByField(trap, fieldLevels = {}) {
  const beats = level => Number(level) > 0 && Number(level) >= (Number(trap?.level) || 0);
  if (trap?.magic && beats(fieldLevels.magic)) return "magic";
  if (trap?.tech && beats(fieldLevels.tech)) return "tech";
  return null;
}

/**
 * Uma Antimagia (`kind` "magic") ou PEM ("tech") em área, com alcance `reach` (nível da Skill ×
 * alcance), desarma a armadilha? Precisa ser da natureza dela e o alcance ≥ ao nível dela.
 */
export function trapDisarmedByEmission(trap, kind, reach) {
  if (kind === "magic" && !trap?.magic) return false;
  if (kind === "tech" && !trap?.tech) return false;
  if (kind !== "magic" && kind !== "tech") return false;
  return Number(reach) >= (Number(trap?.level) || 0);
}

/* ------------------------------------------------------------------ Geometria da Região */

/** Segmentos `[x1,y1,x2,y2]` de um polígono dado como lista plana `[x0,y0,x1,y1,…]` (fechado). */
export function polygonSegments(points = []) {
  const p = (points ?? []).map(Number).filter(Number.isFinite);
  const n = Math.floor(p.length / 2);
  const out = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (n < 3) break;
    out.push([p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1]]);
  }
  return out;
}

/** Os vértices `[x,y]` de uma lista de segmentos. */
function vertices(segments) {
  return (segments ?? []).map(([x1, y1]) => [x1, y1]);
}

/**
 * Duas formas fechadas (listas de segmentos) se sobrepõem ou se tocam? Um vértice de uma dentro da
 * outra, ou algum lado cruzando. Serve a "campo fechado toca a Região da armadilha".
 */
export function closedShapesOverlap(a, b) {
  if (!a?.length || !b?.length) return false;
  if (vertices(a).some(v => pointInSegments(v, b))) return true;
  if (vertices(b).some(v => pointInSegments(v, a))) return true;
  return segmentsCross(a, b);
}

/** Frase curta da armadilha (cartão do Mestre): "2d6 de dano · Lentidão · mágica nível 3". */
export function describeTrap(trap, { conditionLabel = "", elementLabels = [] } = {}) {
  const parts = [];
  if (trap.formula) parts.push(`${trap.formula}${elementLabels.length ? ` de ${elementLabels.join(" + ")}` : " de dano"}`);
  if (trap.conditionId) parts.push(conditionLabel || trap.conditionId);
  const nature = [trap.magic ? "mágica" : "", trap.tech ? "tecnológica" : ""].filter(Boolean).join(" e ");
  if (nature) parts.push(`${nature}${trap.level ? ` nível ${trap.level}` : ""}`);
  return parts.join(" · ");
}
