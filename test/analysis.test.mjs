import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveAnalysisLevel, analysisMargin, analysisTier, analysisSections, analysisTierLabel, weaknessRows, resistanceRows, resistanceText
} from "../module/skills/analysis-rules.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { skillUseMode } from "../module/skills/skill-use-mode.js";
import { borrowableSkill } from "../module/skills/borrowed-rules.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";
import { suggestSkillCost } from "../module/skills/skill-cost-rules.js";
import { MEU_SISTEMA } from "../module/core/config.js";

test("nível efetivo: só a Análise mágica perde nível pela Defesa Mágica", () => {
  assert.equal(effectiveAnalysisLevel(10, false, 0.5), 10);
  assert.equal(effectiveAnalysisLevel(10, true, 0.5), 5);
  assert.equal(effectiveAnalysisLevel(7, true, 0.3), 4);
  assert.equal(effectiveAnalysisLevel(10, true, 2), 0);
  assert.equal(effectiveAnalysisLevel(-3, true, 0), 0);
});

test("margem: nível − (alvo + Ocultação) + degraus de Percepção × Furtividade", () => {
  assert.equal(analysisMargin({ level: 10, targetLevel: 6, concealment: 2 }), 2);
  assert.equal(analysisMargin({ level: 10, targetLevel: 6, concealment: 2, perception: 35, stealth: 12, step: 10 }), 4);
  // Furtividade maior que a Percepção tira degraus (trunca para zero).
  assert.equal(analysisMargin({ level: 10, targetLevel: 6, perception: 5, stealth: 26, step: 10 }), 2);
  assert.equal(analysisMargin({ level: 10, targetLevel: 6, perception: 5, stealth: 14, step: 10 }), 4);
  // Mágica com Defesa Mágica; tecnológica ignora.
  assert.equal(analysisMargin({ level: 10, magic: true, magicDefenseReduction: 0.5, targetLevel: 3 }), 2);
  assert.equal(analysisMargin({ level: 10, magic: false, magicDefenseReduction: 0.5, targetLevel: 3 }), 7);
  // Degrau 0 ou inválido volta ao padrão (10).
  assert.equal(analysisMargin({ level: 10, targetLevel: 3, perception: 40, stealth: 0, step: 0 }), 7 + 4);
});

test("degraus: <0 nada; 0, 2, 4, 6, 8", () => {
  assert.deepEqual([-5, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 20].map(analysisTier), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(analysisTier(NaN), 0);
});

test("seções são cumulativas", () => {
  assert.deepEqual(analysisSections(0), []);
  assert.deepEqual(analysisSections(1), ["origin", "traits", "elements"]);
  assert.deepEqual(analysisSections(2), ["origin", "traits", "elements", "vitals", "conditions"]);
  assert.ok(analysisSections(3).includes("weaknesses"));
  assert.ok(!analysisSections(3).includes("skills"));
  assert.ok(analysisSections(4).includes("skills") && !analysisSections(4).includes("skillSentences"));
  assert.ok(analysisSections(5).includes("skillSentences") && analysisSections(5).includes("attributes"));
  assert.equal(analysisTierLabel(0), "Nada");
  assert.equal(analysisTierLabel(5), "Completo");
});

test("fraquezas e resistências: só o que conta, do maior ao menor", () => {
  assert.deepEqual(weaknessRows([{ id: "fire", factor: 1 }, { id: "ice", factor: 2 }, { id: "wind", factor: 1.5 }, { id: "rock", factor: 0.5 }]), [{ id: "ice", factor: 2 }, { id: "wind", factor: 1.5 }]);
  assert.deepEqual(resistanceRows([{ id: "a", percent: 0 }, { id: "b", percent: 0.3 }, { id: "c", percent: 1.4 }]), [{ id: "c", percent: 1 }, { id: "b", percent: 0.3 }]);
  assert.equal(resistanceText(0.3), "Resistência 30%");
  assert.equal(resistanceText(1), "Imunidade");
});

test("Mecânica Análise: tipos, uso, frase, lint, custo e empréstimo", () => {
  assert.ok(MEU_SISTEMA.SKILL_EFFECT_TYPES.includes("analysis"));
  assert.ok(MEU_SISTEMA.SKILL_EFFECT_TYPE_LABELS.analysis && MEU_SISTEMA.SKILL_EFFECT_TYPE_SHORT_LABELS.analysis);
  // Sempre alvo único, mesmo escrita como Emissão ou "Si mesmo".
  assert.equal(skillUseMode({ effectType: "analysis", targetType: "emission" }, { areaEnabled: true, areaSupported: true }), "targeted");
  assert.equal(skillUseMode({ effectType: "analysis", targetType: "self" }), "targeted");
  assert.equal(skillUseMode({ effectType: "analysis", hasUpkeep: true, active: true }), "deactivate");
  assert.match(skillSummary({ effectType: "analysis", targetType: "targeted", cost: 5 }), /analisa um alvo/);
  assert.match(skillSummary({ coreSkill: "concealment" }), /dificulta a Análise/);
  assert.equal(borrowableSkill({ effectType: "analysis" }), false);
  const codes = lintSkill({ effectType: "analysis", targetType: "emission" }).map(i => i.code);
  assert.ok(codes.includes("analysisPredationTarget"));
  assert.ok(lintSkill({ effectType: "analysis", hasUpkeep: true }).some(i => i.code === "analysisPredationActive" && i.level === "hard"));
  assert.equal(lintSkill({ effectType: "analysis", targetType: "targeted" }).some(i => i.code.startsWith("analysisPredation")), false);
  const cost = suggestSkillCost({ effectType: "analysis", targetType: "targeted", level: 1 }, {});
  assert.ok(cost.rows.some(r => /Análise/.test(r.label)));
});
