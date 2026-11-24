/**
 * Saque, pilhas no mapa e depósito de entregas (G2 Lojas, lote B) — a parte que lê e grava documentos.
 * As contas (distância, corpo saqueável, código, entrega a caminho…) são puras em `loot-rules.js`.
 *
 * Três fontes de Itens, uma janela só (`apps/shop-loot.js`):
 *  - corpo: um Personagem NPC com Vida 0 (ou morto), perto de quem pega;
 *  - pilha: um Token NÃO vinculado de um Ator "pilha", criado quando alguém larga um Item no mapa;
 *  - depósito: um Ator "pilha" do mundo com o nome do lugar; cada Item leva a marca de quem pediu.
 *
 * **Quem escreve é só o Mestre designado** (`runAsGm`): ele resolve tudo pelos documentos, confere
 * quem está perto e o que é de quem, e move. O que o cliente manda é "qual fonte, qual item, quantos".
 * Nada aqui exige permissão na ficha: o clique perto de um Token abre a tela própria.
 */
import { SYSTEM_ID, isShopsEnabled, getShopLootRange, getActiveCurrencies, sameActor } from "../core/config.js";
import { isDesignatedGm, ownedDoc, runAsGm, actorsOwnedBy } from "../helpers/gm-relay.js";
import { refuse, RELAY_REASONS, relayFailureMessage } from "../helpers/gm-relay-rules.js";
import { reportError } from "../helpers/report.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";
import { isDead, countsAsNpc } from "../combat/incapacitation.js";
import { removeGrantedSkill } from "../skills/skill-economy.js";
import { sceneField } from "../environment/scene-config.js";
import { dayLengthSeconds } from "../core/world-time.js";
import { walletUpdate, formatMoney, canUseShop } from "./shop-rules.js";
import {
  SHOP_ITEM_TYPES, shopOf, isShopActor, openStorefront, itemSellBlock, giveItem, takeItem, revertOps, copyData, announce, walletOf,
  clampQty, serialized, ask
} from "./shops.js";
import {
  bodyLootable, pileName, mergeTarget, pileTokenPosition, clearPilesSummary, normalizeDelivery, deliveryState, deliveryDue, farText,
  isNear, nearestGap, totalQty
} from "./loot-rules.js";
import { gridOf, rectOf, distanceToToken, distanceToRect } from "./token-geometry.js";
import { registerShopShow } from "./shop-show.js";
import { registerPlayerTrade } from "./player-trade.js";

const PILE_ICON = "icons/svg/item-bag.svg";
const worldSeconds = () => Number(globalThis.game?.time?.worldTime) || 0;
const flagOf = doc => doc?.getFlag?.(SYSTEM_ID, "delivery");

/* ------------------------------------------------------------------ Leitura */

/** O tipo da fonte de um Ator: "body" | "pile" | "deposit" | "". */
export function sourceKind(actor) {
  if (!actor) return "";
  if (actor.type === "pile") return actor.system?.kind === "deposit" ? "deposit" : "pile";
  if (actor.type === "character" && !shopOf(actor).enabled) return "body";
  return "";
}

/** O corpo do Ator pode ser saqueado agora? */
export function bodyIsLootable(actor) {
  return bodyLootable({
    isShop: shopOf(actor).enabled,
    dead: isDead(actor),
    hp: Number(actor.system?.attributes?.hp?.value ?? 1),
    npc: countsAsNpc(actor)
  });
}

/** Resolve a referência `{tokenUuid, actorUuid}` de uma fonte. */
export async function resolveSource(ref) {
  let token = null;
  let actor = null;
  if (ref?.tokenUuid) {
    token = await fromUuid(String(ref.tokenUuid));
    if (!token || token.documentName !== "Token") return null;
    actor = token.actor;
  } else if (ref?.actorUuid) {
    actor = await fromUuid(String(ref.actorUuid));
    if (!actor || actor.documentName !== "Actor") return null;
  }
  const kind = sourceKind(actor);
  return kind ? { actor, token, kind } : null;
}

/** Os Itens de uma fonte que dá para pegar: soltos (o que está dentro de contêiner vai junto com ele). */
export function lootEntries(source) {
  return source.actor.items
    .filter(i => SHOP_ITEM_TYPES.includes(i.type) && (Number(i.system.quantity) || 0) > 0 && !i.system.containerId)
    .map(item => ({ item, id: item.id, name: item.name, qty: Math.floor(Number(item.system.quantity) || 0), delivery: flagOf(item) }));
}

