/**
 * Aba "Loja" da ficha de Personagem (G2, lote A; só o Mestre; mockup aprovado: quadro 3).
 * Fica fora de actor-sheet.js: a ficha só ganha a parte, a lista de abas e as ações abaixo.
 *
 * O estoque é a lista de Itens da própria ficha; cada Item guarda o preço base, o estoque e o
 * ajuste no bloco `shop`. O preço que a loja pratica é preço base × multiplicador × sorteio
 * (fixo até reabastecer); o ajuste vence tudo e marca o item como "fixo".
 */
import { getActiveCurrencies, isShopsEnabled } from "../core/config.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import {
  SHOP_KIND_LABELS, SHOP_STYLE_LABELS, toUnits, fromUnits, formatMoney, diffText, shopCategories, rowMatches, walletUnits, lastUndoable
} from "../economy/shop-rules.js";
import { showShopDialog, showShopTo, hideShop } from "../economy/shop-show.js";
import {
  shopOf, shopStockItems, shopListing, priceText, readTrades, restockShop, rerollShopPrices, askUndo, openStorefront
} from "../economy/shops.js";

const { DialogV2 } = foundry.applications.api;

/** A aba existe nesta ficha? Só para o Mestre, em Personagem, com o bloco Lojas ligado. */
export function shopTabAvailable(actor) {
  return Boolean(game.user?.isGM) && actor?.type === "character" && isShopsEnabled();
}

const uiOf = sheet => (sheet.shopUi ??= { tag: "Todos", search: "" });

