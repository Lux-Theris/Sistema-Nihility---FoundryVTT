/**
 * Ambiente da cena, densidade de mana e Radiação.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeHazard,
  normalizeDensity,
  desiredEnvironmentConditions,
  environmentDiff,
  resolveManaDensity,
  wantedSceneFx,
  sceneFxPlan,
  fxPresetLabel
} from "../module/environment/environment-rules.js";
import {
  normalizeRadiationSource,
  emitterExposure,
  totalExposure,
  radiationStep,
  radiationDamage,
  simulateRadiation
} from "../module/environment/radiation-rules.js";

test("Ambiente: quem recebe cada perigo, e o que muda ao entrar e sair", () => {
  assert.equal(normalizeHazard({ conditionId: "" }), null);
  assert.deepEqual(normalizeHazard({ conditionId: "vacuum", immuneTraits: ["breathless", "breathless", ""] }), { conditionId: "vacuum", immuneTraits: ["breathless"], fx: "", fxParticle: "", fxFilter: "", fxColor: "" });
  const sources = [
    { hazards: [{ conditionId: "vacuum", immuneTraits: ["breathless"] }, { conditionId: "heavy-gravity" }] },
    { hazards: [{ conditionId: "radiation" }] }
  ];
  assert.deepEqual([...desiredEnvironmentConditions(sources, [])].sort(), ["heavy-gravity", "radiation", "vacuum"]);
  assert.deepEqual([...desiredEnvironmentConditions(sources, ["breathless"])].sort(), ["heavy-gravity", "radiation"], "Traço imune escapa do vácuo");
  const diff = environmentDiff(new Set(["vacuum", "poison"]), [{ id: "e1", conditionId: "vacuum" }, { id: "e2", conditionId: "radiation" }], new Set(["poison"]));
  assert.deepEqual(diff, { add: [], remove: ["e2"] }, "saiu da radiação; Veneno de outra fonte não é duplicado");
  assert.deepEqual(environmentDiff(new Set(["vacuum"]), [], new Set()).add, ["vacuum"]);
});

test("Ambiente: visual do FXMaster — o que ligar, o que desligar, o que fica", () => {
  assert.equal(normalizeHazard({ conditionId: "x", fxColor: "verde" }).fxColor, "", "cor inválida vira sem cor");
  assert.equal(normalizeHazard({ conditionId: "x", fxColor: "#33FF66" }).fxColor, "#33ff66");
  const wanted = wantedSceneFx([
    { conditionId: "radiation", fxParticle: "embers", fxFilter: "color", fxColor: "#33ff66" },
    { conditionId: "toxic", fxParticle: "embers", fxFilter: "color", fxColor: "#33ff66" },
    { conditionId: "cold", fx: "blizzard" },
    { conditionId: "none" }
  ]);
  assert.deepEqual(wanted.presets, ["blizzard"]);
  assert.equal(wanted.customs.length, 1, "a mesma combinação toca uma vez só");
  const plan = sceneFxPlan(["fog", { key: "embers|color|#33ff66", ids: { particles: ["p1"], filters: ["f1"] } }, { key: "stars||", ids: { particles: ["p2"], filters: [] } }], wanted);
  assert.deepEqual(plan.stopPresets, ["fog"], "preset antigo (formato string) que saiu é desligado");
  assert.deepEqual(plan.playPresets, ["blizzard"]);
  assert.deepEqual(plan.stopCustoms.map(c => c.key), ["stars||"]);
  assert.deepEqual(plan.playCustoms, [], "a combinação que continua não toca de novo");
  assert.deepEqual(plan.keep.map(k => k.key ?? k.preset), ["embers|color|#33ff66"]);
  assert.equal(fxPresetLabel("acid-rain"), "Chuva ácida");
  assert.equal(fxPresetLabel("weird-new-thing"), "Weird new thing");
});

test("Densidade de mana: área manda (a menor), depois a cena, depois o mundo", () => {
  assert.equal(normalizeDensity(""), null);
  assert.equal(normalizeDensity(-1), null);
  assert.equal(normalizeDensity("0"), 0);
  assert.equal(resolveManaDensity({ worldDefault: 1 }), 1);
  assert.equal(resolveManaDensity({ worldDefault: 1, scene: 0.5 }), 0.5);
  assert.equal(resolveManaDensity({ worldDefault: 1, scene: 0.5, areas: [2] }), 2, "nexo arcano numa cena pobre");
  assert.equal(resolveManaDensity({ worldDefault: 1, scene: 2, areas: [3, 0] }), 0, "zona morta dentro do nexo continua morta");
  assert.equal(resolveManaDensity({ worldDefault: 1, areas: [null] }), 1, "área sem densidade não muda nada");
});

test("Radiação: fonte enfraquece com a distância e as fontes somam", () => {
  assert.equal(normalizeRadiationSource({ level: 0, radius: 5 }), null);
  assert.deepEqual(normalizeRadiationSource({ level: 50, radius: -1 }), { level: 50, radius: 0 });
  assert.equal(emitterExposure(100, 0, 10), 100, "colado no barril = nível cheio");
  assert.equal(emitterExposure(100, 5, 10), 50, "meio do raio = metade");
  assert.equal(emitterExposure(100, 10, 10), 0, "na borda = nada");
  assert.equal(emitterExposure(100, 0, 0), 100, "raio 0 = só em cima");
  assert.equal(totalExposure({ scene: 5, areas: [10], emitters: [{ level: 100, distance: 5, radius: 10 }, { level: 20, distance: 20, radius: 10 }] }), 65);
});

test("Radiação: sobe rápido numa fonte forte, para no teto, cai fora e o dano acompanha", () => {
  const cfg = { gainPercent: 20, decayPercent: 10 };
  assert.equal(radiationStep(0, 100, cfg), 20, "fonte 100 irradia 20 por rodada");
  assert.equal(radiationStep(0, 5, cfg), 1, "fonte fraca sobe pelo menos 1");
  assert.equal(radiationStep(90, 100, cfg), 100, "não passa do teto");
  assert.equal(radiationStep(100, 100, cfg), 100);
  assert.equal(radiationStep(100, 0, cfg), 90, "fora cai 10% da irradiação");
  assert.equal(radiationStep(3, 0, cfg), 2, "cai pelo menos 1");
  assert.equal(radiationStep(100, 60, cfg), 90, "lugar mais fraco: cai até o nível dele");
  assert.equal(radiationStep(62, 60, cfg), 60);
  assert.equal(radiationDamage(2000, 1), 2000, "irradiação alta = milhares de dano");
  assert.equal(radiationDamage(10, 2.5), 25);
  const inside = simulateRadiation(0, 100, 3, { ...cfg, perLevel: 1 });
  assert.deepEqual(inside, { level: 60, damage: 20 + 40 + 60 });
  const outside = simulateRadiation(5, 0, 50, { ...cfg, perLevel: 1 });
  assert.equal(outside.level, 0);
  assert.equal(outside.damage, 4 + 3 + 2 + 1, "fora: o dano vai diminuindo até zerar");
});
