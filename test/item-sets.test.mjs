/**
 * Conjuntos (J12, 1.122.0): catálogo, contagem de peças, faixas que somam, camada de origem, bônus de Nave,
 * plano de Habilidades concedidas, textos e Validar Mundo. Tudo puro (sem Ator).
 */
import "./setup.mjs";
import { NIHILITY } from "../module/core/config.js";
import test from "node:test";
import assert from "node:assert/strict";

import {
  setSlug, pieceKey, normalizeBonuses, mergeBonuses, normalizeItemSet, normalizeItemSets, missingFactorySets, addPiece,
  pieceKindOf, setFitsItemType, setProgress, evaluateSets, setLayer, setAttributeRows, shipBonusTotals, setSkillKey,
  grantedSkillPlan, describeBonuses, setStripView, itemSetIssues, itemSetRefIssues, sanitizeAISet, itemSetGuide
} from "../module/economy/item-set-rules.js";
import { DEFAULT_ITEM_SETS, DEFAULT_ITEM_SET_PIECES } from "../module/core/config/defaults/item-sets.js";

const dragon = () => normalizeItemSet(DEFAULT_ITEM_SETS[0]);
const owned = (...names) => names.map(n => ({ setId: "armadura_do_dragao", key: pieceKey(n) }));

test("ids e chaves de peça ignoram acento, caixa e espaços", () => {
  assert.equal(setSlug("Armadura do Dragão"), "armadura_do_dragao");
  assert.equal(pieceKey("  Coração  de Brasa "), "coracao de brasa");
});

test("fábrica: 4 conjuntos válidos, cada peça com Item de fábrica e sem problema no Validar Mundo", () => {
  const sets = normalizeItemSets(DEFAULT_ITEM_SETS);
  assert.equal(sets.length, 4);
  assert.equal(sets[3].for, "vessel");
  for (const set of sets) {
    for (const piece of set.pieces) {
      assert.ok(DEFAULT_ITEM_SET_PIECES.some(p => p.set === set.id && pieceKey(p.name) === piece.key), `${set.id}/${piece.name}`);
    }
  }
  assert.deepEqual(itemSetIssues(sets, {}), []);
});

test("normalização: tira bônus zerados, alvo de Nave desconhecido e peça repetida", () => {
  assert.deepEqual(normalizeBonuses({ attributeBonuses: [{ attribute: "x", amount: 0 }], ship: [{ target: "nada", amount: 3 }], statModifiers: { hp: 0, energy: 0 } }), {});
  const set = normalizeItemSet({ label: "A", pieces: [{ name: "Elmo" }, { name: "elmo" }], tiers: [{ count: 3, bonuses: {} }, { count: 2, bonuses: {} }] });
  assert.equal(set.pieces.length, 1);
  assert.deepEqual(set.tiers.map(t => t.count), [2, 3]);
  assert.equal(normalizeItemSets([{ label: "A" }, { label: "A" }, null]).length, 1);
});

test("contagem: peça repetida conta uma; nunca passa do total; faixas somam", () => {
  const set = dragon();
  const keys = new Set(owned("Elmo de Escama", "Elmo de Escama", "Peitoral de Escama", "Manoplas de Garra").map(x => x.key));
  const p = setProgress(set, keys);
  assert.equal(p.count, 3);
  assert.deepEqual(p.tiers.map(t => t.on), [true, true, false]);
  assert.equal(p.nextTier.count, 4);
  const all = setProgress(set, new Set(["a", "b", "c", "d", "e"]));
  assert.equal(all.count, 4);
  assert.equal(all.activeTiers.length, 3);
});

test("evaluateSets separa Personagem de Nave e ignora conjunto sem peça", () => {
  const sets = normalizeItemSets(DEFAULT_ITEM_SETS);
  const list = evaluateSets(sets, [...owned("Elmo de Escama"), { setId: "kit_de_caca", key: "sensor de caca" }], "character");
  assert.deepEqual(list.map(p => p.id), ["armadura_do_dragao"]);
  assert.deepEqual(evaluateSets(sets, owned("Elmo de Escama"), "vessel"), []);
});

