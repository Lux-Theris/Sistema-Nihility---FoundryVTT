/**
 * Janela de saque (G2 Lojas, lote B; mockups 8, 9 e 10): a MESMA tela para o corpo de um NPC caído,
 * uma pilha largada no mapa e um depósito de entregas. Preço 0: pegar item (com quantidade), "pegar
 * tudo" e as moedas do corpo. Perto = até 2 m (Módulos do Sistema > Lojas). O depósito mostra ao
 * jogador SÓ o que é dele (chegou: Pegar / Pegar tudo meu; a caminho: com o prazo); o Mestre vê tudo
 * e entrega ao dono.
 *
 * Só lê documentos e pede ações: o Mestre revalida distância, dono e o que ainda está lá.
 */
import { SYSTEM_ID, getActiveCurrencies, getShopLootRange } from "../core/config.js";
import { OPEN_SHOP_APPS } from "../economy/shops.js";
import { formatMoney, itemKind, walletUnits } from "../economy/shop-rules.js";
import { resolveSource, lootEntries, bodyCoins, lootTakers, askLoot, remainingSeconds, worldDayLength } from "../economy/loot.js";
import { splitDeposit, normalizeDelivery, isNear, farText, bodyStateText, etaText } from "../economy/loot-rules.js";
import { distanceToToken, gridOf } from "../economy/token-geometry.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const refKey = ref => String(ref?.tokenUuid || ref?.actorUuid || "").replace(/[^a-zA-Z0-9]/g, "-");
const appId = ref => `nihility-loot-${refKey(ref)}`;

