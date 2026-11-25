/**
 * Relógio do mundo (J9): o lado Foundry. Regras puras em world-clock-rules.js. Bloco
 * `FEATURES.worldClock`.
 *
 *  - Tempo = `game.time.worldTime` (o combate já soma a rodada; o Mestre passa o resto pela janela
 *    "Relógio do mundo", pelo "Passar tempo" da Radiação e pelo Descanso).
 *  - **O jogador nunca vê a hora pela interface do Foundry.** O core só a mostra na janela de um
 *    Active Effect ("começou há…"), escondida aqui para quem não é Mestre. O jogador vê a hora no PAD
 *    e em Item Geral "Marca o tempo"; aparelho tecnológico suprimido (PEM, campo) mostra "--:--".
 *  - "Quando → Então": `selfDark`, `isDay`, `isNight` (contexto em `worldClockContext`). São
 *    condições de si, lidas na preparação da ficha: quando dia/noite vira, a escuridão da cena muda
 *    ou o Token entra/sai de uma Região de escuridão, os Atores com essas regras são repreparados
 *    (`actor.reset()`, nunca `prepareData()` sozinho).
 *  - Cena marcada "Escurece com o relógio" (flag `environment.clockDarkness`) tem a escuridão posta
 *    pelo Mestre designado conforme a hora; cena não marcada nunca muda.
 *  - Descanso fora de combate = Condição **Dormindo** (`sleeping`, incapacita) com `rest: {kind,
 *    until}`: acorda COM o descanso quando o relógio chega em `until`; dano na Vida ou o Mestre
 *    tirando à mão acordam SEM o descanso. Quando todos os PJs com jogador online dormem, o Mestre
 *    recebe o aviso "Passar o tempo (N h)".
 */
import { SYSTEM_ID, NIHILITY, getActiveStatusConditions, isWorldClockEnabled } from "./config.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { sceneDarkness, sceneDarknessUpdate, sceneStoredDarkness, sceneCycleOn } from "../helpers/foundry-compat.js";
import { sceneField, sceneConfigChanged } from "../environment/scene-config.js";
import { showVoiceBanner } from "./voice-banner.js";
import {
  personalNow, personalRate, ensurePersonalTrack, localNowForActor, lineNow, sceneLine, getTimelines, dayLengthSeconds, localDateText, setWorldClockLocal,
  registerWorldTime, deviceHour, itemClockText
} from "./world-time.js";
import { MAIN_LINE_ID, resolveLine } from "./calendar-rules.js";

// J9b: a hora do aparelho e a do item "Marca o tempo" agora vêm do tempo pessoal (world-time.js).
export { deviceHour, itemClockText };
import {
  normalizeClockConfig, isDayAt, darknessFor, isDarkLevel, darknessNeedsUpdate, adjustedDarkness,
  sleepUntil, shouldWake, groupSleepState, groupRestSeconds, skipLabel, restHours, SECONDS_PER_HOUR
} from "./world-clock-rules.js";
import { escapeHtml } from "../helpers/html.js";
import { zoneDarkensToken } from "../combat/zone-darkness.js";

const SLEEP_ID = "sleeping";
const CLOCK_WHEN = new Set(["selfDark", "isDay", "isNight"]);
/** A regra lê o relógio ou a escuridão? ("vezes a escuridão" também: o valor muda com a escuridão da cena.) */
const readsClock = mod => CLOCK_WHEN.has(mod?.when?.kind) || Boolean(mod?.timesDarkness);

/* ------------------------------------------------------------------ Leitura */

/** O ajuste do relógio (Regras da Mesa), com padrões se as settings ainda não existem. */
export function clockConfig() {
  const S = NIHILITY.SETTINGS;
  const read = key => {
    try {
      return game.settings.get(SYSTEM_ID, S[key]);
    } catch (err) {
      return undefined;
    }
  };
  return normalizeClockConfig({
    sunrise: read("clockSunrise"),
    sunset: read("clockSunset"),
    nightDarkness: read("clockNightDarkness"),
    darkThreshold: read("clockDarkThreshold"),
    shortRestHours: read("clockShortRestHours"),
    longRestHours: read("clockLongRestHours"),
    dayLength: dayLengthSeconds()
  });
}

