/**
 * Sensores e furtividade de nave (F1) — o lado Foundry. As contas puras estão em `sensor-rules.js` (testado em
 * `test/sensors.test.mjs`). Resumo:
 *
 *  - Uma nave tem **sensor** quando algum Módulo dela tem a função "sensor". Sem sensor instalado a tripulação
 *    continua vendo tudo como antes (nada some em mundos antigos); com sensor, só vê as naves que ele alcança.
 *  - **Retrato da cena** (`sensorPicture`, flag da Cena em JSON): o Mestre designado refaz, a cada mudança que
 *    importa (movimento, Módulo, Interferência, rodada), quem cada nave com sensor vê e os "últimos contatos". Os
 *    clientes só leem esse retrato. Sem retrato ainda, ninguém some.
 *  - **Quem some:** o Token de nave/veículo não detectado some do mapa (`Token#isVisible` da subclasse), da lista
 *    de alvos (`actorPerceivedByUser`) e da iniciativa (`Combatant#visible`) **só** para jogadores que tripulam uma
 *    nave com sensor. O Mestre, o dono, a nave marcada "sempre detectada" e quem não tripula nada veem tudo.
 *  - **Último contato:** marcador cinza onde a nave foi vista pela última vez, numa camada DOM sobre o mapa
 *    (nada de API de desenho do PIXI, que mudou entre versões). Some em N rodadas de combate.
 *  - **Escanear:** botão do sensor ou a Skill Analisar; leitura em degraus (`buildScanReading`), card ao jogador
 *    numa janela e ao chat.
 * Desligado (`FEATURES.shipSensors`): nada disto age e todo mundo volta a ver tudo; nada salvo se perde.
 */
import {
  SYSTEM_ID, isVesselsEnabled, isShipSensorsEnabled, isInterferenceEnabled, getSensorTuning, getAnalysisAttrStep,
  getStarshipEnergyAbbr, moduleRole
} from "../core/config.js";
import { sceneField } from "../environment/scene-config.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { escapeHtml } from "../helpers/html.js";
import { isShipLike } from "./ship-damage.js";
import { antimagicFieldLevelAtToken } from "../structures/structures.js";
import {
  signatureBreakdown, sensorRangeNow, sensorResolutionNow, detects, detectLimit, sensorBlindReason, strongestBlock, scanQuality,
  buildScanReading, analysisResolution, nextPicture, ageContacts, samePicture, shipHiddenBySensors, contactStatus, lastContactText,
  fireSignatureActive
} from "./sensor-rules.js";

export const PICTURE_FLAG = "sensorPicture";
export const SHOT_FLAG = "shotSignature";
const SHOT_PERSIST_MS = 12000;

/* ------------------------------------------------------------------ Leitura do que a nave tem */

/** O bloco de sensores vale agora? (Naves ligadas e o bloco ligado.) */
export function sensorsOn() {
  try {
    return isVesselsEnabled() && isShipSensorsEnabled();
  } catch (err) {
    return false;
  }
}

/** O Módulo tem esta função extra (`system.functions`)? */
export const moduleHasFunction = (module, fn) => Array.isArray(module?.system?.functions) && module.system.functions.includes(fn);

/** Os Módulos da nave com uma função extra. */
export function modulesWithFunction(ship, fn) {
  return (ship?.system?.modules ?? []).filter(m => moduleHasFunction(m, fn));
}

/** O Módulo está operando agora (ligado, com Vida e com energia)? */
export function moduleOperating(ship, module) {
  return module.system.status === "online" && (module.system.hp?.value ?? 1) > 0 && !ship.system.isPowerStarved?.(module);
}

/** O centro do Token em unidades de pixel da cena. */
export function tokenCenterPx(tokenDoc) {
  const size = Number(tokenDoc?.parent?.grid?.size) || 100;
  const src = tokenDoc?._source ?? tokenDoc ?? {};
  return { x: (Number(src.x) || 0) + ((Number(src.width) || 1) * size) / 2, y: (Number(src.y) || 0) + ((Number(src.height) || 1) * size) / 2 };
}

