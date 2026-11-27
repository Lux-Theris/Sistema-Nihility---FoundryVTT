/**
 * Progressão por chance (1e, 1.124.0): o passo Chance no ciclo, o nível máximo automático, as conversões entre passos, os ids
 * estáveis, o sorteio dos pontos, a Evolução/Fusão com a melhor chance e o teste de ida e volta (uma Skill sem chance tem os
 * mesmos números de hoje em todos os níveis).
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  withStableIds, ownChances, collectChances, chanceBonusOf, effectiveChance, chanceLevelsNeeded, distributeChancePoints, chanceGainsText,
  pruneChanceBonus, carryOverChanceBonus, subChanceBonus, simulateCycle, levelPlan, maxLevelFor, nextStepKind, isAtMaxLevel, entryHasChance
} from "../module/skills/chance-rules.js";
import { skillLevelBonuses, effectiveSkillCost, skillMaxLevel, skillAtMaxLevel, skillNextStep, skillChances } from "../module/core/config.js";

/** O ciclo ANTIGO (até a 1.123.0), copiado como estava: a referência do teste de ida e volta. */
function oldCycle(level, { powerStep = 0.1, discountStep = 0.2, floor = 0.1, powerLevels = 2, discountLevels = 2 } = {}) {
  const cycle = [...Array(powerLevels).fill("power"), ...Array(discountLevels).fill("discount")];
  let power = 1;
  let cost = 1;
  for (let i = 0; i < level - 1; i++) {
    const atFloor = cost <= floor + 1e-9;
    const phase = cycle[i % cycle.length] === "discount" && !atFloor ? "discount" : "power";
    if (phase === "power") power *= 1 + powerStep;
    else cost = Math.max(floor, cost * (1 - discountStep));
  }
  return { power, cost };
}

const cfg = (over = {}) => ({ powerLevels: 2, discountLevels: 2, chanceLevels: 1, powerStep: 0.1, discountStep: 0.2, floor: 0.1, chanceNeed: 0, hasDiscount: true, ...over });
const near = (a, b) => Math.abs(a - b) < 1e-9;

test("ida e volta: sem chance e com Custo, os mesmos números de hoje em TODOS os níveis", () => {
  for (let level = 1; level <= 80; level++) {
    const old = oldCycle(level);
    const now = levelPlan(level, cfg());
    assert.ok(near(old.power, now.power) && near(old.cost, now.cost), `nível ${level}`);
    // E pela função de config: com o número do nível e com a mecânica de uma Skill com Custo e sem chance.
    const byNumber = skillLevelBonuses(level);
    const byMech = skillLevelBonuses({ level, cost: 10, effectType: "damage", damageFormula: "1d6" });
    assert.ok(near(byNumber.power, old.power) && near(byNumber.cost, old.cost), `número, nível ${level}`);
    assert.ok(near(byMech.power, old.power) && near(byMech.cost, old.cost), `mecânica, nível ${level}`);
  }
  assert.equal(effectiveSkillCost(10, 7), Math.max(1, Math.round(10 * oldCycle(7).cost)));
  assert.equal(effectiveSkillCost(10, { level: 7, cost: 10 }), effectiveSkillCost(10, 7));
});

test("ida e volta com ajustes da mesa (outro ciclo, outro piso)", () => {
  for (const over of [{ powerLevels: 3, discountLevels: 1 }, { powerLevels: 1, discountLevels: 3, floor: 0.25 }, { discountStep: 0.5 }]) {
    for (let level = 1; level <= 60; level++) {
      const old = oldCycle(level, over);
      const now = levelPlan(level, cfg(over));
      assert.ok(near(old.power, now.power) && near(old.cost, now.cost), `${JSON.stringify(over)} nível ${level}`);
    }
  }
});

test("nível máximo: sem chance, é onde o Desconto chega ao piso (depois só Poder, como antes)", () => {
  const max = maxLevelFor(cfg());
  assert.ok(Number.isFinite(max) && max > 10 && max < 40);
  assert.ok(oldCycle(max).cost <= 0.1 + 1e-9);
  assert.ok(oldCycle(max - 1).cost > 0.1 + 1e-9, "um nível antes ainda não estava no piso");
  assert.equal(isAtMaxLevel(max, cfg()), true);
  assert.equal(isAtMaxLevel(max - 1, cfg()), false);
  assert.equal(isAtMaxLevel(max, cfg(), { unlimited: true }), false, "Sem limite nunca para");
  assert.equal(nextStepKind(max, cfg()), "beyond", "passado o máximo, Poder");
});

