/**
 * Manipulação do espaço (8f, lotes 1 a 5): as contas puras de Saltar, Trocar, Âncora, Interdição, Portal, Bolso e Domínio, e a mecânica do efeito
 * "Espaço" nas listas de leitura (frase, custo, avisos, IA, Validar Mundo, Glossário).
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  SPACE_MODES, normalizeSpaceMode, liveSpaceModes, spaceModeIsLive, spaceModeLabel, spaceEntriesOf, skillIsSpatial,
  centerOf, cornerFor, swapDestinations, pathCrossesWalls, jumpInRange, swapInRange, anchorHolds, anchorVerdict,
  anchorReason, anchorBlockText, interdictors, interdictionText, spaceSentence,
  skillTeleports, spaceLife, advanceSpaceLife, spaceLifeExpired, spaceLifeToWorld, spaceLifeText, portalRadiusMeters, portalBlockText,
  portalCrossText, portalInRange, pocketSlots, pocketEntryOf, pocketContainerOf, pocketBlockText, POCKET_DEFAULTS,
  domainRadiusMeters, bestSpatialLevel, domainEscapes, domainBlocksMove, domainTimeRate, domainBlockText
} from "../module/combat/space-rules.js";
import { resolveEffectChange } from "../module/skills/effect-targets.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";
import { suggestSkillCost } from "../module/skills/skill-cost-rules.js";
import { sanitizeSkillMechanics } from "../module/ai/ai-mechanics.js";
import { buildGlossary } from "../module/glossary/glossary-rules.js";
import { checkMechanic, buildCatalogIndex, validateCatalogs } from "../module/world/world-validator.js";
import { NIHILITY } from "../module/core/config.js";

const jump = { target: "space", spaceMode: "jump" };
const base = { effectType: "temporary", targetType: "self", cost: 10, level: 3, range: 12, effects: [jump] };

test("os modos: os cinco existem desde o lote 5", () => {
  assert.deepEqual(liveSpaceModes().map(m => m.id), ["jump", "swap", "portal", "pocket", "domain"]);
  assert.equal(SPACE_MODES.length, 5);
  assert.equal(normalizeSpaceMode("swap"), "swap");
  assert.equal(normalizeSpaceMode("portal"), "portal");
  assert.equal(normalizeSpaceMode("lixo"), "jump");
  assert.equal(normalizeSpaceMode(undefined), "jump");
  assert.equal(spaceModeIsLive("portal"), true);
  assert.equal(spaceModeIsLive("lixo"), false);
  assert.equal(spaceModeIsLive("jump"), true);
  assert.equal(spaceModeLabel("swap"), "Trocar");
});

test("a marca espacial é derivada do efeito de Espaço", () => {
  assert.equal(skillIsSpatial(base), true);
  assert.equal(skillIsSpatial({ effects: [{ target: "strength" }] }), false);
  assert.equal(skillIsSpatial({}), false);
  assert.deepEqual(spaceEntriesOf({ effects: [{ target: "hp" }, jump] }).map(e => e.index), [1]);
});

test("Trocar: cada um vai ao centro do outro, com o próprio tamanho", () => {
  const a = { x: 100, y: 100, w: 100, h: 100 };
  const b = { x: 400, y: 200, w: 200, h: 200 };
  assert.deepEqual(centerOf(a), { x: 150, y: 150 });
  assert.deepEqual(cornerFor({ x: 500, y: 300 }, { w: 200, h: 200 }), { x: 400, y: 200 });
  const swapped = swapDestinations(a, b);
  // o pequeno cai no centro do grande (500, 300) e o grande no centro do pequeno (150, 150)
  assert.deepEqual(swapped.a, { x: 450, y: 250 });
  assert.deepEqual(swapped.b, { x: 50, y: 50 });
});

test("paredes: só importam se a Skill as respeita", () => {
  const wall = { segment: [50, -100, 50, 100] };
  assert.equal(pathCrossesWalls({ x: 0, y: 0 }, { x: 100, y: 0 }, [wall]), true);
  assert.equal(pathCrossesWalls({ x: 0, y: 0 }, { x: 40, y: 0 }, [wall]), false);
  assert.equal(pathCrossesWalls({ x: 0, y: 0 }, { x: 100, y: 0 }, []), false);
});

test("alcance: 0 = sem limite; Trocar não conta quem usa", () => {
  assert.equal(jumpInRange(15, 12), false);
  assert.equal(jumpInRange(12, 12), true);
  assert.equal(jumpInRange(999, 0), true);
  assert.deepEqual(swapInRange([5, 9], 10), { ok: true, farthest: 9 });
  assert.equal(swapInRange([5, 11], 10).ok, false);
  assert.equal(swapInRange([null, 4], 10).ok, true, "sem medida não confere");
  assert.equal(swapInRange([], 10).ok, true);
});

test("a Âncora segura o teleporte de nível igual ou menor; a Skill mais forte fura", () => {
  assert.equal(anchorHolds(8, 5), true);
  assert.equal(anchorHolds(5, 5), true);
  assert.equal(anchorHolds(4, 5), false);
  assert.equal(anchorHolds(0, 1), false);
  assert.equal(anchorHolds(1, undefined), true, "Skill sem nível conta como nível 1");
});

test("o veredito: a ponta de maior nível manda; quem usa também conta", () => {
  const free = anchorVerdict({ skillLevel: 5, endpoints: [{ name: "Kael", role: "origin", sources: [] }, { name: "Kael", role: "destination", sources: [] }] });
  assert.equal(free.blocked, false);
  const verdict = anchorVerdict({
    skillLevel: 5,
    endpoints: [
      { name: "Gruk", role: "origin", sources: [{ kind: "condition", level: 6 }] },
      { name: "Gruk", role: "destination", sources: [{ kind: "structure", level: 8, label: "Campo de Âncora" }] }
    ]
  });
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.source.level, 8);
  assert.equal(anchorVerdict({ skillLevel: 9, endpoints: [{ name: "X", role: "origin", sources: [{ kind: "region", level: 8 }] }] }).blocked, false);
});

test("os textos da Âncora: nada é gasto, sem gênero fixo para a energia", () => {
  const origin = { endpoint: { name: "Gruk", role: "origin" }, source: { kind: "structure", level: 8 } };
  assert.equal(anchorReason(origin), "Gruk está dentro de uma Âncora (nível 8)");
  assert.equal(anchorReason({ endpoint: { name: "Gruk", role: "origin" }, source: { kind: "condition", level: 3 } }), "Gruk está Ancorado (nível 3)");
  assert.match(anchorReason({ endpoint: { name: "Gruk", role: "destination" }, source: { kind: "region", level: 2, label: "a Âncora \"Cripta\"" } }), /ponto de chegada de Gruk/);
  const text = anchorBlockText("Saltar", origin);
  assert.match(text, /^Saltar não sai: Gruk está dentro de uma Âncora \(nível 8\)\. Nada foi gasto\.$/);
  assert.ok(!/Mana|EPS/.test(text));
});

test("Interdição: quem tem a Nave dentro do alcance, do mais perto ao mais longe", () => {
  const sources = [
    { name: "Interditor A", range: 20, point: { x: 1000, y: 0 } },
    { name: "Interditor B", range: 5, point: { x: 100, y: 0 } },
    { name: "Fora", range: 3, point: { x: 5000, y: 0 } },
    { name: "Sem alcance", range: 0, point: { x: 0, y: 0 } }
  ];
  const list = interdictors({ point: { x: 0, y: 0 }, sources, pxPerUnit: 100 });
  assert.deepEqual(list.map(l => l.name), ["Interditor B", "Interditor A"]);
  assert.equal(list[0].distance, 1);
  assert.match(interdictionText("Aurora", list), /Aurora está Interditada por Interditor B e mais 1 \(a 1 m, alcance 5 m\): o salto FTL está bloqueado\./);
  assert.equal(interdictionText("Aurora", []), "");
});

test("a frase e o custo sugerido do efeito de Espaço", () => {
  assert.equal(resolveEffectChange(jump, { type: "character" }), null, "Espaço não deixa Active Effect nenhum");
  assert.match(skillSummary(base), /teleporta quem usa .* até 12 m.*atravessando paredes/);
  assert.match(spaceSentence({ spaceMode: "swap", spaceWalls: true }, { range: 8 }), /troca de lugar com o alvo até 8 m, respeitando paredes/);
  const jumpCost = suggestSkillCost(base).points;
  const swapCost = suggestSkillCost({ ...base, effects: [{ target: "space", spaceMode: "swap" }] }).points;
  assert.ok(jumpCost > 0);
  assert.ok(swapCost > jumpCost, "Trocar mexe com outra pessoa e pesa um pouco mais");
});

test("avisos do editor: sem alcance, área, Trocar em Si mesmo, Ativa, modo que ainda não existe", () => {
  const codes = mech => lintSkill(mech).map(w => w.code);
  assert.ok(!codes(base).includes("spaceNoRange"));
  assert.ok(codes({ ...base, range: 0 }).includes("spaceNoRange"));
  assert.ok(codes({ ...base, targetType: "emission", areaDistance: 5, areaShape: "circle" }).includes("spaceArea"));
  assert.ok(codes({ ...base, effects: [{ target: "space", spaceMode: "swap" }] }).includes("spaceSwapSelf"));
  assert.ok(!codes({ ...base, targetType: "targeted", effects: [{ target: "space", spaceMode: "swap" }] }).includes("spaceSwapSelf"));
  assert.ok(codes({ ...base, hasUpkeep: true, upkeepCost: 2 }).includes("spaceActive"));
  assert.ok(codes({ ...base, effects: [{ target: "space", spaceMode: "lixo" }] }).includes("spaceModeLater"));
  assert.ok(!codes({ ...base, effects: [{ target: "space", spaceMode: "portal", durationRounds: 3 }] }).includes("spaceModeLater"), "o Portal existe");
  assert.ok(!codes(base).includes("zeroEffect"), "Espaço não pede valor");
  assert.ok(!codes(base).includes("noDuration"), "Espaço é instantâneo");
});

test("a IA: Espaço entra sem duração e só com Saltar ou Trocar", () => {
  const catalogs = { elements: [], conditions: [], traits: [], structures: [], weaponTypes: [], attributes: [] };
  const out = sanitizeSkillMechanics({ effectType: "temporary", targetType: "self", cost: 5, effects: [{ target: "space", spaceMode: "swap", spaceWalls: true, spaceSwapOther: true, durationRounds: 9 }] }, catalogs);
  assert.equal(out.effects.length, 1);
  assert.equal(out.effects[0].spaceMode, "swap");
  assert.equal(out.effects[0].spaceWalls, true);
  assert.equal(out.effects[0].spaceSwapOther, true);
  assert.equal(out.effects[0].durationRounds, 0);
  const portal = sanitizeSkillMechanics({ effectType: "temporary", targetType: "self", cost: 5, effects: [{ target: "space", spaceMode: "portal" }] }, catalogs);
  assert.equal(portal.effects[0].spaceMode, "jump", "os modos reservados caem em Saltar");
});

test("Validar Mundo: Skill espacial sem alcance, Âncora sem duração e Campo de Âncora sem duração", () => {
  const idx = buildCatalogIndex({ conditions: [{ id: "anchored", anchorLevel: 1 }, { id: "slow" }] });
  const noRange = checkMechanic({ range: 0, targetType: "self", effects: [jump] }, idx);
  assert.ok(noRange.some(i => /sem alcance/.test(i.message)));
  assert.equal(checkMechanic({ range: 10, targetType: "self", effects: [jump] }, idx).length, 0);
  assert.ok(checkMechanic({ range: 10, targetType: "emission", effects: [jump] }, idx).some(i => /área ou Zona/.test(i.message)));
  const anchor = checkMechanic({ effects: [{ target: "strength", conditionId: "anchored", durationRounds: 0 }] }, idx);
  assert.ok(anchor.some(i => /Âncora sem duração/.test(i.message)));
  assert.equal(checkMechanic({ effects: [{ target: "strength", conditionId: "anchored", durationRounds: 3 }] }, idx).length, 0);
  assert.equal(checkMechanic({ hasUpkeep: true, effects: [{ target: "strength", conditionId: "anchored", durationRounds: 0 }] }, idx).length, 0, "numa Ativa dura enquanto ligada");
  const catalogs = { structures: [{ id: "a", label: "Campo", anchorLevel: 2, durationRounds: 0 }, { id: "b", label: "Outro", anchorLevel: 2, durationRounds: 3 }] };
  const found = validateCatalogs(catalogs);
  assert.ok(JSON.stringify(found).includes("Campo de Âncora sem duração"));
  assert.ok(!JSON.stringify(found).includes("Outro"));
});

test("o bloco, o grupo do seletor, a Condição e a Estrutura de fábrica", () => {
  assert.ok(NIHILITY.FEATURES.spaceManipulation);
  assert.notEqual(NIHILITY.FEATURES.spaceManipulation, NIHILITY.FEATURES.timeManipulation, "tempo e espaço são blocos separados");
  assert.ok(NIHILITY.EFFECT_TARGETS.includes("space"));
  const group = NIHILITY.EFFECT_TARGET_GROUPS.find(g => g.targets.includes("space"));
  assert.equal(group.label, "Espaço");
  assert.ok(!NIHILITY.EFFECT_TARGET_GROUPS.find(g => g.label === "Tempo").targets.includes("space"));
  const anchored = NIHILITY.DEFAULT_STATUS_CONDITIONS.find(c => c.id === "anchored");
  assert.ok(anchored.anchorLevel > 0);
  const field = NIHILITY.DEFAULT_STRUCTURES.find(s => s.id === "anchor-field");
  assert.ok(field.anchorLevel > 0);
  assert.equal(field.blocksAttacks, false, "o campo não segura golpes");
});

test("Glossário: Espaço, Âncora e Interdição só com o bloco ligado", () => {
  const on = buildGlossary({ features: { spaceManipulation: true } }, { isGM: false }).map(e => e.key);
  for (const key of ["space", "anchor", "interdiction"]) assert.ok(on.includes(key), key);
  const off = buildGlossary({ features: { spaceManipulation: false } }, { isGM: false }).map(e => e.key);
  for (const key of ["space", "anchor", "interdiction"]) assert.ok(!off.includes(key), key);
});

/* ------------------------------------------------------------------ Lote 3: Portal */

