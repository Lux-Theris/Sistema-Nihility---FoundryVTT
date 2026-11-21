import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFormSystem, itemsFromOriginal, copiedSkillState, mergeBackPlan, conditionsToCarry, carryDamage, hpAfterCarry,
  accumulateCarry, shouldRevert, formActorName, tokenOriginalSnapshot, formTokenUpdate, tokenRestoreUpdate, normalizeFormRequest, isImageFile, mapCopiedId, itemMapFromStamps
} from "../module/skills/form-rules.js";

test("a cópia pega nível, XP e Mana do personagem e o resto do molde", () => {
  const sys = buildFormSystem(
    { attributes: { level: 1, xp: 0, energy: { value: 5, max: 9 }, combat: { strength: { points: 30 } } }, formTemplate: true },
    { attributes: { level: 7, xp: 120, energy: { value: 40 } }, isPlayerCharacter: true }
  );
  assert.equal(sys.attributes.level, 7);
  assert.equal(sys.attributes.xp, 120);
  assert.equal(sys.attributes.energy.value, 40);
  assert.equal(sys.attributes.combat.strength.points, 30);
  assert.equal(sys.formTemplate, false);
});

test("itens do personagem: só Títulos e Skills não Raciais nem concedidas", () => {
  const out = itemsFromOriginal([
    { id: "a", type: "title" }, { id: "b", type: "skill", system: { tier: "normal" } },
    { id: "c", type: "skill", system: { tier: "racial" } }, { id: "d", type: "skill", system: { isItemGranted: true } },
    { id: "e", type: "item" }, { id: "f", type: "body_part" }
  ]);
  assert.deepEqual(out.map(i => i.id), ["a", "b"]);
});

test("Skill copiada vai desligada, menos a da Forma", () => {
  const skill = { system: { active: true, subSkills: [{ active: true }] } };
  assert.equal(copiedSkillState(skill).system.active, false);
  assert.equal(copiedSkillState(skill).system.subSkills[0].active, false);
  assert.equal(copiedSkillState(skill, { isFormSkill: true }).system.active, true);
  assert.equal(skill.system.active, true);
});

test("mesclar de volta: XP ganho soma, Mana fica a da cópia", () => {
  const plan = mergeBackPlan({
    original: { xp: 100, energy: 80, energyMax: 100 }, copy: { xp: 130, energy: 25 }, startXp: 100,
    skills: [{ originalId: "s1", copyId: "c1", xp: 12, level: 3 }, { originalId: "s2", copyId: "c2", xp: 0, level: 1 }], formSkillId: "s2"
  });
  assert.equal(plan.xp, 130);
  assert.equal(plan.energy, 25);
  assert.equal(plan.skills[0].xp, 12);
  assert.equal(plan.skills[1].isFormSkill, true);
  assert.equal(plan.skills[1].active, false);
  assert.equal(mergeBackPlan({ original: { xp: 5, energy: 1, energyMax: 10 }, copy: { xp: 0, energy: 99 }, startXp: 10 }).energy, 10);
});

test("Condições que voltam: sem as do Vida 0, do ambiente e do corpo da forma", () => {
  const sys = "nihility-rpg-system";
  const out = conditionsToCarry([
    { _id: "1", statuses: ["poison"], flags: { [sys]: { conditionId: "poison" } } },
    { _id: "2", statuses: ["fallen"], flags: { [sys]: { conditionId: "fallen", incapacitation: { x: 1 } } } },
    { _id: "3", flags: { [sys]: { environment: { sceneId: "a" }, conditionId: "x" } } },
    { _id: "4", flags: {} }
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]._id, undefined);
});

test("dano que passa do 0 da forma vira carry", () => {
  assert.equal(carryDamage(10, 25), 15);
  assert.equal(carryDamage(10, 8), 0);
  assert.equal(carryDamage(0, 7), 7);
  assert.equal(hpAfterCarry(20, 15), 5);
  assert.equal(hpAfterCarry(10, 50), 0);
  assert.equal(accumulateCarry(3, 4), 7);
});

test("quando volta", () => {
  assert.equal(shouldRevert({ formSkillActive: true, hp: 5 }), false);
  assert.equal(shouldRevert({ formSkillActive: false, hp: 5 }), true);
  assert.equal(shouldRevert({ formSkillActive: true, hp: 0 }), true);
});

