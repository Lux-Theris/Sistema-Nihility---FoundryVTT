/**
 * Manipulação do tempo, lado Foundry (8e.1–8e.3): o efeito "Ritmo do tempo" (Acelerar e Desacelerar), a
 * reserva de tempo em combate e o tempo pessoal fora dele. As contas são puras, em `time-rate-rules.js`.
 *
 * O efeito é um Active Effect com `flags.<sistema>.timeRate = {factor}` (o fator JÁ enfraquecido pelo nível do
 * alvo), criado por `applyEffectsToActor` com `sourceLevel`/`magic`/`tech` como os outros (a Antimagia e o PEM
 * o apagam pelo nível). O fator de uma pessoa é o produto dos efeitos ligados nela (`actorTimeFactor`), e entra
 * em `personalRateFactors` (world-time.js): fora de combate o tempo pessoal anda ×N.
 *
 * Em combate (`updateCombat`, Mestre designado, início do turno do dono):
 *  - `beginTimeTurn`: Acelerado ganha a **reserva** (flag `timeReserve` = `{value, max, spent, factor}`) e a
 *    fração sobra em `timeCarry`; Desacelerado não tem reserva e `steps` é 0 ou 1 (contadores andam à metade).
 *    Os "números por turno" (periódicos, regeneração, custo das Ativas, Radiação, Vida 0) recebem `steps`.
 *  - Estados (buffs, debuffs, Condições de controle) andam por reserva gasta: `spendReserve` e, no fim do turno,
 *    `endTimeTurn` (o que sobrou também conta). O turno do mundo já conta 1; só o resto rende rodadas a mais.
 *  - Preparo e Recarga são pagos pela reserva quando ela basta (`payPreparationFromReserve`,
 *    `payCooldownFromReserve`); `useBlockReason` (preparation.js) já não barra quando a reserva cobre.
 *  - O aviso do começo do turno (Voz do Mundo, público) diz o que passou.
 */
import { SYSTEM_ID } from "../core/config.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { effectDurationRounds, effectStartRound, effectRoundsUpdate, deleteKeyUpdate } from "../helpers/foundry-compat.js";
import {
  composeTimeFactors, isTimeFactorActive, timeTurnPlan, spendExtra, reserveAfterSpend, reserveCovers, advanceState,
  timeStateLabel, turnNoticeText, cooldownReserveCost, prepReserveCost
} from "./time-rate-rules.js";

export const TIME_FLAG = "timeRate";
export const RESERVE_FLAG = "timeReserve";
export const CARRY_FLAG = "timeCarry";

/* ------------------------------------------------------------------ Leitura */

/** Os efeitos de Ritmo do tempo ligados no Ator. */
export function timeEffectsOf(actor) {
  return actor?.effects?.filter(e => !e.disabled && e.flags?.[SYSTEM_ID]?.[TIME_FLAG]) ?? [];
}

/** O fator de tempo do Ator (produto dos efeitos; 1 = normal). Nave/Veículo nunca têm. */
export function actorTimeFactor(actor) {
  if (!actor || ["starship", "vehicle"].includes(actor.type)) return 1;
  const list = timeEffectsOf(actor).map(e => e.flags[SYSTEM_ID][TIME_FLAG].factor);
  return list.length ? composeTimeFactors(list) : 1;
}

/** A reserva do turno: `{value, max, spent, factor}` ou null. */
export function reserveOf(actor) {
  const r = actor?.getFlag?.(SYSTEM_ID, RESERVE_FLAG);
  return r && typeof r === "object" ? { value: Number(r.value) || 0, max: Number(r.max) || 0, spent: Number(r.spent) || 0, factor: Number(r.factor) || 1 } : null;
}

/** Quanto tem de reserva agora (0 sem reserva). Síncrono: lê o flag. */
export function reserveValue(actor) {
  return reserveOf(actor)?.value ?? 0;
}

function carryOf(actor) {
  return Math.max(0, Number(actor?.getFlag?.(SYSTEM_ID, CARRY_FLAG)) || 0);
}