test("a vida de um Portal: rodadas em combate, relógio do mundo fora, Ativa enquanto ligada", () => {
  assert.deepEqual(spaceLife({ rounds: 3, inCombat: true }), { roundsLeft: 3, expiresAt: null, untilDeactivated: false });
  assert.deepEqual(spaceLife({ rounds: 3, inCombat: false, worldTime: 1000, roundSeconds: 6 }), { roundsLeft: null, expiresAt: 1018, untilDeactivated: false });
  assert.deepEqual(spaceLife({ rounds: 0, hasUpkeep: true }), { roundsLeft: null, expiresAt: null, untilDeactivated: true });
  assert.deepEqual(spaceLife({ rounds: 0, hasUpkeep: false }), { roundsLeft: null, expiresAt: null, untilDeactivated: false }, "sem prazo: o Mestre fecha");
  assert.equal(spaceLife({ rounds: 2, inCombat: false, worldTime: 0, roundSeconds: 0 }).expiresAt, 12, "rodada sem tempo cai em 6 s");
});

test("a vida anda pelo turno de quem abriu (ou pela virada da rodada) e fecha ao zerar", () => {
  const life = { roundsLeft: 2, expiresAt: null, untilDeactivated: false };
  assert.equal(advanceSpaceLife(life, { casterFighting: true, casterTurn: false }).life, life, "turno de outro: nada anda");
  const one = advanceSpaceLife(life, { casterFighting: true, casterTurn: true });
  assert.equal(one.life.roundsLeft, 1);
  assert.equal(one.expired, false);
  assert.equal(advanceSpaceLife(one.life, { casterFighting: true, casterTurn: true }).expired, true);
  assert.equal(advanceSpaceLife(life, { casterFighting: false, roundChanged: false }).life, life, "quem não luta: só a virada da rodada");
  assert.equal(advanceSpaceLife(life, { casterFighting: false, roundChanged: true }).life.roundsLeft, 1);
  const forever = { roundsLeft: null, expiresAt: null, untilDeactivated: true };
  assert.equal(advanceSpaceLife(forever, { casterFighting: true, casterTurn: true }).life, forever, "Ativa não conta");
  assert.equal(advanceSpaceLife(null, {}).expired, false);
});

