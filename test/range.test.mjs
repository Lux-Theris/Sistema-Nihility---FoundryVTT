/**
 * Alcance de Skill/arma/arremesso e Marcas (H4): regras puras, frase da Skill e aviso do editor.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  inRange,
  markCostFactor,
  markedCost,
  shapeIsFree,
  throwRange,
  clampToRange,
  filterByReach,
  marksReaching,
  placementVia,
  outOfRangeMessage,
  shipRangeUnits,
  markStillValid
} from "../module/combat/range-rules.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";
import { sanitizeSkillMechanics } from "../module/ai/ai-mechanics.js";

test("alcance 0 = sem limite; dentro e fora do alcance", () => {
  assert.equal(inRange(9999, 0), true);
  assert.equal(inRange(10, 10), true);
  assert.equal(inRange(10.0000001, 10), true);
  assert.equal(inRange(10.5, 10), false);
});

test("fator da Marca: quadrático, mínimo 1, 1 sem alcance", () => {
  assert.equal(markCostFactor(5, 10), 1);
  assert.equal(markCostFactor(10, 10), 1);
  assert.equal(markCostFactor(20, 10), 4);
  assert.equal(markCostFactor(30, 10), 9);
  assert.equal(markCostFactor(100, 10), 100);
  assert.equal(markCostFactor(50, 0), 1);
  assert.equal(markedCost(20, 4), 80);
  assert.equal(markedCost(7, 2.25), 16);
});

test("origem da forma: livre por padrão, presa em 'caster', livre a partir do nível", () => {
  assert.equal(shapeIsFree({}), true);
  assert.equal(shapeIsFree({ areaOrigin: null }), true);
  assert.equal(shapeIsFree({ areaOrigin: "free" }), true);
  assert.equal(shapeIsFree({ areaOrigin: "caster", level: 9 }), false);
  assert.equal(shapeIsFree({ areaOrigin: "caster", areaFreeLevel: 5, level: 4 }), false);
  assert.equal(shapeIsFree({ areaOrigin: "caster", areaFreeLevel: 5, level: 5 }), true);
});

test("alcance de arremesso = base + piso(Força ÷ passo)", () => {
  assert.equal(throwRange(10, 0, 5), 10);
  assert.equal(throwRange(10, 24, 5), 14);
  assert.equal(throwRange(10, 25, 5), 15);
  assert.equal(throwRange(10, 25, 0), 35); // passo mínimo 1
  assert.equal(throwRange(0, 3, 5), 1); // nunca 0 (= sem limite)
});

test("prende o ponto de colocação ao círculo de alcance", () => {
  const inside = clampToRange({ x: 3, y: 4 }, { x: 0, y: 0 }, 10);
  assert.deepEqual(inside, { x: 3, y: 4, clamped: false });
  const out = clampToRange({ x: 30, y: 40 }, { x: 0, y: 0 }, 10);
  assert.equal(out.clamped, true);
  assert.ok(Math.abs(out.x - 6) < 1e-9 && Math.abs(out.y - 8) < 1e-9);
  assert.equal(clampToRange({ x: 99, y: 99 }, { x: 0, y: 0 }, 0).clamped, false);
});

test("cone/linha livres: quem está além do alcance fica de fora", () => {
  const items = [{ id: "a", p: { x: 5, y: 0 } }, { id: "b", p: { x: 15, y: 0 } }];
  assert.deepEqual(filterByReach(items, { x: 0, y: 0 }, 10, i => i.p).map(i => i.id), ["a"]);
  assert.equal(filterByReach(items, { x: 0, y: 0 }, 0, i => i.p).length, 2);
});

test("quais Marcas servem a um alvo, da mais barata para a mais cara", () => {
  const caster = { x: 0, y: 0 };
  const target = { x: 100, y: 0 };
  const marks = [
    { uuid: "perto", point: { x: 95, y: 0 } },
    { uuid: "longe", point: { x: 500, y: 0 } },
    { uuid: "alem", point: { x: 108, y: 0 } },
    { uuid: "meio", point: { x: 50, y: 0 } }
  ];
  const served = marksReaching(marks, target, caster, 10);
  // "meio" está a 50 do alvo e "longe" a 400: nenhum deles tem o alvo no alcance.
  assert.deepEqual(served.map(m => m.uuid), ["perto", "alem"]);
  assert.equal(served[0].factor, 90.25);
  assert.equal(served[1].factor, 116.64);
  assert.deepEqual(marksReaching(marks, target, caster, 0), []);
});

test("colocar num ponto: direto, pela Marca ou recusado", () => {
  const caster = { x: 0, y: 0 };
  const marks = [{ uuid: "m", point: { x: 100, y: 0 } }];
  assert.deepEqual(placementVia({ x: 5, y: 0 }, caster, marks, 10), { via: null });
  assert.equal(placementVia({ x: 105, y: 0 }, caster, marks, 10).via.uuid, "m");
  assert.equal(placementVia({ x: 50, y: 0 }, caster, marks, 10), null);
  assert.deepEqual(placementVia({ x: 5000, y: 0 }, caster, marks, 0), { via: null });
});

test("mensagem de recusa e alcance de nave", () => {
  assert.equal(outOfRangeMessage(40, 10), "fora do alcance: 40 m de 10 m");
  assert.equal(outOfRangeMessage(12.5, 10), "fora do alcance: 12,5 m de 10 m");
  assert.equal(shipRangeUnits(8, 1.5), 12);
  assert.equal(markStillValid([{ markedBy: "Actor.a" }], "Actor.a"), true);
  assert.equal(markStillValid([{ markedBy: "Actor.b" }], "Actor.a"), false);
});

test("a frase da Skill mostra o alcance e a origem da forma", () => {
  const base = { effectType: "damage", damageFormula: "3d6", targetType: "emission", areaShape: "cone", areaDistance: 6, areaAngle: 60, cost: 10, level: 1 };
  assert.match(skillSummary({ ...base, range: 20, areaOrigin: "free" }), /alcance 20 m/);
  assert.match(skillSummary({ ...base, areaOrigin: "caster" }), /sai de você/);
  assert.match(skillSummary({ ...base, areaOrigin: "caster", areaFreeLevel: 5 }), /livre a partir do nv 5/);
  assert.doesNotMatch(skillSummary({ ...base }), /alcance/);
});

test("avisos do editor: alcance em Skill 'Si mesmo' e forma presa com alcance", () => {
  const self = lintSkill({ effectType: "temporary", targetType: "self", range: 10, effects: [{ target: "strength", amount: 1, durationRounds: 1 }] }, {});
  assert.ok(self.some(w => w.code === "rangeSelf" && w.level === "soft"));
  const held = lintSkill({ effectType: "damage", damageFormula: "1d6", targetType: "emission", areaShape: "circle", areaDistance: 5, areaOrigin: "caster", range: 10 }, {});
  assert.ok(held.some(w => w.code === "rangeCasterOrigin" && w.level === "soft"));
  const fine = lintSkill({ effectType: "damage", damageFormula: "1d6", targetType: "targeted", range: 10 }, {});
  assert.ok(!fine.some(w => w.code.startsWith("range")));
});

test("IA: os campos de alcance são limpos", () => {
  const out = sanitizeSkillMechanics({ effectType: "damage", damageFormula: "1d6", targetType: "targeted", range: 99999, areaOrigin: "banana", areaFreeLevel: 3.7 }, {});
  assert.equal(out.range, 10000);
  assert.equal(out.areaOrigin, "free");
  assert.equal(out.areaFreeLevel, 4); // arredonda, como os outros inteiros
  const ok = sanitizeSkillMechanics({ effectType: "damage", damageFormula: "1d6", targetType: "targeted", range: 12, areaOrigin: "caster" }, {});
  assert.equal(ok.range, 12);
  assert.equal(ok.areaOrigin, "caster");
});