/** Distância entre dois Tokens, em unidades da cena (centro a centro). */
export function tokenDistance(a, b) {
  const scene = a?.parent ?? b?.parent;
  const size = Number(scene?.grid?.size) || 100;
  const unit = Number(scene?.grid?.distance) || 1;
  const pa = tokenCenterPx(a);
  const pb = tokenCenterPx(b);
  return (Math.hypot(pa.x - pb.x, pa.y - pb.y) / size) * unit;
}

/** O corte de Interferência da cena (%), com a herança da pasta. */
export function sceneInterference(scene) {
  try {
    return Math.min(100, Math.max(0, Number(sceneField(scene, "sensorInterference")) || 0));
  } catch (err) {
    return 0;
  }
}

/**
 * O estado do sensor de uma nave: os Módulos, a Resolução e o alcance de agora.
 * @returns {{has:boolean, ready:boolean, reason:string, mode:string, rangeBase:number, range:number, resolution:number, resolutionBase:number, interference:number, modules:Array<{id:string,name:string,operating:boolean}>}}
 */
export function shipSensorInfo(ship, tokenDoc = null) {
  const tuning = getSensorTuning();
  const modules = modulesWithFunction(ship, "sensor");
  const mode = ship?.system?.sensorMode === "passive" ? "passive" : "active";
  const scene = tokenDoc?.parent ?? null;
  const interference = scene ? sceneInterference(scene) : 0;
  const empty = { has: false, ready: false, reason: "", mode, rangeBase: 0, range: 0, resolution: 0, resolutionBase: 0, interference, modules: [] };
  if (!ship || !modules.length) return empty;
  let techField = false;
  if (tokenDoc && isInterferenceEnabled()) {
    try {
      techField = antimagicFieldLevelAtToken(tokenDoc, null, "tech").level > 0;
    } catch (err) {
      techField = false;
    }
  }
  const working = modules.filter(m => moduleOperating(ship, m));
  const best = working.reduce((top, m) => (Number(m.system.sensorRange) || 0) > (Number(top?.system.sensorRange) || 0) ? m : top, working[0] ?? null);
  const resolutionBase = working.reduce((max, m) => Math.max(max, Number(m.system.sensorResolution) || 0), 0);
  const first = modules[0];
  const reason = working.length
    ? sensorBlindReason({ online: true, powered: true, hp: 1, techField, interference })
    : sensorBlindReason({
        online: first.system.status === "online",
        powered: !ship.system.isPowerStarved?.(first),
        hp: first.system.hp?.value ?? 1,
        techField,
        interference
      }) || "desligado ou sob PEM";
  const blind = Boolean(reason);
  const rangeBase = Number(best?.system.sensorRange) || 0;
  return {
    has: true,
    ready: !blind && rangeBase > 0,
    reason,
    mode,
    rangeBase,
    range: sensorRangeNow({ range: rangeBase, mode, interference, blind, tuning }),
    resolutionBase,
    resolution: blind ? 0 : sensorResolutionNow({ resolution: resolutionBase, mode, tuning }),
    interference,
    modules: modules.map(m => ({ id: m.id, name: m.name, operating: moduleOperating(ship, m) }))
  };
}

/** O disparo recente da nave (Assinatura do disparo ainda valendo), em % somados. */
export function recentFireSignature(ship, now = Date.now()) {
  const flag = ship?.getFlag?.(SYSTEM_ID, SHOT_FLAG);
  if (!flag) return 0;
  const round = game.combat?.started ? game.combat.round : null;
  return fireSignatureActive(flag, { round, now, persistMs: SHOT_PERSIST_MS }) ? Math.max(0, Number(flag.amount) || 0) : 0;
}

/** A Assinatura da nave e de onde ela vem (`{total, segments}`). */
export function shipSignatureInfo(ship) {
  const sys = ship?.system;
  const info = shipSensorInfoLite(ship);
  const camo = modulesWithFunction(ship, "camouflage").filter(m => moduleOperating(ship, m));
  const camoTarget = camo.length ? Math.min(...camo.map(m => Number(m.system.camoSignature) || 0)) : null;
  const supply = Math.min(Number(sys?.powerGrid?.reactorOutput) || 0, Number(sys?.transferCapacity) || 0);
  return signatureBreakdown({
    rank: sys?.vesselSize?.rank ?? 2,
    consumption: sys?.totalConsumption ?? 0,
    supply,
    mode: info.mode,
    fire: recentFireSignature(ship),
    camouflage: camoTarget === null ? null : { active: true, target: camoTarget },
    extra: Number(sys?.combatBonuses?.signaturePercent) || 0,
    tuning: getSensorTuning()
  });
}

