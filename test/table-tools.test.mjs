/**
 * Ferramentas da mesa: ficha do jogador enxuta (K3), Regras desta mesa (L6) e os blocos de
 * Módulos do Sistema (K4/K2). Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { sheetTrim, allZero, shownSkillTiers, TRIM_BLOCKS } from "../module/sheets/sheet-trim-rules.js";
import { conditionSentence, buildTableRulesPages } from "../module/core/table-rules-text.js";
import { MEU_SISTEMA } from "../module/core/config.js";

test("Ficha enxuta: jogador não vê bloco vazio, Mestre vê marcado, 'mostrar' abre tudo", () => {
  const empty = { titles: true, skillPoints: true, gear: false, economy: true, anatomy: false };
  const player = sheetTrim({ isGM: false, empty });
  assert.equal(player.titles.hide, true);
  assert.equal(player.gear.hide, false);
  assert.equal(player.hiddenCount, 3);
  assert.equal(player.titles.gmEmpty, false);
  const gm = sheetTrim({ isGM: true, empty });
  assert.equal(gm.hiddenCount, 0);
  assert.equal(gm.titles.gmEmpty, true);
  assert.equal(gm.gear.gmEmpty, false);
  const shown = sheetTrim({ isGM: false, showAll: true, empty });
  assert.equal(shown.hiddenCount, 0);
  assert.equal(shown.showAll, true);
  assert.equal(shown.emptyCount, 3);
  assert.deepEqual(TRIM_BLOCKS, ["titles", "skillPoints", "gear", "economy", "anatomy"]);
  assert.equal(allZero({ a: 0, b: 0 }), true);
  assert.equal(allZero({ a: 0, b: 2 }), false);
  assert.equal(allZero(undefined), true);
});

test("Ficha enxuta: faixas de Tier vazias somem só para o jogador", () => {
  const tiers = ["extra", "normal", "racial", "unique"];
  const counts = { normal: 2, racial: 0 };
  assert.deepEqual(shownSkillTiers(tiers, counts), ["normal"]);
  assert.deepEqual(shownSkillTiers(tiers, counts, { isGM: true }), tiers);
  assert.deepEqual(shownSkillTiers(tiers, counts, { showAll: true }), tiers);
  assert.deepEqual(shownSkillTiers(tiers, {}), []);
});

test("Regras desta mesa: frase de cada Condição", () => {
  const label = k => ({ strength: "Força" })[k] ?? k;
  assert.equal(conditionSentence({ effect: { kind: "tick", tickTarget: "hp", tickSign: "damage" } }), "perde Vida no início do turno");
  assert.equal(conditionSentence({ effect: { kind: "tick", tickTarget: "energy", tickSign: "heal" } }, { energyLabel: "Fluxo" }), "ganha Fluxo no início do turno");
  assert.equal(conditionSentence({ effect: { kind: "modifier", modTarget: "movement", value: -50 } }), "Deslocamento −50%");
  assert.equal(conditionSentence({ effect: { kind: "modifier", modTarget: "strength", value: -3 } }, { attributeLabel: label }), "Força −3");
  assert.equal(conditionSentence({ incapacitates: true }), "não age nem se move");
  assert.equal(conditionSentence({}), "o Mestre decide o que ela impede");
  assert.equal(conditionSentence({ curse: { enabled: true } }, { energyLabel: "Fluxo" }), "uma maldição: cobra Fluxo todo turno");
  assert.equal(conditionSentence({ antimagicLevel: 3 }, { energyLabel: "Fluxo" }), "magia custa Fluxo extra");
  assert.equal(conditionSentence({ suppressesMagic: true }), "a magia dele para de funcionar");
  assert.equal(conditionSentence({ healBlock: { kinds: "regen" } }), "não regenera");
  assert.equal(conditionSentence({ healBlock: { kinds: "all" } }), "não pode ser curado");
  assert.equal(conditionSentence({ blocksRegeneration: true }), "não regenera");
});

test("Regras desta mesa: páginas só com o que vale, texto escapado", () => {
  const base = {
    date: "01/11/2026",
    systemVersion: "1.83.0",
    energyLabel: "Mana",
    attributes: ["Força", "Destreza"],
    vital: { hp: ["Força", "Defesa"], energy: ["Magia", "Defesa Mágica"], multiplier: 10, floor: 50, energyEnabled: true },
    xpFormula: "100 * nível",
    attributePool: true,
    pointsStart: 35,
    pointsPerLevel: 5,
    skills: { powerPerLevel: 10, discountPerLevel: 20, cyclePower: 4, cycleDiscount: 1, costFloor: 10 },
    initiative: "Destreza",
    movement: null,
    incapacitation: { deathRounds: 3, wakeRounds: 3, npcDies: true },
    features: { statusConditions: true, skillPoints: true, resistances: true, areaEffects: false, skillUseXp: false, skillFusion: false },
    conditions: [{ label: "Veneno <b>", sentence: "perde Vida no início do turno" }],
    elements: [{ label: "Físico", parent: "" }, { label: "Cortante", parent: "Físico" }],
    disabled: ["Naves e Veículos", "PAD"]
  };
  const pages = buildTableRulesPages(base);
  assert.deepEqual(pages.map(p => p.key), ["basics", "skills", "combat", "conditions", "elements", "off"]);
  const all = pages.map(p => p.html).join("\n");
  assert.match(all, /Força × Defesa × 10/);
  assert.match(all, /3 rodadas/);
  assert.match(all, /Veneno &lt;b&gt;/);
  assert.match(all, /Naves e Veículos · PAD/);
  assert.doesNotMatch(all, /Deslocamento por rodada/);
  // Campanha sem Mana nem Condições.
  const noMagic = buildTableRulesPages({ ...base, vital: { ...base.vital, energyEnabled: false }, features: { ...base.features, statusConditions: false }, disabled: [] });
  assert.equal(noMagic.some(p => p.key === "conditions"), false);
  assert.match(noMagic[0].html, /não usa Mana/);
  assert.match(noMagic.at(-1).html, /Nada: o sistema inteiro está ligado/);
});

test("Módulos do Sistema: todo bloco tem grupo e frase; 'Deixar leve' só desliga os pesados", () => {
  const groups = new Set(MEU_SISTEMA.FEATURE_GROUPS.map(g => g.id));
  for (const [key, f] of Object.entries(MEU_SISTEMA.FEATURES)) {
    assert.ok(f.short, `${key} sem frase curta`);
    assert.ok(groups.has(f.group), `${key} sem grupo válido`);
    assert.ok(f.short.length <= 90, `${key}: frase longa demais`);
  }
  const light = MEU_SISTEMA.CAMPAIGN_PRESETS.leve;
  assert.ok(light.light);
  assert.equal(light.content, undefined);
  assert.ok(Object.values(light.features).every(v => v === false));
  assert.deepEqual(Object.keys(light.features).sort(), Object.entries(MEU_SISTEMA.FEATURES).filter(([, f]) => f.heavy).map(([k]) => k).sort());
  assert.equal(Object.keys(light.features).length, 7);
});