export function startedCombatOf(actor) {
  return game.combats?.find(c => c.started && c.combatants.some(cb => cb.actor?.uuid === actor?.uuid)) ?? null;
}

/* ------------------------------------------------------------------ Estados (prazos dos efeitos) */

/** O efeito é um "estado" que anda por tempo vivido (buff, debuff, Condição de controle)? */
function isStateEffect(effect) {
  const f = effect.flags?.[SYSTEM_ID];
  if (!f?.skillEffect || effect.disabled) return false;
  if (f.periodic || f.preparing || f[TIME_FLAG] || f.tiedToActive || f.curse) return false;
  if ((f.activeAnchors ?? []).length) return false;
  return effectDurationRounds(effect) > 0;
}

export function roundsLeft(effect, combat) {
  const total = effectDurationRounds(effect);
  const start = effectStartRound(effect);
  const elapsed = combat && start != null ? Math.max(0, (combat.round ?? 0) - start) : 0;
  return Math.max(0, total - elapsed);
}

/** Tira `extra` rodadas dos estados do Ator (apaga o que acabou). */
async function advanceStates(actor, extra, combat) {
  const n = Math.floor(Number(extra) || 0);
  if (n <= 0 || !actor) return [];
  const done = [];
  for (const effect of actor.effects.filter(isStateEffect)) {
    const left = roundsLeft(effect, combat);
    if (left <= 0) continue;
    const next = advanceState(left, n);
    try {
      if (next.expired) await effect.delete();
      else await effect.update(effectRoundsUpdate(next.remaining, { combat }));
      done.push({ name: effect.name, left: next.remaining, expired: next.expired });
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Tempo: não consegui andar o prazo de "${effect.name}".`, err);
    }
  }
  return done;
}

/** Desacelerado: num turno em que o tempo dele não anda, os prazos ganham 1 rodada (o núcleo contou uma). */
async function delayStates(actor, combat) {
  for (const effect of actor.effects.filter(isStateEffect)) {
    const left = roundsLeft(effect, combat);
    if (left <= 0) continue;
    try {
      await effect.update(effectRoundsUpdate(left + 1, { combat }));
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Tempo: não consegui segurar o prazo de "${effect.name}".`, err);
    }
  }
}

/* ------------------------------------------------------------------ Turno */

async function writeReserve(actor, reserve, carry) {
  const update = { [`flags.${SYSTEM_ID}.${RESERVE_FLAG}`]: reserve };
  if (carry !== undefined) update[`flags.${SYSTEM_ID}.${CARRY_FLAG}`] = carry;
  await actor.update(update);
}

async function clearReserve(actor, { carry = true } = {}) {
  const update = {};
  if (actor.getFlag(SYSTEM_ID, RESERVE_FLAG) !== undefined) Object.assign(update, deleteKeyUpdate(`flags.${SYSTEM_ID}.${RESERVE_FLAG}`));
  if (carry && actor.getFlag(SYSTEM_ID, CARRY_FLAG) !== undefined) Object.assign(update, deleteKeyUpdate(`flags.${SYSTEM_ID}.${CARRY_FLAG}`));
  if (Object.keys(update).length) await actor.update(update);
}

/**
 * Começo do turno do dono. Devolve o plano (`steps` = quantas vezes os números por turno passam neste turno).
 * Sem efeito de tempo: 1 passo, e qualquer reserva velha some.
 */
export async function beginTimeTurn(combat, actor) {
  const normal = { kind: "normal", factor: 1, steps: 1, reserve: 0, carry: 0 };
  if (!actor || ["starship", "vehicle"].includes(actor.type)) return normal;
  const factor = actorTimeFactor(actor);
  if (!isTimeFactorActive(factor)) {
    await clearReserve(actor);
    return normal;
  }
  const plan = timeTurnPlan(factor, carryOf(actor));
  if (plan.kind === "fast") await writeReserve(actor, { value: plan.reserve, max: plan.reserve, spent: 0, factor: plan.factor }, plan.carry);
  else {
    await clearReserve(actor, { carry: false });
    await actor.update({ [`flags.${SYSTEM_ID}.${CARRY_FLAG}`]: plan.carry });
    if (plan.steps === 0) await delayStates(actor, combat);
  }
  return plan;
}