test("camada de origem: sem atributo (vai por fora), com o andamento no nome", () => {
  const set = dragon();
  const p = setProgress(set, new Set(owned("Elmo de Escama", "Peitoral de Escama", "Manoplas de Garra").map(x => x.key)));
  const layer = setLayer(p);
  assert.equal(layer.kindLabel, "Conjunto");
  assert.equal(layer.label, "Armadura do Dragão (3/4)");
  assert.equal(layer.passives.attributeBonuses, undefined);
  assert.deepEqual(layer.passives.resistances, [{ target: "fire", amount: 20 }]);
  assert.equal(layer.passives.statModifiers.hp, 25);
  assert.equal(layer.entry.label, layer.label);
  assert.deepEqual(setAttributeRows([p], "defense"), [{ label: "Conjunto: Armadura do Dragão (3/4)", value: 1, setId: "armadura_do_dragao" }]);
  assert.deepEqual(setAttributeRows([p], "magic"), []);
  assert.equal(setLayer(setProgress(set, new Set(["x"]))), null);
});

test("Nave: bônus somam entre faixas e conjuntos", () => {
  const kit = normalizeItemSet(DEFAULT_ITEM_SETS[3]);
  const two = setProgress(kit, new Set(["a", "b"]));
  const three = setProgress(kit, new Set(["a", "b", "c"]));
  assert.deepEqual(shipBonusTotals([two]), { evasion: 5 });
  assert.deepEqual(shipBonusTotals([three]), { evasion: 5, signature: -10 });
  assert.deepEqual(shipBonusTotals([two, two]), { evasion: 10 });
});

test("Habilidade concedida: cria a que falta, remove a que sobrou, nunca duplica", () => {
  const set = dragon();
  const four = setProgress(set, new Set(["a", "b", "c", "d"]));
  const key = setSkillKey("armadura_do_dragao", 4);
  assert.equal(key, "set:armadura_do_dragao:4");
  const plan = grantedSkillPlan([four], ["item123"]);
  assert.deepEqual(plan.create.map(c => c.key), [key]);
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(grantedSkillPlan([four], [key]), { create: [], remove: [] });
  const three = setProgress(set, new Set(["a", "b", "c"]));
  assert.deepEqual(grantedSkillPlan([three], [key]), { create: [], remove: [key] });
  assert.deepEqual(grantedSkillPlan([], [key, "item123"]).remove, [key]);
});

test("mergeBonuses soma Vida/Mana e Sorte e junta as listas", () => {
  const m = mergeBonuses([{ statModifiers: { hp: 10, energy: 0 }, luck: { attributes: 5 } }, { statModifiers: { hp: 5, energy: 2 }, luck: { damage: 3 }, resistances: [{ target: "fire", amount: 10 }] }]);
  assert.deepEqual(m.passives.statModifiers, { hp: 15, energy: 2 });
  assert.deepEqual(m.passives.luck, { attributes: 5, damage: 3, chances: 0 });
  assert.equal(m.passives.resistances.length, 1);
});

test("textos da faixa e da ficha", () => {
  const labels = { attributeLabel: k => ({ defense: "Defesa" }[k] ?? k), targetLabel: id => ({ fire: "Fogo" }[id] ?? id), energyLabel: "Mana" };
  assert.deepEqual(describeBonuses({ resistances: [{ target: "fire", amount: 20 }] }, labels), ["Resistência a Fogo 20%"]);
  assert.deepEqual(describeBonuses({ attributeBonuses: [{ attribute: "defense", amount: 1 }], statModifiers: { hp: 0, energy: 20 } }, labels), ["+1 Defesa", "Mana máx. +20"]);
  const view = setStripView(setProgress(dragon(), new Set(["a", "b", "c"])), labels);
  assert.equal(view.count, 3);
  assert.deepEqual(view.pips.map(p => p.on), [true, true, true, false]);
  assert.deepEqual(view.tiers.map(t => t.on), [true, true, false]);
});

test("peças: etiqueta, tipo de conjunto e adicionar sem repetir", () => {
  assert.equal(pieceKindOf({ type: "item", system: { weapon: { enabled: true } } }), "arma");
  assert.equal(pieceKindOf({ type: "item", system: { implant: { enabled: true, kind: "implant" } } }), "implante");
  assert.equal(pieceKindOf({ type: "starship_module", system: {} }), "módulo");
  assert.ok(setFitsItemType({ for: "vessel" }, "starship_module"));
  assert.ok(!setFitsItemType({ for: "character" }, "starship_module"));
  const list = addPiece(addPiece([], { name: "Elmo", kind: "armadura" }), { name: "ELMO", uuid: "Item.x" });
  assert.equal(list.length, 1);
  assert.equal(list[0].uuid, "Item.x");
  assert.equal(list[0].kind, "armadura");
});

