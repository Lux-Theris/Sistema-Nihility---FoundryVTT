/**
 * Área por nível, ajuste na colocação e Estrutura que segue quem lançou (1.118.0).
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { effectiveAreaSize, mechAreaSize, structureAreaSize, clampAreaSize, stepAreaSize, areaSizeLabel, placementHintText, perLevelText, areaMaxSize, areaLevelShift, resolveAreaSize, resolveMechArea, resolveStructureArea, fieldLevelWithShift, concentrationNote } from "../module/combat/area-size-rules.js";
import { areaFromSkill } from "../module/combat/area-geometry.js";
import { shiftCoords, shiftSegments, movementDelta, followsToken, fieldAffectsActor } from "../module/structures/structure-geometry.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";
import { REQUEST_MECHANIC_FIELDS } from "../module/creation/creation-rules.js";
import { sanitizeSkillMechanics } from "../module/ai/ai-mechanics.js";

test("tamanho efetivo = base + por nível × (nível − 1); nível 1 é a base", () => {
  assert.equal(effectiveAreaSize({ base: 3, perLevel: 1, level: 4 }), 6);
  assert.equal(effectiveAreaSize({ base: 3, perLevel: 1, level: 1 }), 3);
  assert.equal(effectiveAreaSize({ base: 3, perLevel: 1, level: 0 }), 3);
  assert.equal(effectiveAreaSize({ base: 3, perLevel: 0.5, level: 3 }), 4);
  assert.equal(mechAreaSize({ areaDistance: 3, areaPerLevel: 1, level: 4 }), 6);
  assert.equal(mechAreaSize({ areaDistance: 3 }), 3);
  assert.equal(structureAreaSize(3, { areaPerLevel: 1, level: 4 }), 6);
});

test("ajuste na colocação: Ctrl+roda de 1 m até o máximo; sem escolha vale o máximo", () => {
  assert.equal(clampAreaSize(null, 6), 6);
  assert.equal(clampAreaSize(99, 6), 6);
  assert.equal(clampAreaSize(0, 6), 1);
  assert.equal(clampAreaSize(4, 0), 0);
  assert.equal(stepAreaSize(6, 100, 6), 5, "roda para baixo diminui");
  assert.equal(stepAreaSize(6, -100, 6), 6, "no máximo, aumentar não passa");
  assert.equal(stepAreaSize(1, 100, 6), 1, "piso de 1 m");
  assert.equal(areaSizeLabel(4, 6), "4 / 6 m");
});

test("barra de dica do quadro 5", () => {
  assert.equal(placementHintText({ size: 4, max: 6, turn: true }), "Ctrl+roda: tamanho 4 / 6 m · Roda: gira (Cone/Linha) · Clique: confirma · Esc: cancela");
  assert.equal(placementHintText({ size: 1, max: 1 }), "Clique: confirma · Esc: cancela");
  assert.equal(perLevelText(1), "+1 m por nível");
  assert.equal(perLevelText(0), "");
});

test("concentração: máximo = onde o nível efetivo chega a 1; cada metro a menos é +1 nível, a mais −1; piso de 1 m e do nível", () => {
  // Quadro 8: Vazio Arcano, nível 4, base 3 + 1 por nível = padrão 6 m, máximo 6 + 3 = 9 m.
  const mech = { areaDistance: 3, areaPerLevel: 1, level: 4 };
  const base = resolveMechArea(mech);
  assert.deepEqual([base.defaultSize, base.maxSize, base.size, base.effectiveLevel], [6, 9, 6, 4]);
  const small = resolveMechArea(mech, 2);
  assert.deepEqual([small.size, small.shift, small.effectiveLevel], [2, 4, 8], "2 m: nível do efeito 8 (+4)");
  const big = resolveMechArea(mech, 9);
  assert.deepEqual([big.size, big.shift, big.effectiveLevel], [9, -3, 1], "9 m: o máximo, nível do efeito 1 (−3)");
  assert.equal(resolveMechArea(mech, 50).size, 9, "nunca acima do máximo");
  assert.equal(resolveMechArea(mech, 0).size, 1, "piso de 1 m");
  assert.equal(resolveMechArea(mech, "x").size, 6, "sem escolha vale o padrão");
  // Máximo = min(5× o padrão, padrão + (nível − 1)).
  assert.equal(areaMaxSize(2, 30), 10, "5× o padrão limita");
  assert.equal(areaMaxSize(6, 4), 9);
  assert.equal(areaMaxSize(6, 1), 6, "nível 1: não cresce");
  assert.equal(areaLevelShift(6, 2), 4);
  assert.equal(resolveAreaSize({ base: 3, perLevel: 0, level: 1, size: 1 }).effectiveLevel, 3, "nível 1, 3 m → 1 m = nível 3");
  assert.equal(resolveAreaSize({ base: 0, level: 5 }).maxSize, 0, "sem área, sem concentração");
  // Raio base da Skill substitui o do catálogo; vazio = catálogo.
  assert.equal(resolveStructureArea(3, { level: 1 }).defaultSize, 3);
  assert.equal(resolveStructureArea(3, { structureSize: 5, areaPerLevel: 1, level: 3 }).defaultSize, 7);
  assert.equal(structureAreaSize(3, { structureSize: 5 }), 5);
  // Campo de Antimagia: o nível do campo sobe/desce com o desvio, nunca abaixo de 1; 0 não é campo.
  assert.equal(fieldLevelWithShift(3, 4), 7);
  assert.equal(fieldLevelWithShift(3, -9), 1);
  assert.equal(fieldLevelWithShift(0, 4), 0);
  assert.match(concentrationNote(base), /Padrão no nível 4: 6 m\. Na hora de usar vai de 1 m até 9 m/);
  assert.equal(concentrationNote(null), "");
});

test("barra de dica do quadro 8 (concentração)", () => {
  assert.equal(
    placementHintText({ size: 2, max: 9, def: 6, level: 4, effLevel: 8 }),
    "Ctrl+roda: tamanho 2 m (padrão 6, máx. 9) · nível do efeito 8 (+4) · sem custo · Clique: confirma · Esc: cancela"
  );
  assert.match(placementHintText({ size: 9, max: 9, def: 6, level: 4, effLevel: 1 }), /nível do efeito 1 \(−3\)/);
  assert.match(placementHintText({ size: 6, max: 9, def: 6, level: 4, effLevel: 4, levelWord: "campo" }), /nível do campo 4 · sem custo/);
});

test("a área usa o tamanho do nível e o escolhido (até o máximo da concentração)", () => {
  const mech = { areaShape: "circle", areaDistance: 3, areaPerLevel: 1, level: 4 };
  const grid = { pxPerUnit: 10, cellPx: 100 };
  assert.equal(areaFromSkill(mech, { x: 0, y: 0 }, grid).radius, 60);
  assert.equal(areaFromSkill(mech, { x: 0, y: 0 }, { ...grid, size: 4 }).radius, 40);
  assert.equal(areaFromSkill(mech, { x: 0, y: 0 }, { ...grid, size: 50 }).radius, 90, "o máximo do nível 4 é 9 m");
  assert.equal(areaFromSkill(mech, { x: 0, y: 0 }, { ...grid, size: 8 }).radius, 80, "maior que o padrão: nível efetivo menor");
  assert.equal(areaFromSkill({ areaShape: "circle", areaDistance: 3 }, { x: 0, y: 0 }, grid).radius, 30);
});

test("frase da Skill: raio com '+ por nível' e a aura que segue", () => {
  const base = { effectType: "damage", damageFormula: "1d6", targetType: "emission", areaShape: "circle", areaDistance: 3, areaPerLevel: 1 };
  assert.match(skillSummary(base, {}), /3 m \(\+1 m por nível\)/);
  const aura = { effectType: "structure", structureId: "campo", structureFollows: true, areaPerLevel: 1, hasUpkeep: true, cost: 10, upkeepCost: 4 };
  const text = skillSummary(aura, { structures: { campo: "Campo de Antimagia" }, structureSizes: { campo: 3 }, fieldStructures: { campo: true } });
  assert.match(text, /Campo de Antimagia de 3 m \(\+1 m por nível\), segue quem lançou; quem lançou não é afetado/);
});

test("lint: 'Segue quem lançou' sem Skill Ativa avisa; com Ativa não", () => {
  const codes = m => lintSkill(m, {}).map(i => i.code);
  const base = { effectType: "structure", structureId: "campo", structureFollows: true };
  assert.ok(codes(base).includes("structureFollowsNotActive"));
  assert.ok(!codes({ ...base, hasUpkeep: true }).includes("structureFollowsNotActive"));
});

test("campos novos entram nas listas de cópia e na IA", () => {
  for (const key of ["areaPerLevel", "structureFollows"]) assert.ok(REQUEST_MECHANIC_FIELDS.includes(key), key);
  const out = sanitizeSkillMechanics({ effectType: "structure", structureId: "campo", hasUpkeep: true, areaPerLevel: 1.3, structureFollows: true }, { structures: [{ id: "campo" }], elements: [], conditions: [], attributes: [] });
  assert.equal(out.areaPerLevel, 1.5);
  assert.equal(out.structureFollows, true);
  assert.equal(sanitizeSkillMechanics({ effectType: "structure", structureId: "campo", structureFollows: true }, { structures: [{ id: "campo" }], elements: [], conditions: [], attributes: [] }).structureFollows, false);
});

test("aura que segue: desloca paredes, segue só o Token de quem lançou", () => {
  assert.deepEqual(shiftCoords([0, 0, 10, 20], 5, -5), [5, -5, 15, 15]);
  assert.deepEqual(shiftSegments([[0, 0, 1, 1]], 2, 3), [[2, 3, 3, 4]]);
  assert.deepEqual(movementDelta({ x: 100, y: 100 }, { x: 300, y: 50 }), { dx: 200, dy: -50 });
  assert.equal(movementDelta({ x: 1 }, { x: 2, y: 2 }), null);
  const instance = { follows: true, sourceActorUuid: "Actor.a", casterTokenId: "t1" };
  assert.equal(followsToken(instance, { actorUuid: "Actor.a", tokenId: "t1" }), true);
  assert.equal(followsToken(instance, { actorUuid: "Actor.a", tokenId: "t2" }), false);
  assert.equal(followsToken(instance, { actorUuid: "Actor.b", tokenId: "t1" }), false);
  assert.equal(followsToken({ ...instance, follows: false }, { actorUuid: "Actor.a", tokenId: "t1" }), false);
  assert.equal(followsToken({ follows: true, sourceActorUuid: "Actor.a" }, { actorUuid: "Actor.a", tokenId: "x" }), true);
});

test("o campo não afeta quem o lançou (aliados e inimigos, sim)", () => {
  assert.equal(fieldAffectsActor("Actor.a", "Actor.a"), false);
  assert.equal(fieldAffectsActor("Actor.a", "Actor.b"), true);
  assert.equal(fieldAffectsActor(undefined, "Actor.b"), true);
});
