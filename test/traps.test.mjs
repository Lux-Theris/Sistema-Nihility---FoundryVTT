import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTrap, trapHasEffect, trapGroundOk, trapShouldFire, trapImmune, trapDisarmedByField,
  trapDisarmedByEmission, polygonSegments, closedShapesOverlap, describeTrap
} from "../module/environment/trap-rules.js";
import { validateTrap, buildCatalogIndex } from "../module/world/world-validator.js";
import { areaTouchesStructure } from "../module/structures/structure-geometry.js";

test("normalizeTrap: padrões e limpeza", () => {
  const t = normalizeTrap({});
  assert.equal(t.trigger, "once");
  assert.equal(t.reach, "ground");
  assert.equal(t.level, 0);
  assert.deepEqual(t.elements, []);
  const full = normalizeTrap({ formula: " 2d6 ", damageElements: new Set(["fire", "fire", "ice"]), isMagicDamage: 1, conditionId: "slow", level: "3.7", magic: true, trigger: "always", reach: "any", immuneTraits: ["flying"], reveal: true });
  assert.equal(full.formula, "2d6");
  assert.deepEqual(full.elements, ["fire", "ice"]);
  assert.equal(full.magicDamage, true);
  assert.equal(full.level, 3);
  assert.equal(full.trigger, "always");
  assert.equal(full.reach, "any");
  assert.equal(normalizeTrap({ trigger: "lixo", reach: "lixo" }).trigger, "once");
});

test("trapHasEffect: dano ou Condição", () => {
  assert.equal(trapHasEffect(normalizeTrap({})), false);
  assert.equal(trapHasEffect(normalizeTrap({ formula: "1d4" })), true);
  assert.equal(trapHasEffect(normalizeTrap({ conditionId: "net" })), true);
});

test("trapGroundOk: entre -0,5 e 0,5 m pisa no chão", () => {
  assert.equal(trapGroundOk(0), true);
  assert.equal(trapGroundOk(0.5), true);
  assert.equal(trapGroundOk(-0.5), true);
  assert.equal(trapGroundOk(2), false);
  assert.equal(trapGroundOk(-3), false);
  assert.equal(trapGroundOk(undefined), true);
});

test("trapShouldFire: desarmada, sem efeito, imune e no ar", () => {
  const trap = normalizeTrap({ formula: "2d6" });
  assert.deepEqual(trapShouldFire(trap, {}), { fire: true, reason: null });
  assert.equal(trapShouldFire(trap, { disarmed: true }).reason, "disarmed");
  assert.equal(trapShouldFire(normalizeTrap({}), {}).reason, "noEffect");
  assert.equal(trapShouldFire(trap, { immune: true }).reason, "immune");
  assert.equal(trapShouldFire(trap, { elevation: 4 }).reason, "air");
  assert.equal(trapShouldFire(normalizeTrap({ formula: "1d4", reach: "any" }), { elevation: 4 }).fire, true);
  // Bloco de elevação desligado: a altura não conta.
  assert.equal(trapShouldFire(trap, { elevation: 4, elevationOn: false }).fire, true);
});

test("trapImmune", () => {
  const trap = normalizeTrap({ formula: "1", immuneTraits: ["mechanical", "ghost"] });
  assert.equal(trapImmune(trap, ["ghost"]), true);
  assert.equal(trapImmune(trap, ["human"]), false);
  assert.equal(trapImmune(trap, []), false);
});

test("trapDisarmedByField: campo do mesmo tipo e nível ≥ o dela", () => {
  const magic = normalizeTrap({ formula: "1", magic: true, level: 3 });
  assert.equal(trapDisarmedByField(magic, { magic: 3 }), "magic");
  assert.equal(trapDisarmedByField(magic, { magic: 2 }), null);
  assert.equal(trapDisarmedByField(magic, { tech: 9 }), null);
  const tech = normalizeTrap({ formula: "1", tech: true, level: 2 });
  assert.equal(trapDisarmedByField(tech, { tech: 2 }), "tech");
  assert.equal(trapDisarmedByField(tech, { magic: 5 }), null);
  const both = normalizeTrap({ formula: "1", magic: true, tech: true, level: 4 });
  assert.equal(trapDisarmedByField(both, { tech: 4 }), "tech");
  const plain = normalizeTrap({ formula: "1", level: 0 });
  assert.equal(trapDisarmedByField(plain, { magic: 9, tech: 9 }), null);
  // Nível 0 + mágica: qualquer campo de verdade (> 0) desarma; sem campo, não.
  const lvl0 = normalizeTrap({ formula: "1", magic: true });
  assert.equal(trapDisarmedByField(lvl0, { magic: 1 }), "magic");
  assert.equal(trapDisarmedByField(lvl0, { magic: 0 }), null);
});

