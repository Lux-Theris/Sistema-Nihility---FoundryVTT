/**
 * Troca entre dois jogadores (G2 Lojas, lote B): a mesma máquina de dois lados da avaliação
 * (`newTrade`/`tradeSet`/`tradeAccept`/`tradeReady` de `shop-rules.js`). Cada lado põe itens e moedas
 * só do próprio personagem, os dois aceitam, e qualquer mudança depois de um aceite apaga os dois.
 *
 * Estado: uma setting do mundo (`playerTrades`, JSON `{trades, log}`) escrita só pelo Mestre designado
 * (relay `playerTrade`); todos os clientes leem e redesenham pelo `onChange` (gancho
 * `nihilityPlayerTradesChanged`). Executar é uma só vez, pelo Mestre, que revalida TUDO pelos documentos
 * (itens, quantidades, saldos, distância); se um passo falhar, o que já foi movido volta (`revertOps`).
 * O log guarda as últimas trocas para o "Desfazer última troca" do Mestre.
 *
 * Como abrir: item "Trocar com…" no cabeçalho da ficha do personagem:
 * lista os outros jogadores com a distância; só quem está a até "perto" (2 m) pode ser convidado.
 */
import { SYSTEM_ID, NIHILITY, isShopsEnabled, getShopLootRange, getActiveCurrencies, sameActor } from "../core/config.js";
import { ownedDoc, owns } from "../helpers/gm-relay.js";
import { refuse, RELAY_REASONS } from "../helpers/gm-relay-rules.js";
import { escapeHtml } from "../helpers/html.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";
import {
  newTrade, tradeSet, tradeAccept, tradeReady, normalizeTradeItems, toUnits, walletUnits, payUnits, creditUnits, walletUpdate,
  invertDelta, formatMoney
} from "./shop-rules.js";
import {
  SHOP_ITEM_TYPES, shopOf, itemSellBlock, giveItem, takeItem, unloadForSale, revertOps, walletOf, newId, serialized, ask
} from "./shops.js";
import { tradeCandidates, otherSide, tradeHasContent, tradeSideText, farText, isNear, metersText } from "./loot-rules.js";
import { distanceBetweenActors, gridOf } from "./token-geometry.js";

const CLOSED_KEEP_MS = 10 * 60 * 1000;
const LOG_CAP = 6;

/* ------------------------------------------------------------------ Estado (setting do mundo) */

function readState() {
  try {
    const raw = JSON.parse(game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.playerTrades) || "{}");
    return { trades: Array.isArray(raw?.trades) ? raw.trades : [], log: Array.isArray(raw?.log) ? raw.log : [] };
  } catch (err) {
    return { trades: [], log: [] };
  }
}

async function writeState(state) {
  const now = Date.now();
  const trades = state.trades.filter(t => t.status === "open" || now - (t.closedAt ?? now) < CLOSED_KEEP_MS);
  await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.playerTrades, JSON.stringify({ trades, log: state.log.slice(-LOG_CAP) }));
}

/** As trocas conhecidas (abertas e as recém-fechadas). */
export function readPlayerTrades() {
  return readState().trades;
}

/** A última troca que o Mestre ainda pode desfazer (texto para a janela Ambiente), ou `null`. */
export function lastUndoableTrade() {
  const log = readState().log;
  for (let i = log.length - 1; i >= 0; i -= 1) if (!log[i].undone) return log[i];
  return null;
}

/* ------------------------------------------------------------------ Conferência (Mestre) */

/** Confere um lado: itens existem, quantidade, não equipado/contêiner cheio; moedas cobertas pelo saldo. */
function checkSide(actor, side, currencies) {
  const lines = [];
  for (const entry of normalizeTradeItems(side?.items)) {
    const item = actor.items.get(entry.id);
    if (!item || !SHOP_ITEM_TYPES.includes(item.type)) return { ok: false, reason: `um dos itens não está mais com ${actor.name}` };
    const have = Math.floor(Number(item.system.quantity) || 0);
    if (have < entry.qty) return { ok: false, reason: `${item.name}: ${actor.name} só tem ${have}` };
    const blocked = itemSellBlock(actor, item);
    if (blocked) return { ok: false, reason: `${item.name}: ${blocked}` };
    lines.push({ item, qty: entry.qty });
  }
  let coinUnits = 0;
  if (side?.coins) {
    coinUnits = toUnits(side.coins.amount, side.coins.currency, currencies);
    if (walletUnits(walletOf(actor), currencies) < coinUnits) return { ok: false, reason: `${actor.name} não tem moedas para essa oferta` };
  }
  return { ok: true, lines, coinUnits };
}

