/**
 * Abordagem de naves (F2) — o lado Foundry. As contas puras estão em `boarding-rules.js` (testado em
 * `test/boarding.test.mjs`). Bloco `FEATURES.boarding` (filho de Naves e Veículos); desligado, nada age e nada salvo se
 * perde (acoplagem, grupo, Regiões ficam como estão).
 *
 *  - **Acoplar** (`dockCheck`, relay `shipDock`): duas naves com os Tokens colados, só com Raio Trator segurando, Escudo do
 *    alvo em 0 ou o Mestre liberando (Veículo: só o Mestre; o jogador pode pedir por um card). Gravado nos dois lados
 *    (`system.dock`) até "Desacoplar".
 *  - **Mover acoplada** (`updateToken`, só o Mestre designado): teste resistido de propulsão (d20 + 1 por 20 de aceleração);
 *    diferença ≤ 4 arrasta a outra; maior arranca pedaço de quem perdeu (Casco + Módulo do ponto de acoplamento) e desacopla.
 *  - **Grupo de abordagem** (`system.boarders` da nave abordada; relay `boardingGroup`): quem passou para lá. **Sabotar** =
 *    dano direto no Módulo (o Mestre rola a arma da ficha do abordador; sem Escudo, Casco nem escala); **Desligar** e
 *    **Hackear** viram um card para o Mestre aprovar (relay `boardingAction`). Tomar a nave não existe.
 *  - **Região "A bordo"** (`nihilityAboard`): Nave + sala (Módulo, opcional) + ações permitidas, desenhada em qualquer mapa;
 *    quem entra entra no grupo daquela nave sozinho e sai ao deixar a Região.
 *  - **Teleporte**: Módulo Teletransportador (relay `boardingTeleport`) e a Skill Saltar sobre o Token de uma nave
 *    (`boardingJumpCheck`/`boardingJumpArrived`, chamados por combat/space.js); precisam ver o alvo no sensor; Interdição e
 *    Âncora bloqueiam; PEM derruba o Módulo e a Antimagia corta a Skill mágica (como sempre).
 */
import {
  SYSTEM_ID, isVesselsEnabled, isBoardingEnabled, getBoardingDragMargin, damageScalingMultiplier
} from "../core/config.js";
import { isDesignatedGm, mayActFor, owns, runAsGm } from "../helpers/gm-relay.js";
import { refuse, RELAY_REASONS, relayFailureMessage } from "../helpers/gm-relay-rules.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { rectGapDistance } from "../economy/loot-rules.js";
import { rectOf, gridOf } from "../economy/token-geometry.js";
import { isShipLike } from "./ship-damage.js";
import { applyShipSystemEffect, damageCasco } from "./starship-power.js";
import { shipInterdiction } from "./interdiction.js";
import { readPicture, shipSensorInfo, tokenDistance, tokenCenterPx, modulesWithFunction, moduleOperating, sensorsOn } from "./sensors.js";
import { conditionAnchorSources, placeAnchorSources } from "../combat/space.js";
import { moveTokenForced } from "../combat/forced-movement.js";
import { unarmedWeaponItem } from "../combat/weapon-mastery.js";
import {
  tokensTouching, dockVerdict, dockViaLabel, propulsionBonus, dragOutcome, dragDamage, addBoarder, removeBoarder, moveBoarder,
  actionAllowed, sabotageDamage, requestCardText, teleportVerdict, DISABLE_ROUNDS, HACK_ROUNDS, BOARDING_ACTIONS
} from "./boarding-rules.js";

export const ABOARD_BEHAVIOR = "nihilityAboard";
export const REQUEST_FLAG = "boardingRequest";

/** O bloco vale agora? */
export function boardingOn() {
  try {
    return isVesselsEnabled() && isBoardingEnabled();
  } catch (err) {
    return false;
  }
}

const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);

/* ------------------------------------------------------------------ Cena e Tokens das duas naves */

/** O Token de uma nave numa cena (por uuid do Ator; Token não vinculado tem o próprio Ator sintético). */
function tokenOfShip(scene, ship) {
  return scene?.tokens?.find(t => t.actor?.uuid === ship.uuid) ?? null;
}

/** A cena onde as duas naves têm Token (a aberta primeiro). */
export function sharedScene(shipA, shipB) {
  const scenes = [canvas?.scene, ...game.scenes].filter(Boolean);
  for (const scene of scenes) {
    const a = tokenOfShip(scene, shipA);
    const b = tokenOfShip(scene, shipB);
    if (a && b) return { scene, a, b };
  }
  return null;
}

/** O Módulo do ponto de acoplamento: o primeiro com a função "dock" que está inteiro. */
function dockModule(ship) {
  return modulesWithFunction(ship, "dock").find(m => (m.system.hp?.value ?? 0) > 0) ?? modulesWithFunction(ship, "dock")[0] ?? null;
}

