import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  SENSE_MODES,
  SENSE_UNLIMITED,
  isSenseTarget,
  senseRangeValue,
  describeSenseRange,
  senseChangeKeys,
  describeSenseChange,
  normalizeSenses,
  originSenses,
  originSenseRows,
  groundStatuses,
  isHiddenBySense,
  normalizeMapStatus,
  fillMapStatus,
  mapStatusesToAdd,
  combatantVisibleFor,
  visibleSetChanged,
  filterPerceived
} from "../module/combat/senses-rules.js";
import { normalizeSpeciesEntry } from "../module/species/species-rules.js";

test("sentidos: alvo para modo de detecção do Foundry", () => {
  assert.deepEqual(SENSE_MODES, { senseTremor: "feelTremor", senseInvisible: "seeInvisibility", senseTrue: "seeAll", senseAll: "senseAll" });
  assert.ok(isSenseTarget("senseTrue"));
  assert.ok(!isSenseTarget("flight"));
  assert.ok(!isSenseTarget("toString"));
});

test("alcance: 0 ou lixo = sem limite (número finito), nunca Infinity", () => {
  assert.equal(senseRangeValue(10), 10);
  assert.equal(senseRangeValue(0), SENSE_UNLIMITED);
  assert.equal(senseRangeValue(-5), SENSE_UNLIMITED);
  assert.equal(senseRangeValue("abc"), SENSE_UNLIMITED);
  assert.ok(Number.isFinite(senseRangeValue(0)));
  assert.equal(describeSenseRange(10), "10 m");
  assert.equal(describeSenseRange(0), "sem limite");
  assert.equal(describeSenseRange(SENSE_UNLIMITED), "sem limite");
});

test("chaves do Active Effect e como a janela de Efeitos as descreve", () => {
  const keys = senseChangeKeys("senseTremor");
  assert.equal(keys.range, "token.detectionModes.feelTremor.range");
  assert.equal(keys.enabled, "token.detectionModes.feelTremor.enabled");
  assert.equal(senseChangeKeys("strength"), null);
  assert.equal(describeSenseChange(keys.range, "10"), "Sentido sísmico 10 m");
  assert.equal(describeSenseChange(keys.range, SENSE_UNLIMITED), "Sentido sísmico sem limite");
  assert.equal(describeSenseChange(keys.enabled, "true"), "Sentido sísmico (ligado)");
  assert.equal(describeSenseChange("system.attributes.hp.buffDelta", 3), null);
});

test("sentidos de uma origem: só modos válidos, o melhor alcance, 0 = sem limite vence", () => {
  const list = normalizeSenses([
    { mode: "senseTremor", range: 5 },
    { mode: "senseTremor", range: 12 },
    { mode: "senseAll", range: 0 },
    { mode: "inventado", range: 9 },
    null
  ]);
  assert.deepEqual(list, [{ mode: "senseTremor", range: 12 }, { mode: "senseAll", range: 0 }]);
  assert.deepEqual(normalizeSenses(undefined), []);
});

test("originSenses: melhor alcance por modo do Foundry entre as camadas", () => {
  const layers = [
    { kindLabel: "Espécie", label: "Toupeira", passives: { senses: [{ mode: "senseTremor", range: 6 }] } },
    { kindLabel: "Herança", label: "Olho", passives: { senses: [{ mode: "senseTremor", range: 10 }, { mode: "senseTrue", range: 0 }] } },
    { kindLabel: "Linhagem", label: "Sem sentido", passives: {} }
  ];
  assert.deepEqual(originSenses(layers), { feelTremor: 10, seeAll: SENSE_UNLIMITED });
  assert.deepEqual(originSenses([]), {});
  assert.deepEqual(originSenses(undefined), {});
  const rows = originSenseRows(layers);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].label, "Espécie: Toupeira");
  assert.equal(rows[2].range, "sem limite");
});

test("a Espécie normaliza os sentidos e não cria a chave quando não há", () => {
  const plain = normalizeSpeciesEntry({ label: "A", passives: { regen: { hpPercent: 1 } } });
  assert.ok(!("senses" in plain.passives));
  const withSenses = normalizeSpeciesEntry({ label: "B", passives: { senses: [{ mode: "senseAll", range: 3 }, { mode: "x", range: 1 }] } });
  assert.deepEqual(withSenses.passives.senses, [{ mode: "senseAll", range: 3 }]);
  const empty = normalizeSpeciesEntry({ label: "C", passives: { senses: [{ mode: "x" }] } });
  assert.ok(!("senses" in empty.passives));
});