const mergeDelta = (...deltas) => {
  const out = {};
  for (const d of deltas) for (const [id, n] of Object.entries(d ?? {})) out[id] = (out[id] ?? 0) + n;
  for (const id of Object.keys(out)) if (out[id] === 0) delete out[id];
  return out;
};

function nearEnough(trade, A, B, user) {
  if (user?.isGM) return { ok: true };
  const scene = game.scenes.get(trade.sceneId ?? "");
  if (!scene) return { ok: false, reason: "a cena da troca não existe mais" };
  const d = distanceBetweenActors(scene, A, B);
  const range = getShopLootRange();
  return isNear(d, range) ? { ok: true } : { ok: false, reason: farText(d, range, gridOf(scene).units) };
}

/** Executa a troca já aceita pelos dois: revalida, move, e desfaz se algo falhar. */
async function executeTrade(trade, user) {
  const [A, B] = await Promise.all([fromUuid(trade.aUuid), fromUuid(trade.bUuid)]);
  if (!A || !B) return { ok: false, reason: "um dos personagens não existe mais" };
  const near = nearEnough(trade, A, B, user);
  if (!near.ok) return near;
  const currencies = getActiveCurrencies();
  const sa = checkSide(A, trade.a, currencies);
  if (!sa.ok) return sa;
  const sb = checkSide(B, trade.b, currencies);
  if (!sb.ok) return sb;

  // Moedas: cada lado paga ao outro (conta feita antes de mexer em qualquer coisa).
  const payA = sa.coinUnits ? payUnits(walletOf(A), currencies, sa.coinUnits, trade.a.coins.currency) : { ok: true, delta: {} };
  const payB = sb.coinUnits ? payUnits(walletOf(B), currencies, sb.coinUnits, trade.b.coins.currency) : { ok: true, delta: {} };
  if (!payA.ok || !payB.ok) return { ok: false, reason: "saldo insuficiente" };
  const netA = mergeDelta(payA.delta, sb.coinUnits ? creditUnits(currencies, sb.coinUnits, trade.b.coins.currency) : {});
  const netB = mergeDelta(payB.delta, sa.coinUnits ? creditUnits(currencies, sa.coinUnits, trade.a.coins.currency) : {});
  const updA = walletUpdate(walletOf(A), netA);
  const updB = walletUpdate(walletOf(B), netB);
  if (!updA.ok || !updB.ok) return { ok: false, reason: "saldo insuficiente" };

  const ops = [];
  try {
    for (const [from, to, side] of [[A, B, sa], [B, A, sb]]) {
      for (const line of side.lines) {
        await unloadForSale(from, line.item);
        const fresh = from.items.get(line.item.id) ?? line.item;
        const gain = await giveItem(to, fresh, line.qty);
        if (!gain) throw new Error(`${to.name} não aceita ${fresh.name}`);
        ops.push(gain);
        ops.push(await takeItem(from, fresh, line.qty));
      }
    }
    if (Object.keys(updA.update).length) await A.update(updA.update);
    if (Object.keys(updB.update).length) {
      try {
        await B.update(updB.update);
      } catch (err) {
        // Devolve o que o primeiro lado já recebeu/pagou.
        const back = walletUpdate(walletOf(A), invertDelta(netA));
        if (Object.keys(back.update).length) await A.update(back.update);
        throw err;
      }
    }
  } catch (err) {
    await revertOps(ops);
    return { ok: false, reason: err?.message || "não deu para trocar" };
  }

  const currenciesList = getActiveCurrencies();
  const text = side => tradeSideText([...side.lines.map(l => `${l.qty}× ${l.item.name}`), side.coinUnits ? formatMoney(side.coinUnits, currenciesList) : ""]);
  const label = `${A.name} deu ${text(sa)} e ${B.name} deu ${text(sb)}`;
  return { ok: true, A, B, ops, netA, netB, label };
}

