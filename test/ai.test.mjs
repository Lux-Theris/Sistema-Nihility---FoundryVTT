/**
 * Geração por IA: lote, resumo de documento, saneamento de Skill/arma/Espécie.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { buildBatchPrompt, summarizeCreatedDocument } from "../module/ai/ai-generation.js";
import {
  sanitizeSkillMechanics,
  sanitizeWeapon,
  sanitizeItemBonuses,
  mechanicsGuide,
  simpleFormulaCheck
} from "../module/ai/ai-mechanics.js";
import { sanitizeOriginEntry, originGuide } from "../module/ai/ai-mechanics.js";

/* -------------------------------------------- */
/*  Contexto de geração em lote via IA           */
/* -------------------------------------------- */

test("lote de IA: geração única não ganha texto de leva nenhum", () => {
  assert.equal(buildBatchPrompt("um mercador anão", [], 0, 1), "um mercador anão");
});

test("lote de IA: o 1º item é avisado de que os próximos vão vê-lo", () => {
  const p = buildBatchPrompt("um mercador anão", [], 0, 5);
  assert.match(p, /item 1 de 5/);
  assert.ok(p.startsWith("um mercador anão"), "o pedido original tem que vir primeiro");
});

test("lote de IA: do 2º em diante, os anteriores entram no prompt", () => {
  // É o ponto da mudança: antes a IA só recebia "diferente das anteriores", sem saber quais.
  const p = buildBatchPrompt("um mercador anão", ["Borin — espécie anao — nível 3"], 1, 3);
  assert.match(p, /JÁ CRIADOS NESTA MESMA LEVA \(1 de 3\)/);
  assert.match(p, /1\. Borin — espécie anao — nível 3/);
  assert.match(p, /item 2 de 3/);
});

test("lote de IA: resumo vazio ou nulo não vira linha em branco na lista", () => {
  const p = buildBatchPrompt("x", [null, "", "Kaelen — nível 2"], 3, 4);
  assert.match(p, /\(1 de 4\)/);          // só o resumo real conta
  assert.match(p, /1\. Kaelen/);
  assert.ok(!/^2\. *$/m.test(p), "resumo vazio não pode virar item numerado");
});

test("resumo de documento: Ator traz espécie, nível e as Skills reaproveitáveis", () => {
  const actor = {
    documentName: "Actor",
    type: "character",
    name: "Borin",
    system: { species: "anao", attributes: { level: 3 }, biography: "<p>Ferreiro de <b>Ashcroft</b>.</p>" },
    items: [
      { type: "skill", name: "Olho de Forja" },
      { type: "body_part", name: "Tronco" }
    ]
  };
  const resumo = summarizeCreatedDocument(actor);
  assert.match(resumo, /Borin/);
  assert.match(resumo, /espécie anao/);
  assert.match(resumo, /nível 3/);
  assert.match(resumo, /Skills: Olho de Forja/);
  // HTML sai limpo, e Parte do Corpo não entra (não é peça reaproveitável na escrita).
  assert.match(resumo, /Ferreiro de Ashcroft\./);
  assert.ok(!resumo.includes("<b>"));
  assert.ok(!resumo.includes("Tronco"));
});

test("resumo de documento: Nave traz Porte e Módulos", () => {
  const nave = {
    documentName: "Actor",
    type: "starship",
    name: "Vagalume",
    system: { shipSize: "pequeno", biography: "" },
    items: [{ type: "starship_module", name: "Reator Fagulha" }]
  };
  assert.match(summarizeCreatedDocument(nave), /Vagalume — Porte pequeno — Módulos: Reator Fagulha/);
});

test("resumo de documento: nulo devolve nulo em vez de quebrar a leva", () => {
  assert.equal(summarizeCreatedDocument(null), null);
});

const AI_CATALOGS = {
  elements: [{ id: "fire", label: "Fogo" }, { id: "poison", label: "Veneno" }],
  conditions: [{ id: "burn", label: "Queimadura" }, { id: "poisoned", label: "Envenenado" }],
  attributes: [{ id: "strength", label: "Força" }, { id: "magic", label: "Magia" }],
  structures: [{ id: "wall", label: "Muralha" }]
};

test("IA: Skill de dano saneada (elemento inventado sai, área limitada)", () => {
  const m = sanitizeSkillMechanics(
    { effectType: "damage", damageFormula: "3d6+2", isMagicDamage: true, damageElements: ["fire", "plasma"], scalingAttribute: "magic", targetType: "emission", areaShape: "cone", areaDistance: 99, cost: 12 },
    AI_CATALOGS
  );
  assert.equal(m.effectType, "damage");
  assert.deepEqual(m.damageElements, ["fire"]);
  assert.equal(m.scalingAttribute, "magic");
  assert.equal(m.areaShape, "cone");
  assert.equal(m.areaDistance, 30);
  assert.equal(m.cost, 12);
});

test("IA: fórmula inválida derruba o dano para Descritiva", () => {
  assert.equal(sanitizeSkillMechanics({ effectType: "damage", damageFormula: "game.actors.forEach()" }, AI_CATALOGS).effectType, "none");
  assert.equal(simpleFormulaCheck("2d6+1d4kh1"), true);
  assert.equal(simpleFormulaCheck("abc"), false);
});

