/**
 * Modificadores Condicionais: regras "Quando → Então" em Títulos, Skills e Itens
 * (`conditionalModifiers` no schema). Ex.: Título "Caçador de Dragões" — quando o oponente tem o
 * Traço Dracônico, +25% de dano.
 *
 * Escolhidos em menus, nunca em expressão digitada: é o modelo do Pathfinder 2e (predicados
 * checados na hora da rolagem), não o do Midi-QOL (código livre, frágil). Este arquivo é puro —
 * recebe o contexto já montado e devolve números; quem monta o contexto e junta as regras do
 * Ator é `conditional-context.js`. Testado em test/.
 *
 * **Quando cada regra vale** decorre do "Então", não de uma escolha à parte:
 *  - `attributeFlat` (+N num atributo) é **contínuo**: entra na preparação da ficha como um buff
 *    temporário (rolagem, nunca Vida/Mana máxima) e só pode depender de condições sobre si mesmo;
 *  - `attributePercent` (+N% do total do atributo) é contínuo como o anterior (mesmas condições de si mesmo),
 *    resolvido na preparação da ficha sobre o `total`, nunca somado ao `total` (nada de Vida/Mana);
 *  - `damagePercent`, `rollFlat` e `resistancePercent` valem **no momento** do dano/rolagem e podem
 *    olhar o oponente e o elemento do golpe.
 *
 * "Oponente" é sempre o outro lado da ação: pra quem ataca, o alvo; pra quem defende
 * (Resistência), quem atacou.
 */

export const WHEN_KINDS = ["always", "otherTrait", "otherIsShip", "otherCondition", "otherConditionMine", "otherAnyMark", "otherAnyMarkMine", "element", "otherHpBelow", "selfHpBelow", "selfCondition", "selfInCombat", "selfDark", "isDay", "isNight"];
export const WHEN_LABELS = {
  always: "Sempre",
  otherTrait: "Oponente tem o Traço",
  otherIsShip: "Oponente é Nave/Veículo",
  otherCondition: "Oponente tem a Condição",
  otherConditionMine: "Oponente tem a Condição posta por mim",
  otherAnyMark: "Oponente tem qualquer marca",
  otherAnyMarkMine: "Oponente tem qualquer marca posta por mim",
  element: "O dano é do elemento",
  otherHpBelow: "Vida do oponente abaixo de (%)",
  selfHpBelow: "Minha Vida abaixo de (%)",
  selfCondition: "Eu tenho a Condição",
  selfInCombat: "Estou em combate",
  selfDark: "Está escuro onde estou",
  isDay: "É dia",
  isNight: "É noite"
};
/** Condições que só olham quem tem a regra — as únicas aceitas por regra contínua (`attributeFlat`). */
export const SELF_WHEN_KINDS = ["always", "selfHpBelow", "selfCondition", "selfInCombat", "selfDark", "isDay", "isNight"];

export const THEN_KINDS = ["damagePercent", "rollFlat", "resistancePercent", "attributeFlat", "attributePercent"];
export const THEN_LABELS = {
  damagePercent: "% de dano causado",
  rollFlat: "na rolagem de",
  resistancePercent: "% de Resistência a",
  attributeFlat: "no atributo (contínuo)",
  attributePercent: "% do atributo (contínuo)"
};

export const PER_EACH_KINDS = ["", "otherConditions", "selfConditions"];
export const PER_EACH_LABELS = { "": "—", otherConditions: "por Condição no oponente", selfConditions: "por Condição em mim" };

/**
 * A regra vale neste contexto?
 * @param {object} when - `{kind, value, threshold}`
 * @param {object} ctx - ver `buildModifierContext` em conditional-context.js
 */
export function matchesWhen(when, ctx = {}) {
  const kind = when?.kind || "always";
  switch (kind) {
    case "always":
      return true;
    case "otherTrait":
      return Boolean(when.value) && Boolean(ctx.otherTraits?.has?.(when.value));
    case "otherIsShip":
      return Boolean(ctx.otherIsShip);
    case "otherCondition":
      return Boolean(when.value) && Boolean(ctx.otherConditions?.has?.(when.value));
    case "otherConditionMine":
      return Boolean(when.value) && Boolean(ctx.otherConditionsMine?.has?.(when.value));
    case "otherAnyMark":
      return (ctx.otherMarks?.size ?? 0) > 0;
    case "otherAnyMarkMine":
      return (ctx.otherMarksMine?.size ?? 0) > 0;
    case "element":
      return Boolean(when.value) && Boolean(ctx.elements?.has?.(when.value));
    case "otherHpBelow":
      return Number.isFinite(ctx.otherHpPercent) && ctx.otherHpPercent < (Number(when.threshold) || 0);
    case "selfHpBelow":
      return Number.isFinite(ctx.selfHpPercent) && ctx.selfHpPercent < (Number(when.threshold) || 0);
    case "selfCondition":
      return Boolean(when.value) && Boolean(ctx.selfConditions?.has?.(when.value));
    case "selfInCombat":
      return Boolean(ctx.inCombat);
    // Relógio do mundo (J9): o contexto vem de world-clock.js (tudo falso com o bloco desligado).
    case "selfDark":
      return Boolean(ctx.isDark);
    case "isDay":
      return Boolean(ctx.isDay);
    case "isNight":
      return Boolean(ctx.isNight);
    default:
      return false;
  }
}

