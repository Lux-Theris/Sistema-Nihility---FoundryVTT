/**
 * Rerrolar e Dissipar (item 8d.2): as regras puras.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  rerollGroupOf, lowerIsBetter, normalizeRerollKinds, rerollRelation, rerollWhoReaches, rerollReaches, rerollKeepFor, rerollKeepOptions,
  pickKept, keepWord, damageRatio, scaleDamageEntry, scaleDamageFlags, damageCardRerollable, replacePredationRoll, rerollSentence, rerollLint,
  sanitizeRerollFields, rerollNoteText
} from "../module/skills/reroll-rules.js";
import { dissipatedEffects } from "../module/core/magic-rules.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { suggestSkillCost } from "../module/skills/skill-cost-rules.js";
import { sanitizeSkillMechanics } from "../module/ai/ai-mechanics.js";
import { MEU_SISTEMA } from "../module/core/config.js";

/* ------------------------------------------------------------------ Rerrolar */

test("o tipo de rolagem vira o grupo de caixas; d100 de chance: o menor é o melhor", () => {
  assert.equal(rerollGroupOf("attribute"), "attribute");
  assert.equal(rerollGroupOf("predation"), "chances");
  assert.equal(rerollGroupOf("overdraw"), "chances");
  assert.equal(rerollGroupOf("outra"), null);
  assert.equal(lowerIsBetter("predation"), true);
  assert.equal(lowerIsBetter("attribute"), false);
});

test("caixas: sem nada guardado valem todas; guardado, só o que veio", () => {
  assert.deepEqual(normalizeRerollKinds(undefined), { attribute: true, initiative: true, damage: true, chances: true });
  assert.deepEqual(normalizeRerollKinds({ attribute: true, damage: false }), { attribute: true, initiative: true, damage: false, chances: true });
});

test("de quem: própria, aliados, qualquer um", () => {
  assert.equal(rerollRelation({ same: true, ally: true }), "own");
  assert.equal(rerollRelation({ ally: true }), "ally");
  assert.equal(rerollRelation({}), "other");
  assert.equal(rerollWhoReaches("own", "own"), true);
  assert.equal(rerollWhoReaches("own", "ally"), false);
  assert.equal(rerollWhoReaches("allies", "ally"), true);
  assert.equal(rerollWhoReaches("allies", "other"), false);
  assert.equal(rerollWhoReaches("any", "other"), true);
});

test("a Skill alcança a rolagem pelo tipo e por quem rolou", () => {
  const mech = { rerollWho: "allies", rerollKinds: { attribute: true, initiative: false, damage: true, chances: false } };
  assert.equal(rerollReaches(mech, { rollKind: "attribute", relation: "ally" }), true);
  assert.equal(rerollReaches(mech, { rollKind: "initiative", relation: "own" }), false);
  assert.equal(rerollReaches(mech, { rollKind: "predation", relation: "own" }), false);
  assert.equal(rerollReaches(mech, { rollKind: "damage", relation: "other" }), false);
  assert.equal(rerollReaches({ rerollWho: "any" }, { rollKind: "overdraw", relation: "other" }), true);
  assert.equal(rerollReaches(mech, { rollKind: "desconhecida", relation: "own" }), false);
});

test("escolher na hora só vale numa Skill Ultimate", () => {
  assert.equal(rerollKeepFor("choose", "ultimate"), "choose");
  assert.equal(rerollKeepFor("choose", "unique"), "new");
  assert.equal(rerollKeepFor("best", "normal"), "best");
  assert.equal(rerollKeepFor("lixo", "ultimate"), "new");
  assert.deepEqual(rerollKeepOptions("ultimate"), ["new", "best", "worst", "choose"]);
  assert.deepEqual(rerollKeepOptions("normal"), ["new", "best", "worst"]);
});

