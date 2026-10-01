/**
 * Modificadores Condicionais: regras "Quando → Então" em Títulos, Skills e Itens
 * (`conditionalModifiers` no schema). Ex.: Título "Caçador de Dragões" — quando o oponente tem o
 * Traço Dracônico, +25% de dano.
 *
 * Escolhidos em menus, nunca em expressão digitada: é o modelo do Pathfinder 2e (predicados
 * checados na hora da rolagem), não o do Midi-QOL (código livre, frágil). Este arquivo é puro —
 * recebe o contexto já montado e devolve números; quem monta o contexto e junta as regras do
 * Ator é `conditional-context.js`. Testado em test/rules.test.mjs.
 *
 * **Quando cada regra vale** decorre do "Então", não de uma escolha à parte:
 *  - `attributeFlat` (+N num atributo) é **contínuo**: entra na preparação da ficha como um buff
 *    temporário (rolagem, nunca Vida/Mana máxima) e só pode depender de condições sobre si mesmo;
 *  - `damagePercent`, `rollFlat` e `resistancePercent` valem **no momento** do dano/rolagem e podem
 *    olhar o oponente e o elemento do golpe.
 *
 * "Oponente" é sempre o outro lado da ação: pra quem ataca, o alvo; pra quem defende
 * (Resistência), quem atacou.
 */

export const WHEN_KINDS = ["always", "otherTrait", "otherIsShip", "otherCondition", "element", "selfHpBelow", "selfCondition", "selfInCombat"];
export const WHEN_LABELS = {
  always: "Sempre",
  otherTrait: "Oponente tem o Traço",
  otherIsShip: "Oponente é Nave/Veículo",
  otherCondition: "Oponente tem a Condição",
  element: "O dano é do elemento",
  selfHpBelow: "Minha Vida abaixo de (%)",
  selfCondition: "Eu tenho a Condição",
  selfInCombat: "Estou em combate"
};
/** Condições que só olham quem tem a regra — as únicas aceitas por regra contínua (`attributeFlat`). */
export const SELF_WHEN_KINDS = ["always", "selfHpBelow", "selfCondition", "selfInCombat"];

export const THEN_KINDS = ["damagePercent", "rollFlat", "resistancePercent", "attributeFlat"];
export const THEN_LABELS = {
  damagePercent: "% de dano causado",
  rollFlat: "na rolagem de",
  resistancePercent: "% de Resistência a",
  attributeFlat: "no atributo (contínuo)"
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
    case "element":
      return Boolean(when.value) && Boolean(ctx.elements?.has?.(when.value));
    case "selfHpBelow":
      return Number.isFinite(ctx.selfHpPercent) && ctx.selfHpPercent < (Number(when.threshold) || 0);
    case "selfCondition":
      return Boolean(when.value) && Boolean(ctx.selfConditions?.has?.(when.value));
    case "selfInCombat":
      return Boolean(ctx.inCombat);
    default:
      return false;
  }
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
    if (thenKind === "attributeFlat" && !SELF_WHEN_KINDS.includes(mod.when?.kind || "always")) continue;
    if ((thenKind === "rollFlat" || thenKind === "attributeFlat") && then.target !== "any" && then.target !== filter.attribute) continue;
    if (thenKind === "resistancePercent" && then.target !== filter.element) continue;
    if (!matchesWhen(mod.when, ctx)) continue;
    total += (Number(then.value) || 0) * perEachCount(mod.perEach, ctx);
  }
  return total;
}
