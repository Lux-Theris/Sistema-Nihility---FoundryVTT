/**
 * Manipulação do tempo, parte pura (8e.1–8e.3): Acelerar e Desacelerar. Sem Foundry; o lado Foundry
 * (efeito, reserva, ganchos do combate) fica em `time-rate.js`. Testado em test/time-rate.test.mjs.
 *
 * O modelo do dono (22/11):
 *  - **Fator** N do efeito "Ritmo do tempo": N > 1 acelera, N < 1 desacelera, 1 não muda nada.
 *  - **Reserva de tempo** (só em combate, só com N > 1): vale N (parte inteira) e volta a N a cada turno
 *    do dono; o que sobra se perde. A **fração acumula** (×2,5 dá 2, depois 3, depois 2…), guardada em
 *    `timeCarry`. Desacelerado (N < 1) não tem reserva: os contadores andam `floor(N + sobra)` vezes por
 *    turno (×½: 0, 1, 0, 1…).
 *  - **Números por turno** (Veneno, regeneração, custo das Ativas, Radiação, Vida 0) passam até N turnos,
 *    **limitados pela própria duração**, simulados em memória (`simulateTicks`).
 *  - **Estados** (buff/debuff, Condições de controle) andam por reserva gasta: ver `spendExtra`.
 *  - **Alvo mais forte** enfraquece o efeito (`timeStrength`), por uma reta própria (não a do bloqueio de cura).
 */

/** Limites do fator aceito (fora disso, o mais próximo). */
export const TIME_FACTOR_MIN = 0.01;
export const TIME_FACTOR_MAX = 1000;

const EPS = 1e-9;

/** Um fator válido (finito, dentro dos limites); lixo vira 1 (não muda nada). */
export function clampTimeFactor(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(TIME_FACTOR_MAX, Math.max(TIME_FACTOR_MIN, n));
}

/** O fator vale alguma coisa (≠ 1)? */
export function isTimeFactorActive(factor) {
  return Math.abs(clampTimeFactor(factor) - 1) > 1e-6;
}

/** Os fatores de vários efeitos juntos (produto, nos limites). */
export function composeTimeFactors(list = []) {
  let product = 1;
  for (const f of list) product *= clampTimeFactor(f);
  return clampTimeFactor(product);
}

/**
 * Quanto do efeito pega num alvo de nível `targetLevel` vindo de uma Skill de nível `skillLevel`:
 * 1 (cheio) até o nível da Skill; acima, cai em linha reta e zera quando o alvo tem o DOBRO do nível da Skill.
 */
export function timeStrength(skillLevel, targetLevel) {
  const skill = Math.max(1, Number(skillLevel) || 0);
  const target = Math.max(0, Number(targetLevel) || 0);
  if (target <= skill) return 1;
  return Math.min(1, Math.max(0, 2 - target / skill));
}

/** O fator depois de enfraquecido: anda em direção a 1 (strength 1 = cheio; 0 = nada). */
export function weakenTimeFactor(factor, strength) {
  const f = clampTimeFactor(factor);
  const s = Math.min(1, Math.max(0, Number(strength) || 0));
  return clampTimeFactor(1 + (f - 1) * s);
}

/**
 * Passos de um turno: `rate` + a fração que sobrou de antes, parte inteira = passos; o resto fica.
 * @returns {{steps:number, carry:number}}
 */
export function rateSteps(rate, carry = 0) {
  const total = clampTimeFactor(rate) + Math.max(0, Number(carry) || 0);
  const steps = Math.floor(total + EPS);
  const rest = Math.max(0, total - steps);
  return { steps, carry: rest < EPS ? 0 : Math.round(rest * 1e9) / 1e9 };
}

/** O que o turno dá, pelo fator: reserva (Acelerado), passos dos contadores e a sobra. */
export function timeTurnPlan(factor, carry = 0) {
  const f = clampTimeFactor(factor);
  const { steps, carry: rest } = rateSteps(f, carry);
  if (!isTimeFactorActive(f)) return { kind: "normal", factor: 1, steps: 1, reserve: 0, carry: 0 };
  if (f > 1) return { kind: "fast", factor: f, steps, reserve: steps, carry: rest };
  return { kind: "slow", factor: f, steps, reserve: 0, carry: rest };
}

/** Quantos turnos um número por turno passa: até `steps`, limitado ao que resta de duração (Ativa: só `steps`). */
export function allowedTicks({ steps = 1, remaining = 0, anchored = false } = {}) {
  const s = Math.max(0, Math.floor(Number(steps) || 0));
  if (anchored) return s;
  return Math.max(0, Math.min(s, Math.floor(Number(remaining) || 0)));
}

