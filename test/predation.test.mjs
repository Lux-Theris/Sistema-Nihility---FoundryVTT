import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  tierRank, predationChance, predationWins, normalizeSkillName, hasFormMechanic, predationSkip, ownedIndex, predationCandidates, predationMilestone,
  predationCounterKey, predationAttrGain, addPoints, predationSkillData
} from "../module/skills/predation-rules.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { skillUseMode } from "../module/skills/skill-use-mode.js";
import { borrowableSkill } from "../module/skills/borrowed-rules.js";
import { suggestSkillCost } from "../module/skills/skill-cost-rules.js";
import { MEU_SISTEMA } from "../module/core/config.js";

test("rank pelo Tier e chance 50 ± 25 por rank, entre 0 e 100", () => {
  assert.deepEqual(["extra", "normal", "racial", "unique", "ultimate"].map(tierRank), [0, 1, 1, 2, 3]);
  assert.equal(predationChance(1, 1), 50);
  assert.equal(predationChance(2, 1), 75);
  assert.equal(predationChance(3, 1), 100);
  assert.equal(predationChance(1, 2), 25);
  assert.equal(predationChance(1, 3), 0);
  assert.equal(predationChance(0, 3), 0);
  assert.equal(predationChance(3, 0), 100);
});

test("d100: ganha até a chance; 0 nunca, 100 sempre", () => {
  assert.equal(predationWins(50, 50), true);
  assert.equal(predationWins(51, 50), false);
  assert.equal(predationWins(1, 0), false);
  assert.equal(predationWins(100, 100), true);
});

test("nome normalizado: sem acento, caixa nem espaços repetidos", () => {
  assert.equal(normalizeSkillName("  Mordida   Ácida "), "mordida acida");
  assert.equal(normalizeSkillName(undefined), "");
});

test("quais Skills não se absorvem", () => {
  const owned = ownedIndex([{ name: "Bola de Fogo" }, { name: "x", key: "garra" }]);
  assert.equal(predationSkip({ name: "Corte" }, owned), null);
  assert.ok(predationSkip({ name: "A", isItemGranted: true }, owned));
  assert.ok(predationSkip({ name: "A", coreSkill: "manaManipulation" }, owned));
  assert.ok(predationSkip({ name: "A", weaponMastery: "blades" }, owned));
  assert.ok(predationSkip({ name: "A", effectType: "form" }, owned));
  assert.ok(predationSkip({ name: "A", effectType: "none", subSkills: [{ effectType: "form" }] }, owned));
  assert.equal(hasFormMechanic({ effectType: "damage", subSkills: [] }), false);
  assert.equal(predationSkip({ name: "bola de FOGO" }, owned), "já tem");
  assert.equal(predationSkip({ name: "Outra", key: "garra" }, owned), "já tem");
});

test("candidatas: chance pelo Tier de cada uma e as puladas com o motivo", () => {
  const { eligible, skipped } = predationCandidates(
    [
      { id: "1", name: "Corte", tier: "extra" },
      { id: "2", name: "Voo", tier: "racial" },
      { id: "3", name: "Fim", tier: "unique" },
      { id: "4", name: "Tem", tier: "normal" },
      { id: "5", name: "Pele", tier: "normal", isItemGranted: true }
    ],
    1,
    ownedIndex([{ name: "tem" }])
  );
  assert.deepEqual(eligible.map(e => [e.id, e.chance]), [["1", 75], ["2", 50], ["3", 25]]);
  assert.deepEqual(skipped.map(s => s.id), ["4", "5"]);
});

test("marcos: 1, 5, 10, 20, 40, 80…", () => {
  const hits = [];
  for (let n = 0; n <= 170; n++) if (predationMilestone(n)) hits.push(n);
  assert.deepEqual(hits, [1, 5, 10, 20, 40, 80, 160]);
  assert.equal(predationMilestone(15), false);
  assert.equal(predationMilestone(30), false);
});

test("contador por Espécie, ou pelo nome da ficha base", () => {
  assert.equal(predationCounterKey("goblin", "Grik"), "goblin");
  assert.equal(predationCounterKey("", "Lobo Cinzento"), "nome:lobo cinzento");
  assert.equal(predationCounterKey(undefined, "Lobo  Cinzento"), "nome:lobo cinzento");
});

