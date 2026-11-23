/**
 * Manipulação do tempo, Reverter (8e.7/8e.8), lado Foundry. As contas puras estão em `time-rewind-rules.js`.
 *
 * Duas metades:
 *  - **Em combate (8e.8):** um anel de fotos por combatente, **em memória de todo cliente de Mestre** (não em flag: cada foto
 *    é o `actor.toObject()` inteiro, 100-300 KB; guardar 10 por combatente encheria o banco). A foto é tirada no começo do
 *    turno dele, ANTES dos ticks (o gancho `updateCombat` deste arquivo roda de forma síncrona até a foto; os ticks do
 *    Mestre designado só escrevem depois do primeiro `await`). Reverter devolve os VALORES ABSOLUTOS da foto, reaproveitando
 *    o ponto de restauração (H13, `applyRestoreData`): Vida, energia, Escudo, efeitos (prazos recomeçando por
 *    `effectRoundsUpdate`), partes do corpo (inclusive perdidas: são Itens, reescritos direto), quantidade de Itens,
 *    munição, cargas, carregador, Itens gastos (recriados) e XP; e a posição do Token por `moveTokenForced`. Não volta:
 *    chat, o que ele fez em outras fichas, Estruturas e Zonas. Recarregar a página do Mestre apaga o histórico.
 *  - **Fora de combate (8e.7):** só os efeitos de status (registro pequeno por Ator, flag `timeEffectLog`: efeitos criados e
 *    apagados com o tempo pessoal de quando) e o tempo pessoal (`rewindPersonalTime`: sono, PAD e idade voltam junto).
 *
 * Antes de reverter, um ponto de restauração automático ("Antes de reverter…") e o botão "Desfazer reversão" (Mestre) no
 * card. Vínculos (Nomeação/Corredor, Pacto): reverter um reverte os dois, pagando o custo da Skill por cada parceiro; sem
 * energia para todos, nada acontece. Forma que mudou desde a foto: recusa.
 */
import {
  SYSTEM_ID, getTimeRewindRounds, isTimeManipulationEnabled, isEnergyPoolEnabled, effectiveSkillCost, getEnergyLabelForActor, actorDisplayName
} from "../core/config.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { effectDurationRounds, effectRoundsUpdate, tokenElevation } from "../helpers/foundry-compat.js";
import { RESTORE_SKIP_FLAGS } from "../world/actor-snapshot-rules.js";
import { autoSnapshot } from "../world/auto-snapshot.js";
import { isShipLike } from "../starship/ship-damage.js";
import { energyValuePath, currentEnergyValue } from "../skills/skill-state.js";
import { moveTokenForced } from "./forced-movement.js";
import { timeStrength } from "./time-rate-rules.js";
import { roundsLeft, startedCombatOf } from "./time-rate.js";
import {
  EFFECT_LOG_FLAG, rewindRoundsFor, rewindSeconds, pushPhoto, pickPhoto, formChanged, bondPartnerUuids, bondCost, effectLogWorthy,
  logEffectEvent, effectLogPlan, effectLogAfterRewind, roundsText, changeRows, mechHasRewind
} from "./time-rewind-rules.js";

/** Flags que o Reverter nunca devolve: o tempo pessoal, a reserva do turno, o dano guardado do Parado e o registro de efeitos. */
export const REWIND_SKIP_FLAGS = [...RESTORE_SKIP_FLAGS, "timeReserve", "timeCarry", "timeStopDamage", EFFECT_LOG_FLAG];

/* ------------------------------------------------------------------ Anel de fotos (em combate) */

/** actor.uuid → fotos, da mais antiga para a mais nova. Em memória; recarregar a página apaga. */
const rings = new Map();

/** O anel de um Ator (só para os testes e para quem lê). */
export function ringOf(actor) {
  return rings.get(actor?.uuid) ?? [];
}