/* ------------------------------------------------------------------ Acoplar */

/**
 * Pode acoplar `ship` a `target`? Só documentos (serve ao cliente, para a ficha, e ao Mestre, que confere de novo).
 * @returns {{verdict:object, shared:object|null}}
 */
export function dockCheck(user, ship, target) {
  const shared = sharedScene(ship, target);
  const gap = shared ? rectGapDistance(rectOf(shared.a), rectOf(shared.b), gridOf(shared.scene).size, 1) : Infinity;
  const tractor = ship.system
    .modulesByRole("tractor")
    .some(m => m.system.status === "online" && m.getFlag(SYSTEM_ID, "tractorTarget") === target.uuid);
  const verdict = dockVerdict({
    sameScene: Boolean(shared),
    touching: tokensTouching(gap),
    selfDocked: ship.system.dock?.withUuid ? ship.system.dock.withName || "outra nave" : "",
    targetDocked: target.system.dock?.withUuid ? target.system.dock.withName || "outra nave" : "",
    anyVehicle: ship.type === "vehicle" || target.type === "vehicle",
    tractor,
    targetShield: Number(target.system.shields?.value) || 0,
    isGm: Boolean(user?.isGM)
  });
  return { verdict, shared };
}

/** Grava a acoplagem nos dois lados (só o Mestre). */
export async function dockShips(ship, target, via) {
  const mine = dockModule(ship);
  const theirs = dockModule(target);
  const since = Number(game.time?.worldTime) || 0;
  await ship.update({ "system.dock": { withUuid: target.uuid, withName: target.name, ownModuleId: mine?.id ?? "", otherModuleId: theirs?.id ?? "", via, since } });
  await target.update({ "system.dock": { withUuid: ship.uuid, withName: ship.name, ownModuleId: theirs?.id ?? "", otherModuleId: mine?.id ?? "", via, since } });
  rememberPositions();
}

/** Limpa a acoplagem nos dois lados (o que o outro lado guarda também). */
export async function undockShip(ship) {
  const otherUuid = ship.system.dock?.withUuid;
  const clear = { "system.dock": { withUuid: "", withName: "", ownModuleId: "", otherModuleId: "", via: "", since: 0 } };
  await ship.update(clear);
  const other = otherUuid ? await fromUuid(otherUuid).catch(() => null) : null;
  if (other?.system?.dock?.withUuid === ship.uuid) await other.update(clear);
}

/** O texto que a aba Acoplagem mostra do par. */
export function dockInfo(ship) {
  const dock = ship.system.dock;
  if (!dock?.withUuid) return null;
  const mine = ship.items.get(dock.ownModuleId);
  const theirs = fromUuidSync(dock.withUuid)?.items?.get(dock.otherModuleId);
  return {
    withName: dock.withName || fromUuidSync(dock.withUuid)?.name || "outra nave",
    via: dock.via,
    viaLabel: dockViaLabel(dock.via),
    ownModule: mine?.name ?? "",
    otherModule: theirs?.name ?? ""
  };
}

/* ------------------------------------------------------------------ Mover acoplada: teste resistido */

const lastPos = new Map(); // uuid do Token → {x, y}
const dragging = new Set(); // uuids de Tokens que o próprio sistema está arrastando

/** Guarda onde cada Token de nave acoplada está (para saber o quanto andou no próximo movimento). */
function rememberPositions() {
  for (const token of canvas?.scene?.tokens ?? []) {
    if (token.actor && isShipLike(token.actor) && token.actor.system.dock?.withUuid) lastPos.set(token.uuid, { x: token.x, y: token.y });
  }
}

async function rollPropulsion(ship) {
  const roll = new Roll("1d20");
  await roll.evaluate();
  const acceleration = ship.system.sumRoleStat?.("propulsion", "acceleration") ?? 0;
  return { roll, total: roll.total + propulsionBonus(acceleration), bonus: propulsionBonus(acceleration) };
}

