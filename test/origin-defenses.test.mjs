/**
 * Fraquezas, Condições na origem e a tabela de fábrica das Espécies (1.117.0).
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { NIHILITY, RADIATION_ELEMENT } from "../module/core/config.js";
import {
  originResistance,
  originWeakness,
  originWeaknessRows,
  netResistance,
  normalizeOriginConditions,
  normalizeSpeciesEntry,
  originConditionRule,
  conditionLands,
  conditionBlockText,
  conditionFloatText,
  originProtectionRows
} from "../module/species/species-rules.js";
import { resolveDamageParts, describeDamageParts } from "../module/combat/damage-rules.js";
import { explainResistance } from "../module/combat/stat-explain.js";
import { planOriginDefenseMigration, originDefenseKeptNotice, OLD_FACTORY_DEFENSES } from "../module/species/origin-defense-migration-rules.js";

const layer = (kind, label, passives) => ({ kind, kindLabel: { species: "Espécie", lineage: "Linhagem", heritage: "Herança" }[kind], label, passives });

test("fraqueza: valor negativo não vira resistência e soma entre camadas", () => {
  const layers = [
    layer("species", "Slime", { resistances: [{ target: "fire", amount: -20 }, { target: "blunt", amount: 30 }] }),
    layer("heritage", "Possuído", { resistances: [{ target: "fire", amount: -10 }] })
  ];
  assert.equal(originResistance(layers, "fire"), 0);
  assert.equal(originResistance(layers, "blunt"), 0.3);
  assert.ok(Math.abs(originWeakness(layers, "fire") - 0.3) < 1e-9);
  assert.equal(originWeakness(layers, "blunt"), 0);
  assert.deepEqual(originWeaknessRows(layers, "fire").map(r => r.label), ["Espécie: Slime", "Herança: Possuído"]);
});

test("netResistance: Skill 30% + fraqueza 20% = 10%; sem piso; Imunidade vale antes", () => {
  assert.ok(Math.abs(netResistance(0.3, 0.2) - 0.1) < 1e-9);
  assert.equal(netResistance(0, 0.2), -0.2);
  assert.equal(netResistance(0, 5), -5);
  assert.equal(netResistance(1, 0.5), 1);
  assert.equal(netResistance(0.5, 0), 0.5);
});

test("dano: fraqueza aumenta o dano, resistência líquida positiva ainda reduz, Imunidade zera", () => {
  const parts = [{ elementId: "fire", raw: 20 }];
  assert.equal(resolveDamageParts({ parts, resistanceFor: () => -0.2 }).final, 24);
  assert.equal(resolveDamageParts({ parts, resistanceFor: () => -1 }).final, 40);
  assert.equal(resolveDamageParts({ parts, resistanceFor: () => -3 }).final, 80, "sem piso: −300% quadruplica");
  assert.equal(resolveDamageParts({ parts, resistanceFor: () => 0.1 }).final, 18);
  assert.equal(resolveDamageParts({ parts, resistanceFor: () => 1 }).final, 0);
  // Dano Absoluto ignora a fraqueza.
  assert.equal(resolveDamageParts({ parts, resistanceFor: () => -0.5, absolute: true }).final, 20);
});

test("dano: fraqueza não conta como bloqueio (não rende XP de Resistência) e a Penetração não a reduz", () => {
  const [part] = resolveDamageParts({ parts: [{ elementId: "fire", raw: 20, penetration: 0.5 }], resistanceFor: () => -0.2 }).parts;
  assert.equal(part.blockedElement, 0);
  assert.equal(part.final, 24);
});

test("dano: fraqueza geral multiplica depois da Defesa Mágica", () => {
  assert.equal(resolveDamageParts({ parts: [{ elementId: null, raw: 10 }], general: -0.5 }).final, 15);
});

test("rastro de dano: linha da fraqueza com a fonte, em vermelho (kind weak)", () => {
  const result = resolveDamageParts({ parts: [{ elementId: "fire", raw: 20 }], resistanceFor: () => -0.2 });
  const rows = describeDamageParts(result.parts, { elementLabel: () => "Fogo", weaknessSourceLabel: () => "Espécie: Slime" });
  const weak = rows.find(r => r.kind === "weak");
  assert.equal(weak.label, "Fraqueza a Fogo (Espécie: Slime)");
  assert.equal(weak.value, "+20%");
});

test("De onde vem: Skill 30% + Slime −20% = 10%", () => {
  const ex = explainResistance({ skill: { name: "Resistência a Fogo", level: 3, value: 0.3 }, weaknesses: [{ label: "Espécie: Slime", value: 0.2 }] });
  assert.ok(Math.abs(ex.net - 0.1) < 1e-9);
  assert.equal(ex.rows.length, 2);
  assert.equal(ex.rows[1].value, -0.2);
  assert.equal(explainResistance({ weaknesses: [{ label: "x", value: 2 }] }).net, -2, "sem piso");
  const immune = explainResistance({ skill: { name: "Imunidade", level: 10, value: 1 }, weaknesses: [{ label: "x", value: 0.2 }] });
  assert.equal(immune.immune, true);
  assert.equal(immune.rows.length, 1, "a fraqueza não aparece contra a Imunidade");
});

test("Condições na origem: normaliza, imune vence, resistência é a melhor", () => {
  assert.deepEqual(normalizeOriginConditions([
    { conditionId: "poison", mode: "resist", amount: 250 },
    { conditionId: "poison", mode: "resist", amount: 10 },
    { conditionId: "bleeding", mode: "immune", amount: 3 },
    { conditionId: "", mode: "immune" }
  ]), [{ conditionId: "poison", mode: "resist", amount: 100 }, { conditionId: "bleeding", mode: "immune", amount: 100 }]);
  const layers = [
    layer("species", "Anão", { conditions: [{ conditionId: "poison", mode: "resist", amount: 30 }] }),
    layer("heritage", "Vampirizado", { conditions: [{ conditionId: "poison", mode: "resist", amount: 50 }, { conditionId: "fear", mode: "immune", amount: 100 }] })
  ];
  assert.deepEqual(originConditionRule(layers, "poison"), { immune: false, resist: 50, sources: ["Espécie: Anão", "Herança: Vampirizado"] });
  assert.equal(originConditionRule(layers, "fear").immune, true);
  assert.deepEqual(originConditionRule(layers, "stun"), { immune: false, resist: 0, sources: [] });
  // Resistência de 100% é Imunidade.
  assert.equal(originConditionRule([layer("species", "X", { conditions: [{ conditionId: "burn", mode: "resist", amount: 100 }] })], "burn").immune, true);
});

test("Condição: d100 até X não pega; acima pega; imune nunca; sem regra sempre", () => {
  const rule = { immune: false, resist: 30, sources: [] };
  assert.deepEqual(conditionLands(rule, 12), { lands: false, kind: "resist", amount: 30, roll: 12 });
  assert.equal(conditionLands(rule, 30).lands, false, "até X inclusive");
  assert.equal(conditionLands(rule, 31).lands, true);
  assert.equal(conditionLands({ immune: true, resist: 100, sources: [] }, 99).lands, false);
  assert.equal(conditionLands({ immune: false, resist: 0, sources: [] }, 1).kind, "none");
  assert.equal(conditionLands(null).lands, true);
});

test("textos de Condição que não pegou (chat e flutuante)", () => {
  assert.equal(conditionBlockText({ conditionLabel: "Veneno", actorName: "Anão", outcome: { kind: "resist", amount: 30, roll: 12 } }), "Veneno não pegou em Anão: resiste 30% (d100 = 12)");
  assert.equal(conditionBlockText({ conditionLabel: "Sangramento", actorName: "Slime", outcome: { kind: "immune" } }), "Sangramento não pegou em Slime: imune");
  assert.equal(conditionFloatText("immune", "Sangramento"), "Imune: Sangramento");
  assert.equal(conditionFloatText("resist", "Veneno"), "Resistiu: Veneno");
});

test("normalizeSpeciesEntry limpa as Condições da origem (também nas Linhagens)", () => {
  const entry = normalizeSpeciesEntry({ label: "X", passives: { conditions: [{ conditionId: "", mode: "immune" }] }, lineages: [{ id: "a", passives: { conditions: [{ conditionId: "poison", mode: "immune" }, { conditionId: "poison", mode: "immune" }] } }] });
  assert.equal(entry.passives.conditions, undefined);
  assert.deepEqual(entry.lineages[0].passives.conditions, [{ conditionId: "poison", mode: "immune", amount: 100 }]);
});

test("linhas da aba Origem: resistência, fraqueza e Condição", () => {
  const rows = originProtectionRows([layer("species", "Slime", { resistances: [{ target: "blunt", amount: 30 }, { target: "fire", amount: -20 }], conditions: [{ conditionId: "bleeding", mode: "immune", amount: 100 }] })], { elementLabel: id => ({ blunt: "Contundente", fire: "Fogo" })[id], conditionLabel: id => ({ bleeding: "Sangramento" })[id] });
  assert.deepEqual(rows.map(r => r.text), ["Resiste Contundente 30%", "Fraqueza a Fogo −20%", "Imune a Sangramento"]);
  assert.deepEqual(rows.map(r => r.tone), ["resist", "weak", "condition"]);
});

/* ---------------------------------------------------------------- tabela de fábrica */

