/**
 * Janela da troca entre jogadores (G2 Lojas, lote B; mockup 7): "Você oferece" (editável) | meio com os
 * aceites | "{Fulano} oferece" (só leitura). Cada lado põe itens e moedas do PRÓPRIO personagem; os
 * dois aceitam; qualquer mudança depois de um aceite apaga os dois. Nada é executado aqui: tudo vai
 * pelo relay `playerTrade` e o Mestre revalida.
 */
import { SYSTEM_ID, getActiveCurrencies, getShopLootRange } from "../core/config.js";
import { sellCandidates, itemSellBlock, OPEN_SHOP_APPS } from "../economy/shops.js";
import { fromUnits, toUnits, formatMoney, normalizeTradeItems } from "../economy/shop-rules.js";
import { tradeBanner, otherSide, metersText } from "../economy/loot-rules.js";
import { readPlayerTrades, askPlayerTrade, mySideOf } from "../economy/player-trade.js";
import { distanceBetweenActors } from "../economy/token-geometry.js";
import { machineColor } from "../economy/loot-rules.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const appId = tradeId => `nihility-player-trade-${tradeId}`;

export class PlayerTradeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(tradeId, side, options = {}) {
    super({ id: appId(tradeId), ...options });
    this.tradeId = tradeId;
    this.side = side;
  }

  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-shop-app", "nihility-player-trade"],
    window: { title: "Troca", resizable: true },
    position: { width: 900, height: 640 },
    actions: {
      addItem: PlayerTradeApp.#onAddItem,
      removeItem: PlayerTradeApp.#onRemoveItem,
      acceptTrade: PlayerTradeApp.#onAccept,
      cancelTrade: PlayerTradeApp.#onCancel,
      closeTrade: PlayerTradeApp.#onClose
    }
  };

  static PARTS = { body: { template: `systems/${SYSTEM_ID}/templates/apps/player-trade.hbs`, scrollable: [".nsh-pan-list"] } };

  /** Abre (ou traz para a frente) a janela de uma troca. `side` vazio = descobre pelo dono (o Mestre vê como "a"). */
  static open(tradeId, side = "") {
    const existing = foundry.applications.instances?.get(appId(tradeId));
    if (existing) {
      existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    const trade = readPlayerTrades().find(t => t.id === tradeId);
    const mine = side || (trade ? mySideOf(trade) : "") || "a";
    return new PlayerTradeApp(tradeId, mine).render({ force: true });
  }

  get title() {
    const t = this.#trade();
    return t ? `Troca — ${t.aName} e ${t.bName}` : "Troca";
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    OPEN_SHOP_APPS.add(this);
  }

  _onClose(options) {
    super._onClose?.(options);
    clearTimeout(this._autoCloseTimer);
    OPEN_SHOP_APPS.delete(this);
  }

  #trade() {
    return readPlayerTrades().find(t => t.id === this.tradeId) ?? null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const trade = this.#trade();
    context.gone = !trade;
    if (!trade) return context;
    const me = this.side;
    const other = otherSide(me);
    const currencies = getActiveCurrencies();
    const actors = { a: await fromUuid(trade.aUuid), b: await fromUuid(trade.bUuid) };
    const name = side => (side === "a" ? trade.aName : trade.bName);
    const rowsOf = side =>
      (trade[side]?.items ?? []).map(entry => {
        const item = actors[side]?.items.get(entry.id);
        return { id: entry.id, name: item?.name ?? (trade.status === "done" ? "(item entregue)" : trade.status === "open" ? "(item sumiu)" : "(item devolvido)"), img: item?.img ?? "", qty: entry.qty, color: machineColor(item?.name ?? ""), missing: !item };
      });
    const coinsOf = side => {
      const c = trade[side]?.coins;
      return c ? formatMoney(toUnits(c.amount, c.currency, currencies), currencies, c.currency) : "";
    };
    context.open = trade.status === "open";
    context.names = { me: name(me), other: name(other) };
    context.mine = { rows: rowsOf(me), coinsAmount: trade[me]?.coins ? fromUnits(toUnits(trade[me].coins.amount, trade[me].coins.currency, currencies), trade[me].coins.currency, currencies) : 0 };
    context.theirs = { rows: rowsOf(other), coinsText: coinsOf(other) };
    const myCur = trade[me]?.coins?.currency || currencies[0]?.id || "";
    context.currencyOptions = currencies.map(c => ({ id: c.id, label: c.label, selected: c.id === myCur }));
    // Itens que dá para pôr: os do meu personagem que ainda não estão na mesa.
    const onTable = new Set((trade[me]?.items ?? []).map(e => e.id));
    const mineActor = actors[me];
    context.addable = mineActor
      ? sellCandidates(mineActor)
          .filter(i => !onTable.has(i.id) && !itemSellBlock(mineActor, i))
          .map(i => ({ id: i.id, label: `${i.name} (×${Number(i.system.quantity) || 0})`, max: Number(i.system.quantity) || 1 }))
      : [];
    const banner = tradeBanner(trade, me);
    context.banner = banner;
    context.accepted = { me: Boolean(trade.accepted?.[me]), other: Boolean(trade.accepted?.[other]) };
    context.acceptLabel = trade.accepted?.[me] ? "Retirar aceite" : "Aceitar";
    const scene = canvas?.scene;
    const d = scene && actors.a && actors.b ? distanceBetweenActors(scene, actors.a, actors.b) : null;
    context.distanceText = d === null ? "" : `a ${metersText(d)} um do outro (perto = ${metersText(getShopLootRange())})`;
    context.closed = trade.status !== "open";
    context.isGmView = game.user.isGM && !mySideOf(trade);
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    // Troca encerrada (feita, cancelada, desfeita ou já esquecida): a janela se fecha sozinha depois de alguns segundos.
    if ((context.closed || context.gone) && !this._autoCloseTimer) {
      this._autoCloseTimer = setTimeout(() => this.close().catch(() => {}), 12000);
    }
    const send = fields => askPlayerTrade("set", { tradeId: this.tradeId, side: this.side, ...fields });
    const sendCoins = () => {
      const amount = Number(String(root.querySelector("[data-coins]")?.value ?? "0").replace(",", "."));
      const currency = root.querySelector("[data-coin-currency]")?.value ?? "";
      return send({ coins: Number.isFinite(amount) && amount > 0 ? { amount, currency } : null });
    };
    root.querySelector("[data-coins]")?.addEventListener("change", sendCoins);
    root.querySelector("[data-coin-currency]")?.addEventListener("change", sendCoins);
    root.querySelector("[data-add-pick]")?.addEventListener("change", event => {
      const max = Number(event.currentTarget.selectedOptions[0]?.dataset.max) || 1;
      const qty = root.querySelector("[data-add-qty]");
      if (qty) {
        qty.max = String(max);
        qty.value = "1";
      }
    });
  }

  #mineItems() {
    return (this.#trade()?.[this.side]?.items ?? []).map(e => ({ ...e }));
  }

  static async #onAddItem() {
    const root = this.element;
    const id = root.querySelector("[data-add-pick]")?.value;
    const qty = Math.max(1, Math.floor(Number(root.querySelector("[data-add-qty]")?.value) || 1));
    if (!id) return;
    const items = normalizeTradeItems([...this.#mineItems(), { id, qty }]);
    await askPlayerTrade("set", { tradeId: this.tradeId, side: this.side, items });
  }

  static async #onRemoveItem(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const items = this.#mineItems().filter(e => e.id !== id);
    await askPlayerTrade("set", { tradeId: this.tradeId, side: this.side, items });
  }

  static async #onAccept() {
    const trade = this.#trade();
    if (!trade) return;
    await askPlayerTrade("accept", { tradeId: this.tradeId, side: this.side, accepted: !trade.accepted?.[this.side] });
  }

  static async #onCancel() {
    await askPlayerTrade("cancel", { tradeId: this.tradeId });
  }

  static async #onClose() {
    await askPlayerTrade("close", { tradeId: this.tradeId });
    this.close();
  }
}