const timeText = ts => {
  try {
    return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch (err) {
    return "";
  }
};

/** Quando a loja reabastece sozinha de novo, em texto (data do relógio do mundo, ou "daqui a …"). */
function restockNote(cfg) {
  if (cfg.restockDays <= 0) return "Sem reposição automática.";
  if (cfg.lastRestock == null) return `A cada ${cfg.restockDays} dia(s) pelo relógio do mundo; a contagem começa quando o tempo andar.`;
  return `A cada ${cfg.restockDays} dia(s) pelo relógio do mundo.`;
}

/** Contexto da parte "shop" da ficha. */
export function shopTabContext(sheet, context) {
  const actor = sheet.actor;
  const ui = uiOf(sheet);
  const cfg = shopOf(actor);
  const currencies = getActiveCurrencies();
  const all = shopStockItems(actor).map(item => ({ item, row: shopListing(actor, item, cfg, currencies) }));
  const categories = shopCategories(all.map(e => e.row));
  const tag = categories.includes(ui.tag) ? ui.tag : "Todos";
  const rows = all
    .filter(e => rowMatches(e.row, { category: tag, search: "" }))
    .sort((a, b) => a.row.name.localeCompare(b.row.name))
    .map(({ row }) => ({
      ...row,
      qtyValue: row.stock === null ? "" : row.stock,
      stdText: priceText(row.stdUnits, row.currencyId, currencies),
      priceText: priceText(row.unitUnits, row.currencyId, currencies),
      diffText: row.fixed ? "" : diffText(row.diff),
      diffCls: row.diff >= 0 ? "warn" : "ok",
      adjustValue: row.overrideValue == null ? "" : row.overrideValue,
      currencyLabel: currencies.find(c => c.id === row.currencyId)?.label ?? "",
      noPrice: row.stdUnits === 0 && !row.fixed
    }));
  const lastId = lastUndoable(cfg.history)?.id ?? "";
  const openTrades = readTrades(actor).filter(t => t.status === "open");
  context.shopTab = {
    cfg,
    isAuto: cfg.kind === "auto",
    isVendor: cfg.kind === "vendor",
    kindOptions: Object.entries(SHOP_KIND_LABELS).map(([value, label]) => ({ value, label, selected: value === cfg.kind })),
    buybackPercent: Math.round(cfg.buybackFraction * 100),
    restockNote: restockNote(cfg),
    fundsText: formatMoney(walletUnits(actor.system.currencies, currencies), currencies),
    categories: categories.map(name => ({ name, on: name === tag })),
    shown: rows.length,
    total: all.length,
    rows,
    currencyOptions: currencies.map(c => ({ id: c.id, label: c.label })),
    history: [...cfg.history].reverse().map(h => ({
      id: h.id,
      time: timeText(h.ts),
      label: h.label,
      undone: Boolean(h.undone),
      canUndo: h.id === lastId
    })),
    pendingTrades: openTrades.length,
    isMachine: cfg.kind === "auto" && cfg.style === "machine",
    styleOptions: Object.entries(SHOP_STYLE_LABELS).map(([value, label]) => ({ value, label, selected: value === cfg.style })),
    shownNames: cfg.shownTo.map(id => game.users.get(id)?.name).filter(Boolean).join(", "),
    worldBlocked: !isShopsEnabled()
  };
}

/** Liga os campos que não são do formulário (ajuste, estoque, compra de volta, busca). */
export function bindShopTab(sheet) {
  const root = sheet.element;
  const actor = sheet.actor;
  const ui = uiOf(sheet);
  const itemOf = el => actor.items.get(el.closest("[data-item-id]")?.dataset.itemId ?? "");
  const wrap = fn => async event => {
    try {
      await fn(event);
    } catch (err) {
      reportError("Falha ao salvar na aba Loja.", err);
    }
  };

  root.querySelectorAll("[data-shop-adjust]").forEach(input =>
    input.addEventListener("change", wrap(async () => {
      const item = itemOf(input);
      if (!item) return;
      const raw = input.value.trim().replace(",", ".");
      const value = raw === "" ? null : Number(raw);
      await item.update({ "system.shop.priceOverride": value === null || !Number.isFinite(value) || value < 0 ? null : value });
    }))
  );
  root.querySelectorAll("[data-shop-stock]").forEach(input =>
    input.addEventListener("change", wrap(async () => {
      const item = itemOf(input);
      if (!item) return;
      const raw = input.value.trim();
      if (raw === "") return item.update({ "system.shop.stock": null });
      const n = Math.max(0, Math.floor(Number(raw)));
      if (!Number.isFinite(n)) return;
      await item.update({ "system.shop.stock": n, "system.quantity": n });
    }))
  );
  root.querySelector("[data-shop-buyback]")?.addEventListener("change", wrap(async event => {
    const pct = Math.min(100, Math.max(0, Number(event.currentTarget.value) || 0));
    await actor.update({ "system.shop.buybackFraction": pct / 100 });
  }));
  // Busca: esconde as linhas sem redesenhar (redesenhar tiraria o foco do campo a cada letra).
  const search = root.querySelector("[data-shop-search]");
  if (search) {
    const apply = () => {
      ui.search = search.value;
      root.querySelectorAll("[data-shop-row]").forEach(row => {
        row.hidden = !rowMatches({ name: row.dataset.name, kind: "Todos" }, { category: "Todos", search: ui.search });
      });
    };
    search.value = ui.search ?? "";
    search.addEventListener("input", apply);
    apply();
  }
}

const selectedIds = sheet => [...sheet.element.querySelectorAll("[data-shop-select]:checked")].map(el => el.closest("[data-item-id]")?.dataset.itemId).filter(Boolean);

/** As ações da aba (entram em `actions` da ficha; `this` é a ficha). */
export const SHOP_TAB_ACTIONS = {
  async shopSetTag(event, target) {
    event.preventDefault();
    uiOf(this).tag = target.dataset.tag || "Todos";
    await this.render({ parts: ["shop"] });
  },

  async shopRestock(event) {
    event.preventDefault();
    try {
      const n = await restockShop(this.actor);
      ui.notifications.info(`${this.actor.name} reabasteceu: preços sorteados de novo${n ? ` e ${n} ${n === 1 ? "item voltou" : "itens voltaram"} ao estoque` : ""}.`);
    } catch (err) {
      reportError("Falha ao reabastecer a loja.", err);
    }
  },

  async shopReroll(event) {
    event.preventDefault();
    try {
      await rerollShopPrices(this.actor);
      ui.notifications.info("Preços sorteados de novo.");
    } catch (err) {
      reportError("Falha ao sortear os preços.", err);
    }
  },

  /** "Aplicar ajuste": fixa o preço dos itens marcados (na moeda de cada item, ou na escolhida). */
  async shopApplyAdjust(event) {
    event.preventDefault();
    const ids = selectedIds(this);
    const input = this.element.querySelector("[data-shop-batch]");
    const value = Number(String(input?.value ?? "").replace(",", "."));
    if (!ids.length) return ui.notifications.warn("Marque os itens que vão receber o ajuste.");
    if (!Number.isFinite(value) || value < 0) return ui.notifications.warn("Digite o preço do ajuste.");
    const currencies = getActiveCurrencies();
    const chosen = this.element.querySelector("[data-shop-batch-currency]")?.value ?? "";
    try {
      const updates = ids.map(id => {
        const item = this.actor.items.get(id);
        const own = shopListing(this.actor, item, shopOf(this.actor), currencies).currencyId;
        // O ajuste é dito em UMA moeda; cada item guarda o preço na moeda dele.
        const units = toUnits(value, chosen || own, currencies);
        return { _id: id, "system.shop.priceOverride": fromUnits(units, own, currencies) };
      });
      await this.actor.updateEmbeddedDocuments("Item", updates);
    } catch (err) {
      reportError("Falha ao aplicar o ajuste.", err);
    }
  },

  async shopClearAdjust(event) {
    event.preventDefault();
    const ids = selectedIds(this);
    if (!ids.length) return ui.notifications.warn("Marque os itens que voltam ao preço automático.");
    try {
      await this.actor.updateEmbeddedDocuments("Item", ids.map(id => ({ _id: id, "system.shop.priceOverride": null })));
    } catch (err) {
      reportError("Falha ao limpar o ajuste.", err);
    }
  },

  async shopEditItem(event, target) {
    event.preventDefault();
    this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId ?? "")?.sheet?.render(true);
  },

  async shopRemoveItem(event, target) {
    event.preventDefault();
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId ?? "");
    if (!item) return;
    const ok = await DialogV2.confirm({
      window: { title: "Tirar da loja" },
      content: `<div class="nihility-shop-confirm"><p>Tirar <b>${escapeHtml(item.name)}</b> do estoque? O Item é apagado desta ficha.</p></div>`,
      rejectClose: false
    });
    if (ok) await item.delete();
  },

  async shopUndo(event, target) {
    event.preventDefault();
    const outcome = await askUndo(this.actor, target.dataset.entryId);
    if (outcome?.ok) ui.notifications.info("Venda desfeita.");
  },

  async shopOpenAppraisal(event) {
    event.preventDefault();
    const { openAppraisal } = await import("../apps/shop-appraisal.js");
    openAppraisal(this.actor);
  },

  async shopShow(event) {
    event.preventDefault();
    const ids = await showShopDialog(this.actor);
    if (ids?.length) await showShopTo(this.actor, ids);
  },

  async shopHide(event) {
    event.preventDefault();
    await hideShop(this.actor);
  },

  async shopOpenStorefront(event) {
    event.preventDefault();
    await openStorefront(this.actor, { asGm: true });
  }
};
