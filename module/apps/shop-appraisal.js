/**
 * Avaliação do Mestre (G2, lote A; mockup aprovado: quadro 5 "Pedir avaliação"): quando um jogador
 * quer vender a um vendedor NPC, o Mestre vê cada item com o preço padrão, põe o valor de cada um
 * e a oferta total, e os dois confirmam. Mexer numa linha refaz o total; mexer no total não mexe
 * nas linhas. Um pedido por vez na fila; vários jogadores viram várias linhas.
 *
 * O estado da troca (dois lados, itens e moedas, aceite de cada um) é o `newTrade` genérico de
 * `shop-rules.js`, guardado nos flags da loja; esta janela é só o lado do Mestre. A mesma máquina
 * de estados serve, no lote B, à troca entre dois jogadores.
 */
import { SYSTEM_ID, getActiveCurrencies } from "../core/config.js";
import { shopOf, readTrades, sellValue, askTrade, OPEN_SHOP_APPS } from "../economy/shops.js";
import {
  appraisalSuggestion, fromUnits, toUnits, formatMoney, formatNumber, walletUnits
} from "../economy/shop-rules.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const appId = shop => `nihility-appraisal-${shop.uuid.replace(/[^a-zA-Z0-9]/g, "-")}`;

/** Abre (ou traz para a frente) a janela de avaliações desta loja. Só o Mestre. */
export function openAppraisal(shop) {
  if (!game.user.isGM) return null;
  const existing = foundry.applications.instances?.get(appId(shop));
  if (existing) {
    existing.render({ force: true });
    existing.bringToFront?.();
    return existing;
  }
  return new ShopAppraisalApp(shop).render({ force: true });
}