const species = NIHILITY.DEFAULT_SPECIES_PRESETS;
const heritages = NIHILITY.DEFAULT_HERITAGES;
const elementIds = new Set([...NIHILITY.DEFAULT_DAMAGE_ELEMENTS.map(e => e.id), RADIATION_ELEMENT.id, "general"]);
const conditionIds = new Set(NIHILITY.DEFAULT_STATUS_CONDITIONS.map(c => c.id));
const defenseOf = entry => ({
  res: Object.fromEntries((entry.passives?.resistances ?? []).map(r => [r.target, r.amount])),
  cond: Object.fromEntries((entry.passives?.conditions ?? []).map(c => [c.conditionId, c.mode === "immune" ? "imune" : c.amount]))
});

test("fábrica: todo elemento e toda Condição citados existem nos catálogos de fábrica (a Radiação entra com o bloco Sci-Fi)", () => {
  const entries = [...Object.values(species), ...Object.values(species).flatMap(s => s.lineages ?? []), ...heritages];
  for (const entry of entries) {
    for (const r of entry.passives?.resistances ?? []) assert.ok(elementIds.has(r.target), `${entry.label}: elemento ${r.target}`);
    for (const c of entry.passives?.conditions ?? []) assert.ok(conditionIds.has(c.conditionId), `${entry.label}: Condição ${c.conditionId}`);
  }
});

