/**
 * App "Compras" do PAD (G2 Lojas, lote C; mockup aprovado: Pad.dc.html, quadros 1 a 7): as lojas
 * marcadas `online`, uma vitrine de celular (busca, categorias, produto, carrinho) e a aba Entregas.
 *
 * Fica fora de `nihility-pad.js`: o PAD só ganha a parte do contexto, as ações abaixo (`this` é o PAD)
 * e o ouvinte da busca. Só lê documentos e pede a compra; quem cobra e entrega é o Mestre
 * (`shopOrder`, em `economy/shop-online.js`), que revalida rede, estoque, saldo e destino.
 */
import { getActiveCurrencies, isShopsEnabled } from "../core/config.js";
import { reportError } from "../helpers/report.js";
import {
  cartChange, destinationOptions, chooseDestination, shopCategories, formatMoney, walletUnits, SHOP_KIND_LABELS
} from "../economy/shop-rules.js";
import { machineColor } from "../economy/loot-rules.js";
import { shopOf } from "../economy/shops.js";
import { networkFor, deliveryContext, onlineShops, onlineCatalog, orderViews, askOrder } from "../economy/shop-online.js";
import { worldDayLength } from "../economy/loot.js";

const TABS = [
  { id: "home", label: "Início", icon: "fa-house" },
  { id: "shops", label: "Lojas", icon: "fa-store" },
  { id: "cart", label: "Carrinho", icon: "fa-cart-shopping" },
  { id: "orders", label: "Entregas", icon: "fa-truck" }
];

const KIND_ICONS = { "Consumível": "fa-flask", Arma: "fa-gun", "Munição": "fa-box", "Módulo": "fa-microchip", "Contêiner": "fa-box-open", Equipamento: "fa-shield-halved", Todos: "fa-border-all" };

/** O estado de tela do app (um por PAD). */
export function newPadShopState() {
  return { tab: "home", cat: "Todos", shopId: "", product: "", qty: 1, cart: [], dest: "depot", search: "", busy: false };
}

/** O id do Ator de um uuid (`Actor.abc` e `Scene.x.Token.y.Actor.abc` terminam nele). */
const idOfUuid = uuid => String(uuid ?? "").split(".").pop();
const keyOfLine = l => `${idOfUuid(l.shopUuid)}|${l.itemId}`;

const stateOf = app => (app.shopState ??= newPadShopState());

/** O ícone do PAD aparece? Lojas ligadas e pelo menos uma loja online visível. */
export function padShopAvailable() {
  return isShopsEnabled() && onlineShops().length > 0;
}