/** Moedas do corpo (`{id: n}`) com o que sobrou maior que zero. */
export function bodyCoins(actor) {
  const out = {};
  for (const [id, n] of Object.entries(walletOf(actor))) if (Number(n) > 0) out[id] = Math.floor(Number(n));
  return out;
}

/* ------------------------------------------------------------------ Pegar (Mestre) */

async function moveStack(source, taker, item, qty, ops) {
  const have = Math.floor(Number(item.system.quantity) || 0);
  const n = Math.min(have, Math.max(1, Math.floor(qty)));
  const holder = source.actor;
  const children = item.system.container?.enabled && n >= have ? holder.items.filter(i => i.system?.containerId === item.id) : [];
  const gain = await giveItem(taker, item, n);
  if (!gain) throw new Error(`${taker.name} não aceita ${item.name}`);
  ops.push(gain);
  for (const child of children) {
    const q = Math.floor(Number(child.system.quantity) || 1);
    const g = await giveItem(taker, child, q, { containerId: gain.itemId });
    if (g) ops.push(g);
    ops.push(await takeItem(holder, child, q));
  }
  if (item.system.equipped && n >= have) await removeGrantedSkill(holder, item.id);
  ops.push(await takeItem(holder, item, n));
  return n;
}

function visibleTo(entry, taker, user, kind) {
  if (kind !== "deposit") return true;
  const d = normalizeDelivery(entry.delivery);
  if (!d) return Boolean(user.isGM);
  return user.isGM || d.ownerUuid === taker?.uuid;
}

async function cleanupPile(source) {
  if (source.kind !== "pile" || !source.token) return;
  if (!lootEntries(source).length) await source.token.delete();
}

async function moveCoins(from, to, coins, taken) {
  const currencies = getActiveCurrencies();
  const gain = walletUpdate(walletOf(to), coins);
  const lose = walletUpdate(walletOf(from), Object.fromEntries(Object.entries(coins).map(([id, n]) => [id, -n])));
  if (!gain.ok || !lose.ok) throw new Error("não deu para mover as moedas");
  await from.update(lose.update);
  await to.update(gain.update);
  const units = Object.entries(coins).reduce((sum, [id, n]) => sum + n * (Number(currencies.find(c => c.id === id)?.baseValue) || 1), 0);
  taken.push({ name: `moedas (${formatMoney(units, currencies)})`, qty: 1, coins: true, who: to });
}