async function onDockedShipMoved(tokenDoc, changes, options) {
  if (!boardingOn() || !isDesignatedGm()) return;
  if (!("x" in changes || "y" in changes)) return;
  const ship = tokenDoc.actor;
  if (!ship || !isShipLike(ship) || !ship.system.dock?.withUuid) return;
  const previous = lastPos.get(tokenDoc.uuid);
  lastPos.set(tokenDoc.uuid, { x: tokenDoc.x, y: tokenDoc.y });
  if (!previous || dragging.has(tokenDoc.uuid) || options?.nihilityForced || options?.nihilityDockDrag) return;
  const dx = tokenDoc.x - previous.x;
  const dy = tokenDoc.y - previous.y;
  if (!dx && !dy) return;
  const partner = await fromUuid(ship.system.dock.withUuid).catch(() => null);
  const partnerToken = partner ? tokenOfShip(tokenDoc.parent, partner) : null;
  if (!partner || !partnerToken) return;

  const mover = await rollPropulsion(ship);
  const resister = await rollPropulsion(partner);
  const outcome = dragOutcome({ mover: mover.total, resister: resister.total, margin: getBoardingDragMargin() });
  const head = `<strong>${escapeHtml(ship.name)}</strong> (move) ${mover.total} × ${resister.total} <strong>${escapeHtml(partner.name)}</strong> (resiste)`;
  const note = text => ChatMessage.create({ content: `<div class="nihility-boarding-test"><p>${head}</p><p>${text}</p></div>`, speaker: ChatMessage.getSpeaker({ actor: ship }) });

  if (outcome.kind === "drag") {
    dragging.add(partnerToken.uuid);
    try {
      await moveTokenForced(partnerToken, { x: partnerToken.x + dx, y: partnerToken.y + dy }, { teleport: true });
      lastPos.set(partnerToken.uuid, { x: partnerToken.x, y: partnerToken.y });
    } finally {
      dragging.delete(partnerToken.uuid);
    }
    await note(`Diferença ${Math.abs(outcome.diff)}: pequena. ${escapeHtml(partner.name)} foi arrastada junto e continua acoplada. Sem dano.`);
    return;
  }
  // Arranca pedaço de quem perdeu: Casco e o Módulo do ponto de acoplamento; desacopla.
  const loser = outcome.loser === "mover" ? ship : partner;
  const point = loser.items.get(loser.system.dock?.ownModuleId ?? "") ?? null;
  const damage = dragDamage({
    diff: outcome.diff,
    cascoMax: Number(loser.system.casco?.max) || 0,
    hullMax: Number(loser.system.hull?.max) || 0,
    moduleHpMax: Number(point?.system?.hp?.max) || 0
  });
  const dealt = damage.casco > 0 ? await damageCasco(loser, damage.casco) : 0;
  let moduleLine = "";
  if (point && damage.module > 0) {
    const hp = Math.max(0, (Number(point.system.hp?.value) || 0) - damage.module);
    await point.update({ "system.hp.value": hp, ...(hp <= 0 ? { "system.status": "offline" } : {}) });
    moduleLine = ` · Módulo do ponto de acoplamento (${escapeHtml(point.name)}): −${damage.module} de Vida`;
  }
  await undockShip(ship);
  lastPos.delete(tokenDoc.uuid);
  lastPos.delete(partnerToken.uuid);
  await note(`Diferença ${Math.abs(outcome.diff)}: grande. <strong>${escapeHtml(loser.name)}</strong> perdeu: Casco −${dealt}${moduleLine}. A acoplagem se desfez.`);
}

/* ------------------------------------------------------------------ Grupo de abordagem */

/** Põe um personagem no grupo da nave abordada (só o Mestre). */
export async function joinBoardingGroup(host, actor, { source = "dock", fromUuid: from = "", moduleId = "", tokenUuid = "", regionUuid = "" } = {}) {
  const list = addBoarder(host.system.boarders, { actorUuid: actor.uuid, fromUuid: from, moduleId, source, tokenUuid, regionUuid });
  await host.update({ "system.boarders": list });
}

/** Tira um personagem do grupo da nave (só o Mestre). */
export async function leaveBoardingGroup(host, actorUuid) {
  if (!(host.system.boarders ?? []).some(b => b.actorUuid === actorUuid)) return;
  await host.update({ "system.boarders": removeBoarder(host.system.boarders, actorUuid) });
}

/** As naves em cujo grupo de abordagem este personagem está. */
export function boardingHostsOf(actor) {
  if (!actor) return [];
  return game.actors.filter(a => isShipLike(a) && (a.system.boarders ?? []).some(b => b.actorUuid === actor.uuid));
}

/** Os campos do comportamento "A bordo" onde o abordador está (ou `null`: sem Região). */
export function boarderRegionFields(boarder) {
  if (!boarder?.regionUuid) return null;
  try {
    const region = fromUuidSync(boarder.regionUuid);
    const behavior = [...(region?.behaviors ?? [])].find(b => b.type === ABOARD_BEHAVIOR && !b.disabled);
    return behavior ? { ...behavior.system } : null;
  } catch (err) {
    return null;
  }
}

/* ------------------------------------------------------------------ Ações: Sabotar, e os pedidos Desligar/Hackear */

/** O Módulo existe nesta nave e está inteiro? */
function targetModule(host, moduleId) {
  const module = typeof moduleId === "string" ? host.items.get(moduleId) : null;
  return module?.type === "starship_module" ? module : null;
}

/** A arma do abordador: a equipada com o id pedido, ou o ataque desarmado. */
function boarderWeapon(boarder, weaponId) {
  const item = weaponId ? boarder.items.get(weaponId) : null;
  if (item?.type === "item" && item.system.weapon?.enabled && item.system.equipped && item.system.weapon.mode !== "gravity") return item;
  return unarmedWeaponItem(boarder);
}

