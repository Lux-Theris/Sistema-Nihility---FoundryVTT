/**
 * Superfícies (item 8.2): regras puras. Nada aqui toca Actor/Item/canvas — surfaces.js lê a cena e grava.
 * Testado em test/surfaces.test.mjs. Só importa de combat/reaction-rules.js (também puro).
 *
 * **O que é.** Um elemento pode "deixar no chão" uma superfície (poça de água, óleo, chamas, gelo): um
 * círculo na cena, SEM dono, com os dados dela no flag `surface`. Quem pisa leva dano e/ou uma Condição,
 * e CARREGA o elemento dela para as Reações (8.1). Dura rodadas em combate e minutos de relógio do mundo
 * fora dele. A natureza diz se a Antimagia a toca: matéria nunca; mágica sim; "da origem" = mágica se
 * veio de uma Skill mágica.
 */
import { findReaction, idsWithAncestors } from "../combat/reaction-rules.js";

export const SURFACE_NATURES = ["matter", "magic", "origin"];
export const SURFACE_MAX_RADIUS = 30;
export const SURFACE_MAX_HEIGHT = 50;

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const text = value => String(value ?? "").trim();

/**
 * A seção "Deixa no chão" de um elemento, limpa. `null` se não é um objeto. Os campos de um elemento
 * que NÃO deixa nada (`enabled: false`) são mantidos: desligar o bloco ou a caixa não apaga o que o
 * Mestre escreveu.
 */
export function normalizeSurface(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const immuneTraits = Array.isArray(raw.immuneTraits) ? [...new Set(raw.immuneTraits.map(text).filter(Boolean))] : [];
  return {
    enabled: raw.enabled === true,
    label: text(raw.label),
    chance: clamp(Math.round(num(raw.chance, 100)), 0, 100),
    radius: clamp(Math.round(num(raw.radius, 2) * 10) / 10, 0, SURFACE_MAX_RADIUS),
    damageFormula: text(raw.damageFormula),
    conditionId: text(raw.conditionId),
    // Rodadas da Condição que a superfície aplica (0 = 2; sem isso uma marca como Molhado nasceria sem prazo).
    conditionRounds: clamp(Math.round(num(raw.conditionRounds, 2)), 0, 100),
    height: clamp(Math.round(num(raw.height, 0) * 10) / 10, 0, SURFACE_MAX_HEIGHT),
    nature: SURFACE_NATURES.includes(raw.nature) ? raw.nature : "origin",
    rounds: clamp(Math.round(num(raw.rounds, 3)), 0, 100),
    minutes: clamp(Math.round(num(raw.minutes, 10)), 0, 1440),
    immuneTraits
  };
}

/** O elemento deixa mesmo algo no chão (caixa ligada e raio > 0)? Pura. */
export function leavesSurface(surface) {
  return Boolean(surface?.enabled) && num(surface.radius) > 0;
}

/** A superfície é mágica? "Da origem" herda de quem a criou. Pura. */
export function surfaceIsMagic(nature, originMagic) {
  if (nature === "magic") return true;
  if (nature === "matter") return false;
  return Boolean(originMagic);
}

/** Rodou a chance? `roll` é o d100 (1–100); chance 100 sempre vale, 0 nunca. Pura. */
export function surfaceChanceHits(chance, roll) {
  const c = clamp(num(chance, 100), 0, 100);
  if (c >= 100) return true;
  if (c <= 0) return false;
  return num(roll, 101) <= c;
}

/** Quando a superfície acaba pelo relógio do mundo (segundos); `null` = nunca por relógio. Pura. */
export function surfaceExpiresAt(worldTime, minutes, rate = 1) {
  const m = num(minutes);
  // J9b: os minutos são da linha do tempo da cena; o relógio do mundo conta m × 60 ÷ ritmo.
  const r = num(rate, 1) > 0 ? num(rate, 1) : 1;
  return m > 0 ? num(worldTime) + Math.max(1, Math.round((m * 60) / r)) : null;
}

/**
 * Os dados que vão no flag da superfície. Pura. `def` é a seção do elemento; `radiusMeters`/`rounds`
 * opcionais sobrepõem o raio e as rodadas (efeito de Skill "Cria superfície"). `x`/`y` em pixels,
 * `radiusPx` já convertido por quem chama.
 */
