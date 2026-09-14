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
import {
  MEU_SISTEMA,
  getModuleSizePreset,
  convertCurrencyAmount,
  getVitalFormula,
  skillLevelBonuses,
  effectiveSkillCost,
  damageScalingMultiplier,
  getXpForNextLevel,
  resistanceXpGain
} from "../module/config.js";
import { computeResistancePercent, computeResistanceName, resistanceMaxLevel } from "../module/skill-effects.js";
import { buildSubSkillsFromSources } from "../module/skill-snapshot.js";
import { buildBatchPrompt, summarizeCreatedDocument } from "../module/ai-generation.js";
import { moduleIntegrityRatio } from "../module/data/starship-model.js";
import { splitStructuralDamage } from "../module/starship-power.js";

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
/*  Integridade de Módulo (danificado faz menos) */
/* -------------------------------------------- */

function fakeModule(value, max) {
  return { system: { hp: { value, max } } };
}

test("integridade: Módulo intacto entrega 100% do que promete", () => {
  assert.equal(moduleIntegrityRatio(fakeModule(320, 320)), 1);
});

test("integridade: o exemplo da regra — Escudo com 5 de 100 de Vida segura 5%", () => {
  // Capacidade 100 × 0.05 = 5, e Regen 100 × 0.05 = 5.
  assert.equal(moduleIntegrityRatio(fakeModule(5, 100)), 0.05);
});

test("integridade: metade da Vida, metade do desempenho", () => {
  assert.equal(moduleIntegrityRatio(fakeModule(160, 320)), 0.5);
});

test("integridade: Módulo destruído não entrega nada", () => {
  assert.equal(moduleIntegrityRatio(fakeModule(0, 320)), 0);
});

test("integridade: sem Vida Máxima definida, assume intacto em vez de dividir por zero", () => {
  assert.equal(moduleIntegrityRatio(fakeModule(0, 0)), 1);
  assert.equal(moduleIntegrityRatio(null), 1);
});

test("integridade: Vida acima do máximo não passa de 100%", () => {
  // Um ajuste manual do Mestre não pode virar bônus de desempenho.
  assert.equal(moduleIntegrityRatio(fakeModule(500, 320)), 1);
});

/* -------------------------------------------- */
/*  Dano espalhado pela Integridade Estrutural   */
/* -------------------------------------------- */

/** Aleatoriedade determinística: consome uma sequência fixa em vez de sortear de verdade. */
function fakeRandom(sequencia) {
  let i = 0;
  return () => sequencia[i++ % sequencia.length];
}

test("dano estrutural: reparte o total inteiro entre os Módulos", () => {
  const alvos = [
    { id: "a", remaining: 100 },
    { id: "b", remaining: 100 },
    { id: "c", remaining: 100 }
  ];
  const split = splitStructuralDamage(60, alvos, fakeRandom([0, 0.5, 0.4, 0.5, 0.8, 1]));
  const total = split.reduce((sum, x) => sum + x.damage, 0);
  assert.equal(total, 60, "o dano aplicado tem que fechar com o dano recebido");
});

test("dano estrutural: nenhum Módulo leva mais do que a Vida que tem", () => {
  const alvos = [
    { id: "frágil", remaining: 10 },
    { id: "robusto", remaining: 500 }
  ];
  const split = splitStructuralDamage(300, alvos, fakeRandom([0, 1, 0, 1]));
  const frágil = split.find(x => x.id === "frágil");
  assert.ok(!frágil || frágil.damage <= 10, "o Módulo frágil levou mais do que aguentava");
  assert.equal(split.reduce((s, x) => s + x.damage, 0), 300);
});

test("dano estrutural: com todos os Módulos zerados, o excedente se perde (a nave já é sucata)", () => {
  const split = splitStructuralDamage(500, [{ id: "a", remaining: 0 }], fakeRandom([0, 1]));
  assert.deepEqual(split, []);
});

test("dano estrutural: não entra em laço infinito quando a Vida acaba antes do dano", () => {
  // O caso que travaria: pedaços sorteados de tamanho 0 nunca consumiriam o dano.
  const split = splitStructuralDamage(1000, [{ id: "a", remaining: 5 }, { id: "b", remaining: 5 }], fakeRandom([0]));
  assert.equal(split.reduce((s, x) => s + x.damage, 0), 10, "só dá pra aplicar a Vida existente");
});

test("dano estrutural: dano zero ou negativo não toca em Módulo nenhum", () => {
  assert.deepEqual(splitStructuralDamage(0, [{ id: "a", remaining: 100 }], fakeRandom([0.5])), []);
  assert.deepEqual(splitStructuralDamage(-30, [{ id: "a", remaining: 100 }], fakeRandom([0.5])), []);
});

test("dano estrutural: sorteios diferentes atingem Módulos diferentes", () => {
  // É o ponto da regra: o mesmo golpe não lasca todo mundo por igual.
  const alvos = () => [{ id: "a", remaining: 100 }, { id: "b", remaining: 100 }];
  const primeiro = splitStructuralDamage(20, alvos(), fakeRandom([0, 1]));
  const segundo = splitStructuralDamage(20, alvos(), fakeRandom([0.99, 1]));
  assert.notDeepEqual(primeiro, segundo);
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
