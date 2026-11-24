/**
 * Lojas (G2, lote C): o app Compras do PAD — rede, prazo e entrega, destino (depósito ou porão
 * atracado), linhas do carrinho, estado do pedido e Validar Mundo. Só as regras puras.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeShop, normalizeItemShop, shopNetworkState, deliveryHoursFor, arriveAtFor, deliveryLabel, chooseDestination,
  destinationOptions, normalizeOrderLines, groupByShop, cartChange, pushOrders, orderState, shopSetupIssues,
  MAX_ORDER_LINES, ORDERS_CAP, MAX_DELIVERY_HOURS
} from "../module/economy/shop-rules.js";
import { normalizeDelivery } from "../module/economy/loot-rules.js";

test("Loja: prazo de entrega da loja e do item normalizam", () => {
  assert.equal(normalizeShop({}).deliveryHours, 0);
  assert.equal(normalizeShop({ deliveryHours: 48 }).deliveryHours, 48);
  assert.equal(normalizeShop({ deliveryHours: -3 }).deliveryHours, 0);
  assert.equal(normalizeShop({ deliveryHours: "abc" }).deliveryHours, 0);
  assert.equal(normalizeShop({ deliveryHours: 1e9 }).deliveryHours, MAX_DELIVERY_HOURS);
  const item = normalizeItemShop({ digital: true, deliveryHours: "12" });
  assert.equal(item.digital, true);
  assert.equal(item.deliveryHours, 12);
  assert.equal(normalizeItemShop({}).digital, false);
  assert.equal(normalizeItemShop({}).deliveryHours, null, "vazio = o prazo da loja");
  assert.equal(normalizeItemShop({ deliveryHours: -1 }).deliveryHours, null);
});

test("Rede: sem energia ou sem rede não compra; sem Calendário a rede vale sempre", () => {
  assert.equal(shopNetworkState({ calendarOn: true, network: true }).ok, true);
  assert.deepEqual(shopNetworkState({ calendarOn: true, network: false }).state, "noNetwork");
  assert.equal(shopNetworkState({ calendarOn: true, network: false }).reason, "sem rede aqui");
  const pem = shopNetworkState({ calendarOn: true, network: true, suppressed: true });
  assert.equal(pem.ok, false);
  assert.equal(pem.state, "suppressed", "o PEM vence mesmo com rede");
  assert.equal(shopNetworkState({ calendarOn: false, network: false }).ok, true, "Calendário desligado: a rede não existe como conceito");
  assert.equal(shopNetworkState({ calendarOn: false, suppressed: true }).ok, false);
});

test("Prazo: software chega na hora; item usa o próprio prazo, senão o da loja", () => {
  assert.equal(deliveryHoursFor({ digital: true, itemHours: 10, shopHours: 48 }), 0);
  assert.equal(deliveryHoursFor({ itemHours: 6, shopHours: 48 }), 6);
  assert.equal(deliveryHoursFor({ itemHours: null, shopHours: 48 }), 48);
  assert.equal(deliveryHoursFor({ itemHours: 0, shopHours: 48 }), 0, "0 no item = na hora, mesmo com prazo na loja");
  assert.equal(deliveryHoursFor({ itemHours: -5, shopHours: 24 }), 24);
  assert.equal(deliveryHoursFor({}), 0);
});

test("Prazo: arriveAt e a etiqueta", () => {
  assert.equal(arriveAtFor(1000, 0), null);
  assert.equal(arriveAtFor(1000, 2), 1000 + 7200);
  assert.equal(arriveAtFor(1000, 0.5), 1000 + 1800);
  assert.equal(deliveryLabel(0), "na hora");
  assert.equal(deliveryLabel(48), "2 dias");
  assert.equal(deliveryLabel(24), "1 dia");
  assert.equal(deliveryLabel(36), "1,5 dias");
  assert.equal(deliveryLabel(6), "6 h");
  assert.equal(deliveryLabel(10, 36000), "1 dia", "dia do mundo de 10 h");
});

test("Destino: depósito do lugar, porão só com a nave atracada, sem endereço recusa", () => {
  const depot = { uuid: "Actor.d1", name: "Depósito: Estação Kalis" };
  const ships = [{ uuid: "Actor.s1", name: "Nave Sem Nome", docked: true }, { uuid: "Actor.s2", name: "Outra", docked: false }];
  assert.deepEqual(chooseDestination({ requested: "depot", depot, ships }), { ok: true, mode: "depot", shipUuid: "", reason: "" });
  assert.deepEqual(chooseDestination({ requested: "", depot, ships }).mode, "depot", "sem escolha vale o depósito");
  const ship = chooseDestination({ requested: "Actor.s1", depot, ships });
  assert.equal(ship.ok, true);
  assert.equal(ship.mode, "ship");
  assert.equal(ship.shipUuid, "Actor.s1");
  const away = chooseDestination({ requested: "Actor.s2", depot, ships });
  assert.equal(away.ok, false);
  assert.match(away.reason, /não está atracada/);
  assert.equal(chooseDestination({ requested: "Actor.zzz", depot, ships }).ok, false, "nave que ele não tripula");
  const none = chooseDestination({ requested: "depot", depot: null, ships });
  assert.equal(none.ok, false);
  assert.equal(none.reason, "sem endereço de entrega aqui");
  assert.equal(chooseDestination({ requested: "Actor.s1", depot: null, ships }).ok, false, "atracada exige um depósito");
  assert.equal(chooseDestination({ needsAddress: false, depot: null }).ok, true, "carrinho só de software não precisa de endereço");
  assert.equal(chooseDestination({ needsAddress: false }).mode, "none");
});

test("Destino: as opções do carrinho e a escolhida", () => {
  const depot = { uuid: "Actor.d1", name: "Depósito X" };
  const ships = [{ uuid: "Actor.s1", name: "Alfa", docked: false }];
  const opts = destinationOptions({ depot, ships, selected: "Actor.s1" });
  assert.equal(opts.length, 2);
  assert.equal(opts[0].selected, true, "a nave desligada não pode ser a escolhida: cai no depósito");
  assert.equal(opts[1].disabled, true);
  assert.match(opts[1].hint, /não está atracada/);
  const noDepot = destinationOptions({ depot: null, ships: [] });
  assert.equal(noDepot[0].disabled, true);
  assert.equal(noDepot.some(o => o.selected), false);
  const docked = destinationOptions({ depot, ships: [{ uuid: "Actor.s1", name: "Alfa", docked: true }], selected: "Actor.s1" });
  assert.equal(docked[1].selected, true);
});

test("Pedido: linhas normalizadas, somadas e limitadas", () => {
  const lines = normalizeOrderLines([
    { shopUuid: "Actor.a", itemId: "i1", qty: 2 },
    { shopUuid: "Actor.a", itemId: "i1", quantity: 3 },
    { shopUuid: "Actor.b", itemId: "i2", qty: 1 },
    { shopUuid: "", itemId: "i3", qty: 1 },
    { shopUuid: "Actor.b", itemId: "i4", qty: 0 },
    { shopUuid: "Actor.b", itemId: "i5", qty: "x" },
    null
  ]);
  assert.deepEqual(lines, [{ shopUuid: "Actor.a", itemId: "i1", qty: 5 }, { shopUuid: "Actor.b", itemId: "i2", qty: 1 }]);
  assert.deepEqual(normalizeOrderLines("x"), []);
  assert.equal(normalizeOrderLines([{ shopUuid: "a", itemId: "b", qty: 5000 }])[0].qty, 999);
  const many = Array.from({ length: 50 }, (_, i) => ({ shopUuid: "Actor.a", itemId: `i${i}`, qty: 1 }));
  assert.equal(normalizeOrderLines(many).length, MAX_ORDER_LINES);
  const groups = groupByShop(normalizeOrderLines([{ shopUuid: "A", itemId: "1", qty: 1 }, { shopUuid: "B", itemId: "2", qty: 1 }, { shopUuid: "A", itemId: "3", qty: 1 }]));
  assert.deepEqual(groups.map(g => [g.shopUuid, g.lines.length]), [["A", 2], ["B", 1]]);
});

test("Carrinho: soma, tira e não muta", () => {
  const key = { shopUuid: "Actor.a", itemId: "i1" };
  const one = cartChange([], key, 1);
  assert.deepEqual(one, [{ shopUuid: "Actor.a", itemId: "i1", qty: 1 }]);
  const three = cartChange(one, key, 2);
  assert.equal(three[0].qty, 3);
  assert.equal(one[0].qty, 1, "a lista antiga não muda");
  assert.deepEqual(cartChange(three, key, -3), []);
  assert.deepEqual(cartChange([], key, -1), [], "tirar de um carrinho vazio não cria linha");
  assert.equal(cartChange(three, key, 5000)[0].qty, 999);
});

test("Pedidos: os novos vão na frente e o histórico tem teto", () => {
  const old = Array.from({ length: ORDERS_CAP }, (_, i) => ({ id: `o${i}` }));
  const next = pushOrders(old, [{ id: "novo" }, null]);
  assert.equal(next.length, ORDERS_CAP);
  assert.equal(next[0].id, "novo");
  assert.deepEqual(pushOrders(null, [{ id: "a" }]), [{ id: "a" }]);
});

test("Pedido: estado pelo relógio do mundo", () => {
  const physical = { mode: "depot", orderedAt: 1000, arriveAt: 2000 };
  const transit = orderState(physical, 1500);
  assert.equal(transit.state, "transit");
  assert.equal(transit.progress, 0.5);
  assert.equal(transit.remaining, 500);
  assert.equal(orderState(physical, 2000).state, "arrived");
  assert.equal(orderState(physical, 2500, { gone: true }).state, "taken", "já retirado do depósito");
  assert.equal(orderState({ mode: "digital", orderedAt: 1000, arriveAt: null }, 1001).state, "arrived");
  assert.equal(orderState({ mode: "digital", orderedAt: 1000 }, 1001, { gone: true }).state, "arrived");
  assert.equal(orderState({ mode: "ship", orderedAt: 1000, arriveAt: null }, 5000, { gone: true }).state, "arrived", "no porão não existe 'retirado'");
  assert.equal(orderState({ mode: "depot", orderedAt: 1000, arriveAt: 1000 }, 0).progress, 0);
});

test("Entrega a caminho guarda a nave de destino", () => {
  const d = normalizeDelivery({ ownerUuid: "Actor.k", status: "transit", arriveAt: 1000, shipUuid: "Actor.s1" });
  assert.equal(d.shipUuid, "Actor.s1");
  assert.equal(normalizeDelivery({ ownerUuid: "Actor.k" }).shipUuid, "");
});

test("Validar Mundo: loja online sem depósito em lugar nenhum e item digital com prazo", () => {
  const physical = { name: "Reator", stock: null, hasPrice: true, digital: false, deliveryHours: null };
  const software = { name: "Quickhack", stock: null, hasPrice: true, digital: true, deliveryHours: 5 };
  const off = shopSetupIssues({ shop: { enabled: true, online: false }, stock: [physical], depotAnywhere: false });
  assert.equal(off.length, 0, "loja que não é online não é cobrada");
  const noDepot = shopSetupIssues({ shop: { enabled: true, online: true }, stock: [physical], depotAnywhere: false });
  assert.equal(noDepot.some(i => /nenhuma cena/.test(i.message)), true);
  const onlySoftware = shopSetupIssues({ shop: { enabled: true, online: true }, stock: [{ ...software, deliveryHours: null }], depotAnywhere: false });
  assert.equal(onlySoftware.length, 0, "só software não precisa de depósito");
  const withDepot = shopSetupIssues({ shop: { enabled: true, online: true }, stock: [physical], depotAnywhere: true });
  assert.equal(withDepot.length, 0);
  const digitalWithTerm = shopSetupIssues({ shop: { enabled: true, online: true }, stock: [software], depotAnywhere: true });
  assert.equal(digitalWithTerm.length, 1);
  assert.match(digitalWithTerm[0].message, /digital com prazo/);
});
