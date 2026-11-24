/**
 * Lojas (G2, lote A) — a parte que lê e grava documentos. As contas (preço, sorteio, moeda,
 * estoque, troca) são puras e testadas em `shop-rules.js`.
 *
 * Uma loja é uma ficha de Personagem com `system.shop.enabled`: os Itens dela são o estoque (o
 * bloco `shop` de cada Item guarda preço base, estoque e ajuste) e as moedas dela são o caixa.
 * **Quem executa é só o Mestre designado** (`runAsGm`): ele recalcula o preço a partir dos
 * documentos, confere estoque, saldo, equipado/contêiner, descarrega arma e só então move item e
 * dinheiro. O cliente de quem pediu nunca é confiável: o que ele manda é "qual item, quantos".
 *
 * Cada transação entra no histórico da loja (`system.shop.history`, as últimas 12) com tudo que o
 * Desfazer do Mestre precisa para reverter: as moedas dos dois lados e cada item que mudou.
 *
 * A avaliação (vender a um vendedor NPC) é uma "troca" de dois lados (`shop-rules.js`: `newTrade`):
 * o jogador põe os itens, o Mestre põe a oferta e os dois aceitam. Guardada nos flags da loja
 * (`flags.<sistema>.shopTrades`) para todos os clientes verem a mesma coisa.
 */
import { SYSTEM_ID, getActiveCurrencies, isShopsEnabled, sameActor, getShopLootRange } from "../core/config.js";
import { isDesignatedGm, ownedDoc, runAsGm } from "../helpers/gm-relay.js";
import { refuse, RELAY_REASONS, relayFailureMessage } from "../helpers/gm-relay-rules.js";
import { reportError } from "../helpers/report.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";
import { dayLengthSeconds } from "../core/world-time.js";
import { findStack } from "./inventory.js";
import { magazineState } from "./consumable-rules.js";
import { returnLoadedAmmo } from "./consumables.js";
import {
  normalizeShop, normalizeItemShop, toUnits, fromUnits, formatNumber, formatMoney, shopFactor, newSeed, finalPriceUnits,
  priceDiffPercent, soldUnitsFactor, openAmmoFactor, buybackUnits, sellBlockedReason, stockLeft, stockText, canBuyStock,
  stockAfter, stockAfterBuyback, restockedStock, restockDue, walletUnits, payUnits, creditUnits, walletUpdate, invertDelta,
  pushHistory, canUndoEntry, markUndone, normalizeTradeItems, newTrade, tradeSet, tradeAccept, tradeReady, itemKind, isMachineShop, canUseShop
} from "./shop-rules.js";
import { distanceToToken } from "./token-geometry.js";
import { isNear } from "./loot-rules.js";

/** Tipos de Item que uma loja vende e compra. */
export const SHOP_ITEM_TYPES = ["item", "starship_module"];
const MAX_QTY = 999;
const TRADES_FLAG = "shopTrades";
const CLOSED_TRADE_KEEP_MS = 10 * 60 * 1000;

/* ------------------------------------------------------------------ Leitura */

/** `system.shop` do Ator, normalizado. */
export function shopOf(actor) {
  return normalizeShop(actor?.system?.shop);
}

/** Esta ficha é uma loja aberta (e o bloco Lojas está ligado)? */
export function isShopActor(actor) {
  return Boolean(actor) && actor.type === "character" && isShopsEnabled() && shopOf(actor).enabled;
}

const worldSeconds = () => Number(globalThis.game?.time?.worldTime) || 0;

/** Os Itens que a loja tem à venda (Item Geral e Módulo de nave). */
export function shopStockItems(actor) {
  return (actor?.items ?? []).filter(i => SHOP_ITEM_TYPES.includes(i.type));
}

/** A moeda em que o preço do Item é dito: a escolhida no bloco, a do Valor, ou a primeira da lista. */
export function priceCurrencyId(item, currencies = getActiveCurrencies()) {
  const own = normalizeItemShop(item?.system?.shop).currency;
  const id = own || item?.system?.value?.currency || "";
  return currencies.some(c => c.id === id) ? id : currencies[0]?.id ?? "";
}

/** O preço geral de UMA unidade, em unidades base: o preço base do bloco `shop`, ou o "Valor" do Item. */
export function standardUnits(item, currencies = getActiveCurrencies()) {
  const s = normalizeItemShop(item?.system?.shop);
  const base = s.basePrice > 0 ? s.basePrice : Number(item?.system?.value?.amount) || 0;
  return toUnits(base, priceCurrencyId(item, currencies), currencies);
}

/** "48,5 Ouro" — um valor em unidades base, na moeda pedida. */
export function priceText(units, currencyId, currencies = getActiveCurrencies()) {
  const label = currencies.find(c => c.id === currencyId)?.label ?? currencyId ?? "";
  return `${formatNumber(fromUnits(units, currencyId, currencies))} ${label}`.trim();
}

