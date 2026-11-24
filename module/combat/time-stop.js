/**
 * Manipulação do tempo, Parar (8e.4/8e.5), lado Foundry. As contas puras estão em `time-stop-rules.js`; a leitura
 * do estado (quem está Parado, recusa de ação) em `time-stop-state.js`.
 *
 * O Parado é um Active Effect com `flags.<sistema>.timeStop = {rounds, forever, casterUuid, casterName}` (criado por
 * `applyTimeStopEntry`, effects-apply.js). Sem `changes` e fora do `incapacitates`. Enquanto existe:
 *  - não age (`blockIfIncapacitated` pergunta `time-stop-state.js`; `useBlockReason` e `runSkillEffect` também) e
 *    não se move (`preMoveToken` abaixo, o Mestre é isento; `moveTokenForced` recusa, então empurrão, teleporte e o
 *    Desfazer de empurrão não o movem);
 *  - nada nele anda: o `updateCombat` pula a cadeia do início do turno dele (só segue o que é do mundo: Zonas que ele
 *    pôs, Estruturas e superfícies por rodada); os prazos dos efeitos dele ficam congelados (`freezeStoppedEffects`,
 *    a cada virada de rodada); o tempo pessoal para (`world-time.js`); Dormindo não anda;
 *  - Zona/Estrutura que ele MANTÉM por Skill Ativa fica suspensa (flag `suspended`: a Zona não age, a Estrutura não
 *    queima) e religa sozinha na saída, sem cobrar Mana do período (a manutenção nem rodou). Zona/Estrutura só
 *    colocada, com duração, continua até acabar;
 *  - o dano que ele leva não escreve a Vida: fica guardado (`timeStopDamage`) e cai, um por um, na saída.
 * A duração (rodadas) é descontada no turno de QUEM LANÇOU (`advanceTimeStops`), como as Zonas; uma Ativa dura
 * enquanto ligada (âncora). A saída (`exitTimeStop`) roda quando o efeito some por qualquer caminho (prazo,
 * Antimagia, Desfazer uso, Mestre) e no fim do combate, e é idempotente.
 */
import { SYSTEM_ID } from "../core/config.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { effectDurationRounds, effectStartRound, effectRoundsUpdate, deleteKeyUpdate } from "../helpers/foundry-compat.js";
import { zonesOnScene } from "./area-effects.js";
import { setSpaceRegionsSuspended } from "./space.js";
import { structuresOnScene } from "../structures/structures.js";
import { releaseAccumulatedDamage } from "./damage-apply.js";
import { isTimeStopped, timeStopEffectsOf } from "./time-stop-state.js";
import {
  STOP_FLAG, STOP_DAMAGE_FLAG, stopCountdown, frozenRoundsLeft, needsFreeze, stopReturnSummary, stopHitText, stopNoticeText
} from "./time-stop-rules.js";

export { isTimeStopped, timeStopEffectsOf } from "./time-stop-state.js";

/* ------------------------------------------------------------------ Aviso */

async function sayWorld({ actor, title, body, html }) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: html,
    flags: { [SYSTEM_ID]: { voiceOfTheWorld: true, kind: "time", title, body } }
  });
}

/** O aviso do turno do Parado (cartão público): "X está Parado no tempo. Pule o turno dele." */
export async function announceStoppedTurn(actor, info) {
  const { title, body } = stopNoticeText(actor.name, { remaining: Number(info?.rounds) || 0, forever: Boolean(info?.forever), casterName: info?.casterName ?? "" });
  await sayWorld({ actor, title, body, html: `<div class="nihility-time-notice is-stopped"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p></div>` });
}

/* ------------------------------------------------------------------ Turno de quem lançou */

function combatActors(combat) {
  const seen = new Map();
  for (const c of combat?.combatants ?? []) if (c.actor && !seen.has(c.actor.uuid)) seen.set(c.actor.uuid, c.actor);
  return [...seen.values()];
}

/**
 * Início de um turno: os Parar lançados por `combatant` perdem 1 rodada e acabam ao zerar (como as Zonas: pelo turno de
 * quem lançou; quem lançou e não está no combate perde 1 a cada virada de rodada). Parar numa Ativa (`forever`) não
 * conta. Quem lançou estando Parado ele mesmo não conta (o tempo dele não anda). Só o Mestre designado.
 */
export async function advanceTimeStops(combat, combatant, { roundChanged = false } = {}) {
  const casterActor = combatant?.actor ?? null;
  for (const actor of combatActors(combat)) {
    for (const effect of timeStopEffectsOf(actor)) {
      const stop = effect.flags[SYSTEM_ID][STOP_FLAG];
      if (stop.forever) continue;
      const casterFighting = combat.combatants.some(c => c.actor?.uuid === stop.casterUuid);
      const casterTurn = casterActor?.uuid === stop.casterUuid;
      if (casterFighting ? !casterTurn : !roundChanged) continue;
      if (casterTurn && isTimeStopped(casterActor)) continue;
      const next = stopCountdown(stop.rounds);
      try {
        if (next.ended) await effect.delete();
        else await effect.update({ [`flags.${SYSTEM_ID}.${STOP_FLAG}.rounds`]: next.remaining });
      } catch (err) {
        console.warn(`${SYSTEM_ID} | Parar: não consegui descontar o prazo de "${effect.name}".`, err);
      }
    }
  }
}

