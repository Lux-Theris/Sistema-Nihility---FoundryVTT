/**
 * Maldições (prancha 6) — regras PURAS, testadas.
 *
 * Uma Maldição é uma Condição do catálogo com `curse.enabled`: vários efeitos (atributo/Deslocamento
 * e dano/cura por rodada), sem prazo (só sai com Antimagia de nível que alcance, ou com o Mestre) e
 * um custo por rodada pago SEMPRE pela Mana da vítima. Quando a Mana não dá, a maldição faz o que
 * foi escolhido nela (ou a Skill que lançou troca só para ela):
 *  - "hp": o que faltou sai da Vida;
 *  - "sleep": os efeitos dormem até a vítima conseguir pagar inteiro de novo;
 *  - "worsen": cada rodada sem pagar soma `worsenStep` % nos efeitos, até `worsenCap` × (pagar de
 *    novo não desfaz);
 *  - "continue": nada além de a Mana ficar em 0.
 */

export const CURSE_UNPAID = ["hp", "sleep", "worsen", "continue"];
export const CURSE_UNPAID_LABELS = { hp: "Paga com Vida", sleep: "Dorme", worsen: "Piora", continue: "Continua igual" };

/** Molde salvo no catálogo → números limpos. */
export function normalizeCurse(curse = {}) {
  return {
    enabled: Boolean(curse?.enabled),
    effects: Array.isArray(curse?.effects) ? curse.effects.filter(e => e && (e.kind === "modifier" || e.kind === "tick")) : [],
    costPercent: Math.max(0, Number(curse?.costPercent) || 0),
    onUnpaid: CURSE_UNPAID.includes(curse?.onUnpaid) ? curse.onUnpaid : "hp",
    worsenStep: Math.max(0, Number(curse?.worsenStep ?? 25) || 0),
    worsenCap: Math.max(1, Number(curse?.worsenCap ?? 3) || 1)
  };
}

/**
 * Uma rodada de custo. A Mana é sempre consumida (até zerar); o que falta decide o resto.
 * @param {{energy:number, energyMax:number, costPercent:number, onUnpaid:string, factor?:number, worsenStep?:number, worsenCap?:number, sleeping?:boolean}} input
 * @returns {{energy:number, cost:number, paid:boolean, missing:number, hpLoss:number, sleeping:boolean, factor:number}}
 */
export function curseCostRound({ energy = 0, energyMax = 0, costPercent = 0, onUnpaid = "hp", factor = 1, worsenStep = 25, worsenCap = 3, sleeping = false }) {
  const cost = Math.max(0, Math.round(((Number(energyMax) || 0) * (Number(costPercent) || 0)) / 100));
  const have = Math.max(0, Number(energy) || 0);
  const paid = have >= cost;
  const missing = paid ? 0 : cost - have;
  const out = { energy: Math.max(0, have - cost), cost, paid, missing, hpLoss: 0, sleeping: false, factor: Math.max(1, Number(factor) || 1) };
  if (paid) return out;
  if (onUnpaid === "hp") out.hpLoss = missing;
  else if (onUnpaid === "sleep") out.sleeping = true;
  else if (onUnpaid === "worsen") out.factor = Math.min(Math.max(1, Number(worsenCap) || 1), out.factor + (Number(worsenStep) || 0) / 100);
  // "continue": nada. Quem dormia e não pagou continua dormindo.
  if (sleeping && onUnpaid === "sleep") out.sleeping = true;
  return out;
}

/** Valor de um efeito da maldição com a piora aplicada (arredondado; o sinal fica). */
export function curseScaled(value, factor = 1) {
  const v = Number(value) || 0;
  return Math.sign(v) * Math.round(Math.abs(v) * Math.max(1, Number(factor) || 1));
}