test("o passo Chance entra no ciclo e as conversões acontecem entre os passos", () => {
  // 3 níveis de Chance pedidos (30 pontos a 10 por nível).
  const c = cfg({ chanceNeed: 3 });
  const sim = simulateCycle(40, c);
  assert.equal(sim.chanceDone, 3, "para de dar Chance quando tudo chega a 100%");
  const kinds = sim.kinds;
  assert.deepEqual(kinds.slice(0, 5), ["power", "power", "discount", "discount", "chance"]);
  // Desconto no piso com chance sobrando vira Chance; Chance completa com Custo acima do piso vira Desconto.
  const lateChance = cfg({ chanceNeed: 12, discountLevels: 2 });
  const late = simulateCycle(60, lateChance).kinds;
  assert.ok(late.includes("chance"));
  const earlyDone = simulateCycle(12, cfg({ chanceNeed: 1 })).kinds;
  assert.equal(earlyDone.filter(k => k === "chance").length, 1);
  assert.ok(earlyDone.slice(5).includes("discount"), "a Chance que sobra vira Desconto");
  const max = maxLevelFor(c);
  assert.ok(max >= maxLevelFor(cfg()), "chance só empurra o máximo para cima");
  assert.equal(simulateCycle(max - 1, c).chanceDone, 3);
  assert.ok(simulateCycle(max - 1, c).cost <= 0.1 + 1e-9);
});

test("Skill sem Custo: sem chance, todo nível é Poder e não há máximo; com chance, só Poder e Chance", () => {
  const free = cfg({ hasDiscount: false });
  assert.equal(maxLevelFor(free), Infinity);
  assert.ok(near(levelPlan(5, free).power, 1.1 ** 4));
  assert.equal(levelPlan(5, free).cost, 1);
  const freeChance = cfg({ hasDiscount: false, chanceNeed: 2 });
  assert.deepEqual(simulateCycle(5, freeChance).kinds, ["power", "power", "chance", "power", "power"]);
  assert.ok(Number.isFinite(maxLevelFor(freeChance)));
});

test("ids estáveis: dá id ao que não tem e não troca o que já tem", () => {
  let n = 0;
  const make = () => `id${++n}`;
  const out = withStableIds({ effects: [{ target: "strength" }, { target: "defense", id: "keep" }], subSkills: [{ name: "A", effects: [{ target: "magic" }] }, { name: "B", uid: "u9", effects: [] }] }, make);
  assert.equal(out.changed, true);
  assert.equal(out.effects[0].id, "id1");
  assert.equal(out.effects[1].id, "keep");
  assert.equal(out.subSkills[0].uid, "id2");
  assert.equal(out.subSkills[0].effects[0].id, "id3");
  assert.equal(out.subSkills[1].uid, "u9");
  assert.deepEqual(withStableIds({ effects: [{ id: "a" }], subSkills: [{ uid: "u", effects: [{ id: "b" }] }] }, make), { changed: false });
});

test("as chances de uma Skill: chave estável por id, base, sentido; as das Sub-Skills com prefixo", () => {
  const sys = {
    effectType: "temporary", strikes: 3, chainChance: 30,
    effects: [{ id: "e1", target: "stealth", conditionId: "stun", chance: 40 }, { id: "e2", target: "defense", chance: 100 }, { target: "magic", chance: 20 }],
    subSkills: [{ uid: "s1", effectType: "temporary", effects: [{ id: "x1", target: "stealth", conditionId: "stun", chance: 25 }] }]
  };
  const chances = collectChances(sys);
  assert.deepEqual(chances.map(c => c.key), ["chain", "effect:e1", "sub:s1:effect:x1"]);
  assert.equal(entryHasChance({ target: "magicDampen", chance: 50 }), false);
  assert.equal(chances[1].sense, chances[2].sense, "mesma Condição no mesmo tipo de efeito: o mesmo sentido");
  const dmg = ownChances({ effectType: "damage", damageElements: ["fire"] }, "", id => (id === "fire" ? [{ n: 0, chance: 20, conditionId: "burn" }] : []));
  assert.deepEqual(dmg.map(c => c.key), ["element:fire:0"]);
  assert.equal(chanceLevelsNeeded([{ base: 40 }, { base: 25 }], 10), 14, "⌈(60 + 75) ÷ 10⌉");
  assert.equal(chanceLevelsNeeded([], 10), 0);
});

