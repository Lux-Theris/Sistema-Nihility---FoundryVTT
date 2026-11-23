/**
 * Superfícies elementais (item 8.2): as regras puras. Critério e como rodar: ver o cabeçalho de
 * test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSurface,
  leavesSurface,
  surfaceIsMagic,
  surfaceChanceHits,
  surfaceExpiresAt,
  buildSurfaceFlag,
  surfaceEntered,
  surfaceReachesElevation,
  surfaceImmune,
  surfaceRoundStep,
  surfaceExpired,
  circlesTouch,
  findSameSurface,
  surfaceReaction,
  surfaceDispelled,
  polygonEdges,
  surfaceSentence,
  mergeSurfaceDefaults,
  surfaceProblems
} from "../module/environment/surface-rules.js";
import { NIHILITY, DEFAULT_ELEMENT_SURFACES } from "../module/core/config.js";
import { normalizeReactions } from "../module/combat/reaction-rules.js";

const elements = NIHILITY.DEFAULT_DAMAGE_ELEMENTS.map(e => ({ ...e, reactions: normalizeReactions(e.reactions) }));
const chainOf = id => {
  const byId = new Map(elements.map(e => [e.id, e]));
  const out = [];
  let current = byId.get(id);
  while (current && out.length < 5) {
    out.push(current);
    current = byId.get(current.parent);
  }
  return out;
};

test("normalizeSurface: limites, padrões e o que a caixa desligada guarda", () => {
  assert.equal(normalizeSurface(null), null);
  assert.equal(normalizeSurface([]), null);
  const empty = normalizeSurface({});
  assert.equal(empty.enabled, false);
  assert.equal(empty.nature, "origin");
  assert.equal(empty.chance, 100);
  const s = normalizeSurface({ enabled: true, label: " Poça ", chance: 500, radius: 99, height: -3, nature: "xyz", rounds: -1, minutes: 99999, immuneTraits: ["a", "a", ""] });
  assert.equal(s.label, "Poça");
  assert.equal(s.chance, 100);
  assert.equal(s.radius, 30);
  assert.equal(s.height, 0);
  assert.equal(s.nature, "origin");
  assert.equal(s.rounds, 0);
  assert.equal(s.minutes, 1440);
  assert.deepEqual(s.immuneTraits, ["a"]);
  // Desligada, mas escrita: nada some.
  const off = normalizeSurface({ enabled: false, label: "Chamas", damageFormula: "1d6" });
  assert.equal(off.label, "Chamas");
  assert.equal(off.damageFormula, "1d6");
  assert.equal(leavesSurface(off), false);
  assert.equal(leavesSurface({ enabled: true, radius: 0 }), false);
  assert.equal(leavesSurface({ enabled: true, radius: 2 }), true);
});

test("natureza: matéria nunca é mágica, mágica sempre, da origem herda", () => {
  assert.equal(surfaceIsMagic("matter", true), false);
  assert.equal(surfaceIsMagic("magic", false), true);
  assert.equal(surfaceIsMagic("origin", true), true);
  assert.equal(surfaceIsMagic("origin", false), false);
});

test("chance: 100 sempre, 0 nunca, o resto pelo d100", () => {
  assert.equal(surfaceChanceHits(100, 99), true);
  assert.equal(surfaceChanceHits(0, 1), false);
  assert.equal(surfaceChanceHits(50, 50), true);
  assert.equal(surfaceChanceHits(50, 51), false);
});

test("flag da superfície: raio e rodadas, relógio, natureza da origem e área em pixels", () => {
  const def = normalizeSurface({ enabled: true, label: "Chamas", radius: 2, rounds: 2, minutes: 5, nature: "origin", height: 2, damageFormula: "1d6", conditionId: "burn" });
  const flag = buildSurfaceFlag({ elementId: "fire", def, x: 100, y: 200, radiusPx: 200, originMagic: true, worldTime: 1000, useId: "abc" });
  assert.equal(flag.magic, true);
  assert.equal(flag.roundsLeft, 2);
  assert.equal(flag.expiresAt, 1300);
  assert.equal(flag.label, "Chamas");
  assert.equal(flag.height, 2);
  assert.deepEqual(flag.area, { shape: "circle", x: 100, y: 200, radius: 200, angle: 0, direction: 0, width: 0, elevation: 0 });
  // Efeito de Skill: raio e rodadas próprios.
  const own = buildSurfaceFlag({ elementId: "fire", def, x: 0, y: 0, radiusPx: 50, radiusMeters: 5, rounds: 7, worldTime: 0 });
  assert.equal(own.radius, 5);
  assert.equal(own.roundsLeft, 7);
  assert.equal(own.magic, false);
  // 0 minutos = só pelas rodadas.
  assert.equal(surfaceExpiresAt(10, 0), null);
});

test("entrar: só dispara quem estava fora e agora está dentro", () => {
  assert.equal(surfaceEntered(false, true), true);
  assert.equal(surfaceEntered(true, true), false);
  assert.equal(surfaceEntered(true, false), false);
  assert.equal(surfaceEntered(false, false), false);
});

test("altura: acima do que a superfície alcança e debaixo da terra não pisam", () => {
  assert.equal(surfaceReachesElevation({ elevation: 0, base: 0, height: 0 }), true);
  assert.equal(surfaceReachesElevation({ elevation: 1, base: 0, height: 0 }), false);
  assert.equal(surfaceReachesElevation({ elevation: 2, base: 0, height: 2 }), true);
  assert.equal(surfaceReachesElevation({ elevation: 3, base: 0, height: 2 }), false);
  assert.equal(surfaceReachesElevation({ elevation: -3, base: 0, height: 2 }), false);
  assert.equal(surfaceReachesElevation({ elevation: 5, base: 0, height: 0, elevationOn: false }), true, "sem o bloco Elevação a altura não conta");
});

test("Traço imune escapa", () => {
  assert.equal(surfaceImmune(["fireproof"], ["fireproof", "x"]), true);
  assert.equal(surfaceImmune(["fireproof"], ["x"]), false);
  assert.equal(surfaceImmune([], ["x"]), false);
});

test("duração: rodadas em combate, relógio do mundo fora, 0 = só o outro", () => {
  assert.deepEqual(surfaceRoundStep(3), { roundsLeft: 2, remove: false });
  assert.deepEqual(surfaceRoundStep(1), { roundsLeft: 0, remove: true });
  assert.deepEqual(surfaceRoundStep(0), { roundsLeft: 0, remove: false }, "0 rodadas = só o relógio");
  assert.equal(surfaceExpired({ expiresAt: 100, worldTime: 100, inCombat: false }), true);
  assert.equal(surfaceExpired({ expiresAt: 100, worldTime: 99, inCombat: false }), false);
  assert.equal(surfaceExpired({ expiresAt: 100, worldTime: 5000, inCombat: true }), false, "em combate o relógio não a apaga");
  assert.equal(surfaceExpired({ expiresAt: null, worldTime: 5000, inCombat: false }), false);
});

test("geometria: círculos que se tocam e a mesma superfície no mesmo lugar", () => {
  assert.equal(circlesTouch({ x: 0, y: 0, radius: 100 }, { x: 150, y: 0, radius: 60 }), true);
  assert.equal(circlesTouch({ x: 0, y: 0, radius: 100 }, { x: 300, y: 0, radius: 60 }), false);
  const list = [{ elementId: "water", area: { x: 0, y: 0, radius: 100 } }, { elementId: "fire", area: { x: 0, y: 0, radius: 100 } }];
  assert.equal(findSameSurface(list, { elementId: "fire", x: 20, y: 10, radiusPx: 100 }), 1);
  assert.equal(findSameSurface(list, { elementId: "fire", x: 400, y: 0, radiusPx: 100 }), -1);
  assert.equal(findSameSurface(list, { elementId: "oil", x: 0, y: 0, radiusPx: 100 }), -1);
  const edges = polygonEdges([0, 0, 10, 0, 10, 10]);
  assert.equal(edges.length, 3);
  assert.deepEqual(edges[2], [10, 10, 0, 0]);
});

test("golpe × superfície pela Tabela de reações: Fogo no óleo vira Chamas, Gelo apaga o fogo", () => {
  const fireOnOil = surfaceReaction(chainOf("fire"), "oil", elements);
  assert.equal(fireOnOil.action, "replace");
  assert.equal(fireOnOil.leaveSurface, "fire");
  assert.equal(fireOnOil.label, "Explosão");
  const iceOnFire = surfaceReaction(chainOf("ice"), "fire", elements);
  assert.equal(iceOnFire.action, "remove", "Apagar tira a Condição, então a superfície some");
  const fireOnIce = surfaceReaction(chainOf("fire"), "ice", elements);
  assert.equal(fireOnIce.action, "replace");
  assert.equal(fireOnIce.leaveSurface, "water", "Derretimento deixa Água");
  const lightningOnWater = surfaceReaction(chainOf("lightning"), "water", elements);
  assert.equal(lightningOnWater.action, "none", "eletrocutar não mexe na poça");
  assert.equal(surfaceReaction(chainOf("fire"), "", elements).action, "none");
  assert.equal(surfaceReaction(chainOf("acid"), "oil", elements).action, "none");
  // Mesma superfície: não se troca por si mesma.
  assert.equal(surfaceReaction([{ id: "x", reactions: { x: { label: "R", leaveSurface: "x" } } }], "x", []).action, "none");
});

test("Antimagia: só a mágica some", () => {
  assert.equal(surfaceDispelled({ magic: false, fieldLevel: 5, emissionKinds: ["magic"] }), false);
  assert.equal(surfaceDispelled({ magic: true, fieldLevel: 1 }), true);
  assert.equal(surfaceDispelled({ magic: true, fieldLevel: 0 }), false);
  assert.equal(surfaceDispelled({ magic: true, emissionKinds: ["magic"] }), true);
  assert.equal(surfaceDispelled({ magic: true, emissionKinds: ["tech"] }), false, "PEM não toca magia");
});

test("de fábrica: Água, Óleo, Fogo e Gelo deixam algo, com a natureza e a altura combinadas", () => {
  const byId = Object.fromEntries(NIHILITY.DEFAULT_DAMAGE_ELEMENTS.map(e => [e.id, e]));
  assert.equal(byId.water.surface.label, "Poça d'água");
  assert.equal(byId.water.surface.conditionId, "wet");
  assert.equal(byId.water.surface.height, 0);
  assert.equal(byId.oil.surface.conditionId, "oiled");
  assert.equal(byId.fire.surface.label, "Chamas");
  assert.equal(byId.fire.surface.damageFormula, "1d6");
  assert.equal(byId.fire.surface.conditionId, "burn");
  assert.equal(byId.fire.surface.height, 2);
  assert.equal(byId.fire.surface.nature, "origin");
  assert.equal(byId.ice.surface.conditionId, "slow");
  const conditionIds = new Set(NIHILITY.DEFAULT_STATUS_CONDITIONS.map(c => c.id).concat(NIHILITY.REACTION_CONDITIONS?.map(c => c.id) ?? [], ["wet", "oiled"]));
  for (const [id, def] of Object.entries(DEFAULT_ELEMENT_SURFACES)) {
    assert.deepEqual(surfaceProblems(id, normalizeSurface(def), { conditionIds, traitIds: new Set() }), [], `${id}: referência quebrada de fábrica`);
    assert.equal(leavesSurface(normalizeSurface(def)), true);
  }
});

test("migração: só acrescenta onde o elemento nunca teve o campo", () => {
  const saved = [{ id: "fire", label: "Fogo" }, { id: "water", label: "Água", surface: { enabled: false, label: "Minha poça" } }, { id: "dark", label: "Sombrio" }];
  const { elements: merged, changed } = mergeSurfaceDefaults(saved, DEFAULT_ELEMENT_SURFACES);
  assert.equal(changed, true);
  assert.equal(merged[0].surface.label, "Chamas");
  assert.equal(merged[1].surface.label, "Minha poça", "o editado não é sobrescrito");
  assert.equal(merged[2].surface, undefined);
  assert.equal(mergeSurfaceDefaults(merged, DEFAULT_ELEMENT_SURFACES).changed, false);
});

test("frase 'Na mesa' e Validar Mundo", () => {
  const s = normalizeSurface(DEFAULT_ELEMENT_SURFACES.fire);
  const text = surfaceSentence("Fogo", s, { condition: id => (id === "burn" ? "Queimadura" : id) });
  assert.match(text, /Chamas/);
  assert.match(text, /1d6 de Fogo/);
  assert.match(text, /Queimadura/);
  assert.match(text, /2 m de altura/);
  assert.equal(surfaceSentence("X", normalizeSurface({ enabled: false })), "");
  assert.match(surfaceSentence("Água", normalizeSurface(DEFAULT_ELEMENT_SURFACES.water)), /só o chão/);
  const bad = surfaceProblems("Fogo", normalizeSurface({ enabled: true, conditionId: "sumiu", immuneTraits: ["x"] }), { conditionIds: new Set(["burn"]), traitIds: new Set(["y"]) });
  assert.equal(bad.length, 2);
});

test("bloco Superfícies: desligado por padrão, pesado e do grupo Combate", () => {
  const f = NIHILITY.FEATURES.surfaces;
  assert.equal(f.default, false);
  assert.equal(f.heavy, true);
  assert.equal(f.group, "combat");
  assert.ok(NIHILITY.EFFECT_TARGETS.includes("createSurface"));
  assert.ok(NIHILITY.EFFECT_TARGET_GROUPS.some(g => g.targets.includes("createSurface")));
});

test("J9b: os minutos da superfície valem na linha da cena (ritmo)", () => {
  assert.equal(surfaceExpiresAt(1000, 10), 1600);
  assert.equal(surfaceExpiresAt(1000, 10, 1), 1600);
  assert.equal(surfaceExpiresAt(1000, 10, 0.5), 2200, "ritmo lento: o relógio de fora conta o dobro");
  assert.equal(surfaceExpiresAt(1000, 10, 2), 1300);
  assert.equal(surfaceExpiresAt(1000, 0, 2), null);
  assert.equal(surfaceExpiresAt(1000, 10, 0), 1600, "ritmo inválido vira 1");
});