const shipSensorInfoLite = ship => ({ mode: ship?.system?.sensorMode === "passive" ? "passive" : "active" });

/** Anota o disparo de uma arma de nave (a Assinatura sobe por 1 rodada). */
export async function registerShotSignature(ship, weaponModule) {
  if (!sensorsOn() || !ship) return;
  const amount = Number(weaponModule?.system?.fireSignature);
  const add = Number.isFinite(amount) ? Math.max(0, amount) : 50;
  if (!(add > 0)) return;
  const round = game.combat?.started ? game.combat.round : null;
  const current = recentFireSignature(ship);
  try {
    await ship.setFlag(SYSTEM_ID, SHOT_FLAG, { amount: current + add, round, ts: Date.now() });
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Assinatura do disparo não anotada.`, err);
  }
}

/* ------------------------------------------------------------------ Retrato da cena (Mestre designado) */

const shipTokens = scene => (scene?.tokens ?? []).filter(t => t.actor && isShipLike(t.actor) && !t.hidden);

/** Lê o retrato gravado (objeto) ou `null`. */
export function readPicture(scene) {
  try {
    const raw = scene?.getFlag?.(SYSTEM_ID, PICTURE_FLAG);
    if (!raw) return null;
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value && typeof value === "object" ? value : null;
  } catch (err) {
    return null;
  }
}

/** Calcula o retrato da cena a partir dos documentos (sem escrever). */
export function computePicture(scene, previous = null, { age = false } = {}) {
  const tuning = getSensorTuning();
  const tokens = shipTokens(scene);
  const observers = {};
  for (const observer of tokens) {
    const info = shipSensorInfo(observer.actor, observer);
    if (!info.has) continue;
    const now = {};
    for (const target of tokens) {
      if (target.id === observer.id) continue;
      const sig = shipSignatureInfo(target.actor).total;
      const always = Boolean(target.actor.system?.alwaysDetected);
      if (always || detects({ distance: tokenDistance(observer, target), range: info.range, signature: sig })) {
        const c = tokenCenterPx(target);
        now[target.id] = { x: Math.round(c.x), y: Math.round(c.y), name: target.name || target.actor.name, img: target.texture?.src ?? "" };
      }
    }
    const prev = previous?.observers?.[observer.id];
    const base = prev ? { seen: prev.seen, last: age ? ageContacts(prev.last, tuning.lostRounds) : prev.last } : null;
    const picture = nextPicture(base, now);
    observers[observer.id] = { actor: observer.actor.uuid, seen: picture.seen, last: picture.last };
  }
  return { observers };
}

let refreshTimer = null;
let agePending = false;

/** Refaz o retrato (só o Mestre designado) e grava se mudou. */
export async function refreshScenePicture(scene = canvas?.scene) {
  if (!sensorsOn() || !scene || !isDesignatedGm()) return;
  try {
    const previous = readPicture(scene);
    const age = agePending;
    agePending = false;
    const next = computePicture(scene, previous, { age });
    if (samePicture(previous, next)) return;
    await scene.update({ [`flags.${SYSTEM_ID}.${PICTURE_FLAG}`]: JSON.stringify(next) });
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Retrato dos sensores não atualizado.`, err);
  }
}

/** Pede o refazer do retrato daqui a pouco (junta várias mudanças seguidas). */
function scheduleRefresh({ age = false } = {}) {
  if (!sensorsOn() || !isDesignatedGm()) return;
  if (age) agePending = true;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshScenePicture(), 300);
}

/* ------------------------------------------------------------------ O que cada usuário vê */

/** Os Tokens de nave que o usuário tripula na cena e que têm sensor instalado. */
export function userObservers(scene, user = game.user) {
  return shipTokens(scene).filter(t => {
    const ship = t.actor;
    if (!modulesWithFunction(ship, "sensor").length) return false;
    return (ship.system.crewActors ?? []).some(entry => entry.actor?.testUserPermission?.(user, "OWNER"));
  });
}