/** O instante atual do mundo, em segundos. */
export function worldNow() {
  return Number(game.time?.worldTime) || 0;
}

/** A data e hora da linha principal ("14 Flo 1203 E.C. · 14:05"; "Dia 3 · 14:05" com o calendário desligado). */
export function clockText(worldTime = worldNow()) {
  const main = resolveLine(getTimelines(), MAIN_LINE_ID);
  return localDateText(lineNow(main, worldTime));
}

/** Token (documento) de um Ator, se tiver um. */
function tokenDocFor(actor) {
  try {
    if (actor?.isToken) return actor.token ?? null;
    return actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  } catch (err) {
    return null;
  }
}

/** Escuridão (0–1) onde o Token está: a da cena ajustada pelas Regiões de escuridão do core. */
export function tokenDarkness(tokenDoc, scene = tokenDoc?.parent ?? null) {
  const base = sceneDarkness(scene);
  const adjusts = [];
  for (const region of tokenDoc?.regions ?? []) {
    for (const behavior of region.behaviors ?? []) {
      if (behavior.type !== "adjustDarknessLevel" || behavior.disabled) continue;
      adjusts.push({ mode: behavior.system?.mode, modifier: behavior.system?.modifier });
    }
  }
  return adjustedDarkness(base, adjusts);
}

/**
 * O que o "Quando → Então" lê do relógio e da escuridão para este Ator. Bloco desligado: tudo falso
 * (uma regra "É noite" nunca vale).
 */
export function worldClockContext(actor) {
  if (!isWorldClockEnabled()) return { isDay: false, isNight: false, isDark: false, darkness: 0 };
  const config = clockConfig();
  // J9b: dia e noite pela hora LOCAL da linha onde o Ator está (uma cena 500 anos atrás pode estar de noite).
  const day = isDayAt(localNowForActor(actor), config);
  let dark = false;
  let darkness = 0;
  try {
    const token = tokenDocFor(actor);
    const scene = token?.parent ?? canvas?.scene ?? null;
    if (scene) {
      darkness = token ? tokenDarkness(token, scene) : sceneDarkness(scene);
      // Zona que escurece o mapa (1.120.0): quem está dentro dela conta como no escuro, com a escuridão no máximo.
      if (token && zoneDarkensToken(token)) darkness = 1;
      dark = isDarkLevel(darkness, config.darkThreshold);
    }
  } catch (err) {
    dark = false;
    darkness = 0;
  }
  return { isDay: day, isNight: !day, isDark: dark, darkness: Math.min(1, Math.max(0, Number(darkness) || 0)) };
}

/* ------------------------------------------------------------------ Passar o tempo (Mestre) */

/** Soma `seconds` ao tempo do mundo (qualquer Mestre; o core grava). */
export async function advanceWorldClock(seconds) {
  const s = Math.floor(Number(seconds) || 0);
  if (!game.user.isGM || s <= 0 || !isWorldClockEnabled()) return false;
  await game.time.advance(s);
  return true;
}

/**
 * "Definir dia/hora": ajusta a data da linha PRINCIPAL (o `base`); o tempo do mundo nunca volta
 * (até o J9b isto chamava `advance` negativo, o que quebrava o Dormindo e as superfícies).
 */
export async function setWorldClock(localTime) {
  const t = Math.floor(Number(localTime));
  if (!game.user.isGM || !Number.isFinite(t) || !isWorldClockEnabled()) return false;
  return setWorldClockLocal(t);
}

/* ------------------------------------------------------------------ Escuridão das cenas */

function clockScenes() {
  return game.scenes.filter(scene => sceneField(scene, "clockDarkness"));
}

