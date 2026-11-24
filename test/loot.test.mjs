/**
 * Lojas (G2, lote B): distância, corpo saqueável, pilhas, depósito de entregas, máquina de venda,
 * troca entre jogadores, acesso "Mostrar aos jogadores" e Validar Mundo. Critério e como rodar: ver o
 * cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  rectGapDistance, nearestGap, metersText, isNear, farText, bodyLootable, bodyStateText, pileName, mergeTarget, pileTokenPosition,
  totalQty, clearPilesSummary, normalizeDelivery, deliveryState, deliveryDue, etaText, splitDeposit, machinePageCount, machinePageLetter,
  machineCode, machineLayout, parseMachineCode, machineFind, machinePress, machineColor, tradeCandidates, tradeSideOf, otherSide,
  tradeBanner, tradeHasContent, tradeSideText, lootIssues
} from "../module/economy/loot-rules.js";
import { newTrade, tradeSet, tradeAccept, tradeReady, normalizeShop, canUseShop, shownDiff, isMachineShop, shopSetupIssues } from "../module/economy/shop-rules.js";
import { SCENE_FIELDS, normalizeCfg, resolveField, fieldValueText } from "../module/environment/scene-config-rules.js";

test("Distância: borda a borda, encostado = 0 e a grade dá os metros", () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(rectGapDistance(a, { x: 100, y: 0, w: 100, h: 100 }, 100, 1), 0);
  assert.equal(rectGapDistance(a, { x: 300, y: 0, w: 100, h: 100 }, 100, 1), 2);
  assert.equal(rectGapDistance(a, { x: 300, y: 0, w: 100, h: 100 }, 100, 1.5), 3);
  assert.equal(Math.round(rectGapDistance(a, { x: 200, y: 200, w: 100, h: 100 }, 100, 1) * 100) / 100, 1.41);
  assert.equal(rectGapDistance(a, { x: 50, y: 50, w: 0, h: 0 }, 100, 1), 0, "ponto dentro");
  assert.equal(nearestGap([], a), null);
  assert.equal(nearestGap([{ x: 500, y: 0, w: 100, h: 100 }, { x: 200, y: 0, w: 100, h: 100 }], a, 100, 1), 1);
});

test("Perto: até o alcance, com folga de arredondamento; texto de longe", () => {
  assert.equal(isNear(2, 2), true);
  assert.equal(isNear(2.0000001, 2), true);
  assert.equal(isNear(2.2, 2), false);
  assert.equal(isNear(null, 2), false);
  assert.equal(metersText(3.44), "3,4 m");
  assert.equal(farText(3.4, 2), "Você está a 3,4 m · chegue a 2 m");
  assert.match(farText(null), /Token/);
});

test("Corpo: loja nunca; morto sim; Vida 0 só de NPC", () => {
  assert.equal(bodyLootable({ isShop: true, dead: true }), false);
  assert.equal(bodyLootable({ dead: true, hp: 10, npc: false }), true);
  assert.equal(bodyLootable({ hp: 0, npc: true }), true);
  assert.equal(bodyLootable({ hp: 0, npc: false }), false, "PJ caído não é saqueado");
  assert.equal(bodyLootable({ hp: 5, npc: true }), false);
  assert.equal(bodyStateText({ dead: true }), "morto");
  assert.equal(bodyStateText({ hp: 0 }), "caído");
  assert.equal(bodyStateText({ hp: 3 }), "");
});

test("Pilhas: nome, junta com a pilha perto, posição na grade, resumo de limpar", () => {
  assert.equal(pileName("Kaito"), "Pilha de Kaito");
  assert.equal(pileName(""), "Pilha");
  const piles = [{ id: "p1", x: 100, y: 100, w: 100, h: 100 }, { id: "p2", x: 400, y: 400, w: 100, h: 100 }];
  assert.equal(mergeTarget(piles, { x: 160, y: 140 }, 100), "p1");
  assert.equal(mergeTarget(piles, { x: 300, y: 300 }, 100), null);
  assert.deepEqual(pileTokenPosition({ x: 250, y: 349 }, 100), { x: 200, y: 300 });
  assert.deepEqual(pileTokenPosition({ x: 250, y: 350 }, 100, { square: false }), { x: 200, y: 300 });
  assert.equal(totalQty([{ qty: 2 }, { quantity: 3 }, { qty: -1 }]), 5);
  const sum = clearPilesSummary({ pileCount: 14, itemCount: 38, sceneName: "Mercado" });
  assert.equal(sum.title, "Remover 14 pilhas?");
  assert.match(sum.body, /38 no total/);
  assert.equal(sum.done, "14 pilhas removidas da cena Mercado");
  assert.equal(clearPilesSummary({ pileCount: 0 }).empty, true);
  assert.equal(clearPilesSummary({ pileCount: 1 }).title, "Remover 1 pilha?");
});

test("Depósito: marca de entrega, estado pelo relógio, prazo e o que cada um vê", () => {
  assert.equal(normalizeDelivery(null), null);
  assert.equal(normalizeDelivery({ ownerName: "x" }), null, "sem dono não é entrega");
  const d = normalizeDelivery({ ownerUuid: "Actor.k", status: "transit", arriveAt: 1000 });
  assert.equal(d.status, "transit");
  assert.equal(deliveryState(d, 999), "transit");
  assert.equal(deliveryState(d, 1000), "arrived");
  assert.equal(deliveryDue(d, 1000), true);
  assert.equal(deliveryDue({ ownerUuid: "a", status: "arrived" }, 5000), false);
  assert.equal(deliveryState({ ownerUuid: "a", status: "transit", arriveAt: null }, 1e9), "transit", "sem prazo fica a caminho até o Mestre marcar");

  const entries = [
    { id: "1", name: "Pistola", qty: 1, delivery: { ownerUuid: "K", status: "arrived" } },
    { id: "2", name: "Painel", qty: 1, delivery: { ownerUuid: "T", status: "arrived" } },
    { id: "3", name: "Reator", qty: 1, delivery: { ownerUuid: "K", status: "transit", arriveAt: 5000 } },
    { id: "4", name: "Solto", qty: 1 }
  ];
  const kaito = splitDeposit(entries, "K", { now: 100 });
  assert.deepEqual(kaito.mine.map(e => e.id), ["1"]);
  assert.deepEqual(kaito.transit.map(e => e.id), ["3"]);
  assert.equal(kaito.others, 1);
  assert.equal(kaito.loose.length, 0, "item sem dono só aparece para o Mestre");
  const gm = splitDeposit(entries, "", { gm: true, now: 100 });
  assert.deepEqual(gm.mine.map(e => e.id), ["1", "2"]);
  assert.deepEqual(gm.loose.map(e => e.id), ["4"]);
  assert.equal(etaText(86400 + 3 * 3600, 86400), "chega em 1 dia · 3h");
  assert.equal(etaText(0), "chega agora");
  assert.equal(etaText(90), "chega em 2 min");
});

test("Máquina: códigos por prateleira, teclado e busca", () => {
  assert.equal(machineCode(0), "A01");
  assert.equal(machineCode(15), "A16");
  assert.equal(machineCode(16), "B01");
  assert.equal(machinePageCount(0), 1);
  assert.equal(machinePageCount(17), 2);
  assert.equal(machinePageCount(100000), 26);
  assert.equal(machinePageLetter(2), "C");
  const layout = machineLayout([{ id: "z", name: "Água" }, { id: "a", name: "Antídoto" }, { id: "b", name: "Bateria" }]);
  assert.deepEqual(layout.map(e => e.code), ["A01", "A02", "A03"]);
  assert.equal(layout[0].name, "Água");
  assert.deepEqual(parseMachineCode("b03"), { page: 1, slot: 2 });
  assert.equal(parseMachineCode("A00"), null);
  assert.equal(parseMachineCode("A17"), null);
  assert.equal(parseMachineCode("A1"), null);
  assert.equal(machineFind(layout, "A02").id, "a");
  assert.equal(machineFind(layout, "A09"), null);
  assert.equal(machinePress("", "b"), "B");
  assert.equal(machinePress("B", "0"), "B0");
  assert.equal(machinePress("B03", "5"), "5", "depois de 3 caracteres recomeça");
  assert.equal(machinePress("A1", "clear"), "");
  assert.equal(machineColor("Poção"), machineColor("Poção"));
});

test("Troca entre jogadores: candidatos, lados, faixa e aceites", () => {
  const list = tradeCandidates(
    [
      { uuid: "m", name: "Mira", isShop: false, distance: 4 },
      { uuid: "t", name: "Thiago", isShop: false, distance: 1.5 },
      { uuid: "y", name: "Yssa", isShop: true, distance: 1 },
      { uuid: "n", name: "Nox", isShop: false, distance: null }
    ],
    2
  );
  assert.equal(list[0].uuid, "t");
  assert.equal(list[0].enabled, true);
  assert.equal(list.find(o => o.uuid === "m").enabled, false);
  const shop = list.find(o => o.uuid === "y");
  assert.equal(shop.kind, "shop");
  assert.equal(shop.enabled, true, "loja a 1 m fica clicável (a até 2 m)");
  assert.match(shop.hint, /loja/);
  const far = tradeCandidates([{ uuid: "d", name: "Depósito", kind: "deposit", distance: 6 }, { uuid: "p", name: "Pilha", kind: "pile", distance: 0.5 }], 2);
  assert.equal(far.find(o => o.uuid === "d").enabled, false, "depósito longe fica desabilitado com a distância");
  assert.match(far.find(o => o.uuid === "d").hint, /longe/);
  assert.equal(far.find(o => o.uuid === "p").enabled, true);
  assert.match(list.find(o => o.uuid === "n").hint, /sem Token/);

  const base = newTrade({ id: "x", status: "open", aUuid: "A", bUuid: "B", aName: "Kaito", bName: "Thiago", changedBy: "" });
  assert.equal(tradeSideOf(base, "A"), "a");
  assert.equal(tradeSideOf(base, "B"), "b");
  assert.equal(tradeSideOf(base, "C"), "");
  assert.equal(otherSide("a"), "b");
  assert.equal(tradeHasContent(base), false);
  assert.equal(tradeBanner(base, "a").cls, "i");

  let t = tradeSet(base, "a", { items: [{ id: "p", qty: 2 }] }).trade;
  t = tradeSet(t, "b", { coins: { amount: 50, currency: "cr" } }).trade;
  assert.equal(tradeHasContent(t), true);
  t = tradeAccept(t, "a", true);
  assert.equal(tradeBanner(t, "a").cls, "w");
  assert.match(tradeBanner(t, "b").text, /Kaito aceitou/);
  t = tradeAccept(t, "b", true);
  assert.equal(tradeReady(t), true);
  // Thiago mexe: os dois aceites caem e Kaito vê o aviso.
  const changed = tradeSet(t, "b", { coins: { amount: 60, currency: "cr" } });
  assert.equal(changed.changed, true);
  assert.deepEqual(changed.trade.accepted, { a: false, b: false });
  const warned = { ...changed.trade, changedBy: "b" };
  assert.match(tradeBanner(warned, "a").text, /Thiago mudou a oferta/);
  assert.equal(tradeBanner(warned, "b").cls, "i", "quem mexeu não vê o aviso");
  assert.equal(tradeBanner({ ...t, status: "done", text: "feito" }, "a").cls, "k");
  assert.equal(tradeBanner({ ...t, status: "cancelled" }, "a").cls, "d");
  assert.equal(tradeSideText([]), "nada");
  assert.equal(tradeSideText(["2× Poção", "Adaga", "50 cr"]), "2× Poção, Adaga e 50 cr");
});

test("Mostrar aos jogadores: só quem está na lista usa a loja", () => {
  assert.deepEqual(normalizeShop({}).shownTo, []);
  assert.deepEqual(normalizeShop({ shownTo: ["u1", "u1", "", "u2"] }).shownTo, ["u1", "u2"]);
  const shop = { enabled: true, shownTo: ["u1"] };
  assert.equal(canUseShop(shop, "u1"), true);
  assert.equal(canUseShop(shop, "u2"), false);
  assert.equal(canUseShop(shop, "u2", { gm: true }), true);
  assert.equal(canUseShop({ enabled: false, shownTo: ["u1"] }, "u1"), false);
  assert.deepEqual(shownDiff(["a"], ["a", "b"]), { added: ["b"], removed: [] });
  assert.deepEqual(shownDiff(["a", "b"], []), { added: [], removed: ["a", "b"] });
});

test("Máquina: só ponto automático; aparência volta ao padrão se vier torta", () => {
  assert.equal(normalizeShop({ style: "machine" }).style, "machine");
  assert.equal(normalizeShop({ style: "xyz" }).style, "standard");
  assert.equal(isMachineShop({ enabled: true, kind: "auto", style: "machine" }), true);
  assert.equal(isMachineShop({ enabled: true, kind: "vendor", style: "machine" }), false);
  assert.equal(isMachineShop({ enabled: false, kind: "auto", style: "machine" }), false);
  const issues = shopSetupIssues({ shop: { enabled: true, kind: "vendor", style: "machine" }, stock: [{ name: "A", hasPrice: true, stock: 1 }] });
  assert.match(issues[0].message, /máquina/);
});

test("Entregas vão para: campo de cena herdável, vazio = sem valor", () => {
  assert.ok(SCENE_FIELDS.depotId);
  assert.deepEqual(normalizeCfg({ depotId: " Actor.abc " }), { depotId: "Actor.abc" });
  assert.deepEqual(normalizeCfg({ depotId: "" }), {});
  assert.deepEqual(normalizeCfg({ depotId: 5 }), {});
  const chain = [{ id: "f", name: "Estação Kalis", cfg: { depotId: "Actor.kalis" } }];
  assert.equal(resolveField("depotId", { own: {}, chain }).value, "Actor.kalis");
  assert.equal(resolveField("depotId", { own: { depotId: "Actor.outro" }, chain }).source, "own");
  assert.equal(resolveField("depotId", { own: {}, chain: [] }).value, "");
  assert.equal(fieldValueText("depotId", "Actor.k", { depotName: "Depósito: Kalis" }), "entregas em Depósito: Kalis");
});

test("Validar Mundo: depósito que sumiu, pilha vazia ou esquecida, item sem dono", () => {
  const issues = lootIssues({
    scenes: [{ name: "Mercado", depotUuid: "Actor.x", depotExists: false }, { name: "Doca", depotUuid: "Actor.y", depotExists: true }, { name: "Sem", depotUuid: "", depotExists: false }],
    folders: [{ name: "Kalis", depotUuid: "Actor.z", depotExists: false }],
    piles: [{ where: "Pilha A", items: 0 }, { where: "Pilha B", items: 3, ageDays: 10 }, { where: "Pilha C", items: 3, ageDays: 1 }],
    deposits: [{ name: "Kalis", strandedItems: 2 }, { name: "Doca", strandedItems: 0 }]
  });
  assert.equal(issues.length, 5);
  assert.match(issues[0].where, /Mercado/);
  assert.match(issues[1].where, /Kalis/);
  assert.match(issues[2].message, /vazia/);
  assert.match(issues[3].message, /10 dias/);
  assert.match(issues[4].message, /sem dono/);
  assert.deepEqual(lootIssues({}), []);
});
