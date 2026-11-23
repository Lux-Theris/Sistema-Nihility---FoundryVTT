/**
 * Marcas, "ao acertar", % de atributo, "só desligada" e complexidade (item 8c.1): as regras puras.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { matchesWhen, sumConditionalModifiers, percentOfTotal, ruleActiveStateAllows, WHEN_KINDS, THEN_KINDS } from "../module/combat/conditional-modifiers.js";
import { onlyIfOutcome, onlyIfClause, onlyIfNeeds, normalizeOnlyIf, ONLY_IF_KINDS } from "../module/skills/only-if-rules.js";
import { normalizeOnHit, onHitApplies, onHitPicks, conditionIdsPostedBy } from "../module/skills/marks-rules.js";
import { resolveAttributePercent, ATTRIBUTE_PERCENT_TARGETS, PERCENT_AMOUNT_TARGETS } from "../module/economy/consumable-rules.js";
import { skillComplexity, complexityCap, complexityVerdict } from "../module/skills/skill-complexity-rules.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { NIHILITY, getActiveStatusConditions } from "../module/core/config.js";
import { sanitizeOnlyIf, sanitizeSkillMechanics } from "../module/ai/ai-mechanics.js";

const ME = "Actor.me";

test("otherConditionMine: só vale com a Condição posta por mim", () => {
  const ctx = { otherConditions: new Set(["mark"]), otherConditionsMine: new Set() };
  assert.equal(matchesWhen({ kind: "otherCondition", value: "mark" }, ctx), true);
  assert.equal(matchesWhen({ kind: "otherConditionMine", value: "mark" }, ctx), false);
  assert.equal(matchesWhen({ kind: "otherConditionMine", value: "mark" }, { ...ctx, otherConditionsMine: new Set(["mark"]) }), true);
  assert.equal(matchesWhen({ kind: "otherConditionMine", value: "" }, { otherConditionsMine: new Set(["mark"]) }), false);
  assert.ok(WHEN_KINDS.includes("otherConditionMine"));
  assert.ok(ONLY_IF_KINDS.includes("otherConditionMine"));
  assert.equal(onlyIfNeeds("otherConditionMine"), "condition");
});

test("qualquer marca e qualquer marca minha", () => {
  assert.equal(matchesWhen({ kind: "otherAnyMark" }, { otherMarks: new Set(["marked"]) }), true);
  assert.equal(matchesWhen({ kind: "otherAnyMark" }, { otherMarks: new Set() }), false);
  assert.equal(matchesWhen({ kind: "otherAnyMarkMine" }, { otherMarks: new Set(["marked"]), otherMarksMine: new Set() }), false);
  assert.equal(matchesWhen({ kind: "otherAnyMarkMine" }, { otherMarksMine: new Set(["marked"]) }), true);
  for (const kind of ["otherAnyMark", "otherAnyMarkMine"]) {
    assert.ok(WHEN_KINDS.includes(kind));
    assert.ok(ONLY_IF_KINDS.includes(kind));
    assert.equal(onlyIfNeeds(kind), "");
    assert.deepEqual(normalizeOnlyIf({ kind, value: "x" }), { kind, value: "", threshold: 50 });
  }
});

test("Só se… com marca: resultado e frase", () => {
  const miss = onlyIfOutcome({ kind: "otherConditionMine", value: "duel" }, { otherConditionsMine: new Set() }, () => "Marca do Duelo");
  assert.equal(miss.ok, false);
  assert.match(miss.reason, /a Condição Marca do Duelo posta por mim/);
  assert.equal(onlyIfOutcome({ kind: "otherConditionMine", value: "duel" }, { otherConditionsMine: new Set(["duel"]) }).ok, true);
  assert.equal(onlyIfOutcome({ kind: "otherAnyMark" }, { otherMarks: new Set() }).ok, false);
  assert.match(onlyIfClause({ kind: "otherAnyMarkMine" }), /qualquer marca posta por mim/);
});

test("conditionIdsPostedBy lê appliedBy", () => {
  const effects = [
    { statuses: ["duel"], flags: { sys: { conditionId: "duel", appliedBy: ME } } },
    { statuses: ["burn"], flags: { sys: { conditionId: "burn", appliedBy: "Actor.other" } } },
    { statuses: ["slow"], disabled: true, flags: { sys: { conditionId: "slow", appliedBy: ME } } },
    { statuses: ["blind"], flags: { sys: { conditionId: "blind" } } }
  ];
  assert.deepEqual([...conditionIdsPostedBy(effects, ME, "sys")], ["duel"]);
  assert.equal(conditionIdsPostedBy(effects, "", "sys").size, 0);
});

test("ao acertar: normaliza, respeita o estado e rola a chance", () => {
  assert.equal(normalizeOnHit({ conditionId: "" }), null);
  assert.deepEqual(normalizeOnHit({ conditionId: "duel", chance: 150, rounds: -2, when: "x" }), { conditionId: "duel", chance: 100, rounds: 0, when: "always" });
  assert.equal(normalizeOnHit({ conditionId: "duel", chance: 0 }).chance, 0);
  const on = { conditionId: "duel", when: "on" };
  const off = { conditionId: "duel", when: "off" };
  assert.equal(onHitApplies(on, { hasUpkeep: true, active: true }), true);
  assert.equal(onHitApplies(on, { hasUpkeep: true, active: false }), false);
  assert.equal(onHitApplies(off, { hasUpkeep: true, active: false }), true);
  assert.equal(onHitApplies(off, { hasUpkeep: true, active: true }), false);
  // Skill que não é Ativa: o estado não conta.
  assert.equal(onHitApplies(on, { hasUpkeep: false, active: false }), true);
  assert.equal(onHitApplies(null, {}), false);
  const skills = [
    { name: "A", level: 3, onHit: { conditionId: "duel", chance: 100, rounds: 2 } },
    { name: "B", onHit: { conditionId: "burn", chance: 50 } },
    { name: "C", onHit: { conditionId: "x", when: "on" }, hasUpkeep: true, active: false },
    { name: "D" }
  ];
  const always = onHitPicks(skills, () => true);
  assert.deepEqual(always.map(p => p.conditionId), ["duel", "burn"]);
  assert.equal(always[0].rounds, 2);
  assert.equal(always[0].level, 3);
  assert.equal(onHitPicks(skills, chance => chance >= 100).length, 1);
});

test("% do total de um atributo", () => {
  assert.equal(resolveAttributePercent(-100, 40), -40);
  assert.equal(resolveAttributePercent(-250, 40), -40); // nunca tira mais que o total
  assert.equal(resolveAttributePercent(50, 33), 17);
  assert.equal(resolveAttributePercent(50, 0), 0);
  assert.equal(percentOfTotal(-100, 12), -12);
  assert.equal(percentOfTotal(25, 10), 3);
  assert.ok(ATTRIBUTE_PERCENT_TARGETS.includes("strength"));
  assert.ok(PERCENT_AMOUNT_TARGETS.includes("hp") && PERCENT_AMOUNT_TARGETS.includes("dexterity"));
});

test("attributePercent: contínuo, só condição sobre si mesmo", () => {
  assert.ok(THEN_KINDS.includes("attributePercent"));
  const mods = [
    { when: { kind: "always" }, then: { kind: "attributePercent", target: "strength", value: -100 } },
    { when: { kind: "always" }, then: { kind: "attributePercent", target: "dexterity", value: -50 } },
    { when: { kind: "otherCondition", value: "x" }, then: { kind: "attributePercent", target: "strength", value: 30 } }
  ];
  const ctx = { otherConditions: new Set(["x"]) };
  assert.equal(sumConditionalModifiers(mods, "attributePercent", ctx, { attribute: "strength" }), -100);
  assert.equal(sumConditionalModifiers(mods, "attributePercent", ctx, { attribute: "dexterity" }), -50);
  assert.equal(sumConditionalModifiers(mods, "attributeFlat", ctx, { attribute: "strength" }), 0);
});

test("só desligada: o estado de cada regra numa Skill Ativa", () => {
  const active = { hasUpkeep: true, active: true };
  const idle = { hasUpkeep: true, active: false };
  assert.equal(ruleActiveStateAllows("", active), true); // padrão = ligada
  assert.equal(ruleActiveStateAllows("", idle), false);
  assert.equal(ruleActiveStateAllows("on", idle), false);
  assert.equal(ruleActiveStateAllows("off", idle), true);
  assert.equal(ruleActiveStateAllows("off", active), false);
  assert.equal(ruleActiveStateAllows("always", active), true);
  assert.equal(ruleActiveStateAllows("always", idle), true);
  // Skill que não é Ativa: sempre vale, qualquer que seja o campo.
  assert.equal(ruleActiveStateAllows("off", { hasUpkeep: false, active: false }), true);
  assert.equal(ruleActiveStateAllows("on", { hasUpkeep: false, active: false }), true);
});

test("complexidade: pesos e tetos", () => {
  assert.equal(skillComplexity({ effectType: "none" }).score, 0);
  const simple = { effectType: "temporary", targetType: "targeted", effects: [{ target: "strength", amount: 3 }] };
  assert.equal(skillComplexity(simple).score, 1);
  const rich = {
    effectType: "temporary",
    targetType: "emission",
    hasUpkeep: true,
    onlyIf: { kind: "otherAnyMark" },
    onHit: { conditionId: "duel" },
    effects: [
      { target: "push", amount: 3 },
      { target: "strength", amount: 1, conditionId: "duel", onlyIf: { kind: "otherCondition", value: "x" } }
    ]
  };
  // efeitos 2 + Condição 1 + "Só se…" do efeito 2 + empurrão 2 + "Só se…" da Skill 2 + área 2 + Ativa 1 + ao acertar 1
  assert.equal(skillComplexity(rich).score, 13);
  assert.equal(skillComplexity({ effectType: "structure", structureId: "w" }).score, 3);
  assert.equal(skillComplexity({ subSkills: [{}, {}] }).score, 2);
  assert.equal(skillComplexity({ subSkills: [{}, {}], combined: true }).score, 4);
  const caps = { extra: 3, normal: 6, unique: 12 };
  assert.equal(complexityCap("extra", caps), 3);
  assert.equal(complexityCap("unique", caps), 12);
  assert.equal(complexityCap("ultimate", caps), null);
  assert.equal(complexityCap("racial", caps), null);
  assert.equal(complexityVerdict(rich, "extra", caps).over, true);
  assert.equal(complexityVerdict(rich, "ultimate", caps).over, false);
  assert.equal(complexityVerdict(simple, "extra", caps).text, "Complexidade 1 / 3");
  assert.equal(complexityVerdict(simple, "racial", caps).text, "Complexidade 1");
});

test("aviso de complexidade e lint da Skill inteira", () => {
  const rich = { tier: "extra", effectType: "temporary", targetType: "emission", hasUpkeep: true, upkeepCost: 1, onHit: { conditionId: "duel" }, effects: [{ target: "strength", amount: 1, conditionId: "duel" }, { target: "dexterity", amount: 1 }, { target: "magic", amount: 1 }] };
  const ctx = { conditions: ["duel"], complexityCaps: { extra: 3, normal: 6, unique: 12 } };
  const found = lintSkill(rich, ctx).find(w => w.code === "complexity");
  assert.ok(found);
  assert.equal(found.level, "soft");
  assert.match(found.text, /Complexa demais para .*: \d+ de 3/);
  assert.equal(lintSkill({ ...rich, tier: "ultimate" }, ctx).some(w => w.code === "complexity"), false);
  assert.equal(lintSkill(rich, { conditions: ["duel"] }).some(w => w.code === "complexity"), false);
  const unknownHit = lintSkill({ tier: "normal", onHit: { conditionId: "ghost" } }, { conditions: ["duel"] });
  assert.ok(unknownHit.some(w => w.code === "onHitUnknown" && w.level === "hard"));
  const unknownGate = lintSkill({ tier: "normal", onlyIf: { kind: "otherConditionMine", value: "ghost" } }, { conditions: ["duel"] });
  assert.ok(unknownGate.some(w => w.code === "skillOnlyIfUnknown" && w.level === "hard"));
  assert.ok(lintSkill({ tier: "normal", onlyIf: { kind: "otherConditionMine", value: "" } }, {}).some(w => w.code === "skillOnlyIfEmpty"));
});

test("a frase da Skill fala do Só se… e do ao acertar", () => {
  const sentence = skillSummary(
    { effectType: "none", onlyIf: { kind: "otherConditionMine", value: "duel" }, onHit: { conditionId: "duel", chance: 50, when: "on" }, hasUpkeep: true },
    { conditions: { duel: "Marca do Duelo" } }
  );
  assert.match(sentence, /só se o alvo tiver a Condição Marca do Duelo posta por mim/);
  assert.match(sentence, /seus golpes põem Marca do Duelo \(50%\) enquanto ligada/);
});

test("catálogo: a Condição Marcado de fábrica é uma marca", () => {
  assert.equal(NIHILITY.DEFAULT_STATUS_CONDITIONS.find(c => c.id === "marked")?.isMark, true);
  assert.equal(getActiveStatusConditions().find(c => c.id === "marked")?.isMark, true);
  assert.ok(!NIHILITY.DEFAULT_STATUS_CONDITIONS.find(c => c.id === "burn")?.isMark);
});

test("IA: o Só se… aceita os tipos de marca, só com ids que existem", () => {
  const catalogs = { conditions: new Set(["duel"]), traits: new Set() };
  assert.equal(sanitizeOnlyIf({ kind: "otherConditionMine", value: "duel" }, catalogs)?.kind, "otherConditionMine");
  assert.equal(sanitizeOnlyIf({ kind: "otherConditionMine", value: "ghost" }, catalogs), null);
  assert.equal(sanitizeOnlyIf({ kind: "otherAnyMark" }, catalogs)?.kind, "otherAnyMark");
  assert.equal(sanitizeOnlyIf({ kind: "otherAnyMarkMine" }, catalogs)?.kind, "otherAnyMarkMine");
  const cat = { conditions: ["duel"], attributes: ["strength"], elements: [], traits: [] };
  const out = sanitizeSkillMechanics({
    hasUpkeep: true,
    onlyIf: { kind: "otherConditionMine", value: "duel" },
    onHit: { conditionId: "duel", chance: 400, rounds: 3, when: "off" },
    effectType: "temporary",
    effects: [{ target: "strength", amount: -100, amountMode: "percentMax", durationRounds: 1 }]
  }, cat);
  assert.equal(out.onlyIf.kind, "otherConditionMine");
  assert.deepEqual(out.onHit, { conditionId: "duel", chance: 100, rounds: 3, when: "off" });
  assert.equal(out.effects[0].amountMode, "percentMax");
  assert.equal(sanitizeSkillMechanics({ onHit: { conditionId: "ghost" } }, cat).onHit, undefined);
  assert.equal(sanitizeSkillMechanics({ hasUpkeep: false, onHit: { conditionId: "duel", when: "on" } }, cat).onHit.when, "always");
});