/** Apaga todos os anéis (ou os de um combate). */
export function clearRings(actors = null) {
  if (!actors) return rings.clear();
  for (const actor of actors) rings.delete(actor?.uuid);
}

/**
 * Tira a foto do começo do turno de `combatant`. SÍNCRONA de propósito (nada de `await` antes de `toObject`): roda antes
 * de qualquer tick escrever no Ator. Só Personagem, com o bloco ligado.
 */
export function takePhoto(combat, combatant) {
  const actor = combatant?.actor;
  if (!actor || actor.type !== "character" || !isTimeManipulationEnabled()) return false;
  const effectLeft = {};
  for (const effect of actor.effects) {
    if (effectDurationRounds(effect) > 0) effectLeft[effect.id] = roundsLeft(effect, combat);
  }
  const doc = combatant.token ?? null;
  const token = doc
    ? { sceneId: doc.parent?.id ?? null, tokenId: doc.id, x: Number(doc._source?.x ?? doc.x) || 0, y: Number(doc._source?.y ?? doc.y) || 0, elevation: tokenElevation(doc) }
    : null;
  const photo = { round: Number(combat.round) || 0, turn: Number(combat.turn) || 0, combatId: combat.id, data: actor.toObject(), effectLeft, token };
  rings.set(actor.uuid, pushPhoto(rings.get(actor.uuid), photo, getTimeRewindRounds() + 1));
  return true;
}

/* ------------------------------------------------------------------ Registro de efeitos (fora de combate) */

const logQueues = new Map();

/** Escreve no registro de um Ator, uma escrita por vez (duas mudanças seguidas não se atropelam). */
function enqueueLog(actor, fn) {
  const previous = logQueues.get(actor.uuid) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  logQueues.set(actor.uuid, next);
  next.finally(() => {
    if (logQueues.get(actor.uuid) === next) logQueues.delete(actor.uuid);
  }).catch(() => {});
  return next;
}

async function personalSeconds(actor) {
  const { personalNow } = await import("../core/world-time.js");
  return personalNow(actor);
}

async function logEffect(effect, op) {
  const actor = effect?.parent;
  if (actor?.documentName !== "Actor" || actor.type !== "character") return;
  const statuses = [...(effect.statuses ?? [])];
  if (!effectLogWorthy(effect.flags?.[SYSTEM_ID], { statuses, disabled: effect.disabled })) return;
  const at = await personalSeconds(actor);
  const data = op === "d" ? (({ _stats, ...rest }) => rest)(effect.toObject()) : undefined;
  await enqueueLog(actor, async () => {
    const log = logEffectEvent(actor.getFlag(SYSTEM_ID, EFFECT_LOG_FLAG), { op, id: effect.id, at, ...(data ? { data } : {}) });
    await actor.setFlag(SYSTEM_ID, EFFECT_LOG_FLAG, log);
  });
}

/* ------------------------------------------------------------------ Vínculos e Forma */

/** Os parceiros de vínculo de um Ator (Atores reais, sem ele), pelos flags de agora e os da foto. */
export function bondPartnersOf(actor, photo = null) {
  const flagsNow = actor.flags?.[SYSTEM_ID] ?? {};
  const flagsThen = photo?.data?.flags?.[SYSTEM_ID] ?? {};
  const uuids = new Set([...bondPartnerUuids(flagsNow, actor.uuid), ...bondPartnerUuids(flagsThen, actor.uuid)]);
  const out = [];
  for (const uuid of uuids) {
    const partner = globalThis.fromUuidSync?.(uuid, { strict: false }) ?? null;
    if (partner?.documentName === "Actor" && partner.type === "character") out.push(partner);
  }
  return out;
}

/** Quantos parceiros a Skill vai arrastar em `targets` (para a conferência de energia antes de pagar o uso). */
function countBondPartners(targets) {
  const seen = new Map();
  for (const target of targets) {
    if (!target || target.type !== "character") continue;
    seen.set(target.uuid, target);
  }
  const partners = new Map();
  for (const target of seen.values()) for (const p of bondPartnersOf(target)) if (!seen.has(p.uuid)) partners.set(p.uuid, p);
  return partners.size;
}