/** Lado do Mestre do Sabotar: rola a arma da ficha do abordador e tira da Vida do Módulo, sem Escudo nem Casco nem escala. */
export async function sabotageAsGm({ host, boarder, module, weaponId = "" }) {
  const weapon = boarderWeapon(boarder, weaponId);
  const spec = weapon.system.weapon;
  const formula = Roll.validate(spec.damageFormula ?? "") ? spec.damageFormula : "1d4";
  const roll = new Roll(formula);
  await roll.evaluate();
  const bonuses = boarder.system.weaponBonuses ?? {};
  const damage = sabotageDamage({
    rolled: roll.total,
    scaling: damageScalingMultiplier(boarder, spec.scalingAttribute),
    multiplier: bonuses.damageMultiplier ?? 1,
    flat: bonuses.damageFlat ?? 0
  });
  const before = Number(module.system.hp?.value) || 0;
  const after = Math.max(0, before - damage);
  await module.update({ "system.hp.value": after, ...(after <= 0 ? { "system.status": "offline" } : {}) });
  const flavor = `<strong>${escapeHtml(boarder.name)}</strong> sabota <strong>${escapeHtml(module.name)}</strong> de ${escapeHtml(host.name)} com ${escapeHtml(weapon.name)} — dano direto, sem Escudo, Casco nem escala: −${damage} (Vida ${after}/${Number(module.system.hp?.max) || 0})${after <= 0 ? ", desligado" : ""}`;
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: boarder }), flavor });
  return { damage, after };
}

/** Posta o card do pedido ao Mestre (Desligar, Hackear ou Acoplar), com Aprovar e Recusar. */
export async function postRequestCard({ kind, hostUuid, moduleId = "", actorUuid = "", shipUuid = "" }) {
  const host = await fromUuid(hostUuid).catch(() => null);
  const actor = actorUuid ? await fromUuid(actorUuid).catch(() => null) : null;
  const ship = shipUuid ? await fromUuid(shipUuid).catch(() => null) : null;
  const module = moduleId && host ? host.items.get(moduleId) : null;
  const text = requestCardText({
    kind,
    actorName: actor?.name ?? ship?.name ?? "",
    moduleName: module?.name ?? "",
    shipName: host?.name ?? ""
  });
  const rounds = kind === "hack" ? HACK_ROUNDS : DISABLE_ROUNDS;
  const rows = kind === "dock" ? "" : `<label>Rodadas <input type="number" class="nihility-boarding-rounds" min="1" value="${rounds}"/></label>`;
  await ChatMessage.create({
    content: `<div class="nihility-boarding-card"><p>${escapeHtml(text)}</p>${rows}<div class="nihility-boarding-buttons"><button type="button" data-boarding="approve">Aprovar</button><button type="button" data-boarding="deny">Recusar</button></div><p class="hint">só o Mestre vê estes botões</p></div>`,
    whisper: gmIds(),
    flags: { [SYSTEM_ID]: { [REQUEST_FLAG]: { kind, hostUuid, moduleId, actorUuid, shipUuid, status: "open", rounds } } }
  });
}

/** O Mestre aprovou ou recusou: aplica e fecha o card. */
async function resolveRequest(message, approve, rounds) {
  const req = message.getFlag(SYSTEM_ID, REQUEST_FLAG);
  if (!req || req.status !== "open") return;
  let result = approve ? "" : "Recusado.";
  if (approve) {
    try {
      result = await applyRequest(req, rounds);
    } catch (err) {
      reportError("Abordagem: não consegui aplicar o pedido.", err);
      return;
    }
  }
  const stripped = message.content
    .replace(/<div class="nihility-boarding-buttons">[\s\S]*?<\/div>/, "")
    .replace(/<label>Rodadas[\s\S]*?<\/label>/, "")
    .replace(/<p class="hint">[\s\S]*?<\/p>/, "");
  await message.update({
    content: `${stripped}<p><strong>${approve ? "Aprovado" : "Recusado"}.</strong> ${escapeHtml(result)}</p>`,
    [`flags.${SYSTEM_ID}.${REQUEST_FLAG}.status`]: approve ? "approved" : "denied"
  });
}

