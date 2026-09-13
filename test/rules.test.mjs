/**
 * Testes das funções PURAS do sistema — as que decidem números de regra e não dependem de nada
 * do Foundry em tempo de execução. É a única verificação automatizada que existe no projeto;
 * tudo que é UI/documento continua sendo teste manual dentro de um mundo aberto.
 *
 *   node --test test/
 *
 * Critério pra entrar aqui: a função tem que ser chamável sem Actor/Item/canvas. Se um teste
 * precisar simular documento do Foundry, o alvo está errado — extraia a parte pura primeiro.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { computeAttributeDicePool, buildAttributeRollFormula } from "../module/dice.js";
import { MEU_SISTEMA, getModuleSizePreset, convertCurrencyAmount, getVitalFormula } from "../module/config.js";
import { computeResistancePercent, computeResistanceName, resistanceMaxLevel } from "../module/skill-effects.js";
import { buildSubSkillsFromSources } from "../module/skill-snapshot.js";

/* -------------------------------------------- */
/*  Pool de dados de Atributo                    */
/* -------------------------------------------- */

test("pool de dados: +1d20 a cada 10 de bônus, resto vira número fixo", () => {
  assert.deepEqual(computeAttributeDicePool(0), { diceCount: 1, flat: 0 });
  assert.deepEqual(computeAttributeDicePool(9), { diceCount: 1, flat: 9 });
  assert.deepEqual(computeAttributeDicePool(10), { diceCount: 2, flat: 0 });
  assert.deepEqual(computeAttributeDicePool(23), { diceCount: 3, flat: 3 });
});

test("pool de dados: bônus negativo ou inválido nunca gera menos de 1d20", () => {
  assert.deepEqual(computeAttributeDicePool(-5), { diceCount: 1, flat: 0 });
  assert.deepEqual(computeAttributeDicePool(NaN), { diceCount: 1, flat: 0 });
  assert.deepEqual(computeAttributeDicePool(undefined), { diceCount: 1, flat: 0 });
});

test("fórmula de rolagem: bônus de item entra como número fixo, por fora do pool", () => {
  assert.equal(buildAttributeRollFormula(0), "1d20");
  assert.equal(buildAttributeRollFormula(3), "1d20+3");
  assert.equal(buildAttributeRollFormula(13), "2d20+3");
  // O pool é `1 + floor(bonus/10)` dados: bônus 10 já são 2d20, bônus 20 são 3d20.
  assert.equal(buildAttributeRollFormula(10), "2d20");
  assert.equal(buildAttributeRollFormula(20), "3d20");
  // O extraFlat (arma/equipamento) soma no fixo mas NUNCA adiciona dados — a regra central
  // de que bônus de equipamento "soma por fora, na hora da rolagem": 20 e 20+5 rolam os
  // MESMOS 3d20, o item só muda o número somado no fim.
  assert.equal(buildAttributeRollFormula(20, 5), "3d20+5");
  assert.equal(buildAttributeRollFormula(13, -3), "2d20");
  assert.equal(buildAttributeRollFormula(10, -4), "2d20-4");
});

/* -------------------------------------------- */
/*  Resistência / Imunidade                      */
/* -------------------------------------------- */

test("resistência: 10% por nível, com teto diferente para Geral e Elemental", () => {
  assert.equal(resistanceMaxLevel("general"), 5);
  assert.equal(resistanceMaxLevel("fire"), 10);

  assert.equal(computeResistancePercent("fire", 3).toFixed(2), "0.30");
  assert.equal(computeResistancePercent("fire", 10).toFixed(2), "1.00");
  // Geral capa em 50% mesmo com nível acima do teto — nunca existe Imunidade Geral.
  assert.equal(computeResistancePercent("general", 9).toFixed(2), "0.50");
  assert.equal(computeResistancePercent("general", 5).toFixed(2), "0.50");
});