const plainText = html => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** Uma linha da vitrine: tudo que a loja mostra de um Item dela. */
export function shopListing(shopActor, item, cfg = shopOf(shopActor), currencies = getActiveCurrencies()) {
  const s = normalizeItemShop(item.system.shop);
  const currencyId = priceCurrencyId(item, currencies);
  const std = standardUnits(item, currencies);
  const factor = shopFactor(cfg.seed, item.name, cfg.randomizer);
  const unit = finalPriceUnits({
    baseUnits: std,
    multiplier: cfg.multiplier,
    factor,
    overrideUnits: s.priceOverride != null ? toUnits(s.priceOverride, currencyId, currencies) : null
  });
  const stock = stockLeft(s.stock);
  return {
    id: item.id,
    name: item.name,
    img: item.img,
    type: item.type,
    kind: itemKind(item),
    tags: s.tags,
    description: plainText(item.system.description).slice(0, 90),
    stock,
    stockText: stockText(s.stock),
    soldOut: stock === 0,
    stdUnits: std,
    unitUnits: unit,
    fixed: s.priceOverride != null,
    diff: priceDiffPercent(unit, std),
    currencyId,
    overrideValue: s.priceOverride
  };
}

/* ------------------------------------------------------------------ O que o jogador vende */

/** Os Itens do Ator que podem ir para uma loja (nem equipados nem contêineres cheios entram: ver o motivo). */
export function sellCandidates(actor) {
  return (actor?.items ?? []).filter(i => SHOP_ITEM_TYPES.includes(i.type) && (Number(i.system.quantity) || 0) > 0);
}

/** O motivo para o Item não poder ser vendido agora, ou "". */
export function itemSellBlock(actor, item) {
  return sellBlockedReason({
    equipped: Boolean(item.system.equipped),
    isContainer: Boolean(item.system.container?.enabled),
    containerHasItems: actor.items.some(i => i.system?.containerId === item.id)
  });
}

/**
 * Quanto vale vender `qty` deste Item: o preço padrão (com o proporcional de cargas e de munição
 * aberta) e o que um ponto automático paga (× fração). Em unidades base.
 */
export function sellValue(item, qty, fraction, currencies = getActiveCurrencies()) {
  const std = standardUnits(item, currencies);
  const charges = item.system.consumable?.enabled ? Number(item.system.consumable.charges) || 0 : 0;
  const sold = soldUnitsFactor({ quantity: item.system.quantity, sell: qty, charges, used: item.system.consumable?.chargesUsed });
  const ammoFactor = item.system.ammo?.enabled ? openAmmoFactor(item.system.ammo.rounds, item.system.ammo.capacity) : 1;
  const factor = sold.factor * ammoFactor;
  return {
    sell: sold.sell,
    openGoes: sold.openGoes,
    stdUnits: Math.round(std * factor),
    buyUnits: buybackUnits({ baseUnits: std, fraction, factor }),
    currencyId: priceCurrencyId(item, currencies)
  };
}

/**
 * Planeja a venda de uma lista `{id, qty}` do Ator: cada linha com o Item, quanto sai e o valor.
 * @returns {{ok:boolean, reason?:string, lines?:Array<{item:object, qty:number, stdUnits:number, buyUnits:number, currencyId:string, openGoes:boolean}>}}
 */
export function planSellLines(seller, wanted, cfg, currencies = getActiveCurrencies()) {
  const list = normalizeTradeItems(wanted);
  if (!list.length) return { ok: false, reason: "nenhum item marcado" };
  const lines = [];
  for (const entry of list) {
    const item = seller.items.get(entry.id);
    if (!item || !SHOP_ITEM_TYPES.includes(item.type)) return { ok: false, reason: "um dos itens não está mais com o vendedor" };
    const have = Math.floor(Number(item.system.quantity) || 0);
    if (have < 1) return { ok: false, reason: `${item.name}: sem quantidade` };
    const blocked = itemSellBlock(seller, item);
    if (blocked) return { ok: false, reason: `${item.name}: ${blocked}` };
    const qty = Math.min(have, entry.qty);
    const value = sellValue(item, qty, cfg.buybackFraction, currencies);
    lines.push({ item, qty, ...value });
  }
  return { ok: true, lines };
}

/* ------------------------------------------------------------------ Mover Itens */

export const walletOf = actor => actor?.system?.currencies ?? {};
export const clampQty = value => Math.min(MAX_QTY, Math.max(1, Math.floor(Number(value) || 1)));
export const newId = () => foundry.utils.randomID();

/** Dados de um Item para virar cópia em outra ficha: sem id, sem equipar, fora de contêiner, sem estoque de loja. */
export function copyData(item, quantity, { forShop = false, resetCharges = false, containerId = "" } = {}) {
  const data = item.toObject();
  delete data._id;
  delete data.sort;
  delete data.ownership;
  // A marca de entrega do depósito não acompanha o Item para fora dele (nem para a ficha, nem para o porão).
  if (data.flags?.[SYSTEM_ID]) delete data.flags[SYSTEM_ID].delivery;
  data.system.quantity = quantity;
  data.system.equipped = false;
  data.system.containerId = containerId;
  if (data.system.shop) {
    data.system.shop = { ...data.system.shop, stock: forShop ? quantity : null, restockTo: null, priceOverride: null };
  }
  if (resetCharges && data.system.consumable) data.system.consumable.chargesUsed = 0;
  return data;
}

