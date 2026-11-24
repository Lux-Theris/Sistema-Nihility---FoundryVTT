/**
 * Máquina de venda automática (G2 Lojas, lote B; mockup aprovado: quadro 6). Uma loja `auto` com
 * `style: "machine"` abre assim: vitrine de vidro com 16 produtos por prateleira (A, B, C…), código
 * (A03), teclado e display. O motor de compra é o MESMO da Vitrine (`askBuy` → relay `shopBuy`): o
 * Mestre confere preço, estoque e saldo. A máquina não compra de volta.
 *
 * A "gaveta" é só visual: o item entra no inventário na hora da compra; o produto "cai" na bandeja
 * e some quando o jogador aperta PEGAR (nada fica preso).
 */
import { SYSTEM_ID, getActiveCurrencies } from "../core/config.js";
import { isShopActor, shopOf, shopStockItems, shopListing, priceText, askBuy, OPEN_SHOP_APPS } from "../economy/shops.js";
import { formatMoney, walletUnits } from "../economy/shop-rules.js";
import { machineLayout, machinePageCount, machinePageLetter, machineFind, machinePress, machineColor, MACHINE_PER_PAGE } from "../economy/loot-rules.js";
import { buyerCandidates } from "./shop-storefront.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const appId = shop => `nihility-machine-${shop.uuid.replace(/[^a-zA-Z0-9]/g, "-")}`;

export class ShopMachineApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(shop, options = {}) {
    super({ id: appId(shop), ...options });
    this.shop = shop;
    this.tokenUuid = options.tokenUuid ?? "";
    this.ui = { page: 0, picked: "", typed: "", msg: "", tray: [], buyerUuid: options.buyerUuid ?? "", busy: false };
  }

  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-shop-app", "nihility-machine-app"],
    window: { title: "Máquina de venda", resizable: false },
    position: { width: 800, height: "auto" },
    actions: {
      pageStep: ShopMachineApp.#onPage,
      pickSlot: ShopMachineApp.#onPick,
      pressKey: ShopMachineApp.#onKey,
      buyPicked: ShopMachineApp.#onBuy,
      takeTray: ShopMachineApp.#onTake
    }
  };

  static PARTS = { body: { template: `systems/${SYSTEM_ID}/templates/apps/shop-machine.hbs` } };

  static open(shop, { buyerUuid = "", tokenUuid = "" } = {}) {
    const existing = foundry.applications.instances?.get(appId(shop));
    if (existing) {
      existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    return new ShopMachineApp(shop, { buyerUuid, tokenUuid }).render({ force: true });
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
    return list.find(a => a.uuid === this.ui.buyerUuid) ?? list[0] ?? null;
  }

  #layout() {
    return machineLayout(shopStockItems(this.shop).map(item => ({ id: item.id, name: item.name, item })));
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const s = this.ui;
    const currencies = getActiveCurrencies();
    context.closed = !isShopActor(this.shop);
    context.shopName = this.shop.name;
    if (context.closed) return context;
    const cfg = shopOf(this.shop);
    const buyer = this.#buyer();
    context.hasBuyer = Boolean(buyer);
    if (buyer) s.buyerUuid = buyer.uuid;
    const candidates = buyerCandidates(this.shop);
    context.buyerOptions = candidates.length > 1 ? candidates.map(a => ({ value: a.uuid, label: a.name, selected: a.uuid === buyer?.uuid })) : null;

    const layout = this.#layout().map(e => ({ ...e, listing: shopListing(this.shop, e.item, cfg, currencies) }));
    const pages = machinePageCount(layout.length);
    s.page = Math.min(Math.max(0, s.page), pages - 1);
    const picked = layout.find(e => e.code === s.picked) ?? null;
    context.pageLetter = machinePageLetter(s.page);
    context.pageNo = s.page + 1;
    context.pageCount = pages;
    context.slots = layout
      .filter(e => e.page === s.page)
      .map(e => ({
        code: e.code,
        name: e.name,
        img: e.item.img,
        color: machineColor(e.name),
        price: priceText(e.listing.unitUnits, e.listing.currencyId, currencies),
        out: e.listing.soldOut,
        sel: e.code === s.picked
      }));
    context.emptySlots = Array.from({ length: Math.max(0, MACHINE_PER_PAGE - context.slots.length) });

    const balance = buyer ? walletUnits(buyer.system.currencies, currencies) : 0;
    const short = Boolean(picked) && !picked.listing.soldOut && balance < picked.listing.unitUnits;
    context.line1 = s.msg || (picked ? `${picked.code} · ${picked.name}` : s.typed ? `Código: ${s.typed}` : "Escolha um produto");
    context.line2 = picked ? priceText(picked.listing.unitUnits, picked.listing.currencyId, currencies) : "--";
    context.line3 = short ? "SALDO INSUFICIENTE" : `Saldo ${formatMoney(balance, currencies) || "0"}`;
    context.cantBuy = !picked || picked.listing.soldOut || short || s.busy || !buyer;
    context.keys = [
      ...["A", "B", "C", "D"].map(k => ({ label: k, cls: "pg", key: k })),
      ...["1", "2", "3", "4", "5", "6", "7", "8"].map(k => ({ label: k, cls: "", key: k })),
      { label: "↺", cls: "", key: "clear" },
      { label: "9", cls: "", key: "9" },
      { label: "0", cls: "", key: "0" }
    ];
    context.tray = s.tray.map(t => ({ ...t }));
    context.hasTray = s.tray.length > 0;
    context.trayCount = s.tray.length;
    // A animação de queda toca só na renderização em que o produto chegou.
    s.tray.forEach(t => (t.fresh = false));
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector("[data-buyer]")?.addEventListener("change", event => {
      this.ui.buyerUuid = event.currentTarget.value;
      this.render();
    });
  }

  static #onPage(event, target) {
    const pages = machinePageCount(shopStockItems(this.shop).length);
    this.ui.page = (this.ui.page + (Number(target.dataset.dir) || 1) + pages) % pages;
    this.render();
  }

  static #onPick(event, target) {
    this.ui.picked = target.dataset.code;
    this.ui.typed = "";
    this.ui.msg = "";
    this.render();
  }

  static #onKey(event, target) {
    const s = this.ui;
    s.typed = machinePress(s.typed, target.dataset.key);
    s.msg = "";
    const layout = this.#layout();
    if (/^[A-Z]$/.test(s.typed)) s.page = Math.min(s.typed.charCodeAt(0) - 65, machinePageCount(layout.length) - 1);
    const hit = machineFind(layout, s.typed);
    if (hit) {
      s.picked = hit.code;
      s.page = hit.page;
    } else if (s.typed.length >= 3) s.msg = `Sem produto ${s.typed}`;
    this.render();
  }

  static async #onBuy() {
    const s = this.ui;
    const buyer = this.#buyer();
    const picked = this.#layout().find(e => e.code === s.picked);
    if (!buyer || !picked) return;
    s.busy = true;
    const outcome = await askBuy({ shop: this.shop, buyer, itemId: picked.id, quantity: 1, tokenUuid: this.tokenUuid });
    s.busy = false;
    if (outcome?.ok) {
      s.tray.push({ name: picked.name, img: picked.item.img, color: machineColor(picked.name), fresh: true });
      s.msg = `Comprado: ${picked.name}`;
      s.picked = "";
      s.typed = "";
    } else s.msg = "Não deu: veja o aviso";
    this.render();
  }

  static #onTake() {
    this.ui.tray = [];
    this.ui.msg = "Retirado da gaveta";
    this.render();
  }
}