export function buildSurfaceFlag({ elementId, def, label, x, y, radiusPx, radiusMeters, elevation = 0, originMagic = false, worldTime = 0, useId = "", rounds = null, rate = 1 }) {
  const s = def ?? normalizeSurface({});
  const radiusM = clamp(num(radiusMeters, s.radius) > 0 ? num(radiusMeters, s.radius) : s.radius, 0, SURFACE_MAX_RADIUS);
  const roundsLeft = rounds === null || rounds === undefined ? s.rounds : clamp(Math.round(num(rounds)), 0, 100);
  return {
    elementId,
    label: text(label) || s.label || "Superfície",
    radius: radiusM,
    damageFormula: s.damageFormula,
    conditionId: s.conditionId,
    conditionRounds: s.conditionRounds || 2,
    height: s.height,
    elevation: num(elevation),
    nature: s.nature,
    magic: surfaceIsMagic(s.nature, originMagic),
    roundsLeft,
    createdAt: num(worldTime),
    expiresAt: surfaceExpiresAt(worldTime, s.minutes, rate),
    immuneTraits: [...s.immuneTraits],
    useId: text(useId).slice(0, 32),
    area: { shape: "circle", x: num(x), y: num(y), radius: clamp(num(radiusPx), 0, 1e6), angle: 0, direction: 0, width: 0, elevation: 0 }
  };
}

/** Entrou agora = estava fora e agora está dentro (andar dentro da mesma superfície não dispara de novo). Pura. */
export function surfaceEntered(insideBefore, insideAfter) {
  return !insideBefore && Boolean(insideAfter);
}

/**
 * Quem está nesta altura é alcançado? `height` = quanto a superfície sobe acima do chão dela (0 = só o
 * chão). Acima disso (voando) ou debaixo da terra (elevação < base) não pisa. Com o bloco Elevação
 * desligado a altura não conta. Pura.
 */
export function surfaceReachesElevation({ elevation = 0, base = 0, height = 0, elevationOn = true } = {}) {
  if (!elevationOn) return true;
  const diff = num(elevation) - num(base);
  if (diff > num(height) + 1e-9) return false;
  if (diff < -0.5) return false;
  return true;
}

/** Algum Traço imune da superfície no alvo? Pura. */
export function surfaceImmune(immuneTraits, traits) {
  const wanted = new Set(immuneTraits ?? []);
  return (traits ?? []).some(t => wanted.has(t));
}

/**
 * Uma rodada passa (virada da rodada em combate). `roundsLeft` 0 = a superfície não conta rodadas
 * (só o relógio). Pura.
 * @returns {{roundsLeft:number, remove:boolean}}
 */
export function surfaceRoundStep(roundsLeft) {
  const n = Math.round(num(roundsLeft));
  if (n <= 0) return { roundsLeft: 0, remove: false };
  const next = n - 1;
  return { roundsLeft: next, remove: next <= 0 };
}

/** Fora de combate a superfície acaba quando o relógio do mundo passa de `expiresAt`. Pura. */
export function surfaceExpired({ expiresAt, worldTime, inCombat }) {
  if (inCombat) return false;
  if (expiresAt === null || expiresAt === undefined || expiresAt === "") return false;
  return num(worldTime) >= num(expiresAt);
}

/** Dois círculos (px) se tocam? Pura. */
export function circlesTouch(a, b) {
  if (!a || !b) return false;
  return Math.hypot(num(a.x) - num(b.x), num(a.y) - num(b.y)) <= num(a.radius) + num(b.radius) + 1e-9;
}

/**
 * Já existe uma superfície do mesmo elemento praticamente no mesmo lugar? (Aplicar em todos de uma área
 * não empilha dez poças: renova a que já está.) Devolve o índice ou -1. Pura.
 * @param {Array<{elementId:string, area:{x:number,y:number,radius:number}}>} existing
 */
export function findSameSurface(existing, { elementId, x, y, radiusPx }) {
  return (existing ?? []).findIndex(s => {
    if (s?.elementId !== elementId || !s.area) return false;
    return Math.hypot(num(s.area.x) - num(x), num(s.area.y) - num(y)) <= Math.max(num(s.area.radius), num(radiusPx)) / 2 + 1e-9;
  });
}

/**
 * O que um golpe (cadeia de elementos do elemento do golpe) faz com uma superfície de um elemento,
 * pela Tabela de reações: a reação deixa outra superfície → a superfície vira ela; só tira uma Condição
 * (Apagar, Vapor que tira Queimadura) → a superfície some; senão nada. Pura.
 * @param {Array<{id:string, reactions?:object}>} chain - o elemento do golpe e os ancestrais
 * @param {string} surfaceElementId
 * @param {Array<{id:string, parent?:string}>} elements
 * @returns {{action:"replace"|"remove"|"none", leaveSurface:string, label:string}}
 */
