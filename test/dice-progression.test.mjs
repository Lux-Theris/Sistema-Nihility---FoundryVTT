/**
 * Pool de dados, Resistência, curvas de nível/XP/escala, modificadores de rolagem, Mana variável e XP por uso.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { computeAttributeDicePool, buildAttributeRollFormula } from "../module/core/dice.js";
import {
  MEU_SISTEMA,
  getVitalFormula,
  skillLevelBonuses,
  effectiveSkillCost,
  damageScalingMultiplier,
  getXpForNextLevel,
  resistanceXpGain,
  manaInvestmentPower
} from "../module/core/config.js";
import { computeResistancePercent, computeResistanceName, resistanceMaxLevel } from "../module/combat/resistance.js";
import {
  normalizeRollOptions,
  isNeutralRollOptions,
  applyAdvantageToFormula,
  buildModifiedFormula,
  applyRollModifiers,
  describeRollOptions
} from "../module/core/roll-modifiers.js";
import { measureFraction, skillUseXp, effectEntryMeasures } from "../module/skills/skill-xp-rules.js";

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
/*  Ciclo de nível de Skill                      */
/* -------------------------------------------- */

test("ciclo de nível: nível 1 não tem bônus nenhum", () => {
  const b = skillLevelBonuses(1);
  assert.equal(b.power, 1);
  assert.equal(b.cost, 1);
});

test("ciclo de nível: 2 de Poder, depois 2 de Desconto (padrão)", () => {
  // nv 2 e 3 = Poder; nv 4 e 5 = Desconto.
  assert.equal(skillLevelBonuses(3).power.toFixed(2), "1.21");   // 1.10^2
  assert.equal(skillLevelBonuses(3).cost.toFixed(2), "1.00");    // desconto ainda não começou
  assert.equal(skillLevelBonuses(5).power.toFixed(2), "1.21");   // poder parado durante o desconto
  assert.equal(skillLevelBonuses(5).cost.toFixed(2), "0.64");    // 0.80^2
});

test("ciclo de nível: desconto é multiplicativo, nunca subtrativo", () => {
  // Subtrativo levaria o custo ao piso em 5 níveis e mataria o resto da curva.
  // Multiplicativo, o nível 20 ainda está acima do piso.
  assert.ok(skillLevelBonuses(20).cost > 0.10);
  assert.ok(skillLevelBonuses(20).cost < 0.20);
});

test("ciclo de nível: o Custo nunca fura o piso de 10%", () => {
  for (const nv of [24, 30, 50, 200]) {
    assert.ok(skillLevelBonuses(nv).cost >= 0.10 - 1e-9, `nível ${nv} furou o piso`);
  }
});

test("ciclo de nível: com o custo no piso, nível de Desconto vira Poder (nenhum nível morto)", () => {
  // Sem a conversão, o poder ficaria parado entre dois níveis de desconto pós-piso.
  const antes = skillLevelBonuses(40).power;
  const depois = skillLevelBonuses(41).power;
  assert.ok(depois > antes, "nível pós-piso não entregou nada — a conversão não está valendo");
});

test("custo efetivo: aplica o desconto do nível e nunca deixa a Skill de graça", () => {
  assert.equal(effectiveSkillCost(40, 1), 40);
  assert.equal(effectiveSkillCost(40, 5), 26);   // 40 × 0.64
  assert.equal(effectiveSkillCost(0, 30), 0);    // custo 0 continua 0
  assert.equal(effectiveSkillCost(1, 50), 1);    // arredondamento nunca zera um custo real
});

/* -------------------------------------------- */
/*  Escala de dano por Atributo                  */
/* -------------------------------------------- */

function fakeActor(attr, total) {
  return { system: { attributes: { combat: { [attr]: { total } } } } };
}

test("escala de dano: sem Atributo de Escala o dano é exatamente a fórmula", () => {
  // É o que mantém intacta toda Skill criada antes da regra existir.
  assert.equal(damageScalingMultiplier(fakeActor("strength", 30), ""), 1);
  assert.equal(damageScalingMultiplier(fakeActor("strength", 30), "atributo-inexistente"), 1);
});

