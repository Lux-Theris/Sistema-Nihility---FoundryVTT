/**
 * Rolagem de Atributos com dado escalável: a cada +10 de Bônus do próprio
 * atributo (pontos investidos + bônus permanentes de Títulos), a rolagem
 * ganha +1d20 — todos os dados são somados (2d20, 3d20...). Bônus de
 * arma/equipamento NUNCA entram nessa conta: somam por fora, como número fixo.
 */
import { MEU_SISTEMA } from "./config.js";

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
 * @param {{extraFlat?:number, flavor?:string}} [options]
 */
export async function rollAttribute(actor, attributeKey, options = {}) {
  const { extraFlat = 0, flavor = "" } = options;
  const attr = actor.system?.attributes?.combat?.[attributeKey];
  if (!attr) return null;

  const formula = buildAttributeRollFormula(attr.bonus, extraFlat);
  const label = MEU_SISTEMA.COMBAT_ATTRIBUTE_LABELS[attributeKey] ?? attributeKey;

  const roll = new Roll(formula);
  await roll.evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: flavor || label
  });
  return roll;
}
