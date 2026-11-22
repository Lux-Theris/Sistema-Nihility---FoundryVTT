/**
 * Calendário, linhas do tempo e tempo pessoal (J9b, 8b.1): o lado Foundry. Regras puras em
 * calendar-rules.js. Bloco `FEATURES.calendar` (filho do `worldClock`).
 *
 *  - **Tempo do mundo** = `game.time.worldTime`: só anda para a frente pelo sistema.
 *  - **Linha do tempo** (setting `timelines`) = época + ritmo de um grupo de cenas. A cena escolhe a
 *    sua pela flag `time` `{lineId, network}`; sem flag = `main`.
 *  - **Tempo pessoal** = flag do Ator `personalTime` (trecho). Sem flag = tempo do mundo (por isso não
 *    há migração). Só ganha flag quem sai do ritmo 1. Quem grava é o Mestre designado.
 *  - **O que o personagem sabe**: flag `timeSync` `{local, personalAt}` (PAD e itens tecnológicos);
 *    Item analógico guarda `clockSync` e o dono acerta à mão.
 *  - O tempo pessoal PODE recuar (Skill de reverter, 8e) por `rewindPersonalTime`; nada aqui o força a
 *    ser crescente. O tempo do mundo nunca volta: a guarda de retrocesso avisa o Mestre.
 *
 * Desligado o bloco: `personalNow(actor)` = tempo do mundo, toda cena está na linha principal (ritmo 1)
 * e as datas saem como no J9 ("Dia 3 · 14:05"). Nenhum flag é apagado.
 */
import { SYSTEM_ID, MEU_SISTEMA, isCalendarEnabled, isWorldClockEnabled } from "./config.js";
import { isDesignatedGm, runAsGm } from "../helpers/gm-relay.js";
import { combatScenes } from "../helpers/foundry-compat.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { itemIsTech } from "./magic-rules.js";
import { showVoiceBanner } from "./voice-banner.js";
import { suppressionState, sourceSuppressed } from "./suppression.js";
import { formatClock, formatHour } from "./world-clock-rules.js";
import {
  CALENDAR_MODELS, buildCalendarModel, normalizeCalendar, secondsPerDay, formatDate, formatDateTimeShort, formatTimeOfDay,
  composeRate, normalizeTimelines, resolveLine, normalizeTrack, trackValue, trackRebase, trackSetValue, trackAdd, rewindSegment,
  combatHoldsWorld, rewindDecision, deviceLocalNow, syncAge, deviceDrift, formatElapsed, outsideSeconds, dateToTime, MAIN_LINE_ID
} from "./calendar-rules.js";

/* ------------------------------------------------------------------ Leitura básica */

function readSetting(key) {
  try {
    return game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS[key]);
  } catch (err) {
    return undefined;
  }
}

/** O tempo do mundo em segundos. */
function worldSeconds() {
  return Number(game.time?.worldTime) || 0;
}

/** O Mestre (designado) escreve; com o bloco desligado nada é regravado. */
const calendarOn = () => isWorldClockEnabled() && isCalendarEnabled();

let calendarMemo = { raw: null, value: null };
/** O calendário do mundo (setting `calendarData`; vazio = Gregoriano). Não altere o resultado. */
export function getCalendar() {
  const raw = readSetting("calendarData");
  if (calendarMemo.value && calendarMemo.raw === raw) return calendarMemo.value;
  let parsed = null;
  try {
    parsed = typeof raw === "string" && raw.trim() ? JSON.parse(raw) : null;
  } catch (err) {
    parsed = null;
  }
  const value = normalizeCalendar(parsed ?? buildCalendarModel("gregorian"));
  calendarMemo = { raw, value };
  return value;
}

/** O calendário como o editor o grava. */
export async function saveCalendar(calendar) {
  if (!game.user.isGM) return false;
  await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.calendarData, JSON.stringify(normalizeCalendar(calendar), null, 2));
  return true;
}