test("fábrica: a tabela aprovada (amostra de cada tipo de linha)", () => {
  assert.deepEqual(defenseOf(species.anao), { res: { blunt: 10, fire: 10 }, cond: { poison: 30 } });
  assert.deepEqual(defenseOf(species.slime), { res: { blunt: 30, acid: 30, fire: -20 }, cond: { bleeding: "imune" } });
  assert.deepEqual(defenseOf(species.androide), { res: { radiation: 50, lightning: -20 }, cond: { poison: "imune", bleeding: "imune" } });
  assert.deepEqual(defenseOf(species.slime_demoniaco).res, { dark: 30, blunt: 30, acid: 30, holy: -20 });
  assert.deepEqual(defenseOf(species.inseto_de_carga), { res: { acid: 10, fire: -20 }, cond: { poison: 20 } });
  assert.deepEqual(defenseOf(species.halfling), { res: {}, cond: { fear: 30 } });
  assert.deepEqual(defenseOf(species.humano), { res: {}, cond: {} });
  assert.deepEqual(defenseOf(species.orc), { res: {}, cond: {} });
  assert.deepEqual(species.lobo_tempestade.elements, ["lightning"]);
  assert.deepEqual(defenseOf(species.lobo_tempestade).res, { lightning: 30 });
  const lineage = (s, id) => defenseOf(species[s].lineages.find(l => l.id === id));
  assert.deepEqual(lineage("elfo", "sombrio").res, { dark: 20, holy: -10 });
  assert.deepEqual(lineage("dragoide", "fogo").res, { fire: 20, ice: -20 });
  assert.deepEqual(lineage("dragoide", "gelo").res, { ice: 20, fire: -20 });
  assert.deepEqual(lineage("dragoide", "raio").res, { lightning: 20 });
  const heritage = id => defenseOf(heritages.find(h => h.id === id));
  assert.deepEqual(heritage("vampirizado"), { res: { dark: 30 }, cond: { poison: "imune" } });
  assert.deepEqual(heritage("possuido"), { res: { dark: 20, holy: -20 }, cond: { fear: 30 } });
  assert.deepEqual(heritage("abencoado"), { res: { dark: 20, holy: 20 }, cond: { fear: 30 } });
  assert.deepEqual(heritage("convertido_ciborgue"), { res: { radiation: 20, lightning: -10 }, cond: { bleeding: 30 } });
  assert.deepEqual(heritage("mutacao_radioativa").res, { radiation: 40, acid: 10 });
});

