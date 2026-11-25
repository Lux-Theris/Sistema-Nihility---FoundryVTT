/**
 * "Só se…" (item 8.1a): a condição de um Efeito de Skill, lida do lado do ALVO no momento em que
 * o efeito chega. É a mesma linguagem dos menus do "Quando → Então" (`matchesWhen`), com o
 * "oponente" sendo o alvo do efeito e "eu" quem usou a Skill. Falhou → o efeito não é aplicado e o
 * resumo diz por quê ("não aplicado: o alvo não está Molhado"). Puro e testado em test/reactions.test.mjs.
 *
 * Guardado em `onlyIf: {kind, value, threshold}` no efeito (`kind` vazio = sempre).
 */
import { matchesWhen } from "../combat/conditional-modifiers.js";

/** Tipos oferecidos no menu "Só se…" (os do Quando que fazem sentido para um efeito). */
export const ONLY_IF_KINDS = ["otherCondition", "otherConditionMine", "otherAnyMark", "otherAnyMarkMine", "otherTrait", "otherIsShip", "otherHpBelow", "selfCondition", "selfHpBelow", "selfInCombat", "selfDark"];

export const ONLY_IF_LABELS = {
  otherCondition: "O alvo tem a Condição",
  otherConditionMine: "O alvo tem a Condição posta por mim",
  otherAnyMark: "O alvo tem qualquer marca",
  otherAnyMarkMine: "O alvo tem qualquer marca posta por mim",
  otherTrait: "O alvo tem o Traço",
  otherIsShip: "O alvo é Nave/Veículo",
  otherHpBelow: "A Vida do alvo está abaixo de (%)",
  selfCondition: "Quem usou tem a Condição",
  selfHpBelow: "A Vida de quem usou está abaixo de (%)",
  selfInCombat: "Quem usou está em combate",
  selfDark: "Quem usou está no escuro"
};

/** O que cada tipo precisa escolher: Condição, Traço ou um limite em %. */
export function onlyIfNeeds(kind) {
  if (kind === "otherCondition" || kind === "otherConditionMine" || kind === "selfCondition") return "condition";
  if (kind === "otherTrait") return "trait";
  if (kind === "otherHpBelow" || kind === "selfHpBelow") return "threshold";
  return "";
}

/** `{kind, value, threshold}` limpo, ou `null` (sem "Só se…"). Pura. */
export function normalizeOnlyIf(raw) {
  const kind = String(raw?.kind ?? "").trim();
  if (!ONLY_IF_KINDS.includes(kind)) return null;
  const needs = onlyIfNeeds(kind);
  const threshold = Math.min(100, Math.max(0, Number(raw?.threshold) || 0));
  return { kind, value: needs === "condition" || needs === "trait" ? String(raw?.value ?? "").trim() : "", threshold: needs === "threshold" ? (threshold || 50) : 50 };
}

/** Há uma condição valendo neste efeito? Pura. */
export function hasOnlyIf(onlyIf) {
  return Boolean(normalizeOnlyIf(onlyIf));
}

/**
 * Pares [quando vale, quando falha] de cada tipo, já com o rótulo do que foi escolhido.
 * `labelOf(kind, value)` devolve o nome da Condição/Traço.
 */
function phrases(onlyIf, labelOf) {
  const name = labelOf ? labelOf(onlyIf.kind, onlyIf.value) : onlyIf.value;
  const pct = Math.round(onlyIf.threshold);
  switch (onlyIf.kind) {
    case "otherCondition": return [`o alvo estiver ${name}`, `o alvo não está ${name}`];
    case "otherConditionMine": return [`o alvo tiver a Condição ${name} posta por mim`, `o alvo não tem a Condição ${name} posta por mim`];
    case "otherAnyMark": return ["o alvo tiver qualquer marca", "o alvo não tem nenhuma marca"];
    case "otherAnyMarkMine": return ["o alvo tiver qualquer marca posta por mim", "o alvo não tem nenhuma marca posta por mim"];
    case "otherTrait": return [`o alvo tiver o Traço ${name}`, `o alvo não tem o Traço ${name}`];
    case "otherIsShip": return ["o alvo for Nave ou Veículo", "o alvo não é Nave nem Veículo"];
    case "otherHpBelow": return [`a Vida do alvo estiver abaixo de ${pct}%`, `a Vida do alvo não está abaixo de ${pct}%`];
    case "selfCondition": return [`quem usou estiver ${name}`, `quem usou não está ${name}`];
    case "selfHpBelow": return [`a Vida de quem usou estiver abaixo de ${pct}%`, `a Vida de quem usou não está abaixo de ${pct}%`];
    case "selfInCombat": return ["quem usou estiver em combate", "quem usou não está em combate"];
    case "selfDark": return ["quem usou estiver no escuro", "quem usou não está no escuro"];
    default: return ["", ""];
  }
}

/** "o alvo estiver Molhado" (para "…, só se o alvo estiver Molhado"); vazio sem condição. Pura. */
export function onlyIfClause(onlyIf, labelOf) {
  const clean = normalizeOnlyIf(onlyIf);
  return clean ? phrases(clean, labelOf)[0] : "";
}

/**
 * O efeito vale neste contexto? `ctx` é o de `buildModifierContext(quemUsou, alvo)`.
 * @returns {{ok:true}|{ok:false, reason:string}} `reason` pronto para o resumo ("não aplicado: …")
 */
export function onlyIfOutcome(onlyIf, ctx, labelOf) {
  const clean = normalizeOnlyIf(onlyIf);
  if (!clean) return { ok: true };
  // Condição/Traço apagado do catálogo: o efeito não pega (o aviso do editor já apontou).
  if (onlyIfNeeds(clean.kind) && onlyIfNeeds(clean.kind) !== "threshold" && !clean.value) return { ok: false, reason: "não aplicado: a condição do efeito não está escolhida" };
  // `selfInCombat` e as de Vida só leem o contexto; os outros tipos usam o `matchesWhen` do "Quando".
  const when = { kind: clean.kind, value: clean.value, threshold: clean.threshold };
  if (matchesWhen(when, ctx)) return { ok: true };
  return { ok: false, reason: `não aplicado: ${phrases(clean, labelOf)[1]}` };
}

/** O efeito é "sem peso" para o custo sugerido: com "Só se…" pesa menos (×0,7). Pura. */
export const ONLY_IF_COST_FACTOR = 0.7;
