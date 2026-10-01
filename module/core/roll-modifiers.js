/**
 * Modificadores de rolagem escolhidos na hora (shift+clique em qualquer rolagem do sistema):
 * Vantagem/Desvantagem e uma lista livre de operações ("+5 boa interpretação", "×2 crítico"…).
 *
 * O sistema não sabe o que é "rolagem de ataque" nem "crítico" — é RPG de mesa, quem julga é o
 * Mestre. Por isso não há regra automática: o jogador ou o Mestre abre o diálogo e escreve o que
 * a cena pediu. Tudo aqui é puro (sem Foundry) e testado em test/rules.test.mjs; o diálogo mora
 * em apps/roll-options-dialog.js.
 *
 * Duas formas de aplicar, conforme o que o card de chat mostra:
 *  - **Atributo e Iniciativa:** os modificadores entram NA FÓRMULA (`buildModifiedFormula`), pra
 *    rolagem do chat mostrar o resultado final.
 *  - **Dano:** a Vantagem entra na fórmula, mas as operações entram no NÚMERO depois da escala por
 *    atributo/nível e antes das reduções do alvo (`applyRollModifiers`), porque a escala é
 *    aplicada fora da fórmula.
 *
 * As operações valem **na ordem em que foram escritas**: "+5" e depois "×2" dá (rolagem + 5) × 2.
 */

export const ROLL_OPERATIONS = ["add", "sub", "mul", "div"];
export const ROLL_OPERATION_SYMBOLS = { add: "+", sub: "−", mul: "×", div: "÷" };
export const ADVANTAGE_MODES = ["normal", "advantage", "disadvantage"];

/**
 * Limpa o que veio do diálogo (ou de outro cliente): descarta operação desconhecida, valor não
 * numérico e divisão por zero.
 * @returns {{advantage: string, modifiers: Array<{op:string, value:number, label:string}>}}
 */
export function normalizeRollOptions(options = {}) {
  const advantage = ADVANTAGE_MODES.includes(options?.advantage) ? options.advantage : "normal";
  const modifiers = (Array.isArray(options?.modifiers) ? options.modifiers : [])
    .map(m => ({ op: m?.op, value: Number(m?.value), label: String(m?.label ?? "").trim() }))
    .filter(m => ROLL_OPERATIONS.includes(m.op) && Number.isFinite(m.value) && !(m.op === "div" && m.value === 0));
  return { advantage, modifiers };
}

/** true quando não há nada a aplicar — a rolagem segue exatamente como era. */
export function isNeutralRollOptions(options) {
  const { advantage, modifiers } = normalizeRollOptions(options);
  return advantage === "normal" && modifiers.length === 0;
}

/**
 * Vantagem/Desvantagem numa fórmula: rola o pool inteiro duas vezes e fica com o maior (ou o
 * menor). `2d20+5` com Vantagem vira `{2d20+5, 2d20+5}kh`.
 */
export function applyAdvantageToFormula(formula, advantage) {
  if (advantage === "advantage") return `{${formula}, ${formula}}kh`;
  if (advantage === "disadvantage") return `{${formula}, ${formula}}kl`;
  return formula;
}

/** Aplica as operações, na ordem, a uma fórmula (Atributo/Iniciativa). Divisão arredonda pra baixo. */
export function buildModifiedFormula(formula, options) {
  const { advantage, modifiers } = normalizeRollOptions(options);
  let result = applyAdvantageToFormula(formula, advantage);
  for (const { op, value } of modifiers) {
    if (op === "add") result = `(${result}) + ${value}`;
    else if (op === "sub") result = `(${result}) - ${value}`;
    else if (op === "mul") result = `(${result}) * ${value}`;
    else if (op === "div") result = `floor((${result}) / ${value})`;
  }
  return result;
}

/** Aplica as operações, na ordem, a um número (Dano). Divisão arredonda pra baixo; nunca negativo. */
export function applyRollModifiers(value, options) {
  const { modifiers } = normalizeRollOptions(options);
  let result = Number(value) || 0;
  for (const { op, value: amount } of modifiers) {
    if (op === "add") result += amount;
    else if (op === "sub") result -= amount;
    else if (op === "mul") result *= amount;
    else if (op === "div") result = Math.floor(result / amount);
  }
  return Math.max(0, result);
}

/**
 * Texto curto pro chat: "Vantagem · +5 (boa interpretação) · ×2". Vazio quando não há nada,
 * pra quem chama só acrescentar no flavor se houver.
 */
export function describeRollOptions(options) {
  const { advantage, modifiers } = normalizeRollOptions(options);
  const parts = [];
  if (advantage === "advantage") parts.push("Vantagem");
  if (advantage === "disadvantage") parts.push("Desvantagem");
  for (const { op, value, label } of modifiers) {
    parts.push(`${ROLL_OPERATION_SYMBOLS[op]}${value}${label ? ` (${label})` : ""}`);
  }
  return parts.join(" · ");
}