test("fora de combate o prazo é do relógio; o fim do combate passa as rodadas para ele", () => {
  assert.equal(spaceLifeExpired({ expiresAt: 100 }, 99), false);
  assert.equal(spaceLifeExpired({ expiresAt: 100 }, 100), true);
  assert.equal(spaceLifeExpired({ expiresAt: null }, 1e9), false);
  assert.equal(spaceLifeExpired({ roundsLeft: 2, expiresAt: null }, 1e9), false);
  assert.deepEqual(spaceLifeToWorld({ roundsLeft: 2, expiresAt: null, untilDeactivated: false }, 50, 6), { roundsLeft: null, expiresAt: 62, untilDeactivated: false });
  const same = { roundsLeft: null, expiresAt: 10, untilDeactivated: false };
  assert.equal(spaceLifeToWorld(same, 50), same);
  assert.equal(spaceLifeText({ roundsLeft: 1 }), "1 rodada");
  assert.equal(spaceLifeText({ roundsLeft: 3 }), "3 rodadas");
  assert.equal(spaceLifeText({ untilDeactivated: true }), "até a Skill ser desligada");
  assert.match(spaceLifeText({ expiresAt: 5 }), /relógio/);
  assert.match(spaceLifeText({}), /Mestre fecha/);
});

test("Portal: raio padrão, alcance das duas pontas e a Âncora que impede abrir", () => {
  assert.equal(portalRadiusMeters({}), 1);
  assert.equal(portalRadiusMeters({ spaceRadius: 2.5 }), 2.5);
  assert.equal(portalInRange([10, 20], 30).ok, true);
  const far = portalInRange([10, 45], 30);
  assert.equal(far.ok, false);
  assert.equal(far.farthest, 45);
  assert.equal(portalInRange([10, 45], 0).ok, true, "alcance 0 = sem limite");
  const verdict = anchorVerdict({ skillLevel: 4, endpoints: [{ name: "a ponta A", role: "origin", sources: [{ kind: "region", level: 8, label: "a Âncora \"Cripta\"" }] }] });
  assert.equal(verdict.blocked, true);
  assert.match(portalBlockText("Portal", verdict), /Portal não abre: a ponta A está dentro de a Âncora "Cripta" \(nível 8\)\. Nada foi gasto\./);
  const anchored = anchorVerdict({ skillLevel: 4, endpoints: [{ name: "Gruk", role: "origin", sources: [{ kind: "condition", level: 4 }] }] });
  assert.match(portalCrossText("Gruk", anchored), /Gruk não atravessa o portal: Gruk está Ancorado \(nível 4\)/);
  const stronger = anchorVerdict({ skillLevel: 5, endpoints: [{ name: "Gruk", role: "origin", sources: [{ kind: "condition", level: 4 }] }] });
  assert.equal(stronger.blocked, false, "Portal de nível maior que a Âncora passa");
});

