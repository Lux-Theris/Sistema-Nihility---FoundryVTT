/**
 * Lojas (G2, lote A): preço e sorteio, compra de volta, dinheiro em qualquer moeda, estoque,
 * reposição pelo relógio, histórico (Desfazer), troca de dois lados e Validar Mundo.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { NIHILITY } from "../module/core/config.js";
import {
  normalizeShop, normalizeItemShop, toUnits, fromUnits, formatNumber, shopHash, shopFactor, newSeed, finalPriceUnits,
  priceDiffPercent, diffText, soldUnitsFactor, openAmmoFactor, buybackUnits, sellBlockedReason, stockLeft, stockText,
  canBuyStock, stockAfter, stockAfterBuyback, restockedStock, restockDue, walletUnits, composeUnits, formatMoney, payUnits,
  creditUnits, applyDelta, walletUpdate, invertDelta, pushHistory, lastUndoable, canUndoEntry, markUndone, HISTORY_CAP,
  normalizeTradeItems, normalizeTradeCoins, newTrade, tradeSet, tradeAccept, tradeReady, itemKind, shopCategories, rowMatches,
  appraisalSuggestion, shopSetupIssues, SHOP_DEFAULTS
} from "../module/economy/shop-rules.js";
import { validateActor, buildCatalogIndex } from "../module/world/world-validator.js";

const COINS = [
  { id: "gold", label: "Ouro", baseValue: 100 },
  { id: "silver", label: "Prata", baseValue: 10 },
  { id: "copper", label: "Cobre", baseValue: 1 }
];

test("Loja: dados saem normalizados e com os padrões do dono", () => {
  const s = normalizeShop({});
  assert.equal(s.enabled, false);
  assert.equal(s.kind, "vendor");
  assert.equal(s.multiplier, SHOP_DEFAULTS.multiplier);
  assert.equal(s.buybackFraction, 0.5);
  assert.equal(s.randomizer, 25);
  assert.equal(s.limitedFunds, false);
  assert.equal(s.restockDays, 0);
  assert.equal(s.lastRestock, null);
  assert.deepEqual(s.history, []);
  const odd = normalizeShop({ enabled: 1, kind: "xx", multiplier: -3, buybackFraction: 9, randomizer: 500, restockDays: -2, lastRestock: "oi" });
  assert.equal(odd.kind, "vendor");
  assert.equal(odd.multiplier, 1);
  assert.equal(odd.buybackFraction, 1);
  assert.equal(odd.randomizer, 100);
  assert.equal(odd.restockDays, 0);
  assert.equal(odd.lastRestock, null);
  assert.equal(normalizeShop({ kind: "auto" }).kind, "auto");
  assert.equal(normalizeShop(null).enabled, false);
});

test("Item: estoque vazio é infinito; preço fixo e etiquetas", () => {
  const i = normalizeItemShop({});
  assert.deepEqual(i, { basePrice: 0, currency: "", stock: null, restockTo: null, priceOverride: null, digital: false, deliveryHours: null, tags: [] });
  const j = normalizeItemShop({ basePrice: "50", stock: "3.9", priceOverride: 0, restockTo: 5, tags: [" raro ", "", "x"] });
  assert.equal(j.basePrice, 50);
  assert.equal(j.stock, 3);
  assert.equal(j.priceOverride, 0, "0 é um preço fixo válido (de graça)");
  assert.equal(j.restockTo, 5);
  assert.deepEqual(j.tags, ["raro", "x"]);
  assert.equal(normalizeItemShop({ stock: "" }).stock, null);
});

test("Sorteio de preço: determinístico, dentro de 1 ± pct e muda com a semente", () => {
  assert.equal(shopFactor(7, "Espada", 25), shopFactor(7, "Espada", 25));
  assert.equal(shopFactor(7, "Espada", 0), 1);
  for (let seed = 1; seed < 200; seed += 1) {
    const f = shopFactor(seed, "Poção", 25);
    assert.ok(f >= 0.75 && f <= 1.25, `fator ${f} fora de 0,75–1,25`);
  }
  const fixed = shopFactor(1, "Poção", 10);
  assert.ok(fixed >= 0.9 && fixed <= 1.1);
  // semente nova => preços novos
  const values = new Set(Array.from({ length: 50 }, (_, i) => shopFactor(i + 1, "Poção", 25)));
  assert.ok(values.size > 40);
  // itens diferentes variam de forma independente
  assert.notEqual(shopFactor(5, "A", 25), shopFactor(5, "B", 25));
  assert.ok(shopHash("x") >= 0 && shopHash("x") <= 4294967295);
  assert.ok(newSeed(() => 0) >= 1);
  assert.ok(newSeed(() => 0.999999) > 1);
});

test("Preço final: base × multiplicador × sorteio; o ajuste vence tudo; nunca de graça por arredondamento", () => {
  assert.equal(finalPriceUnits({ baseUnits: 5000, multiplier: 1.2, factor: 0.97 }), Math.round(5000 * 1.2 * 0.97));
  assert.equal(finalPriceUnits({ baseUnits: 5000, multiplier: 1.2, factor: 0.97, overrideUnits: 200 }), 200);
  assert.equal(finalPriceUnits({ baseUnits: 5000, multiplier: 9, factor: 9, overrideUnits: 0 }), 0, "ajuste 0 = de graça de propósito");
  assert.equal(finalPriceUnits({ baseUnits: 0, multiplier: 2, factor: 1 }), 0, "sem preço base sai de graça (o Validar Mundo avisa)");
  assert.equal(finalPriceUnits({ baseUnits: 1, multiplier: 0.1, factor: 0.75 }), 1, "tem preço, mínimo 1 unidade");
  assert.equal(priceDiffPercent(116, 100), 16);
  assert.equal(priceDiffPercent(88, 100), -12);
  assert.equal(priceDiffPercent(5, 0), 0);
  assert.equal(diffText(16), "+16%");
  assert.equal(diffText(-3), "−3%");
  assert.equal(diffText(0), "");
});

test("Moedas: unidades base, ida e volta, número pt-BR", () => {
  assert.equal(toUnits(2.5, "gold", COINS), 250);
  assert.equal(toUnits(3, "desconhecida", COINS), 3);
  assert.equal(fromUnits(58, "gold", COINS), 0.58);
  assert.equal(fromUnits(250, "silver", COINS), 25);
  assert.equal(formatNumber(1240), "1.240");
  assert.equal(formatNumber(48.5), "48,5");
  assert.equal(walletUnits({ gold: 1, silver: 2, copper: 3 }, COINS), 123);
  assert.equal(walletUnits({}, COINS), 0);
});

test("Pagar em qualquer moeda: moeda exata primeiro, troco nas menores", () => {
  const exact = payUnits({ gold: 2, silver: 5, copper: 8 }, COINS, 58, "silver");
  assert.equal(exact.ok, true);
  assert.deepEqual(exact.delta, { silver: -5, copper: -8 }, "prata e cobre exatos, sem mexer no ouro");
  const change = payUnits({ gold: 1 }, COINS, 58, "gold");
  assert.equal(change.ok, true);
  assert.deepEqual(change.delta, { gold: -1, silver: 4, copper: 2 }, "1 ouro paga 58 e volta 42 de troco");
  assert.deepEqual(payUnits({ gold: 1 }, COINS, 100, "gold").delta, { gold: -1 });
  const poor = payUnits({ silver: 3 }, COINS, 58);
  assert.equal(poor.ok, false);
  assert.match(poor.reason, /saldo/);
  assert.deepEqual(payUnits({}, COINS, 0), { ok: true, delta: {} });
  // o saldo total só perde o preço
  const wallet = { gold: 3, silver: 4, copper: 7 };
  for (const price of [1, 9, 10, 99, 100, 247, 347]) {
    const r = payUnits(wallet, COINS, price);
    assert.equal(r.ok, true, `preço ${price}`);
    const next = applyDelta(wallet, r.delta).wallet;
    assert.equal(walletUnits(next, COINS), walletUnits(wallet, COINS) - price, `preço ${price}`);
    assert.ok(Object.values(next).every(n => n >= 0));
  }
});

test("Receber dinheiro, juntar moedas e Desfazer", () => {
  assert.deepEqual(composeUnits(123, COINS), { gold: 1, silver: 2, copper: 3 });
  assert.deepEqual(creditUnits(COINS, 120, "gold"), { gold: 1, silver: 2 });
  assert.deepEqual(creditUnits(COINS, 120, "silver"), { silver: 12 });
  assert.equal(formatMoney(120, COINS, "gold"), "1 Ouro e 2 Prata");
  assert.equal(formatMoney(100, COINS), "1 Ouro");
  assert.equal(formatMoney(0, COINS), "0");
  assert.equal(formatMoney(1234, COINS), "12 Ouro, 3 Prata e 4 Cobre");
  const wallet = { gold: 1 };
  const delta = payUnits(wallet, COINS, 58, "gold").delta;
  const spent = applyDelta(wallet, delta);
  assert.deepEqual(spent.wallet, { gold: 0, silver: 4, copper: 2 });
  assert.deepEqual(applyDelta(spent.wallet, invertDelta(delta)).wallet, { gold: 1, silver: 0, copper: 0 });
  assert.equal(applyDelta({ gold: 0 }, { gold: -1 }).ok, false, "não deixa a moeda negativa");
  const up = walletUpdate({ gold: 5, silver: 1 }, { gold: -2, copper: 7 });
  assert.deepEqual(up, { ok: true, update: { "system.currencies.gold": 3, "system.currencies.copper": 7 } });
  assert.equal(walletUpdate({ gold: 1 }, { gold: -2 }).ok, false);
});

test("Compra de volta: fração do preço geral, proporcional de cargas e de munição aberta", () => {
  assert.equal(buybackUnits({ baseUnits: 4000, fraction: 0.5 }), 2000);
  assert.equal(buybackUnits({ baseUnits: 4000, fraction: 0.5, factor: 3 }), 6000);
  assert.equal(buybackUnits({ baseUnits: 4000, fraction: 2 }), 4000, "fração acima de 100% é cortada");
  // sem cargas: cada unidade vale 1
  assert.deepEqual(soldUnitsFactor({ quantity: 5, sell: 3 }), { factor: 3, sell: 3, openGoes: false });
  // 5 unidades de 4 cargas, a aberta já gastou 1 (3/4): vender tudo leva a aberta pela proporção
  assert.deepEqual(soldUnitsFactor({ quantity: 5, sell: 5, charges: 4, used: 1 }), { factor: 4.75, sell: 5, openGoes: true });
  // vender parte da pilha: saem as cheias, a aberta fica
  assert.deepEqual(soldUnitsFactor({ quantity: 5, sell: 2, charges: 4, used: 1 }), { factor: 2, sell: 2, openGoes: false });
  // uma unidade só, meio gasta
  assert.equal(soldUnitsFactor({ quantity: 1, sell: 1, charges: 4, used: 2 }).factor, 0.5);
  assert.equal(soldUnitsFactor({ quantity: 2, sell: 9 }).sell, 2, "não vende mais do que tem");
  assert.equal(soldUnitsFactor({ quantity: 0, sell: 1 }).factor, 0);
  assert.equal(openAmmoFactor(5, 20), 0.25);
  assert.equal(openAmmoFactor(0, 20), 1);
  assert.equal(openAmmoFactor(5, 0), 1, "sem Carga própria não dá para saber: vale cheia");
  assert.equal(openAmmoFactor(30, 20), 1);
});

test("O que não se vende", () => {
  assert.equal(sellBlockedReason({}), "");
  assert.match(sellBlockedReason({ equipped: true }), /equipado/);
  assert.match(sellBlockedReason({ isContainer: true, containerHasItems: true }), /esvazie/);
  assert.equal(sellBlockedReason({ isContainer: true, containerHasItems: false }), "");
  assert.match(sellBlockedReason({ shopEnabled: false }), /não está aberta/);
});

test("Estoque: vazio é infinito, esgotado recusa, compra de volta soma", () => {
  assert.equal(stockLeft(null), null);
  assert.equal(stockLeft(""), null);
  assert.equal(stockLeft(4.7), 4);
  assert.equal(stockLeft(-2), 0);
  assert.equal(stockText(null), "∞");
  assert.equal(stockText(0), "esgotado");
  assert.equal(stockText(5), "5");
  assert.deepEqual(canBuyStock({ stock: null, quantity: 99 }), { ok: true, reason: "" });
  assert.deepEqual(canBuyStock({ stock: 3, quantity: 3 }), { ok: true, reason: "" });
  assert.equal(canBuyStock({ stock: 3, quantity: 4 }).ok, false);
  assert.match(canBuyStock({ stock: 3, quantity: 4 }).reason, /só há 3/);
  assert.equal(canBuyStock({ stock: 0, quantity: 1 }).reason, "esgotado");
  assert.equal(canBuyStock({ stock: 5, quantity: 0 }).ok, false);
  assert.equal(stockAfter(5, 2), 3);
  assert.equal(stockAfter(null, 2), null);
  assert.equal(stockAfter(1, 5), 0);
  assert.equal(stockAfterBuyback(2, 3), 5);
  assert.equal(stockAfterBuyback(null, 3), null, "infinito continua infinito");
  assert.equal(restockedStock({ stock: 0, restockTo: 6 }), 6);
  assert.equal(restockedStock({ stock: 2, restockTo: null }), 2);
  assert.equal(restockedStock({ stock: null, restockTo: null }), null);
});

test("Reposição pelo relógio do mundo", () => {
  const day = 86400;
  assert.deepEqual(restockDue({ restockDays: 0, lastRestock: 0, now: 999999999 }), { due: false, init: false, nextAt: null });
  assert.deepEqual(restockDue({ restockDays: 3, lastRestock: null, now: 500 }), { due: false, init: true, nextAt: null }, "sem marca: a conta começa agora");
  assert.equal(restockDue({ restockDays: 3, lastRestock: 1000, now: 1000 + 3 * day - 1 }).due, false);
  assert.equal(restockDue({ restockDays: 3, lastRestock: 1000, now: 1000 + 3 * day }).due, true);
  assert.equal(restockDue({ restockDays: 3, lastRestock: 1000, now: 1000 + 3 * day }).nextAt, 1000 + 3 * day);
  assert.equal(restockDue({ restockDays: 1, lastRestock: 0, now: 100, dayLength: 50 }).due, true, "o dia do mundo é o do calendário");
  assert.equal(restockDue({ restockDays: 2, lastRestock: 5000, now: 10 }).due, false, "relógio voltou: não reabastece");
});

test("Histórico: teto, só a última se desfaz", () => {
  let h = [];
  for (let i = 1; i <= HISTORY_CAP + 3; i += 1) h = pushHistory(h, { id: `e${i}` });
  assert.equal(h.length, HISTORY_CAP);
  assert.equal(h[0].id, "e4");
  assert.equal(lastUndoable(h).id, `e${HISTORY_CAP + 3}`);
  assert.equal(canUndoEntry(h, `e${HISTORY_CAP + 3}`), true);
  assert.equal(canUndoEntry(h, "e5"), false, "desfazer uma do meio embaralharia o estoque");
  const after = markUndone(h, `e${HISTORY_CAP + 3}`);
  assert.equal(lastUndoable(after).id, `e${HISTORY_CAP + 2}`, "a anterior passa a ser a última");
  assert.equal(h.at(-1).undone, undefined, "não muta");
  assert.equal(lastUndoable([]), null);
  assert.equal(lastUndoable([{ id: "a", undone: true }]), null);
});

test("Troca de dois lados: qualquer mudança apaga os dois aceites", () => {
  assert.deepEqual(normalizeTradeItems([{ id: "a", qty: 2 }, { id: "a", qty: 1 }, { id: "", qty: 3 }, { id: "b", qty: 0 }, { id: "c", qty: 1.9 }]), [{ id: "a", qty: 3 }, { id: "c", qty: 1 }]);
  assert.equal(normalizeTradeCoins({ amount: 0, currency: "gold" }), null);
  assert.deepEqual(normalizeTradeCoins({ amount: 12.345, currency: "gold" }), { amount: 12.35, currency: "gold" });
  let trade = newTrade({ id: "t1" });
  assert.equal(trade.id, "t1");
  assert.equal(tradeReady(trade), false);
  let r = tradeSet(trade, "a", { items: [{ id: "x", qty: 2 }] });
  assert.equal(r.changed, true);
  trade = r.trade;
  trade = tradeSet(trade, "b", { coins: { amount: 120, currency: "gold" } }).trade;
  trade = tradeAccept(trade, "b");
  assert.equal(tradeReady(trade), false, "só um aceitou");
  trade = tradeAccept(trade, "a");
  assert.equal(tradeReady(trade), true);
  // o Mestre muda o valor: os dois aceites caem e a revisão sobe
  const rev = trade.rev;
  r = tradeSet(trade, "b", { coins: { amount: 100, currency: "gold" } });
  assert.equal(r.changed, true);
  assert.deepEqual(r.trade.accepted, { a: false, b: false });
  assert.equal(r.trade.rev, rev + 1);
  // repetir o mesmo valor não faz nada (o aceite fica)
  const same = tradeSet(trade, "b", { coins: { amount: 120, currency: "gold" } });
  assert.equal(same.changed, false);
  assert.equal(tradeReady(same.trade), true);
  // lado inválido e troca vazia
  assert.equal(tradeSet(trade, "z", { items: [] }).changed, false);
  assert.equal(tradeReady(tradeAccept(tradeAccept(newTrade(), "a"), "b")), false, "nada na mesa");
  // a mesma máquina serve a dois jogadores (itens dos dois lados, sem moeda)
  let duel = newTrade();
  duel = tradeSet(duel, "a", { items: [{ id: "p", qty: 1 }] }).trade;
  duel = tradeSet(duel, "b", { items: [{ id: "q", qty: 1 }] }).trade;
  assert.equal(tradeReady(tradeAccept(tradeAccept(duel, "a"), "b")), true);
});

test("Vitrine: categorias, busca sem acento e sugestão da avaliação", () => {
  assert.equal(itemKind({ type: "starship_module", system: {} }), "Módulo");
  assert.equal(itemKind({ type: "item", system: { weapon: { enabled: true } } }), "Arma");
  assert.equal(itemKind({ type: "item", system: { consumable: { enabled: true } } }), "Consumível");
  assert.equal(itemKind({ type: "item", system: { ammo: { enabled: true } } }), "Munição");
  assert.equal(itemKind({ type: "item", system: { container: { enabled: true } } }), "Contêiner");
  assert.equal(itemKind({ type: "item", system: {} }), "Equipamento");
  const rows = [{ name: "Poção de Cura", kind: "Consumível", tags: ["raro"] }, { name: "Espada longa", kind: "Arma", tags: [] }];
  assert.deepEqual(shopCategories(rows), ["Todos", "Consumível", "raro", "Arma"]);
  assert.equal(rowMatches(rows[0], { category: "raro" }), true, "etiqueta vira categoria");
  assert.equal(rowMatches(rows[1], { category: "Consumível" }), false);
  assert.equal(rowMatches(rows[0], { search: "pocao" }), true);
  assert.equal(rowMatches(rows[1], { search: "POCAO" }), false);
  assert.deepEqual(appraisalSuggestion([4000, 10000, 24000], 0.5), { values: [2000, 5000, 12000], total: 19000 });
  assert.deepEqual(appraisalSuggestion([4000], 7), { values: [4000], total: 4000 });
});

test("Validar Mundo: loja aberta sem estoque, item sem preço, jogador que não vê", () => {
  const closed = shopSetupIssues({ shop: { enabled: false }, stock: [] });
  assert.deepEqual(closed, []);
  const empty = shopSetupIssues({ shop: { enabled: true }, stock: [] });
  assert.match(empty[0].message, /nenhum item/);
  const noPrice = shopSetupIssues({ shop: { enabled: true }, stock: [{ name: "Espada", hasPrice: false, stock: null }, { name: "Adaga", hasPrice: true, stock: 2 }] });
  assert.equal(noPrice.length, 1);
  assert.match(noPrice[0].where, /Espada/);
  assert.match(noPrice[0].message, /sem preço base/);
  assert.match(shopSetupIssues({ shop: { enabled: true }, stock: [{ name: "A", hasPrice: true, stock: 0 }] })[0].message, /esgotados/);
  assert.equal(shopSetupIssues({ shop: { enabled: true }, stock: [{ name: "A", hasPrice: true, stock: 1 }] }).length, 0);
  assert.match(shopSetupIssues({ shop: { enabled: true, kind: "auto", buybackFraction: 0 }, stock: [{ name: "A", hasPrice: true, stock: 1 }] })[0].message, /0%/);
  assert.deepEqual(shopSetupIssues({ shop: { enabled: true }, stock: [{ name: "A", hasPrice: true, stock: 1 }], shopsEnabled: false }), [], "bloco desligado: nada a avisar");

  const idx = buildCatalogIndex({});
  const actor = {
    type: "character",
    name: "Yssa",
    system: { shop: { enabled: true }, species: "" },
    items: [
      { type: "item", name: "Poção", system: { shop: { basePrice: 50 }, value: { amount: 0 } } },
      { type: "item", name: "Corda", system: { shop: {}, value: { amount: 15 } } },
      { type: "item", name: "Tralha", system: { shop: {}, value: { amount: 0 } } },
      { type: "item", name: "Moeda rara", system: { shop: { priceOverride: 0 }, value: { amount: 0 } } }
    ]
  };
  const found = validateActor(actor, idx, { shops: true }).filter(i => i.catalog === "shops");
  assert.equal(found.length, 1, "só a Tralha não tem preço (o Valor do Item e o ajuste contam)");
  assert.match(found[0].where, /Tralha/);
  assert.equal(validateActor(actor, idx, { shops: false }).filter(i => i.catalog === "shops").length, 0);
});

test("Bloco Lojas: filho da Economia, ligado nos presets, com grupo e frase", () => {
  const f = NIHILITY.FEATURES.shops;
  assert.ok(f, "FEATURES.shops existe");
  assert.equal(f.parent, "economy");
  assert.equal(f.setting, "shopsEnabled");
  assert.equal(f.group, "world");
  assert.ok(f.short && f.short.length <= 90);
  for (const [name, preset] of Object.entries(NIHILITY.CAMPAIGN_PRESETS)) {
    if (preset.light) continue;
    assert.equal(preset.features.shops, true, `${name} liga as Lojas (todos têm Economia)`);
  }
  assert.ok(!NIHILITY.CAMPAIGN_PRESETS.leve.features.shops, "Deixar leve não mexe nas Lojas");
});