async function lootTakeAsGm(payload, user) {
  if (!isShopsEnabled()) return refuse("as lojas estão desligadas");
  const source = await resolveSource(payload?.source);
  if (!source) return refuse("isto não existe mais");
  const gm = Boolean(user?.isGM);
  const { kind } = source;

  let taker = null;
  if (!(kind === "deposit" && gm)) {
    taker = await ownedDoc(payload?.takerUuid, user);
    if (!taker) return refuse(RELAY_REASONS.permission);
    if (taker.type !== "character" || shopOf(taker).enabled || sameActor(taker, source.actor)) return refuse(RELAY_REASONS.invalid);
  }
  if (kind === "body") {
    if (!bodyIsLootable(source.actor)) return refuse("esse corpo não está caído");
    if (!gm && source.actor.testUserPermission(user, "OWNER")) return refuse("é um personagem seu: use a ficha");
  }
  if (!gm) {
    if (!source.token) return refuse("sem Token no mapa: peça ao Mestre");
    const range = getShopLootRange();
    const d = distanceToToken(taker, source.token);
    if (!isNear(d, range)) return refuse(farText(d, range, gridOf(source.token.parent).units));
  }

  const op = String(payload?.op ?? "");
  const now = worldSeconds();
  const ops = [];
  const taken = [];
  const takeEntry = async (entry, qty) => {
    let who = taker;
    if (kind === "deposit") {
      const d = normalizeDelivery(entry.delivery);
      if (deliveryState(d, now) !== "arrived") throw new Error(`${entry.name} ainda está a caminho`);
      if (!who) who = await fromUuid(d?.ownerUuid ?? "");
      if (!who) throw new Error(`o dono de ${entry.name} não existe mais`);
    }
    const n = await moveStack(source, who, entry.item, qty, ops);
    taken.push({ name: entry.name, qty: n, who });
  };

  try {
    if (op === "item") {
      const entry = lootEntries(source).find(e => e.id === String(payload?.itemId ?? ""));
      if (!entry || !visibleTo(entry, taker, user, kind)) return refuse("esse item já foi pego");
      await takeEntry(entry, clampQty(payload?.qty ?? entry.qty));
    } else if (op === "all") {
      for (const entry of lootEntries(source)) {
        if (!visibleTo(entry, taker, user, kind)) continue;
        if (kind === "deposit" && deliveryState(entry.delivery, now) !== "arrived") continue;
        await takeEntry(entry, entry.qty);
      }
      if (kind === "body" && taker) {
        const coins = bodyCoins(source.actor);
        if (Object.keys(coins).length) await moveCoins(source.actor, taker, coins, taken);
      }
    } else if (op === "coins") {
      if (kind !== "body") return refuse(RELAY_REASONS.invalid);
      const coins = bodyCoins(source.actor);
      if (!Object.keys(coins).length) return refuse("não há moedas aqui");
      await moveCoins(source.actor, taker, coins, taken);
    } else return refuse(RELAY_REASONS.invalid);
  } catch (err) {
    await revertOps(ops);
    return refuse(err?.message || "não deu para pegar");
  }
  if (!taken.length) return refuse("não havia nada para pegar");

  await cleanupPile(source);
  const who = taken[0].who ?? taker;
  const list = taken.map(t => (t.coins ? t.name : `${t.qty}× ${t.name}`)).join(", ");
  const from = kind === "body" ? `do corpo de ${source.actor.name}` : kind === "pile" ? `de ${source.token?.name ?? "uma pilha"}` : `do ${source.actor.name}`;
  await announce(who, kind === "deposit" ? "Entrega retirada" : "Saque", `${who.name} pegou ${list} ${from}.`);
  return { ok: true, value: { text: list } };
}

/* ------------------------------------------------------------------ Largar no mapa (pilhas) */

async function pileTemplate() {
  let template = game.actors.find(a => a.type === "pile" && a.getFlag(SYSTEM_ID, "pileTemplate"));
  if (template) return template;
  template = await Actor.implementation.create({
    name: "Pilha (modelo do sistema)",
    type: "pile",
    img: PILE_ICON,
    system: { kind: "pile" },
    flags: { [SYSTEM_ID]: { pileTemplate: true } },
    prototypeToken: { name: "Pilha", actorLink: false, texture: { src: PILE_ICON }, displayName: CONST.TOKEN_DISPLAY_MODES.HOVER, sight: { enabled: false }, disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL }
  });
  return template;
}

const isPileToken = token => Boolean(token?.getFlag?.(SYSTEM_ID, "pile"));

/** As pilhas da cena (Tokens marcados). */
export function pilesOf(scene) {
  return (scene?.tokens ?? []).filter(isPileToken);
}