test("a frase do Portal diz alcance, duração e se liga outra cena", () => {
  const portal = { target: "space", spaceMode: "portal", durationRounds: 3, spaceOtherScene: true };
  const text = spaceSentence(portal, { range: 30 });
  assert.match(text, /abre um portal entre dois pontos até 30 m por 3 rodadas/);
  assert.match(text, /outra cena/);
  assert.match(spaceSentence({ ...portal, durationRounds: 0, spaceOtherScene: false }, {}), /enquanto a Skill estiver ligada/);
});

/* ------------------------------------------------------------------ Lote 4: Bolso */

test("os espaços do Bolso crescem pelo nível (o mockup: nível 4 = 20)", () => {
  assert.equal(pocketSlots({ base: 5, perLevel: 5, level: 4 }), 20);
  assert.equal(pocketSlots({ level: 1 }), 5, "os padrões da fábrica");
  assert.equal(pocketSlots({ base: 5, perLevel: 5, level: 0 }), 5, "nível 0 conta como 1");
  assert.equal(pocketSlots({ base: 2, perLevel: 0, level: 9 }), 2);
  assert.equal(pocketSlots({ base: 0, perLevel: 0, level: 9 }), 0);
  assert.equal(pocketSlots({ base: 5.9, perLevel: 1.5, level: 3 }), 8, "sempre inteiro");
  assert.deepEqual(POCKET_DEFAULTS, { base: 5, perLevel: 5 });
});