/** Aplica um pedido aprovado. Devolve o texto do resultado. */
async function applyRequest(req, rounds) {
  const host = await fromUuid(req.hostUuid).catch(() => null);
  if (!host || !isShipLike(host)) return "a nave não existe mais";
  if (req.kind === "dock") {
    const ship = await fromUuid(req.shipUuid).catch(() => null);
    if (!ship || !isShipLike(ship)) return "a nave que pediu não existe mais";
    // O Mestre libera: só os impedimentos de lugar e de par continuam valendo.
    const gmCheck = dockCheck({ isGM: true }, ship, host).verdict;
    if (!gmCheck.ok) return gmCheck.reason;
    await dockShips(ship, host, "gm");
    return `${ship.name} acoplou a ${host.name}.`;
  }
  const module = targetModule(host, req.moduleId);
  if (!module) return "o Módulo não existe mais";
  if (module.system.status !== "online" || (module.system.hp?.value ?? 0) <= 0) return `${module.name} já está desligado`;
  const n = Math.max(1, Math.round(Number(rounds) || (req.kind === "hack" ? HACK_ROUNDS : DISABLE_ROUNDS)));
  const line = await applyShipSystemEffect(host, { type: "moduleDisable", chance: 100, rounds: n }, { targetModuleId: module.id, label: req.kind === "hack" ? "Hackeado" : "Desligado por abordagem" });
  return line ?? `${module.name} resistiu (Endurecimento)`;
}

/* ------------------------------------------------------------------ Abordar por teleporte */

/**
 * O teleporte (Módulo Teletransportador ou Skill) de `source` até `target` passa? Só documentos.
 * @returns {{ok:boolean, reason:string}}
 */
export function teleportCheck(source, target, { module = null, range = null } = {}) {
  const shared = sharedScene(source, target);
  if (!shared) return { ok: false, reason: "as duas naves precisam estar na mesma cena" };
  const sensor = sensorsOn() ? shipSensorInfo(source, shared.a) : { has: false };
  const seen = Boolean(readPicture(shared.scene)?.observers?.[shared.a.id]?.seen?.[shared.b.id]);
  const interdicted = [source, target].map(s => (shipInterdiction(s, shared.scene) ? s.name : "")).filter(Boolean);
  const anchored = [];
  for (const [ship, token] of [[source, shared.a], [target, shared.b]]) {
    const sources = [...conditionAnchorSources(ship), ...placeAnchorSources(shared.scene, tokenCenterPx(token))];
    if (sources.length) anchored.push(ship.name);
  }
  return teleportVerdict({
    operating: module ? moduleOperating(source, module) : true,
    distance: tokenDistance(shared.a, shared.b),
    range: range ?? (Number(module?.system?.teleportRange) || 0),
    hasSensor: sensor.has,
    seen,
    interdicted,
    anchored
  });
}

/** A Skill Saltar cai sobre o Token de uma nave? Devolve a nave (e o Token) ou `null`. */
export function shipUnderPoint(scene, point, exceptActor = null) {
  const size = Number(scene?.grid?.size) || 100;
  for (const token of scene?.tokens ?? []) {
    const actor = token.actor;
    if (!actor || !isShipLike(actor) || actor.uuid === exceptActor?.uuid) continue;
    const x = token.x;
    const y = token.y;
    const w = (Number(token.width) || 1) * size;
    const h = (Number(token.height) || 1) * size;
    if (point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h) return { ship: actor, token };
  }
  return null;
}

/**
 * Antes de um Saltar que cai sobre uma nave: a nave tem de estar visível no sensor de quem usa e sem Interdição.
 * (Âncora já é conferida pelo caminho normal do Saltar.) Devolve `{blocked, text}`.
 */
export function boardingJumpCheck({ scene, dest, casterActor, jumper }) {
  if (!boardingOn()) return { blocked: false };
  const hit = shipUnderPoint(scene, dest, null);
  if (!hit) return { blocked: false };
  const casterShips = game.actors.filter(a => isShipLike(a) && (a.system.crewActors ?? []).some(c => c.actor?.uuid === (jumper?.uuid ?? casterActor?.uuid)));
  for (const ship of casterShips) {
    const token = tokenOfShip(scene, ship);
    if (!token || ship.uuid === hit.ship.uuid) continue;
    if (sensorsOn() && shipSensorInfo(ship, token).has && !readPicture(scene)?.observers?.[token.id]?.seen?.[hit.token.id]) {
      return { blocked: true, text: `${hit.ship.name} não está detectada pelo sensor de ${ship.name}: abordar por teleporte exige ver o alvo.` };
    }
  }
  const interdicted = shipInterdiction(hit.ship, scene);
  if (interdicted) return { blocked: true, text: interdicted.text };
  return { blocked: false };
}

/** Depois de um Saltar que caiu sobre uma nave: o personagem entra no grupo daquela nave. */
export async function boardingJumpArrived({ scene, destCenter, actor, fromActor = null }) {
  if (!boardingOn() || !isDesignatedGm() || !actor || isShipLike(actor)) return;
  const hit = shipUnderPoint(scene, destCenter, null);
  if (!hit) return;
  await joinBoardingGroup(hit.ship, actor, { source: "teleport", fromUuid: fromActor?.uuid ?? "" });
}

/* ------------------------------------------------------------------ Comportamento de Região "A bordo" */

function shipChoices() {
  const out = { "": "— escolha uma nave —" };
  for (const actor of game.actors ?? []) if (isShipLike(actor)) out[actor.uuid] = actor.name;
  return out;
}

