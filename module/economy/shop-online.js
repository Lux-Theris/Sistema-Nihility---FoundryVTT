/**
 * Compras online (G2 Lojas, lote C) — o app "Compras" do PAD: lojas marcadas `online`, carrinho,
 * destino da entrega e pedidos. As contas (rede, prazo, destino, linhas do carrinho, estado do
 * pedido) são puras em `shop-rules.js`; este arquivo lê e grava documentos.
 *
 * Quem executa é só o Mestre designado (`runAsGm`, ação `shopOrder`): ele revalida TUDO a partir dos
 * documentos (rede e energia do aparelho pela cena do Token do comprador, a loja é online, estoque,
 * saldo, destino) e só então cobra e entrega. O cliente só diz "quais itens, quantos, entregar onde".
 * A compra online vale **sem** "Mostrar aos jogadores": quem tem rede compra de qualquer loja online.
 *
 * Entrega: software (`shop.digital`) vai direto para o inventário; item físico vai para o depósito do
 * lugar (`depotForScene`, herdado da pasta) ou, com a nave atracada ali, para o porão dela. Com prazo
 * o item nasce "a caminho" no depósito e o relógio do mundo o entrega (`settleDeliveries`).
 */
import { SYSTEM_ID, getActiveCurrencies, isShopsEnabled, isCalendarEnabled, sameActor } from "../core/config.js";
import { ownedDoc } from "../helpers/gm-relay.js";
import { refuse, RELAY_REASONS } from "../helpers/gm-relay-rules.js";
import { suppressionState } from "../core/suppression.js";
import { actorScene, sceneHasNetwork, actorChambers } from "../core/world-time.js";
import { sceneField } from "../environment/scene-config.js";
import { findCrewedShipsForActor } from "../pad/pad-crew.js";
import {
  normalizeItemShop, shopNetworkState, deliveryHoursFor, arriveAtFor, deliveryLabel, chooseDestination, destinationOptions,
  normalizeOrderLines, groupByShop, pushOrders, orderState, walletUnits, formatMoney, canBuyStock, itemKind
} from "./shop-rules.js";
import { machineColor, etaText } from "./loot-rules.js";
import {
  shopOf, isShopActor, shopStockItems, shopListing, priceText, walletOf, giveItem, completeBuy, serialized, ask, newId,
  SHOP_ITEM_TYPES
} from "./shops.js";
import { depotForScene, deliverToDeposit, worldDayLength } from "./loot.js";

const ORDERS_FLAG = "padOrders";
const worldSeconds = () => Number(globalThis.game?.time?.worldTime) || 0;
const plainText = html => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------------ Rede e lugar */

/** O aparelho deste Ator compra online agora? (cena "tem rede" ou Região com rede; sem PEM). */
export function networkFor(actor) {
  let network = false;
  let suppressed = false;
  try {
    network = sceneHasNetwork(actorScene(actor)) || Boolean(actorChambers(actor).network);
  } catch (err) {
    network = false;
  }
  try {
    suppressed = suppressionState(actor).tech !== null;
  } catch (err) {
    suppressed = false;
  }
  return shopNetworkState({ calendarOn: isCalendarEnabled(), network, suppressed });
}

/**
 * O depósito que a cena aponta, só pela referência (o jogador pode não enxergar o Ator do depósito, e a
 * tela não precisa: o Mestre confere de verdade na compra). `{uuid, name}` ou `null`.
 */
export function depotRefForScene(scene) {
  if (!scene) return null;
  const uuid = String(sceneField(scene, "depotId") ?? "");
  if (!uuid) return null;
  let name = "";
  try {
    name = fromUuidSync(uuid)?.name ?? "";
  } catch (err) {
    name = "";
  }
  return { uuid, name: name || "Depósito do lugar" };
}

/** Onde o personagem está (depósito) e as naves que ele tripula, com "atracada aqui" = a cena da nave aponta para o mesmo depósito. */
export function deliveryContext(actor) {
  const depot = depotRefForScene(actorScene(actor));
  const ships = findCrewedShipsForActor(actor).map(ship => ({
    uuid: ship.uuid,
    name: ship.name,
    docked: Boolean(depot) && depotRefForScene(actorScene(ship))?.uuid === depot.uuid
  }));
  return { depot, ships };
}

/* ------------------------------------------------------------------ Catálogo */

/** As lojas que aparecem no app Compras. */
export function onlineShops() {
  return (game.actors?.filter(a => isShopActor(a) && shopOf(a).online) ?? []).sort((a, b) => a.name.localeCompare(b.name));
}