test("o Bolso é o contêiner concedido com 100% de redução e espaços pelo nível", () => {
  const mech = { level: 4, effects: [{ target: "hp" }, { target: "space", spaceMode: "pocket", pocketBase: 5, pocketPerLevel: 5 }] };
  assert.equal(pocketEntryOf(mech).spaceMode, "pocket");
  const container = pocketContainerOf(mech, { id: "sk1", label: "Bolso dimensional" });
  assert.deepEqual(container, { id: "sk1", label: "Bolso dimensional", isSkill: true, unlimited: false, slots: 20, weightReduction: 100, isPocket: true });
  assert.equal(pocketContainerOf({ level: 4, effects: [jump] }, { id: "x", label: "y" }), null, "Saltar não dá Bolso");
  assert.equal(pocketContainerOf({ level: 4 }, { id: "x", label: "y" }), null);
  // o campo vazio cai nos padrões
  assert.equal(pocketContainerOf({ level: 2, effects: [{ target: "space", spaceMode: "pocket" }] }, { id: "a", label: "b" }).slots, 10);
  const verdict = anchorVerdict({ skillLevel: 4, endpoints: [{ name: "Kael", role: "origin", sources: [{ kind: "condition", level: 6 }] }] });
  assert.match(pocketBlockText("Kael", verdict), /Kael não abre o Bolso: Kael está Ancorado \(nível 6\)\. Nada se perdeu/);
  assert.match(spaceSentence({ target: "space", spaceMode: "pocket", pocketBase: 5, pocketPerLevel: 5 }), /Bolso dimensional: 5 espaços no nível 1 e mais 5 por nível; o que está dentro não pesa/);
});

