import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { skillUseMode } from "../module/skills/skill-use-mode.js";

const area = { areaEnabled: true, areaSupported: true };

test("Usar Skill: Ativa ligada só desliga, mesmo se for Estrutura ou dano", () => {
  assert.equal(skillUseMode({ hasUpkeep: true, active: true, effectType: "damage" }, area), "deactivate");
  assert.equal(skillUseMode({ hasUpkeep: true, active: true, effectType: "structure", structureId: "muro" }, area), "deactivate");
  // Ativa desligada segue o fluxo normal.
  assert.equal(skillUseMode({ hasUpkeep: true, active: false, effectType: "damage" }, area), "targeted");
});

test("Usar Skill: Estrutura (mecânica nova e o targetType antigo)", () => {
  assert.equal(skillUseMode({ effectType: "structure", structureId: "muro" }, area), "structure");
  assert.equal(skillUseMode({ effectType: "temporary", targetType: "structure" }, area), "structure");
});

test("Usar Skill: Descritiva não pede alvo", () => {
  assert.equal(skillUseMode({ effectType: "none" }, area), "plain");
  assert.equal(skillUseMode({ effectType: "" }, area), "plain");
  assert.equal(skillUseMode(null, area), "plain");
});

test("Usar Skill: Zona e Emissão dependem do bloco de área e do mapa", () => {
  assert.equal(skillUseMode({ effectType: "damage", targetType: "zone" }, area), "zone");
  assert.equal(skillUseMode({ effectType: "damage", targetType: "emission" }, area), "emission");
  // Sem mapa: Emissão avisa; Zona cai no alvo único.
  const noCanvas = { areaEnabled: true, areaSupported: false };
  assert.equal(skillUseMode({ effectType: "damage", targetType: "emission" }, noCanvas), "emissionNoCanvas");
  assert.equal(skillUseMode({ effectType: "damage", targetType: "zone" }, noCanvas), "targeted");
  // Bloco de área desligado: as duas viram alvo único (a mecânica continua valendo).
  const off = { areaEnabled: false, areaSupported: true };
  assert.equal(skillUseMode({ effectType: "damage", targetType: "emission" }, off), "targeted");
  assert.equal(skillUseMode({ effectType: "temporary", targetType: "zone" }, off), "targeted");
});

test("Usar Skill: si mesmo e alvo único (a ficha de Nave agora pede alvo no temporário)", () => {
  assert.equal(skillUseMode({ effectType: "temporary", targetType: "self" }, area), "self");
  assert.equal(skillUseMode({ effectType: "temporary", targetType: "targeted" }, area), "targeted");
  assert.equal(skillUseMode({ effectType: "damage" }, area), "targeted");
});