/** Uma linha de produto do app (de qualquer loja online). */
export function onlineCatalog(currencies = getActiveCurrencies(), dayLength = worldDayLength()) {
  const rows = [];
  for (const shop of onlineShops()) {
    const cfg = shopOf(shop);
    for (const item of shopStockItems(shop)) {
      const listing = shopListing(shop, item, cfg, currencies);
      const s = normalizeItemShop(item.system.shop);
      const hours = deliveryHoursFor({ digital: s.digital, itemHours: s.deliveryHours, shopHours: cfg.deliveryHours });
      rows.push({
        key: `${shop.id}|${item.id}`,
        shopUuid: shop.uuid,
        shopId: shop.id,
        shopName: shop.name,
        itemId: item.id,
        name: item.name,
        img: item.img,
        kind: itemKind(item),
        tags: s.tags,
        description: plainText(item.system.description),
        digital: s.digital,
        hours,
        deliveryLabel: deliveryLabel(hours, dayLength),
        soldOut: listing.soldOut,
        stock: listing.stock,
        stockText: listing.stock === null ? "estoque ilimitado" : listing.soldOut ? "esgotado" : `${listing.stock} em estoque`,
        unitUnits: listing.unitUnits,
        currencyId: listing.currencyId,
        priceText: priceText(listing.unitUnits, listing.currencyId, currencies),
        color: machineColor(item.name)
      });
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ Pedidos do personagem */

/** Os pedidos guardados no personagem (os mais novos primeiro). */
export function readOrders(actor) {
  const list = actor?.getFlag?.(SYSTEM_ID, ORDERS_FLAG);
  return Array.isArray(list) ? list : [];
}

/** Os pedidos como a aba Entregas mostra, com o estado de agora. */
export function orderViews(actor, dayLength = worldDayLength()) {
  const now = worldSeconds();
  return readOrders(actor).map(order => {
    let gone = false;
    if (order.mode === "depot" && order.itemId) {
      let depot = null;
      try {
        depot = fromUuidSync(order.destUuid);
      } catch (err) {
        depot = null;
      }
      gone = Boolean(depot) && !depot.items?.get(order.itemId);
    }
    const st = orderState(order, now, { gone });
    const isShip = order.mode === "ship";
    let note = "";
    if (order.mode === "digital") note = "Entregue na hora no seu inventário.";
    else if (st.state === "transit") note = etaText(st.remaining, dayLength);
    else if (st.state === "taken") note = "Você já retirou do depósito.";
    else note = isShip ? "Está no porão da nave." : "Pegue no depósito (só você ou o Mestre).";
    return {
      id: order.id,
      name: order.name,
      qty: order.qty,
      qtyText: order.qty > 1 ? `${order.qty}× ` : "",
      img: order.img,
      color: machineColor(order.name),
      shopName: order.shopName,
      destName: order.destName,
      state: st.state,
      stateText: st.state === "transit" ? "a caminho" : st.state === "taken" ? "retirado" : "chegou",
      progress: Math.round(st.progress * 100),
      note,
      showDest: order.mode !== "digital"
    };
  });
}

/* ------------------------------------------------------------------ Comprar (Mestre) */

async function orderAsGm(payload, user) {
  if (!isShopsEnabled()) return refuse("as lojas estão desligadas");
  const buyer = await ownedDoc(payload?.buyerUuid, user);
  if (!buyer) return refuse(RELAY_REASONS.permission);
  if (buyer.type !== "character" || shopOf(buyer).enabled) return refuse(RELAY_REASONS.invalid);
  const net = networkFor(buyer);
  if (!net.ok) return refuse(net.reason);

  const wanted = normalizeOrderLines(payload?.lines);
  if (!wanted.length) return refuse("o carrinho está vazio");
  const currencies = getActiveCurrencies();

  // Tudo revalidado a partir dos documentos antes de mexer em qualquer coisa.
  const groups = [];
  for (const group of groupByShop(wanted)) {
    const shop = await fromUuid(group.shopUuid);
    if (!isShopActor(shop) || !shopOf(shop).online) return refuse("uma das lojas não está mais online");
    if (sameActor(buyer, shop)) return refuse(RELAY_REASONS.invalid);
    const cfg = shopOf(shop);
    const lines = [];
    for (const line of group.lines) {
      const item = shop.items.get(line.itemId);
      if (!item || !SHOP_ITEM_TYPES.includes(item.type)) return refuse("um dos itens não está mais à venda");
      const listing = shopListing(shop, item, cfg, currencies);
      const check = canBuyStock({ stock: listing.stock, quantity: line.qty });
      if (!check.ok) return refuse(`${item.name}: ${check.reason}`);
      const s = normalizeItemShop(item.system.shop);
      lines.push({ item, qty: line.qty, listing, digital: s.digital, hours: deliveryHoursFor({ digital: s.digital, itemHours: s.deliveryHours, shopHours: cfg.deliveryHours }) });
    }
    groups.push({ shop, cfg, lines });
  }

  const total = groups.reduce((sum, g) => sum + g.lines.reduce((s, l) => s + l.listing.unitUnits * l.qty, 0), 0);
  if (walletUnits(walletOf(buyer), currencies) < total) {
    return refuse(`saldo insuficiente (o carrinho custa ${formatMoney(total, currencies)})`);
  }

  const needsAddress = groups.some(g => g.lines.some(l => !l.digital));
  const depotDoc = depotForScene(actorScene(buyer));
  const depot = depotDoc ? { uuid: depotDoc.uuid, name: depotDoc.name } : null;
  const ships = [];
  for (const ship of findCrewedShipsForActor(buyer)) {
    const shipDepot = depotForScene(actorScene(ship));
    ships.push({ uuid: ship.uuid, name: ship.name, docked: Boolean(depotDoc) && shipDepot?.uuid === depotDoc.uuid, doc: ship });
  }
  const dest = chooseDestination({ requested: payload?.destination, needsAddress, depot, ships });
  if (!dest.ok) return refuse(dest.reason);
  const ship = dest.mode === "ship" ? ships.find(s => s.uuid === dest.shipUuid)?.doc : null;

  const now = worldSeconds();
  const records = [];
  let done = 0;
  let failure = null;
  for (const group of groups) {
    const groupRecords = [];
    const deliver = async line => {
      const { item, qty } = line;
      const base = { id: newId(), name: item.name, img: item.img, qty, shopName: group.shop.name, orderedAt: now };
      if (line.digital) {
        const gain = await giveItem(buyer, item, qty);
        if (!gain) return { ok: false, reason: `${buyer.name} não aceita ${item.name}` };
        groupRecords.push({ ...base, mode: "digital", destName: buyer.name, destUuid: buyer.uuid, itemId: "", arriveAt: null });
        return { ok: true, op: gain };
      }
      const arriveAt = arriveAtFor(now, line.hours);
      if (ship && arriveAt === null) {
        const gain = await giveItem(ship, item, qty);
        if (!gain) return { ok: false, reason: `${ship.name} não aceita ${item.name}` };
        groupRecords.push({ ...base, mode: "ship", destName: `Porão da ${ship.name}`, destUuid: ship.uuid, itemId: "", arriveAt: null });
        return { ok: true, op: gain };
      }
      const made = await deliverToDeposit(depotDoc, item, qty, { owner: buyer, from: group.shop.name, arriveAt, shipUuid: ship?.uuid ?? "" });
      if (!made) return { ok: false, reason: `não deu para entregar ${item.name} em ${depotDoc.name}` };
      groupRecords.push({
        ...base,
        mode: ship ? "ship" : "depot",
        destName: ship ? `Porão da ${ship.name}` : depotDoc.name,
        destUuid: ship ? ship.uuid : depotDoc.uuid,
        depotUuid: depotDoc.uuid,
        itemId: made.id,
        arriveAt
      });
      return { ok: true, op: { op: "gain", uuid: depotDoc.uuid, itemId: made.id, created: true, qty, before: 0 } };
    };
    const result = await completeBuy({ shop: group.shop, buyer, lines: group.lines, currencies, deliver });
    if (!result.ok) {
      failure = result;
      break;
    }
    records.push(...groupRecords);
    done += group.lines.length;
  }
  if (records.length) await buyer.setFlag(SYSTEM_ID, ORDERS_FLAG, pushOrders(readOrders(buyer), records));
  if (failure) return refuse(done ? `${failure.reason} (o que veio antes já foi comprado: ${done} ${done === 1 ? "item" : "itens"})` : failure.reason);
  return { ok: true, value: { count: done, total } };
}

/* ------------------------------------------------------------------ Relay e pedido do cliente */

/** Ações do relay do Mestre deste subsistema (ver core/relay-actions.js). */
export const RELAY_HANDLERS = {
  shopOrder: (payload, user) => serialized(() => orderAsGm(payload, user))
};

/** Finalizar o carrinho: `lines` = `[{shopUuid, itemId, qty}]`; `destination` = "depot" ou o uuid de uma nave. */
export function askOrder({ buyer, lines, destination = "depot" }) {
  return ask("shopOrder", { buyerUuid: buyer.uuid, lines, destination }, "comprar");
}

export { destinationOptions };