/* ------------------------------------------------------------------ Lote 5: Domínio */

test("quem tem Skill de teleporte de nível maior escapa do Domínio (a regra da Âncora ao contrário)", () => {
  assert.equal(domainEscapes(5, 6), true);
  assert.equal(domainEscapes(5, 5), false, "nível igual: o Domínio segura");
  assert.equal(domainEscapes(5, 3), false);
  assert.equal(domainEscapes(5, 0), false, "sem Skill de teleporte: nunca escapa");
  assert.equal(bestSpatialLevel([2, 7, 4]), 7);
  assert.equal(bestSpatialLevel([]), 0);
  assert.equal(skillTeleports({ effects: [jump] }), true);
  assert.equal(skillTeleports({ effects: [{ target: "space", spaceMode: "portal" }] }), true);
  assert.equal(skillTeleports({ effects: [{ target: "space", spaceMode: "pocket" }] }), false, "o Bolso não teleporta");
  assert.equal(skillTeleports({ effects: [{ target: "space", spaceMode: "domain" }] }), false, "nem o Domínio");
  assert.equal(skillTeleports({ effects: [{ target: "hp" }] }), false);
});

test("o Domínio recusa só quem sai da área", () => {
  assert.equal(domainBlocksMove({ startInside: true, endInside: false }), true);
  assert.equal(domainBlocksMove({ startInside: true, endInside: true }), false, "andar dentro passa");
  assert.equal(domainBlocksMove({ startInside: false, endInside: true }), false, "entrar passa");
  assert.equal(domainBlocksMove({ startInside: false, endInside: false }), false);
  assert.equal(domainBlocksMove({ startInside: true, endInside: false, escapes: true }), false, "quem escapa sai");
  assert.equal(domainBlocksMove({}), false);
  assert.equal(domainBlockText("Gruk", "Prisão Infinita"), "Gruk não sai: está Preso no Domínio \"Prisão Infinita\".");
  assert.equal(domainBlockText("Gruk", ""), "Gruk não sai: está Preso no Domínio.");
});