test("resistência: nível inválido é tratado como 0, nunca negativo", () => {
  assert.equal(computeResistancePercent("fire", -4), 0);
  assert.equal(computeResistancePercent("fire", undefined), 0);
});

test("resistência: só Elemental vira Imunidade no nome", () => {
  assert.equal(computeResistanceName("general", 5), "Resistência Geral");
  // Sem as settings do Foundry, o rótulo do elemento cai na lista padrão de config.js.
  assert.equal(computeResistanceName("fire", 9), "Resistência: Fogo");
  assert.equal(computeResistanceName("fire", 10), "Imunidade: Fogo");
});

/* -------------------------------------------- */
/*  Presets de Módulo de Nave                    */
/* -------------------------------------------- */

test("preset de Módulo: devolve chaves já no formato system.* e inclui a Vida do Porte", () => {
  const preset = getModuleSizePreset("shield", "standard");
  assert.equal(preset["system.shieldCapacity"], 200);
  assert.equal(preset["system.powerConsumption"], 60);
  assert.equal(preset["system.hp.max"], MEU_SISTEMA.MODULE_HP_BY_SIZE.standard);
  assert.equal(preset["system.hp.value"], preset["system.hp.max"]);
});

test("preset de Módulo: capacidade dobra a cada Porte (curva MODULE_SIZE_MULTIPLIER)", () => {
  const compact = getModuleSizePreset("shield", "compact");
  const colossal = getModuleSizePreset("shield", "colossal");
  assert.equal(colossal["system.shieldCapacity"], compact["system.shieldCapacity"] * 16);
  assert.equal(colossal["system.powerConsumption"], compact["system.powerConsumption"] * 16);
});

test("preset de Módulo: campos de tempo/percentual NÃO seguem a curva de dobrar", () => {
  const compact = getModuleSizePreset("weapon", "compact");
  const colossal = getModuleSizePreset("weapon", "colossal");
  // Recarga dobrando a cada Porte deixaria Arma grande inutilizável — sobe bem mais devagar.
  assert.ok(colossal["system.cooldownRounds"] < compact["system.cooldownRounds"] * 16);
  assert.ok(colossal["system.penetration"] <= 100);
});

test("preset de Módulo: categoria/Porte desconhecido não quebra — só não sugere stat nenhum", () => {
  // Categoria inexistente: sem stats próprios, mas a Vida ainda vem do Porte (ela é igual pra
  // toda categoria, então não depende de MODULE_SIZE_PRESETS).
  assert.deepEqual(getModuleSizePreset("categoria-que-nao-existe", "standard"), {
    "system.hp.max": MEU_SISTEMA.MODULE_HP_BY_SIZE.standard,
    "system.hp.value": MEU_SISTEMA.MODULE_HP_BY_SIZE.standard
  });
  // Porte inexistente: não há nem stats nem Vida a sugerir.
  assert.deepEqual(getModuleSizePreset("shield", "porte-que-nao-existe"), {});
});

/* -------------------------------------------- */
/*  Capacitor: mínimo dos conduítes              */
/* -------------------------------------------- */

test("capacitor: todo Porte tem um mínimo de conduíte (nenhuma Nave fica com reserva zero)", () => {
  for (const size of MEU_SISTEMA.SHIP_SIZES) {
    const conduit = MEU_SISTEMA.CONDUIT_CAPACITOR_BY_SHIP_SIZE[size];
    assert.ok(conduit > 0, `Porte "${size}" ficou sem mínimo de conduíte`);
  }
});

