/**
 * Resistência a Condição (1.119.0), regras puras e testadas (`test/condition-resist.test.mjs`).
 *
 * "Resistência não significa imunidade": quem resiste X% demora mais para pegar a Condição e, quando pega, ela vem
 * mais fraca. Cada **exposição** (Skill ou efeito que aplicaria a Condição, cada rodada dentro de uma Região ou
 * ambiente que a aplica, Contágio, reação, superfície, Armadilha) soma `1 − X` (X de 0 a 1) num contador por Ator e
 * por Condição; a Condição **pega quando o contador chega a 1** (30% pega na 2ª exposição, 75% na 4ª, 90% na 10ª).
 * Ao pegar, a força (dano ou cura por rodada e qualquer número do efeito) e a duração (rodadas) saem × (1 − X),
 * arredondadas; Condição sem número (Medo, Cegueira) só demora. O contador zera ao pegar e depois de algumas rodadas
 * sem nova exposição. Imune nunca pega. O "Fura imunidade e resistência a Condição" do efeito ignora tudo isto.
 *
 * Nada aqui toca o Foundry: o estado de um contador é `{count, hits, combatId, round, time}` e quem chama o grava
 * no Ator (`condition-guard.js`).
 */

/** Rodadas sem exposição que zeram o contador (Regras da Mesa: `conditionResistResetRounds`). */
export const DEFAULT_RESET_ROUNDS = 3;
/** Fora de combate uma "rodada" vale isto, em segundos (o relógio real; o do mundo pode nem andar). */
export const OUT_OF_COMBAT_ROUND_SECONDS = 6;

const EPS = 1e-6;
const round6 = n => Math.round(n * 1e6) / 1e6;

/** X (0 a 1) a partir da porcentagem 0 a 100 da origem. */
export function resistFraction(percent) {
  const n = Number(percent);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : 0;
}

/** Quantas exposições até pegar: o menor n com n × (1 − X) ≥ 1. Sem resistência é 1; imune nunca (Infinity). */
export function exposureNeeded(fraction) {
  const x = Math.min(1, Math.max(0, Number(fraction) || 0));
  if (x >= 1) return Infinity;
  if (x <= 0) return 1;
  return Math.max(1, Math.ceil(1 / (1 - x) - EPS));
}

/**
 * O contador guardado já venceu? Zera depois de `resetRounds` rodadas sem exposição (o mesmo combate), na troca de
 * combate (ou de dentro para fora dele), e fora de combate quando passaram `resetRounds` × 6 s de relógio real.
 * @param {{combatId?:string, round?:number, time?:number}|null} prev
 * @param {{combatId?:string, round?:number, time?:number}} now
 */
export function exposureExpired(prev, now, { resetRounds = DEFAULT_RESET_ROUNDS } = {}) {
  if (!prev || !(Number(prev.count) > 0)) return true;
  const limit = Math.max(1, Number(resetRounds) || DEFAULT_RESET_ROUNDS);
  const prevCombat = prev.combatId ?? "";
  const nowCombat = now?.combatId ?? "";
  if (prevCombat !== nowCombat) return true;
  if (nowCombat) return (Number(now.round) || 0) - (Number(prev.round) || 0) > limit;
  return (Number(now?.time) || 0) - (Number(prev.time) || 0) > limit * OUT_OF_COMBAT_ROUND_SECONDS * 1000;
}

/** A mesma "rodada" da exposição anterior? (o ambiente conta uma vez por rodada, sem rolar a cada passo) */
export function sameExposureWindow(prev, now) {
  if (!prev) return false;
  const nowCombat = now?.combatId ?? "";
  if ((prev.combatId ?? "") !== nowCombat) return false;
  if (nowCombat) return (Number(now.round) || 0) === (Number(prev.round) || 0);
  return (Number(now?.time) || 0) - (Number(prev.time) || 0) < OUT_OF_COMBAT_ROUND_SECONDS * 1000;
}

/**
 * Soma uma exposição. `dedupe` (ambiente) ignora a segunda exposição da mesma rodada.
 * @param {object|null} prev - o contador guardado (ou null)
 * @param {{combatId?:string, round?:number, time?:number}} now
 * @param {{resistPercent:number, resetRounds?:number, dedupe?:boolean}} options
 * @returns {{lands:boolean, duplicate:boolean, count:number, hits:number, needed:number, fraction:number, factor:number, next:object|null}}
 *   `factor` = 1 − X (o que a força e a duração levam quando pega); `next` = o contador a gravar (null = apagar).
 */