test("o ritmo próprio do Domínio só vale com o bloco do tempo ligado e fator diferente de 1", () => {
  assert.equal(domainRadiusMeters({}), 10);
  assert.equal(domainRadiusMeters({ spaceRadius: 4 }), 4);
  assert.equal(domainTimeRate({ spaceTimeRate: 0.5 }, { timeEnabled: true }), 0.5);
  assert.equal(domainTimeRate({ spaceTimeRate: 0.5 }, { timeEnabled: false }), 1, "bloco desligado: nada");
  assert.equal(domainTimeRate({ spaceTimeRate: 1 }, { timeEnabled: true }), 1);
  assert.equal(domainTimeRate({}, { timeEnabled: true }), 1);
  assert.equal(domainTimeRate({ spaceTimeRate: 1e9 }, { timeEnabled: true }), 1e6, "limitado ao do relógio");
  assert.equal(domainTimeRate({ spaceTimeRate: 1e-20 }, { timeEnabled: true }), 1e-10);
  assert.equal(domainTimeRate({ spaceTimeRate: -2 }, { timeEnabled: true }), 1);
  const text = spaceSentence({ target: "space", spaceMode: "domain", durationRounds: 5, spaceRadius: 10, spaceTimeRate: 0.5 });
  assert.match(text, /Domínio de raio 10 m por 5 rodadas: quem está dentro não sai/);
  assert.match(text, /×0,5/);
});

/* ------------------------------------------------------------------ Avisos, custo e Validar Mundo dos lotes 3 a 5 */

test("avisos do editor: Portal e Domínio sem duração, Bolso sem nível, Domínio sem raio", () => {
  const codes = mech => lintSkill(mech).map(w => w.code);
  const portal = { ...base, range: 20, effects: [{ target: "space", spaceMode: "portal", durationRounds: 0 }] };
  assert.ok(codes(portal).includes("spaceNoDuration"));
  assert.ok(!codes({ ...portal, effects: [{ target: "space", spaceMode: "portal", durationRounds: 3 }] }).includes("spaceNoDuration"));
  assert.ok(!codes({ ...portal, hasUpkeep: true, upkeepCost: 2 }).includes("spaceNoDuration"), "Ativa dura enquanto ligada");
  assert.ok(codes({ ...portal, range: 0 }).includes("spaceNoRange"));
  assert.ok(codes({ ...base, effects: [{ target: "space", spaceMode: "domain", durationRounds: 3, spaceRadius: 0 }] }).includes("spaceNoRadius"));
  assert.ok(!codes({ ...base, effects: [{ target: "space", spaceMode: "domain", durationRounds: 3, spaceRadius: 5 }] }).includes("spaceNoRadius"));
  assert.ok(codes({ ...base, level: 0, effects: [{ target: "space", spaceMode: "pocket" }] }).includes("spacePocketNoLevel"));
  assert.ok(codes({ ...base, effects: [{ target: "space", spaceMode: "pocket", pocketBase: 0, pocketPerLevel: 0 }] }).includes("spacePocketEmpty"));
  assert.ok(!codes({ ...base, effects: [{ target: "space", spaceMode: "pocket" }] }).includes("spacePocketEmpty"));
  assert.ok(!codes({ ...base, range: 0, effects: [{ target: "space", spaceMode: "pocket" }] }).includes("spaceNoRange"), "o Bolso não tem alcance");
});