test("debaixo da terra conta como escavando e no ar como voando, só com os dois blocos ligados", () => {
  assert.deepEqual(groundStatuses({ elevation: -3, elevationOn: true, sensesOn: true }), { burrow: true, fly: false });
  assert.deepEqual(groundStatuses({ elevation: 4, elevationOn: true, sensesOn: true }), { burrow: false, fly: true });
  assert.deepEqual(groundStatuses({ elevation: 0, elevationOn: true, sensesOn: true }), { burrow: false, fly: false });
  assert.deepEqual(groundStatuses({ elevation: -3, elevationOn: false, sensesOn: true }), { burrow: false, fly: false });
  assert.deepEqual(groundStatuses({ elevation: -3, elevationOn: true, sensesOn: false }), { burrow: false, fly: false });
  assert.deepEqual(groundStatuses({ elevation: undefined, elevationOn: true, sensesOn: true }), { burrow: false, fly: false });
});

test("escondido por sentido = debaixo da terra ou invisível", () => {
  assert.ok(isHiddenBySense({ burrow: true }));
  assert.ok(isHiddenBySense({ invisible: true }));
  assert.ok(!isHiddenBySense({}));
  assert.ok(!isHiddenBySense());
});

test("No mapa da Condição: normaliza e só preenche a fábrica quando o campo falta", () => {
  assert.equal(normalizeMapStatus("invisible"), "invisible");
  assert.equal(normalizeMapStatus("blind"), "blind");
  assert.equal(normalizeMapStatus("dead"), "");
  const defaults = { blindness: { id: "blindness", mapStatus: "blind" } };
  assert.equal(fillMapStatus({ id: "blindness" }, defaults).mapStatus, "blind");
  assert.equal(fillMapStatus({ id: "blindness", mapStatus: "" }, defaults).mapStatus, "", "limpo de propósito fica limpo");
  const own = { id: "custom" };
  assert.equal(fillMapStatus(own, defaults), own);
});

test("status do core acrescentados pelas Condições do catálogo", () => {
  const catalog = [{ id: "blindness", mapStatus: "blind" }, { id: "invisibility", mapStatus: "invisible" }, { id: "poison" }];
  assert.deepEqual(mapStatusesToAdd(["blindness"], catalog), ["blind"]);
  assert.deepEqual(mapStatusesToAdd(["invisibility", "blindness"], catalog), ["invisible", "blind"]);
  assert.deepEqual(mapStatusesToAdd(["poison"], catalog), []);
  assert.deepEqual(mapStatusesToAdd(["blindness", "blind"], catalog), [], "não repete o que já tem");
  assert.deepEqual(mapStatusesToAdd([], catalog), []);
});

test("lista de iniciativa: só some quem está escondido por sentido e o jogador não percebe", () => {
  const base = { base: true, isGM: false, enabled: true, isOwner: false, onCanvasScene: true, tokenVision: true, hiddenBySense: true, tokenVisible: false };
  assert.equal(combatantVisibleFor(base), false);
  assert.equal(combatantVisibleFor({ ...base, tokenVisible: true }), true, "quem tem o sentido o vê");
  assert.equal(combatantVisibleFor({ ...base, isGM: true }), true);
  assert.equal(combatantVisibleFor({ ...base, enabled: false }), true);
  assert.equal(combatantVisibleFor({ ...base, isOwner: true }), true);
  assert.equal(combatantVisibleFor({ ...base, onCanvasScene: false }), true);
  assert.equal(combatantVisibleFor({ ...base, tokenVision: false }), true);
  assert.equal(combatantVisibleFor({ ...base, hiddenBySense: false }), true, "fora da linha de visão comum continua aparecendo");
  assert.equal(combatantVisibleFor({ ...base, base: false }), false, "o que o core já esconde continua escondido");
  assert.equal(combatantVisibleFor({ ...base, tokenVisible: undefined }), true, "sem Token desenhado, fica o do core");
});

test("o conjunto de visíveis mudou?", () => {
  assert.equal(visibleSetChanged(["a", "b"], ["b", "a"]), false);
  assert.equal(visibleSetChanged(["a"], ["a", "b"]), true);
  assert.equal(visibleSetChanged(["a", "b"], ["a", "c"]), true);
  assert.equal(visibleSetChanged(null, []), false);
});