/** Fim do turno do dono (visto no começo do próximo): a reserva que sobrou também conta nos estados. */
export async function endTimeTurn(combat, actor) {
  const reserve = reserveOf(actor);
  if (!reserve || reserve.value <= 0) return [];
  const extra = spendExtra(reserve.spent, reserve.value);
  await writeReserve(actor, { ...reserve, value: 0, spent: reserve.spent + reserve.value });
  return advanceStates(actor, extra, combat);
}

/** Quem terminou o turno agora (o combatente anterior), para `endTimeTurn`. */
export function previousActorOf(combat) {
  const id = combat?.previous?.combatantId;
  return id ? combat.combatants?.get(id)?.actor ?? null : null;
}

/** Gasta `amount` da reserva (o que houver) e anda os estados pelo que isso rende. Devolve o gasto. */
export async function spendReserve(actor, amount) {
  const reserve = reserveOf(actor);
  const want = Math.max(0, Math.floor(Number(amount) || 0));
  if (!reserve || reserve.value <= 0 || !want) return 0;
  const take = Math.min(reserve.value, want);
  const extra = spendExtra(reserve.spent, take);
  await writeReserve(actor, { ...reserve, value: reserveAfterSpend(reserve.value, take), spent: reserve.spent + take });
  if (extra > 0) await advanceStates(actor, extra, startedCombatOf(actor));
  return take;
}

/** O botão do Mestre no Painel do combate: tira `amount` da reserva (−1, −X). Só o Mestre. */
export async function adjustReserve(actor, amount) {
  if (!game.user?.isGM || !actor) return 0;
  const reserve = reserveOf(actor);
  if (!reserve) return 0;
  const taken = await spendReserve(actor, amount);
  if (taken) {
    await ChatMessage.create({
      whisper: game.users.filter(u => u.isGM).map(u => u.id),
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${escapeHtml(actor.name)}</strong> gastou ${taken} de tempo (sobram ${Math.max(0, reserve.value - taken)}).</p>`
    });
  }
  return taken;
}

/* ------------------------------------------------------------------ Preparo e Recarga pagos pela reserva */

/**
 * Recarga que a reserva paga (nova ou de antes): quanto falta (o valor guardado, com o +1) vira custo.
 * Devolve o custo se a reserva cobre, senão 0.
 */
export function cooldownCoveredByReserve(actor, stored) {
  const cost = cooldownReserveCost(stored);
  return cost > 0 && reserveCovers(reserveValue(actor), cost) ? cost : 0;
}

/** Um Preparo de `turns` rodadas disparado na hora pela reserva (0 = a reserva não cobre). */
export function prepCoveredByReserve(actor, turns) {
  const cost = prepReserveCost(turns);
  return cost > 0 && reserveCovers(reserveValue(actor), cost) ? cost : 0;
}

/** Paga a Recarga pela reserva: zera o contador da Skill. Devolve true se pagou. */
export async function payCooldownFromReserve(actor, skill, stored, update) {
  const cost = cooldownCoveredByReserve(actor, stored);
  if (!cost) return false;
  await spendReserve(actor, cost);
  await skill.update(update);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${escapeHtml(actor.name)}</strong> usa <strong>${escapeHtml(skill.name)}</strong> de novo: a recarga foi paga pela reserva de tempo (−${cost}).</p>`
  });
  return true;
}

/** Nota no chat de um Preparo que saiu na hora pela reserva. */
export async function noteReservePrep(actor, label, cost) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${escapeHtml(actor.name)}</strong> usou <strong>${escapeHtml(label)}</strong> na hora: o preparo foi pago pela reserva de tempo (−${cost}).</p>`
  });
}

/* ------------------------------------------------------------------ Aviso na tela */

/**
 * O aviso do começo do turno (Voz do Mundo, público): "X está Acelerado ×N" e o que passou por turno.
 * `notes` = `[{label, text}]` coletados pelos números por turno.
 */
export async function announceTimeTurn(actor, plan, notes = []) {
  if (!actor || plan.kind === "normal") return;
  const lines = notes.map(n => `${n.label}: ${n.text}`);
  const title = timeStateLabel(plan.factor) ? `${actor.name} está ${timeStateLabel(plan.factor)}` : actor.name;
  const body = turnNoticeText(actor.name, plan, lines.length ? ["O que acontecia por turno já passou."] : []);
  const rows = notes.map(n => `<tr><td>${escapeHtml(n.label)}</td><td class="mono">${escapeHtml(n.text)}</td></tr>`).join("");
  const content = `<div class="nihility-time-notice"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p>${rows ? `<table><tbody>${rows}</tbody></table>` : ""}${plan.kind === "fast" ? "<p class=\"hint\">Quantas ações ele faz, o Mestre decide.</p>" : ""}</div>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    flags: { [SYSTEM_ID]: { voiceOfTheWorld: true, kind: "time", title, body: [body, ...lines].join(" ") } }
  });
}