test("escala de dano: é quadrática — é o que acompanha a curva de HP", () => {
  // HP = Atributo × Atributo × mult, então dobrar o atributo tem que quadruplicar o dano;
  // qualquer escala linear seria engolida pela curva de HP conforme o nível sobe.
  const dobro = damageScalingMultiplier(fakeActor("strength", 40), "strength");
  const metade = damageScalingMultiplier(fakeActor("strength", 20), "strength");
  assert.equal(dobro / metade, 4);
});

test("escala de dano: atributo zerado não zera o dano", () => {
  assert.equal(damageScalingMultiplier(fakeActor("strength", 0), "strength"), 1);
});

/* -------------------------------------------- */
/*  XP de Resistência (aprender apanhando)       */
/* -------------------------------------------- */

test("XP de Resistência: é a FRAÇÃO da Vida salva, não o dano bruto", () => {
  // O ponto da regra: defender um golpe igualmente perigoso rende o mesmo XP em qualquer
  // nível. Se fosse proporcional ao dano bruto, o nível alto ganharia XP muito mais rápido,
  // porque o dano deste sistema cresce com o quadrado do atributo.
  const cedo = resistanceXpGain(480, 4840);      // ~10% da Vida no nível 3
  const tarde = resistanceXpGain(8100, 81000);   // ~10% da Vida no nível 30
  assert.equal(cedo, tarde);
  assert.equal(cedo, 10);
});

test("XP de Resistência: arranhão não ensina nada", () => {
  assert.equal(resistanceXpGain(80, 81000), 0);
});

test("XP de Resistência: entrada inválida devolve 0 em vez de NaN/Infinity", () => {
  assert.equal(resistanceXpGain(0, 1000), 0);
  assert.equal(resistanceXpGain(100, 0), 0);
  assert.equal(resistanceXpGain(-50, 1000), 0);
});

/* -------------------------------------------- */
/*  Curva de XP                                  */
/* -------------------------------------------- */

test("XP: sem setting registrada, cai no padrão 100 × nível", () => {
  assert.equal(getXpForNextLevel(1), 100);
  assert.equal(getXpForNextLevel(10), 1000);
  assert.equal(getXpForNextLevel(0), 100);    // nível inválido é tratado como 1
});

/* -------------------------------------------- */
/*  Modificadores de rolagem (shift+clique)      */
/* -------------------------------------------- */

test("rolagem: vantagem rola o pool inteiro duas vezes e fica com o maior", () => {
  assert.equal(applyAdvantageToFormula("2d20+5", "advantage"), "{2d20+5, 2d20+5}kh");
  assert.equal(applyAdvantageToFormula("2d20+5", "disadvantage"), "{2d20+5, 2d20+5}kl");
  assert.equal(applyAdvantageToFormula("2d20+5", "normal"), "2d20+5");
});

test("rolagem: operações valem na ordem em que foram escritas", () => {
  const plusThenTimes = { modifiers: [{ op: "add", value: 5 }, { op: "mul", value: 2 }] };
  const timesThenPlus = { modifiers: [{ op: "mul", value: 2 }, { op: "add", value: 5 }] };
  assert.equal(applyRollModifiers(10, plusThenTimes), 30);
  assert.equal(applyRollModifiers(10, timesThenPlus), 25);
  assert.equal(buildModifiedFormula("1d20", plusThenTimes), "((1d20) + 5) * 2");
});

test("rolagem: divisão arredonda pra baixo e o dano nunca fica negativo", () => {
  assert.equal(applyRollModifiers(15, { modifiers: [{ op: "div", value: 2 }] }), 7);
  assert.equal(applyRollModifiers(5, { modifiers: [{ op: "sub", value: 10 }] }), 0);
  assert.equal(buildModifiedFormula("1d20", { modifiers: [{ op: "div", value: 2 }] }), "floor((1d20) / 2)");
});

test("rolagem: valores inválidos, operação desconhecida e divisão por zero são descartados", () => {
  const { modifiers, advantage } = normalizeRollOptions({
    advantage: "talvez",
    modifiers: [{ op: "add", value: "abc" }, { op: "pow", value: 2 }, { op: "div", value: 0 }, { op: "sub", value: "3" }]
  });
  assert.equal(advantage, "normal");
  assert.deepEqual(modifiers, [{ op: "sub", value: 3, label: "" }]);
  assert.equal(isNeutralRollOptions(null), true);
  assert.equal(isNeutralRollOptions({ advantage: "advantage" }), false);
});