test("nome, Token e mapa de ids", () => {
  assert.equal(formActorName("Kaito", "Lobo"), "Kaito (Lobo)");
  const snap = tokenOriginalSnapshot({ actorId: "a", actorLink: false, delta: { x: 1 }, texture: { src: "t.png" }, width: 2, height: 2 });
  assert.deepEqual(tokenRestoreUpdate(snap), { actorId: "a", actorLink: false, "texture.src": "t.png", width: 2, height: 2, delta: { x: 1 } });
  assert.equal(formTokenUpdate("c", { textureSrc: "w.png", width: 3, height: 3 })["texture.src"], "w.png");
  assert.equal(mapCopiedId({ a: "b" }, "a"), "b");
  assert.equal(mapCopiedId({}, "a"), null);
});

test("pedido de forma: pontos limitados ao total do personagem", () => {
  const limits = { total: 40, attributeKeys: ["strength", "defense"], speciesIds: ["lobo"] };
  assert.equal(normalizeFormRequest({ name: " Lobo ", speciesId: "lobo", points: { strength: 25, defense: 15 } }, limits).spent, 40);
  assert.equal(normalizeFormRequest({ name: "Lobo", speciesId: "lobo", points: { strength: 30, defense: 15 } }, limits), null);
  assert.equal(normalizeFormRequest({ name: "", points: {} }, limits), null);
  assert.equal(normalizeFormRequest({ name: "X", speciesId: "dragao", points: {} }, limits), null);
});

test("arquivo de imagem", () => {
  assert.equal(isImageFile({ type: "image/png", name: "a" }), true);
  assert.equal(isImageFile({ type: "", name: "a.WEBP" }), true);
  assert.equal(isImageFile({ type: "application/pdf", name: "a.pdf" }), false);
});

import { skillUseMode } from "../module/skills/skill-use-mode.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";
import { skillSummaryParts } from "../module/skills/skill-summary.js";
import { suggestSkillCost } from "../module/skills/skill-cost-rules.js";
import { canSimulate } from "../module/combat/encounter-sim.js";

test("o uso de uma Skill de Forma ligada vira o modo 'form'; ligada de novo só desliga", () => {
  assert.equal(skillUseMode({ effectType: "form", hasUpkeep: true, active: false }), "form");
  assert.equal(skillUseMode({ effectType: "form", hasUpkeep: true, active: true }), "deactivate");
});

test("avisos da Forma: precisa ser Ativa, ter ficha e o molde existir", () => {
  const codes = mech => lintSkill(mech, { formTemplateOk: uuid => uuid === "Actor.ok" }).map(w => w.code);
  assert.ok(codes({ effectType: "form", hasUpkeep: false, formActorUuid: "Actor.ok" }).includes("formNotActive"));
  assert.ok(codes({ effectType: "form", hasUpkeep: true, formActorUuid: "" }).includes("noFormActor"));
  assert.ok(codes({ effectType: "form", hasUpkeep: true, formActorUuid: "Actor.sumiu" }).includes("missingFormTemplate"));
  assert.ok(!codes({ effectType: "form", hasUpkeep: true, formActorUuid: "Actor.ok" }).some(c => /form/i.test(c)));
});

test("a frase diz 'Forma: Lobo' e o molde fica fora do Simulador", () => {
  const parts = skillSummaryParts({ effectType: "form", formActorUuid: "Actor.x", cost: 10 }, { formName: () => "Lobo" });
  assert.ok(parts.includes("Forma: Lobo"));
  assert.equal(canSimulate({ type: "character", system: { formTemplate: true } }), false);
  assert.equal(canSimulate({ type: "character", system: {} }), true);
});

test("custo sugerido de uma Forma: peso fixo", () => {
  const out = suggestSkillCost({ effectType: "form", hasUpkeep: true, upkeepCost: 0 }, {});
  assert.ok(out.cost > 0 || out.suggested > 0 || out.rows?.length);
});

test("itemMapFromStamps mapeia pelo carimbo, não pela ordem devolvida", () => {
  const created = [{ id: "c2", stamp: "o2" }, { id: "c1", stamp: "o1" }, { id: "x", stamp: null }];
  assert.deepEqual(itemMapFromStamps(created), { o2: "c2", o1: "c1" });
});
