/**
 * Empurrar/puxar (J1) e voo, altura e escavação (J4): regras puras, geometria 3D, frase da Skill,
 * aviso do editor e limpeza da IA. Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizePushDirection,
  effectivePushMeters,
  averageResistance,
  pushContestAttributes,
  pushContest,
  metersAfterContest,
  pushDestination,
  leftoverMeters,
  impactDamage,
  fallDamage,
  distance3d,
  stepElevation,
  groundState,
  manualElevationWarning,
  hiddenUnderground,
  meleeOutOfVerticalReach,
  areaReaches3d,
  pathStop
} from "../module/combat/forced-movement-rules.js";
import { areaFromSkill, areaContains3d, normalizeArea } from "../module/combat/area-geometry.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";
import { suggestSkillCost } from "../module/skills/skill-cost-rules.js";
import { sanitizeSkillMechanics } from "../module/ai/ai-mechanics.js";
import { diffPositions, actorEntryHasChanges, undoPreviewRows } from "../module/skills/skill-undo-rules.js";
import { checkMechanic, buildCatalogIndex } from "../module/world/world-validator.js";

test("direção do empurrão: só push, pull ou choose", () => {
  assert.equal(normalizePushDirection("pull"), "pull");
  assert.equal(normalizePushDirection("choose"), "choose");
  assert.equal(normalizePushDirection("xyz"), "push");
  assert.equal(normalizePushDirection(undefined), "push");
});

test("metros efetivos: Defesa Mágica só para o mágico, Resistência do elemento, Traço imune zera", () => {
  assert.equal(effectivePushMeters({ meters: 10 }), 10);
  assert.equal(effectivePushMeters({ meters: 10, magical: true, magicDefense: 0.3 }), 7);
  // Defesa Mágica não conta se o empurrão não é mágico.
  assert.equal(effectivePushMeters({ meters: 10, magical: false, magicDefense: 0.3 }), 10);
  assert.equal(effectivePushMeters({ meters: 10, elementResistance: 0.5 }), 5);
  assert.equal(effectivePushMeters({ meters: 10, magical: true, magicDefense: 0.5, elementResistance: 0.5 }), 2.5);
  assert.equal(effectivePushMeters({ meters: 10, elementResistance: 1 }), 0);
  assert.equal(effectivePushMeters({ meters: 10, immune: true }), 0);
  assert.equal(effectivePushMeters({ meters: -3 }), 0);
});

test("resistência média de vários elementos", () => {
  assert.equal(averageResistance([]), 0);
  assert.equal(averageResistance([0.5, 0.1]), 0.3);
  assert.equal(averageResistance([2]), 1);
});

test("teste de Defesa: mágico rola Magia, físico rola Força (ou o atributo da arma); alvo rola Defesa", () => {
  assert.deepEqual(pushContestAttributes({ magical: true }), { pusher: "magic", defender: "defense" });
  assert.deepEqual(pushContestAttributes({}), { pusher: "strength", defender: "defense" });
  assert.deepEqual(pushContestAttributes({ scalingAttribute: "precision" }), { pusher: "precision", defender: "defense" });
});

test("o alvo só vence com mais que quem empurra; vencer = metade dos metros", () => {
  assert.equal(pushContest({ pusherTotal: 10, defenderTotal: 11 }).defenderWins, true);
  assert.equal(pushContest({ pusherTotal: 10, defenderTotal: 10 }).defenderWins, false);
  assert.equal(pushContest({ pusherTotal: 12, defenderTotal: 3 }).defenderWins, false);
  assert.equal(metersAfterContest(8, true), 4);
  assert.equal(metersAfterContest(5, true), 2.5);
  assert.equal(metersAfterContest(8, false), 8);
});

test("destino em linha reta: empurrar afasta, puxar aproxima sem passar da origem", () => {
  const origin = { x: 0, y: 0 };
  const target = { x: 100, y: 0 };
  // 10 px por metro: o alvo está a 10 m.
  assert.deepEqual(pushDestination({ origin, target, meters: 5, direction: "push", pxPerUnit: 10 }), { x: 150, y: 0, meters: 5 });
  const pull = pushDestination({ origin, target, meters: 4, direction: "pull", pxPerUnit: 10 });
  assert.equal(pull.x, 60);
  assert.equal(pull.meters, 4);
  // Puxar mais do que a distância pára na origem.
  const stop = pushDestination({ origin, target, meters: 50, direction: "pull", pxPerUnit: 10 });
  assert.equal(stop.x, 0);
  assert.equal(stop.meters, 10);
  // Diagonal.
  const diag = pushDestination({ origin: { x: 0, y: 0 }, target: { x: 30, y: 40 }, meters: 10, direction: "push", pxPerUnit: 10 });
  assert.equal(Math.round(diag.x), 90);
  assert.equal(Math.round(diag.y), 120);
  // Sobre a origem não há direção.
  assert.equal(pushDestination({ origin, target: origin, meters: 5, direction: "push", pxPerUnit: 10 }).meters, 0);
  assert.equal(pushDestination({ origin, target, meters: 0, direction: "push", pxPerUnit: 10 }).meters, 0);
});

test("o que sobra ao bater e o dano de impacto", () => {
  assert.equal(leftoverMeters(8, 3), 5);
  assert.equal(leftoverMeters(8, 8), 0);
  assert.equal(leftoverMeters(8, 9), 0);
  assert.equal(leftoverMeters(8, 7.98), 0);
  // 5 m de sobra × 5% de 200 de Vida = 50.
  assert.equal(impactDamage({ leftover: 5, maxHp: 200, percent: 5 }), 50);
  assert.equal(impactDamage({ leftover: 0, maxHp: 200, percent: 5 }), 0);
  assert.equal(impactDamage({ leftover: 5, maxHp: 200, percent: 0 }), 0);
});

test("dano de queda: só o que passa de 3 m", () => {
  assert.equal(fallDamage({ meters: 3, maxHp: 100, percent: 3 }), 0);
  assert.equal(fallDamage({ meters: 2, maxHp: 100, percent: 3 }), 0);
  assert.equal(fallDamage({ meters: 10, maxHp: 100, percent: 3 }), 21);
  assert.equal(fallDamage({ meters: 10, maxHp: 100, percent: 0 }), 0);
});

test("distância 3D soma a altura", () => {
  assert.equal(distance3d(3, 4), 5);
  assert.equal(distance3d(6, 0), 6);
});

test("subir e descer pelo Token HUD", () => {
  // Quem voa sobe e desce; no chão não desce.
  assert.equal(stepElevation({ current: 0, direction: "up", step: 5, canFly: true }), 5);
  assert.equal(stepElevation({ current: 5, direction: "down", step: 5, canFly: true }), 0);
  assert.equal(stepElevation({ current: 0, direction: "down", step: 5, canFly: true }), null);
  assert.equal(stepElevation({ current: 3, direction: "down", step: 5, canFly: true }), 0);
  // Quem não pode nada não sobe.
  assert.equal(stepElevation({ current: 0, direction: "up", step: 5 }), null);
  // Quem cava desce abaixo de 0 e sobe só até 0.
  assert.equal(stepElevation({ current: 0, direction: "down", step: 5, canBurrow: true }), -5);
  assert.equal(stepElevation({ current: -5, direction: "up", step: 5, canBurrow: true }), 0);
  assert.equal(stepElevation({ current: -3, direction: "up", step: 5, canBurrow: true }), 0);
  assert.equal(stepElevation({ current: 0, direction: "up", step: 5, canBurrow: true }), null);
  // Quem só cava não passa do chão para cima; quem só voa não passa do chão para baixo.
  assert.equal(stepElevation({ current: 0, direction: "down", step: 5, canFly: true, canBurrow: false }), null);
  assert.equal(stepElevation({ current: -10, direction: "up", step: 5, canFly: true }), -5);
  assert.equal(stepElevation({ current: 5, direction: "up", step: 0, canFly: true }), null);
});

test("quem está fora do chão sem poder cai ou fica soterrado", () => {
  assert.deepEqual(groundState({ elevation: 6, canFly: false }), { falling: true, buried: false });
  assert.deepEqual(groundState({ elevation: 6, canFly: true }), { falling: false, buried: false });
  assert.deepEqual(groundState({ elevation: -4, canBurrow: false }), { falling: false, buried: true });
  assert.deepEqual(groundState({ elevation: -4, canBurrow: true }), { falling: false, buried: false });
  assert.deepEqual(groundState({ elevation: 0 }), { falling: false, buried: false });
  assert.match(manualElevationWarning({ name: "Zé", elevation: 6 }), /Zé está a 6 m de altura/);
  assert.match(manualElevationWarning({ name: "Zé", elevation: -2.5 }), /2,5 m debaixo da terra/);
  assert.equal(manualElevationWarning({ elevation: 6, canFly: true }), null);
});

test("debaixo da terra: a superfície e o ar não alcançam", () => {
  assert.equal(hiddenUnderground(0, -2), true);
  assert.equal(hiddenUnderground(5, -2), true);
  assert.equal(hiddenUnderground(-1, -2), false);
  assert.equal(hiddenUnderground(0, 0), false);
  // O contrário (quem está embaixo atacando a superfície) não é recusado.
  assert.equal(hiddenUnderground(-3, 0), false);
});

test("corpo a corpo avisa quando o alvo está alto demais", () => {
  assert.equal(meleeOutOfVerticalReach({ range: 0, sourceElevation: 0, targetElevation: 1 }), false);
  assert.equal(meleeOutOfVerticalReach({ range: 0, sourceElevation: 0, targetElevation: 1.5 }), false);
  assert.equal(meleeOutOfVerticalReach({ range: 0, sourceElevation: 0, targetElevation: 6 }), true);
  assert.equal(meleeOutOfVerticalReach({ range: 0, sourceElevation: 6, targetElevation: 0 }), true);
  assert.equal(meleeOutOfVerticalReach({ range: 10, sourceElevation: 0, targetElevation: 6 }), false);
});

test("área em 3D: raio de 5 m não pega quem está 6 m acima", () => {
  assert.equal(areaReaches3d({ shape: "circle", radiusUnits: 5, planarUnits: 0, areaElevation: 0, targetElevation: 6 }), false);
  assert.equal(areaReaches3d({ shape: "circle", radiusUnits: 5, planarUnits: 0, areaElevation: 0, targetElevation: 5 }), true);
  // Esfera: 3 m no plano e 4 m de altura = 5 m de distância, ainda dentro.
  assert.equal(areaReaches3d({ shape: "circle", radiusUnits: 5, planarUnits: 3, areaElevation: 0, targetElevation: 4 }), true);
  assert.equal(areaReaches3d({ shape: "circle", radiusUnits: 5, planarUnits: 4, areaElevation: 0, targetElevation: 4 }), false);
  // A elevação do centro conta, não a do chão.
  assert.equal(areaReaches3d({ shape: "circle", radiusUnits: 5, planarUnits: 0, areaElevation: 6, targetElevation: 6 }), true);
  // Cone e linha: a distância 3D até o vértice cabe no comprimento.
  assert.equal(areaReaches3d({ shape: "cone", radiusUnits: 6, planarUnits: 5, areaElevation: 0, targetElevation: 4 }), false);
  assert.equal(areaReaches3d({ shape: "ray", radiusUnits: 10, planarUnits: 6, areaElevation: 0, targetElevation: 4 }), true);
  // Debaixo da terra, com a área na superfície ou no ar: não chega nem no centro.
  assert.equal(areaReaches3d({ shape: "circle", radiusUnits: 20, planarUnits: 0, areaElevation: 0, targetElevation: -2 }), false);
  assert.equal(areaReaches3d({ shape: "circle", radiusUnits: 20, planarUnits: 0, areaElevation: -2, targetElevation: -2 }), true);
});

test("areaContains3d: forma no plano E altura", () => {
  const scale = { pxPerUnit: 10, cellPx: 100 };
  const area = areaFromSkill({ areaShape: "circle", areaDistance: 5 }, { x: 0, y: 0 }, { ...scale, elevation: 0 });
  assert.equal(area.elevation, 0);
  assert.equal(areaContains3d(area, { x: 0, y: 0 }, 6, 10), false);
  assert.equal(areaContains3d(area, { x: 0, y: 0 }, 4, 10), true);
  assert.equal(areaContains3d(area, { x: 60, y: 0 }, 0, 10), false);
  assert.equal(areaContains3d(area, { x: 0, y: 0 }, -1, 10), false);
});

test("normalizeArea guarda e limita a elevação", () => {
  const base = { shape: "circle", x: 0, y: 0, radius: 50 };
  assert.equal(normalizeArea(base).elevation, 0);
  assert.equal(normalizeArea({ ...base, elevation: 7.5 }).elevation, 7.5);
  assert.equal(normalizeArea({ ...base, elevation: 1e12 }).elevation, 10000);
  assert.equal(normalizeArea({ ...base, elevation: "abc" }).elevation, 0);
});

const push = (extra = {}) => ({
  effectType: "temporary",
  targetType: "targeted",
  cost: 10,
  level: 1,
  effects: [{ target: "push", amount: 5, pushDirection: "push", durationRounds: 0, immuneTraits: [], ...extra }]
});

test("a frase da Skill diz empurra, puxa e voo", () => {
  assert.match(skillSummary(push()), /empurra 5 m/);
  assert.match(skillSummary(push({ pushDirection: "pull" })), /puxa 5 m/);
  assert.match(skillSummary(push({ pushDirection: "choose" })), /empurra ou puxa 5 m/);
  assert.match(skillSummary({ ...push(), effects: [{ target: "flight", amount: 0, durationRounds: 3 }] }), /voo/);
  assert.match(skillSummary({ ...push(), effects: [{ target: "burrow", amount: 0, durationRounds: 3 }] }), /escava/);
});

test("o aviso do editor pega empurrão sem metros", () => {
  const warnings = lintSkill(push({ amount: 0 }), {});
  assert.ok(warnings.some(w => w.code === "pushZero" && w.level === "hard"));
  assert.ok(!lintSkill(push(), {}).some(w => w.code === "pushZero"));
});

test("o custo sugerido conta o empurrão e o voo", () => {
  const small = suggestSkillCost(push({ amount: 2 }), {});
  const big = suggestSkillCost(push({ amount: 20 }), {});
  assert.ok(big.points > small.points);
  assert.ok(small.points > 0);
  const fly = suggestSkillCost({ ...push(), effects: [{ target: "flight", amount: 0, durationRounds: 5 }] }, {});
  assert.ok(fly.points > 0);
});

test("a IA: empurrão guarda direção e Traços; direção inválida vira push", () => {
  const clean = sanitizeSkillMechanics(
    { effectType: "temporary", targetType: "targeted", effects: [{ target: "push", amount: 6, pushDirection: "pull", immuneTraits: ["mechanical", "naoexiste"] }] },
    { traits: ["mechanical"], elements: [], conditions: [] }
  );
  const entry = clean.effects?.[0];
  assert.equal(entry?.target, "push");
  assert.equal(entry?.pushDirection, "pull");
  assert.deepEqual(entry?.immuneTraits, ["mechanical"]);
  const bad = sanitizeSkillMechanics(
    { effectType: "temporary", targetType: "targeted", effects: [{ target: "push", amount: 6, pushDirection: "zzz" }] },
    { traits: [], elements: [], conditions: [] }
  );
  assert.equal(bad.effects?.[0]?.pushDirection, "push");
});

test("o caminho pára rente à primeira parede e devolve qual foi", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 0 };
  const walls = [
    { id: "perto", segment: [60, -50, 60, 50] },
    { id: "longe", segment: [90, -50, 90, 50] }
  ];
  const stop = pathStop(from, to, walls, 10);
  assert.equal(stop.hit.id, "perto");
  assert.equal(stop.point.x, 50);
  assert.equal(stop.traveledPx, 50);
  // Sem parede no caminho: chega.
  const free = pathStop(from, to, [{ id: "fora", segment: [60, 10, 60, 50] }], 10);
  assert.equal(free.hit, null);
  assert.equal(free.point.x, 100);
  // Parede mais perto que o corpo: não anda nada.
  assert.equal(pathStop(from, to, [{ segment: [5, -50, 5, 50] }], 10).traveledPx, 0);
  // Parede paralela ao caminho não corta.
  assert.equal(pathStop(from, to, [{ segment: [0, 5, 100, 5] }], 0).hit, null);
});

test("Desfazer uso: posições dos Tokens que saíram do lugar", () => {
  const before = [
    { uuid: "A", x: 100, y: 100, elevation: 0 },
    { uuid: "B", x: 300, y: 100, elevation: 0 },
    { uuid: "C", x: 500, y: 100, elevation: 4 }
  ];
  const after = [
    { uuid: "A", x: 100, y: 100, elevation: 0 },
    { uuid: "B", x: 400, y: 100, elevation: 0 },
    { uuid: "C", x: 500, y: 100, elevation: 0 }
  ];
  const diff = diffPositions(before, after);
  assert.deepEqual(diff.map(p => p.uuid), ["B", "C"]);
  assert.deepEqual(diff[0].from, { x: 300, y: 100, elevation: 0 });
  assert.deepEqual(diff[1].to, { x: 500, y: 100, elevation: 0 });
  assert.deepEqual(diffPositions(before, []), []);
  assert.equal(actorEntryHasChanges({ positions: diff }), true);
  assert.equal(actorEntryHasChanges({ positions: [] }), false);
  const rows = undoPreviewRows({ actors: [{ name: "Goblin", positions: diff }] });
  assert.ok(rows.some(r => /Goblin volta ao lugar de antes/.test(r.text)));
});

test("Validar Mundo: Traço imune de empurrão que não existe", () => {
  const catalogs = buildCatalogIndex({ traits: [{ id: "mechanical" }] });
  const issues = checkMechanic({ effects: [{ target: "push", amount: 4, immuneTraits: ["mechanical", "ghost"] }] }, catalogs);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].catalog, "traits");
});

test("empurrão: a folga até a parede desconta o corpo, também na diagonal (achado de 21/11)", () => {
  // Centro a 1,5 m (100 px, 1 m = 66,7 px) de uma parede perpendicular, meia largura 50 px: anda 50 px = 0,75 m e sobram 5,25 m de 6.
  const scale = 100 / 1.5;
  const stop = pathStop({ x: 0, y: 0 }, { x: 6 * scale, y: 0 }, [{ segment: [100, -200, 100, 200] }], 50);
  assert.equal(stop.traveledPx, 50);
  assert.equal(leftoverMeters(6, stop.traveledPx / scale), 5.25);
  // Já encostado (centro a meia largura da parede): não anda e sobram os 6 m inteiros.
  const touching = pathStop({ x: 0, y: 0 }, { x: 6 * scale, y: 0 }, [{ segment: [50, -200, 50, 200] }], 50);
  assert.equal(touching.traveledPx, 0);
  // Diagonal a 45º numa parede vertical: o corpo encosta antes (retrocede mais que a meia largura).
  const diag = pathStop({ x: 0, y: 0 }, { x: 300, y: 300 }, [{ segment: [200, -500, 200, 500] }], 50);
  assert.ok(diag.point.x < 150 + 1e-6);
});

test("aviso de Deslocamento gasto: texto e intervalo", async () => {
  const { movementSpentText, shouldNotifyAgain } = await import("../module/combat/forced-movement-rules.js");
  assert.equal(movementSpentText(6, 7), "Deslocamento desta rodada gasto: 6 de 7 m");
  assert.equal(movementSpentText(6.04, 7.5), "Deslocamento desta rodada gasto: 6 de 7,5 m");
  assert.equal(shouldNotifyAgain(1000, undefined), true);
  assert.equal(shouldNotifyAgain(2000, 1000), false);
  assert.equal(shouldNotifyAgain(6000, 1000), true);
});