/**
 * Quanto vale, em pontos, uma soma de `attributePercent` sobre o total do atributo: `round(total × % ÷ 100)`.
 * −100% tira o total inteiro (nunca mais que isso). Pura.
 */
export function percentOfTotal(percent, total) {
  const pct = Math.max(-100, Number(percent) || 0);
  return Math.round((Number(total) || 0) * pct / 100);
}

/**
 * Estado da Skill Ativa em que uma regra "Quando → Então" vale: "on" (ligada), "off" (desligada) ou
 * "always". Vazio = o de sempre: "on" numa Skill Ativa. Skill não Ativa ignora o campo (sempre vale).
 * Pura.
 */
export function ruleActiveStateAllows(state, { hasUpkeep = false, active = false } = {}) {
  if (!hasUpkeep) return true;
  const mode = state === "off" || state === "always" ? state : "on";
  if (mode === "always") return true;
  return mode === "on" ? Boolean(active) : !active;
}

/**
 * "A cada N níveis da Skill" (1.120.0): quantas vezes a regra conta = ⌊nível ÷ N⌋, **no mínimo 1** (a partir do nível 1).
 * Com N = 5: níveis 1–9 contam 1 vez, 10–14 contam 2, 15–19 contam 3. Só vale quando a fonte é uma Skill (`level` vem do
 * Item); sem N (0) ou sem nível (Título, Item, Espécie) conta 1 vez, como sempre. Pura.
 */
export function levelScaleCount(perLevels, level) {
  const n = Math.floor(Number(perLevels));
  if (!(n >= 1) || level === undefined || level === null || level === "") return 1;
  const lvl = Math.max(1, Math.floor(Number(level)) || 1);
  return 1 + Math.floor((lvl - 1) / n); // dono 25/11 (quadro 12: nível 12 = +3): a cada 5 → Nv 1–5 = 1, 6–10 = 2, 11–15 = 3
}

/** Escuridão do contexto (0–1); sem o dado vale 0 (escuridão nenhuma). */
export function contextDarkness(ctx = {}) {
  const d = Number(ctx.darkness);
  return Number.isFinite(d) ? Math.min(1, Math.max(0, d)) : 0;
}

/**
 * Quanto uma regra vale neste contexto: valor × "por cada" × "a cada N níveis" (só de Skill: `mod.sourceLevel`);
 * com "vezes a escuridão" (`timesDarkness`) multiplica pela escuridão da cena do Token (0–1) e **arredonda no fim**
 * (+3 com 60% de escuridão = 1,8 → +2). Pura.
 */
export function ruleValue(mod, ctx = {}) {
  const base = (Number(mod?.then?.value) || 0) * perEachCount(mod?.perEach, ctx) * levelScaleCount(mod?.perLevels, mod?.sourceLevel);
  return mod?.timesDarkness ? Math.round(base * contextDarkness(ctx)) : base;
}

/** A conta de uma regra com escala, em texto ("× 2 (nível 12 ÷ 5) × 60% de escuridão = 2"), para o "De onde vem". Vazio sem escala. */
export function ruleScaleText(mod, ctx = {}) {
  const parts = [];
  const levels = Math.floor(Number(mod?.perLevels));
  if (levels >= 1 && mod?.sourceLevel !== undefined && mod?.sourceLevel !== null) {
    parts.push(`× ${levelScaleCount(levels, mod.sourceLevel)} (nível ${Math.max(1, Math.floor(Number(mod.sourceLevel)) || 1)} ÷ ${levels})`);
  }
  if (mod?.timesDarkness) parts.push(`× ${Math.round(contextDarkness(ctx) * 100)}% de escuridão`);
  return parts.length ? `${parts.join(" ")} = ${ruleValue(mod, ctx)}` : "";
}

/** Multiplicador "por cada": quantas Condições há no oponente / em si mesmo; 1 sem "por cada". */
export function perEachCount(perEach, ctx = {}) {
  if (perEach === "otherConditions") return ctx.otherConditions?.size ?? 0;
  if (perEach === "selfConditions") return ctx.selfConditions?.size ?? 0;
  return 1;
}

/**
 * Soma o valor de todas as regras de um tipo de "Então" que valem agora.
 * @param {object[]} modifiers - `conditionalModifiers` de todas as fontes ativas do Ator
 * @param {string} thenKind - um de THEN_KINDS
 * @param {object} ctx
 * @param {{attribute?:string, element?:string}} [filter] - `rollFlat`/`attributeFlat` filtram por
 *   atributo (`"any"` na regra vale pra qualquer); `resistancePercent` por alvo da Resistência
 *   (`"general"` ou id de elemento)
 * @returns {number}
 */
export function sumConditionalModifiers(modifiers, thenKind, ctx = {}, filter = {}) {
  let total = 0;
  for (const mod of modifiers ?? []) {
    const then = mod?.then ?? {};
    if (then.kind !== thenKind) continue;
    if ((thenKind === "attributeFlat" || thenKind === "attributePercent") && !SELF_WHEN_KINDS.includes(mod.when?.kind || "always")) continue;
    if ((thenKind === "rollFlat" || thenKind === "attributeFlat" || thenKind === "attributePercent") && then.target !== "any" && then.target !== filter.attribute) continue;
    if (thenKind === "resistancePercent" && then.target !== filter.element) continue;
    if (!matchesWhen(mod.when, ctx)) continue;
    total += ruleValue(mod, ctx);
  }
  return total;
}