export function stepExposure(prev, now, { resistPercent = 0, resetRounds = DEFAULT_RESET_ROUNDS, dedupe = false } = {}) {
  const fraction = resistFraction(resistPercent);
  const needed = exposureNeeded(fraction);
  const factor = 1 - fraction;
  if (fraction <= 0) return { lands: true, duplicate: false, count: 1, hits: 1, needed: 1, fraction, factor: 1, next: null };
  const expired = exposureExpired(prev, now, { resetRounds });
  if (!expired && dedupe && sameExposureWindow(prev, now)) {
    return { lands: false, duplicate: true, count: Number(prev.count) || 0, hits: Number(prev.hits) || 0, needed, fraction, factor, next: prev };
  }
  const count = round6((expired ? 0 : Number(prev.count) || 0) + factor);
  const hits = (expired ? 0 : Number(prev.hits) || 0) + 1;
  const lands = count >= 1 - EPS;
  return {
    lands,
    duplicate: false,
    count,
    hits,
    needed,
    fraction,
    factor,
    next: lands ? null : { count, hits, combatId: now?.combatId ?? "", round: Number(now?.round) || 0, time: Number(now?.time) || 0 }
  };
}

/** Uma entrada de efeito com a força e a duração × (1 − X): inteiro, nunca zera um número que não era zero; rodadas no mínimo 1. */
export function scaleEntryByResistance(entry, fraction) {
  const keep = 1 - Math.min(1, Math.max(0, Number(fraction) || 0));
  const scale = value => {
    const n = Number(value) || 0;
    if (!n) return 0;
    const r = Math.round(n * keep);
    return r === 0 ? Math.sign(n) : r;
  };
  const rounds = Number(entry?.durationRounds) || 0;
  return {
    ...entry,
    amount: scale(entry?.amount),
    durationRounds: rounds > 0 ? Math.max(1, Math.round(rounds * keep)) : rounds,
    ...(Number(entry?.hitDamage) ? { hitDamage: Math.max(0, Math.round(Number(entry.hitDamage) * keep)) } : {})
  };
}

/** "0,7" (até 2 casas, vírgula). */
export function exposureNumber(value) {
  return String(round6(Number(value) || 0).toFixed(2).replace(/\.?0+$/, "")).replace(".", ",") || "0";
}

/** A linha de chat de uma exposição que não pegou: "Anão resiste ao Veneno (30%): exposição 0,7 de 1. Pega na próxima." */
export function resistExposureText({ actorName, conditionLabel, resistPercent, count, hits, needed }) {
  const nextLands = round6(count + (1 - resistFraction(resistPercent))) >= 1 - EPS;
  const tail = nextLands ? "Pega na próxima." : `Faltam ${Math.max(1, needed - hits)} exposições.`;
  return `${actorName} resiste ao ${conditionLabel} (${Math.round(Number(resistPercent) || 0)}%): exposição ${exposureNumber(count)} de 1. ${tail}`;
}

/** O texto que sobe do Token: "Resistindo: Veneno (1/2)" ou, para quem é imune, "Imune: Veneno". */
export function resistFloatText({ kind, conditionLabel, hits, needed }) {
  if (kind === "immune") return `Imune: ${conditionLabel}`;
  return `Resistindo: ${conditionLabel} (${hits}/${needed})`;
}

/** A linha de chat de uma Condição que não pegou por imunidade. */
export function immuneBlockText({ conditionLabel, actorName }) {
  return `${conditionLabel} não pegou em ${actorName}: imune`;
}

/**
 * A linha de chat de uma Condição que pegou depois de resistir: "Anão pegou Veneno com força e duração −30%: 7 por
 * rodada, 2 rodadas (era 10 por 3)." Sem número no efeito, só diz que demorou.
 * @param {{amount:number, rounds:number, periodic?:boolean}} before
 * @param {{amount:number, rounds:number}} after
 */
export function resistLandedText({ actorName, conditionLabel, resistPercent, before, after, periodic = false }) {
  const pct = Math.round(Number(resistPercent) || 0);
  const hasNumber = Boolean(Number(before?.amount));
  const hasRounds = Number(before?.rounds) > 0;
  if (!hasNumber && !hasRounds) return `${actorName} pegou ${conditionLabel}, mas só depois de resistir (${pct}%).`;
  const unit = n => `${n} ${n === 1 ? "rodada" : "rodadas"}`;
  const describe = state => [hasNumber ? `${state.amount}${periodic ? " por rodada" : ""}` : "", hasRounds ? unit(state.rounds) : ""].filter(Boolean).join(", ");
  const what = hasNumber && hasRounds ? "força e duração" : hasNumber ? "força" : "duração";
  // Quadro aprovado: "(era 10 por 3)" = 10 por rodada durante 3 rodadas.
  const was = hasNumber && hasRounds ? `${before.amount} por ${before.rounds}` : describe(before);
  return `${actorName} pegou ${conditionLabel} com ${what} −${pct}%: ${describe(after)} (era ${was}).`;
}
