/**
 * Editor de Skill assistido: avisos (L8), custo sugerido (L9) e Modelos de Skill (L7).
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { lintSkill, lintIndex } from "../module/skills/skill-lint-rules.js";
import { suggestSkillCost, averageRoll, areaFactor, costCloseEnough, holderLine } from "../module/skills/skill-cost-rules.js";
import { normalizeSkillTemplate, templateSkillData, templateFromSkill } from "../module/skills/skill-template-rules.js";
import { MEU_SISTEMA } from "../module/core/config.js";

const codes = list => list.map(w => w.code);
const eff = (target, amount, rounds, extra = {}) => ({ target, amount, durationRounds: rounds, conditionId: "", periodic: false, damageElements: [], ...extra });

test("Avisos: Skill bem montada não reclama", () => {
  const fireball = { effectType: "damage", targetType: "emission", areaShape: "circle", areaDistance: 4, damageFormula: "4d6", damageElements: ["fire"], cost: 25 };
  assert.deepEqual(lintSkill(fireball, { elements: ["fire"], validFormula: () => true }), []);
});

test("Avisos: o que não faz nada", () => {
  const w = lintSkill(
    {
      effectType: "temporary",
      targetType: "targeted",
      upkeepCost: 3,
      effects: [eff("strength", -3, 3, { periodic: true }), eff("shield", 20, 0, { shieldRegen: 5 }), eff("dexterity", 0, 2)]
    },
    {}
  );
  assert.deepEqual(codes(w), ["upkeepNotActive", "periodicTarget", "sustainedNotActive", "zeroEffect"]);
  assert.equal(w[1].effect, 0);
  assert.equal(w[1].tab, "mechanic");
  assert.equal(w[0].tab, "general");
  assert.ok(w.every(x => x.level === "hard"));
});

test("Avisos: área 0, fórmula, Estrutura, catálogo", () => {
  assert.deepEqual(codes(lintSkill({ effectType: "damage", targetType: "emission", areaDistance: 0, damageFormula: "2d6" }, {})), ["areaZero"]);
  assert.deepEqual(codes(lintSkill({ effectType: "damage", targetType: "targeted", damageFormula: "" }, {})), ["noFormula"]);
  assert.deepEqual(codes(lintSkill({ effectType: "damage", targetType: "targeted", damageFormula: "2d6+" }, { validFormula: f => !f.endsWith("+") })), ["badFormula"]);
  assert.deepEqual(codes(lintSkill({ effectType: "structure", structureId: "" }, {})), ["noStructure"]);
  assert.deepEqual(codes(lintSkill({ effectType: "structure", structureId: "x" }, { structures: ["y"] })), ["unknownStructure"]);
  assert.deepEqual(codes(lintSkill({ effectType: "temporary", effects: [eff("strength", -2, 2, { conditionId: "sumiu" })] }, { conditions: ["slow"] })), ["unknownCondition"]);
  assert.deepEqual(codes(lintSkill({ effectType: "temporary", effects: [] }, {})), ["noEffects"]);
});

test("Avisos: 'confira' e o que depende de quem tem a Skill", () => {
  const forever = lintSkill({ effectType: "temporary", effects: [eff("dexterity", -4, 0, { conditionId: "slow" })] }, {});
  assert.deepEqual(codes(forever), ["forever"]);
  assert.equal(forever[0].level, "soft");
  // Numa Skill Ativa, sem duração é o normal.
  assert.deepEqual(codes(lintSkill({ effectType: "temporary", hasUpkeep: true, upkeepCost: 2, effects: [eff("dexterity", 4, 0)] }, {})), []);
  assert.deepEqual(codes(lintSkill({ effectType: "none", hasUpkeep: true, upkeepCost: 0 }, {})), ["activeFree"]);
  assert.deepEqual(codes(lintSkill({ effectType: "damage", damageFormula: "1d6", isAbsoluteDamage: true, isMagicDamage: true }, {})), ["absoluteMagic"]);
  // Efeito de Nave: só "Si mesmo" é certeza de erro (um tripulante pode mirar a Nave).
  const shipBoost = { effectType: "temporary", targetType: "self", effects: [eff("shipShieldCapacity", 20, 3)] };
  assert.deepEqual(codes(lintSkill(shipBoost, { actorType: "character" })), ["shipOnSelf"]);
  assert.deepEqual(codes(lintSkill({ ...shipBoost, targetType: "targeted" }, { actorType: "character" })), []);
  assert.deepEqual(codes(lintSkill({ effectType: "none", cost: 50 }, { energyMax: 40 })), ["costOverPool"]);
  assert.deepEqual(codes(lintSkill({ effectType: "none", cost: 50 }, { energyMax: null })), []);
  const { byTab, byEffect } = lintIndex(lintSkill({ effectType: "temporary", upkeepCost: 1, effects: [eff("strength", 0, 1)] }, {}));
  assert.deepEqual(byTab, { general: 1, mechanic: 1 });
  assert.equal(byEffect[0].length, 1);
});

test("Custo sugerido: dados médios, área e a calibragem da Bola de Fogo", () => {
  assert.equal(averageRoll("4d6"), 14);
  assert.equal(averageRoll("2d6+3"), 10);
  assert.equal(averageRoll("d20-2"), 8.5);
  assert.equal(averageRoll("1d8 + @forca"), 4.5);
  assert.equal(averageRoll(""), 0);
  assert.equal(areaFactor("circle", 0), 1);
  assert.ok(areaFactor("circle", 4) > areaFactor("cone", 4));
  const fireball = suggestSkillCost({ effectType: "damage", targetType: "emission", areaShape: "circle", areaDistance: 4, damageFormula: "4d6", scalingAttribute: "magic" });
  assert.equal(fireball.cost, 25);
  assert.ok(fireball.rows.some(r => /Dano médio/.test(r.label)));
  assert.equal(fireball.upkeep, null);
  // Mais "Mana por ponto" = mais caro; nunca negativo.
  assert.ok(suggestSkillCost({ effectType: "damage", damageFormula: "4d6" }, { manaPerPoint: 2 }).cost > suggestSkillCost({ effectType: "damage", damageFormula: "4d6" }).cost);
  assert.equal(suggestSkillCost({ effectType: "none" }).cost, 0);
});

test("Custo sugerido: efeitos, porcentagem, Ativa e as Skills padrão por perto", () => {
  const slow = suggestSkillCost({ effectType: "temporary", targetType: "targeted", effects: [eff("dexterity", -4, 3, { conditionId: "slow" })] });
  assert.equal(slow.cost, 12);
  // +50% de Deslocamento não vale como +50 pontos.
  assert.ok(suggestSkillCost({ effectType: "temporary", effects: [eff("movement", 50, 2)] }).cost < 10);
  const aura = suggestSkillCost({ effectType: "temporary", targetType: "self", hasUpkeep: true, upkeepCost: 0, effects: [eff("defense", 3, 0)] });
  assert.ok(aura.upkeep >= 1 && aura.upkeep <= aura.cost);
  // A maioria das Skills dos Arquétipos fica a até 50% do custo que tem.
  const skills = MEU_SISTEMA.DEFAULT_NPC_ARCHETYPES.flatMap(a => a.skills).filter(s => s.effectType !== "none");
  const near = skills.filter(s => costCloseEnough(s.cost, suggestSkillCost(s).cost, 0.5));
  assert.ok(near.length / skills.length >= 0.8, `${near.length}/${skills.length} perto`);
  assert.equal(costCloseEnough(25, 25), true);
  assert.equal(costCloseEnough(4, 12), false);
  assert.deepEqual(holderLine(25, 180), { percent: 14, uses: 7 });
  assert.equal(holderLine(0, 180), null);
});

test("Modelos: normaliza, preenche e troca o que o mundo não tem", () => {
  const defaults = MEU_SISTEMA.DEFAULT_SKILL_TEMPLATES.map(normalizeSkillTemplate);
  assert.equal(defaults.length, 12);
  assert.equal(new Set(defaults.map(t => t.id)).size, 12);
  for (const t of defaults) {
    assert.ok(MEU_SISTEMA.SKILL_EFFECT_TYPES.includes(t.skill.effectType), t.id);
    // Todo modelo de fábrica já nasce sem aviso "não faz nada".
    assert.deepEqual(lintSkill(t.skill, {}).filter(w => w.level === "hard"), [], t.id);
  }
  const area = defaults.find(t => t.id === "area_dano");
  const data = templateSkillData(area, { name: "Explosão de Brasas", tier: "unique" }, { elements: ["physical"] });
  assert.equal(data.name, "Explosão de Brasas");
  assert.equal(data.tier, "unique");
  assert.deepEqual(data.damageElements, []);
  assert.equal(templateSkillData(area, {}).name, "Área de dano");
  const wall = templateSkillData(defaults.find(t => t.id === "barreira"), {}, { structures: ["ice-block"] });
  assert.equal(wall.structureId, "ice-block");
  const poison = templateSkillData(defaults.find(t => t.id === "veneno"), {}, { conditions: [] });
  assert.equal(poison.effects[0].conditionId, "");
  // Não muda o modelo de origem.
  assert.equal(defaults.find(t => t.id === "veneno").skill.effects[0].conditionId, "poison");
  const saved = templateFromSkill("Sopro Gélido", { effectType: "damage", xp: 40, active: true, cost: 15 }, ["sopro_gelido"]);
  assert.equal(saved.id, "sopro_gelido_2");
  assert.equal(saved.group, "dano");
  assert.equal("xp" in saved.skill, false);
});