export function surfaceReaction(chain, surfaceElementId, elements = []) {
  const none = { action: "none", leaveSurface: "", label: "" };
  if (!surfaceElementId) return none;
  const found = findReaction(chain, idsWithAncestors(surfaceElementId, elements));
  if (!found) return none;
  const reaction = found.reaction;
  const label = reaction.label ?? "";
  if (reaction.leaveSurface && reaction.leaveSurface !== surfaceElementId) return { action: "replace", leaveSurface: reaction.leaveSurface, label };
  if (reaction.removeCondition) return { action: "remove", leaveSurface: "", label };
  return { ...none, label };
}

/**
 * Antimagia: uma superfície mágica que um campo de Antimagia (nível > 0) toca, ou uma Antimagia em
 * Emissão (o tipo "magic" entre os `kinds`), desaparece. Matéria nunca. Pura.
 */
export function surfaceDispelled({ magic, fieldLevel = 0, emissionKinds = [] }) {
  if (!magic) return false;
  return num(fieldLevel) > 0 || (emissionKinds ?? []).includes("magic");
}

/** Segmentos `[x1,y1,x2,y2]` de um polígono em lista plana `[x,y,x,y…]` (fechado). Pura. */
export function polygonEdges(points) {
  const out = [];
  const flat = points ?? [];
  const count = Math.floor(flat.length / 2);
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    out.push([flat[i * 2], flat[i * 2 + 1], flat[j * 2], flat[j * 2 + 1]]);
  }
  return out;
}

/**
 * A frase "Na mesa" da superfície de um elemento. `labels`: `{condition(id), trait(id)}`. Pura.
 */
export function surfaceSentence(elementLabel, surface, labels = {}) {
  if (!surface?.enabled) return "";
  const condition = labels.condition ?? (id => id);
  const trait = labels.trait ?? (id => id);
  const name = surface.label || `${elementLabel} no chão`;
  const does = [];
  if (surface.damageFormula) does.push(`leva ${surface.damageFormula} de ${elementLabel}`);
  if (surface.conditionId) does.push(`fica ${condition(surface.conditionId)}`);
  const walks = does.length ? `quem pisa ${does.join(" e ")}` : "quem pisa só carrega o elemento";
  const reach = surface.height > 0 ? `alcança até ${String(surface.height).replace(".", ",")} m de altura` : "só o chão";
  const nature = { matter: "é matéria (a Antimagia não toca)", magic: "é mágica (a Antimagia desfaz)", origin: "é mágica se veio de uma Skill mágica" }[surface.nature];
  const lasts = [surface.rounds > 0 ? `${surface.rounds} rodada(s) em combate` : "", surface.minutes > 0 ? `${surface.minutes} min fora dele` : ""].filter(Boolean).join(" e ");
  const immune = surface.immuneTraits?.length ? `; imunes: ${surface.immuneTraits.map(trait).join(", ")}` : "";
  const chance = surface.chance < 100 ? `${surface.chance}% de chance de deixar ` : "deixa ";
  return `${name}: ${chance}uma superfície de ${String(surface.radius).replace(".", ",")} m; ${walks}; ${reach}; ${nature}; dura ${lasts || "até alguém desfazer"}${immune}.`;
}

/**
 * Migração `surfaceDefaults` (pura): a um catálogo de elementos salvo, só ACRESCENTA a seção `surface`
 * nos elementos que nunca tiveram o campo e que têm uma de fábrica. Nada editado é sobrescrito.
 * @returns {{elements:Array, changed:boolean}}
 */
export function mergeSurfaceDefaults(elementList, defaults = {}) {
  const elements = Array.isArray(elementList) ? elementList.map(e => ({ ...e })) : [];
  let changed = false;
  for (const element of elements) {
    if (element?.id && element.surface === undefined && defaults[element.id]) {
      element.surface = JSON.parse(JSON.stringify(defaults[element.id]));
      changed = true;
    }
  }
  return { elements, changed };
}

/**
 * Referências quebradas da seção de um elemento (Validar Mundo). Pura.
 * @returns {string[]} frases (vazio = nada)
 */
export function surfaceProblems(elementLabel, surface, { conditionIds = new Set(), traitIds = new Set() } = {}) {
  if (!surface) return [];
  const out = [];
  if (surface.conditionId && !conditionIds.has(surface.conditionId)) out.push(`superfície de ${elementLabel}: a Condição "${surface.conditionId}" não existe mais no catálogo`);
  for (const trait of surface.immuneTraits ?? []) if (!traitIds.has(trait)) out.push(`superfície de ${elementLabel}: o Traço imune "${trait}" não existe mais no catálogo`);
  return out;
}