test("IA: Efeito Temporário — veneno periódico, Condição válida, alvo de Nave recusado", () => {
  const m = sanitizeSkillMechanics(
    {
      effectType: "temporary",
      effects: [
        { target: "hp", amount: -5, durationRounds: 0, periodic: true, conditionId: "poisoned", damageElements: ["poison", "xx"] },
        { target: "shipCasco", amount: -10 },
        { target: "strength", amount: 0, conditionId: "nope" },
        { target: "strength", amount: 3, durationRounds: 2, periodic: true }
      ]
    },
    AI_CATALOGS
  );
  assert.equal(m.effectType, "temporary");
  assert.equal(m.effects.length, 2);
  assert.deepEqual(m.effects[0], { target: "hp", amount: -5, durationRounds: 3, conditionId: "poisoned", periodic: true, tickUnit: "combatRound", damageElements: ["poison"], modifierType: "flat" });
  assert.equal(m.effects[1].periodic, false, "periódico só em hp/energy");
  assert.equal(sanitizeSkillMechanics({ effectType: "temporary", effects: [] }, AI_CATALOGS).effectType, "none");
});

test("IA: Resistência, Habilidade Ativa, Estrutura e lixo", () => {
  assert.equal(sanitizeSkillMechanics({ resistanceTarget: "fire" }, AI_CATALOGS).resistanceTarget, "fire");
  assert.equal(sanitizeSkillMechanics({ resistanceTarget: "plasma" }, AI_CATALOGS).resistanceTarget, "");
  assert.equal(sanitizeSkillMechanics({ hasUpkeep: false, upkeepCost: 9 }, AI_CATALOGS).upkeepCost, 0);
  assert.equal(sanitizeSkillMechanics({ effectType: "structure", structureId: "nope" }, AI_CATALOGS).effectType, "none");
  assert.equal(sanitizeSkillMechanics({ effectType: "structure", structureId: "wall" }, AI_CATALOGS).structureId, "wall");
  const junk = sanitizeSkillMechanics(null, AI_CATALOGS);
  assert.equal(junk.effectType, "none");
  assert.equal(junk.targetType, "targeted");
});

test("IA: arma e bônus de Item", () => {
  assert.equal(sanitizeWeapon(null, AI_CATALOGS), null);
  assert.equal(sanitizeWeapon({ damageFormula: "" }, AI_CATALOGS), null);
  assert.deepEqual(sanitizeWeapon({ damageFormula: "1d8+2", damageElements: ["fire", "x"], scalingAttribute: "dex" }, AI_CATALOGS), {
    enabled: true, damageFormula: "1d8+2", scalingAttribute: "", isMagicDamage: false, isAbsoluteDamage: false, damageElements: ["fire"]
  });
  const b = sanitizeItemBonuses({ attributeBonuses: [{ attribute: "strength", amount: 99 }, { attribute: "luck", amount: 2 }], statModifiers: { hp: 30 } }, AI_CATALOGS);
  assert.deepEqual(b.attributeBonuses, [{ attribute: "strength", amount: 20 }]);
  assert.deepEqual(b.statModifiers, { hp: 30, energy: 0 });
  assert.match(mechanicsGuide(AI_CATALOGS), /fire \(Fogo\)/);
});

const leg = (id, hp, max = 10, extra = {}) => ({ id, name: id, slot: "leg", hpValue: hp, hpMax: max, functions: ["locomocao"], ...extra });

const arm = (id, hp, extra = {}) => ({ id, name: id, slot: "arm", hpValue: hp, hpMax: 8, functions: ["manipulacao"], ...extra });

test("IA: Espécie gerada é saneada para o formato do catálogo", () => {
  const catalogs = { ...AI_CATALOGS, traits: [{ id: "organic", label: "Orgânico" }], bodyFunctions: [{ id: "locomocao", label: "locomoção" }, { id: "vital", label: "vital" }] };
  const { id, entry } = sanitizeOriginEntry(
    {
      label: "Homem-Lagarto",
      group: "fantasia",
      traits: ["organic", "reptil"],
      elements: ["fire", "magma"],
      parts: [{ label: "Perna", slot: "Leg", hpMax: 999, functions: ["locomocao", "voar"] }, { label: "Perna", slot: "leg", hpMax: 10 }],
      resistances: [{ target: "fire", amount: 80 }, { target: "plasma", amount: 10 }],
      skills: [{ name: "Mordida", mechanics: { effectType: "damage", damageFormula: "1d8" } }],
      lineages: [{ label: "Do Pântano", replacesSkills: ["Mordida", "Inexistente"], skills: [{ name: "Veneno", mechanics: { effectType: "temporary", effects: [{ target: "hp", amount: -3, periodic: true }] } }] }]
    },
    catalogs
  );
  assert.equal(id, "homem_lagarto");
  assert.deepEqual(entry.traits, ["organic"]);
  assert.deepEqual(entry.elements, ["fire"]);
  assert.deepEqual(entry.parts.map(p => [p.key, p.slot, p.hpMax, p.tags]), [["perna", "leg", 200, ["locomocao"]], ["perna_2", "leg", 10, []]]);
  assert.deepEqual(entry.passives.resistances, [{ target: "fire", amount: 50 }]);
  assert.equal(entry.skills[0].effectType, "damage");
  assert.deepEqual(entry.lineages[0].replaces.skills, ["mordida"]);
  assert.equal(entry.lineages[0].skills[0].effects[0].periodic, true);
  const her = sanitizeOriginEntry({ label: "Vampirizado", removesTraits: ["organic"], replacesSlots: ["Arm"] }, catalogs, { kind: "heritage" });
  assert.deepEqual(her.entry.removesTraits, ["organic"]);
  assert.deepEqual(her.entry.replaces.slots, ["arm"]);
  assert.equal(her.entry.lineages, undefined);
  assert.match(originGuide(catalogs), /locomocao \(locomoção\)/);
});