/** Põe `qty` do Item na ficha `dest` (soma na pilha igual). Devolve o que mudou para o Desfazer, ou null. */
export async function giveItem(dest, source, qty, { containerId = "" } = {}) {
  const data = copyData(source, qty, { containerId });
  if (data.type === "item") {
    const stack = findStack(dest, data, containerId);
    if (stack) {
      const before = Number(stack.system.quantity) || 0;
      await stack.update({ "system.quantity": before + qty });
      return { op: "gain", uuid: dest.uuid, itemId: stack.id, created: false, qty, before };
    }
  }
  const [made] = await dest.createEmbeddedDocuments("Item", [data]);
  if (!made) return null;
  return { op: "gain", uuid: dest.uuid, itemId: made.id, created: true, qty, before: 0 };
}

/** Tira `qty` do Item da ficha dona (apaga se acabar). */
export async function takeItem(owner, item, qty) {
  const have = Number(item.system.quantity) || 0;
  const snapshot = item.toObject();
  delete snapshot._id;
  const removed = qty >= have;
  if (removed) await item.delete();
  else await item.update({ "system.quantity": have - qty });
  return { op: "loss", uuid: owner.uuid, itemId: item.id, removed, qty, before: have, snapshot };
}

/** Descarrega a arma antes de vender: a munição volta para o inventário de quem vende. */
export async function unloadForSale(owner, item) {
  const w = item.system.weapon;
  if (!w?.enabled) return;
  const mag = magazineState({ size: w.magazineSize, loaded: w.loaded, capacity: w.loadedAmmo?.capacity });
  if (!mag.uses || mag.loaded <= 0) return;
  await returnLoadedAmmo(owner, item, mag);
  await item.update({ "system.weapon.loaded": 0, "system.weapon.loadedAmmo": null });
}

/** O que a loja guarda ao comprar `qty` do Item de alguém: soma numa pilha dela ou cria uma nova. */
async function stockItemIn(shop, source, qty, { resetCharges = false } = {}) {
  const data = copyData(source, qty, { forShop: true, resetCharges });
  const same = data.type === "item" ? findStack(shop, data, "") : shop.items.find(i => i.type === data.type && i.name === data.name && i.img === data.img);
  if (same) {
    const s = normalizeItemShop(same.system.shop);
    const before = { stock: stockLeft(s.stock), quantity: Number(same.system.quantity) || 0 };
    const next = stockAfterBuyback(s.stock, qty);
    if (next !== null) await same.update({ "system.shop.stock": next, "system.quantity": before.quantity + qty });
    else await same.update({ "system.quantity": before.quantity + qty });
    return { op: "shopGain", itemId: same.id, created: false, qty, before };
  }
  const [made] = await shop.createEmbeddedDocuments("Item", [data]);
  if (!made) return null;
  return { op: "shopGain", itemId: made.id, created: true, qty, before: { stock: null, quantity: 0 } };
}

/* ------------------------------------------------------------------ Histórico e aviso */

const moneyText = (units, currencyId, currencies) => formatMoney(units, currencies, currencyId);

export function makeEntry(fields) {
  return { id: newId(), ts: Date.now(), clock: worldSeconds(), undone: false, ...fields };
}

async function writeShop(shop, extra, entry) {
  const cfg = shopOf(shop);
  await shop.update({ ...extra, "system.shop.history": pushHistory(cfg.history, entry) });
}