test("o que fica: novo, melhor, pior; e o inverso num d100 de chance", () => {
  assert.equal(pickKept({ keep: "new", oldTotal: 18, newTotal: 4 }), "new");
  assert.equal(pickKept({ keep: "best", oldTotal: 18, newTotal: 4 }), "old");
  assert.equal(pickKept({ keep: "best", oldTotal: 4, newTotal: 18 }), "new");
  assert.equal(pickKept({ keep: "worst", oldTotal: 18, newTotal: 4 }), "new");
  assert.equal(pickKept({ keep: "worst", oldTotal: 4, newTotal: 18 }), "old");
  // d100 de chance: o MENOR é o melhor.
  assert.equal(pickKept({ keep: "best", oldTotal: 80, newTotal: 20, lower: true }), "new");
  assert.equal(pickKept({ keep: "best", oldTotal: 20, newTotal: 80, lower: true }), "old");
  assert.equal(pickKept({ keep: "worst", oldTotal: 20, newTotal: 80, lower: true }), "new");
  // empate: o novo
  assert.equal(pickKept({ keep: "best", oldTotal: 7, newTotal: 7 }), "new");
  assert.equal(keepWord("best"), "o melhor");
});

test("dano: razão novo ÷ antigo e card escalado", () => {
  assert.equal(damageRatio(10, 15), 1.5);
  assert.equal(damageRatio(0, 15), null);
  assert.equal(damageRatio(10, -1), null);
  const entry = { amount: 40, shieldBase: 40, shieldExtra: 10, absolute: false, targetUuid: "Actor.x", applied: null };
  const scaled = scaleDamageEntry(entry, 1.5);
  assert.equal(scaled.amount, 60);
  assert.equal(scaled.shieldBase, 60);
  assert.equal(scaled.shieldExtra, 15);
  assert.equal(scaled.targetUuid, "Actor.x");
  assert.equal(scaleDamageEntry(entry, 0).amount, 0);
  const flags = scaleDamageFlags({ damageApplyMany: { entries: [{ amount: 10 }, { amount: 4 }] } }, 2);
  assert.deepEqual(flags.damageApplyMany.entries.map(e => e.amount), [20, 8]);
  assert.equal(scaleDamageFlags({ damageApply: { amount: 7 } }, 3).damageApply.amount, 21);
});

test("card de dano só se refaz enquanto ninguém aplicou", () => {
  assert.equal(damageCardRerollable({ damageApply: { amount: 5, applied: null } }), true);
  assert.equal(damageCardRerollable({ damageApply: { amount: 5, applied: { hp: 1 } } }), false);
  assert.equal(damageCardRerollable({ damageApplyMany: { entries: [{ applied: null }, { applied: { x: 1 } }] } }), false);
  assert.equal(damageCardRerollable({ damageApplyMany: { entries: [{ applied: null }, { applied: null }] } }), true);
  assert.equal(damageCardRerollable({}), false);
});

test("Predação: troca o d100 de uma Skill e refaz ganhou/perdeu", () => {
  const results = [
    { skillId: "a", chance: 50, roll: 80, won: false },
    { skillId: "b", chance: 25, roll: 10, won: true }
  ];
  const next = replacePredationRoll(results, "a", 30);
  assert.equal(next[0].roll, 30);
  assert.equal(next[0].won, true);
  assert.deepEqual(next[1], results[1]);
  assert.equal(replacePredationRoll(results, "b", 900)[1].roll, 100);
  assert.equal(replacePredationRoll(results, "b", 900)[1].won, false);
});