test("sorteio: cada ponto vai para uma chance abaixo de 100%; sobra quando todas enchem", () => {
  const chances = [{ key: "a", base: 95 }, { key: "b", base: 50 }];
  const seq = [0, 0.99, 0, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99];
  let i = 0;
  const r = distributeChancePoints(chances, {}, 10, () => seq[i++ % seq.length]);
  assert.equal(r.spent, 10);
  assert.ok(effectiveChance(95, r.bonus.a) <= 100 && effectiveChance(50, r.bonus.b) <= 100);
  assert.equal(Object.values(r.gains).reduce((s, n) => s + n, 0), 10);
  const full = distributeChancePoints([{ key: "a", base: 99 }], { a: 1 }, 10, () => 0);
  assert.equal(full.spent, 0, "tudo em 100%: nada a sortear");
  assert.equal(chanceBonusOf({ a: 3 }, "a"), 3);
  assert.equal(chanceBonusOf({ a: 3 }, "z"), 0);
  assert.equal(effectiveChance(90, 30), 100);
  assert.equal(chanceGainsText({ "effect:e1": 6, chain: 4 }, k => (k === "chain" ? "Saltar" : "Atordoar")), "Atordoar +6% · Saltar +4%");
  assert.deepEqual(pruneChanceBonus({ a: 2, gone: 5, b: 0 }, [{ key: "a" }, { key: "b" }]), { a: 2 });
  assert.deepEqual(subChanceBonus({ "sub:s1:chain": 4, "sub:s2:chain": 9, chain: 1 }, "s1"), { chain: 4 });
});

test("Evolução e Fusão ficam com a melhor chance, pelo sentido, nunca piorando", () => {
  const sense = "effect:stealth:stun";
  const old = [{ chances: [{ key: "effect:old1", base: 40, sense }], bonus: { "effect:old1": 30 } }, { chances: [{ key: "effect:old2", base: 50, sense }], bonus: {} }];
  const fresh = [{ key: "effect:new1", base: 40, sense }, { key: "chain", base: 20, sense: "chain" }];
  assert.deepEqual(carryOverChanceBonus(old, fresh), { "effect:new1": 30 }, "a melhor era 70%; a nova base é 40");
  const better = carryOverChanceBonus([{ chances: [{ key: "k", base: 30, sense }], bonus: {} }], [{ key: "n", base: 60, sense }]);
  assert.deepEqual(better, {}, "se a base da nova já é maior, vale a base");
});

test("config: o nível máximo da Skill, o aviso de máximo e o próximo passo", () => {
  const free = { level: 3, effectType: "temporary", effects: [] };
  assert.equal(skillMaxLevel(free), Infinity, "sem Custo e sem chance: sem limite");
  const paid = { level: 3, cost: 10, effectType: "damage", damageFormula: "1d6" };
  const max = skillMaxLevel(paid);
  assert.ok(Number.isFinite(max));
  assert.equal(skillMaxLevel({ ...paid, unlimitedLevel: true }), Infinity);
  assert.equal(skillAtMaxLevel({ ...paid, level: max }), true);
  assert.equal(skillAtMaxLevel({ ...paid, level: max - 1 }), false);
  assert.equal(skillNextStep({ ...paid, level: max }), "beyond");
  const withChance = { ...paid, effectType: "temporary", effects: [{ id: "e1", target: "stealth", conditionId: "stun", chance: 40 }] };
  assert.ok(skillMaxLevel(withChance) >= max);
  assert.equal(skillChances(withChance).length, 1);
  // Com chance a Skill tem um passo a mais, então no mesmo nível entrega menos Poder ou Desconto que sem chance.
  const lvl = 8;
  const a = skillLevelBonuses({ ...withChance, level: lvl });
  const b = skillLevelBonuses({ ...paid, level: lvl });
  assert.ok(a.power <= b.power + 1e-9 && a.cost >= b.cost - 1e-9);
  assert.ok(a.power < b.power - 1e-9 || a.cost > b.cost + 1e-9);
});