/**
 * Conferência ANTES de pagar o uso (runSkillEffect): se os alvos escolhidos têm vínculos e quem usa não tem energia para
 * o custo mais um custo por parceiro, devolve quanto precisaria; senão 0.
 */
export function rewindEnergyShortfall(sourceActor, mech, targets, paid) {
  if (!mechHasRewind(mech) || !isTimeManipulationEnabled()) return 0;
  const charges = isShipLike(sourceActor) || isEnergyPoolEnabled();
  if (!charges) return 0;
  const partners = countBondPartners(targets ?? []);
  if (!partners) return 0;
  const unit = effectiveSkillCost(mech.cost, mech.level);
  const need = Math.max(0, Number(paid) || 0) + unit * partners;
  return currentEnergyValue(sourceActor) >= need ? 0 : need;
}

/* ------------------------------------------------------------------ Reverter um Ator */

const energyOf = actor => Number(actor.system?.attributes?.energy?.value) || 0;
const vitalsOf = actor => ({
  hp: Number(actor.system?.attributes?.hp?.value) || 0,
  shield: Number(actor.system?.attributes?.shield?.value) || 0,
  energy: energyOf(actor),
  effects: actor.effects.size,
  items: actor.items.size
});

function tokenDocOf(photoToken) {
  if (!photoToken?.sceneId) return null;
  return game.scenes?.get(photoToken.sceneId)?.tokens?.get(photoToken.tokenId) ?? null;
}

/** Recomeça a contagem dos prazos dos efeitos devolvidos (a foto guarda quantas rodadas faltavam). */
async function restampDurations(actor, effectLeft, combat) {
  for (const [id, left] of Object.entries(effectLeft ?? {})) {
    const effect = actor.effects.get(id);
    if (!effect || !(left > 0)) continue;
    try {
      await effect.update(effectRoundsUpdate(left, { combat }));
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Reverter: não consegui recomeçar o prazo de "${effect.name}".`, err);
    }
  }
}

/** Em combate: devolve a foto. `energyPaid` = o que quem usou a Skill já pagou agora e não volta (só se ele é este Ator). */
async function rewindInCombat(actor, pick, combat, { energyPaid = 0 } = {}) {
  const before = vitalsOf(actor);
  const { photo } = pick;
  const { applyRestoreData } = await import("../world/actor-snapshots.js");
  const tokenBefore = tokenDocOf(photo.token);
  const positionBefore = tokenBefore ? { sceneId: photo.token.sceneId, tokenId: photo.token.tokenId, x: Number(tokenBefore._source?.x ?? tokenBefore.x) || 0, y: Number(tokenBefore._source?.y ?? tokenBefore.y) || 0, elevation: tokenElevation(tokenBefore) } : null;
  await applyRestoreData(actor, photo.data, { skipFlags: REWIND_SKIP_FLAGS, options: { nihilityRewind: true } });
  await restampDurations(actor, photo.effectLeft, combat);
  // O que quem lança pagou por esta Skill não volta (senão ela sairia de graça quando ele reverte a si mesmo).
  if (energyPaid > 0) await actor.update({ [energyValuePath(actor)]: Math.max(0, currentEnergyValue(actor) - energyPaid) });
  let moved = false;
  if (tokenBefore && photo.token) {
    const dx = Math.abs(photo.token.x - positionBefore.x);
    const dy = Math.abs(photo.token.y - positionBefore.y);
    if (dx > 0.5 || dy > 0.5 || photo.token.elevation !== positionBefore.elevation) {
      try {
        moved = await moveTokenForced(tokenBefore, { x: photo.token.x, y: photo.token.y, elevation: photo.token.elevation });
      } catch (err) {
        console.warn(`${SYSTEM_ID} | Reverter: não consegui devolver o Token de "${actor.name}" ao lugar.`, err);
      }
    }
  }
  const seconds = await rewindPersonal(actor, rewindSeconds(pick.rounds, CONFIG.time?.roundTime));
  return { before, after: vitalsOf(actor), seconds, positionBefore: moved ? positionBefore : null };
}

async function rewindPersonal(actor, seconds) {
  if (!(seconds > 0)) return 0;
  try {
    const { rewindPersonalTime } = await import("../core/world-time.js");
    return (await rewindPersonalTime(actor, seconds)) ? seconds : 0;
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Reverter: não consegui recuar o tempo pessoal de "${actor.name}".`, err);
    return 0;
  }
}