test("seletor de alvo: o jogador só vê quem percebe; o Mestre, tudo; o próprio fica", () => {
  const list = [{ id: 1, perceived: true }, { id: 2, perceived: false }, { id: 3, perceived: false, self: true }, { id: 4, perceived: false, onScene: false }];
  const ctx = { isGM: false, enabled: true, tokenVision: true };
  assert.deepEqual(filterPerceived(list, ctx).map(c => c.id), [1, 3, 4]);
  assert.equal(filterPerceived(list, { ...ctx, isGM: true }).length, 4);
  assert.equal(filterPerceived(list, { ...ctx, enabled: false }).length, 4);
  assert.equal(filterPerceived(list, { ...ctx, tokenVision: false }).length, 4);
});

/* ------------------------------------------------------------------ Integração com Skills */

import { resolveEffectChange, describeEffectChangeKey } from "../module/skills/effect-targets.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { suggestSkillCost } from "../module/skills/skill-cost-rules.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";
import { MEU_SISTEMA } from "../module/core/config.js";

test("efeito de sentido vira mudança de Token (OVERRIDE do alcance e do ligado)", () => {
  const person = { type: "character" };
  const change = resolveEffectChange({ target: "senseTremor", amount: 10 }, person);
  assert.equal(change.key, "token.detectionModes.feelTremor.range");
  assert.equal(change.value, "10");
  assert.equal(change.senseMode, "senseTremor");
  assert.equal(change.extra[0].key, "token.detectionModes.feelTremor.enabled");
  assert.equal(change.extra[0].value, "true");
  assert.equal(resolveEffectChange({ target: "senseAll", amount: 0 }, person).value, String(SENSE_UNLIMITED));
  assert.equal(resolveEffectChange({ target: "senseTrue", amount: 5 }, { type: "starship" }), null, "Nave recusa");
  assert.equal(describeEffectChangeKey("token.detectionModes.seeAll.range"), "Visão verdadeira");
});

test("os alvos de sentido estão no grupo Sentidos, só de Personagem", () => {
  const group = MEU_SISTEMA.EFFECT_TARGET_GROUPS.find(g => g.label === "Sentidos");
  assert.equal(group.actor, "character");
  assert.deepEqual(group.targets, ["senseTremor", "senseInvisible", "senseTrue", "senseAll"]);
  for (const t of group.targets) {
    assert.ok(MEU_SISTEMA.EFFECT_TARGETS.includes(t));
    assert.ok(MEU_SISTEMA.EFFECT_TARGET_LABELS[t]);
  }
});

test("a frase da Skill, o custo sugerido e o aviso tratam o sentido", () => {
  const mech = { effectType: "temporary", targetType: "self", effects: [{ target: "senseTremor", amount: 10, durationRounds: 3 }] };
  assert.match(skillSummary(mech, {}), /sentido sísmico 10 m/);
  assert.match(skillSummary({ ...mech, effects: [{ target: "senseAll", amount: 0 }] }, {}), /sentir tudo \(sem limite\)/);
  const cost = suggestSkillCost(mech);
  assert.ok(cost.cost > 0);
  assert.ok(cost.rows.some(r => /Sentido sísmico|senseTremor/i.test(r.label)));
  // O alcance não pesa no custo.
  assert.equal(suggestSkillCost({ ...mech, effects: [{ target: "senseTremor", amount: 500, durationRounds: 3 }] }).cost, cost.cost);
  // Valor 0 é "sem limite", não "não faz nada".
  const codes = lintSkill({ ...mech, effects: [{ target: "senseTremor", amount: 0, durationRounds: 3 }] }, {}).map(w => w.code);
  assert.ok(!codes.includes("zeroEffect"));
});

test("a Condição de fábrica Cegueira marca Cego e Invisibilidade marca Invisível", () => {
  const byId = Object.fromEntries(MEU_SISTEMA.DEFAULT_STATUS_CONDITIONS.map(c => [c.id, c]));
  assert.equal(byId.blindness.mapStatus, "blind");
  assert.equal(byId.invisibility.mapStatus, "invisible");
  assert.ok(byId.invisibility.explanation);
  assert.equal(MEU_SISTEMA.FEATURES.senses.default, true);
  assert.ok(MEU_SISTEMA.FEATURES.senses.short.length <= 90);
});
