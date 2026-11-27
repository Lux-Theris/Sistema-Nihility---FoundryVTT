/**
 * Refletir X% (1.123.0), regras puras e testadas (`test/magic-pieces.test.mjs`).
 *
 * Efeito de Skill (alvo `reflect`): enquanto dura, quem o tem devolve a quem atacou uma parte do dano que recebeu.
 * Sai no **Aplicar** do card de dano (o Mestre confirma o acerto) como um card novo contra **quem atacou**, com os
 * mesmos botões de Aplicar/Desfazer; Desfazer o golpe original apaga (ou desfaz) o reflexo junto. O que volta:
 *  - por padrão, X% do que o golpe tirou de quem reflete (Escudo + Vida);
 *  - com "só o que o Escudo absorveu" (o Escudo que reflete, o par do Proteger + Inverter do plano), só X% do que o
 *    Escudo segurou.
 * Um reflexo nunca reflete de novo (sem ping-pong), e o Dano Absoluto continua Absoluto na volta.
 */

/** Teto do campo (% do dano). */
export const MAX_REFLECT = 100;

/** O percentual guardado: inteiro de 0 a 100. */
export function normalizeReflect(value) {
  const n = Math.round(Number(value) || 0);
  return Math.min(MAX_REFLECT, Math.max(0, n));
}

/**
 * O flag que o Active Effect de Refletir carrega: `{percent, shieldOnly}`, ou null sem percentual.
 * @param {{amount?: number, reflectShieldOnly?: boolean}} entry
 */
export function reflectFlagFrom(entry) {
  const percent = normalizeReflect(entry?.amount);
  return percent > 0 ? { percent, shieldOnly: Boolean(entry?.reflectShieldOnly) } : null;
}

/**
 * Quanto volta para quem atacou: a soma do que cada Refletir ligado devolve, nunca mais que o dano recebido.
 * @param {Array<{percent:number, shieldOnly?:boolean}>} reflects - os flags `reflect` dos efeitos ligados de quem reflete
 * @param {{toShield?: number, toHp?: number}} hit - o que o golpe tirou de quem reflete (já aplicado)
 * @returns {number} inteiro ≥ 0
 */
export function reflectedAmount(reflects, { toShield = 0, toHp = 0 } = {}) {
  const shield = Math.max(0, Math.round(Number(toShield) || 0));
  const total = shield + Math.max(0, Math.round(Number(toHp) || 0));
  if (!(total > 0)) return 0;
  let sum = 0;
  for (const r of reflects ?? []) {
    const percent = normalizeReflect(r?.percent);
    if (!percent) continue;
    sum += Math.round(((r.shieldOnly ? shield : total) * percent) / 100);
  }
  return Math.min(total, Math.max(0, sum));
}

/** "Reflete 30% do dano que recebe" / "Reflete 30% do que o Escudo segura". */
export function reflectSentence(percent, shieldOnly = false) {
  return `reflete ${normalizeReflect(percent)}% ${shieldOnly ? "do que o Escudo segura" : "do dano que recebe"}`;
}

/** A linha do card de quem refletiu: "Refletiu 6 de volta para Kael". */
export function reflectResultText({ amount = 0, attackerName = "" } = {}) {
  return amount > 0 ? `Refletiu ${amount} de volta para ${attackerName}` : "";
}

/** O rótulo do card refletido, a partir do rótulo do golpe original. */
export function reflectLabel(originalLabel = "") {
  return originalLabel ? `${originalLabel} (refletido)` : "Dano refletido";
}