async function handleAboardMove(behavior, tokenDocument, kind) {
  if (!boardingOn() || !isDesignatedGm() || !behavior || behavior.disabled) return;
  const actor = tokenDocument?.actor;
  if (!actor || actor.type !== "character") return;
  const host = behavior.system.shipUuid ? await fromUuid(behavior.system.shipUuid).catch(() => null) : null;
  if (!host || !isShipLike(host)) return;
  if (kind === "enter") {
    const wanted = String(behavior.system.roomName ?? "").trim().toLowerCase();
    const room = wanted ? host.items.find(i => i.type === "starship_module" && i.name.trim().toLowerCase() === wanted) : null;
    await joinBoardingGroup(host, actor, { source: "region", moduleId: room?.id ?? "", tokenUuid: tokenDocument.uuid, regionUuid: behavior.parent?.uuid ?? "" });
    return;
  }
  // Saiu: se ainda está noutra Região "A bordo" da mesma nave, nada a fazer (a outra já mexeu na sala).
  const regions = [...(tokenDocument.regions ?? [])];
  const stillAboard = regions.some(r => r.uuid !== behavior.parent?.uuid && [...(r.behaviors ?? [])].some(b => b.type === ABOARD_BEHAVIOR && !b.disabled && b.system.shipUuid === behavior.system.shipUuid));
  if (stillAboard) return;
  const entry = (host.system.boarders ?? []).find(b => b.actorUuid === actor.uuid);
  if (entry && entry.source === "region") await leaveBoardingGroup(host, actor.uuid);
}

function defineAboardBehavior() {
  const { fields } = foundry.data;
  const Base = foundry.data.regionBehaviors.RegionBehaviorType;
  const E = CONST.REGION_EVENTS;
  const events = {};
  for (const [event, kind] of [[E.TOKEN_ENTER, "enter"], [E.TOKEN_EXIT, "exit"]]) {
    events[event] = async function (eventData) {
      const token = eventData.data?.token;
      if (!token) return;
      try {
        await handleAboardMove(this.behavior ?? this.parent, token, kind);
      } catch (err) {
        reportError("A bordo: falha ao mexer no grupo de abordagem.", err, { gmOnly: true });
      }
    };
  }
  return class AboardRegionBehavior extends Base {
    static defineSchema() {
      return {
        shipUuid: new fields.StringField({
          required: false, blank: true, initial: "", choices: () => shipChoices(),
          label: "Nave",
          hint: "A nave a bordo da qual esta Região fica. Quem entra na Região entra no grupo de abordagem dela, sozinho, e sai dele ao deixar a Região."
        }),
        roomName: new fields.StringField({
          required: false, blank: true, initial: "",
          label: "Sala de Módulo (opcional)",
          hint: "O nome de um Módulo da nave. Com ele, o painel de abordagem age sobre esse Módulo sem perguntar; vazio = corredor."
        }),
        allowSabotage: new fields.BooleanField({ required: false, initial: true, label: "Permitir Sabotar" }),
        allowDisable: new fields.BooleanField({ required: false, initial: true, label: "Permitir Desligar (pede aprovação)" }),
        allowHack: new fields.BooleanField({ required: false, initial: true, label: "Permitir Hackear (pede aprovação)", hint: "Uma sala sem terminal pode proibir Hackear. A segurança interna são as Armadilhas de Região na mesma área." })
      };
    }

    static events = events;
  };
}

/* ------------------------------------------------------------------ Ações do relay */

/** Resolve a nave do payload e confere que o remetente a opera. */
async function operatedShip(uuid, user) {
  if (!(await mayActFor(user, uuid))) return null;
  const ship = await fromUuid(uuid).catch(() => null);
  return ship && isShipLike(ship) ? ship : null;
}

