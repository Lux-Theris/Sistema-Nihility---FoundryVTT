import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyLuck, normalizeLuck, hasLuck, luckFromScopes, luckScopesOf, sumLuck, luckWeights, sampleLuckFace, luckMean,
  applyLuckToFormula, luckModifierText, parseLuckModifier, luckUnit, luckChanceOdds, averageRollWithLuck, luckOf,
  describeLuck, luckPercentText
} from "../module/combat/luck-rules.js";
import { rollChance } from "../module/combat/damage-rules.js";
import { averageRoll } from "../module/skills/skill-cost-rules.js";

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("pesos: sem sorte é uniforme e soma 1", () => {
  const w = luckWeights(20, 0);
  near(w.reduce((a, b) => a + b, 0), 1, 1e-9);
  w.forEach(x => near(x, 1 / 20, 1e-9));
});

test("pesos: a tabela do dono (d20) bate com a conta exponencial", () => {
  const at = (luck, i) => luckWeights(20, luck)[i] * 20;
  near(at(30, 0), 0.73, 0.02);
  near(at(30, 19), 1.33, 0.02);
  near(at(100, 0), 0.31, 0.02);
  near(at(100, 19), 2.28, 0.02);
  near(at(200, 19), 3.85, 0.03);
  near(at(300, 19) / 20, 0.27, 0.02); // 27% de tirar 20
  near(at(-50, 0), 1.58, 0.02);
  near(at(-50, 19), 0.58, 0.02);
});

test("médias do d20 com sorte", () => {
  near(luckMean(20, 0), 10.5, 1e-9);
  near(luckMean(20, 30), 11.5, 0.05);
  near(luckMean(20, 100), 13.8, 0.05);
  near(luckMean(20, 200), 16, 0.1);
  near(luckMean(20, 500), 18.6, 0.1);
  near(luckMean(20, -50), 8.8, 0.05);
  assert.ok(luckMean(6, -100) < 3.5);
});

test("sem teto e sem estourar com sorte enorme", () => {
  const w = luckWeights(20, 100000);
  assert.ok(w.every(Number.isFinite));
  near(w[19], 1, 1e-6);
  assert.equal(luckWeights(1, 50)[0], 1);
});

test("sampleLuckFace: sem sorte é o dado normal; com sorte respeita a faixa", () => {
  assert.equal(sampleLuckFace(20, 0, () => 0), 1);
  assert.equal(sampleLuckFace(20, 0, () => 0.999), 20);
  assert.equal(sampleLuckFace(20, 300, () => 0), 1);
  assert.equal(sampleLuckFace(20, 300, () => 0.9999999), 20);
  // com muita sorte, um sorteio mediano cai nas faces altas
  assert.ok(sampleLuckFace(20, 300, () => 0.5) > 15);
  assert.ok(sampleLuckFace(20, -300, () => 0.5) < 6);
});

test("sampleLuckFace: a frequência empírica segue os pesos", () => {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  let sum = 0;
  const n = 20000;
  for (let i = 0; i < n; i += 1) sum += sampleLuckFace(20, 100, rand);
  near(sum / n, 13.8, 0.15);
});

test("applyLuckToFormula: acrescenta a cada termo de dado, antes dos modificadores", () => {
  assert.equal(applyLuckToFormula("2d20+3", 30), "2d20lu30+3");
  assert.equal(applyLuckToFormula("1d6+2d8", -20), "1d6ul20+2d8ul20");
  assert.equal(applyLuckToFormula("4d6kh3", 30), "4d6lu30kh3");
  assert.equal(applyLuckToFormula("d20", 30), "d20lu30");
  assert.equal(applyLuckToFormula("10d6", 30), "10d6lu30");
  assert.equal(applyLuckToFormula("{2d6+1, 2d6+1}kh", 30), "{2d6lu30+1, 2d6lu30+1}kh");
});

test("applyLuckToFormula: sem dado ou sem sorte fica igual; não duplica", () => {
  assert.equal(applyLuckToFormula("7", 30), "7");
  assert.equal(applyLuckToFormula("@strength + 5", 30), "@strength + 5");
  assert.equal(applyLuckToFormula("2d20+3", 0), "2d20+3");
  assert.equal(applyLuckToFormula("2d20lu30+3", 30), "2d20lu30+3");
  assert.equal(applyLuckToFormula("", 30), "");
  assert.equal(applyLuckToFormula("2d6", 12.6), "2d6lu13");
});