test("frase, nota e saneamento", () => {
  const mech = { rerollWho: "allies", rerollKeep: "best", rerollKinds: { attribute: true, initiative: false, damage: true, chances: false } };
  const text = rerollSentence(mech);
  assert.match(text, /aliados/);
  assert.match(text, /atributo, dano/);
  assert.match(text, /o melhor/);
  assert.match(rerollSentence({ rerollKeep: "choose" }), /escolhe/);
  assert.match(rerollNoteText({ who: "Kaito", keep: "best", oldTotal: 12, newTotal: 17, kept: "new" }), /rerrolado por Kaito · fica o melhor \(12 → 17\)/);
  assert.match(rerollNoteText({ who: "Kaito", keep: "choose", oldTotal: 12, newTotal: 17, kept: "old" }), /escolheu o antigo/);
  assert.deepEqual(sanitizeRerollFields({ rerollWho: "todos", rerollKeep: "nunca" }), { rerollWho: "own", rerollKeep: "new", rerollKinds: { attribute: true, initiative: true, damage: true, chances: true } });
});

test("avisos de Rerrolar", () => {
  const codes = mech => rerollLint(mech).map(w => w.code);
  assert.deepEqual(codes({ rerollKinds: { attribute: false, initiative: false, damage: false, chances: false } }), ["rerollNoKinds"]);
  assert.ok(codes({ hasUpkeep: true }).includes("rerollActive"));
  assert.ok(codes({ prepTurns: 2 }).includes("rerollPrep"));
  assert.ok(codes({ rerollKeep: "choose", tier: "normal" }).includes("rerollChoose"));
  assert.deepEqual(codes({ rerollKeep: "choose", tier: "ultimate" }), []);
  // pelo lint da Skill inteira
  assert.ok(lintSkill({ effectType: "reroll", hasUpkeep: true }).some(w => w.code === "rerollActive"));
  assert.equal(lintSkill({ effectType: "reroll", cost: 5 }).some(w => w.code === "noEffects"), false);
});

test("a Mecânica Rerrolar existe nos catálogos e na frase da Skill", () => {
  assert.ok(MEU_SISTEMA.SKILL_EFFECT_TYPES.includes("reroll"));
  assert.ok(MEU_SISTEMA.SKILL_EFFECT_TYPE_LABELS.reroll);
  assert.ok(MEU_SISTEMA.SKILL_EFFECT_TYPE_SHORT_LABELS.reroll);
  const line = skillSummary({ effectType: "reroll", rerollWho: "own", rerollKeep: "worst", cost: 8, targetType: "emission", areaShape: "circle", areaDistance: 4 });
  assert.match(line, /reage a rolagens/);
  assert.match(line, /fica o pior/);
  assert.doesNotMatch(line, /círculo/);
});

test("custo sugerido: Rerrolar e Dissipar têm peso fixo", () => {
  const reroll = suggestSkillCost({ effectType: "reroll", level: 1 });
  assert.ok(reroll.points > 0);
  assert.ok(reroll.rows.some(r => /Rerrolar/.test(r.label)));
  const dispel = suggestSkillCost({ effectType: "temporary", level: 1, targetType: "targeted", effects: [{ target: "dispelMagic", amount: 0, durationRounds: 0, dispelScope: "all" }] });
  assert.ok(dispel.points > 0);
  assert.ok(dispel.rows.some(r => /Dissipar/.test(r.label)));
});

test("IA: Rerrolar saneada, nunca Ativa nem com Preparo", () => {
  const m = sanitizeSkillMechanics({ effectType: "reroll", rerollWho: "any", rerollKeep: "worst", rerollKinds: { attribute: true, damage: false }, hasUpkeep: true, upkeepCost: 3, prepTurns: 2, cost: 5 }, {});
  assert.equal(m.effectType, "reroll");
  assert.equal(m.rerollWho, "any");
  assert.equal(m.rerollKeep, "worst");
  assert.equal(m.rerollKinds.damage, false);
  assert.equal(m.hasUpkeep, false);
  assert.equal(m.prepTurns, 0);
});

/* ------------------------------------------------------------------ Dissipar */

const FX = [
  { id: "bless", level: 3, magic: true, conditionId: "blessed" },
  { id: "mark", level: 2, magic: true, conditionId: "marked" },
  { id: "curse", level: 8, magic: true, conditionId: "cursed" },
  { id: "poison", level: 1, magic: false, conditionId: "poisoned" },
  { id: "plain", level: 0, magic: true, conditionId: "" }
];