/**
 * Virada de rodada: os prazos dos efeitos de quem está Parado ficam congelados (a rodada que passou não conta).
 * Regrava o mesmo número com `effectRoundsUpdate`, contado desta rodada. O próprio Parado não entra.
 */
export async function freezeStoppedEffects(combat) {
  const round = Number(combat?.round) || 0;
  for (const actor of combatActors(combat)) {
    if (!isTimeStopped(actor)) continue;
    for (const effect of actor.effects) {
      if (effect.flags?.[SYSTEM_ID]?.[STOP_FLAG] || effect.disabled) continue;
      const total = effectDurationRounds(effect);
      const start = effectStartRound(effect);
      if (!needsFreeze({ total, start, round })) continue;
      const left = frozenRoundsLeft({ total, start, round: round - 1 });
      try {
        await effect.update(effectRoundsUpdate(left, { combat }));
      } catch (err) {
        console.warn(`${SYSTEM_ID} | Parar: não consegui congelar o prazo de "${effect.name}".`, err);
      }
    }
  }
}

/** O turno de um Parado: nada anda nele; só o que é do mundo segue (virada de rodada). Devolve nada. */
export async function stoppedTurnNotice(actor) {
  const effect = timeStopEffectsOf(actor)[0];
  if (!effect) return;
  await announceStoppedTurn(actor, effect.flags[SYSTEM_ID][STOP_FLAG]);
}

/* ------------------------------------------------------------------ Suspender o que a Ativa dele mantém */

/** Zonas e Estruturas que `actor` mantém por Skill Ativa (`untilDeactivated`), em todas as Cenas. */
function maintainedByActor(actor) {
  const out = [];
  for (const scene of game.scenes ?? []) {
    for (const doc of zonesOnScene(scene)) {
      const zone = doc.getFlag(SYSTEM_ID, "zone");
      if (zone?.sourceUuid === actor.uuid && zone.untilDeactivated) out.push({ kind: "zone", doc, suspended: Boolean(zone.suspended) });
    }
    for (const instance of structuresOnScene(scene)) {
      if (instance.sourceActorUuid === actor.uuid && instance.untilDeactivated) out.push({ kind: "structure", scene, instance, suspended: Boolean(instance.suspended) });
    }
  }
  return out;
}

/** Suspende (ou religa) o que `actor` mantém por Ativa. Idempotente. Nada é apagado, nada é cobrado. */
export async function setMaintainedSuspended(actor, suspended) {
  // Portais e Domínios de Skill Ativa (8f) também ficam suspensos enquanto quem os mantém está Parado.
  await setSpaceRegionsSuspended(actor, suspended);
  for (const item of maintainedByActor(actor)) {
    if (item.suspended === suspended) continue;
    try {
      if (item.kind === "zone") await item.doc.update({ [`flags.${SYSTEM_ID}.zone.suspended`]: suspended });
      else await item.scene.setFlag(SYSTEM_ID, `structures.${item.instance.id}.suspended`, suspended);
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Parar: não consegui ${suspended ? "suspender" : "religar"} o que ${actor.name} mantém.`, err);
    }
  }
}

/* ------------------------------------------------------------------ Entrada e saída */

async function resyncPersonal(actor) {
  try {
    const { syncPersonalTime } = await import("../core/world-time.js");
    await syncPersonalTime(actor);
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Parar: não consegui ajustar o tempo pessoal de "${actor.name}".`, err);
  }
}

/** Entrou no Parado: o tempo pessoal para e o que ele mantém por Ativa fica suspenso. */
export async function enterTimeStop(actor) {
  await resyncPersonal(actor);
  await setMaintainedSuspended(actor, true);
}

const releasing = new Set();

/**
 * Cai o dano acumulado, um golpe por vez pelo caminho normal (Escudo lido na hora, "ao acertar" acontece agora, cada
 * card com o próprio Desfazer), e posta o cartão "O tempo de X voltou". Idempotente: a lista é tirada do Ator antes
 * de aplicar, e uma guarda em memória barra a segunda chamada ao mesmo tempo.
 * @returns {Promise<boolean>} houve dano a cair
 */
export async function releaseStoppedDamage(actor, { announce = true } = {}) {
  if (!actor || releasing.has(actor.uuid)) return false;
  releasing.add(actor.uuid);
  try {
    const list = actor.getFlag(SYSTEM_ID, STOP_DAMAGE_FLAG);
    let rows = [];
    let before = null;
    let after = null;
    if (Array.isArray(list) && list.length) {
      await actor.update(deleteKeyUpdate(`flags.${SYSTEM_ID}.${STOP_DAMAGE_FLAG}`));
      const read = () => ({ hp: actor.system?.attributes?.hp?.value ?? 0, shield: actor.system?.attributes?.shield?.value ?? 0 });
      before = read();
      rows = await releaseAccumulatedDamage(actor, list);
      after = read();
    }
    if (announce) await announceReturn(actor, rows, before, after);
    return rows.length > 0;
  } finally {
    releasing.delete(actor.uuid);
  }
}