async function pileDropAsGm(payload, user) {
  if (!isShopsEnabled()) return refuse("as lojas estão desligadas");
  const item = await fromUuid(String(payload?.itemUuid ?? ""));
  if (!item || item.type !== "item") return refuse("esse item não existe mais");
  const giver = item.parent?.documentName === "Actor" ? item.parent : null;
  if (giver) {
    if (!(await ownedDoc(giver.uuid, user))) return refuse(RELAY_REASONS.permission);
    if (giver.type !== "character" || shopOf(giver).enabled) return refuse(RELAY_REASONS.invalid);
    const blocked = itemSellBlock(giver, item);
    if (blocked) return refuse(`${item.name}: ${blocked}`);
  } else if (!user?.isGM) return refuse(RELAY_REASONS.permission);

  const scene = game.scenes.get(String(payload?.sceneId ?? ""));
  const x = Number(payload?.x);
  const y = Number(payload?.y);
  if (!scene || !Number.isFinite(x) || !Number.isFinite(y)) return refuse(RELAY_REASONS.invalid);
  const grid = gridOf(scene);
  if (!user.isGM) {
    const d = distanceToRect(scene, giver, { x, y, w: 0, h: 0 });
    const range = getShopLootRange();
    if (!isNear(d, range)) return refuse(farText(d, range, grid.units));
  }
  const have = Math.floor(Number(item.system.quantity) || 1);
  const qty = Math.min(have, clampQty(payload?.qty ?? have));

  // Já há uma pilha ali? O item entra nela em vez de abrir outro Token.
  const piles = pilesOf(scene).map(t => ({ id: t.id, ...rectOf(t) }));
  const mergeId = mergeTarget(piles, { x, y }, grid.size);
  let token = mergeId ? scene.tokens.get(mergeId) : null;
  let created = false;
  const children = item.system.container?.enabled && qty >= have && giver ? giver.items.filter(i => i.system?.containerId === item.id) : [];
  if (!token) {
    const template = await pileTemplate();
    const pos = pileTokenPosition({ x, y }, grid.size, { square: scene.grid?.type === (CONST.GRID_TYPES?.SQUARE ?? 1) });
    const doc = await template.getTokenDocument({ x: pos.x, y: pos.y });
    const data = doc.toObject();
    data.name = pileName(giver?.name ?? user.name);
    data.actorLink = false;
    data.flags = { ...(data.flags ?? {}), [SYSTEM_ID]: { pile: { at: Date.now(), by: giver?.name ?? user.name } } };
    [token] = await scene.createEmbeddedDocuments("Token", [data]);
    created = true;
  }
  const pile = token?.actor;
  if (!pile) return refuse("não deu para criar a pilha");
  const ops = [];
  try {
    const gain = await giveItem(pile, item, qty);
    if (!gain) throw new Error("a pilha não aceitou o item");
    ops.push(gain);
    for (const child of children) {
      const q = Math.floor(Number(child.system.quantity) || 1);
      const g = await giveItem(pile, child, q, { containerId: gain.itemId });
      if (g) ops.push(g);
      ops.push(await takeItem(giver, child, q));
    }
    if (giver) ops.push(await takeItem(giver, item, qty));
  } catch (err) {
    await revertOps(ops);
    if (created) await token.delete();
    return refuse(err?.message || "não deu para largar");
  }
  return { ok: true };
}

async function pilesClearAsGm(payload, user) {
  if (!user?.isGM) return refuse(RELAY_REASONS.permission);
  const scene = game.scenes.get(String(payload?.sceneId ?? ""));
  if (!scene) return refuse(RELAY_REASONS.invalid);
  const piles = pilesOf(scene);
  if (!piles.length) return { ok: true };
  const summary = clearPilesSummary({ ...pileSummaryFor(scene), sceneName: scene.name });
  await scene.deleteEmbeddedDocuments("Token", piles.map(t => t.id));
  await announceVoiceOfTheWorld(null, { kind: "shop", title: "Pilhas removidas", body: summary.done });
  return { ok: true };
}

/* ------------------------------------------------------------------ Depósito de entregas */

/** O depósito que vale para uma cena (campo "Entregas vão para", herdado da pasta), ou `null`. */
export function depotForScene(scene) {
  const uuid = sceneField(scene, "depotId");
  const doc = uuid ? fromUuidSync(uuid) : null;
  return doc?.type === "pile" && doc.system?.kind === "deposit" ? doc : null;
}

/** Cria o Ator-depósito de um lugar (Mestre). Ator do mundo, vinculado ao Token (a janela filtra por dono). */
export async function createDepot(placeName) {
  if (!game.user.isGM) return null;
  return Actor.implementation.create({
    name: `Depósito: ${placeName}`,
    type: "pile",
    img: "icons/svg/chest.svg",
    system: { kind: "deposit", madeBy: game.user.name },
    prototypeToken: { name: `Depósito: ${placeName}`, actorLink: true, texture: { src: "icons/svg/chest.svg" }, displayName: CONST.TOKEN_DISPLAY_MODES.HOVER, sight: { enabled: false }, disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL }
  });
}

/** Todos os depósitos do mundo (para o seletor da janela Ambiente). */
export function listDepots() {
  return game.actors.filter(a => a.type === "pile" && a.system?.kind === "deposit");
}

async function announceArrival(deposit, item, owner) {
  await announce(owner, "Entrega", `Seu ${item.name} chegou ao ${deposit.name}.`);
}