/** Fora de combate: os efeitos de status e o tempo de vida. */
async function rewindOutOfCombat(actor, rounds) {
  const before = vitalsOf(actor);
  const seconds = rewindSeconds(rounds, CONFIG.time?.roundTime, { fallback: true });
  const since = (await personalSeconds(actor)) - seconds;
  const log = actor.getFlag(SYSTEM_ID, EFFECT_LOG_FLAG) ?? [];
  const plan = effectLogPlan(log, since);
  const options = () => ({ nihilityRewind: true });
  const gone = plan.remove.filter(id => actor.effects.has(id));
  if (gone.length) await actor.deleteEmbeddedDocuments("ActiveEffect", gone, options());
  const back = plan.recreate.filter(d => d?._id && !actor.effects.has(d._id));
  if (back.length) {
    await actor.createEmbeddedDocuments("ActiveEffect", foundry.utils.deepClone(back), { keepId: true, nihilityConfigured: true, ...options() });
    // Um prazo em rodadas recomeça cheio (o que faltava na hora em que o efeito caiu não está no registro).
    for (const data of back) {
      const effect = actor.effects.get(data._id);
      const total = Number(data.duration?.value) > 0 && data.duration?.units === "rounds" ? Number(data.duration.value) : Number(data.duration?.rounds) || 0;
      if (effect && total > 0) await effect.update(effectRoundsUpdate(total, { combat: null }));
    }
  }
  await enqueueLog(actor, () => actor.setFlag(SYSTEM_ID, EFFECT_LOG_FLAG, effectLogAfterRewind(actor.getFlag(SYSTEM_ID, EFFECT_LOG_FLAG) ?? [], since)));
  const moved = await rewindPersonal(actor, seconds);
  return { before, after: vitalsOf(actor), seconds: moved, positionBefore: null, effectsBack: back.length, effectsGone: gone.length };
}

/* ------------------------------------------------------------------ A Skill: aplicar o efeito */

/**
 * O efeito Reverter (8e.7/8e.8), chamado por `applyTimeRateEntry`. Planeja tudo antes de escrever (recusa sem tocar em nada),
 * cobra o custo extra dos vínculos, guarda um ponto de restauração por ficha e reverte cada uma. Devolve a linha do resumo.
 * Só roda no cliente de um Mestre (quem não é Mestre é encaminhado por `applyEffectsToTargets`).
 */