/** Põe a escuridão das cenas marcadas conforme a hora. Só o Mestre designado. */
export async function applySceneDarkness() {
  if (!isDesignatedGm() || !isWorldClockEnabled()) return;
  const config = clockConfig();
  for (const scene of clockScenes()) {
    // J9b: a escuridão de cada cena segue a hora da linha dela.
    const target = darknessFor(lineNow(sceneLine(scene)), config);
    if (!darknessNeedsUpdate(sceneStoredDarkness(scene), target) && !sceneCycleOn(scene)) continue;
    try {
      await scene.update(sceneDarknessUpdate(target), { animateDarkness: 2000 });
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Relógio: não consegui mudar a escuridão de "${scene.name}".`, err);
    }
  }
}

/* ------------------------------------------------------------------ Repreparar quem depende de dia/escuro */

const lastKeys = new Map();
let refreshTimer = null;

/** Os Atores (Diretório e Tokens da cena aberta) que têm regra "Quando" de relógio/escuro. */
function clockAwareActors() {
  const seen = new Set();
  const out = [];
  const push = actor => {
    if (!actor || seen.has(actor.uuid)) return;
    seen.add(actor.uuid);
    out.push(actor);
  };
  for (const actor of game.actors) push(actor);
  for (const token of canvas?.scene?.tokens ?? []) if (!token.actorLink) push(token.actor);
  return out.filter(actor => (actor.items ?? []).some(item => (item.system?.conditionalModifiers ?? []).some(readsClock)) ||
    (actor.system?.originLayers ?? []).some(layer => (layer.entry?.passives?.conditionalModifiers ?? []).some(readsClock)));
}

/** Reprepara os Atores cujo "dia/noite/escuro" mudou desde a última conferência (neste cliente). */
export function refreshClockActors() {
  if (!isWorldClockEnabled()) return;
  for (const actor of clockAwareActors()) {
    const ctx = worldClockContext(actor);
    const key = `${ctx.isDay}|${ctx.isDark}|${ctx.darkness.toFixed(2)}`;
    const previous = lastKeys.get(actor.uuid);
    lastKeys.set(actor.uuid, key);
    if (previous === undefined || previous === key) continue;
    // reset(), não prepareData(): este reaplicava os Active Effects por cima do já preparado.
    actor.reset();
    if (actor.sheet?.rendered) actor.sheet.render();
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    try {
      refreshClockActors();
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Relógio: falha ao repreparar os Atores.`, err);
    }
  }, 150);
}

/* ------------------------------------------------------------------ Dormir */

function sleepCondition() {
  const condition = getActiveStatusConditions().find(c => c.id === SLEEP_ID);
  return { label: condition?.label ?? "Dormindo", icon: condition?.icon || "icons/svg/sleep.svg" };
}

/** O efeito "Dormindo" do Ator, se houver. */
export function sleepingEffect(actor) {
  return actor?.effects?.find(e => e.statuses?.has?.(SLEEP_ID)) ?? null;
}

/** Os dados do descanso que o Ator está fazendo: `{kind, until}` ou null. */
export function sleepState(actor) {
  const rest = sleepingEffect(actor)?.getFlag(SYSTEM_ID, "rest");
  return rest ? { kind: rest.kind === "long" ? "long" : "short", until: Number(rest.until) || 0 } : null;
}

/**
 * Põe o Ator para dormir (o "Descansar…" fora de combate): Condição Dormindo com `rest`. Devolve
 * false se já dorme. Quem chama é o dono da ficha ou o Mestre.
 */