export async function announce(actor, title, body) {
  try {
    await announceVoiceOfTheWorld(actor, { kind: "shop", title, body });
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Loja: não deu para publicar o aviso.`, err);
  }
}

/* ------------------------------------------------------------------ Acesso */

/**
 * Quem pode usar a loja: o Mestre; quem ele incluiu em "Mostrar aos jogadores" (`shownTo`); ou, numa
 * máquina de venda, quem está perto do Token dela (clique a até 2 m). A ficha da loja NUNCA exige permissão.
 * @returns {Promise<boolean>}
 */
async function shopAccess(shop, user, payload, actor) {
  if (user?.isGM) return true;
  if (canUseShop(shop.system.shop, user?.id)) return true;
  if (!isMachineShop(shop.system.shop) || !payload?.tokenUuid || !actor) return false;
  const token = await fromUuid(String(payload.tokenUuid));
  if (!token || token.documentName !== "Token" || token.actorId !== shop.id) return false;
  return isNear(distanceToToken(actor, token), getShopLootRange());
}

/* ------------------------------------------------------------------ Comprar */

/**
 * Fecha a compra de uma ou mais linhas de UMA loja (a conta, o item, o caixa, o estoque, o histórico e
 * o aviso). `lines`: `[{item, qty, listing}]` já validadas (estoque conferido). `deliver(line)` entrega
 * uma linha e devolve `{ok: true, op}` (o passo de ganho, para o Desfazer) ou `{ok: false, reason}`;
 * se uma linha falha, as já entregues voltam e nada é cobrado. Usado pela Vitrine (`shopBuy`) e pelo
 * app Compras do PAD (`shopOrder`, em `shop-online.js`).
 */
export async function completeBuy({ shop, buyer, lines, currencies, deliver }) {
  const total = lines.reduce((sum, l) => sum + l.listing.unitUnits * l.qty, 0);
  const pref = lines[0].listing.currencyId;
  const pay = payUnits(walletOf(buyer), currencies, total, pref);
  if (!pay.ok) return refuse(`saldo insuficiente (custa ${moneyText(total, pref, currencies)})`);

  const gains = [];
  for (const line of lines) {
    const result = await deliver(line);
    if (!result?.ok) {
      if (gains.length) await revertOps(gains);
      return refuse(result?.reason || `${line.item.name}: não deu para entregar`);
    }
    gains.push(result.op);
  }

  const credit = creditUnits(currencies, total, pref);
  const buyerUpdate = walletUpdate(walletOf(buyer), pay.delta);
  const shopUpdate = walletUpdate(walletOf(shop), credit);
  if (Object.keys(buyerUpdate.update).length) await buyer.update(buyerUpdate.update);

  const ops = [...gains];
  for (const { item, listing, qty } of lines) {
    const before = { stock: listing.stock, quantity: Number(item.system.quantity) || 0 };
    if (listing.stock !== null) {
      const next = stockAfter(listing.stock, qty);
      await item.update({ "system.shop.stock": next, "system.quantity": next });
    }
    ops.push({ op: "stock", itemId: item.id, before });
  }
  const names = lines.map(l => `${l.qty}× ${l.item.name}`).join(", ");
  const label = `${buyer.name} comprou ${names} · ${moneyText(total, pref, currencies)}`;
  const entry = makeEntry({
    kind: "buy",
    label,
    partyUuid: buyer.uuid,
    partyName: buyer.name,
    partyDelta: pay.delta,
    shopDelta: credit,
    ops
  });
  await writeShop(shop, shopUpdate.update, entry);
  await announce(buyer, "Compra", `${buyer.name} comprou ${names} de ${shop.name} por ${moneyText(total, pref, currencies)}.`);
  return { ok: true, value: { id: entry.id, label, total, currencyId: pref } };
}

async function buyAsGm(payload, user) {
  if (!isShopsEnabled()) return refuse("as lojas estão desligadas");
  const shop = await fromUuid(String(payload?.shopUuid ?? ""));
  if (!isShopActor(shop)) return refuse("esta ficha não é uma loja aberta");
  const buyer = await ownedDoc(payload?.buyerUuid, user);
  if (!buyer) return refuse(RELAY_REASONS.permission);
  if (buyer.type !== "character" || sameActor(buyer, shop)) return refuse(RELAY_REASONS.invalid);
  if (!(await shopAccess(shop, user, payload, buyer))) return refuse("o Mestre ainda não mostrou esta loja para você");
  const item = shop.items.get(String(payload?.itemId ?? ""));
  if (!item || !SHOP_ITEM_TYPES.includes(item.type)) return refuse("esse item não está mais à venda");

  const currencies = getActiveCurrencies();
  const cfg = shopOf(shop);
  const qty = clampQty(payload?.quantity);
  const listing = shopListing(shop, item, cfg, currencies);
  const stockCheck = canBuyStock({ stock: listing.stock, quantity: qty });
  if (!stockCheck.ok) return refuse(`${item.name}: ${stockCheck.reason}`);

  let dest = buyer;
  if (payload?.destinationUuid && payload.destinationUuid !== buyer.uuid) {
    dest = await ownedDoc(payload.destinationUuid, user);
    if (!dest || !["starship", "vehicle"].includes(dest.type)) return refuse(RELAY_REASONS.invalid);
  }
  const deliver = async line => {
    const gain = await giveItem(dest, line.item, line.qty);
    return gain ? { ok: true, op: gain } : { ok: false, reason: `${dest.name} não aceita ${line.item.name}` };
  };
  const result = await completeBuy({ shop, buyer, lines: [{ item, qty, listing }], currencies, deliver });
  return result.ok ? { ok: true, value: { id: result.value.id, label: result.value.label } } : result;
}

/* ------------------------------------------------------------------ Vender */

/**
 * Executa uma venda (ponto automático, ou avaliação aceita): move os itens para a loja e as moedas
 * para quem vendeu. `totalUnits` fixo vem da oferta do Mestre; sem ele vale o que o ponto automático paga.
 */
async function performSell({ shop, seller, wanted, totalUnits = null, preferredId = "", kind = "sell", cfg = shopOf(shop) }) {
  const currencies = getActiveCurrencies();
  const plan = planSellLines(seller, wanted, cfg, currencies);
  if (!plan.ok) return refuse(plan.reason);
  const total = totalUnits ?? plan.lines.reduce((sum, l) => sum + l.buyUnits, 0);
  const pref = preferredId || plan.lines[0]?.currencyId || "";

  let shopDelta = {};
  if (cfg.limitedFunds && total > 0) {
    const shopPay = payUnits(walletOf(shop), currencies, total, pref);
    if (!shopPay.ok) return refuse(`${shop.name} não tem moedas para pagar ${moneyText(total, pref, currencies)}`);
    shopDelta = shopPay.delta;
  }
  const credit = creditUnits(currencies, total, pref);

  const ops = [];
  for (const line of plan.lines) {
    await unloadForSale(seller, line.item);
    const fresh = seller.items.get(line.item.id) ?? line.item;
    // Venda parcial de uma pilha com unidade aberta: a loja recebe unidades cheias (a aberta fica com o dono).
    const stocked = await stockItemIn(shop, fresh, line.qty, { resetCharges: !line.openGoes });
    if (!stocked) return refuse(`${shop.name} não aceita ${line.item.name}`);
    const lost = await takeItem(seller, fresh, line.qty);
    ops.push(stocked, lost);
  }

  const sellerUpdate = walletUpdate(walletOf(seller), credit);
  if (Object.keys(sellerUpdate.update).length) await seller.update(sellerUpdate.update);
  const shopUpdate = Object.keys(shopDelta).length ? walletUpdate(walletOf(shop), shopDelta) : { update: {} };

  const names = plan.lines.map(l => `${l.qty}× ${l.item.name}`).join(", ");
  const how = kind === "appraisal" ? " (avaliação do Mestre)" : "";
  const label = `${seller.name} vendeu ${names} · ${moneyText(total, pref, currencies)}${how}`;
  const entry = makeEntry({
    kind,
    label,
    partyUuid: seller.uuid,
    partyName: seller.name,
    partyDelta: credit,
    shopDelta,
    ops
  });
  await writeShop(shop, shopUpdate.update, entry);
  await announce(seller, "Venda", `${seller.name} vendeu ${names} para ${shop.name} por ${moneyText(total, pref, currencies)}.`);
  return { ok: true, value: { id: entry.id, label, total } };
}

async function sellAsGm(payload, user) {
  if (!isShopsEnabled()) return refuse("as lojas estão desligadas");
  const shop = await fromUuid(String(payload?.shopUuid ?? ""));
  if (!isShopActor(shop)) return refuse("esta ficha não é uma loja aberta");
  const seller = await ownedDoc(payload?.sellerUuid, user);
  if (!seller) return refuse(RELAY_REASONS.permission);
  if (seller.type !== "character" || sameActor(seller, shop)) return refuse(RELAY_REASONS.invalid);
  if (!(await shopAccess(shop, user, payload, seller))) return refuse("o Mestre ainda não mostrou esta loja para você");
  const cfg = shopOf(shop);
  if (cfg.kind !== "auto") return refuse("este vendedor avalia pessoalmente: use Pedir avaliação");
  if (cfg.style === "machine") return refuse("a máquina de venda não compra de volta");
  return performSell({ shop, seller, wanted: payload?.items, cfg });
}

/* ------------------------------------------------------------------ Desfazer */

async function undoAsGm(payload, user) {
  if (!user?.isGM) return refuse(RELAY_REASONS.permission);
  const shop = await fromUuid(String(payload?.shopUuid ?? ""));
  if (!shop || shop.type !== "character") return refuse(RELAY_REASONS.invalid);
  const cfg = shopOf(shop);
  const entry = cfg.history.find(h => h?.id === payload?.entryId);
  if (!entry) return refuse("essa venda não está mais no histórico");
  if (!canUndoEntry(cfg.history, entry.id)) return refuse("só a última venda pode ser desfeita");
  const party = await fromUuid(entry.partyUuid);
  if (!party) return refuse("quem comprou ou vendeu não existe mais");

  // Confere tudo antes de mexer: o dinheiro precisa poder voltar e os itens precisam estar lá.
  const partyBack = walletUpdate(walletOf(party), invertDelta(entry.partyDelta));
  if (!partyBack.ok) return refuse(`${party.name} já gastou esse dinheiro`);
  const shopBack = walletUpdate(walletOf(shop), invertDelta(entry.shopDelta));
  if (!shopBack.ok) return refuse(`${shop.name} já gastou esse dinheiro`);
  const plan = [];
  for (const op of entry.ops ?? []) {
    if (op.op === "gain") {
      const holder = await fromUuid(op.uuid);
      const item = holder?.items?.get(op.itemId);
      if (!item || (Number(item.system.quantity) || 0) < op.qty) return refuse(`${item?.name ?? "o item"} já não está com ${holder?.name ?? "o comprador"}`);
      plan.push({ op, holder, item });
    } else if (op.op === "shopGain") {
      const item = shop.items.get(op.itemId);
      const s = normalizeItemShop(item?.system?.shop);
      if (!item || (Number(item.system.quantity) || 0) < op.qty || (stockLeft(s.stock) !== null && stockLeft(s.stock) < op.qty)) {
        return refuse(`${item?.name ?? "o item"} já saiu do estoque da loja`);
      }
      plan.push({ op, item });
    } else if (op.op === "loss") {
      plan.push({ op, holder: await fromUuid(op.uuid) });
    } else if (op.op === "stock") {
      plan.push({ op, item: shop.items.get(op.itemId) });
    }
  }
  for (const step of plan) {
    const { op, item, holder } = step;
    if (op.op === "gain") {
      const left = (Number(item.system.quantity) || 0) - op.qty;
      if (op.created && left <= 0) await item.delete();
      else await item.update({ "system.quantity": left });
    } else if (op.op === "shopGain") {
      const s = normalizeItemShop(item.system.shop);
      const left = (Number(item.system.quantity) || 0) - op.qty;
      if (op.created && left <= 0) await item.delete();
      else if (stockLeft(s.stock) !== null) await item.update({ "system.shop.stock": stockLeft(s.stock) - op.qty, "system.quantity": left });
      else await item.update({ "system.quantity": left });
    } else if (op.op === "loss") {
      const existing = holder?.items?.get(op.itemId);
      if (existing) await existing.update({ "system.quantity": (Number(existing.system.quantity) || 0) + op.qty });
      else if (holder) {
        const data = foundry.utils.deepClone(op.snapshot);
        data.system.quantity = op.qty;
        await holder.createEmbeddedDocuments("Item", [data]);
      }
    } else if (op.op === "stock" && item) {
      const patch = { "system.quantity": op.before.quantity };
      if (op.before.stock !== null && op.before.stock !== undefined) patch["system.shop.stock"] = op.before.stock;
      await item.update(patch);
    }
  }
  if (Object.keys(partyBack.update).length) await party.update(partyBack.update);
  await shop.update({ ...shopBack.update, "system.shop.history": markUndone(cfg.history, entry.id) });
  await announce(party, "Venda desfeita", `O Mestre desfez: ${entry.label}.`);
  return { ok: true };
}

/* ------------------------------------------------------------------ Avaliação (troca de dois lados) */

/** As trocas abertas da loja (flags). */
export function readTrades(shop) {
  const list = shop?.getFlag?.(SYSTEM_ID, TRADES_FLAG);
  return Array.isArray(list) ? list : [];
}

async function writeTrades(shop, list) {
  const now = Date.now();
  const kept = list.filter(t => t.status === "open" || now - (t.closedAt ?? now) < CLOSED_TRADE_KEEP_MS);
  await shop.setFlag(SYSTEM_ID, TRADES_FLAG, kept);
}

function closeTrade(trade, status, text) {
  return { ...trade, status, closedAt: Date.now(), text: text ?? "" };
}

async function tradeAsGm(payload, user) {
  if (!isShopsEnabled()) return refuse("as lojas estão desligadas");
  const shop = await fromUuid(String(payload?.shopUuid ?? ""));
  if (!isShopActor(shop)) return refuse("esta ficha não é uma loja aberta");
  const cfg = shopOf(shop);
  if (cfg.kind !== "vendor") return refuse("este ponto compra direto: não há avaliação");
  const currencies = getActiveCurrencies();
  const trades = readTrades(shop);
  const op = String(payload?.op ?? "");

  if (op === "open") {
    const seller = await ownedDoc(payload?.sellerUuid, user);
    if (!seller) return refuse(RELAY_REASONS.permission);
    if (seller.type !== "character" || sameActor(seller, shop)) return refuse(RELAY_REASONS.invalid);
    if (!(await shopAccess(shop, user, payload, seller))) return refuse("o Mestre ainda não mostrou esta loja para você");
    const plan = planSellLines(seller, payload?.items, cfg, currencies);
    if (!plan.ok) return refuse(plan.reason);
    const items = plan.lines.map(l => ({ id: l.item.id, qty: l.qty }));
    let trade = trades.find(t => t.status === "open" && t.sellerUuid === seller.uuid);
    const isNew = !trade;
    if (!trade) trade = newTrade({ id: newId(), status: "open", sellerUuid: seller.uuid, sellerName: seller.name, userId: user.id, createdAt: Date.now(), offerChanged: false, text: "" });
    trade = tradeSet(trade, "a", { items }).trade;
    const next = isNew ? [...trades.filter(t => t.sellerUuid !== seller.uuid), trade] : trades.map(t => (t.id === trade.id ? trade : t));
    await writeTrades(shop, next);
    if (isNew) {
      ui.notifications.info(`${seller.name} quer vender ${items.length} ${items.length === 1 ? "item" : "itens"} para ${shop.name}: avalie na aba Loja.`);
      try {
        const { openAppraisal } = await import("../apps/shop-appraisal.js");
        openAppraisal(shop);
      } catch (err) {
        console.warn(`${SYSTEM_ID} | Loja: não abriu a janela de avaliação.`, err);
      }
    }
    return { ok: true, value: { id: trade.id } };
  }

  const trade = trades.find(t => t.id === payload?.tradeId);
  if (!trade) return refuse("esse pedido não existe mais");
  const seller = await fromUuid(trade.sellerUuid);
  const isSellerUser = Boolean(seller) && seller.testUserPermission?.(user, "OWNER");
  const save = next => writeTrades(shop, trades.map(t => (t.id === trade.id ? next : t)));

  if (op === "offer") {
    if (!user?.isGM) return refuse(RELAY_REASONS.permission);
    if (trade.status !== "open") return refuse("esse pedido já foi encerrado");
    const currency = currencies.some(c => c.id === payload?.currency) ? payload.currency : currencies[0]?.id ?? "";
    const amount = Number(payload?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return refuse("a oferta precisa ser maior que zero (para não comprar, use Recusar)");
    const units = toUnits(amount, currency, currencies);
    if (cfg.limitedFunds && walletUnits(walletOf(shop), currencies) < units) return refuse(`${shop.name} não tem moedas para essa oferta`);
    const hadOffer = Boolean(trade.b?.coins);
    let next = tradeSet(trade, "b", { coins: { amount, currency } }).trade;
    next = tradeAccept(next, "b", true);
    next = { ...next, offerChanged: hadOffer && JSON.stringify(trade.b.coins) !== JSON.stringify(next.b.coins), text: "" };
    await save(next);
    return { ok: true };
  }

  if (op === "accept") {
    if (!isSellerUser || !seller) return refuse(RELAY_REASONS.permission);
    if (trade.status !== "open") return refuse("esse pedido já foi encerrado");
    if (!trade.b?.coins || !trade.accepted?.b) return refuse("o Mestre ainda não fez uma oferta");
    let next = tradeAccept(trade, "a", true);
    if (!tradeReady(next)) return refuse(RELAY_REASONS.invalid);
    const units = toUnits(next.b.coins.amount, next.b.coins.currency, currencies);
    const result = await performSell({ shop, seller, wanted: next.a.items, totalUnits: units, preferredId: next.b.coins.currency, kind: "appraisal", cfg });
    if (!result.ok) {
      await save({ ...tradeAccept(next, "a", false), text: result.reason });
      return refuse(result.reason);
    }
    await save(closeTrade({ ...next, offerChanged: false }, "done", `Venda feita: +${moneyText(units, next.b.coins.currency, currencies)}. Os itens passaram para ${shop.name}.`));
    return { ok: true };
  }

  if (op === "refuse") {
    if (!user?.isGM && !isSellerUser) return refuse(RELAY_REASONS.permission);
    if (trade.status !== "open") return { ok: true };
    await save(closeTrade(trade, "refused", user.isGM ? "Recusado pelo Mestre. Nada foi vendido." : "Recusado. Nada foi vendido."));
    return { ok: true };
  }

  if (op === "close") {
    if (!user?.isGM && !isSellerUser) return refuse(RELAY_REASONS.permission);
    await writeTrades(shop, trades.filter(t => t.id !== trade.id));
    return { ok: true };
  }
  return refuse(RELAY_REASONS.invalid);
}

/* ------------------------------------------------------------------ Relay */

let chain = Promise.resolve();
/** Uma transação por vez: dois pedidos juntos não podem ler o mesmo estoque. */
export function serialized(fn) {
  const run = chain.catch(() => {}).then(fn);
  chain = run.catch(() => {});
  return run;
}

/** Ações do relay do Mestre deste subsistema (ver core/relay-actions.js). */
export const RELAY_HANDLERS = {
  shopBuy: (payload, user) => serialized(() => buyAsGm(payload, user)),
  shopSell: (payload, user) => serialized(() => sellAsGm(payload, user)),
  shopTrade: (payload, user) => serialized(() => tradeAsGm(payload, user)),
  shopUndo: (payload, user) => serialized(() => undoAsGm(payload, user))
};

/* ------------------------------------------------------------------ Pedidos do cliente */

export async function ask(action, payload, what) {
  const outcome = await runAsGm(action, payload, { reply: true, timeout: 8000 });
  const message = relayFailureMessage(outcome, what);
  if (message) ui.notifications.warn(message);
  return outcome;
}

/** Comprar `quantity` do Item da loja (o Mestre recalcula o preço). */
export function askBuy({ shop, buyer, itemId, quantity, destination = null, tokenUuid = "" }) {
  return ask("shopBuy", { shopUuid: shop.uuid, buyerUuid: buyer.uuid, itemId, quantity, destinationUuid: destination?.uuid ?? "", tokenUuid }, "comprar");
}

/** Vender direto a um ponto automático. */
export function askSell({ shop, seller, items }) {
  return ask("shopSell", { shopUuid: shop.uuid, sellerUuid: seller.uuid, items }, "vender");
}

/** Operações da avaliação: open, offer, accept, refuse, close. */
export function askTrade(op, { shop, seller = null, items = null, tradeId = "", amount = 0, currency = "" }) {
  return ask("shopTrade", { op, shopUuid: shop.uuid, sellerUuid: seller?.uuid ?? "", items, tradeId, amount, currency }, "fazer isso na avaliação");
}

/** Desfazer a última venda (Mestre). */
export function askUndo(shop, entryId) {
  return ask("shopUndo", { shopUuid: shop.uuid, entryId }, "desfazer a venda");
}

/* ------------------------------------------------------------------ Reabastecer */

/** Reabastece: preços sorteados de novo (semente nova) e estoque de volta ao `restockTo` de cada Item. */
export async function restockShop(actor, { stock = true } = {}) {
  const updates = [];
  if (stock) {
    for (const item of shopStockItems(actor)) {
      const s = normalizeItemShop(item.system.shop);
      if (s.restockTo === null) continue;
      const next = restockedStock({ stock: s.stock, restockTo: s.restockTo });
      if (next !== stockLeft(s.stock)) updates.push({ _id: item.id, "system.shop.stock": next, "system.quantity": next });
    }
  }
  await actor.update({ "system.shop.seed": newSeed(), "system.shop.lastRestock": worldSeconds() });
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  return updates.length;
}

/** Só o sorteio de preços de novo (o estoque fica como está). */
export async function rerollShopPrices(actor) {
  await actor.update({ "system.shop.seed": newSeed() });
}

/** Reabastecimento pelo relógio do mundo: roda no Mestre designado quando o tempo anda. */
export async function checkRestocks() {
  if (!isShopsEnabled() || !isDesignatedGm()) return;
  const now = worldSeconds();
  let dayLength = 86400;
  try {
    dayLength = dayLengthSeconds() || 86400;
  } catch (err) {
    dayLength = 86400;
  }
  for (const actor of game.actors) {
    if (actor.type !== "character") continue;
    const cfg = shopOf(actor);
    if (!cfg.enabled || cfg.restockDays <= 0) continue;
    try {
      const due = restockDue({ restockDays: cfg.restockDays, lastRestock: cfg.lastRestock, now, dayLength });
      if (due.init) await actor.update({ "system.shop.lastRestock": now });
      else if (due.due) {
        await restockShop(actor);
        ui.notifications.info(`${actor.name} reabasteceu o estoque.`);
      }
    } catch (err) {
      reportError(`Falha ao reabastecer ${actor.name}.`, err, { gmOnly: true });
    }
  }
}

/* ------------------------------------------------------------------ Janelas abertas e ganchos */

/** Janelas da loja abertas neste cliente (Vitrine e Avaliação): redesenham quando algo da loja muda. */
export const OPEN_SHOP_APPS = new Set();

let refreshTimer = null;
export function refreshShopApps() {
  if (!OPEN_SHOP_APPS.size) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    for (const app of OPEN_SHOP_APPS) if (app.rendered) app.render();
  }, 120);
}

/** Ganchos das lojas: reabastecer pelo relógio e redesenhar as janelas abertas. Chamado uma vez, no `init`. */
export function registerShops() {
  Hooks.on("updateWorldTime", () => {
    checkRestocks();
  });
  Hooks.once("ready", () => {
    checkRestocks();
  });
  for (const hook of ["updateActor", "createItem", "updateItem", "deleteItem", "deleteToken", "updateToken", "createToken"]) Hooks.on(hook, refreshShopApps);
  // Troca entre jogadores (lote B): o estado mora numa setting do mundo.
  Hooks.on("nihilityPlayerTradesChanged", refreshShopApps);
}

/** Desfaz o que `giveItem`/`takeItem` fizeram (rollback de uma troca que falhou no meio). Devolve quantos passos voltou. */
export async function revertOps(ops) {
  let done = 0;
  for (const op of [...ops].reverse()) {
    try {
      const holder = await fromUuid(op.uuid);
      if (!holder) continue;
      if (op.op === "gain") {
        const item = holder.items.get(op.itemId);
        if (!item) continue;
        const left = (Number(item.system.quantity) || 0) - op.qty;
        if (op.created && left <= 0) await item.delete();
        else await item.update({ "system.quantity": Math.max(0, left) });
        done += 1;
      } else if (op.op === "loss") {
        const existing = holder.items.get(op.itemId);
        if (existing) await existing.update({ "system.quantity": (Number(existing.system.quantity) || 0) + op.qty });
        else {
          const data = foundry.utils.deepClone(op.snapshot);
          data.system.quantity = op.qty;
          await holder.createEmbeddedDocuments("Item", [data]);
        }
        done += 1;
      }
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Loja: não deu para desfazer um passo.`, err);
    }
  }
  return done;
}

/** Abre a Vitrine de uma loja (jogador, ou o Mestre vendo como cliente). Ponto automático "máquina" abre a máquina. */
export async function openStorefront(shop, options = {}) {
  if (isMachineShop(shop?.system?.shop)) {
    const { ShopMachineApp } = await import("../apps/shop-machine.js");
    return ShopMachineApp.open(shop, options);
  }
  const { ShopStorefrontApp } = await import("../apps/shop-storefront.js");
  return ShopStorefrontApp.open(shop, options);
}