/** O card da troca: vai ao Mestre e aos donos dos dois lados. */
async function announceTrade(A, B, body, title = "Troca") {
  const owners = actor => game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.id);
  const whisper = [...new Set([...game.users.filter(u => u.isGM).map(u => u.id), ...owners(A), ...owners(B)])];
  try {
    await announceVoiceOfTheWorld(A, { kind: "shop", title, body, whisper });
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Troca: não deu para publicar o aviso.`, err);
  }
}

/* ------------------------------------------------------------------ Relay */

async function playerTradeAsGm(payload, user) {
  if (!isShopsEnabled()) return refuse("as lojas estão desligadas");
  const op = String(payload?.op ?? "");
  const state = readState();
  const save = trades => writeState({ ...state, trades });

  if (op === "open") {
    const A = await ownedDoc(payload?.fromUuid, user);
    const B = await fromUuid(String(payload?.toUuid ?? ""));
    if (!A || !B) return refuse(RELAY_REASONS.permission);
    if (A.type !== "character" || B.type !== "character" || shopOf(A).enabled || shopOf(B).enabled || sameActor(A, B)) {
      return refuse("só dá para trocar com outro personagem (lojas usam a Vitrine)");
    }
    if (state.trades.some(t => t.status === "open" && [t.aUuid, t.bUuid].some(u => u === A.uuid || u === B.uuid))) {
      return refuse("um dos dois já está numa troca aberta");
    }
    const trade = newTrade({
      id: newId(), kind: "player", status: "open", sceneId: String(payload?.sceneId ?? ""), aUuid: A.uuid, aName: A.name, bUuid: B.uuid, bName: B.name,
      createdAt: Date.now(), changedBy: "", text: ""
    });
    const near = nearEnough(trade, A, B, user);
    if (!near.ok) return refuse(near.reason);
    await save([...state.trades, trade]);
    return { ok: true, value: { id: trade.id } };
  }

  const trade = state.trades.find(t => t.id === payload?.tradeId);
  if (!trade) return refuse("essa troca não existe mais");
  const [A, B] = await Promise.all([fromUuid(trade.aUuid), fromUuid(trade.bUuid)]);
  const sideActor = { a: A, b: B };
  const replace = next => save(state.trades.map(t => (t.id === trade.id ? next : t)));

  if (op === "close") {
    if (!user.isGM && !owns(user, A) && !owns(user, B)) return refuse(RELAY_REASONS.permission);
    await save(state.trades.filter(t => t.id !== trade.id));
    return { ok: true };
  }
  if (op === "cancel") {
    if (!user.isGM && !owns(user, A) && !owns(user, B)) return refuse(RELAY_REASONS.permission);
    if (trade.status !== "open") return { ok: true };
    await replace({ ...trade, status: "cancelled", closedAt: Date.now(), text: `Troca cancelada${user.isGM ? " pelo Mestre" : ""}. Nada mudou de dono.` });
    return { ok: true };
  }
  if (trade.status !== "open") return refuse("essa troca já foi encerrada");

  const side = String(payload?.side ?? "");
  if (!["a", "b"].includes(side) || !sideActor[side] || !owns(user, sideActor[side])) return refuse(RELAY_REASONS.permission);

  if (op === "set") {
    const currencies = getActiveCurrencies();
    const patch = {};
    if (payload.items !== undefined) patch.items = payload.items;
    if (payload.coins !== undefined) patch.coins = payload.coins;
    const preview = tradeSet(trade, side, patch).trade;
    const checked = checkSide(sideActor[side], preview[side], currencies);
    if (!checked.ok) return refuse(checked.reason);
    const { trade: next, changed } = tradeSet(trade, side, patch);
    if (!changed) return { ok: true };
    await replace({ ...next, changedBy: side });
    return { ok: true };
  }

  if (op === "accept") {
    const wanted = payload?.accepted !== false;
    let next = tradeAccept(trade, side, wanted);
    if (wanted && !tradeHasContent(next)) return refuse("a mesa está vazia: ponha algo antes de aceitar");
    if (!(wanted && tradeReady(next))) {
      await replace(next);
      return { ok: true };
    }
    const result = await executeTrade(next, user);
    if (!result.ok) {
      await replace({ ...tradeAccept(next, side, false), text: result.reason });
      return refuse(result.reason);
    }
    const entry = { id: newId(), tradeId: trade.id, ts: Date.now(), label: result.label, aUuid: A.uuid, bUuid: B.uuid, aDelta: result.netA, bDelta: result.netB, ops: result.ops, undone: false };
    await writeState({
      trades: state.trades.map(t => (t.id === trade.id ? { ...next, status: "done", closedAt: Date.now(), text: `Troca feita: ${result.label}.` } : t)),
      log: [...state.log, entry]
    });
    await announceTrade(result.A, result.B, `${result.label}.`);
    return { ok: true };
  }
  return refuse(RELAY_REASONS.invalid);
}

/** Desfazer a última troca (só o Mestre): confere que tudo ainda está onde foi parar e devolve. */
async function playerTradeUndoAsGm(payload, user) {
  if (!user?.isGM) return refuse(RELAY_REASONS.permission);
  const state = readState();
  const entry = [...state.log].reverse().find(e => !e.undone);
  if (!entry) return refuse("não há troca para desfazer");
  const [A, B] = await Promise.all([fromUuid(entry.aUuid), fromUuid(entry.bUuid)]);
  if (!A || !B) return refuse("um dos personagens não existe mais");
  const backA = walletUpdate(walletOf(A), invertDelta(entry.aDelta));
  const backB = walletUpdate(walletOf(B), invertDelta(entry.bDelta));
  if (!backA.ok) return refuse(`${A.name} já gastou esse dinheiro`);
  if (!backB.ok) return refuse(`${B.name} já gastou esse dinheiro`);
  for (const op of entry.ops ?? []) {
    if (op.op !== "gain") continue;
    const holder = await fromUuid(op.uuid);
    const item = holder?.items?.get(op.itemId);
    if (!item || (Number(item.system.quantity) || 0) < op.qty) return refuse(`${item?.name ?? "o item"} já não está com ${holder?.name ?? "quem recebeu"}`);
  }
  await revertOps(entry.ops ?? []);
  if (Object.keys(backA.update).length) await A.update(backA.update);
  if (Object.keys(backB.update).length) await B.update(backB.update);
  // A janela da troca (se ainda aberta) passa a dizer que foi desfeita, em vez de seguir com "Troca feita".
  const trades = state.trades.map(t => (t.id === entry.tradeId ? { ...t, status: "cancelled", closedAt: Date.now(), text: "O Mestre desfez esta troca. Tudo voltou ao que era." } : t));
  await writeState({ trades, log: state.log.map(e => (e.id === entry.id ? { ...e, undone: true } : e)) });
  await announceTrade(A, B, `O Mestre desfez a troca: ${entry.label}.`, "Troca desfeita");
  return { ok: true };
}

export const RELAY_HANDLERS = {
  playerTrade: (payload, user) => serialized(() => playerTradeAsGm(payload, user)),
  playerTradeUndo: (payload, user) => serialized(() => playerTradeUndoAsGm(payload, user))
};

/* ------------------------------------------------------------------ Pedidos do cliente */

/** Operações da troca entre jogadores: open, set, accept, cancel, close. */
export function askPlayerTrade(op, fields = {}) {
  return ask("playerTrade", { op, ...fields }, "fazer isso na troca");
}

/** Desfazer a última troca (Mestre). */
export async function askUndoLastTrade() {
  const outcome = await ask("playerTradeUndo", {}, "desfazer a troca");
  if (outcome?.ok) ui.notifications.info("Troca desfeita.");
  return outcome;
}

/* ------------------------------------------------------------------ Abrir a troca */

/** O personagem do usuário numa troca (`"a"`/`"b"`), pelo dono. O Mestre só entra como lado se for dono explícito. */
export function mySideOf(trade) {
  if (game.user.isGM) return "";
  const a = fromUuidSync(trade.aUuid);
  const b = fromUuidSync(trade.bUuid);
  if (a?.isOwner) return "a";
  if (b?.isOwner) return "b";
  return "";
}

export async function openTradeApp(tradeId, side = "") {
  const { PlayerTradeApp } = await import("../apps/player-trade.js");
  return PlayerTradeApp.open(tradeId, side);
}

/**
 * Menu "Trocar com…" (mockup 7): os outros personagens da cena com a distância; lojas, depósitos e
 * pilhas do mapa também aparecem e só ficam clicáveis a até 2 m ("como guardar dentro do armário").
 * Escolher um deles abre a janela que já existe (Vitrine / saque), sem dar permissão na ficha.
 */
export async function openTradeMenu(actor) {
  if (!isShopsEnabled()) return;
  const scene = canvas?.scene;
  if (!scene) return ui.notifications.warn("Abra uma cena no mapa para trocar.");
  const range = getShopLootRange();
  const others = game.actors
    .filter(a => a.type === "character" && !sameActor(a, actor) && (a.system.isPlayerCharacter || shopOf(a).enabled) && (a.hasPlayerOwner || shopOf(a).enabled))
    .filter(a => !shopOf(a).enabled)
    .map(a => ({ key: a.uuid, uuid: a.uuid, name: a.name, kind: "player", distance: distanceBetweenActors(scene, actor, a) }));
  const { isPileToken, openLoot } = await import("./loot.js");
  const { openStorefront, isShopActor } = await import("./shops.js");
  const { canUseShop } = await import("./shop-rules.js");
  const { rectOf, distanceToRect } = await import("./token-geometry.js");
  const places = new Map();
  for (const token of scene.tokens) {
    const target = token.actor;
    if (!target || token.hidden) continue;
    let kind = "";
    if (isPileToken(token) || target.type === "pile") kind = target.type === "pile" && target.system?.kind === "deposit" ? "deposit" : "pile";
    else if (target.type === "character" && isShopActor(target) && canUseShop(target.system?.shop, game.user.id)) kind = "shop";
    if (!kind) continue;
    places.set(token.uuid, { token, kind });
    others.push({ key: token.uuid, uuid: token.uuid, name: token.name || target.name, kind, distance: distanceToRect(scene, actor, rectOf(token)) });
  }
  const list = tradeCandidates(others, range);
  if (!list.length) return ui.notifications.info("Não há outro personagem de jogador, loja nem pilha por perto para trocar.");
  const rows = list
    .map(
      (o, i) => `<label class="nihility-show-row ${o.enabled ? "" : "off"}"><input type="radio" name="partner" value="${escapeHtml(o.key)}" ${o.enabled ? "" : "disabled"} ${i === 0 && o.enabled ? "checked" : ""}/> <b>${escapeHtml(o.name)}</b> <span class="hint">${escapeHtml(o.hint)}</span></label>`
    )
    .join("");
  const target = await foundry.applications.api.DialogV2.wait({
    window: { title: `Trocar com… (${actor.name})`, icon: "fa-solid fa-right-left" },
    classes: ["nihility-condition-dialog"],
    content: `<div class="nihility-show-shop"><p class="hint">Só dá para trocar (ou abrir loja, depósito e pilha) a até ${metersText(range)}. Com um personagem, os dois montam a oferta e aceitam.</p>${rows}</div>`,
    buttons: [
      { action: "go", label: "Abrir / convidar", icon: "fa-solid fa-handshake", default: true, callback: (event, button, dialog) => dialog.element.querySelector("[name=partner]:checked")?.value ?? null },
      { action: "cancel", label: "Cancelar", callback: () => null }
    ],
    rejectClose: false
  });
  if (!target) return;
  const place = places.get(target);
  if (place) {
    const doc = place.token;
    const still = tradeCandidates([{ uuid: doc.uuid, name: doc.name, kind: place.kind, distance: distanceToRect(scene, actor, rectOf(doc)) }], range)[0];
    if (!still?.enabled) return ui.notifications.info(`Longe demais: ${still?.hint ?? ""}`);
    if (place.kind === "shop") return openStorefront(doc.actor, { tokenUuid: doc.uuid });
    return openLoot({ tokenUuid: doc.uuid, actorUuid: doc.actor?.uuid ?? "" });
  }
  const outcome = await askPlayerTrade("open", { fromUuid: actor.uuid, toUuid: target, sceneId: scene.id });
  if (outcome?.ok && outcome.value?.id) openTradeApp(outcome.value.id, "a");
}

/* ------------------------------------------------------------------ Ganchos */

/** Abre a janela para quem foi convidado e avisa quando o outro lado mexe. Chamado por `registerLoot`. */
export function registerPlayerTrade() {
  const seen = new Map();
  const react = (announce = true) => {
    for (const trade of readPlayerTrades()) {
      const side = mySideOf(trade);
      const key = `${trade.id}`;
      const before = seen.get(key);
      seen.set(key, trade.rev ?? 0);
      if (!side || trade.status !== "open") continue;
      const app = foundry.applications.instances?.get(`nihility-player-trade-${trade.id}`);
      if (app?.rendered) continue;
      const other = otherSide(side);
      if (before === undefined && announce) {
        if (trade.aUuid && side === "b") ui.notifications.info(`${trade.aName} quer trocar com você.`);
        openTradeApp(trade.id, side);
      } else if (before !== undefined && before !== (trade.rev ?? 0) && trade.changedBy === other && announce) {
        ui.notifications.info(`${other === "a" ? trade.aName : trade.bName} mudou a oferta da troca.`);
        openTradeApp(trade.id, side);
      }
    }
  };
  Hooks.on("nihilityPlayerTradesChanged", () => react(true));
  Hooks.once("ready", () => {
    // Recarregou a página no meio de uma troca: abre a janela de novo, sem avisos.
    for (const trade of readPlayerTrades()) {
      if (trade.status === "open" && mySideOf(trade)) openTradeApp(trade.id, mySideOf(trade));
      seen.set(`${trade.id}`, trade.rev ?? 0);
    }
  });
}