export class ShopLootApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(ref, options = {}) {
    super({ id: appId(ref), ...options });
    this.ref = ref;
    this.state = { takerUuid: "", banner: null, qty: {} };
  }

  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-shop-app", "nihility-loot-app"],
    window: { title: "Saque", resizable: true },
    position: { width: 560, height: "auto" },
    actions: { takeOne: ShopLootApp.#onTakeOne, takeAll: ShopLootApp.#onTakeAll, takeCoins: ShopLootApp.#onTakeCoins }
  };

  static PARTS = { body: { template: `systems/${SYSTEM_ID}/templates/apps/shop-loot.hbs`, scrollable: [".nlt-list"] } };

  /** Abre (ou traz para a frente) a janela desta fonte. */
  static open(ref) {
    const existing = foundry.applications.instances?.get(appId(ref));
    if (existing) {
      existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    return new ShopLootApp(ref).render({ force: true });
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    OPEN_SHOP_APPS.add(this);
  }

  _onClose(options) {
    super._onClose?.(options);
    OPEN_SHOP_APPS.delete(this);
  }

  #taker() {
    const list = lootTakers();
    return list.find(a => a.uuid === this.state.takerUuid) ?? list[0] ?? null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const s = this.state;
    const source = await resolveSource(this.ref);
    context.gone = !source;
    if (!source) return context;
    const gm = game.user.isGM;
    const currencies = getActiveCurrencies();
    const taker = this.#taker();
    const { kind } = source;
    context.kind = kind;
    context.isBody = kind === "body";
    context.isDeposit = kind === "deposit";
    context.gm = gm;
    context.title = kind === "body" ? `Corpo: ${source.actor.name}` : kind === "deposit" ? source.actor.name : (source.token?.name ?? source.actor.name);
    context.stateTag = kind === "body" ? bodyStateText({ dead: source.actor.statuses?.has(CONFIG.specialStatusEffects?.DEFEATED ?? "dead"), hp: Number(source.actor.system?.attributes?.hp?.value ?? 1) }) : "";
    context.hasTaker = Boolean(taker) || (kind === "deposit" && gm);
    if (taker) s.takerUuid = taker.uuid;
    const takers = lootTakers();
    context.takerOptions = takers.length > 1 && !(kind === "deposit" && gm) ? takers.map(a => ({ value: a.uuid, label: a.name, selected: a.uuid === taker?.uuid })) : null;
    context.takerName = taker?.name ?? "";
    context.banner = s.banner;
    s.banner = null;

    // Perto? O Mestre pega de qualquer lugar; o jogador precisa estar a até "perto" do Token.
    const range = getShopLootRange();
    let near = gm;
    let farLine = "";
    if (!gm) {
      if (!source.token) {
        farLine = "Sem Token no mapa: peça ao Mestre.";
      } else {
        const d = distanceToToken(taker, source.token);
        near = isNear(d, range);
        if (!near) farLine = farText(d, range, gridOf(source.token.parent).units);
      }
    }
    context.near = near;
    context.farLine = farLine;
    context.rangeText = `Perto = até ${range} m do ${kind === "body" ? "corpo" : kind === "pile" ? "Token da pilha" : "Token do depósito"}.`;

    const now = Number(game.time?.worldTime) || 0;
    const entries = lootEntries(source).map(e => ({
      ...e,
      kindLabel: itemKind(e.item),
      inside: source.actor.items.filter(i => i.system?.containerId === e.id).length
    }));
    const toRow = e => {
      const d = normalizeDelivery(e.delivery);
      return {
        id: e.id,
        name: e.name,
        img: e.item.img,
        qty: e.qty,
        want: Math.min(e.qty, Math.max(1, s.qty[e.id] ?? e.qty)),
        hint: e.inside ? `${e.kindLabel} · ${e.inside} ${e.inside === 1 ? "item dentro" : "itens dentro"}` : e.kindLabel,
        owner: gm && d ? `de ${d.ownerName || "?"}` : "",
        from: d?.from ?? "",
        eta: d && d.status === "transit" && d.arriveAt !== null ? etaText(remainingSeconds(d), worldDayLength()) : ""
      };
    };
    if (kind === "deposit") {
      const split = splitDeposit(entries, taker?.uuid ?? "", { gm, now });
      context.rows = [...split.mine, ...split.loose].map(toRow);
      context.transit = split.transit.map(toRow);
      context.loose = split.loose.length;
      context.takeAllLabel = gm ? "Pegar tudo (para os donos)" : `Pegar tudo meu (${split.mine.length})`;
      context.noAll = !context.rows.length;
      context.who = gm ? "Mestre: você pode pegar ou entregar qualquer item." : taker ? `Você é ${taker.name}: só aparece o que é seu.` : "";
    } else {
      context.rows = entries.map(toRow);
      context.takeAllLabel = "Pegar tudo";
      context.noAll = !context.rows.length && !Object.keys(bodyCoins(source.actor)).length;
    }
    const coins = kind === "body" ? bodyCoins(source.actor) : {};
    context.hasCoins = Object.keys(coins).length > 0;
    context.coinsText = context.hasCoins ? formatMoney(walletUnits(coins, currencies), currencies) : "";
    context.empty = !context.rows.length && !context.hasCoins && !(context.transit?.length);
    context.emptyText = kind === "body" ? "Corpo saqueado: nada mais para pegar." : kind === "pile" ? "A pilha está vazia." : "Nada seu no depósito agora.";
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector("[data-taker]")?.addEventListener("change", event => {
      this.state.takerUuid = event.currentTarget.value;
      this.render();
    });
    this.element.querySelectorAll("[data-want]").forEach(input =>
      input.addEventListener("change", () => {
        const id = input.closest("[data-item-id]")?.dataset.itemId;
        if (id) this.state.qty[id] = Math.max(1, Math.floor(Number(input.value) || 1));
      })
    );
  }

  async #ask(op, extra = {}) {
    const taker = this.#taker();
    const outcome = await askLoot({ source: this.ref, taker, op, ...extra });
    if (!outcome?.ok) this.state.banner = { cls: "w", text: outcome?.reason ? `${outcome.reason}. A lista foi atualizada.` : "Não deu para pegar." };
    else if (taker) setTimeout(() => this.#warnWeight(taker), 400);
    this.render();
    return outcome;
  }

  /** Respeita o peso: o sistema só AVISA quando passa dos espaços (a mesa decide), igual ao arrastar para a ficha. */
  #warnWeight(taker) {
    const inv = taker.system?.inventory;
    if (inv && inv.usedSlots > inv.slots) ui.notifications.warn(`${taker.name}: inventário cheio (${inv.usedSlots}/${inv.slots} slots).`);
  }

  static #onTakeOne(event, target) {
    const row = target.closest("[data-item-id]");
    const input = row?.querySelector("[data-want]");
    return this.#ask("item", { itemId: row?.dataset.itemId ?? "", qty: Math.max(1, Math.floor(Number(input?.value) || 1)) });
  }

  static #onTakeAll() {
    return this.#ask("all");
  }

  static #onTakeCoins() {
    return this.#ask("coins");
  }
}
