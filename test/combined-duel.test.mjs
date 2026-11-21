/**
 * Combinada, Estrutura em volta, Magia enfraquecida e as regras do duelo (item 8c.2): as regras puras e os dados
 * de fábrica (Marca do Duelo, Bolha do duelo, modelo "Duelo na bolha").
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  isCombinedSkill,
  combinedPlan,
  combinedPartMech,
  combinedSentence,
  combinedIssues,
  isCasterBoundCircle,
  centeredStructurePoints,
  structureSideFactor,
  normalizeSidePercents,
  resolveMagicDampen,
  dampenLine,
  intruderOutcome,
  targetHasFallen,
  addMissingById,
  STRUCTURE_PLACES,
  INTRUDER_RULES
} from "../module/skills/combined-rules.js";
import { areaAffectsTarget, AREA_AFFECTS, AREA_AFFECTS_OPTIONS } from "../module/combat/area-geometry.js";
import { skillUseMode } from "../module/skills/skill-use-mode.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { skillComplexity } from "../module/skills/skill-complexity-rules.js";
import { templateSkillData, normalizeSkillTemplate, templateFromSkill } from "../module/skills/skill-template-rules.js";
import { sanitizeSkillMechanics } from "../module/ai/ai-mechanics.js";
import { normalizeEffectRequest } from "../module/skills/effect-relay-rules.js";
import { resolveEffectChange } from "../module/skills/effect-targets.js";
import { REQUEST_MECHANIC_FIELDS } from "../module/creation/creation-rules.js";
import { MEU_SISTEMA, getStructures, getActiveStatusConditions } from "../module/core/config.js";

const part = (extra = {}) => ({ name: "Parte", effectType: "temporary", targetType: "targeted", level: 1, ...extra });

test("Combinada só vale com a marca E com Sub-Skills", () => {
  assert.equal(isCombinedSkill({ combined: true, subSkills: [part()] }), true);
  assert.equal(isCombinedSkill({ combined: true, subSkills: [] }), false);
  assert.equal(isCombinedSkill({ combined: false, subSkills: [part()] }), false);
  assert.equal(isCombinedSkill(null), false);
});

test("o plano: um alvo para todas as partes, e uma colocação só para as áreas que pedem clique", () => {
  const env = { areaEnabled: true, areaSupported: true };
  const aura = part({ targetType: "emission", areaShape: "circle", areaDistance: 8, areaOrigin: "caster" });
  const cone = part({ targetType: "emission", areaShape: "cone", areaDistance: 6, areaOrigin: "caster" });
  const free = part({ targetType: "emission", areaShape: "circle", areaDistance: 4, areaOrigin: "free" });
  const self = part({ targetType: "self" });
  const parent = { level: 1 };

  const onlyAura = combinedPlan(parent, [aura, self], env);
  assert.deepEqual(onlyAura.modes, ["emission", "self"]);
  assert.equal(onlyAura.needsTarget, false);
  assert.equal(onlyAura.areaClickIndex, -1, "círculo preso em quem usa não pede clique");

  assert.equal(combinedPlan(parent, [aura, cone], env).areaClickIndex, 1, "o cone pede a colocação");
  assert.equal(combinedPlan(parent, [self, free, cone], env).areaClickIndex, 1, "a primeira que pede clique");
  assert.equal(combinedPlan(parent, [part()], env).needsTarget, true);
  // Desligar se o alvo cai, regra de intruso ou "Só se…" sobre o alvo também pedem o alvo.
  assert.equal(combinedPlan({ ...parent, endsWhenTargetFalls: true }, [self], env).needsTarget, true);
  assert.equal(combinedPlan({ ...parent, intruderRule: "break" }, [self], env).needsTarget, true);
  assert.equal(combinedPlan({ ...parent, onlyIf: { kind: "otherConditionMine", value: "x" } }, [self], env).needsTarget, true);
  assert.equal(combinedPlan({ ...parent, onlyIf: { kind: "selfHpBelow", threshold: 30 } }, [self], env).needsTarget, false);
  // Estrutura em volta do alvo precisa dele.
  assert.equal(combinedPlan(parent, [part({ effectType: "structure", structurePlace: "target" })], env).needsTarget, true);
  assert.equal(combinedPlan(parent, [part({ effectType: "structure", structurePlace: "caster" })], env).needsTarget, false);
});

test("círculo preso: livre a partir de um nível vira clique", () => {
  const aura = { areaShape: "circle", areaOrigin: "caster", areaFreeLevel: 5 };
  assert.equal(isCasterBoundCircle(aura, 1), true);
  assert.equal(isCasterBoundCircle(aura, 5), false);
  assert.equal(isCasterBoundCircle({ areaShape: "cone", areaOrigin: "caster" }, 1), false);
  assert.equal(isCasterBoundCircle({ areaShape: "circle", areaOrigin: "free" }, 1), false);
});

test("a parte roda com o nível, a Ativa e a natureza da mãe, sem Custo próprio", () => {
  const parent = { level: 7, tier: "unique", hasUpkeep: true, weaponStrike: "blades" };
  const mech = combinedPartMech(parent, part({ level: 1, cost: 30, upkeepCost: 5, cooldown: 3, prepTurns: 2, variableMana: true, hasUpkeep: false, isMagic: null, isTech: null }), { magic: true, tech: false });
  assert.equal(mech.level, 7);
  assert.equal(mech.hasUpkeep, true, "ancora à Skill-mãe");
  assert.deepEqual([mech.cost, mech.upkeepCost, mech.cooldown, mech.prepTurns, mech.variableMana], [0, 0, 0, 0, false]);
  assert.deepEqual([mech.isMagic, mech.isTech], [true, false], "herda a natureza da mãe");
  assert.equal(mech.weaponStrike, "blades");
  // A parte que escolheu a própria natureza mantém.
  assert.equal(combinedPartMech(parent, part({ isMagic: false }), { magic: true }).isMagic, false);
  // Não muda o objeto original.
  const original = part({ cost: 9 });
  combinedPartMech(parent, original);
  assert.equal(original.cost, 9);
});

test("a frase da Combinada", () => {
  assert.equal(combinedSentence({ combined: true, subSkills: [{ name: "A" }, { name: "B" }, {}] }), "Combinada: A + B + sem nome");
  assert.equal(combinedSentence({ combined: false, subSkills: [{ name: "A" }] }), "");
  const text = skillSummary({ combined: true, subSkills: [{ name: "Empurrar" }, { name: "Bolha" }], hasUpkeep: true, upkeepCost: 6, cost: 40, endsWhenTargetFalls: true, intruderRule: "break" });
  assert.match(text, /Combinada: Empurrar \+ Bolha/);
  assert.match(text, /desliga se o alvo cair/);
  assert.match(text, /desliga se alguém entrar na Estrutura/);
  assert.match(skillSummary({ subSkills: [{ name: "A" }, { name: "B" }] }), /2 Sub-Skills/);
});

test("Estrutura sem clique: pontos centrados na forma do catálogo", () => {
  assert.deepEqual(centeredStructurePoints("circle", { x: 300, y: 400 }, 500), [[300, 400]]);
  assert.deepEqual(centeredStructurePoints("rect", { x: 10, y: 20 }, 100), [[10, 20]]);
  assert.deepEqual(centeredStructurePoints("line", { x: 300, y: 400 }, 200), [[200, 400], [400, 400]]);
  assert.deepEqual(centeredStructurePoints("free", { x: 0, y: 0 }, 100), [[-50, 0], [50, 0]]);
  assert.deepEqual(STRUCTURE_PLACES, ["click", "caster", "target"]);
});

test("dano na Estrutura por lado: de fora e de dentro", () => {
  assert.equal(structureSideFactor({ inside: false, outsidePercent: 25, insidePercent: 200 }), 0.25);
  assert.equal(structureSideFactor({ inside: true, outsidePercent: 25, insidePercent: 200 }), 2);
  assert.equal(structureSideFactor({}), 1, "padrão 100%");
  assert.equal(structureSideFactor({ inside: true, insidePercent: 0 }), 0);
  assert.deepEqual(normalizeSidePercents({}), { outsideDamagePercent: 100, insideDamagePercent: 100 });
  assert.deepEqual(normalizeSidePercents({ outsideDamagePercent: "25", insideDamagePercent: -3 }), { outsideDamagePercent: 25, insideDamagePercent: 100 });
});

test("o catálogo de Estruturas lê os campos do duelo e a Bolha vem de fábrica", () => {
  const bubble = getStructures().find(s => s.id === "duel-bubble");
  assert.ok(bubble, "Bolha do duelo de fábrica");
  assert.equal(bubble.material, "physical");
  assert.equal(bubble.shape, "circle");
  assert.ok(bubble.hp >= 1000, "Vida alta");
  assert.equal(bubble.outsideDamagePercent, 25);
  assert.equal(bubble.insideDamagePercent, 200);
  assert.equal(bubble.vanishWithSkill, true);
  assert.equal(bubble.endsSkillOnDestroy, true);
  assert.equal(bubble.durationRounds, 0, "sem prazo: fica enquanto a Skill estiver ligada");
  // Uma Estrutura sem os campos novos lê 100/100 e nada de sumir.
  const stone = getStructures().find(s => s.id === "stone-wall");
  assert.deepEqual([stone.outsideDamagePercent, stone.insideDamagePercent, stone.vanishWithSkill, stone.endsSkillOnDestroy], [100, 100, false, false]);
});

test("Marca do Duelo de fábrica é uma marca", () => {
  const mark = getActiveStatusConditions().find(c => c.id === "duel-mark");
  assert.ok(mark);
  assert.equal(mark.label, "Marca do Duelo");
  assert.equal(mark.isMark, true);
});

test("Quem a área atinge: todos menos quem usa e o alvo", () => {
  assert.ok(AREA_AFFECTS.includes("othersExceptTarget"));
  assert.ok(AREA_AFFECTS_OPTIONS.some(([v]) => v === "othersExceptTarget"));
  const aff = { affects: "othersExceptTarget" };
  assert.equal(areaAffectsTarget({ ...aff, isCaster: true }), false);
  assert.equal(areaAffectsTarget({ ...aff, isCaster: false, isTarget: true }), false);
  assert.equal(areaAffectsTarget({ ...aff, isCaster: false, isTarget: false }), true);
  assert.equal(areaAffectsTarget({ ...aff, isCaster: false, dead: true }), false, "morto nunca");
  // Os outros modos não mudam.
  assert.equal(areaAffectsTarget({ affects: "all", isCaster: false, isTarget: true }), true);
  assert.equal(areaAffectsTarget({ affects: "notCaster", isCaster: false, isTarget: true }), true);
});

test("Magia enfraquecida: chance e força, vários efeitos se multiplicam", () => {
  const fixed = n => () => n;
  const hit = resolveMagicDampen([{ chance: 50, percent: 50 }], fixed(30));
  assert.equal(hit.factor, 0.5);
  assert.equal(hit.applied.length, 1);
  assert.equal(dampenLine(hit), "saiu enfraquecida: 50%");
  const miss = resolveMagicDampen([{ chance: 50, percent: 50 }], fixed(80));
  assert.equal(miss.factor, 1);
  assert.equal(miss.missed, 1);
  assert.equal(dampenLine(miss), "");
  // 50% exato pega; 100% nunca rola.
  assert.equal(resolveMagicDampen([{ chance: 50, percent: 20 }], fixed(50)).factor, 0.2);
  let rolled = 0;
  assert.equal(resolveMagicDampen([{ chance: 100, percent: 40 }], () => { rolled++; return 100; }).factor, 0.4);
  assert.equal(rolled, 0);
  // Dois efeitos: 50% × 50% = 25%.
  assert.equal(resolveMagicDampen([{ chance: 100, percent: 50 }, { chance: 100, percent: 50 }], fixed(1)).factor, 0.25);
  // Chance 0 nunca pega; 0% de força anula a magia.
  assert.equal(resolveMagicDampen([{ chance: 0, percent: 10 }], fixed(1)).factor, 1);
  assert.equal(resolveMagicDampen([{ chance: 100, percent: 0 }], fixed(1)).factor, 0);
  assert.deepEqual(resolveMagicDampen([], fixed(1)), { factor: 1, applied: [], missed: 0 });
});

test("o alvo magicDampen: um efeito sem campo, só com o flag", () => {
  assert.ok(MEU_SISTEMA.EFFECT_TARGETS.includes("magicDampen"));
  assert.ok(MEU_SISTEMA.EFFECT_TARGET_GROUPS.find(g => g.label === "Magia").targets.includes("magicDampen"));
  const char = { type: "character" };
  const change = resolveEffectChange({ target: "magicDampen", amount: 50, chance: 40 }, char);
  assert.equal(change.key, null);
  assert.deepEqual(change.magicDampen, { chance: 40, percent: 50 });
  assert.equal(resolveEffectChange({ target: "magicDampen", amount: 50 }, char).magicDampen.chance, 100);
  assert.equal(resolveEffectChange({ target: "magicDampen", amount: 50 }, { type: "starship" }), null, "nave não usa magia");
});

test("quem entrou na bolha: quebra, inclui ou nada", () => {
  const inside = { inside: true };
  assert.equal(intruderOutcome({ rule: "break", ...inside }), "break");
  assert.equal(intruderOutcome({ rule: "include", ...inside }), "include");
  assert.equal(intruderOutcome({ rule: "", ...inside }), "none");
  assert.equal(intruderOutcome({ rule: "break", inside: false }), "none", "fora da bolha não conta");
  assert.equal(intruderOutcome({ rule: "break", ...inside, isCaster: true }), "none");
  assert.equal(intruderOutcome({ rule: "break", ...inside, isTarget: true }), "none");
  assert.deepEqual(INTRUDER_RULES, ["", "break", "include"]);
});

test("o alvo caiu: Caído, Inconsciente, morto, ou Vida 0", () => {
  assert.equal(targetHasFallen({ incapacitated: true }), true);
  assert.equal(targetHasFallen({ dead: true }), true);
  assert.equal(targetHasFallen({ hp: 0 }), true);
  assert.equal(targetHasFallen({ hp: 12 }), false);
  assert.equal(targetHasFallen({}), false);
});

test("avisos da Combinada", () => {
  assert.deepEqual(combinedIssues({ combined: false }), []);
  const empty = combinedIssues({ combined: true, subSkills: [] });
  assert.equal(empty[0].code, "combinedEmpty");
  assert.equal(empty[0].level, "hard");
  assert.ok(combinedIssues({ combined: true, subSkills: [part({ effectType: "form" })] }).some(i => i.code === "combinedForm" && i.level === "hard"));
  assert.ok(combinedIssues({ combined: true, subSkills: [part({ targetType: "zone" })] }).some(i => i.code === "combinedZone" && i.level === "hard"));
  assert.ok(combinedIssues({ combined: true, subSkills: [part()], prepTurns: 2 }).some(i => i.code === "combinedPrep" && i.level === "soft"));
  assert.deepEqual(combinedIssues({ combined: true, subSkills: [part()] }), []);

  // Pelo lint da Skill.
  const lint = lintSkill({ combined: true, subSkills: [], effectType: "none", targetType: "targeted" });
  assert.ok(lint.some(i => i.code === "combinedEmpty" && i.level === "hard" && i.tab === "mechanic"));
  const notActive = lintSkill({ endsWhenTargetFalls: true, effectType: "none", targetType: "targeted" });
  assert.ok(notActive.some(i => i.code === "duelNotActive" && i.level === "soft"));
  const dampenNever = lintSkill({ effectType: "temporary", targetType: "targeted", effects: [{ target: "magicDampen", amount: 50, chance: 0, durationRounds: 0 }] });
  assert.ok(dampenNever.some(i => i.code === "magicDampenNever" && i.level === "hard"));
  // 0% de força é válido (anula a magia): não é "valor 0".
  const zero = lintSkill({ effectType: "temporary", targetType: "targeted", effects: [{ target: "magicDampen", amount: 0, chance: 100, durationRounds: 1 }] });
  assert.ok(!zero.some(i => i.code === "zeroEffect"));
});

test("a complexidade já conta as partes da Combinada", () => {
  const subs = [part(), part(), part(), part()];
  assert.equal(skillComplexity({ combined: true, subSkills: subs }).score, 8, "2 por parte");
  assert.equal(skillComplexity({ combined: false, subSkills: subs }).score, 4, "1 por Sub-Skill");
});

test("o modelo Duelo na bolha traz tudo do pedido do dono", () => {
  const raw = MEU_SISTEMA.DEFAULT_SKILL_TEMPLATES.find(t => t.id === "duelo_bolha");
  assert.ok(raw, "modelo de fábrica");
  const template = normalizeSkillTemplate(raw);
  const skill = templateSkillData(template, {}, { conditions: ["duel-mark"], structures: ["duel-bubble"], elements: [], traits: [] });
  assert.equal(skill.tier, "unique");
  assert.equal(skill.hasUpkeep, true);
  assert.equal(skill.combined, true);
  assert.equal(skill.range, 10);
  assert.equal(skill.endsWhenTargetFalls, true);
  assert.equal(skill.intruderRule, "break");
  assert.deepEqual(skill.onlyIf, { kind: "otherConditionMine", value: "duel-mark", threshold: 50 });
  assert.equal(skill.onHit.conditionId, "duel-mark");
  // Debuff só enquanto desligada, em % de atributo.
  const mods = skill.conditionalModifiers;
  assert.deepEqual(mods.map(m => [m.then.kind, m.then.target, m.then.value, m.activeState]), [
    ["attributePercent", "strength", -100, "off"],
    ["attributePercent", "dexterity", -50, "off"]
  ]);
  // As quatro partes.
  assert.equal(skill.subSkills.length, 4);
  const [push, bubble, fury, dampen] = skill.subSkills;
  assert.deepEqual([push.targetType, push.areaShape, push.areaOrigin, push.areaAffects], ["emission", "circle", "caster", "othersExceptTarget"]);
  assert.equal(push.effects[0].target, "push");
  assert.deepEqual([bubble.effectType, bubble.structureId, bubble.structurePlace], ["structure", "duel-bubble", "caster"]);
  assert.deepEqual(fury.effects.map(e => [e.target, e.amountMode]), [["strength", "percentMax"], ["dexterity", "percentMax"]]);
  assert.equal(dampen.effects[0].target, "magicDampen");
  assert.equal(dampen.effects[0].chance, 50);
  assert.equal(dampen.effects[0].amount, 50);
  // A mecânica da mãe é só um recipiente: o Duelo é uma Combinada de verdade.
  assert.equal(isCombinedSkill(skill), true);
  assert.equal(skillUseMode({ ...skill, active: false, subSkills: undefined }, { areaEnabled: true, areaSupported: true }), "plain", "a mecânica da mãe é só o recipiente");
  assert.equal(skillUseMode({ ...skill, active: true, subSkills: undefined }, {}), "deactivate", "ligada, o clique desliga");
  // Mundana: a Antimagia não a desliga.
  assert.equal(skill.isMagic, false);
  assert.equal(skill.magicTag, "mundane");
  // Um mundo sem a Estrutura/Condição troca por algo que existe, sem quebrar.
  const poor = templateSkillData(template, {}, { conditions: [], structures: ["parede"], elements: [], traits: [] });
  assert.equal(poor.subSkills[1].structureId, "parede");
  assert.equal(poor.onHit.conditionId, "");
});

test("'Salvar como modelo' leva as partes de uma Combinada, e não as de uma Skill fundida", () => {
  const sub = { name: "Parte", active: true, investRatio: 3, effectType: "none" };
  const combined = templateFromSkill("Minha", { combined: true, subSkills: [sub], effectType: "none" });
  assert.equal(combined.skill.subSkills.length, 1);
  assert.equal(combined.skill.subSkills[0].active, undefined, "estado de uso não vai no modelo");
  const fused = templateFromSkill("Fundida", { subSkills: [sub], effectType: "none" });
  assert.equal(fused.skill.subSkills, undefined);
});

test("a IA aceita os campos do duelo e a nova Magia enfraquecida, só com ids que existem", () => {
  const ctx = {};
  const out = sanitizeSkillMechanics(
    {
      effectType: "temporary",
      hasUpkeep: true,
      upkeepCost: 3,
      areaAffects: "othersExceptTarget",
      endsWhenTargetFalls: true,
      intruderRule: "include",
      targetType: "emission",
      areaShape: "circle",
      areaDistance: 5,
      effects: [{ target: "magicDampen", amount: 50, chance: 30, durationRounds: 0 }]
    },
    {
      elements: [],
      conditions: [],
      traits: [],
      structures: [],
      weaponTypes: [],
      attributes: [],
      ...ctx
    }
  );
  assert.equal(out.areaAffects, "othersExceptTarget");
  assert.equal(out.endsWhenTargetFalls, true);
  assert.equal(out.intruderRule, "include");
  assert.equal(out.effects[0].target, "magicDampen");
  assert.equal(out.effects[0].chance, 30);
  // Sem ser Ativa, nada de duelo.
  const loose = sanitizeSkillMechanics({ effectType: "none", endsWhenTargetFalls: true, intruderRule: "break" }, { elements: [], conditions: [], traits: [], structures: [], weaponTypes: [], attributes: [] });
  assert.equal(loose.endsWhenTargetFalls, undefined);
  assert.equal(loose.intruderRule, undefined);
});

test("o pedido ao Mestre leva o índice da parte, e o pedido de Skill os campos novos", () => {
  const base = { sourceUuid: "Actor.x.Item.y", targetUuids: ["Actor.z"] };
  assert.equal(normalizeEffectRequest({ ...base, partIndex: 2 }).partIndex, 2);
  assert.equal(normalizeEffectRequest({ ...base }).partIndex, null);
  assert.equal(normalizeEffectRequest({ ...base, partIndex: -1 }).partIndex, null);
  assert.equal(normalizeEffectRequest({ ...base, partIndex: "2" }).partIndex, null);
  for (const key of ["structurePlace", "endsWhenTargetFalls", "intruderRule"]) assert.ok(REQUEST_MECHANIC_FIELDS.includes(key), key);
});

test("migração: acrescenta só o que falta, pelo id, sem tocar no editado", () => {
  const defaults = [{ id: "duel-mark", label: "Marca do Duelo" }, { id: "outra", label: "Outra" }];
  const edited = [{ id: "duel-mark", label: "Minha marca" }];
  const same = addMissingById(edited, defaults, ["duel-mark"]);
  assert.equal(same.changed, false);
  assert.equal(same.list[0].label, "Minha marca");
  const added = addMissingById([{ id: "x" }], defaults, ["duel-mark", "nao-existe"]);
  assert.equal(added.changed, true);
  assert.deepEqual(added.list.map(e => e.id), ["x", "duel-mark"]);
  // Cópia: mexer no resultado não mexe no padrão.
  added.list[1].label = "mudou";
  assert.equal(defaults[0].label, "Marca do Duelo");
  assert.deepEqual(addMissingById(null, defaults, ["outra"]).list.map(e => e.id), ["outra"]);
});