test("rolagem: texto do chat lista vantagem e cada modificador com o motivo", () => {
  const text = describeRollOptions({ advantage: "advantage", modifiers: [{ op: "add", value: 5, label: "boa interpretação" }, { op: "mul", value: 2 }] });
  assert.equal(text, "Vantagem · +5 (boa interpretação) · ×2");
  assert.equal(describeRollOptions(null), "");
});

test("Mana variável: proporcional abaixo do Custo, potência sem teto acima", () => {
  assert.equal(manaInvestmentPower(0.5), 0.5);
  assert.equal(manaInvestmentPower(1), 1);
  assert.ok(Math.abs(manaInvestmentPower(10) - 5.623) < 0.01);
  // O exemplo da Megumin: 1000 de Mana numa Skill de Custo 25.
  assert.ok(Math.abs(manaInvestmentPower(1000 / 25) - 15.91) < 0.01);
  // Sem teto, mas cada Mana a mais rende menos: a eficiência (força por Mana) só cai.
  assert.ok(manaInvestmentPower(100) > manaInvestmentPower(40));
  assert.ok(manaInvestmentPower(100) / 100 < manaInvestmentPower(40) / 40);
  assert.equal(manaInvestmentPower(4, 1), 4); // expoente 1 = linear
});

test("XP por uso: dano, cura e Escudo pela fração da Vida; cada alvo conta no máximo uma Vida", () => {
  const cfg = { factor: 100, flatPercent: 10 };
  assert.equal(skillUseXp([{ value: 25, base: 100 }], cfg), 25, "um quarto da Vida = 25");
  assert.equal(skillUseXp([{ value: 500, base: 100 }], cfg), 100, "overkill não passa de uma Vida");
  assert.equal(skillUseXp([{ value: 50, base: 100 }, { value: 30, base: 60 }], cfg), 100, "área soma os alvos");
  assert.equal(skillUseXp([{ value: -40, base: 200 }], cfg), 20, "debuff/dano negativo conta pelo tamanho");
  assert.equal(skillUseXp([{ flat: true }, { flat: true }], cfg), 20, "Condição/Estrutura/Zona: o fixo de 10% cada");
  assert.equal(skillUseXp([{ value: 10, base: 0 }], cfg), 100, "base 0 não divide por zero (vira 1)");
  assert.equal(skillUseXp([{ value: 100, base: 100 }, { value: 100, base: 100 }], { ...cfg, cap: 100 }), 100, "o relay limita o pedido a uma unidade");
  assert.equal(skillUseXp([], cfg), 0);
  assert.equal(measureFraction({ flat: true }, 25), 0.25);
});

test("XP por uso: buff/debuff pela fração do valor atual; Condição soma o fixo", () => {
  assert.deepEqual(effectEntryMeasures({ amount: 3 }, { attributeTotal: 10 }), [{ value: 3, base: 10 }], "Força +3 em quem tem 10 = 30%");
  assert.deepEqual(effectEntryMeasures({ amount: -20 }, { vitalMax: 200 }), [{ value: -20, base: 200 }]);
  assert.deepEqual(effectEntryMeasures({ amount: -50 }, { percent: true }), [{ value: -50, base: 100 }], "Lentidão −50% Deslocamento");
  assert.deepEqual(effectEntryMeasures({ amount: 0 }, { hasCondition: true }), [{ flat: true }], "Condição pura: só o fixo");
  assert.deepEqual(effectEntryMeasures({ amount: 2 }, { attributeTotal: 4, hasCondition: true }), [{ flat: true }, { value: 2, base: 4 }]);
  assert.deepEqual(effectEntryMeasures({ amount: 5 }, {}), [{ flat: true }], "alvo sem número (elemento de arma, corpo) conta o fixo");
  assert.deepEqual(effectEntryMeasures({ amount: 0 }, {}), [], "nada aplicado, nada medido");
});