test("capacitor: instalar a MENOR Bateria nunca pode piorar a reserva de nenhum Porte", () => {
  // O Módulo de Bateria SUBSTITUI o mínimo dos conduítes (não soma). Essa invariante é o que
  // impede o absurdo de instalar uma Bateria e a Nave ficar com MENOS reserva do que tinha —
  // por isso toda a tabela de conduíte tem que caber abaixo da menor Bateria instalável.
  const smallestBattery = getModuleSizePreset("battery", MEU_SISTEMA.MODULE_SIZES[0])["system.batteryCapacity"];
  for (const size of MEU_SISTEMA.SHIP_SIZES) {
    assert.ok(
      MEU_SISTEMA.CONDUIT_CAPACITOR_BY_SHIP_SIZE[size] <= smallestBattery,
      `Porte "${size}": conduíte (${MEU_SISTEMA.CONDUIT_CAPACITOR_BY_SHIP_SIZE[size]}) passou da menor Bateria (${smallestBattery})`
    );
  }
});

/* -------------------------------------------- */
/*  Conversão de moeda                           */
/* -------------------------------------------- */

test("conversão de moeda: usa a razão de Valor-Base das duas moedas", () => {
  // Sem settings, cai nas moedas padrão: ouro=100, prata=10, cobre=1.
  assert.equal(convertCurrencyAmount("gold", "silver", 1), 10);
  assert.equal(convertCurrencyAmount("silver", "gold", 10), 1);
  assert.equal(convertCurrencyAmount("gold", "copper", 2), 200);
  // Conversão que não fecha em inteiro devolve fração — quem trata o resto é a cascata
  // de applyWholeCurrencyAmount (currency.js), não esta função.
  assert.equal(convertCurrencyAmount("silver", "gold", 5), 0.5);
});

test("conversão de moeda: moeda desconhecida devolve 0 em vez de NaN", () => {
  assert.equal(convertCurrencyAmount("gold", "moeda-inexistente", 5), 0);
  assert.equal(convertCurrencyAmount("moeda-inexistente", "gold", 5), 0);
});

/* -------------------------------------------- */
/*  Fórmula de HP/Mana configurável              */
/* -------------------------------------------- */

test("fórmula vital: sem settings registradas, cai exatamente no comportamento histórico", () => {
  const formula = getVitalFormula();
  assert.deepEqual(formula.hp, ["strength", "defense"]);
  assert.deepEqual(formula.energy, ["magic", "magicalDefense"]);
  assert.equal(formula.multiplier, 10);
  assert.equal(formula.floor, MEU_SISTEMA.MIN_BASE_VITAL_STAT);
  assert.equal(formula.energyEnabled, true);
});

/* -------------------------------------------- */
/*  Snapshot de Sub-Skill (fusão)                */
/* -------------------------------------------- */

function fakeSkill(name, system = {}) {
  return { name, system: { tier: "normal", level: 1, cost: 0, effects: [], damageElements: [], ...system } };
}

test("snapshot de fusão: cada fonte vira uma Sub-Skill com a mecânica congelada", () => {
  const subs = buildSubSkillsFromSources([
    fakeSkill("Corte", { effectType: "damage", damageFormula: "2d6" }),
    fakeSkill("Escudo", { effectType: "temporary" })
  ]);
  assert.equal(subs.length, 2);
  assert.equal(subs[0].name, "Corte");
  assert.equal(subs[0].damageFormula, "2d6");
  assert.equal(subs[1].effectType, "temporary");
});

test("snapshot de fusão: fonte que já era fusão entra ACHATADA (nunca aninha)", () => {
  const alreadyFused = fakeSkill("Fusão Antiga", {
    subSkills: [{ name: "Parte A" }, { name: "Parte B" }]
  });
  const subs = buildSubSkillsFromSources([alreadyFused, fakeSkill("Nova")]);
  assert.deepEqual(subs.map(s => s.name), ["Parte A", "Parte B", "Nova"]);
});

test("snapshot de fusão: é cópia, não referência — editar a Sub-Skill não mexe na origem", () => {
  const source = fakeSkill("Corte", { effects: [{ target: "hp", amount: -5 }] });
  const [snapshot] = buildSubSkillsFromSources([source]);
  snapshot.effects[0].amount = 999;
  assert.equal(source.system.effects[0].amount, -5);
});
