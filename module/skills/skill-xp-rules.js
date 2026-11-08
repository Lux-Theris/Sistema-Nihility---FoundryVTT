/**
 * XP por uso de Skill (`FEATURES.skillUseXp`), a parte pura e testada.
 *
 * A unidade é "um efeito do tamanho de uma Vida inteira" (`factor`). Cada coisa que a Skill fez
 * vira uma medida:
 *  - `{value, base}`: fração `|value| ÷ base`, limitada a 1 — dano/cura/Escudo sobre a Vida
 *    máxima do alvo, buff/debuff sobre o valor atual do que mudou, dano segurado por uma
 *    Estrutura sobre a Vida de quem ela protegeu;
 *  - `{flat: true}`: `flatPercent`% da unidade — Condição aplicada, Estrutura erguida, Zona criada.
 *  - `block: true` numa medida de valor: dano que um Escudo/Estrutura MANTIDO segurou, que rende
 *    só `blockPercent`% da fração (decisão do dono, 08/11: "fração do dano, não tudo, senão é
 *    muito XP muito rápido"). Escudo/Estrutura lançado uma vez rende só o fixo, ao surgir.
 *  - `buff: true` numa medida de valor: buff/debuff, que rende no máximo `buffCapPercent`% da
 *    unidade por alvo (decisão do dono, 08/11). Medido pelo valor atual, um +3 em quem tem 3 (ou
 *    0) valia uma Vida inteira e enchia o XP do nível 1 num uso só.
 *
 * Pelo mesmo motivo da XP de Resistência (`resistanceXpGain`): em fração, um golpe igualmente
 * perigoso vale a mesma XP em qualquer nível, e a curva quadrática de dano não infla a XP sozinha.
 */

/** Uma medida → fração da unidade (0–1, ou o % fixo; buff/debuff até o teto). */
export function measureFraction(measure, flatPercent = 10, buffCapPercent = 100, blockPercent = 100) {
  if (!measure) return 0;
  if (measure.flat) return Math.max(0, Number(flatPercent) || 0) / 100;
  const value = Math.abs(Number(measure.value) || 0);
  // Sem base (Nave sem Módulos tem Vida máxima 0): não há o que medir. Antes a base virava 1 e
  // qualquer dano enchia a XP de uma vez.
  const base = Number(measure.base) || 0;
  if (base <= 0) return 0;
  const fraction = Math.min(1, value / base);
  if (measure.block) return fraction * (Math.max(0, Number(blockPercent) || 0) / 100);
  return measure.buff ? Math.min(fraction, Math.max(0, Number(buffCapPercent) || 0) / 100) : fraction;
}

/**
 * XP de um uso (soma das medidas).
 * @param {Array<{value?:number, base?:number, flat?:boolean}>} measures
 * @param {{factor?:number, flatPercent?:number, buffCapPercent?:number, blockPercent?:number, cap?:number}} [cfg] - `cap` = teto opcional em XP
 */
export function skillUseXp(measures, { factor = 100, flatPercent = 10, buffCapPercent = 100, blockPercent = 100, cap = Infinity } = {}) {
  const total = (measures ?? []).reduce((sum, m) => sum + measureFraction(m, flatPercent, buffCapPercent, blockPercent), 0);
  return Math.max(0, Math.min(cap, Math.round(total * (Number(factor) || 0))));
}

/**
 * A medida de uma entrada de Efeito que acabou de pegar num alvo (não periódica — periódico conta
 * a cada tick). Null quando não há o que medir nem Condição.
 * @param {object} entry - com `amount` já escalado pelo nível
 * @param {{attributeTotal?:number|null, vitalMax?:number|null, percent?:boolean, hasCondition?:boolean}} ctx
 * @returns {Array<object>} zero, uma ou duas medidas (o número e a Condição contam separado)
 */
export function effectEntryMeasures(entry, { attributeTotal = null, vitalMax = null, percent = false, hasCondition = false } = {}) {
  const out = [];
  const amount = Number(entry?.amount) || 0;
  if (hasCondition) out.push({ flat: true });
  if (!amount) return out;
  if (attributeTotal !== null) out.push({ value: amount, base: attributeTotal, buff: true });
  // Vida/Mana sem Periódico é buff no MÁXIMO; Escudo é proteção (como cura), sem teto de buff.
  else if (vitalMax !== null) out.push(entry?.target === "shield" ? { value: amount, base: vitalMax } : { value: amount, base: vitalMax, buff: true });
  else if (percent) out.push({ value: amount, base: 100, buff: true });
  else if (!hasCondition) out.push({ flat: true });
  return out;
}