/** O Token de nave está escondido deste usuário pelos sensores? */
export function tokenHiddenBySensors(tokenDoc, user = game.user) {
  try {
    if (!sensorsOn() || user.isGM) return false;
    const actor = tokenDoc?.actor;
    if (!actor || !isShipLike(actor)) return false;
    const scene = tokenDoc.parent;
    if (!scene) return false;
    const observers = userObservers(scene, user);
    const picture = readPicture(scene);
    const seenBy = observers.some(o => Boolean(picture?.observers?.[o.id]?.seen?.[tokenDoc.id]));
    return shipHiddenBySensors({
      isGM: false,
      isOwner: actor.testUserPermission?.(user, "OWNER") ?? false,
      alwaysDetected: Boolean(actor.system?.alwaysDetected),
      restricted: observers.length > 0,
      pictureReady: Boolean(picture),
      seenBy
    });
  } catch (err) {
    return false;
  }
}

/** O Ator de nave (lista de alvos) está escondido deste usuário? Vale se TODOS os Tokens dele na cena estão. */
export function actorHiddenBySensors(actor, user = game.user) {
  try {
    if (!sensorsOn() || user.isGM || !actor || !isShipLike(actor)) return false;
    const scene = canvas?.scene;
    const tokens = scene?.tokens?.filter(t => t.actor && (actor.isToken ? t.actor.uuid === actor.uuid : t.actorId === actor.id)) ?? [];
    if (!tokens.length) return false;
    return tokens.every(t => tokenHiddenBySensors(t, user));
  } catch (err) {
    return false;
  }
}

/** O combatente (nave) está escondido deste usuário pelos sensores? */
export function combatantHiddenBySensors(combatant, user = game.user) {
  try {
    const tokenDoc = combatant?.token;
    return Boolean(tokenDoc) && tokenHiddenBySensors(tokenDoc, user);
  } catch (err) {
    return false;
  }
}

/** Os últimos contatos que o usuário vê (os que nenhuma nave dele vê agora): `[{id, x, y, name, age}]`. */
export function lastContactsFor(scene, user = game.user) {
  if (!sensorsOn() || user.isGM) return [];
  const picture = readPicture(scene);
  if (!picture) return [];
  const observers = userObservers(scene, user);
  if (!observers.length) return [];
  const seenNow = new Set(observers.flatMap(o => Object.keys(picture.observers?.[o.id]?.seen ?? {})));
  const out = new Map();
  for (const o of observers) {
    for (const [id, c] of Object.entries(picture.observers?.[o.id]?.last ?? {})) {
      if (seenNow.has(id)) continue;
      const known = out.get(id);
      if (!known || (Number(c.age) || 0) < known.age) out.set(id, { id, x: c.x, y: c.y, name: c.name, age: Number(c.age) || 0 });
    }
  }
  return [...out.values()];
}

/* ------------------------------------------------------------------ Mapa: visibilidade e marcadores cinza */

/** Refaz a visibilidade dos Tokens de nave (depois de o retrato mudar). */
export function refreshShipVisibility() {
  if (!canvas?.ready) return;
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.destroyed || !isShipLike(token.document?.actor)) continue;
    try {
      token.renderFlags?.set({ refreshVisibility: true });
    } catch (err) {
      /* sem renderFlags nesta versão */
    }
    try {
      token.visible = token.isVisible;
    } catch (err) {
      /* ainda sem estágio */
    }
  }
  try {
    canvas.perception?.update({ refreshVision: true });
  } catch (err) {
    /* sem percepção */
  }
}

let markerRoot = null;

function ensureMarkerRoot() {
  const host = canvas?.app?.canvas?.parentElement ?? document.getElementById("board")?.parentElement;
  if (!host) return null;
  if (markerRoot && markerRoot.isConnected) return markerRoot;
  markerRoot = document.createElement("div");
  markerRoot.className = "nihility-contact-layer";
  host.appendChild(markerRoot);
  return markerRoot;
}