export class ShopAppraisalApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(shop, options = {}) {
    super({ id: appId(shop), ...options });
    this.shop = shop;
    this.sel = "";
    /** Estado de tela por pedido: `{pct, values: {itemId: unidades}, total, currency}` (nada é salvo). */
    this.local = new Map();
    /** A fração sugerida escolhida por pedido ("Reaplicar"); sem ela vale a da loja. */
    this.pctFor = new Map();
  }

  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-shop-app", "nihility-appraisal"],
    window: { title: "Avaliação", resizable: true },
    position: { width: 860, height: 640 },
    actions: {
      pickTrade: ShopAppraisalApp.#onPick,
      reapply: ShopAppraisalApp.#onReapply,
      offer: ShopAppraisalApp.#onOffer,
      refuseTrade: ShopAppraisalApp.#onRefuse,
      closeTrade: ShopAppraisalApp.#onClose
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/shop-appraisal.hbs`, scrollable: [".nsh-appraisal-scroll"] }
  };

  get title() {
    return `Avaliação — ${this.shop.name}`;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    OPEN_SHOP_APPS.add(this);
  }

  _onClose(options) {
    super._onClose?.(options);
    OPEN_SHOP_APPS.delete(this);
  }

  /** Estado local do pedido, criado com a sugestão (preço padrão × fração) na primeira vez. */
  #localFor(trade, lines, cfg, currencies) {
    let local = this.local.get(trade.id);
    if (!local) {
      const pct = this.pctFor.get(trade.id) ?? Math.round(cfg.buybackFraction * 100);
      const sug = appraisalSuggestion(lines.map(l => l.stdUnits), pct / 100);
      local = {
        pct,
        values: Object.fromEntries(lines.map((l, i) => [l.id, sug.values[i]])),
        total: sug.total,
        currency: trade.b?.coins?.currency || lines[0]?.currencyId || currencies[0]?.id || ""
      };
      this.local.set(trade.id, local);
    }
    return local;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const shop = this.shop;
    const cfg = shopOf(shop);
    const currencies = getActiveCurrencies();
    const trades = readTrades(shop).filter(t => t.status === "open");
    if (!trades.some(t => t.id === this.sel)) this.sel = trades[0]?.id ?? "";
    const trade = trades.find(t => t.id === this.sel) ?? null;
    context.shopName = shop.name;
    context.queue = trades.map(t => ({ id: t.id, text: `${t.sellerName} → ${shop.name} · ${t.a.items.length} ${t.a.items.length === 1 ? "item" : "itens"}`, on: t.id === this.sel }));
    context.hasTrade = Boolean(trade);
    context.fundsText = cfg.limitedFunds ? `Moedas do vendedor: ${formatMoney(walletUnits(shop.system.currencies, currencies), currencies) || "0"} (limitadas)` : "Moedas do vendedor: sem limite";
    if (!trade) return context;
    const seller = await fromUuid(trade.sellerUuid);
    context.sellerName = trade.sellerName;
    context.sellerFunds = seller ? formatMoney(walletUnits(seller.system.currencies, currencies), currencies) || "0" : "—";
    // Linhas: o que o jogador pôs; um item que já não está com ele aparece riscado e vale 0.
    const lines = trade.a.items.map(entry => {
      const item = seller?.items.get(entry.id) ?? null;
      const value = item ? sellValue(item, entry.qty, cfg.buybackFraction, currencies) : null;
      return {
        id: entry.id,
        name: item?.name ?? "(item sumiu)",
        img: item?.img ?? "",
        qty: entry.qty,
        missing: !item,
        stdUnits: value?.stdUnits ?? 0,
        currencyId: value?.currencyId ?? currencies[0]?.id ?? ""
      };
    });
    const local = this.#localFor(trade, lines, cfg, currencies);
    const cur = local.currency;
    const sumStd = lines.reduce((a, l) => a + l.stdUnits, 0);
    const sumSug = appraisalSuggestion(lines.map(l => l.stdUnits), local.pct / 100).total;
    context.pct = local.pct;
    context.rows = lines.map(l => {
      const own = local.values[l.id] ?? 0;
      const sug = Math.round(l.stdUnits * (local.pct / 100));
      return {
        id: l.id,
        name: l.name,
        img: l.img,
        qty: l.qty,
        missing: l.missing,
        stdText: l.missing ? "—" : `${formatNumber(fromUnits(l.stdUnits, l.currencyId, currencies))} ${currencies.find(c => c.id === l.currencyId)?.label ?? ""}`,
        value: String(fromUnits(own, cur, currencies)),
        changed: own !== sug
      };
    });
    context.sumText = `Soma do padrão: ${formatMoney(sumStd, currencies, cur) || "0"} · soma sugerida: ${formatMoney(sumSug, currencies, cur) || "0"}`;
    context.total = fromUnits(local.total, cur, currencies);
    context.currencyOptions = currencies.map(c => ({ id: c.id, label: c.label, selected: c.id === cur }));
    context.offerLabel = `Oferecer ${formatMoney(local.total, currencies, cur) || "0"}`;
    context.offered = Boolean(trade.b?.coins && trade.accepted?.b);
    context.playerAccepted = Boolean(trade.accepted?.a);
    context.offerNote = trade.b?.coins ? `Oferta em aberto: ${formatMoney(toUnits(trade.b.coins.amount, trade.b.coins.currency, currencies), currencies, trade.b.coins.currency)}. ${trade.accepted?.a ? "O jogador aceitou." : "Aguardando o jogador."}` : "";
    context.note = trade.text || "";
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const trade = readTrades(this.shop).find(t => t.id === this.sel);
    const local = trade ? this.local.get(trade.id) : null;
    if (!local) return;
    const currencies = getActiveCurrencies();
    const parse = raw => {
      const n = Number(String(raw).replace(",", "."));
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };
    this.element.querySelectorAll("[data-line]").forEach(input =>
      input.addEventListener("change", () => {
        local.values[input.dataset.line] = toUnits(parse(input.value), local.currency, currencies);
        local.total = Object.values(local.values).reduce((a, b) => a + b, 0);
        this.render();
      })
    );
    this.element.querySelector("[data-total]")?.addEventListener("change", event => {
      local.total = toUnits(parse(event.currentTarget.value), local.currency, currencies);
      this.render();
    });
    this.element.querySelector("[data-currency]")?.addEventListener("change", event => {
      local.currency = event.currentTarget.value;
      this.render();
    });
    this.element.querySelector("[data-pct]")?.addEventListener("change", event => {
      local.pct = Math.min(100, Math.max(0, Number(event.currentTarget.value) || 0));
    });
  }

  static #onPick(event, target) {
    this.sel = target.dataset.tradeId ?? "";
    this.render();
  }

  /** "Reaplicar": refaz as linhas e o total a partir da fração sugerida. */
  static #onReapply() {
    const trade = readTrades(this.shop).find(t => t.id === this.sel);
    if (!trade) return;
    const pct = Number(this.element.querySelector("[data-pct]")?.value);
    if (Number.isFinite(pct)) this.pctFor.set(trade.id, Math.min(100, Math.max(0, pct)));
    this.local.delete(trade.id);
    this.render();
  }

  static async #onOffer() {
    const trade = readTrades(this.shop).find(t => t.id === this.sel);
    const local = trade ? this.local.get(trade.id) : null;
    if (!trade || !local) return;
    const currencies = getActiveCurrencies();
    const outcome = await askTrade("offer", { shop: this.shop, tradeId: trade.id, amount: fromUnits(local.total, local.currency, currencies), currency: local.currency });
    if (outcome?.ok) ui.notifications.info("Oferta enviada ao jogador.");
  }

  static async #onRefuse() {
    const trade = readTrades(this.shop).find(t => t.id === this.sel);
    if (trade) await askTrade("refuse", { shop: this.shop, tradeId: trade.id });
  }

  static async #onClose() {
    const trade = readTrades(this.shop).find(t => t.id === this.sel);
    if (trade) await askTrade("close", { shop: this.shop, tradeId: trade.id });
  }
}