export const RELAY_HANDLERS = {
  /** Acoplar / Desacoplar (ou pedir ao Mestre, quando só ele pode liberar). */
  async shipDock(payload, user) {
    if (!boardingOn()) return refuse("o bloco Abordagem está desligado");
    const ship = await operatedShip(payload?.shipUuid, user);
    if (!ship) return refuse(RELAY_REASONS.permission);
    if (payload.op === "undock") {
      if (!ship.system.dock?.withUuid) return;
      await undockShip(ship);
      return;
    }
    if (payload.op !== "dock") return refuse(RELAY_REASONS.invalid);
    const target = typeof payload.targetUuid === "string" ? await fromUuid(payload.targetUuid).catch(() => null) : null;
    if (!target || !isShipLike(target) || target.uuid === ship.uuid) return refuse(RELAY_REASONS.invalid);
    const { verdict } = dockCheck(user, ship, target);
    if (verdict.ok) {
      await dockShips(ship, target, verdict.via);
      return;
    }
    if (payload.ask && verdict.canAsk) {
      await postRequestCard({ kind: "dock", hostUuid: target.uuid, shipUuid: ship.uuid });
      return refuse("pedido enviado ao Mestre");
    }
    return refuse(verdict.reason);
  },

  /** Grupo de abordagem: entrar, sair e trocar de sala. */
  async boardingGroup(payload, user) {
    if (!boardingOn()) return refuse("o bloco Abordagem está desligado");
    const host = typeof payload?.shipUuid === "string" ? await fromUuid(payload.shipUuid).catch(() => null) : null;
    const actor = typeof payload?.actorUuid === "string" ? await fromUuid(payload.actorUuid).catch(() => null) : null;
    if (!host || !isShipLike(host) || !actor || actor.type !== "character") return refuse(RELAY_REASONS.invalid);
    if (!owns(user, actor)) return refuse(RELAY_REASONS.permission);
    if (payload.op === "add") {
      if (!user.isGM) {
        const partnerUuid = host.system.dock?.withUuid;
        const partner = partnerUuid ? await fromUuid(partnerUuid).catch(() => null) : null;
        const crewed = partner && (partner.system.crewMembers ?? []).some(c => c.actorUuid === actor.uuid);
        if (!crewed) return refuse("só a tripulação da nave acoplada passa para cá (o Mestre libera os outros casos)");
      }
      if (boardingHostsOf(actor).some(h => h.uuid !== host.uuid)) return refuse(`${actor.name} já está a bordo de outra nave`);
      await joinBoardingGroup(host, actor, { source: "dock", fromUuid: host.system.dock?.withUuid ?? "" });
      return;
    }
    if (payload.op === "remove") {
      await leaveBoardingGroup(host, actor.uuid);
      return;
    }
    if (payload.op === "room") {
      const moduleId = typeof payload.moduleId === "string" ? payload.moduleId : "";
      if (moduleId && !targetModule(host, moduleId)) return refuse(RELAY_REASONS.invalid);
      await host.update({ "system.boarders": moveBoarder(host.system.boarders, actor.uuid, moduleId) });
      return;
    }
    return refuse(RELAY_REASONS.invalid);
  },

  /** Sabotar (na hora) e os pedidos Desligar e Hackear (card para o Mestre). */
  async boardingAction(payload, user) {
    if (!boardingOn()) return refuse("o bloco Abordagem está desligado");
    const host = typeof payload?.shipUuid === "string" ? await fromUuid(payload.shipUuid).catch(() => null) : null;
    const boarder = typeof payload?.actorUuid === "string" ? await fromUuid(payload.actorUuid).catch(() => null) : null;
    if (!host || !isShipLike(host) || !boarder) return refuse(RELAY_REASONS.invalid);
    if (!owns(user, boarder)) return refuse(RELAY_REASONS.permission);
    const entry = (host.system.boarders ?? []).find(b => b.actorUuid === boarder.uuid);
    if (!entry) return refuse(`${boarder.name} não está no grupo de abordagem desta nave`);
    const action = payload.op;
    if (!BOARDING_ACTIONS[action]) return refuse(RELAY_REASONS.invalid);
    const allowed = actionAllowed(action, boarderRegionFields(entry));
    if (!allowed.ok) return refuse(allowed.reason);
    const module = targetModule(host, payload.moduleId);
    if (!module) return refuse("escolha um Módulo");
    if (action === "sabotage") {
      if ((module.system.hp?.value ?? 0) <= 0) return refuse(`${module.name} já está destruído`);
      await sabotageAsGm({ host, boarder, module, weaponId: typeof payload.weaponId === "string" ? payload.weaponId : "" });
      return;
    }
    if (user.isGM) {
      // O Mestre que aperta o botão é quem aprova: aplica na hora.
      const line = await applyRequest({ kind: action, hostUuid: host.uuid, moduleId: module.id }, action === "hack" ? HACK_ROUNDS : DISABLE_ROUNDS);
      await ChatMessage.create({ content: `<p>${escapeHtml(boarder.name)}: ${escapeHtml(BOARDING_ACTIONS[action])} ${escapeHtml(module.name)} — ${escapeHtml(line)}</p>`, speaker: ChatMessage.getSpeaker({ actor: boarder }) });
      return;
    }
    await postRequestCard({ kind: action, hostUuid: host.uuid, moduleId: module.id, actorUuid: boarder.uuid });
  },

  /** Abordar por Módulo Teletransportador: leva os escolhidos para o grupo da nave alvo. */
  async boardingTeleport(payload, user) {
    if (!boardingOn()) return refuse("o bloco Abordagem está desligado");
    const module = typeof payload?.moduleUuid === "string" ? await fromUuid(payload.moduleUuid).catch(() => null) : null;
    const source = module?.parent;
    if (!module || module.type !== "starship_module" || !source || !isShipLike(source)) return refuse(RELAY_REASONS.invalid);
    if (!owns(user, source)) return refuse(RELAY_REASONS.permission);
    if (!(module.system.functions ?? []).includes("teleporter")) return refuse("o Módulo não é um Teletransportador");
    const target = typeof payload.targetShipUuid === "string" ? await fromUuid(payload.targetShipUuid).catch(() => null) : null;
    if (!target || !isShipLike(target) || target.uuid === source.uuid) return refuse(RELAY_REASONS.invalid);
    const verdict = teleportCheck(source, target, { module });
    if (!verdict.ok) return refuse(verdict.reason);
    const uuids = Array.isArray(payload.actorUuids) ? payload.actorUuids.filter(u => typeof u === "string").slice(0, 12) : [];
    let moved = 0;
    for (const uuid of uuids) {
      const actor = await fromUuid(uuid).catch(() => null);
      if (!actor || actor.type !== "character" || !owns(user, actor)) continue;
      if (!(source.system.crewMembers ?? []).some(c => c.actorUuid === actor.uuid)) continue;
      await joinBoardingGroup(target, actor, { source: "teleport", fromUuid: source.uuid });
      moved += 1;
    }
    if (!moved) return refuse("ninguém da tripulação foi escolhido");
    await ChatMessage.create({ content: `<p>${escapeHtml(source.name)} teletransporta ${moved} ${moved === 1 ? "pessoa" : "pessoas"} para ${escapeHtml(target.name)} (${escapeHtml(module.name)}).</p>`, speaker: ChatMessage.getSpeaker({ actor: source }) });
  }
};