async function announceReturn(actor, rows, before, after) {
  const sum = stopReturnSummary(rows);
  const title = `O tempo de ${actor.name} voltou`;
  const lines = rows.map(r => `<li>${escapeHtml(r.label)} <span class="mono">${escapeHtml(stopHitText(r))}</span>${r.extras?.length ? ` · ${escapeHtml(r.extras.join(", "))}` : ""}</li>`).join("");
  const totalLine = sum.count
    ? `<p>Escudo ${before.shield} → ${after.shield} · Vida ${before.hp} → ${after.hp} (${sum.total} no total)</p>`
    : "";
  const body = sum.count ? `${sum.count} ${sum.count === 1 ? "golpe acumulado caiu" : "golpes acumulados caíram"}: ${sum.total} no total.` : "Nada tinha se acumulado.";
  await sayWorld({
    actor,
    title,
    body,
    html: `<div class="nihility-time-notice is-return"><strong>${escapeHtml(title)}</strong>${lines ? `<ul>${lines}</ul>` : ""}${totalLine}<p class="hint">${sum.count ? "Cada golpe continua com o próprio Desfazer no card de origem." : "Nada tinha se acumulado."}</p></div>`
  });
}

/**
 * Saiu do Parado (o efeito acabou por qualquer caminho): o tempo pessoal volta, o que ele mantém religa e o dano
 * acumulado cai. Só roda se nenhum outro Parar segue ligado nele. Idempotente.
 */
export async function exitTimeStop(actor) {
  if (!actor || isTimeStopped(actor)) return;
  await resyncPersonal(actor);
  await setMaintainedSuspended(actor, false);
  await releaseStoppedDamage(actor);
}

/* ------------------------------------------------------------------ Ganchos */

function stopEffectActor(effect) {
  if (!effect?.flags?.[SYSTEM_ID]?.[STOP_FLAG]) return null;
  const actor = effect.parent;
  return actor?.documentName === "Actor" ? actor : null;
}

/** Liga os ganchos (uma vez, no `ready`). */
export function registerTimeStop() {
  // O Parado não se move: nem empurrão do sistema (`nihilityForced`) o leva. O Mestre sempre pode.
  Hooks.on("preMoveToken", (document, movement, operation) => {
    if (game.user.isGM || !isTimeStopped(document.actor)) return undefined;
    ui.notifications.warn(`${document.actor.name} está Parado no tempo e não pode se mover.`);
    return false;
  });

  Hooks.on("createActiveEffect", async effect => {
    if (!isDesignatedGm()) return;
    const actor = stopEffectActor(effect);
    if (!actor) return;
    try {
      await enterTimeStop(actor);
    } catch (err) {
      reportError("Falha ao parar o tempo.", err, { gmOnly: true });
    }
  });
  Hooks.on("updateActiveEffect", async (effect, changed) => {
    if (!isDesignatedGm() || !("disabled" in (changed ?? {}))) return;
    const actor = stopEffectActor(effect);
    if (!actor) return;
    try {
      if (effect.disabled) await exitTimeStop(actor);
      else await enterTimeStop(actor);
    } catch (err) {
      reportError("Falha ao ligar/desligar o tempo parado.", err, { gmOnly: true });
    }
  });
  Hooks.on("deleteActiveEffect", async effect => {
    if (!isDesignatedGm()) return;
    const actor = stopEffectActor(effect);
    if (!actor) return;
    try {
      await exitTimeStop(actor);
    } catch (err) {
      reportError("Falha ao devolver o tempo.", err, { gmOnly: true });
    }
  });

  // Fim do combate: o dano acumulado cai antes de tudo acabar, e o Parar com prazo (que só conta em combate) termina.
  // Um Parar de Skill Ativa (`forever`) continua: a Skill é quem o segura.
  Hooks.on("deleteCombat", async combat => {
    if (!isDesignatedGm()) return;
    for (const actor of combatActors(combat)) {
      if (!isTimeStopped(actor) && !actor.getFlag(SYSTEM_ID, STOP_DAMAGE_FLAG)) continue;
      try {
        // Apagar o Parar com prazo dispara a saída (que faz cair o dano e avisa); o que sobrou (Parar de Ativa) cai aqui.
        const ending = timeStopEffectsOf(actor).filter(e => !e.flags[SYSTEM_ID][STOP_FLAG].forever);
        if (ending.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ending.map(e => e.id));
        if (actor.getFlag(SYSTEM_ID, STOP_DAMAGE_FLAG)) await releaseStoppedDamage(actor);
      } catch (err) {
        reportError("Falha ao devolver o tempo no fim do combate.", err, { gmOnly: true });
      }
    }
  });
}