/* ---------------------------------------------------------------- migração */

const clone = v => JSON.parse(JSON.stringify(v));

/** O catálogo salvo "da fábrica anterior": os valores novos trocados pelos antigos onde mudaram. */
function oldFactoryCatalog() {
  const sp = clone(species);
  const her = clone(heritages);
  for (const [key, old] of Object.entries(OLD_FACTORY_DEFENSES)) {
    const [kind, a, b] = key.split(":");
    const target = kind === "species" ? sp[a] : kind === "lineage" ? sp[a].lineages.find(l => l.id === b) : her.find(h => h.id === a);
    target.passives = { ...(target.passives ?? {}), resistances: clone(old.resistances) };
  }
  // O resto não tinha Resistência nem Condição de fábrica.
  for (const entry of [...Object.entries(sp).map(([id, e]) => [`species:${id}`, e]), ...Object.entries(sp).flatMap(([id, e]) => (e.lineages ?? []).map(l => [`lineage:${id}:${l.id}`, l])), ...her.map(h => [`heritage:${h.id}`, h])]) {
    const [key, e] = entry;
    if (OLD_FACTORY_DEFENSES[key]) { if (e.passives) delete e.passives.conditions; continue; }
    if (e.passives) { delete e.passives.resistances; delete e.passives.conditions; }
  }
  sp.lobo_tempestade.elements = [];
  return { species: sp, heritages: her };
}

test("migração: catálogo igual à fábrica anterior recebe a tabela nova inteira", () => {
  const saved = oldFactoryCatalog();
  const plan = planOriginDefenseMigration({ ...saved, factory: { species, heritages } });
  assert.deepEqual(plan.kept, []);
  assert.ok(plan.changed.length > 20);
  assert.deepEqual(defenseOf(plan.species.slime), { res: { blunt: 30, acid: 30, fire: -20 }, cond: { bleeding: "imune" } });
  assert.deepEqual(plan.species.lobo_tempestade.elements, ["lightning"]);
  assert.deepEqual(defenseOf(plan.species.dragoide.lineages.find(l => l.id === "fogo")).res, { fire: 20, ice: -20 });
  assert.deepEqual(defenseOf(plan.heritages.find(h => h.id === "mutacao_radioativa")).res, { radiation: 40, acid: 10 });
  // Não mexe no que não mudou (Meio-Dragão) nem no catálogo de entrada.
  assert.deepEqual(defenseOf(plan.heritages.find(h => h.id === "meio_dragao")).res, { fire: 20 });
  assert.deepEqual(defenseOf(saved.species.slime), { res: {}, cond: {} });
});

test("migração: Espécie que o Mestre editou fica como está e é avisada; rodar de novo não muda nada", () => {
  const saved = oldFactoryCatalog();
  saved.species.anao.passives = { ...(saved.species.anao.passives ?? {}), resistances: [{ target: "fire", amount: 50 }] };
  const plan = planOriginDefenseMigration({ ...saved, factory: { species, heritages } });
  assert.deepEqual(plan.species.anao.passives.resistances, [{ target: "fire", amount: 50 }]);
  assert.deepEqual(plan.kept, ["Anão (Resistências)"]);
  assert.deepEqual(defenseOf(plan.species.anao).cond, { poison: 30 }, "o campo de Condições não estava editado");
  assert.match(originDefenseKeptNotice(plan.kept), /Anão \(Resistências\)/);
  const again = planOriginDefenseMigration({ species: plan.species, heritages: plan.heritages, factory: { species, heritages } });
  assert.deepEqual(again.changed, []);
  assert.deepEqual(again.kept, ["Anão (Resistências)"]);
  assert.equal(originDefenseKeptNotice([]), "");
});