test("modificador: texto e leitura", () => {
  assert.equal(luckModifierText(30), "lu30");
  assert.equal(luckModifierText(-30), "ul30");
  assert.equal(luckModifierText(0), "");
  assert.equal(parseLuckModifier("lu30"), 30);
  assert.equal(parseLuckModifier("ul45"), -45);
  assert.equal(parseLuckModifier("kh1"), null);
  assert.equal(parseLuckModifier("LU12.5"), 12.5);
});

test("fontes: normaliza, soma por escopo e respeita o teto opcional", () => {
  assert.deepEqual(normalizeLuck({ attributes: "x", damage: 5 }), { attributes: 0, damage: 5, chances: 0 });
  assert.deepEqual(luckFromScopes(30, { attributes: true, chances: true }), { attributes: 30, damage: 0, chances: 30 });
  assert.deepEqual(luckFromScopes("lixo", { damage: true }), emptyLuck());
  assert.equal(hasLuck({ chances: 1 }), true);
  assert.equal(hasLuck(null), false);
  assert.deepEqual(luckScopesOf({ attributes: 20, chances: -20 }), ["attributes", "chances"]);
  const sum = sumLuck([{ attributes: 20 }, { attributes: 30, damage: 10 }, { chances: -20 }]);
  assert.deepEqual(sum, { attributes: 50, damage: 10, chances: -20 });
  assert.deepEqual(sumLuck([{ attributes: 500 }, { damage: -500 }], { cap: 200 }), { attributes: 200, damage: -200, chances: 0 });
  assert.deepEqual(sumLuck([{ attributes: 500 }], { cap: 0 }), { attributes: 500, damage: 0, chances: 0 });
});

test("chances: sorte favorece o resultado baixo; sem sorte é o de sempre", () => {
  assert.equal(rollChance(50, () => 0.49), true);
  assert.equal(rollChance(50, () => 0.5), false);
  assert.equal(rollChance(100, () => 0.99, -500), true);
  assert.equal(rollChance(0, () => 0, 500), false);
  // mesmo sorteio 0,6: com sorte positiva a chance de 50% passa; com azar não
  assert.equal(rollChance(50, () => 0.6, 0), false);
  assert.equal(rollChance(50, () => 0.6, 200), true);
  assert.equal(rollChance(50, () => 0.4, -200), false);
});

test("chances: as odds teóricas e a frequência empírica combinam", () => {
  near(luckChanceOdds(50, 0), 50, 1e-9);
  near(luckChanceOdds(50, 100), 73.1, 0.2);
  near(luckChanceOdds(50, -100), 26.9, 0.2);
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  let hits = 0;
  const n = 20000;
  for (let i = 0; i < n; i += 1) if (rollChance(50, rand, 100)) hits += 1;
  near((hits / n) * 100, 73.1, 1.2);
  assert.ok(luckUnit(300, () => 0.5) < 0.2);
  assert.ok(luckUnit(-300, () => 0.5) > 0.8);
  assert.equal(luckUnit(0, () => 0.37), 0.37);
});

test("média da fórmula com sorte (Simulador e custo)", () => {
  near(averageRollWithLuck("2d6+3", 0), 10, 1e-9);
  assert.equal(averageRollWithLuck("3d6+2", 0), averageRoll("3d6+2"));
  assert.equal(averageRoll("3d6+2", 0), averageRoll("3d6+2"));
  assert.ok(averageRollWithLuck("3d6+2", 100) > averageRollWithLuck("3d6+2", 0));
  assert.ok(averageRoll("3d6+2", 100) > averageRoll("3d6+2"));
  assert.equal(averageRollWithLuck("7", 100), 7);
});

test("ficha: luckOf e textos", () => {
  assert.equal(luckOf({ system: { luck: { damage: 25 } } }, "damage"), 25);
  assert.equal(luckOf({ system: {} }, "damage"), 0);
  assert.equal(luckOf(null, "damage"), 0);
  assert.equal(luckPercentText(30), "+30%");
  assert.equal(luckPercentText(-20), "−20%");
  assert.equal(describeLuck({ attributes: 20, damage: 20, chances: 20 }), "+20% em tudo");
  assert.equal(describeLuck({ chances: 20 }), "+20% nas chances");
  assert.equal(describeLuck({}), "");
});