/**
 * Compra feita para o porão de uma nave: ao chegar, o item passa do depósito para a nave (que passa
 * pelos portões de instalação de sempre). Se a nave recusar ou sumiu, fica no depósito, "chegou".
 * @returns {Promise<boolean>} true se foi para a nave
 */
async function forwardToShip(deposit, item, delivery, owner) {
  const ship = delivery.shipUuid ? await fromUuid(delivery.shipUuid) : null;
  if (ship && ["starship", "vehicle"].includes(ship.type)) {
    try {
      const gain = await giveItem(ship, item, Number(item.system.quantity) || 1);
      if (gain) {
        await item.delete();
        await announce(owner, "Entrega", `Seu ${item.name} chegou ao porão da ${ship.name}.`);
        return true;
      }
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Entrega: ${ship.name} não aceitou ${item.name}.`, err);
    }
  }
  await item.update({ [`flags.${SYSTEM_ID}.delivery.shipUuid`]: "" });
  await announceArrival(deposit, item, owner);
  return false;
}

/**
 * Põe `qty` de um Item no depósito, marcado com o dono do pedido (Mestre; é o que o app Compras do
 * lote C vai chamar). `arriveAt` (relógio do mundo, segundos) vazio ou já passado = "chegou" e o dono é
 * avisado; no futuro = "a caminho" até `settleDeliveries` virar quando o relógio passar.
 * @returns {Promise<Item|null>}
 */
export async function deliverToDeposit(deposit, source, qty, { owner, from = "", arriveAt = null, shipUuid = "" } = {}) {
  if (!game.user.isGM || !deposit || !owner) return null;
  const now = worldSeconds();
  const transit = arriveAt !== null && Number(arriveAt) > now;
  const data = copyData(source, Math.max(1, Math.floor(qty)));
  data.flags = {
    ...(data.flags ?? {}),
    [SYSTEM_ID]: {
      ...(data.flags?.[SYSTEM_ID] ?? {}),
      delivery: { ownerUuid: owner.uuid, ownerName: owner.name, from, status: transit ? "transit" : "arrived", arriveAt: transit ? Number(arriveAt) : null, orderedAt: now, shipUuid: shipUuid || "" }
    }
  };
  const [made] = await deposit.createEmbeddedDocuments("Item", [data]);
  if (made && !transit) {
    if (shipUuid) await forwardToShip(deposit, made, { shipUuid }, owner);
    else await announceArrival(deposit, made, owner);
  }
  return made ?? null;
}

/** Vira "a caminho" em "chegou" o que passou do prazo, e avisa o dono (Mestre designado). */
export async function settleDeliveries() {
  if (!isShopsEnabled() || !isDesignatedGm()) return;
  const now = worldSeconds();
  for (const deposit of listDepots()) {
    for (const item of deposit.items) {
      const d = flagOf(item);
      if (!deliveryDue(d, now)) continue;
      try {
        await item.update({ [`flags.${SYSTEM_ID}.delivery.status`]: "arrived" });
        const owner = await fromUuid(d.ownerUuid);
        if (owner && d.shipUuid) await forwardToShip(deposit, item, d, owner);
        else if (owner) await announceArrival(deposit, item, owner);
      } catch (err) {
        reportError(`Falha ao entregar ${item.name}.`, err, { gmOnly: true });
      }
    }
  }
}

/** Quanto falta (segundos) para a entrega chegar. */
export const remainingSeconds = delivery => Math.max(0, (normalizeDelivery(delivery)?.arriveAt ?? 0) - worldSeconds());

/** Duração do dia do mundo (para "chega em 1 dia · 3h"). */
export function worldDayLength() {
  try {
    return dayLengthSeconds() || 86400;
  } catch (err) {
    return 86400;
  }
}

/* ------------------------------------------------------------------ Relay */

export const RELAY_HANDLERS = {
  lootTake: (payload, user) => serialized(() => lootTakeAsGm(payload, user)),
  pileDrop: (payload, user) => serialized(() => pileDropAsGm(payload, user)),
  pilesClear: (payload, user) => serialized(() => pilesClearAsGm(payload, user))
};

/* ------------------------------------------------------------------ Pedidos do cliente */

/** Pegar da fonte: `op` "item" | "all" | "coins". `source`: `{tokenUuid, actorUuid}`. */
export function askLoot({ source, taker, op, itemId = "", qty = 0 }) {
  return ask("lootTake", { source, takerUuid: taker?.uuid ?? "", op, itemId, qty }, "pegar");
}

/** Quem pode pegar: os personagens do jogador (ou os controlados e de jogador, para o Mestre). */
export function lootTakers() {
  const notShop = a => a?.type === "character" && !shopOf(a).enabled;
  if (game.user.isGM) {
    const controlled = (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(notShop);
    return [...new Set([...controlled, ...game.actors.filter(a => notShop(a) && a.system.isPlayerCharacter)])];
  }
  const own = actorsOwnedBy(game.user).filter(notShop);
  const main = game.user.character;
  return main && own.includes(main) ? [main, ...own.filter(a => a !== main)] : own;
}

/** Abre a janela de saque de uma fonte (referência `{tokenUuid, actorUuid}`). */
export async function openLoot(ref, options = {}) {
  const { ShopLootApp } = await import("../apps/shop-loot.js");
  return ShopLootApp.open(ref, options);
}

/** Abre a janela a partir de um Ator (a "ficha" da pilha/depósito). */
export async function openLootForActor(actor) {
  return openLoot({ tokenUuid: actor?.token?.uuid ?? "", actorUuid: actor?.uuid ?? "" });
}

/* ------------------------------------------------------------------ Largar um Item da ficha no mapa */

async function askQuantity(name, max) {
  const value = await foundry.applications.api.DialogV2.wait({
    window: { title: `Largar — ${name}` },
    content: `<div class="nihility-split-stack"><p>Quantos largar? (1 a ${max})</p><input type="number" name="amount" min="1" max="${max}" value="${max}"/></div>`,
    buttons: [
      { action: "ok", label: "Largar", default: true, callback: (event, button, dialog) => Number(dialog.element.querySelector('[name="amount"]').value) || 0 },
      { action: "cancel", label: "Cancelar", callback: () => 0 }
    ],
    rejectClose: false
  });
  return Math.min(max, Math.max(0, Math.floor(Number(value) || 0)));
}

async function dropOnMap(item, point) {
  const have = Math.max(1, Math.floor(Number(item.system.quantity) || 1));
  const qty = have > 1 ? await askQuantity(item.name, have) : 1;
  if (!qty || !canvas?.scene) return;
  const outcome = await runAsGm("pileDrop", { itemUuid: item.uuid, qty, sceneId: canvas.scene.id, x: point.x, y: point.y }, { reply: true, timeout: 8000 });
  const message = relayFailureMessage(outcome, "largar o item");
  if (message) ui.notifications.warn(message);
  else ui.notifications.info(`Largou ${qty}× ${item.name} no chão.`);
}

/* ------------------------------------------------------------------ Clique no mapa */

/** O que um Token oferece ao clique: "shop" | "machine" | "body" | "pile" | "deposit" | "". */
function clickKind(token) {
  const doc = token.document;
  if (isPileToken(doc)) return "pile";
  const actor = doc.actor;
  if (!actor) return "";
  if (actor.type === "pile") return actor.system.kind === "deposit" ? "deposit" : "pile";
  if (actor.type !== "character") return "";
  if (isShopActor(actor)) return shopOf(actor).kind === "auto" && shopOf(actor).style === "machine" ? "machine" : "shop";
  if (!actor.isOwner && bodyIsLootable(actor)) return "body";
  return "";
}

function myTokenRects() {
  return (canvas.tokens?.placeables ?? []).filter(t => t.document.isOwner && t.actor?.type === "character" && !shopOf(t.actor).enabled).map(t => rectOf(t.document));
}

async function handleTokenClick(token) {
  const kind = clickKind(token);
  if (!kind) return false;
  const doc = token.document;
  const grid = gridOf(doc.parent);
  const range = getShopLootRange();
  if (kind === "shop") {
    if (!canUseShop(doc.actor.system.shop, game.user.id)) return false;
    openStorefront(doc.actor, { tokenUuid: doc.uuid });
    return true;
  }
  const d = nearestGap(myTokenRects(), rectOf(doc), grid.size, grid.distance);
  if (!isNear(d, range)) {
    ui.notifications.info(farText(d, range, grid.units));
    return true;
  }
  if (kind === "machine") openStorefront(doc.actor, { tokenUuid: doc.uuid });
  else openLoot({ tokenUuid: doc.uuid, actorUuid: doc.actor?.uuid ?? "" });
  return true;
}

let canvasListener = null;

function installCanvasClick() {
  const view = canvas?.app?.canvas ?? canvas?.app?.view;
  if (!view) return;
  if (canvasListener) {
    canvasListener.view.removeEventListener("pointerdown", canvasListener.onDown, true);
    canvasListener.view.removeEventListener("click", canvasListener.onClick, true);
  }
  let down = null;
  const onDown = event => {
    down = { x: event.clientX, y: event.clientY };
  };
  const onClick = event => {
    if (event.button !== 0 || game.user.isGM || !isShopsEnabled() || !canvas.ready) return;
    if (canvas.activeLayer !== canvas.tokens) return;
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
    const p = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
    const token = (canvas.tokens.placeables ?? []).filter(t => t.visible && t.bounds.contains(p.x, p.y)).find(t => clickKind(t));
    if (token) handleTokenClick(token).catch(err => reportError("Não abriu o que está no mapa.", err));
  };
  view.addEventListener("pointerdown", onDown, true);
  view.addEventListener("click", onClick, true);
  canvasListener = { view, onClick, onDown };
}

/* ------------------------------------------------------------------ Mestre: pilhas da cena */

/** Resumo para a confirmação de "Limpar pilhas da cena". */
export function pileSummaryFor(scene) {
  const piles = pilesOf(scene);
  const itemCount = piles.reduce((sum, t) => sum + totalQty(t.actor ? lootEntries({ actor: t.actor }) : []), 0);
  return { pileCount: piles.length, itemCount, sceneName: scene?.name ?? "" };
}

/** Pede a limpeza ao Mestre designado (com a confirmação já feita pela janela). */
export function askClearPiles(scene) {
  return ask("pilesClear", { sceneId: scene.id }, "limpar as pilhas");
}

/* ------------------------------------------------------------------ Validar Mundo */

/** O que o Validar Mundo lê: pilhas de todas as cenas, depósitos e uma função que diz se um depósito existe. */
export function collectLootValidation() {
  const exists = uuid => {
    const doc = uuid ? fromUuidSync(uuid) : null;
    return Boolean(doc && doc.type === "pile" && doc.system?.kind === "deposit");
  };
  const piles = [];
  for (const scene of game.scenes) {
    for (const token of pilesOf(scene)) {
      const at = Number(token.getFlag(SYSTEM_ID, "pile")?.at) || Date.now();
      piles.push({ where: `Pilha "${token.name}" · cena ${scene.name}`, items: token.actor ? lootEntries({ actor: token.actor }).length : 0, ageDays: (Date.now() - at) / 86400000 });
    }
  }
  const deposits = listDepots().map(d => ({ name: d.name, strandedItems: d.items.filter(i => SHOP_ITEM_TYPES.includes(i.type) && !normalizeDelivery(flagOf(i))).length }));
  return { piles, deposits, exists };
}

/* ------------------------------------------------------------------ Registro */

/** Ganchos do lote B: largar no mapa, clique no mapa, entregas pelo relógio, Mostrar aos jogadores, troca. Chamado no `init`. */
export function registerLoot() {
  registerShopShow();
  registerPlayerTrade();
  Hooks.on("dropCanvasData", (cv, data) => {
    if (data?.type !== "Item" || !isShopsEnabled()) return;
    const item = data.uuid ? fromUuidSync(data.uuid) : null;
    if (!item || item.type !== "item") return;
    const parent = item.parent;
    const allowed = game.user.isGM || (parent?.documentName === "Actor" && parent.isOwner && parent.type === "character");
    if (!allowed) return;
    dropOnMap(item, { x: data.x, y: data.y }).catch(err => reportError("Não deu para largar o item.", err));
    return false;
  });
  Hooks.on("canvasReady", installCanvasClick);
  Hooks.on("updateWorldTime", () => {
    settleDeliveries();
  });
  Hooks.once("ready", () => {
    settleDeliveries();
    if (canvas?.ready) installCanvasClick();
  });
}