test("migração: Espécie ausente do catálogo salvo é ignorada", () => {
  const plan = planOriginDefenseMigration({ species: { humano: clone(species.humano) }, heritages: [], factory: { species, heritages } });
  assert.deepEqual(plan.changed, []);
  assert.deepEqual(plan.kept, []);
});

/* ---------------------------------------------------------------- IA */

import { sanitizeOriginEntry, originGuide } from "../module/ai/ai-mechanics.js";

test("IA: Espécie gerada aceita fraqueza (negativo) e Condições da origem; id inexistente sai", () => {
  const catalogs = { elements: [{ id: "fire", label: "Fogo" }, { id: "ice", label: "Gelo" }], conditions: [{ id: "poison", label: "Veneno" }, { id: "bleeding", label: "Sangramento" }], traits: [], bodyFunctions: [], attributes: [] };
  const { entry } = sanitizeOriginEntry({
    label: "Slime",
    resistances: [{ target: "ice", amount: 20 }, { target: "fire", amount: -90 }, { target: "fire", amount: 0 }, { target: "plasma", amount: -10 }],
    conditions: [{ conditionId: "bleeding", mode: "immune" }, { conditionId: "poison", mode: "resist", amount: 30 }, { conditionId: "inventada", mode: "immune" }]
  }, catalogs);
  assert.deepEqual(entry.passives.resistances, [{ target: "ice", amount: 20 }, { target: "fire", amount: -50 }]);
  assert.deepEqual(entry.passives.conditions, [{ conditionId: "bleeding", mode: "immune", amount: 100 }, { conditionId: "poison", mode: "resist", amount: 30 }]);
  assert.match(originGuide(catalogs), /FRAQUEZA/);
  assert.match(originGuide(catalogs), /poison \(Veneno\)/);
});

/* ---------------------------------------------------------------- Validar Mundo */

import { buildCatalogIndex, originDefenseIssues, isSystemHoldingCondition, validateCatalogs } from "../module/world/world-validator.js";

test("Validar Mundo: Imunidade a Condição do sistema, Condição e elemento inexistentes", () => {
  const conditions = NIHILITY.DEFAULT_STATUS_CONDITIONS;
  const idx = buildCatalogIndex({ conditions, elements: NIHILITY.DEFAULT_DAMAGE_ELEMENTS });
  assert.equal(isSystemHoldingCondition(conditions.find(c => c.id === "trapped")), true);
  assert.equal(isSystemHoldingCondition(conditions.find(c => c.id === "anchored")), true);
  assert.equal(isSystemHoldingCondition(conditions.find(c => c.id === "fallen")), true);
  assert.equal(isSystemHoldingCondition(conditions.find(c => c.id === "antimagic-suppressed")), true);
  assert.equal(isSystemHoldingCondition(conditions.find(c => c.id === "poison")), false);
  const issues = originDefenseIssues({ passives: { resistances: [{ target: "plasma_falso", amount: -10 }], conditions: [{ conditionId: "trapped", mode: "immune" }, { conditionId: "poison", mode: "immune" }, { conditionId: "sumiu", mode: "resist", amount: 20 }] } }, idx, conditions);
  assert.equal(issues.length, 3);
  assert.match(issues.map(i => i.message).join("|"), /Imunidade a "Preso"/);
  assert.match(issues.map(i => i.message).join("|"), /"sumiu" não existe/);
  assert.match(issues.map(i => i.message).join("|"), /"plasma_falso" não existe/);
  // A tabela de fábrica passa limpa (a Radiação só entra no índice quando o bloco Sci-Fi está ligado).
  const factory = validateCatalogs({ conditions, elements: [...NIHILITY.DEFAULT_DAMAGE_ELEMENTS, RADIATION_ELEMENT], species: NIHILITY.DEFAULT_SPECIES_PRESETS, heritages: NIHILITY.DEFAULT_HERITAGES, traits: NIHILITY.DEFAULT_TRAITS });
  const text = JSON.stringify(factory);
  assert.doesNotMatch(text, /segurar alguém/);
});