/**
 * Simula `ticks` ticks de um número por turno, em memória. `delta` negativo (dano): para quando a Vida
 * chega a 0 (esse tick conta). Positivo (cura): trava no `ceiling`.
 * @returns {{value:number, done:number, total:number}} `total` = soma realmente aplicada (com sinal)
 */
export function simulateTicks({ value, delta, ticks, ceiling = Infinity, floor = 0 }) {
  let current = Number(value) || 0;
  const start = current;
  const d = Number(delta) || 0;
  const cap = Math.max(current, Number.isFinite(ceiling) ? ceiling : Infinity);
  let done = 0;
  for (let i = 0; i < Math.max(0, Math.floor(ticks)); i++) {
    current = Math.min(cap, Math.max(floor, current + d));
    done++;
    if (d < 0 && current <= floor) break;
  }
  return { value: current, done, total: current - start };
}

/**
 * Estados contam por reserva gasta: o turno do mundo já conta 1 (o núcleo), então o 1º de tempo vivido não
 * rende extra. `spentBefore` = o que já se gastou (e contou) neste turno; `amount` = o que se gasta agora.
 * Gastar tudo (gasto + o que sobra no fim) rende `N − 1` rodadas a mais nos estados.
 */
export function spendExtra(spentBefore, amount) {
  const before = Math.max(0, Number(spentBefore) || 0);
  const add = Math.max(0, Number(amount) || 0);
  return Math.max(0, before + add - 1) - Math.max(0, before - 1);
}

/** Tira `amount` da reserva (sem ir abaixo de 0). */
export function reserveAfterSpend(value, amount) {
  return Math.max(0, (Number(value) || 0) - Math.max(0, Number(amount) || 0));
}

/** A reserva cobre `cost`? */
export function reserveCovers(value, cost) {
  const need = Math.max(0, Math.floor(Number(cost) || 0));
  return need > 0 && (Number(value) || 0) >= need;
}

/** Texto do fator: "×3", "×2,5", "×½"… */
export function describeTimeFactor(factor) {
  const f = clampTimeFactor(factor);
  if (Math.abs(f - 0.5) < 1e-9) return "×½";
  const text = Number.isInteger(f) ? String(f) : String(Math.round(f * 1000) / 1000).replace(".", ",");
  return `×${text}`;
}

/** "Acelerado ×3" / "Desacelerado ×½" / "" quando não muda. */
export function timeStateLabel(factor) {
  const f = clampTimeFactor(factor);
  if (!isTimeFactorActive(f)) return "";
  return `${f > 1 ? "Acelerado" : "Desacelerado"} ${describeTimeFactor(f)}`;
}

/** A linha da reserva: "95 de tempo restante" (de N). */
export function reserveText(value, max) {
  return `${Math.max(0, Math.floor(Number(value) || 0))} de tempo restante${max ? ` (de ${Math.floor(Number(max))})` : ""}`;
}

/** Deslocamento do turno vezes o fator (Acelerado anda mais, Desacelerado menos). */
export function scaledMovement(budget, factor) {
  const b = Number(budget);
  if (!Number.isFinite(b)) return budget;
  return b * clampTimeFactor(factor);
}

/**
 * Passo de um estado com prazo: gasta `extra` rodadas dele; devolve o que sobra e se acabou.
 * `remaining` = rodadas que faltam (> 0).
 */
export function advanceState(remaining, extra) {
  const left = Math.max(0, Math.floor(Number(remaining) || 0)) - Math.max(0, Math.floor(Number(extra) || 0));
  return { remaining: Math.max(0, left), expired: left <= 0 };
}

/** O que o aviso do começo do turno diz: "Kael está Acelerado ×2: tem 2 de tempo neste turno." */
export function turnNoticeText(name, plan, passed = []) {
  const label = timeStateLabel(plan.factor);
  if (!label) return "";
  const head = plan.kind === "fast"
    ? `${name} está ${label}: tem ${plan.reserve} de tempo neste turno.`
    : plan.steps > 0
      ? `${name} está ${label}: neste turno o tempo dele anda.`
      : `${name} está ${label}: neste turno o tempo dele não anda.`;
  return passed.length ? `${head} ${passed.join(" ")}` : head;
}

/** Cadência (ações por turno) de um combatente no Simulador de encontro: a cadência × o fator. */
export function scaledCadence(cadence, factor) {
  const c = Number(cadence);
  if (!Number.isFinite(c)) return cadence;
  return c * clampTimeFactor(factor);
}

/** Custo, em reserva, de limpar uma Recarga que falta `stored` (o valor guardado, já com o +1). */
export function cooldownReserveCost(stored) {
  return Math.max(0, Math.floor(Number(stored) || 0));
}

/** Custo, em reserva, de um Preparo de P rodadas disparado na hora. */
export function prepReserveCost(turns) {
  return Math.max(0, Math.floor(Number(turns) || 0));
}
