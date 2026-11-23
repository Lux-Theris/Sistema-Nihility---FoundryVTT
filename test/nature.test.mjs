/**
 * Natureza das coisas (Mágico / Tecnológico), PEM e o espelho da Antimagia.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { SYSTEM_ID, isMagicUse, isTechUse, useNature, technomagicFactor, NIHILITY } from "../module/core/config.js";
import {
  skillIsMagic,
  skillIsTech,
  itemIsTech,
  itemNature,
  dispelledEffects,
  protectedFromKind
} from "../module/core/magic-rules.js";
import { sourceSuppressed, suppressionState, TECH_SUPPRESSION_FLAG } from "../module/core/suppression.js";
import { buildGrantedSkillData } from "../module/skills/skill-snapshot.js";
import { bodyFunctionState, partDisabled } from "../module/species/anatomy-rules.js";
import { suggestSkillCost } from "../module/skills/skill-cost-rules.js";

const char = { type: "character" };
const ship = { type: "starship" };

test("Natureza: as caixas mandam; sem elas vale a marca antiga e o automático", () => {
  // Caixa explícita vence tudo.
  assert.equal(isMagicUse({ cost: 10, isMagic: false }, char), false);
  assert.equal(isMagicUse({ cost: 0, isMagic: true }, char), true);
  // Sem caixa (null): a marca antiga, depois o automático de sempre.
  assert.equal(isMagicUse({ cost: 10, isMagic: null, magicTag: "mundane" }, char), false);
  assert.equal(isMagicUse({ cost: 0, magicTag: "magic" }, char), true);
  assert.equal(isMagicUse({ cost: 10 }, char), true);
  assert.equal(isMagicUse({ cost: 10 }, ship), false);
  // Tecnológico: só a caixa, ou Nave/Veículo por natureza.
  assert.equal(isTechUse({ cost: 10 }, char), false);
  assert.equal(isTechUse({ isTech: true }, char), true);
  assert.equal(isTechUse({}, ship), true);
  assert.equal(isTechUse({ isTech: false }, ship), false);
  assert.deepEqual(useNature({ cost: 5, isTech: true }, char), { magic: true, tech: true }); // tecnomágico
  assert.deepEqual(useNature({ cost: 0, isTech: true }, char), { magic: false, tech: true }); // tecnológico puro: ignora a densidade de mana
  assert.deepEqual(useNature({ cost: 0 }, char), { magic: false, tech: false }); // analógico
});

test("Natureza: Skill, Item e implante", () => {
  assert.equal(skillIsMagic({ isMagic: false, tier: "normal" }), false);
  assert.equal(skillIsMagic({ tier: "normal" }), true); // automático: Skill não Racial é mágica
  assert.equal(skillIsTech({}), false);
  assert.equal(skillIsTech({ isTech: true }), true);
  assert.equal(skillIsTech({}, ship), true);
  // Implante, prótese e aparelho do PAD já são tecnológicos; a caixa explícita ganha.
  assert.equal(itemIsTech({ implant: { enabled: true } }), true);
  assert.equal(itemIsTech({ isPadDevice: true }), true);
  assert.equal(itemIsTech({ implant: { enabled: true }, tech: false }), false);
  assert.equal(itemIsTech({}), false);
  assert.deepEqual(itemNature({ magic: true, tech: true }), { magic: true, tech: true });
});

test("Tecnomágico sai mais forte (Regras da Mesa), o resto não muda", () => {
  assert.equal(technomagicFactor(true, true, 2), 2);
  assert.equal(technomagicFactor(true, false, 2), 1);
  assert.equal(technomagicFactor(false, true, 2), 1);
  assert.equal(technomagicFactor(true, true, 0.3), 1); // nunca abaixo de 1
  assert.equal(technomagicFactor(true, true), 2); // padrão ×2
  const base = suggestSkillCost({ effectType: "damage", damageFormula: "4d6" });
  const tm = suggestSkillCost({ effectType: "damage", damageFormula: "4d6" }, { technomagicFactor: 2 });
  assert.ok(tm.cost > base.cost);
  assert.ok(tm.rows.some(r => /Tecnomágico/.test(r.label)));
});

test("PEM: corta só o que é tecnológico, de nível ≤ o alcance", () => {
  const effects = [
    { id: "a", level: 2, magic: true },
    { id: "b", level: 2, tech: true },
    { id: "c", level: 2, magic: true, tech: true },
    { id: "d", level: 9, tech: true },
    { id: "e", level: 1 }
  ];
  assert.deepEqual(dispelledEffects(effects, 5, "tech"), ["b", "c"]); // tecnomágico cai nos dois
  assert.deepEqual(dispelledEffects(effects, 5, "magic"), ["a", "c"]);
  assert.deepEqual(dispelledEffects(effects, 5), ["a", "c"]); // padrão = Antimagia
});

test("Camada do tipo oposto protege; tecnomágica não protege", () => {
  // PEM (kind "tech") é segurado por Escudo só mágico; Antimagia por Escudo só tecnológico.
  assert.equal(protectedFromKind({ kind: "tech", shieldKinds: [{ magic: true, value: 10 }] }), true);
  assert.equal(protectedFromKind({ kind: "magic", shieldKinds: [{ magic: true, value: 10 }] }), false);
  assert.equal(protectedFromKind({ kind: "magic", shieldKinds: [{ tech: true, value: 10 }] }), true);
  // Camada esgotada, do mesmo tipo ou tecnomágica não protege.
  assert.equal(protectedFromKind({ kind: "tech", shieldKinds: [{ magic: true, value: 0 }] }), false);
  assert.equal(protectedFromKind({ kind: "tech", shieldKinds: [{ tech: true, value: 10 }] }), false);
  assert.equal(protectedFromKind({ kind: "tech", shieldKinds: [{ magic: true, tech: true, value: 10 }] }), false);
  // Estrutura no caminho ou em volta.
  assert.equal(protectedFromKind({ kind: "tech", structureKinds: [{ magic: true }] }), true);
  assert.equal(protectedFromKind({ kind: "magic", structureKinds: [{ magic: true }] }), false);
  assert.equal(protectedFromKind({ kind: "magic", structureKinds: [{ tech: true, magic: true }] }), false);
  assert.equal(protectedFromKind({}), false);
});

test("Supressão tecnológica segura item, implante, prótese e Skill tecnológicos", () => {
  const actorWith = flags => ({ effects: [{ disabled: false, flags: { [SYSTEM_ID]: flags } }] });
  const tech = actorWith({ [TECH_SUPPRESSION_FLAG]: 3 });
  const state = suppressionState(tech);
  assert.deepEqual(state, { magic: null, tech: 3 });
  const padItem = { type: "item", system: { isPadDevice: true } };
  const plainItem = { type: "item", system: {} };
  const magicItem = { type: "item", system: { magic: true } };
  assert.equal(sourceSuppressed(tech, padItem, null, state), true); // aparelho do PAD é tecnológico
  assert.equal(sourceSuppressed(tech, plainItem, null, state), false); // analógico: imune
  assert.equal(sourceSuppressed(tech, magicItem, null, state), false); // PEM não pega o só mágico
  assert.equal(sourceSuppressed(tech, null, { tech: true }, state), true); // prótese/implante
  assert.equal(sourceSuppressed(tech, null, { magic: true }, state), false);
  assert.equal(sourceSuppressed(tech, { type: "skill", system: { isTech: true, isMagic: false, level: 2 } }, null, state), true);
  assert.equal(sourceSuppressed(tech, { type: "skill", system: { isTech: true, isMagic: false, level: 5 } }, null, state), false); // nível maior resiste... (5 > 3)
  // A Antimagia continua igual, e chamada antiga (número) ainda funciona.
  const magic = actorWith({ suppression: 4 });
  assert.equal(sourceSuppressed(magic, magicItem, null, 4), true);
  assert.equal(sourceSuppressed(magic, padItem, null, suppressionState(magic)), false);
  // Tecnomágico sofre os dois.
  const both = { type: "item", system: { magic: true, tech: true } };
  assert.equal(sourceSuppressed(tech, both, null, state), true);
  assert.equal(sourceSuppressed(magic, both, null, suppressionState(magic)), true);
});

test("Prótese suprimida perde a Função: o Deslocamento cai pela Anatomia", () => {
  const legs = [
    { id: "l1", slot: "leg", hpValue: 10, hpMax: 10, functions: ["locomocao"], isProsthetic: true, mods: [{ kind: "prosthesis", functions: ["locomocao"], suppressed: true }] },
    { id: "l2", slot: "leg", hpValue: 10, hpMax: 10, functions: ["locomocao"], isProsthetic: false, mods: [] }
  ];
  const catalog = [{ id: "locomocao", count: "proportional", effect: { kind: "movement" } }];
  assert.equal(partDisabled(legs[0]), true);
  assert.equal(partDisabled(legs[1]), false);
  const state = bodyFunctionState(legs, catalog);
  assert.equal(state.movement.factor, 0.5);
  // Sem a supressão, as duas pernas andam.
  legs[0].mods[0].suppressed = false;
  assert.equal(bodyFunctionState(legs, catalog).movement.factor, 1);
  // Prótese de Herança (parte protética sem Item instalado): vale a supressão da própria parte.
  const heritageLeg = { id: "l3", slot: "leg", hpValue: 10, hpMax: 10, functions: ["locomocao"], isProsthetic: true, mods: [], prostheticSuppressed: true };
  assert.equal(partDisabled(heritageLeg), true);
  assert.equal(partDisabled({ ...heritageLeg, prostheticSuppressed: false }), false);
});

test("Habilidade Concedida herda a natureza da fonte, sem passar por cima do molde", () => {
  const tiers = NIHILITY.ITEM_GRANTABLE_SKILL_TIERS;
  const fromModule = buildGrantedSkillData({ name: "Salva", tier: "normal" }, tiers, { tech: true });
  assert.equal(fromModule.system.isTech, true);
  assert.equal(fromModule.system.isMagic, undefined);
  const fromMagicItem = buildGrantedSkillData({ name: "Brilho" }, tiers, { magic: true, tech: false });
  assert.equal(fromMagicItem.system.isMagic, true);
  assert.equal(fromMagicItem.system.isTech, undefined);
  // O molde que já escolheu não é sobrescrito.
  const explicit = buildGrantedSkillData({ name: "Analógica", isTech: false, isMagic: false }, tiers, { magic: true, tech: true });
  assert.equal(explicit.system.isTech, false);
  assert.equal(explicit.system.isMagic, false);
  assert.equal(buildGrantedSkillData({ name: "Sem fonte" }, tiers).system.isTech, undefined);
});

test("PEM e Interferência: bloco, alvo, Condições e Estrutura padrão", () => {
  assert.ok(NIHILITY.EFFECT_TARGETS.includes("emp"));
  assert.ok(NIHILITY.EFFECT_TARGET_GROUPS.some(g => g.label === "Tecnologia" && g.targets.includes("emp")));
  assert.ok(NIHILITY.DEFAULT_STATUS_CONDITIONS.some(c => c.suppressesTech));
  assert.ok(NIHILITY.DEFAULT_STATUS_CONDITIONS.some(c => c.interferenceLevel > 0));
  const field = NIHILITY.DEFAULT_STRUCTURES.find(s => s.interferenceLevel > 0);
  assert.ok(field);
  assert.equal(field.shape, "circle");
  assert.equal(field.material, "ethereal");
  assert.equal(NIHILITY.FEATURES.interference.default, false);
});