/** Desenha os marcadores cinza dos últimos contatos (camada DOM acompanhando o pan e o zoom). */
export function drawContactMarkers() {
  try {
    if (!canvas?.ready) return;
    const contacts = sensorsOn() ? lastContactsFor(canvas.scene) : [];
    if (!contacts.length) {
      markerRoot?.replaceChildren();
      return;
    }
    const root = ensureMarkerRoot();
    if (!root) return;
    const size = Number(canvas.scene.grid?.size) || 100;
    const transform = canvas.stage.worldTransform;
    const scale = canvas.stage.scale?.x ?? 1;
    const canvasEl = canvas.app.canvas;
    const offsetX = canvasEl.offsetLeft ?? 0;
    const offsetY = canvasEl.offsetTop ?? 0;
    root.replaceChildren(
      ...contacts.map(c => {
        const el = document.createElement("div");
        el.className = "nihility-contact-marker";
        const px = transform.a * c.x + transform.c * c.y + transform.tx + offsetX;
        const py = transform.b * c.x + transform.d * c.y + transform.ty + offsetY;
        const diameter = Math.max(24, size * scale);
        el.style.cssText = `left:${px}px;top:${py}px;width:${diameter}px;height:${diameter}px;`;
        el.innerHTML = `<span class="nihility-contact-name">${escapeHtml(c.name || "Contato")}<small>${escapeHtml(lastContactText(c.age))}</small></span>`;
        return el;
      })
    );
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Marcadores de último contato não desenhados.`, err);
  }
}

/** Depois de o retrato mudar: mapa, marcadores e (para jogador) a lista de iniciativa. */
function onPictureChanged() {
  refreshShipVisibility();
  drawContactMarkers();
  if (!game.user.isGM) {
    try {
      ui.combat?.render();
    } catch (err) {
      /* sem lista aberta */
    }
  }
  try {
    for (const app of foundry.applications.instances?.values?.() ?? []) {
      if (app.actor && isShipLike(app.actor) && app.rendered) app.render({ parts: ["sensores"] });
    }
  } catch (err) {
    /* sem fichas abertas */
  }
}

/** Entra na cadeia de `CONFIG.Token.objectClass`: o Token de nave não detectado não é visível. */
function registerTokenObject() {
  const Base = CONFIG.Token.objectClass;
  CONFIG.Token.objectClass = class NihilitySensorToken extends Base {
    /** @override */
    get isVisible() {
      const visible = super.isVisible;
      if (!visible) return visible;
      return !tokenHiddenBySensors(this.document);
    }
  };
}

/* ------------------------------------------------------------------ Escanear */

/** A camada mais forte de leitura de uma nave: Escudo (só de pé), Blindagem e Bloqueio de varredura. */
export function targetScanBlock(target) {
  const modules = target?.system?.modules ?? [];
  const shieldUp = (Number(target?.system?.shields?.value) || 0) > 0;
  const layers = [];
  for (const m of modules) {
    const value = Number(m.system.scanBlock) || 0;
    if (!(value > 0) || m.system.status !== "online" || (m.system.hp?.value ?? 1) <= 0) continue;
    const kind = moduleRoleOf(m);
    if (kind === "shield") layers.push({ id: "shield", label: "Escudo", value, counts: shieldUp && !target.system.isPowerStarved?.(m) });
    else if (kind === "armor") layers.push({ id: "armor", label: "Blindagem", value, counts: true });
    else if (moduleHasFunction(m, "scanBlock")) layers.push({ id: "scanBlock", label: "Bloqueio de varredura", value, counts: !target.system.isPowerStarved?.(m) });
    else layers.push({ id: "module", label: m.name, value, counts: true });
  }
  return strongestBlock(layers);
}

const moduleRoleOf = module => moduleRole(module?.system?.category);

/** Os números reais de uma nave para a leitura (só em memória; quem vê é decidido por `buildScanReading`). */
export function scanRealData(target) {
  const sys = target.system;
  const stateOf = m => {
    if (m.system.status === "damaged") return "damaged";
    if (m.system.status !== "online") return "offline";
    if (sys.isPowerStarved?.(m)) return "starved";
    return (m.system.hp?.max ?? 0) > 0 && (m.system.hp?.value ?? 0) / m.system.hp.max < 0.5 ? "damaged" : "online";
  };
  const weapons = (sys.modules ?? []).filter(m => moduleRoleOf(m) === "weapon");
  const cargoMax = Number(sys.cargoSlots) || 0;
  return {
    sizeLabel: sys.vesselSize?.label ?? "",
    className: sys.vesselClass?.label ?? "",
    shield: { value: Number(sys.shields?.value) || 0, max: Number(sys.shields?.max) || 0 },
    casco: { value: Number(sys.casco?.value) || 0, max: Number(sys.casco?.max) || 0 },
    hullPercent: sys.hull?.max > 0 ? (100 * (Number(sys.hull.value) || 0)) / sys.hull.max : 0,
    modules: (sys.modules ?? []).map(m => ({ name: m.name, state: stateOf(m), hpPercent: m.system.hp?.max > 0 ? (100 * (m.system.hp.value || 0)) / m.system.hp.max : 0 })),
    weapons: weapons.map(m => ({ name: m.name, penetration: Number(m.system.penetration) || 0 })),
    cargo: cargoMax > 0 ? { value: Number(sys.cargoLoad?.slots) || 0, max: cargoMax } : null,
    crew: (sys.crewMembers ?? []).length
  };
}

/** A leitura de uma nave a partir de uma Resolução (a do sensor ou a da Skill). */
export function scanShipReading(target, { resolution, passive = false, exact = game.user.isGM } = {}) {
  const block = targetScanBlock(target);
  const q = scanQuality(resolution, block.value, getSensorTuning());
  const reading = buildScanReading({ quality: q.quality, margin: q.margin, passive, real: scanRealData(target), exact, tuning: getSensorTuning() });
  return { ...reading, block, resolution };
}

const QUALITY_LABEL = { clean: "Leitura limpa", distorted: "Leitura distorcida", blocked: "Leitura bloqueada" };

/** O HTML (escapado) de uma leitura, usado na janela e no chat. */
export function scanReadingHtml(reading, { observerName = "", targetName = "", via = "" } = {}) {
  const steps = reading.steps
    .map(s => {
      const body = s.lines.map(l => `<div class="v">${escapeHtml(l)}</div>`).join("");
      return `<div class="st ${s.state === "blocked" || s.state === "unreached" ? "off" : ""}"><div class="n"><i>${s.step}</i><b>${escapeHtml(s.label)}</b></div>${body}</div>`;
    })
    .join("");
  const note = reading.block?.value > 0 ? ` · ${escapeHtml(reading.block.label || "bloqueio")} ${reading.block.value}` : "";
  return `<div class="nihility-scan"><header><h3>Escanear: ${escapeHtml(targetName)}</h3><p class="hint">leitura feita por ${escapeHtml(observerName)}${via ? ` com ${escapeHtml(via)}` : ""} · Resolução ${reading.resolution} − Bloqueio ${reading.block?.value ?? 0}${note}</p><span class="nihility-scan-q q-${reading.quality}">${escapeHtml(QUALITY_LABEL[reading.quality] ?? reading.quality)}</span></header>${steps}</div>`;
}

/** Mostra a leitura numa janela, com "Enviar ao chat". */
export async function showScanReading(reading, meta = {}) {
  const content = scanReadingHtml(reading, meta);
  const send = await foundry.applications.api.DialogV2.wait({
    window: { title: "Escanear", icon: "fa-solid fa-satellite-dish" },
    classes: ["nihility-scan-dialog"],
    content: `<div class="nihility-scan-wrap">${content}</div>`,
    buttons: [
      { action: "chat", label: "Enviar ao chat", icon: "fa-solid fa-comment", callback: () => true },
      { action: "close", label: "Fechar", default: true, callback: () => false }
    ],
    rejectClose: false
  });
  if (send) await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ alias: meta.observerName || "Sensores" }) });
}

/** Por que esta nave não pode escanear aquela (ou `""`). */
export function scanBlockReason(observerToken, targetToken) {
  const ship = observerToken?.actor;
  const info = shipSensorInfo(ship, observerToken);
  if (!info.has) return "A nave não tem um Módulo com função Sensor.";
  if (!info.ready) return `O sensor está cego (${info.reason || "sem alcance"}).`;
  if (!targetToken?.actor || !isShipLike(targetToken.actor)) return "O alvo não é uma nave ou veículo.";
  const sig = shipSignatureInfo(targetToken.actor).total;
  const always = Boolean(targetToken.actor.system?.alwaysDetected);
  if (!always && !detects({ distance: tokenDistance(observerToken, targetToken), range: info.range, signature: sig })) return "O alvo não está detectado pelo sensor.";
  return "";
}

/** Escaneia pelo sensor da nave: valida, lê e mostra a janela. */
export async function scanWithSensor(observerToken, targetToken) {
  const reason = scanBlockReason(observerToken, targetToken);
  if (reason) return ui.notifications.warn(reason);
  const info = shipSensorInfo(observerToken.actor, observerToken);
  const reading = scanShipReading(targetToken.actor, { resolution: info.resolution, passive: info.mode === "passive" });
  await showScanReading(reading, {
    observerName: observerToken.name || observerToken.actor.name,
    targetName: game.user.isGM ? targetToken.name : targetToken.name || "Contato",
    via: info.modules.map(m => m.name).join(", ")
  });
}

/** A Resolução de uma Skill de Análise contra uma nave (nível da Skill + Percepção em passos). */
export function analysisShipResolution(sourceActor, mech) {
  const perception = Number(sourceActor?.system?.attributes?.combat?.perception?.total) || 0;
  return analysisResolution({ level: Number(mech?.level) || 0, perception, step: getAnalysisAttrStep() });
}

/* ------------------------------------------------------------------ Contexto da aba Sensores */

/** Tudo o que a aba Sensores da ficha da nave mostra. */
export function sensorsTabContext(ship) {
  const isGM = game.user.isGM;
  const tokenDoc = ship.isToken ? ship.token : canvas?.scene?.tokens?.find(t => t.actorId === ship.id && (t.actorLink || t.actor?.uuid === ship.uuid)) ?? null;
  const info = shipSensorInfo(ship, tokenDoc);
  const sig = shipSignatureInfo(ship);
  const energy = getStarshipEnergyAbbr();
  const sensorModules = modulesWithFunction(ship, "sensor");
  const mode = info.mode;
  const picture = tokenDoc ? readPicture(tokenDoc.parent) : null;
  const mine = tokenDoc ? picture?.observers?.[tokenDoc.id] : null;
  const rows = [];
  if (tokenDoc?.parent) {
    for (const target of shipTokens(tokenDoc.parent)) {
      if (target.id === tokenDoc.id) continue;
      const dist = Math.round(tokenDistance(tokenDoc, target));
      const targetSig = shipSignatureInfo(target.actor).total;
      const seen = Boolean(mine?.seen?.[target.id]);
      const lastEntry = mine?.last?.[target.id];
      if (!isGM && !seen && !lastEntry) continue;
      const status = contactStatus({ seen, lastAge: lastEntry ? Number(lastEntry.age) || 0 : null });
      const interdicted = target.actor.system?.modules?.some(m => Number(m.system.interdictRange) > 0 && m.system.status === "online");
      rows.push({
        tokenUuid: target.uuid,
        name: target.name || target.actor.name,
        distance: dist,
        signature: isGM || seen ? `${targetSig}%` : "?",
        limit: isGM || seen ? detectLimit(info.range, targetSig) : "—",
        tag: status.tag,
        tagCls: status.cls,
        seen,
        extra: seen && interdicted ? "interditado: bloqueia teleporte" : lastEntry ? "marcador cinza no mapa" : !seen && isGM ? "não detectada (só o Mestre vê)" : "",
        canScan: seen && info.ready,
        lost: !seen
      });
    }
  }
  return {
    sensorsOn: sensorsOn(),
    hasSensor: info.has,
    ready: info.ready,
    sensorName: sensorModules[0]?.name ?? "",
    sensorExtra: sensorModules.length > 1 ? ` (+${sensorModules.length - 1})` : "",
    stateLine: !info.has ? "sem sensor instalado" : info.ready ? (mode === "passive" ? "operante, modo passivo" : "operante") : `cego: ${info.reason}`,
    mode,
    isActive: mode === "active",
    isPassive: mode === "passive",
    canSwitch: Boolean(ship.isOwner) && info.has,
    rangeBase: info.rangeBase,
    range: info.range,
    rangeNote: !info.has ? "" : mode === "passive" ? `${getSensorTuning().passiveFactor}% do alcance ativo (${info.rangeBase})` : info.interference > 0 ? `alcance cheio ${info.rangeBase}, cortado em ${info.interference}%` : "alcance cheio",
    resolution: info.resolution,
    resolutionNote: mode === "passive" ? `leitura grossa (ativo: ${info.resolutionBase})` : "leitura fina",
    consumption: Math.round(sensorModules.reduce((sum, m) => sum + ship.system.moduleDemand(m), 0)),
    energyAbbr: energy,
    interference: info.interference,
    interferenceNote: info.interference > 0 ? `corta o alcance em ${info.interference}%` : "sem corte de alcance",
    signature: sig.total,
    signatureSegments: sig.segments.map(s => ({ ...s, text: `${s.id === "base" || s.id === "camouflage" ? "" : s.value >= 0 ? "+" : ""}${s.value}%` })),
    camouflage: modulesWithFunction(ship, "camouflage").map(m => ({ id: m.id, name: m.name, target: Number(m.system.camoSignature) || 0, consumption: Number(m.system.powerConsumption) || 0, on: moduleOperating(ship, m), canToggle: ship.isOwner })),
    rows,
    hasRows: rows.length > 0,
    isGM,
    alwaysDetected: Boolean(ship.system.alwaysDetected),
    hasToken: Boolean(tokenDoc)
  };
}

/* ------------------------------------------------------------------ Registro */

/** Chamado uma vez no `init`: a subclasse do Token e os ganchos; tudo confere `sensorsOn()` ao agir. */
export function registerShipSensors() {
  registerTokenObject();

  const onShipChange = () => scheduleRefresh();
  Hooks.on("updateToken", (token, changes) => {
    if (!isShipLike(token.actor)) return;
    if (["x", "y", "width", "height", "hidden"].some(k => k in changes)) scheduleRefresh();
  });
  Hooks.on("createToken", onShipChange);
  Hooks.on("deleteToken", onShipChange);
  Hooks.on("updateActor", (actor, changes) => {
    if (!isShipLike(actor)) return;
    if (changes.flags?.[SYSTEM_ID]?.[SHOT_FLAG]) {
      scheduleRefresh();
      // Fora de combate o disparo some sozinho depois de uns segundos: refaz o retrato quando passar.
      if (isDesignatedGm()) scheduleSignatureRelax();
    } else if (changes.system) scheduleRefresh();
  });
  Hooks.on("updateItem", item => {
    if (item.type === "starship_module") scheduleRefresh();
  });
  Hooks.on("createItem", item => {
    if (item.type === "starship_module") scheduleRefresh();
  });
  Hooks.on("deleteItem", item => {
    if (item.type === "starship_module") scheduleRefresh();
  });
  Hooks.on("updateScene", (scene, changes) => {
    const own = changes.flags?.[SYSTEM_ID];
    if (own && (PICTURE_FLAG in own)) {
      if (scene.id === canvas?.scene?.id) onPictureChanged();
      return;
    }
    if (own && scene.id === canvas?.scene?.id) scheduleRefresh();
  });
  Hooks.on("updateFolder", () => scheduleRefresh());
  Hooks.on("updateCombat", (combat, changed) => {
    if ("round" in changed) {
      scheduleRefresh({ age: true });
      // O disparo vale 1 rodada: tira o peso da Assinatura da rodada que acabou.
      setTimeout(() => refreshScenePicture(), 400);
    }
  });
  Hooks.on("deleteCombat", () => scheduleRefresh());
  Hooks.on("canvasReady", () => {
    drawContactMarkers();
    scheduleRefresh();
  });
  Hooks.on("canvasPan", () => drawContactMarkers());
  Hooks.on("canvasTearDown", () => {
    markerRoot?.remove();
    markerRoot = null;
  });
  // Quem desligou/ligou o bloco: o mapa e os marcadores se refazem.
  Hooks.on("updateSetting", setting => {
    if (setting?.key === `${SYSTEM_ID}.shipSensorsEnabled` || setting?.key === `${SYSTEM_ID}.vesselsEnabled`) {
      onPictureChanged();
      scheduleRefresh();
    }
  });
}

/** Depois de um disparo, a Assinatura volta ao normal quando a janela passa (fora de combate). */
function scheduleSignatureRelax() {
  setTimeout(() => scheduleRefresh(), SHOT_PERSIST_MS + 500);
}