test("custo sugerido: Portal e Domínio pesam mais que Saltar; Bolso, pouco", () => {
  const cost = mech => suggestSkillCost(mech).points;
  const jumpCost = cost({ ...base });
  const portalCost = cost({ ...base, effects: [{ target: "space", spaceMode: "portal", durationRounds: 3 }] });
  const domainCost = cost({ ...base, effects: [{ target: "space", spaceMode: "domain", durationRounds: 3 }] });
  const pocketCost = cost({ ...base, effects: [{ target: "space", spaceMode: "pocket" }] });
  assert.ok(portalCost > jumpCost);
  assert.ok(domainCost > portalCost);
  assert.ok(pocketCost > 0);
  assert.ok(cost({ ...base, effects: [{ target: "space", spaceMode: "portal", durationRounds: 8 }] }) > portalCost, "mais rodadas, mais caro");
});

test("Validar Mundo: Portal e Domínio sem duração, Bolso sem espaços, Domínio sem raio e sem a Condição Preso", () => {
  const idx = buildCatalogIndex({ conditions: [{ id: "slow" }] });
  const issues = mech => checkMechanic({ range: 10, level: 2, targetType: "self", ...mech }, idx).map(i => i.message);
  assert.ok(issues({ effects: [{ target: "space", spaceMode: "portal", durationRounds: 0 }] }).some(m => /Portal sem duração/.test(m)));
  assert.ok(!issues({ effects: [{ target: "space", spaceMode: "portal", durationRounds: 3 }] }).some(m => /sem duração/.test(m)));
  assert.ok(!issues({ hasUpkeep: true, effects: [{ target: "space", spaceMode: "portal", durationRounds: 0 }] }).some(m => /sem duração/.test(m)));
  const domain = issues({ effects: [{ target: "space", spaceMode: "domain", durationRounds: 0, spaceRadius: 0 }] });
  assert.ok(domain.some(m => /Domínio sem duração/.test(m)));
  assert.ok(domain.some(m => /Domínio sem área/.test(m)));
  assert.ok(domain.some(m => /Condição Preso/.test(m)), "o catálogo não tem Preso");
  const withPreso = buildCatalogIndex({ conditions: [{ id: "trapped" }] });
  assert.ok(!checkMechanic({ range: 10, effects: [{ target: "space", spaceMode: "domain", durationRounds: 3, spaceRadius: 5 }] }, withPreso).some(i => /Preso/.test(i.message)));
  assert.ok(issues({ level: 0, effects: [{ target: "space", spaceMode: "pocket" }] }).some(m => /Bolso sem nível/.test(m)));
  assert.ok(issues({ effects: [{ target: "space", spaceMode: "pocket", pocketBase: 0, pocketPerLevel: 0 }] }).some(m => /Bolso sem espaços/.test(m)));
  assert.equal(issues({ effects: [{ target: "space", spaceMode: "pocket" }] }).length, 0, "Bolso sem alcance não avisa");
  assert.ok(!issues({ effects: [{ target: "space", spaceMode: "portal", durationRounds: 3 }] }).some(m => /não existe/.test(m)));
});

test("a Condição Preso de fábrica segura o teleporte e o Glossário tem Portal, Bolso e Domínio", () => {
  const preso = NIHILITY.DEFAULT_STATUS_CONDITIONS.find(c => c.id === "trapped");
  assert.ok(preso);
  assert.equal(preso.label, "Preso");
  assert.ok(preso.anchorLevel > 0, "Preso segura o teleporte pelo mesmo nível da Âncora");
  assert.equal(anchorHolds(preso.anchorLevel, 1), true);
  const glossary = JSON.stringify(buildGlossary({ features: { spaceManipulation: true, timeManipulation: true } }, {}));
  for (const id of ["portal", "pocket", "domain"]) assert.ok(glossary.includes(id), id);
});