let timelinesMemo = { raw: null, value: null };
/** As linhas do tempo (a principal sempre existe). Não altere o resultado. */
export function getTimelines() {
  const raw = readSetting("timelines");
  if (timelinesMemo.value && timelinesMemo.raw === raw) return timelinesMemo.value;
  let parsed = null;
  try {
    parsed = typeof raw === "string" && raw.trim() ? JSON.parse(raw) : null;
  } catch (err) {
    parsed = null;
  }
  const value = normalizeTimelines(parsed);
  timelinesMemo = { raw, value };
  return value;
}

/** A lista salva, sem limitar nada (o Validar Mundo compara com os limites). */
export function getRawTimelines() {
  try {
    const parsed = JSON.parse(readSetting("timelines") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

export async function saveTimelines(lines) {
  if (!game.user.isGM) return false;
  await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.timelines, JSON.stringify(normalizeTimelines(lines)));
  return true;
}

/** Segundos do dia do calendário (86400 com o bloco desligado). */
export function dayLengthSeconds() {
  return calendarOn() ? secondsPerDay(getCalendar()) : 86400;
}

/** Texto de uma data local: "14 Flo 1203 E.C. · 14:05" (ou "Dia 3 · 14:05" com o bloco desligado). */
export function localDateText(local) {
  return calendarOn() ? formatDateTimeShort(getCalendar(), local) : formatClock(local);
}

/** Só a hora local: "14:05". */
export function localHourText(local) {
  return calendarOn() ? formatTimeOfDay(getCalendar(), local) : formatHour(local);
}

/** A data por extenso ("Terça, 14 de Florescer de 1203 E.C."); vazia com o bloco desligado. */
export function localDateLong(local) {
  return calendarOn() ? formatDate(getCalendar(), local) : "";
}

/* ------------------------------------------------------------------ Linhas e cenas */

/** A flag de tempo de uma cena: `{lineId, network}`. */
export function sceneTimeFlag(scene) {
  const flag = scene?.getFlag?.(SYSTEM_ID, "time") ?? {};
  return { lineId: typeof flag.lineId === "string" && flag.lineId ? flag.lineId : MAIN_LINE_ID, network: Boolean(flag.network) };
}

/** A linha de uma cena. Bloco desligado ou sem cena: a principal com ritmo 1. */
export function sceneLine(scene) {
  const lines = getTimelines();
  if (!calendarOn() || !scene) return { ...lines[0], rate: 1 };
  return resolveLine(lines, sceneTimeFlag(scene).lineId);
}

export function sceneHasNetwork(scene) {
  return calendarOn() && Boolean(scene) && sceneTimeFlag(scene).network;
}

/** Segundos locais da linha agora (ou em `worldTime`). */
export function lineNow(line, worldTime = worldSeconds()) {
  return trackValue(line, worldTime);
}

/** As cenas que estão numa linha (`lineId` salvo; sem flag = principal). */
export function scenesOfLine(lineId) {
  const known = new Set(getTimelines().map(l => l.id));
  return game.scenes.filter(scene => {
    const id = sceneTimeFlag(scene).lineId;
    return id === lineId || (lineId === MAIN_LINE_ID && !known.has(id));
  });
}

/**
 * A cena do Ator: a do Token (Token não vinculado), ou a ativa entre as que têm Token dele; se
 * nenhuma está ativa, a primeira. Sem Token em cena: `null` (linha principal, ritmo 1).
 */
export function actorScene(actor) {
  if (!actor) return null;
  if (actor.isToken) return actor.token?.parent ?? null;
  const found = [];
  for (const scene of game.scenes) {
    for (const token of scene.tokens) if (token.actorLink && token.actorId === actor.id) { found.push(scene); break; }
  }
  return found.find(scene => scene.active) ?? found[0] ?? null;
}

export function actorLine(actor) {
  // Uma linha só (a principal): ninguém precisa procurar o Token (isto roda na preparação de cada ficha).
  const lines = getTimelines();
  if (!calendarOn() || lines.length < 2) return { ...lines[0], rate: 1 };
  return sceneLine(actorScene(actor));
}

/** A hora local da linha onde o Ator está. */
export function localNowForActor(actor) {
  return lineNow(actorLine(actor));
}

/* ------------------------------------------------------------------ Tempo pessoal */

/**
 * Os fatores do ritmo pessoal. Hoje só o ritmo da linha da cena; a Região de ritmo e os efeitos de
 * Skill de tempo (8b.2 e 8e) entram aqui, e o produto sai por `composeRate`.
 */
export function personalRateFactors(actor) {
  if (!calendarOn()) return [];
  return [actorLine(actor).rate];
}

export function personalRate(actor) {
  return composeRate(personalRateFactors(actor));
}

/** O trecho do tempo pessoal gravado (ou `null`). */
function personalTrack(actor) {
  const flag = actor?.getFlag?.(SYSTEM_ID, "personalTime");
  return flag && typeof flag === "object" ? normalizeTrack(flag) : null;
}

/**
 * O tempo pessoal do Ator, em segundos (o que ele viveu). Sem trecho gravado, é o tempo do mundo.
 * NÃO é forçado a crescer: uma Skill de reverter pode fazê-lo recuar.
 */
export function personalNow(actor) {
  const now = worldSeconds();
  if (!calendarOn()) return now;
  const track = personalTrack(actor);
  return track ? trackValue(track, now) : now;
}

/** Escrita serializada por Ator (duas mudanças seguidas não se atropelam). */
const writeQueues = new Map();
function enqueue(key, fn) {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  writeQueues.set(key, next);
  next.finally(() => {
    if (writeQueues.get(key) === next) writeQueues.delete(key);
  }).catch(() => {});
  return next;
}

function setPersonalTrack(actor, track) {
  return enqueue(actor.uuid, () => actor.setFlag(SYSTEM_ID, "personalTime", normalizeTrack(track)));
}

const sameRate = (a, b) => Math.abs(a - b) <= Math.max(a, b) * 1e-12;

/**
 * Acerta o trecho pessoal ao ritmo de onde o Ator está agora (quem chama é o Mestre). Sem trecho e em
 * ritmo 1: nada a gravar. Personagem, ou quem dorme, ganha o trecho ao sair do ritmo 1.
 */
export async function syncPersonalTime(actor) {
  if (!calendarOn() || !actor) return false;
  const rate = personalRate(actor);
  const track = personalTrack(actor);
  const now = worldSeconds();
  if (!track) {
    if (sameRate(rate, 1)) return false;
    if (actor.type !== "character" && !actor.effects?.some(e => e.statuses?.has?.("sleeping"))) return false;
    await setPersonalTrack(actor, { base: now, worldAt: now, rate });
    return true;
  }
  if (sameRate(track.rate, rate)) return false;
  await setPersonalTrack(actor, trackRebase(track, now, { rate }));
  return true;
}

/**
 * Garante um trecho pessoal para quem está fora do ritmo 1 e ainda não tem (ex.: um NPC que vai
 * dormir numa linha lenta: sem trecho, o tempo pessoal dele seria o do mundo e ele acordaria cedo).
 */
export async function ensurePersonalTrack(actor) {
  if (!calendarOn() || !actor || personalTrack(actor)) return false;
  const rate = personalRate(actor);
  if (sameRate(rate, 1)) return false;
  const now = worldSeconds();
  await setPersonalTrack(actor, { base: now, worldAt: now, rate });
  return true;
}

/** Soma tempo (≥ 0) ao tempo pessoal do Ator: a rodada de um combate com o mundo parado. */
export async function addPersonalSeconds(actor, seconds) {
  if (!calendarOn() || !actor || !(Number(seconds) > 0)) return false;
  const now = worldSeconds();
  const track = personalTrack(actor) ?? { base: now, worldAt: now, rate: personalRate(actor) };
  await setPersonalTrack(actor, trackAdd(track, now, seconds));
  return true;
}

/**
 * Volta o tempo pessoal do Ator (para a Skill de reverter, 8e). É o único caminho que o faz recuar; o
 * sono e o PAD dele voltam junto. O tempo do mundo não muda.
 */
export async function rewindPersonalTime(actor, seconds) {
  if (!calendarOn() || !actor || !(Number(seconds) > 0)) return false;
  const now = worldSeconds();
  const track = personalTrack(actor) ?? { base: now, worldAt: now, rate: personalRate(actor) };
  await setPersonalTrack(actor, rewindSegment(track, seconds, now));
  return true;
}

/** Os Atores que o relógio acompanha: Diretório e Tokens não vinculados das cenas. */
function trackedActors() {
  const list = [...game.actors];
  for (const scene of game.scenes) for (const token of scene.tokens) if (!token.actorLink && token.actor) list.push(token.actor);
  return list;
}

/** Reajusta o ritmo pessoal de todos (ao mudar de cena/linha ou ao salvar uma linha). Só o Mestre. */
export async function syncAllPersonalTimes() {
  if (!calendarOn()) return;
  for (const actor of trackedActors()) {
    try {
      await syncPersonalTime(actor);
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Tempo pessoal: não consegui ajustar "${actor.name}".`, err);
    }
  }
}

/* ------------------------------------------------------------------ O que o aparelho acha */

function deviceSuppressed(actor, item = null) {
  try {
    return item ? sourceSuppressed(actor, item) : suppressionState(actor).tech !== null;
  } catch (err) {
    return false;
  }
}

/** Estado do pedido de Atualizar do PAD: `pending`, `denied` ou `""`. */
export function timeSyncStatus(actor) {
  const status = actor?.getFlag?.(SYSTEM_ID, "timeSyncStatus")?.state;
  return status === "pending" || status === "denied" ? status : "";
}

/**
 * O que o PAD (ou item tecnológico) do Ator mostra. `local` = a hora que o aparelho acha que é;
 * `texto` = "14:05" ou "--:--" sem energia; `estado` = "network" | "stale" | "fresh" | "pending" |
 * "denied" | "off". Bloco desligado: a hora do mundo, como no J9.
 */
export function deviceView(actor, { item = null } = {}) {
  const suppressed = deviceSuppressed(actor, item);
  if (!calendarOn()) {
    const t = worldSeconds();
    return { local: t, text: suppressed ? "--:--" : formatHour(t), dateText: "", state: "off", status: "", ageText: "", suppressed, canRequest: false, network: false, drift: 0 };
  }
  const scene = actorScene(actor);
  const line = sceneLine(scene);
  const localNow = lineNow(line);
  const network = sceneHasNetwork(scene);
  const sync = actor?.getFlag?.(SYSTEM_ID, "timeSync") ?? null;
  const personal = personalNow(actor);
  const local = network ? localNow : deviceLocalNow(sync, personal, localNow);
  const status = timeSyncStatus(actor);
  const cal = getCalendar();
  let state = "fresh";
  if (suppressed) state = "suppressed";
  else if (network) state = "network";
  else if (status === "pending") state = "pending";
  else if (status === "denied") state = "denied";
  else if (sync) state = "stale";
  return {
    local,
    text: suppressed ? "--:--" : formatTimeOfDay(cal, local),
    dateText: suppressed ? "" : formatDate(cal, local),
    state,
    status,
    ageText: sync && !network ? formatElapsed(cal, syncAge(sync, personal)) : "",
    suppressed,
    network,
    drift: deviceDrift(local, localNow),
    canRequest: !suppressed && !network && status !== "pending"
  };
}

/** A hora curta do aparelho (a barra de status do PAD). */
export function deviceHour(actor) {
  return deviceView(actor).text;
}

/** O Item "Marca o tempo" é analógico (não tecnológico)? */
export function itemClockAnalog(item) {
  return Boolean(item?.system?.marksTime) && !itemIsTech(item.system);
}

/** A hora que a linha do inventário mostra: "14:05", "--:--" (tecnológico suprimido) ou "". */
export function itemClockText(item) {
  if (!item?.system?.marksTime || !isWorldClockEnabled()) return "";
  const actor = item.actor;
  if (!actor) return "";
  if (!calendarOn()) return deviceView(actor, { item }).text;
  if (!itemClockAnalog(item)) return deviceView(actor, { item }).text;
  const sync = item.getFlag?.(SYSTEM_ID, "clockSync") ?? null;
  const localNow = localNowForActor(actor);
  return formatTimeOfDay(getCalendar(), deviceLocalNow(sync, personalNow(actor), localNow));
}

/** O dono acerta o relógio analógico à mão (data e hora livres; sem aprovação). */
export async function setItemClock(item, parts) {
  const actor = item?.actor;
  if (!actor || !itemClockAnalog(item) || !calendarOn()) return false;
  const local = dateToTime(getCalendar(), parts);
  await item.setFlag(SYSTEM_ID, "clockSync", { local, personalAt: personalNow(actor) });
  return true;
}

/** Os campos de data para "Acertar" começam na data que o relógio mostra. */
export function itemClockParts(item) {
  const cal = getCalendar();
  const sync = item.getFlag?.(SYSTEM_ID, "clockSync") ?? null;
  const local = deviceLocalNow(sync, personalNow(item.actor), localNowForActor(item.actor));
  return { local, calendar: cal };
}

/* ------------------------------------------------------------------ Sincronização (Atualizar) */

/** Grava a sincronização do aparelho do Ator com a data local da cena dele (Mestre). */
export async function applyTimeSync(actor) {
  if (!actor) return false;
  const local = localNowForActor(actor);
  await actor.setFlag(SYSTEM_ID, "timeSync", { local, personalAt: personalNow(actor) });
  if (actor.getFlag(SYSTEM_ID, "timeSyncStatus")) await actor.unsetFlag(SYSTEM_ID, "timeSyncStatus");
  return true;
}

/** O jogador pede "Atualizar" no PAD: o Mestre decide pelo card. */
export function requestTimeSync(actor) {
  if (!calendarOn() || !actor) return;
  return runAsGm("timeSyncRequest", { actorUuid: actor.uuid });
}

/** Lado do Mestre do pedido: marca "procurando sinal" e manda o card. */
export async function handleTimeSyncRequest(actor) {
  if (!calendarOn() || !actor || actor.type === "starship") return false;
  const view = deviceView(actor);
  if (view.network || view.suppressed || view.status === "pending") return false;
  await actor.setFlag(SYSTEM_ID, "timeSyncStatus", { state: "pending" });
  const scene = actorScene(actor);
  const req = { actorUuid: actor.uuid, status: "open", deviceText: localDateText(view.local), sceneText: localDateText(localNowForActor(actor)), sceneName: scene?.name ?? "" };
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    content: timeSyncCard(actor.name, req),
    flags: { [SYSTEM_ID]: { timeSyncRequest: req } }
  });
  return true;
}

function timeSyncCard(name, req) {
  const done = req.status === "approved" ? "Aprovado: o PAD agora mostra a data da cena." : req.status === "rejected" ? "Recusado: o jogador vê \"sem sinal\"." : "";
  return `<div class="nihility-time-card">
    <p class="ntc-title"><i class="fa-solid fa-satellite-dish"></i> <strong>${escapeHtml(name)}</strong> quer atualizar o PAD</p>
    <dl class="ntc-rows">
      <dt>O PAD diz</dt><dd>${escapeHtml(req.deviceText)}</dd>
      <dt>Data da cena</dt><dd>${escapeHtml(req.sceneText)}${req.sceneName ? ` <em>(${escapeHtml(req.sceneName)})</em>` : ""}</dd>
    </dl>
    ${done ? `<p class="ntc-done">${escapeHtml(done)}</p>` : `<div class="ntc-actions"><button type="button" data-ts="approve">Aprovar</button><button type="button" data-ts="reject">Recusar</button></div>`}
  </div>`;
}

async function resolveTimeSyncCard(message, approve) {
  if (!game.user.isGM) return;
  const req = message.flags?.[SYSTEM_ID]?.timeSyncRequest;
  if (!req || req.status !== "open") return;
  const actor = await fromUuid(req.actorUuid);
  if (actor) {
    if (approve) await applyTimeSync(actor);
    else await actor.setFlag(SYSTEM_ID, "timeSyncStatus", { state: "denied" });
  }
  const next = { ...req, status: approve ? "approved" : "rejected" };
  await message.update({ content: timeSyncCard(actor?.name ?? "?", next), [`flags.${SYSTEM_ID}.timeSyncRequest`]: next });
}

/** Botões do card de pedido (`renderChatMessageHTML`). Só o Mestre vê o card (é sussurro). */
export function renderTimeSyncControls(message, html) {
  if (!message.flags?.[SYSTEM_ID]?.timeSyncRequest) return;
  html.querySelectorAll("[data-ts]").forEach(el => {
    el.addEventListener("click", event => {
      event.preventDefault();
      resolveTimeSyncCard(message, el.dataset.ts === "approve").catch(err => reportError("Falha no pedido de Atualizar.", err));
    });
  });
}

/**
 * Antes da cena ou da linha mudar: quem ainda não tem data gravada, ou estava "na rede", guarda a que
 * o aparelho mostrava (senão pularia junto com a época). Os valores são lidos de forma síncrona.
 */
export function settleDevices(actors, scene) {
  if (!calendarOn()) return Promise.resolve();
  const local = lineNow(sceneLine(scene));
  const network = sceneHasNetwork(scene);
  const jobs = [];
  for (const actor of actors) {
    if (!actor || actor.type !== "character") continue;
    const personalAt = personalNow(actor);
    const hasSync = Boolean(actor.getFlag(SYSTEM_ID, "timeSync"));
    if (!hasSync || network) jobs.push(actor.setFlag(SYSTEM_ID, "timeSync", { local, personalAt }));
    for (const item of actor.items) {
      if (itemClockAnalog(item) && !item.getFlag(SYSTEM_ID, "clockSync")) jobs.push(item.setFlag(SYSTEM_ID, "clockSync", { local, personalAt }));
    }
  }
  return Promise.allSettled(jobs);
}

/** Os Atores com Token numa cena. */
export function actorsInScene(scene) {
  const seen = new Map();
  for (const token of scene?.tokens ?? []) if (token.actor) seen.set(token.actor.uuid, token.actor);
  return [...seen.values()];
}

/* ------------------------------------------------------------------ Mudar uma linha */

/**
 * Salva um conjunto de linhas e aplica o que depende dele (Mestre): antes guarda a data que cada
 * aparelho mostrava, depois reajusta o ritmo pessoal de todos. `sceneIds` (opcional) põe essas cenas
 * na linha `lineId`.
 */
export async function commitTimelines(lines, { lineId = null, sceneIds = null } = {}) {
  if (!game.user.isGM) return false;
  for (const scene of game.scenes) await settleDevices(actorsInScene(scene), scene);
  await saveTimelines(lines);
  if (lineId && Array.isArray(sceneIds)) {
    const keep = new Set(sceneIds);
    for (const scene of game.scenes) {
      const flag = sceneTimeFlag(scene);
      if (keep.has(scene.id) && flag.lineId !== lineId) await scene.setFlag(SYSTEM_ID, "time", { ...flag, lineId });
      else if (!keep.has(scene.id) && flag.lineId === lineId) await scene.setFlag(SYSTEM_ID, "time", { ...flag, lineId: MAIN_LINE_ID });
    }
  }
  await syncAllPersonalTimes();
  return true;
}

/** O Mestre define a data local da linha (o "Definir dia/hora"): muda o `base`, nunca o tempo do mundo. */
export async function setLineLocalTime(lineId, local) {
  if (!game.user.isGM || !Number.isFinite(Number(local))) return false;
  const lines = getTimelines().map(l => (l.id === lineId ? { ...l, ...trackSetValue(l, worldSeconds(), local) } : l));
  return commitTimelines(lines);
}

/** O "Definir dia/hora" do J9: ajusta a linha principal (o tempo do mundo nunca volta). */
export async function setWorldClockLocal(local) {
  return setLineLocalTime(MAIN_LINE_ID, local);
}

/* ------------------------------------------------------------------ Combate */

function combatLine(combat) {
  const scene = combatScenes(combat)[0] ?? canvas?.scene ?? null;
  return sceneLine(scene);
}

/**
 * `combatRound`/`combatTurn` rodam no cliente de quem clicou, ANTES do `update`: aqui o delta de tempo
 * vira 0 em linha de ritmo ≠ 1 (o mundo para durante o combate), e voltar o turno leva a marca
 * `nihilityRewind` dentro de `worldTime` (o servidor repassa o resto de `worldTime` como options do
 * hook `updateWorldTime`), para a guarda de retrocesso não avisar.
 */
function holdCombatTime(combat, update, options) {
  if (!calendarOn() || !options) return;
  if (options.direction < 0) {
    options.worldTime = { ...(options.worldTime ?? {}), nihilityRewind: true };
    options.nihilityRewind = true;
  }
  const line = combatLine(combat);
  if (combatHoldsWorld(line.rate) && options.worldTime && Number.isFinite(Number(options.worldTime.delta))) {
    options.nihilityCombatDelta = options.worldTime.delta;
    options.nihilityLineId = line.id;
    options.worldTime.delta = 0;
  }
}

/** O Mestre designado: a rodada vira tempo pessoal dos combatentes ("o mundo para") ou fica guardada ("anda no fim"). */
async function onCombatClock(combat, changed, options) {
  if (!calendarOn() || !isDesignatedGm()) return;
  const delta = Number(options?.nihilityCombatDelta);
  if (!(delta > 0) || !(options.direction > 0)) return;
  const line = resolveLine(getTimelines(), options.nihilityLineId);
  if (line.combatWorld === "atEnd") {
    await combat.setFlag(SYSTEM_ID, "heldTime", (Number(combat.getFlag(SYSTEM_ID, "heldTime")) || 0) + delta);
    return;
  }
  const seen = new Set();
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    await addPersonalSeconds(actor, delta);
  }
  const { wakeDueSleepers, checkGroupSleep } = await import("./world-clock.js");
  await wakeDueSleepers();
  checkGroupSleep();
}

/** "Anda no fim": ao acabar o combate, lá fora passa o tempo guardado (tempo de combate ÷ ritmo). */
async function onCombatEnd(combat) {
  if (!calendarOn() || !isDesignatedGm()) return;
  const held = Number(combat.getFlag(SYSTEM_ID, "heldTime")) || 0;
  if (!(held > 0)) return;
  const line = combatLine(combat);
  if (line.combatWorld !== "atEnd" || !combatHoldsWorld(line.rate)) return;
  const { advanceWorldClock } = await import("./world-clock.js");
  await advanceWorldClock(outsideSeconds(line.rate, held));
}

/* ------------------------------------------------------------------ Guarda de retrocesso */

let undoingRewind = 0;

function onWorldTimeBack(worldTime, dt, options) {
  if (!calendarOn() || !isDesignatedGm()) return;
  if (Date.now() - undoingRewind < 3000) return;
  const marked = Boolean(options?.nihilityRewind || options?.worldTime?.nihilityRewind);
  const combats = [...(game.combats ?? [])].filter(c => c.started);
  const decision = rewindDecision({
    dt,
    marked,
    inCombat: combats.length > 0,
    roundTime: Number(CONFIG.time?.roundTime) || 6,
    combatants: Math.max(1, ...combats.map(c => c.combatants?.size ?? 1))
  });
  if (decision !== "warn") return;
  const back = Math.abs(dt);
  const span = formatElapsed(getCalendar(), back);
  const text = "Algo (uma macro ou um módulo de calendário) voltou o relógio. No Nihility a época muda pela linha do tempo (Ajustar, no Relógio do mundo); voltar o tempo do mundo pode estragar sonos, superfícies e efeitos.";
  showVoiceBanner({
    label: "Relógio do mundo",
    title: `O tempo do mundo voltou ${span}`,
    body: text,
    actions: [
      { label: "Desfazer", primary: true, onClick: () => undoRewind(worldTime - dt) },
      { label: "Deixar assim" }
    ]
  });
  ChatMessage.create({
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    content: `<p><i class="fa-solid fa-clock-rotate-left"></i> <strong>O tempo do mundo voltou ${escapeHtml(span)}.</strong> ${escapeHtml(text)}</p>`
  }).catch(() => {});
}

async function undoRewind(previous) {
  try {
    undoingRewind = Date.now();
    await game.time.set(previous, { nihilityRewind: true, worldTime: { nihilityRewind: true } });
  } catch (err) {
    reportError("Não consegui desfazer o retrocesso do relógio.", err, { gmOnly: true });
  }
}

/* ------------------------------------------------------------------ Registro */

function rerenderPads() {
  for (const app of foundry.applications.instances.values()) {
    if (app.id?.startsWith("nihility-pad-") && app.rendered) app.render();
  }
}

/** Ganchos do bloco (chamado por `registerWorldClock`). */
export function registerWorldTime() {
  Hooks.on("combatRound", holdCombatTime);
  Hooks.on("combatTurn", holdCombatTime);
  Hooks.on("updateCombat", (combat, changed, options) => {
    onCombatClock(combat, changed, options).catch(err => reportError("Falha ao somar o tempo da rodada.", err, { gmOnly: true }));
  });
  Hooks.on("deleteCombat", combat => {
    onCombatEnd(combat).catch(err => reportError("Falha ao passar o tempo do fim do combate.", err, { gmOnly: true }));
  });
  Hooks.on("updateWorldTime", (worldTime, dt, options) => {
    onWorldTimeBack(worldTime, dt, options);
    rerenderPads();
  });

  // Token chegando ou saindo de uma cena: guarda a data do aparelho (na saída) e ajusta o ritmo pessoal.
  Hooks.on("createToken", token => {
    if (!isDesignatedGm() || !calendarOn() || !token.actor) return;
    const actor = token.actor;
    // Antes do ritmo mudar, o aparelho guarda a data de ONDE o personagem estava (a cena anterior, se o
    // Token de lá ainda existe); um personagem novo nasce sincronizado com esta cena.
    const previous = actor.isToken ? null : game.scenes.find(s => s !== token.parent && s.tokens.some(t => t.actorLink && t.actorId === actor.id));
    settleDevices([actor], previous ?? token.parent).then(() => syncPersonalTime(actor)).catch(err => console.warn(`${SYSTEM_ID} | Tempo pessoal:`, err));
  });
  Hooks.on("deleteToken", token => {
    if (!isDesignatedGm() || !calendarOn() || !token.actor) return;
    const actor = token.actor;
    settleDevices([actor], token.parent).then(() => syncPersonalTime(actor)).catch(err => console.warn(`${SYSTEM_ID} | Tempo pessoal:`, err));
  });
  // A cena trocou de linha ou de "tem rede": antes de mudar, guarda a data de quem está nela.
  Hooks.on("preUpdateScene", (scene, changed) => {
    if (!isDesignatedGm() || !calendarOn()) return;
    if (!foundry.utils.hasProperty(changed, `flags.${SYSTEM_ID}.time`)) return;
    settleDevices(actorsInScene(scene), scene);
  });
  Hooks.on("updateScene", (scene, changed) => {
    if (!isDesignatedGm() || !calendarOn()) return;
    // A cena ativa decide a linha de quem tem Token em duas cenas: trocar a ativa também reajusta.
    if (!foundry.utils.hasProperty(changed, `flags.${SYSTEM_ID}.time`) && !("active" in changed)) return;
    syncAllPersonalTimes();
  });
  Hooks.on("updateActor", (actor, changed) => {
    if (foundry.utils.hasProperty(changed, `flags.${SYSTEM_ID}`)) rerenderPads();
  });

  Hooks.on("renderChatMessageHTML", renderTimeSyncControls);

  Hooks.once("ready", () => {
    if (isDesignatedGm()) syncAllPersonalTimes();
  });
}

export { CALENDAR_MODELS };