/* ------------------------------------------------------------------ Cliente: pedir pelo relay */

/** Faz um pedido ao Mestre e mostra o motivo se recusou. */
export async function askBoarding(action, payload, { success = "" } = {}) {
  const outcome = await runAsGm(action, payload, { reply: true, timeout: 8000 });
  const message = relayFailureMessage(outcome, "fazer isto");
  if (message) ui.notifications.warn(message);
  else if (success) ui.notifications.info(success);
  return !message;
}

/* ------------------------------------------------------------------ Registro */

/** Chamado uma vez no `init`: o comportamento de Região, a mudança de grupo, os cards do Mestre e o arrasto. */
export function registerBoarding() {
  if (foundry.data?.regionBehaviors?.RegionBehaviorType && CONFIG.RegionBehavior) {
    CONFIG.RegionBehavior.dataModels[ABOARD_BEHAVIOR] = defineAboardBehavior();
    CONFIG.RegionBehavior.typeIcons ??= {};
    CONFIG.RegionBehavior.typeIcons[ABOARD_BEHAVIOR] = "fa-solid fa-door-open";
  }
  Hooks.on("updateToken", (tokenDoc, changes, options) => {
    onDockedShipMoved(tokenDoc, changes, options).catch(err => reportError("Acoplagem: falha no teste de propulsão.", err, { gmOnly: true }));
  });
  Hooks.on("canvasReady", rememberPositions);
  Hooks.once("ready", rememberPositions);

  // Quem do jogador entrou no grupo: avisa e abre a janela.
  const known = new Map();
  const note = actor => {
    if (!isShipLike(actor)) return;
    const now = new Set((actor.system.boarders ?? []).map(b => b.actorUuid));
    const before = known.get(actor.uuid);
    known.set(actor.uuid, now);
    if (!before || game.user.isGM || !boardingOn()) return;
    for (const uuid of now) {
      if (before.has(uuid)) continue;
      const boarder = fromUuidSync(uuid);
      if (boarder?.isOwner) {
        ui.notifications.info(`${boarder.name} está a bordo de ${actor.name}.`);
        import("../apps/boarding-group.js").then(m => m.BoardingGroupApp.open(actor.uuid)).catch(err => console.warn(`${SYSTEM_ID} | Grupo de abordagem não aberto.`, err));
      }
    }
  };
  Hooks.once("ready", () => game.actors.forEach(note));
  Hooks.on("updateActor", (actor, changes) => {
    if (changes.system && "boarders" in changes.system) note(actor);
  });

  // O card do Mestre: Aprovar / Recusar.
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const req = message.getFlag?.(SYSTEM_ID, REQUEST_FLAG);
    if (!req) return;
    const buttons = html.querySelector?.(".nihility-boarding-buttons");
    if (!buttons) return;
    if (!game.user.isGM || req.status !== "open") {
      buttons.remove();
      html.querySelector?.(".nihility-boarding-rounds")?.closest("label")?.remove();
      return;
    }
    buttons.querySelectorAll("button[data-boarding]").forEach(button => {
      button.addEventListener("click", async event => {
        event.preventDefault();
        const rounds = Number(html.querySelector(".nihility-boarding-rounds")?.value) || 0;
        buttons.querySelectorAll("button").forEach(b => (b.disabled = true));
        await resolveRequest(message, button.dataset.boarding === "approve", rounds);
      });
    });
  });
}