export async function startSleeping(actor, kind) {
  if (!actor || sleepingEffect(actor)) return false;
  // J9b: `until` está no tempo pessoal de quem dorme (que precisa de um trecho se está fora do ritmo 1).
  await ensurePersonalTrack(actor);
  const rest = { kind: kind === "long" ? "long" : "short", until: sleepUntil(personalNow(actor), kind, clockConfig()) };
  const { label, icon } = sleepCondition();
  await actor.createEmbeddedDocuments(
    "ActiveEffect",
    [{ name: label, img: icon, statuses: [SLEEP_ID], flags: { [SYSTEM_ID]: { skillEffect: true, conditionId: SLEEP_ID, rest } } }],
    { nihilityConfigured: true }
  );
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${escapeHtml(actor.name)}</strong> foi dormir (Descanso ${rest.kind === "long" ? "Completo" : "Curto"}, ${restHours(rest.kind, clockConfig())} h).</p>`
  });
  return true;
}

/**
 * Acorda o Ator. `rested` = o tempo passou: o Descanso do tipo escolhido é aplicado agora. Sem ele
 * (dano, ou o Mestre tirou), só acorda. Só o Mestre designado.
 */
export async function wakeSleeper(actor, { rested = false } = {}) {
  const effect = sleepingEffect(actor);
  if (!effect) return false;
  const kind = sleepState(actor)?.kind ?? "short";
  await effect.delete();
  if (rested) {
    const { applyRestKind } = await import("../combat/regeneration.js");
    await applyRestKind(actor, kind);
  } else {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${escapeHtml(actor.name)}</strong> acordou sem terminar o descanso.</p>`
    });
  }
  return true;
}

/** Atores que o relógio confere para o sono: Diretório e Tokens não vinculados da cena aberta. */
function sleepScanActors() {
  const list = [...game.actors];
  for (const token of canvas?.scene?.tokens ?? []) if (!token.actorLink && token.actor) list.push(token.actor);
  return list.filter(actor => actor.type === "character");
}

/** Quem acorda agora com o descanso feito (o relógio passou de `until`). Só o Mestre designado. */
export async function wakeDueSleepers() {
  if (!isDesignatedGm() || !isWorldClockEnabled()) return;
  for (const actor of sleepScanActors()) {
    const state = sleepState(actor);
    // Tempo pessoal (se voltou, a pessoa só dorme mais: a comparação segue sendo >=).
    if (state && shouldWake(state.until, personalNow(actor))) await wakeSleeper(actor, { rested: true });
  }
}