/** Contexto do app (vai em `context.padShop`). `null` se o bloco Lojas está desligado. */
export async function padShopContext(app, actor) {
  if (!isShopsEnabled()) return null;
  const s = stateOf(app);
  const currencies = getActiveCurrencies();
  const net = networkFor(actor);
  const out = { available: padShopAvailable(), net, state: net.state, tab: s.tab, search: s.search };
  out.notBuyer = shopOf(actor).enabled;
  if (!net.ok || out.notBuyer) return out;

  const dayLength = worldDayLength();
  const catalog = onlineCatalog(currencies, dayLength);
  const byKey = new Map(catalog.map(r => [r.key, r]));
  // O carrinho some o que saiu do ar (esgotou, loja deixou de ser online).
  s.cart = s.cart.filter(l => byKey.has(keyOfLine(l)) && !byKey.get(keyOfLine(l)).soldOut);

  const card = r => ({
    key: r.key, name: r.name, img: r.img, color: r.color, shopName: r.shopName, priceText: r.priceText, deliveryLabel: r.deliveryLabel,
    digital: r.digital, soldOut: r.soldOut, kind: r.kind, searchName: `${r.name} ${r.shopName}`.toLowerCase(), tagClass: r.digital || r.hours === 0 ? "a" : "g"
  });

  // Início: categorias e produtos (filtrados pela categoria e pela loja escolhida; a busca é no DOM).
  const visible = catalog.filter(r => !s.shopId || r.shopId === s.shopId);
  const cats = shopCategories(visible);
  if (!cats.includes(s.cat)) s.cat = "Todos";
  out.cats = cats.map(name => ({ name, icon: KIND_ICONS[name] ?? "fa-tag", on: name === s.cat }));
  out.products = visible.filter(r => s.cat === "Todos" || r.kind === s.cat || r.tags.includes(s.cat)).map(card);
  out.shopFilter = s.shopId ? onlineShops().find(sh => sh.id === s.shopId)?.name ?? "" : "";
  out.shopCount = onlineShops().length;
  out.hasDigital = catalog.some(r => r.digital);

  // Lojas.
  out.shops = onlineShops().map(shop => {
    const rows = catalog.filter(r => r.shopId === shop.id);
    const kinds = [...new Set(rows.map(r => r.kind))];
    const tags = [];
    if (rows.some(r => r.digital)) tags.push({ text: "software · na hora", cls: "a" });
    const phys = rows.filter(r => !r.digital);
    if (phys.length) {
      const hours = Math.max(...phys.map(r => r.hours));
      tags.push({ text: hours > 0 ? `entrega ${phys.find(r => r.hours === hours).deliveryLabel}` : "entrega na hora", cls: "o" });
    }
    const color = machineColor(shop.name);
    return {
      id: shop.id, name: shop.name, initial: (shop.name ?? "?").trim().charAt(0).toUpperCase(), color,
      hint: kinds.join(" · ") || "sem produtos", tags, count: rows.length, kindLabel: SHOP_KIND_LABELS[shopOf(shop).kind]
    };
  });

  // Produto aberto.
  const open = s.product ? byKey.get(s.product) : null;
  if (s.product && !open) s.product = "";
  if (open) {
    const qty = Math.max(1, Math.min(open.stock ?? 999, s.qty));
    out.product = { ...card(open), shopName: open.shopName, description: open.description, stockText: open.stockText, qty, canBuy: !open.soldOut, totalText: `${formatMoney(open.unitUnits * qty, currencies, open.currencyId)}` };
  }

  // Carrinho.
  const lines = s.cart.map(l => {
    const r = byKey.get(keyOfLine(l));
    return { ...l, row: r, total: r.unitUnits * l.qty };
  });
  const total = lines.reduce((sum, l) => sum + l.total, 0);
  const balance = walletUnits(actor.system.currencies, currencies);
  const needsAddress = lines.some(l => !l.row.digital);
  const ctx = deliveryContext(actor);
  const options = destinationOptions({ depot: ctx.depot, ships: ctx.ships, selected: s.dest });
  const picked = options.find(o => o.selected);
  s.dest = picked?.value ?? "depot";
  const route = chooseDestination({ requested: s.dest, needsAddress, depot: ctx.depot, ships: ctx.ships });
  const enough = balance >= total;
  // Total e saldo na moeda das linhas quando todas cobram a mesma (senão cairia tudo em "Caco", a unidade base).
  const ids = new Set(lines.map(l => l.row.currencyId ?? ""));
  const cartCurrency = ids.size === 1 ? [...ids][0] : "";
  out.cart = {
    count: lines.reduce((sum, l) => sum + l.qty, 0),
    lines: lines.map(l => ({
      key: `${l.row.shopId}|${l.itemId}`, name: l.row.name, img: l.row.img, color: l.row.color, qty: l.qty, digital: l.row.digital,
      deliveryLabel: l.row.deliveryLabel, tagClass: l.row.digital || l.row.hours === 0 ? "a" : "g", shopName: l.row.shopName,
      totalText: formatMoney(l.total, currencies, l.row.currencyId)
    })),
    empty: !lines.length,
    needsAddress,
    destinations: needsAddress ? options : [],
    noAddress: needsAddress && !route.ok && !options.some(o => !o.disabled),
    addressReason: route.reason,
    totalText: formatMoney(total, currencies, cartCurrency),
    balanceText: formatMoney(balance, currencies, cartCurrency),
    enough,
    shortText: enough ? "" : formatMoney(total - balance, currencies, cartCurrency),
    canBuy: lines.length > 0 && enough && route.ok && !s.busy
  };

  // Entregas.
  out.orders = orderViews(actor, dayLength);
  out.hasTransit = out.orders.some(o => o.state === "transit");

  out.tabs = TABS.map(t => ({ ...t, on: t.id === s.tab && !out.product, badge: t.id === "cart" ? out.cart.count : 0 }));
  out.isHome = s.tab === "home" && !out.product;
  out.isShops = s.tab === "shops" && !out.product;
  out.isCart = s.tab === "cart" && !out.product;
  out.isOrders = s.tab === "orders" && !out.product;
  return out;
}