test("Trazer do padrão só acrescenta os que faltam", () => {
  const mine = normalizeItemSets([{ ...DEFAULT_ITEM_SETS[0], label: "Minha armadura" }]);
  assert.deepEqual(missingFactorySets(mine, DEFAULT_ITEM_SETS).map(s => s.id), ["vestes_do_arquimago", "traje_tatico_kestrel", "kit_de_caca"]);
});

test("Validar Mundo: sem peças, faixa maior que as peças, id inexistente no Item", () => {
  const sets = normalizeItemSets([
    { id: "vazio", label: "Vazio", pieces: [], tiers: [{ count: 2, bonuses: { resistances: [{ target: "fire", amount: 10 }] } }] },
    { id: "curto", label: "Curto", pieces: [{ name: "A" }, { name: "B" }], tiers: [{ count: 3, bonuses: { resistances: [{ target: "xx", amount: 10 }] } }, { count: 2, bonuses: {} }] }
  ]);
  const text = itemSetIssues(sets, { elementIds: new Set(["fire"]), attributeKeys: new Set(["defense"]) }).map(i => i.text).join(" | ");
  assert.match(text, /nenhuma peça/);
  assert.match(text, /maior que o número de peças/);
  assert.match(text, /"xx"/);
  assert.match(text, /nenhum bônus/);
  const refs = itemSetRefIssues([
    { label: "Elmo", type: "item", setId: "sumiu" },
    { label: "Casco", type: "starship_module", setId: "curto" },
    { label: "ok", type: "item", setId: "curto" },
    { label: "livre", type: "item", setId: "" }
  ], sets);
  assert.equal(refs.length, 2);
});

test("IA: só atributo e elemento que existem, faixa dentro do nº de peças", () => {
  const ctx = { attributeKeys: new Set(["defense"]), elementIds: new Set(["fire"]), existingIds: new Set(["lobo"]) };
  const set = sanitizeAISet({ label: "Lobo", pieces: ["Capa", { name: "Colar" }, "Bota"], tiers: [
    { count: 2, bonuses: { attributeBonuses: [{ attribute: "defense", amount: 99 }, { attribute: "inventado", amount: 1 }], resistances: [{ target: "fire", amount: 90 }, { target: "zzz", amount: 5 }] } },
    { count: 9, bonuses: { attributeBonuses: [{ attribute: "defense", amount: 1 }] } }
  ] }, ctx);
  assert.equal(set.id, "lobo_2");
  assert.equal(set.tiers.length, 1);
  assert.deepEqual(set.tiers[0].bonuses.attributeBonuses, [{ attribute: "defense", amount: 5 }]);
  assert.deepEqual(set.tiers[0].bonuses.resistances, [{ target: "fire", amount: 60 }]);
  assert.equal(sanitizeAISet({ label: "" }, ctx), null);
  assert.match(itemSetGuide({ attributes: [{ key: "defense", label: "Defesa" }], elements: [] }), /defense/);
});

test("isBareSensorPiece: só a versão vazia de fábrica do Sensor de Caça é consertada", async () => {
  const { isBareSensorPiece } = await import("../module/economy/item-set-rules.js");
  assert.equal(isBareSensorPiece({ functions: [], sensorRange: 0, sensorResolution: 0 }), true);
  assert.equal(isBareSensorPiece({}), true);
  assert.equal(isBareSensorPiece({ functions: ["sensor"], sensorRange: 0 }), false);
  assert.equal(isBareSensorPiece({ functions: [], sensorRange: 12 }), false);
  const piece = NIHILITY.DEFAULT_ITEM_SET_PIECES.find(p => p.key === "sensor_de_caca");
  assert.equal(isBareSensorPiece(piece.system), false);
  assert.ok(piece.system.functions.includes("sensor") && piece.system.sensorRange > 0 && piece.system.sensorResolution > 0);
});