export async function applyTimeRewindEntry(entry, { mech, label, originSkill, targetActor, sourceLevel, xp }) {
  if (!isTimeManipulationEnabled()) return "Reverter: o bloco Manipulação do tempo está desligado";
  if (!game.user?.isGM) return "Reverter: só o Mestre pode reverter o tempo (nenhum Mestre respondeu)";
  if (isShipLike(targetActor) || targetActor.type !== "character") return `Reverter: não se aplica a ${targetActor.name}`;
  const asked = Math.max(0, Math.floor(Number(entry.durationRounds) || 0));
  if (!asked) return "Reverter: sem rodadas para voltar";
  const targetLevel = Number(targetActor.system?.attributes?.level) || 0;
  const strength = timeStrength(sourceLevel, targetLevel);
  const rounds = rewindRoundsFor(asked, strength, getTimeRewindRounds());
  if (rounds <= 0) return `Reverter: ${targetActor.name} é forte demais (nível ${targetLevel} contra nível ${sourceLevel}): sem efeito`;

  // Quem entra: o alvo e, por vínculo, os parceiros (a ficha e a foto dizem quem).
  const combatOf = actor => startedCombatOf(actor);
  const plan = [{ actor: targetActor, bonded: false }];
  const targetCombat = combatOf(targetActor);
  const targetPick = targetCombat ? pickPhoto(ringOf(targetActor), rounds, targetCombat.round) : null;
  // Um nível só: o parceiro do parceiro não entra.
  for (const partner of bondPartnersOf(targetActor, targetPick?.photo ?? null)) plan.push({ actor: partner, bonded: true });

  // Cada ficha: em combate precisa de foto (e Forma igual); fora dele, só o relógio.
  for (const item of plan) {
    const combat = combatOf(item.actor);
    item.combat = combat;
    if (!combat) continue;
    const pick = pickPhoto(ringOf(item.actor), rounds, combat.round);
    if (!pick) return `Reverter: ${item.actor.name} não tem histórico guardado (as fotos são em memória: recarregar a página do Mestre as apaga, e a primeira só nasce no 1º turno dele). ${plan.length > 1 ? "Vale para os dois ou nada: nada foi feito." : "Nada foi feito."}`;
    if (formChanged(pick.photo.data.flags?.[SYSTEM_ID], item.actor.flags?.[SYSTEM_ID])) return `Reverter: a Forma de ${item.actor.name} mudou desde a foto; nada foi feito.`;
    item.pick = pick;
  }

  // Custo: cada parceiro paga o custo da Skill (de quem lança). Sem energia para todos, nada acontece.
  const caster = originSkill?.parent ?? null;
  const partnersCount = plan.filter(p => p.bonded).length;
  let extraPaid = 0;
  if (partnersCount && caster) {
    const charges = isShipLike(caster) || isEnergyPoolEnabled();
    const cost = bondCost({ unitCost: effectiveSkillCost(mech.cost, mech.level), partners: partnersCount, available: currentEnergyValue(caster), charges });
    if (!cost.ok) return `Reverter: ${targetActor.name} está ligado a ${plan.filter(p => p.bonded).map(p => p.actor.name).join(", ")}; voltar os dois pede mais ${cost.extra} de ${getEnergyLabelForActor(caster)} e faltam ${cost.missing}. Nada foi feito.`;
    if (cost.extra > 0) {
      await caster.update({ [energyValuePath(caster)]: Math.max(0, currentEnergyValue(caster) - cost.extra) });
      extraPaid = cost.extra;
    }
  }
  const paidNow = (Number(mech.paidCost) || 0) + extraPaid;

  // Ponto de restauração por ficha (o "Desfazer reversão" volta a ele).
  const entries = [];
  for (const item of plan) {
    const snapshotId = await autoSnapshot(item.actor, `Antes de reverter ${roundsText(item.pick?.rounds ?? rounds)} (${label})`);
    entries.push({ item, snapshotId });
  }

  // Reverter de verdade.
  const lines = [];
  const undo = [];
  for (const { item, snapshotId } of entries) {
    const actor = item.actor;
    try {
      const result = item.combat
        ? await rewindInCombat(actor, item.pick, item.combat, { energyPaid: caster && actor.uuid === caster.uuid ? paidNow : 0 })
        : await rewindOutOfCombat(actor, rounds);
      const used = item.pick?.rounds ?? rounds;
      lines.push({ actor, rounds: used, short: Boolean(item.pick?.short), inCombat: Boolean(item.combat), ...result });
      undo.push({ uuid: actor.uuid, snapshotId: snapshotId ?? null, seconds: result.seconds, position: result.positionBefore });
    } catch (err) {
      reportError(`Reverter ${actor.name}: falhou no meio. O ponto "Antes de reverter" guarda como a ficha estava.`, err);
      lines.push({ actor, failed: true });
    }
  }
  xp?.push({ flat: true });
  await postRewindCard({ caster, label, lines, undo, extraPaid, energyLabel: caster ? getEnergyLabelForActor(caster) : "" });
  const ok = lines.filter(l => !l.failed);
  if (!ok.length) return `Reverter: falhou em ${targetActor.name}`;
  const names = ok.map(l => `${actorDisplayName(l.actor)} (${roundsText(l.rounds)}${l.short ? ", tudo que havia" : ""})`).join(", ");
  return `tempo revertido: ${names}${extraPaid ? ` — vínculo: +${extraPaid} de ${getEnergyLabelForActor(caster)}` : ""}`;
}