/** Procura a linha do catálogo de uma chave `shopId|itemId` (para pegar o uuid da loja ao adicionar). */
function lineFor(key) {
  const [shopId, itemId] = String(key).split("|");
  const shop = game.actors.get(shopId);
  return shop ? { shopUuid: shop.uuid, itemId } : null;
}

/** As ações do app (entram em `actions` do PAD; `this` é o PAD). */
export const PAD_SHOP_ACTIONS = {
  padShopTab(event, target) {
    event.preventDefault();
    const s = stateOf(this);
    s.tab = target.dataset.tab || "home";
    s.product = "";
    if (s.tab === "home") s.shopId = "";
    this.render();
  },

  padShopCat(event, target) {
    event.preventDefault();
    stateOf(this).cat = target.dataset.cat || "Todos";
    this.render();
  },

  padShopOpenShop(event, target) {
    event.preventDefault();
    const s = stateOf(this);
    s.shopId = target.dataset.shopId || "";
    s.cat = "Todos";
    s.tab = "home";
    this.render();
  },

  padShopClearShop(event) {
    event.preventDefault();
    stateOf(this).shopId = "";
    this.render();
  },

  padShopProduct(event, target) {
    event.preventDefault();
    const s = stateOf(this);
    s.product = target.dataset.key || "";
    s.qty = 1;
    this.render();
  },

  padShopCloseProduct(event) {
    event.preventDefault();
    stateOf(this).product = "";
    this.render();
  },

  padShopQty(event, target) {
    event.preventDefault();
    const s = stateOf(this);
    s.qty = Math.max(1, Math.min(999, s.qty + (Number(target.dataset.delta) || 0)));
    this.render();
  },

  padShopAdd(event) {
    event.preventDefault();
    const s = stateOf(this);
    const line = lineFor(s.product);
    if (!line) return;
    s.cart = cartChange(s.cart, line, s.qty);
    ui.notifications.info("Adicionado ao carrinho.");
    s.product = "";
    s.qty = 1;
    s.tab = "cart";
    this.render();
  },

  padShopStep(event, target) {
    event.preventDefault();
    const line = lineFor(target.dataset.key);
    if (!line) return;
    const s = stateOf(this);
    s.cart = cartChange(s.cart, line, Number(target.dataset.delta) || 0);
    this.render();
  },

  padShopRetry(event) {
    event.preventDefault();
    this.render();
  },

  async padShopBuy(event) {
    event.preventDefault();
    const s = stateOf(this);
    if (s.busy || !s.cart.length) return;
    s.busy = true;
    try {
      const outcome = await askOrder({ buyer: this.actor, lines: s.cart.map(l => ({ shopUuid: l.shopUuid, itemId: l.itemId, qty: l.qty })), destination: s.dest });
      if (outcome?.ok) {
        s.cart = [];
        s.tab = "orders";
        ui.notifications.info("Compra feita. Acompanhe em Entregas.");
      }
    } catch (err) {
      reportError("Falha ao comprar pelo PAD.", err);
    } finally {
      s.busy = false;
      this.render();
    }
  }
};

/** Ouvintes do app depois de cada desenho: busca (esconde cards sem redesenhar) e o destino escolhido. */
export function bindPadShop(app) {
  const s = stateOf(app);
  const root = app.element;
  const search = root.querySelector(".pad-sp-search-input");
  if (search) {
    const apply = () => {
      s.search = search.value;
      const q = search.value.trim().toLowerCase();
      root.querySelectorAll(".pad-sp-card").forEach(card => {
        card.hidden = q.length > 0 && !card.dataset.search.includes(q);
      });
    };
    search.value = s.search ?? "";
    search.addEventListener("input", apply);
    apply();
  }
  root.querySelectorAll("input[name='pad-sp-dest']").forEach(input => {
    input.addEventListener("change", () => {
      s.dest = input.value;
      app.render();
    });
  });
}