test("Dissipar: só magia, só de nível até o da Skill (sem ×1,5)", () => {
  assert.deepEqual(dissipatedEffects(FX, { level: 3 }), ["bless", "mark", "plain"]);
  assert.deepEqual(dissipatedEffects(FX, { level: 8 }), ["bless", "mark", "curse", "plain"]);
  assert.deepEqual(dissipatedEffects(FX, { level: 0 }), ["plain"]);
});

test("Dissipar: só marcas, ou só uma Condição escolhida", () => {
  assert.deepEqual(dissipatedEffects(FX, { level: 9, scope: "marks", markIds: ["marked"] }), ["mark"]);
  assert.deepEqual(dissipatedEffects(FX, { level: 9, scope: "marks", markIds: [] }), []);
  assert.deepEqual(dissipatedEffects(FX, { level: 9, scope: "condition", conditionId: "cursed" }), ["curse"]);
  assert.deepEqual(dissipatedEffects(FX, { level: 5, scope: "condition", conditionId: "cursed" }), []);
  assert.deepEqual(dissipatedEffects(FX, { level: 9, scope: "condition", conditionId: "poisoned" }), []);
  assert.deepEqual(dissipatedEffects(FX, { level: 9, scope: "condition", conditionId: "" }), []);
});

test("Dissipar existe como alvo de efeito do grupo Magia, com frase e aviso", () => {
  assert.ok(MEU_SISTEMA.EFFECT_TARGETS.includes("dispelMagic"));
  assert.ok(MEU_SISTEMA.EFFECT_TARGET_GROUPS.find(g => g.label === "Magia").targets.includes("dispelMagic"));
  const line = skillSummary({ effectType: "temporary", targetType: "targeted", cost: 6, effects: [{ target: "dispelMagic", dispelScope: "marks" }] });
  assert.match(line, /dissipa marcas/);
  const warns = lintSkill({ effectType: "temporary", targetType: "targeted", effects: [{ target: "dispelMagic", dispelScope: "condition", conditionId: "" }] }).map(w => w.code);
  assert.ok(warns.includes("dispelNoCondition"));
  assert.equal(warns.includes("zeroEffect"), false);
  const ok = lintSkill({ effectType: "temporary", targetType: "targeted", effects: [{ target: "dispelMagic", dispelScope: "all" }] }).map(w => w.code);
  assert.equal(ok.includes("zeroEffect"), false);
  assert.equal(ok.includes("dispelNoCondition"), false);
});

test("IA: Dissipar saneada (Condição que não existe derruba o efeito)", () => {
  const catalogs = { conditions: [{ id: "blessed", label: "Abençoado" }] };
  const base = { effectType: "temporary", targetType: "targeted", cost: 5 };
  const all = sanitizeSkillMechanics({ ...base, effects: [{ target: "dispelMagic", dispelScope: "bobagem" }] }, catalogs);
  assert.equal(all.effects[0].dispelScope, "all");
  const cond = sanitizeSkillMechanics({ ...base, effects: [{ target: "dispelMagic", dispelScope: "condition", conditionId: "blessed" }] }, catalogs);
  assert.equal(cond.effects[0].conditionId, "blessed");
  const bad = sanitizeSkillMechanics({ ...base, effects: [{ target: "dispelMagic", dispelScope: "condition", conditionId: "inventada" }] }, catalogs);
  assert.equal(bad.effectType, "none");
});

test("janela do Rerrolar: 10 minutos de relógio real (achado de 21/11)", async () => {
  const { rerollWindowOpen } = await import("../module/skills/reroll-rules.js");
  const now = 10_000_000;
  assert.equal(rerollWindowOpen(now - 5 * 60_000, now), true);
  assert.equal(rerollWindowOpen(now - 11 * 60_000, now), false);
  assert.equal(rerollWindowOpen(undefined, now), true);
});
