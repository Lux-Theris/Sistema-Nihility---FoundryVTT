import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  borrowableSkill, borrowBlockReason, borrowedSkillList, borrowedLabel, borrowedSectionTitle, addBorrowLink, addLendLink, removeBorrowLink,
  removeLendLink, setLendBlocked, setLendReleased, linkUsable, skillLent, pactObserversToGrant
} from "../module/skills/borrowed-rules.js";

const damage = { effectType: "damage", hasUpkeep: false };

test("passam só Skills de uso na hora", () => {
  assert.equal(borrowableSkill(damage), true);
  assert.equal(borrowableSkill({ effectType: "temporary", targetType: "emission" }), true);
  assert.ok(borrowBlockReason({ ...damage, hasUpkeep: true }));
  assert.ok(borrowBlockReason({ ...damage, prepTurns: 2 }));
  assert.ok(borrowBlockReason({ ...damage, resistanceTarget: "fire" }));
  assert.ok(borrowBlockReason({ ...damage, weaponMastery: "blade" }));
  assert.ok(borrowBlockReason({ ...damage, coreSkill: "manaManipulation" }));
  for (const effectType of ["form", "none", "analysis", "predation", "structure"]) assert.ok(borrowBlockReason({ effectType }), effectType);
  assert.ok(borrowBlockReason({ ...damage, targetType: "zone" }));
  for (const target of ["push", "antimagic", "emp", "mark"]) assert.ok(borrowBlockReason({ effectType: "temporary", effects: [{ target }] }), target);
  assert.equal(borrowableSkill({ effectType: "temporary", effects: [{ target: "hp" }, { target: "strength" }] }), true);
});

test("um componente que não passa barra a Skill inteira", () => {
  assert.equal(borrowableSkill({ ...damage, subSkills: [damage, { effectType: "temporary" }] }), true);
  assert.equal(borrowableSkill({ ...damage, subSkills: [damage, { effectType: "form" }] }), false);
});

test("Corredor empresta tudo que passa; Pacto só o que foi liberado", () => {
  const skills = [{ id: "a", system: damage }, { id: "b", system: { ...damage, hasUpkeep: true } }, { id: "c", system: damage }];
  assert.deepEqual(borrowedSkillList("soul", skills).map(s => s.id), ["a", "c"]);
  assert.deepEqual(borrowedSkillList("pact", skills, ["a", "b"]).map(s => s.id), ["a"]);
  assert.deepEqual(borrowedSkillList("pact", skills).map(s => s.id), []);
});

test("os textos do card e da seção", () => {
  assert.equal(borrowedLabel("soul", "Kaito"), "pelo Corredor de alma de Kaito");
  assert.equal(borrowedLabel("pact", "Lilith"), "pelo Pacto com Lilith");
  assert.equal(borrowedSectionTitle("soul", "Kaito"), "Corredor de alma: Kaito");
  assert.equal(borrowedSectionTitle("pact", "Lilith"), "Pacto: Lilith");
});

test("as listas de vínculos não se duplicam e não mudam a original", () => {
  const original = [{ kind: "soul", sourceUuid: "A", since: 1 }];
  const next = addBorrowLink(original, { kind: "soul", sourceUuid: "A", since: 2 });
  assert.equal(next.length, 1);
  assert.equal(next[0].since, 2);
  assert.equal(original[0].since, 1);
  const both = addBorrowLink(next, { kind: "pact", sourceUuid: "A" });
  assert.equal(both.length, 2);
  assert.deepEqual(removeBorrowLink(both, "pact", "A").map(l => l.kind), ["soul"]);

  const lends = addLendLink([], { kind: "pact", borrowerUuid: "B", released: ["x"] });
  assert.equal(lends[0].blocked, false);
  assert.deepEqual(removeLendLink(lends, "pact", "B"), []);
});

test("Aceitar pedidos e Skills liberadas", () => {
  let lends = addLendLink([], { kind: "pact", borrowerUuid: "B" });
  lends = setLendReleased(lends, "B", "s1", true);
  lends = setLendReleased(lends, "B", "s2", true);
  lends = setLendReleased(lends, "B", "s1", false);
  assert.deepEqual(lends[0].released, ["s2"]);
  lends = setLendBlocked(lends, "pact", "B", true);
  assert.equal(lends[0].blocked, true);
  assert.equal(setLendReleased(addLendLink([], { kind: "soul", borrowerUuid: "B" }), "B", "s", true)[0].released.length, 0);
});

test("o vínculo só vale se os dois lados concordam e o dono aceita", () => {
  const borrowLinks = [{ kind: "soul", sourceUuid: "Owner" }];
  const lendLinks = [{ kind: "soul", borrowerUuid: "Me", blocked: false }];
  assert.equal(linkUsable({ borrowLinks, lendLinks }, { kind: "soul", ownerUuid: "Owner", borrowerUuid: "Me" }).ok, true);
  assert.equal(linkUsable({ borrowLinks: [], lendLinks }, { kind: "soul", ownerUuid: "Owner", borrowerUuid: "Me" }).ok, false);
  assert.equal(linkUsable({ borrowLinks, lendLinks: [] }, { kind: "soul", ownerUuid: "Owner", borrowerUuid: "Me" }).ok, false);
  const blocked = linkUsable({ borrowLinks, lendLinks: setLendBlocked(lendLinks, "soul", "Me", true) }, { kind: "soul", ownerUuid: "Owner", borrowerUuid: "Me" });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /pedidos/);
});

test("skillLent confere liberação no Pacto", () => {
  assert.equal(skillLent("soul", {}, "a", damage), true);
  assert.equal(skillLent("pact", { released: [] }, "a", damage), false);
  assert.equal(skillLent("pact", { released: ["a"] }, "a", damage), true);
  assert.equal(skillLent("pact", { released: ["a"] }, "a", { effectType: "form" }), false);
});

test("quem ganha OBSERVER no patrono", () => {
  assert.deepEqual(pactObserversToGrant(["u1", "u2"], { u1: 3, default: 0 }), ["u2"]);
  assert.deepEqual(pactObserversToGrant(["u1"], { default: 2 }), []);
});