/* ------------------------------------------------------------------ Ganchos */

/** O Ator de um efeito de tempo (ou null). */
function timeEffectActor(effect) {
  if (!effect?.flags?.[SYSTEM_ID]?.[TIME_FLAG]) return null;
  const actor = effect.parent;
  return actor?.documentName === "Actor" ? actor : null;
}

async function resyncPersonal(actor) {
  try {
    const { syncPersonalTime } = await import("../core/world-time.js");
    await syncPersonalTime(actor);
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Tempo: não consegui ajustar o tempo pessoal de "${actor.name}".`, err);
  }
}

/** O efeito acabou de nascer em quem é o combatente da vez: a reserva já vale neste turno. */
async function grantReserveNow(actor) {
  const combat = startedCombatOf(actor);
  if (!combat || combat.combatant?.actor?.uuid !== actor.uuid) return;
  if (reserveOf(actor)) return;
  const plan = timeTurnPlan(actorTimeFactor(actor), carryOf(actor));
  if (plan.kind !== "fast") return;
  await writeReserve(actor, { value: plan.reserve, max: plan.reserve, spent: 0, factor: plan.factor }, plan.carry);
  await announceTimeTurn(actor, plan, []);
}

/** Liga os ganchos (uma vez, no `ready`). */
export function registerTimeRate() {
  Hooks.on("createActiveEffect", async effect => {
    if (!isDesignatedGm()) return;
    const actor = timeEffectActor(effect);
    if (!actor) return;
    await resyncPersonal(actor);
    try {
      await grantReserveNow(actor);
    } catch (err) {
      reportError("Falha ao dar a reserva de tempo.", err, { gmOnly: true });
    }
  });
  Hooks.on("updateActiveEffect", async (effect, changed) => {
    if (!isDesignatedGm()) return;
    const actor = timeEffectActor(effect);
    if (!actor) return;
    if ("disabled" in (changed ?? {}) || foundry.utils.hasProperty(changed ?? {}, `flags.${SYSTEM_ID}.${TIME_FLAG}`)) await resyncPersonal(actor);
  });
  Hooks.on("deleteActiveEffect", async effect => {
    if (!isDesignatedGm()) return;
    const actor = timeEffectActor(effect);
    if (!actor) return;
    await resyncPersonal(actor);
    if (!isTimeFactorActive(actorTimeFactor(actor))) {
      try {
        await clearReserve(actor);
      } catch (err) {
        console.warn(`${SYSTEM_ID} | Tempo: não consegui limpar a reserva de "${actor.name}".`, err);
      }
    }
  });
  // Fim do combate: as reservas somem (a fração sobrada fica para o próximo combate).
  Hooks.on("deleteCombat", async combat => {
    if (!isDesignatedGm()) return;
    const seen = new Set();
    for (const combatant of combat.combatants ?? []) {
      const actor = combatant.actor;
      if (!actor || seen.has(actor.uuid)) continue;
      seen.add(actor.uuid);
      try {
        await clearReserve(actor, { carry: false });
      } catch (err) {
        console.warn(`${SYSTEM_ID} | Tempo: não consegui limpar a reserva de "${actor.name}".`, err);
      }
    }
  });
}

