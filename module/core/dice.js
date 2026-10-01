/**
 * Rolagem de Atributos com dado escalável: a cada +10 de Bônus do próprio
 * atributo (pontos investidos + bônus permanentes de Títulos), a rolagem
 * ganha +1d20 — todos os dados são somados (2d20, 3d20...). Bônus de
 * arma/equipamento NUNCA entram nessa conta: somam por fora, como número fixo.
 */
import { MEU_SISTEMA, getAttributeLabel } from "./config.js";
import { buildModifiedFormula, describeRollOptions } from "./roll-modifiers.js";
import { conditionalBonus } from "../combat/conditional-context.js";

/** @returns {{diceCount:number, flat:number}} */
export function computeAttributeDicePool(bonus) {
  const safeBonus = Math.max(0, Math.trunc(Number(bonus) || 0));
  const diceCount = 1 + Math.floor(safeBonus / 10);
  const flat = safeBonus % 10;
  return { diceCount, flat };
}

/** Monta a fórmula de rolagem (ex: "2d20+3") a partir do Bônus do atributo e de um bônus fixo extra (arma/equipamento, opcional). */
export function buildAttributeRollFormula(bonus, extraFlat = 0) {
  const { diceCount, flat } = computeAttributeDicePool(bonus);
  const total = flat + Number(extraFlat || 0);
  if (total === 0) return `${diceCount}d20`;
  return `${diceCount}d20${total > 0 ? "+" : "-"}${Math.abs(total)}`;
}

/**
 * Rola um Atributo de combate do Ator e posta o resultado no chat.
 * @param {Actor} actor
 * @param {string} attributeKey - uma chave de MEU_SISTEMA.COMBAT_ATTRIBUTES
 * @param {{extraFlat?:number, flavor?:string, rollOptions?:object}} [options] - `rollOptions`: Vantagem e
 *   modificadores do shift+clique (ver roll-modifiers.js)
 */
export async function rollAttribute(actor, attributeKey, options = {}) {
  const { extraFlat = 0, flavor = "", rollOptions = null } = options;
  const attr = actor.system?.attributes?.combat?.[attributeKey];
  if (!attr) return null;

  // Bônus condicional "+N na rolagem" (Título/Skill/Item), contra o alvo marcado no mapa, se houver.
  const target = Array.from(game.user?.targets ?? [])[0]?.actor ?? null;
  const situational = conditionalBonus(actor, target, "rollFlat", { attribute: attributeKey });

  // Vantagem e modificadores do shift+clique entram na própria fórmula, pra o card mostrar o
  // resultado final (ver roll-modifiers.js).
  const formula = buildModifiedFormula(buildAttributeRollFormula(attr.bonus, extraFlat + situational), rollOptions);
  const label = getAttributeLabel(attributeKey);
  const modifiersText = describeRollOptions(rollOptions);

  const roll = new Roll(formula);
  await roll.evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${flavor || label}${modifiersText ? ` — ${modifiersText}` : ""}`
  });
  return roll;
}