test("pontos de atributo: floor do % do total, só os que dão pelo menos 1", () => {
  assert.deepEqual(predationAttrGain({ strength: 40, defense: 19, magic: 0 }, 5), { strength: 2 });
  assert.deepEqual(predationAttrGain({ strength: 40 }, 0), {});
  assert.deepEqual(addPoints({ strength: 2 }, { strength: 3, magic: 1 }), { strength: 5, magic: 1 });
});

test("a Skill absorvida vem inteira no nível 1, sem estado nem marcas de origem", () => {
  const source = {
    name: "Mordida",
    img: "x.png",
    _id: "abc",
    system: {
      tier: "racial", level: 7, xp: 40, active: true, cooldownRemaining: 3, investRatio: 2, markFactor: 4, isItemGranted: true, coreSkill: "x",
      effectType: "damage", damageFormula: "2d6",
      subSkills: [{ name: "Veneno", tier: "racial", level: 5, active: true, cooldownRemaining: 2, effectType: "temporary" }, { name: "Presa", level: 3 }]
    }
  };
  const copy = predationSkillData(source, { systemId: "sys", from: "Lobo" });
  assert.equal(copy.type, "skill");
  assert.equal(copy.system.tier, "normal");
  assert.equal(copy.system.level, 1);
  assert.equal(copy.system.xp, 0);
  assert.equal(copy.system.active, false);
  assert.equal(copy.system.cooldownRemaining, 0);
  assert.equal(copy.system.investRatio, 1);
  assert.equal(copy.system.isItemGranted, false);
  assert.equal(copy.system.coreSkill, "");
  assert.equal(copy.system.damageFormula, "2d6");
  assert.equal(copy.system.subSkills.length, 2);
  assert.deepEqual(copy.system.subSkills.map(s => [s.level, s.active, s.cooldownRemaining ?? 0]), [[1, false, 0], [1, false, 0]]);
  assert.equal(copy.system.subSkills[0].tier, "normal");
  assert.deepEqual(copy.flags, { sys: { predatedFrom: "Lobo" } });
  assert.equal(copy._id, undefined);
  // Não muda a original.
  assert.equal(source.system.level, 7);
  assert.equal(source.system.subSkills[0].level, 5);
  // Tier único se mantém.
  assert.equal(predationSkillData({ name: "U", system: { tier: "unique" } }).system.tier, "unique");
});

test("Mecânica Predação: tipo, uso, frase, custo e empréstimo", () => {
  assert.ok(MEU_SISTEMA.SKILL_EFFECT_TYPES.includes("predation"));
  assert.ok(MEU_SISTEMA.SKILL_EFFECT_TYPE_LABELS.predation && MEU_SISTEMA.SKILL_EFFECT_TYPE_SHORT_LABELS.predation);
  assert.equal(skillUseMode({ effectType: "predation", targetType: "targeted" }), "targeted");
  assert.match(skillSummary({ effectType: "predation", targetType: "targeted" }), /preda um alvo derrotado/);
  assert.equal(borrowableSkill({ effectType: "predation" }), false);
  const cost = suggestSkillCost({ effectType: "predation", targetType: "targeted", level: 1 }, {});
  assert.ok(cost.rows.some(r => /Predação/.test(r.label)));
});

test("predationChance: diferença de nível (dono, 17/11)", () => {
  assert.equal(predationChance(1, 1, { predatorLevel: 1, skillLevel: 5 }), 30);
  assert.equal(predationChance(1, 1, { predatorLevel: 1, skillLevel: 11 }), 0);
  assert.equal(predationChance(1, 2, { predatorLevel: 1, skillLevel: 1 }), 25);
  assert.equal(predationChance(1, 2, { predatorLevel: 1, skillLevel: 6 }), 0);
  assert.equal(predationChance(1, 1, { predatorLevel: 10, skillLevel: 1 }), 95);
  assert.equal(predationChance(1, 1, { predatorLevel: 10, skillLevel: 10, bonus: 20 }), 70);
  assert.equal(predationChance(1, 1, { predatorLevel: 1, skillLevel: 3, levelStep: 0 }), 50);
});
