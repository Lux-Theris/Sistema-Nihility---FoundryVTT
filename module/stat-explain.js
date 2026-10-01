/**
 * "De onde vem esse número?" — a explicação de um Atributo ou de Vida/Mana máxima, PURA (testada
 * em test/rules.test.mjs). Recebe as parcelas já com a fonte (as listas `*Sources` de
 * character-model.js, os Active Effects lidos pela janela) e devolve as contas na mesma ordem e
 * com os mesmos arredondamentos da preparação da ficha. Quem desenha é apps/stat-breakdown.js.
 *
 * Quando a janela não consegue atribuir uma parte do valor real a uma fonte (um Active Effect de
 * outro módulo, por exemplo), entra uma linha "não identificado" com a diferença — a explicação
 * nunca mostra uma conta que não fecha com o número da ficha.
 */
import { computeAttributeDicePool } from "./dice.js";

const sum = list => (list ?? []).reduce((total, row) => total + (Number(row.value) || 0), 0);

/** Lista + linha de diferença quando o valor real (o que a ficha somou) não bate com as fontes. */
function withResidual(rows, actual, label = "Outros efeitos (não identificados)") {
  const list = [...(rows ?? [])];
  if (actual == null) return list;
  const diff = (Number(actual) || 0) - sum(list);
  if (diff) list.push({ label, value: diff, unknown: true });
  return list;
}

/**
 * @param {object} input
 * @param {number} input.points - pontos confirmados
 * @param {number} [input.pending] - pontos pendentes (só prévia, não conta)
 * @param {Array<{label:string, value:number}>} [input.titles]
 * @param {Array} [input.buffs] - Active Effects no `buffDelta` do atributo
 * @param {number} [input.buffActual] - o `buffDelta` que a ficha tem de fato
 * @param {Array} [input.conditionals] - "Quando → Então" contínuos, por fonte
 * @param {Array} [input.items] - bônus de Item/Modificação/Skill (somados por fora na rolagem)
 */
export function explainAttribute({ points = 0, pending = 0, titles = [], buffs = [], buffActual = null, conditionals = [], items = [] } = {}) {
  const permanent = [{ label: "Pontos distribuídos", value: Number(points) || 0, kind: "points" }, ...titles];
  const total = sum(permanent);
  const temporary = [...withResidual(buffs, buffActual), ...conditionals];
  const effectiveTotal = total + sum(temporary);
  const bonus = Math.floor(effectiveTotal / 3);
  const { diceCount, flat } = computeAttributeDicePool(bonus);
  const itemBonus = sum(items);
  const fixed = flat + itemBonus;
  return {
    permanent,
    total,
    temporary,
    effectiveTotal,
    bonus,
    diceCount,
    flat,
    items,
    itemBonus,
    formula: fixed ? `${diceCount}d20${fixed > 0 ? "+" : "-"}${Math.abs(fixed)}` : `${diceCount}d20`,
    pending: Number(pending) || 0,
    previewBonus: pending ? Math.floor((effectiveTotal + Number(pending)) / 3) : null
  };
}

/**
 * Vida/Mana máxima: `max(piso, round(A.total × B.total × mult))` + modificadores permanentes +
 * buffs temporários; Vida nunca fica abaixo de 1, Mana nunca abaixo de 0.
 * @param {object} input
 * @param {Array<{label:string, total:number}>} input.pair - os dois atributos da fórmula
 * @param {number} input.multiplier
 * @param {number} input.floor
 * @param {Array} [input.permanent] - Títulos/Skills/Itens/Modificações (statModifiers)
 * @param {Array} [input.buffs] - Active Effects no `buffDelta` de Vida/Mana
 * @param {number} [input.buffActual]
 * @param {boolean} [input.enabled] - false = campanha sem esse pool (Mana desligada)
 * @param {number} [input.min] - 1 para Vida, 0 para Mana
 */
export function explainVital({ pair = [], multiplier = 1, floor = 0, permanent = [], buffs = [], buffActual = null, enabled = true, min = 0 } = {}) {
  if (!enabled) return { enabled: false, max: 0 };
  const [a = { total: 0 }, b = { total: 0 }] = pair;
  const product = (Number(a.total) || 0) * (Number(b.total) || 0);
  const formulaValue = Math.round(product * multiplier);
  const base = Math.max(floor, formulaValue);
  const temporary = withResidual(buffs, buffActual);
  const raw = base + sum(permanent) + sum(temporary);
  return {
    enabled: true,
    pair: [a, b],
    multiplier,
    floor,
    product,
    formulaValue,
    floorApplied: base > formulaValue,
    base,
    permanent,
    permanentTotal: sum(permanent),
    temporary,
    temporaryTotal: sum(temporary),
    min,
    minApplied: raw < min,
    max: Math.max(min, raw)
  };
}