test("trapDisarmedByEmission: natureza e alcance", () => {
  const magic = normalizeTrap({ formula: "1", magic: true, level: 5 });
  assert.equal(trapDisarmedByEmission(magic, "magic", 5), true);
  assert.equal(trapDisarmedByEmission(magic, "magic", 4.9), false);
  assert.equal(trapDisarmedByEmission(magic, "tech", 99), false);
  const both = normalizeTrap({ formula: "1", magic: true, tech: true, level: 5 });
  assert.equal(trapDisarmedByEmission(both, "tech", 6), true);
  assert.equal(trapDisarmedByEmission(normalizeTrap({ formula: "1" }), "magic", 99), false);
  assert.equal(trapDisarmedByEmission(magic, "outro", 99), false);
});

test("polygonSegments e closedShapesOverlap", () => {
  const square = polygonSegments([0, 0, 100, 0, 100, 100, 0, 100]);
  assert.equal(square.length, 4);
  assert.deepEqual(square[3], [0, 100, 0, 0]);
  assert.deepEqual(polygonSegments([0, 0, 10, 10]), []);
  const inside = polygonSegments([20, 20, 40, 20, 40, 40, 20, 40]);
  const crossing = polygonSegments([80, 80, 180, 80, 180, 180, 80, 180]);
  const apart = polygonSegments([300, 300, 400, 300, 400, 400, 300, 400]);
  assert.equal(closedShapesOverlap(square, inside), true);
  assert.equal(closedShapesOverlap(inside, square), true);
  assert.equal(closedShapesOverlap(square, crossing), true);
  assert.equal(closedShapesOverlap(square, apart), false);
  assert.equal(closedShapesOverlap([], square), false);
});

test("a Região da armadilha entra no teste da área de Antimagia em Emissão", () => {
  const square = polygonSegments([0, 0, 100, 0, 100, 100, 0, 100]);
  assert.equal(areaTouchesStructure({ shape: "circle", x: 50, y: 50, radius: 10, angle: 0, direction: 0, width: 0 }, square, true), true);
  assert.equal(areaTouchesStructure({ shape: "circle", x: 400, y: 400, radius: 10, angle: 0, direction: 0, width: 0 }, square, true), false);
});

test("describeTrap", () => {
  const trap = normalizeTrap({ formula: "2d6", damageElements: ["fire"], conditionId: "slow", magic: true, level: 3 });
  assert.equal(describeTrap(trap, { conditionLabel: "Lentidão", elementLabels: ["Fogo"] }), "2d6 de Fogo · Lentidão · mágica nível 3");
});

test("Validar Mundo: Condição, elemento e Traço que sumiram do catálogo", () => {
  const idx = buildCatalogIndex({ conditions: [{ id: "slow" }], elements: [{ id: "fire" }], traits: [{ id: "flying" }] });
  assert.deepEqual(validateTrap({ conditionId: "slow", damageElements: new Set(["fire"]), immuneTraits: new Set(["flying"]) }, idx), []);
  const issues = validateTrap({ conditionId: "sumiu", damageElements: ["fire", "raio"], immuneTraits: ["asas"] }, idx);
  assert.equal(issues.length, 3);
  assert.ok(issues.some(i => i.catalog === "conditions" && i.ref === "sumiu"));
  assert.ok(issues.some(i => i.catalog === "elements" && i.ref === "raio"));
  assert.ok(issues.some(i => i.catalog === "traits" && i.ref === "asas"));
});
