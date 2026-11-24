/**
 * Vitrine da loja (G2, lote A; mockup aprovado: quadro 4): o jogador compra e vende. Comprar sai
 * na hora (o Mestre designado confere o preço e move item e moedas). Vender: num ponto automático
 * vende direto pela fração; num vendedor NPC o botão é "Pedir avaliação" e o Mestre faz a oferta
 * (a janela de avaliação é `shop-appraisal.js`; o estado da troca mora nos flags da loja).
 *
 * Só lê documentos e pede ações: o preço que aparece aqui é o mesmo que o Mestre recalcula.
 */
import { SYSTEM_ID, getActiveCurrencies, sameActor } from "../core/config.js";
import { actorsOwnedBy } from "../helpers/gm-relay.js";
import { findCrewedShipsForActor } from "../pad/pad-crew.js";
import {
  shopOf, isShopActor, shopStockItems, shopListing, priceText, sellCandidates, itemSellBlock, sellValue, readTrades, askBuy,
  askSell, askTrade, OPEN_SHOP_APPS
} from "../economy/shops.js";
import { shopCategories, rowMatches, formatMoney, walletUnits, toUnits, formatNumber, itemKind, SHOP_KIND_LABELS } from "../economy/shop-rules.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const appId = shop => `nihility-shop-${shop.uuid.replace(/[^a-zA-Z0-9]/g, "-")}`;
const plain = html => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** Quem pode comprar/vender aqui: o personagem do jogador (ou o que o Mestre estiver controlando). */
export function buyerCandidates(shop) {
  const notShop = a => a?.type === "character" && !sameActor(a, shop) && !shopOf(a).enabled;
  if (game.user.isGM) {
    const controlled = (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(notShop);
    const rest = game.actors.filter(a => notShop(a) && a.system.isPlayerCharacter);
    return [...new Set([...controlled, ...rest])];
  }
  const own = actorsOwnedBy(game.user).filter(notShop);
  const main = game.user.character;
  return main && own.includes(main) ? [main, ...own.filter(a => a !== main)] : own;
}

export class ShopStorefrontApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(shop, options = {}) {
    super({ id: appId(shop), ...options });
    this.shop = shop;
    this.state = { tab: "buy", cat: "Todos", search: "", sel: "", buyQ: {}, sellQ: {}, buyerUuid: options.buyerUuid ?? "", dest: "" };
  }

  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-shop-app"],
    window: { title: "Loja", resizable: true },
    position: { width: 900, height: 780 },
    actions: {
      goTab: ShopStorefrontApp.#onTab,
      pickCat: ShopStorefrontApp.#onCat,
      selectRow: ShopStorefrontApp.#onSelect,
      qtyStep: ShopStorefrontApp.#onQtyStep,
      buyRow: ShopStorefrontApp.#onBuyRow,
      buySelected: ShopStorefrontApp.#onBuySelected,
      sellMarked: ShopStorefrontApp.#onSellMarked,
      acceptOffer: ShopStorefrontApp.#onAccept,
      refuseOffer: ShopStorefrontApp.#onRefuse,
      closeTrade: ShopStorefrontApp.#onCloseTrade
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/shop-storefront.hbs`, scrollable: [".nsh-list"] }
  };

  /** Abre (ou traz para a frente) a vitrine desta loja. */
  static open(shop, { asGm = false, buyerUuid = "" } = {}) {
    const existing = foundry.applications.instances?.get(appId(shop));
    if (existing) {
      existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    return new ShopStorefrontApp(shop, { buyerUuid, asGm }).render({ force: true });
  }

  get title() {
    return this.shop.name;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    OPEN_SHOP_APPS.add(this);
  }

  _onClose(options) {
    super._onClose?.(options);
    OPEN_SHOP_APPS.delete(this);
  }

  #buyer() {
    const list = buyerCandidates(this.shop);
    const chosen = list.find(a => a.uuid === this.state.buyerUuid);
    return chosen ?? list[0] ?? null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const shop = this.shop;
    const s = this.state;
    const currencies = getActiveCurrencies();
    context.closed = !isShopActor(shop);
    context.shopName = shop.name;
    context.shopImg = shop.img;
    context.initial = (shop.name ?? "?").trim().charAt(0).toUpperCase();
    if (context.closed) return context;

    const cfg = shopOf(shop);
    const buyer = this.#buyer();
    const candidates = buyerCandidates(shop);
    context.hasBuyer = Boolean(buyer);
    context.buyerOptions = candidates.length > 1 ? candidates.map(a => ({ value: a.uuid, label: a.name, selected: a.uuid === buyer?.uuid })) : null;
    if (!buyer) return context;
    s.buyerUuid = buyer.uuid;
    context.buyerName = buyer.name;
    context.balanceText = formatMoney(walletUnits(buyer.system.currencies, currencies), currencies) || "0";
    context.isBuy = s.tab === "buy";
    context.isSell = s.tab === "sell";
    const vendor = cfg.kind === "vendor";
    context.modeLine = vendor
      ? `${SHOP_KIND_LABELS.vendor}: ${shop.name} define quanto paga pelo que você vende.`
      : `Ponto automático: compra de volta por ${Math.round(cfg.buybackFraction * 100)}% do preço padrão.`;

    // O que dá para comprar (todos) e o que o jogador pode vender.
    const buyAll = shopStockItems(shop).map(item => ({ item, row: shopListing(shop, item, cfg, currencies) }));
    const sellAll = sellCandidates(buyer).map(item => {
      const block = itemSellBlock(buyer, item);
      const one = sellValue(item, 1, cfg.buybackFraction, currencies);
      return {
        item,
        row: {
          id: item.id,
          name: item.name,
          img: item.img,
          kind: itemKind(item),
          tags: [],
          description: `Você tem ${Number(item.system.quantity) || 0}`,
          detail: plain(item.system.description).slice(0, 220),
          have: Number(item.system.quantity) || 0,
          block,
          unitText: vendor ? "a avaliar" : priceText(one.buyUnits, one.currencyId, currencies)
        }
      };
    });
    const source = context.isBuy ? buyAll : sellAll;
    const cats = shopCategories(source.map(e => e.row));
    if (!cats.includes(s.cat)) s.cat = "Todos";
    context.cats = cats.map(name => ({ name, on: name === s.cat }));
    const shown = source.filter(e => rowMatches(e.row, { category: s.cat, search: "" })).sort((a, b) => a.row.name.localeCompare(b.row.name));
    if (!shown.some(e => e.row.id === s.sel)) s.sel = shown[0]?.row.id ?? "";

    if (context.isBuy) {
      context.rows = shown.map(({ row }) => {
        const q = Math.max(1, s.buyQ[row.id] ?? 1);
        return {
          id: row.id,
          name: row.name,
          img: row.img,
          desc: row.description || row.kind,
          stockText: row.soldOut ? "esgotado" : `estoque ${row.stockText}`,
          priceText: priceText(row.unitUnits, row.currencyId, currencies),
          qty: q,
          sel: row.id === s.sel,
          disabled: row.soldOut,
          actLabel: row.soldOut ? "Esgotado" : "Comprar"
        };
      });
      const cur = shown.find(e => e.row.id === s.sel)?.row ?? null;
      if (cur) {
        const q = Math.max(1, s.buyQ[cur.id] ?? 1);
        context.detail = {
          name: cur.name,
          img: cur.img,
          desc: plain(buyAll.find(e => e.row.id === cur.id)?.item.system.description).slice(0, 220) || cur.kind,
          facts: this.#facts(buyAll.find(e => e.row.id === cur.id)?.item),
          price: priceText(cur.unitUnits, cur.currencyId, currencies)
        };
        context.bottom = {
          label: cur.soldOut ? "Esgotado" : `Comprar ${q}× ${cur.name} · ${priceText(cur.unitUnits * q, cur.currencyId, currencies)}`,
          disabled: cur.soldOut,
          action: "buySelected"
        };
      } else context.bottom = { label: "Nada à venda", disabled: true, action: "buySelected" };
      // Entregar no inventário ou no porão de uma nave de que o personagem é tripulante.
      const ships = findCrewedShipsForActor(buyer);
      context.destOptions = ships.length
        ? [{ value: "", label: "Meu inventário", selected: !s.dest }, ...ships.map(sh => ({ value: sh.uuid, label: `Porão: ${sh.name}`, selected: s.dest === sh.uuid }))]
        : null;
      context.footer = "Pago em qualquer moeda, convertida. Compra sai na hora.";
    } else {
      context.rows = shown.map(({ row }) => {
        const q = Math.min(row.have, Math.max(0, s.sellQ[row.id] ?? 0));
        return {
          id: row.id,
          name: row.name,
          img: row.img,
          desc: row.block ? `${row.description} · ${row.block}` : row.description,
          stockText: "",
          priceText: row.unitText,
          qty: q,
          sel: row.id === s.sel,
          disabled: Boolean(row.block),
          actLabel: row.block ? "Bloqueado" : q > 0 ? "Marcado" : "—"
        };
      });
      const cur = shown.find(e => e.row.id === s.sel)?.row ?? null;
      context.detail = cur
        ? { name: cur.name, img: cur.img, desc: cur.detail || cur.kind, facts: this.#facts(sellAll.find(e => e.row.id === cur.id)?.item), price: cur.unitText }
        : null;
      const marked = this.#marked(buyer);
      const total = marked.reduce((sum, m) => sum + sellValue(m.item, m.qty, cfg.buybackFraction, currencies).buyUnits, 0);
      const count = marked.reduce((sum, m) => sum + m.qty, 0);
      const trade = readTrades(shop).find(t => t.sellerUuid === buyer.uuid) ?? null;
      const waiting = trade?.status === "open";
      context.bottom = vendor
        ? { label: waiting ? "Pedido em avaliação" : `Pedir avaliação (${count} ${count === 1 ? "item" : "itens"})`, disabled: waiting || count === 0, action: "sellMarked" }
        : { label: `Vender marcados (+${formatMoney(total, currencies, currencies[0]?.id)})`, disabled: count === 0, action: "sellMarked" };
      context.footer = vendor ? "Você não vê o preço: o Mestre avalia e faz uma oferta." : "Sem Mestre: venda direta pela fração.";
      context.banner = trade ? this.#banner(trade, currencies) : null;
    }
    return context;
  }

  /** Linha de fatos do Item (peso, dano, uso) para o painel de detalhe. */
  #facts(item) {
    if (!item) return "";
    const sys = item.system;
    const facts = [];
    if (sys.weapon?.enabled && sys.weapon.damageFormula) facts.push(`Dano ${sys.weapon.damageFormula}`);
    if (sys.consumable?.enabled) facts.push(sys.consumable.charges > 1 ? `Consumível · ${sys.consumable.charges} cargas` : "Consumível");
    if (sys.ammo?.enabled) facts.push("Munição");
    if (sys.container?.enabled) facts.push(`Contêiner · ${sys.container.slots} slots`);
    if (Number(sys.weight) > 0) facts.push(`${formatNumber(sys.weight)} kg`);
    return facts.join(" · ");
  }

  /** Os itens marcados para vender: `{item, qty}`. */
  #marked(buyer) {
    const out = [];
    for (const [id, qty] of Object.entries(this.state.sellQ)) {
      const item = buyer.items.get(id);
      if (!item || qty < 1 || itemSellBlock(buyer, item)) continue;
      out.push({ item, qty: Math.min(qty, Number(item.system.quantity) || 0) });
    }
    return out.filter(m => m.qty > 0);
  }

  /** O aviso da avaliação para o jogador: aguardando, oferta, mudou, feita ou recusada. */
  #banner(trade, currencies) {
    const names = trade.a.items.length;
    if (trade.status === "done") return { cls: "k", text: trade.text, actions: [{ action: "closeTrade", label: "OK" }] };
    if (trade.status === "refused") return { cls: "d", text: trade.text || "Recusado. Nada foi vendido.", actions: [{ action: "closeTrade", label: "OK" }] };
    const offer = trade.b?.coins;
    if (!offer || !trade.accepted?.b) {
      return { cls: "i", text: `Pedido enviado. Aguardando a avaliação de ${this.shop.name}…`, actions: [{ action: "refuseOffer", label: "Cancelar pedido" }] };
    }
    const value = formatMoney(toUnits(offer.amount, offer.currency, currencies), currencies, offer.currency);
    const text = trade.offerChanged
      ? `${this.shop.name} mudou o valor para ${value}. O aceite anterior caiu; aceite de novo se concordar.`
      : `${this.shop.name} oferece ${value} pelos ${names} ${names === 1 ? "item marcado" : "itens marcados"}.`;
    return {
      cls: trade.offerChanged ? "w" : "k",
      text: trade.text ? `${text} (${trade.text})` : text,
      actions: [{ action: "acceptOffer", label: "Aceitar", primary: true }, { action: "refuseOffer", label: "Recusar" }]
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    root.querySelector("[data-buyer]")?.addEventListener("change", event => {
      this.state.buyerUuid = event.currentTarget.value;
      this.state.sel = "";
      this.state.sellQ = {};
      this.render();
    });
    root.querySelector("[data-dest]")?.addEventListener("change", event => {
      this.state.dest = event.currentTarget.value;
    });
    const search = root.querySelector("[data-search]");
    if (search) {
      const apply = () => {
        this.state.search = search.value;
        root.querySelectorAll("[data-row]").forEach(row => {
          row.hidden = !rowMatches({ name: row.dataset.name, kind: "Todos" }, { category: "Todos", search: this.state.search });
        });
      };
      search.value = this.state.search;
      search.addEventListener("input", apply);
      apply();
    }
  }

  /* ------------------------------------------------------------------ Ações */

  static #onTab(event, target) {
    this.state.tab = target.dataset.tab === "sell" ? "sell" : "buy";
    this.state.cat = "Todos";
    this.state.sel = "";
    this.render();
  }

  static #onCat(event, target) {
    this.state.cat = target.dataset.cat || "Todos";
    this.render();
  }

  static #onSelect(event, target) {
    if (event.target.closest("button, input, select")) return;
    this.state.sel = target.closest("[data-item-id]")?.dataset.itemId ?? "";
    this.render();
  }

  static #onQtyStep(event, target) {
    event.stopPropagation();
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    if (!id) return;
    const dir = Number(target.dataset.dir) || 0;
    const key = this.state.tab === "buy" ? "buyQ" : "sellQ";
    const buyer = this.#buyer();
    const max = key === "sellQ" ? Number(buyer?.items.get(id)?.system.quantity) || 0 : 999;
    const min = key === "buyQ" ? 1 : 0;
    const now = this.state[key][id] ?? (key === "buyQ" ? 1 : 0);
    this.state[key][id] = Math.min(max, Math.max(min, now + dir));
    this.render();
  }

  async #buy(itemId) {
    const buyer = this.#buyer();
    if (!buyer || !itemId) return;
    const quantity = Math.max(1, this.state.buyQ[itemId] ?? 1);
    const destination = this.state.dest ? await fromUuid(this.state.dest) : null;
    const outcome = await askBuy({ shop: this.shop, buyer, itemId, quantity, destination });
    if (outcome?.ok) this.state.buyQ[itemId] = 1;
    this.render();
  }

  static #onBuyRow(event, target) {
    event.stopPropagation();
    return this.#buy(target.closest("[data-item-id]")?.dataset.itemId);
  }

  static #onBuySelected() {
    return this.#buy(this.state.sel);
  }

  static async #onSellMarked() {
    const buyer = this.#buyer();
    if (!buyer) return;
    const items = this.#marked(buyer).map(m => ({ id: m.item.id, qty: m.qty }));
    if (!items.length) return;
    const vendor = shopOf(this.shop).kind === "vendor";
    const outcome = vendor ? await askTrade("open", { shop: this.shop, seller: buyer, items }) : await askSell({ shop: this.shop, seller: buyer, items });
    if (outcome?.ok && !vendor) this.state.sellQ = {};
    this.render();
  }

  #trade() {
    const buyer = this.#buyer();
    return buyer ? readTrades(this.shop).find(t => t.sellerUuid === buyer.uuid) ?? null : null;
  }

  static async #onAccept() {
    const trade = this.#trade();
    if (!trade) return;
    const outcome = await askTrade("accept", { shop: this.shop, tradeId: trade.id });
    if (outcome?.ok) this.state.sellQ = {};
  }

  static async #onRefuse() {
    const trade = this.#trade();
    if (trade) await askTrade("refuse", { shop: this.shop, tradeId: trade.id });
  }

  static async #onCloseTrade() {
    const trade = this.#trade();
    if (trade) await askTrade("close", { shop: this.shop, tradeId: trade.id });
  }
}