/** Os PJs: ficha de Personagem com jogador dono online. */
export function partyMembers() {
  return game.actors.filter(actor => actor.type === "character" && actor.system?.isPlayerCharacter !== false &&
    game.users.some(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER")));
}

let lastGroupKey = "";

/**
 * Todos os PJs dormindo: o Mestre (designado) recebe o cartão da Voz do Mundo com "Passar o tempo
 * (N h)". Um aviso por estado (não repete a cada rodada).
 */
export function checkGroupSleep() {
  if (!isDesignatedGm() || !isWorldClockEnabled()) return;
  const members = partyMembers().map(actor => ({ id: actor.id, sleeping: Boolean(sleepingEffect(actor)), until: sleepState(actor)?.until ?? 0, now: personalNow(actor), rate: personalRate(actor) }));
  const state = groupSleepState(members, worldNow());
  if (!state.all || state.skipSeconds <= 0) {
    lastGroupKey = "";
    return;
  }
  const key = members.map(m => `${m.id}:${m.until}`).sort().join(",");
  if (key === lastGroupKey) return;
  lastGroupKey = key;
  showVoiceBanner({
    label: "Relógio do mundo",
    title: "Todos os personagens estão dormindo",
    body: "Passe o tempo para todos acordarem com o descanso feito.",
    actions: [{ label: skipLabel(state.skipSeconds), primary: true, onClick: () => advanceWorldClock(state.skipSeconds) }]
  });
}

/**
 * "Descanso do grupo" (Mestre): põe todos os PJs que ainda não dormem para dormir e passa o tempo de
 * uma vez; todos acordam com o descanso. Devolve quantos descansaram.
 */
export async function groupRest(kind) {
  if (!game.user.isGM || !isWorldClockEnabled()) return 0;
  const members = partyMembers();
  let count = 0;
  for (const actor of members) {
    if (await startSleeping(actor, kind)) count += 1;
  }
  if (!members.length) return 0;
  const hours = restHours(kind, clockConfig());
  // C15: quem está numa linha lenta leva mais tempo de mundo para acordar (falta pessoal ÷ ritmo): passa o maior.
  const sleepers = members.map(actor => ({ sleeping: Boolean(sleepingEffect(actor)), until: sleepState(actor)?.until ?? 0, now: personalNow(actor), rate: personalRate(actor) }));
  await advanceWorldClock(groupRestSeconds(sleepers, hours * SECONDS_PER_HOUR, worldNow()));
  return count;
}

/* ------------------------------------------------------------------ Registro */

export function registerWorldClock() {
  registerWorldTime();
  Hooks.on("updateWorldTime", async () => {
    if (!isWorldClockEnabled()) return;
    scheduleRefresh();
    // Fichas abertas com um item "Marca o tempo" mostram a hora nova.
    for (const actor of game.actors) {
      if (actor.sheet?.rendered && actor.items.some(i => i.system?.marksTime)) actor.sheet.render();
    }
    if (!isDesignatedGm()) return;
    try {
      await applySceneDarkness();
      await wakeDueSleepers();
      checkGroupSleep();
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Relógio: falha ao atualizar o tempo.`, err);
    }
  });

  Hooks.once("ready", () => {
    if (!isWorldClockEnabled()) return;
    lastKeys.clear();
    refreshClockActors();
    applySceneDarkness();
  });
  Hooks.on("canvasReady", () => {
    lastKeys.clear();
    scheduleRefresh();
  });

  // A cena mudou de escuridão ou de marca; Token andou/subiu; Região de escuridão mudou.
  Hooks.on("updateScene", (scene, changed) => {
    const darkChanged = foundry.utils.hasProperty(changed, "environment.darknessLevel") || "darkness" in changed;
    if (darkChanged) scheduleRefresh();
    if (foundry.utils.hasProperty(changed, `flags.${SYSTEM_ID}.environment`) || foundry.utils.hasProperty(changed, `flags.${SYSTEM_ID}.time`) || sceneConfigChanged(changed)) applySceneDarkness();
  });
  Hooks.on("updateToken", (token, changed) => {
    if ("x" in changed || "y" in changed || "elevation" in changed || "level" in changed) scheduleRefresh();
  });
  const regionChanged = behavior => {
    if (behavior.type === "adjustDarknessLevel") scheduleRefresh();
  };
  // Zona que escurece o mapa nasce ou some: quem está dentro muda de "escuro".
  const zoneDocChanged = doc => {
    if (doc?.getFlag?.(SYSTEM_ID, "zone")?.darkens) scheduleRefresh();
  };
  Hooks.on("createRegion", zoneDocChanged);
  Hooks.on("deleteRegion", zoneDocChanged);
  Hooks.on("createMeasuredTemplate", zoneDocChanged);
  Hooks.on("deleteMeasuredTemplate", zoneDocChanged);
  Hooks.on("createRegionBehavior", regionChanged);
  Hooks.on("updateRegionBehavior", regionChanged);
  Hooks.on("deleteRegionBehavior", regionChanged);

  // Dormindo: dano na Vida acorda sem o descanso; o efeito sair (ou entrar) reavalia o grupo.
  Hooks.on("preUpdateActor", (actor, changed, options) => {
    const next = foundry.utils.getProperty(changed, "system.attributes.hp.value");
    if (next === undefined || !sleepingEffect(actor)) return;
    if (Number(next) < Number(actor.system?.attributes?.hp?.value)) options.nihilityWakeByDamage = true;
  });
  Hooks.on("updateActor", async (actor, changed, options) => {
    if (!options?.nihilityWakeByDamage || !isDesignatedGm() || !isWorldClockEnabled()) return;
    await wakeSleeper(actor, { rested: false });
  });
  const sleepEffectChanged = effect => {
    if (!effect.statuses?.has?.(SLEEP_ID) || !isWorldClockEnabled()) return;
    setTimeout(() => checkGroupSleep(), 100);
  };
  Hooks.on("createActiveEffect", sleepEffectChanged);
  Hooks.on("deleteActiveEffect", sleepEffectChanged);

  // O core mostra "começou há…" na janela do efeito; o jogador não vê o tempo.
  Hooks.on("renderActiveEffectConfig", (app, html) => {
    if (game.user.isGM) return;
    const root = html instanceof HTMLElement ? html : app?.element;
    root?.querySelectorAll?.("fieldset.start-data")?.forEach(el => el.remove());
  });
}