/* ------------------------------------------------------------------ Card e Desfazer reversão */

function rowsFor(line) {
  const { before, after } = line;
  const energy = line.actor ? getEnergyLabelForActor(line.actor) : "Energia";
  return changeRows([
    { label: "Vida", before: before.hp, after: after.hp },
    { label: "Escudo", before: before.shield, after: after.shield },
    { label: energy, before: before.energy, after: after.energy },
    { label: "Efeitos", before: before.effects, after: after.effects },
    { label: "Itens", before: before.items, after: after.items }
  ]);
}

async function postRewindCard({ caster, label, lines, undo, extraPaid, energyLabel }) {
  const blocks = lines.map(line => {
    if (line.failed) return `<div class="tr-actor"><strong>${escapeHtml(actorDisplayName(line.actor))}</strong>: falhou (o ponto de restauração guarda como estava).</div>`;
    const rows = rowsFor(line).map(r => `<tr><td>${escapeHtml(r.label)}</td><td class="mono">${escapeHtml(r.text)}</td></tr>`).join("");
    const extras = [];
    if (line.positionBefore) extras.push("voltou ao lugar de antes");
    if (line.effectsBack) extras.push(`${line.effectsBack} efeito(s) de volta`);
    if (line.effectsGone) extras.push(`${line.effectsGone} efeito(s) a menos`);
    if (line.seconds > 0) extras.push("o tempo de vida recuou (sono, relógio e idade voltam junto)");
    const head = `${escapeHtml(actorDisplayName(line.actor))}: voltou ${escapeHtml(roundsText(line.rounds))}${line.short ? " (era tudo que havia guardado)" : ""}${line.inCombat ? "" : " (fora de combate: efeitos e tempo de vida)"}`;
    return `<div class="tr-actor"><strong>${head}</strong>${rows ? `<table><tbody>${rows}</tbody></table>` : "<p class=\"hint\">Nada mudou nos números.</p>"}${extras.length ? `<p class="hint">${escapeHtml(extras.join(" · "))}</p>` : ""}</div>`;
  });
  const bond = extraPaid ? `<p class="hint">Vínculo: voltar os dois custou +${extraPaid} de ${escapeHtml(energyLabel)}.</p>` : "";
  const content = `<div class="nihility-time-notice is-rewind"><strong>${escapeHtml(label)}: o tempo voltou</strong>${blocks.join("")}${bond}<p class="hint">Não voltam: o chat, o que foi feito em outras fichas, Estruturas e Zonas.</p></div>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: caster }),
    content,
    flags: { [SYSTEM_ID]: { timeRewind: { entries: undo, undone: false } } }
  });
}

const UNDO_ICON =
  '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14L4 9l5-5"></path><path d="M4 9h10a6 6 0 0 1 0 12h-3"></path></svg>';

/** O botão "Desfazer reversão" no card (só o Mestre vê), ou a faixa de "desfeita". Chamado no `renderChatMessageHTML`. */
export function renderTimeRewind(message, html) {
  const record = message.getFlag?.(SYSTEM_ID, "timeRewind");
  if (!record) return;
  if (record.undone) {
    const strip = document.createElement("div");
    strip.className = "nihility-use-undone-strip";
    strip.innerHTML = `${UNDO_ICON}<span>Reversão desfeita pelo Mestre</span>`;
    html.append(strip);
    return;
  }
  if (!game.user.isGM || !record.entries?.some(e => e.snapshotId)) return;
  const footer = document.createElement("div");
  footer.className = "nihility-use-undo";
  footer.innerHTML = `<span class="hint">só o Mestre vê</span><button type="button">${UNDO_ICON}<span>Desfazer reversão</span></button>`;
  footer.querySelector("button").addEventListener("click", () => undoRewind(message));
  html.append(footer);
}

/** Desfaz a reversão: cada ficha volta ao ponto "Antes de reverter", o tempo pessoal anda de novo e o Token volta ao lugar. */
export async function undoRewind(message) {
  const record = message?.getFlag?.(SYSTEM_ID, "timeRewind");
  if (!game.user.isGM || !record || record.undone) return false;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Desfazer reversão" },
    content: `<div class="nihility-undo-confirm"><p>Cada ficha volta ao ponto guardado antes de reverter (Vida, energia, Itens, efeitos), o tempo de vida anda de novo e o Token volta ao lugar de antes. O estado de agora é guardado primeiro.</p></div>`
  });
  if (!ok) return false;
  // Marca antes de aplicar: dois cliques nunca desfazem duas vezes.
  await message.setFlag(SYSTEM_ID, "timeRewind", { ...record, undone: true });
  const { restoreSnapshot } = await import("../world/actor-snapshots.js");
  const { addPersonalSeconds } = await import("../core/world-time.js");
  for (const entry of record.entries ?? []) {
    try {
      const actor = await fromUuid(entry.uuid);
      if (!actor) continue;
      if (entry.snapshotId) await restoreSnapshot(actor, entry.snapshotId);
      if (entry.seconds > 0) await addPersonalSeconds(actor, entry.seconds);
      const doc = tokenDocOf(entry.position);
      if (doc && entry.position) await moveTokenForced(doc, { x: entry.position.x, y: entry.position.y, elevation: entry.position.elevation });
    } catch (err) {
      reportError("Desfazer reversão: uma ficha não pôde voltar.", err);
    }
  }
  return true;
}

/* ------------------------------------------------------------------ Ganchos */

/** Liga os ganchos (uma vez, no `ready`). */
export function registerTimeRewind() {
  // A foto do começo do turno, em TODO cliente de Mestre (síncrona: antes de os ticks do Mestre designado escreverem).
  Hooks.on("updateCombat", (combat, changed, options) => {
    if (!game.user.isGM || !combat.started) return;
    if (changed.turn === undefined && changed.round === undefined) return;
    if (options?.direction < 0) return;
    try {
      takePhoto(combat, combat.combatant);
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Reverter: não consegui fotografar o começo do turno.`, err);
    }
  });
  Hooks.on("deleteCombat", combat => {
    if (!game.user.isGM) return;
    clearRings((combat.combatants ?? []).map(c => c.actor));
  });

  // O registro de efeitos (fora de combate), só no Mestre designado.
  Hooks.on("createActiveEffect", async (effect, options) => {
    if (!isDesignatedGm() || options?.nihilityRewind || !isTimeManipulationEnabled()) return;
    try {
      await logEffect(effect, "c");
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Reverter: não consegui registrar o efeito criado.`, err);
    }
  });
  Hooks.on("deleteActiveEffect", async (effect, options) => {
    if (!isDesignatedGm() || options?.nihilityRewind || !isTimeManipulationEnabled()) return;
    try {
      await logEffect(effect, "d");
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Reverter: não consegui registrar o efeito apagado.`, err);
    }
  });
}
