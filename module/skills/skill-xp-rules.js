/**
 * XP por uso de Skill (`FEATURES.skillUseXp`), a parte pura e testada.
 *
 * A unidade é "um efeito do tamanho de uma Vida inteira" (`factor`). Cada coisa que a Skill fez
 * vira uma medida:
 *  - `{value, base}`: fração `|value| ÷ base`, limitada a 1 — dano/cura/Escudo sobre a Vida
 *    máxima do alvo, buff/debuff sobre o valor atual do que mudou, dano segurado por uma
 *    Estrutura sobre a Vida de quem ela protegeu;
 *  - `{flat: true}`: `flatPercent`% da unidade — Condição aplicada, Estrutura erguida, Zona criada.
 *
 * Pelo mesmo motivo da XP de Resistência (`resistanceXpGain`): em fração, um golpe igualmente
 * perigoso vale a mesma XP em qualquer nível, e a curva quadrática de dano não infla a XP sozinha.
 */

/** Uma medida → fração da unidade (0–1, ou o % fixo). */
export function measureFraction(measure, flatPercent = 10) {
  if (!measure) return 0;
  if (measure.flat) return Math.max(0, Number(flatPercent) || 0) / 100;
  const value = Math.abs(Number(measure.value) || 0);
  const base = Math.max(1, Number(measure.base) || 0);
  return Math.min(1, value / base);
}

/**
 * XP de um uso (soma das medidas).
 * @param {Array<{value?:number, base?:number, flat?:boolean}>} measures
 * @param {{factor?:number, flatPercent?:number, cap?:number}} [cfg] - `cap` = teto opcional em XP
 */
export function skillUseXp(measures, { factor = 100, flatPercent = 10, cap = Infinity } = {}) {
  const total = (measures ?? []).reduce((sum, m) => sum + measureFraction(m, flatPercent), 0);
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
  if (attributeTotal !== null) out.push({ value: amount, base: attributeTotal });
  else if (vitalMax !== null) out.push({ value: amount, base: vitalMax });
  else if (percent) out.push({ value: amount, base: 100 });
  else if (!hasCondition) out.push({ flat: true });
  return out;
}
