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

import { computeAttributeDicePool, buildAttributeRollFormula } from "../module/core/dice.js";
import {
  MEU_SISTEMA,
  getModuleSizePreset,
  convertCurrencyAmount,
  getVitalFormula,
  skillLevelBonuses,
  effectiveSkillCost,
  damageScalingMultiplier,
  getXpForNextLevel,
  resistanceXpGain,
  movementAllowance,
  describeMovement,
  getMovementConfig,
  resolveActorTraits,
  engineRatio,
  shipMovementCells,
  shipEvasionFraction,
  getShipManeuverConfig,
  isMagicUse,
  speciesCarry,
  stackCount,
  inventoryLoad,
  currencyWeight,
  carryCapacity,
  encumbrancePenalty,
  cargoSlotsFor,
  cargoMassFactor,
  ammoFitsLauncher,
  antimagicSurcharge,
  getVesselSizes,
  vesselSizeFor,
  sizeFitsClass,
  describeClassSizeRange,
  powerPriorityGroup,
  fundByPriority,
  resolvePowerGroups,
  powerGroupIndex,
  movePowerGroup,
  removePowerGroup,
  focusGroupAssignments,
  powerGroupState,
  powerBudget,
  isStructureMechanic,
  migrateStructureTarget,
  getActiveDamageElements,
  normalizeLightConfig,
  manaInvestmentPower,
  tractorHold
} from "../module/core/config.js";
import { computeResistancePercent, computeResistanceName, resistanceMaxLevel } from "../module/combat/resistance.js";
import { buildSubSkillsFromSources, buildGrantedSkillData } from "../module/skills/skill-snapshot.js";
import { buildBatchPrompt, summarizeCreatedDocument } from "../module/ai/ai-generation.js";
import { moduleIntegrityRatio } from "../module/starship/starship-model.js";
import { splitStructuralDamage } from "../module/starship/starship-power.js";
import { splitShieldDamage } from "../module/combat/damage-apply.js";

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
  // Categoria que não está no catálogo vira Utilidade (Módulo órfão perde a mecânica, nunca
  // quebra a Nave) — e a Vida continua vindo do Porte.
  assert.deepEqual(getModuleSizePreset("categoria-que-nao-existe", "standard"), getModuleSizePreset("utility", "standard"));
  assert.equal(getModuleSizePreset("categoria-que-nao-existe", "standard")["system.hp.max"], MEU_SISTEMA.MODULE_HP_BY_SIZE.standard);
  // Porte inexistente: não há nem stats nem Vida a sugerir.
  assert.deepEqual(getModuleSizePreset("shield", "porte-que-nao-existe"), {});
});

/* -------------------------------------------- */
/*  Capacitor: mínimo dos conduítes              */
/* -------------------------------------------- */

test("capacitor: todo Porte tem um mínimo de conduíte (nenhuma Nave fica com reserva zero)", () => {
  for (const size of [...MEU_SISTEMA.DEFAULT_SHIP_SIZES, ...MEU_SISTEMA.DEFAULT_VEHICLE_SIZES]) {
    assert.ok(size.conduitCapacitor > 0, `Porte "${size.id}" ficou sem mínimo de conduíte`);
  }
});

test("capacitor: instalar a MENOR Bateria nunca pode piorar a reserva de nenhum Porte", () => {
  // O Módulo de Bateria SUBSTITUI o mínimo dos conduítes (não soma). Essa invariante é o que
  // impede o absurdo de instalar uma Bateria e a Nave ficar com MENOS reserva do que tinha —
  // por isso toda a tabela de conduíte tem que caber abaixo da menor Bateria instalável.
  const smallestBattery = getModuleSizePreset("battery", MEU_SISTEMA.MODULE_SIZES[0])["system.batteryCapacity"];
  for (const size of [...MEU_SISTEMA.DEFAULT_SHIP_SIZES, ...MEU_SISTEMA.DEFAULT_VEHICLE_SIZES]) {
    assert.ok(
      size.conduitCapacitor <= smallestBattery,
      `Porte "${size.id}": conduíte (${size.conduitCapacitor}) passou da menor Bateria (${smallestBattery})`
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

/* -------------------------------------------- */
/*  Deslocamento por rodada                      */
/* -------------------------------------------- */

const MOVE_CFG = { base: 6, step: 10, cap: 18 };

test("deslocamento: base + 1 m a cada passo de Destreza permanente", () => {
  assert.equal(movementAllowance({ permanentDexterity: 0 }, MOVE_CFG).total, 6);
  assert.equal(movementAllowance({ permanentDexterity: 9 }, MOVE_CFG).total, 6);
  assert.equal(movementAllowance({ permanentDexterity: 10 }, MOVE_CFG).total, 7);
  assert.equal(movementAllowance({ permanentDexterity: 24 }, MOVE_CFG).total, 8);
  assert.equal(movementAllowance({ permanentDexterity: 30 }, MOVE_CFG).total, 9);
});

test("deslocamento: a Destreza permanente para no teto", () => {
  const atCap = movementAllowance({ permanentDexterity: 120 }, MOVE_CFG);
  assert.equal(atCap.total, 18);
  assert.equal(atCap.capped, true);
  assert.equal(movementAllowance({ permanentDexterity: 999 }, MOVE_CFG).total, 18);
  assert.equal(movementAllowance({ permanentDexterity: 30 }, MOVE_CFG).capped, false);
});

test("deslocamento: Destreza de Skill passa por cima do teto (exemplo do Mestre: 20 m, 200 de Destreza, +10 de Skill = 21 m)", () => {
  const cfg = { base: 14, step: 10, cap: 20 };
  assert.equal(movementAllowance({ permanentDexterity: 200 }, cfg).total, 20);
  const boosted = movementAllowance({ permanentDexterity: 200, skillDexterity: 10 }, cfg);
  assert.equal(boosted.total, 21);
  assert.equal(boosted.fromSkills, 1);
});

test("deslocamento: Skill que reduz Destreza reduz o deslocamento, sem passar de zero", () => {
  assert.equal(movementAllowance({ permanentDexterity: 24, skillDexterity: -10 }, MOVE_CFG).total, 7);
  // Menos que um passo não muda nada (e não vira -0).
  assert.equal(Object.is(movementAllowance({ permanentDexterity: 24, skillDexterity: -5 }, MOVE_CFG).fromSkills, 0), true);
  assert.equal(movementAllowance({ permanentDexterity: 0, skillDexterity: -500 }, MOVE_CFG).total, 0);
});

test("deslocamento: configuração absurda não quebra (passo zero, teto abaixo da base)", () => {
  assert.equal(movementAllowance({ permanentDexterity: 5 }, { base: 6, step: 0, cap: 18 }).total, 11);
  assert.equal(movementAllowance({ permanentDexterity: 500 }, { base: 6, step: 10, cap: 2 }).total, 6);
  assert.equal(movementAllowance({ permanentDexterity: -20 }, MOVE_CFG).total, 6);
});

test("deslocamento: descrição da ficha diz de onde vem o número", () => {
  const text = describeMovement(movementAllowance({ permanentDexterity: 24, skillDexterity: 10 }, MOVE_CFG));
  assert.equal(text.total, 9);
  assert.match(text.title, /6 base \+ 2 de Destreza \+ 1 de Skills/);
  assert.equal(describeMovement(null), null);
});

test("deslocamento: sem settings registradas, a configuração cai nos padrões da tabela", () => {
  assert.deepEqual(getMovementConfig(), { base: 6, step: 10, cap: 18, gmIgnores: true });
});

/* -------------------------------------------- */
/*  Movimento e Evasão de naves                  */
/* -------------------------------------------- */

test("nave: razão do Motor é efetivo ÷ referência do Porte, e 0 sem Motor", () => {
  assert.equal(engineRatio(40, 40), 1);
  assert.equal(engineRatio(28, 40), 0.7);
  assert.equal(engineRatio(48, 40), 1.2);
  assert.equal(engineRatio(0, 40), 0);
  assert.equal(engineRatio(40, 0), 0);
});

test("nave: movimento em casas é a base do Porte × razão, arredondado para baixo", () => {
  assert.equal(shipMovementCells(6, 1), 6);
  assert.equal(shipMovementCells(6, 0.7), 4);
  assert.equal(shipMovementCells(6, 1.2), 7);
  assert.equal(shipMovementCells(6, 0), 0);
  // 5 × 0.6 dá 2.9999… em ponto flutuante: não pode perder uma casa por isso.
  assert.equal(shipMovementCells(5, 0.6), 3);
});

test("nave: Evasão é a base do Porte × razão da Rotação, com teto", () => {
  assert.equal(shipEvasionFraction(22, 1, 40), 0.22);
  assert.ok(Math.abs(shipEvasionFraction(22, 0.7, 40) - 0.154) < 1e-9);
  assert.equal(shipEvasionFraction(30, 2, 40), 0.4);
  assert.equal(shipEvasionFraction(22, 0, 40), 0);
});

test("nave: sem settings, Porte maior anda menos e desvia menos", () => {
  for (const kind of ["ship", "vehicle"]) {
    const sizes = getVesselSizes(kind);
    for (let i = 1; i < sizes.length; i++) {
      assert.ok(sizes[i].move < sizes[i - 1].move, `${sizes[i].id} anda menos que ${sizes[i - 1].id}`);
      assert.ok(sizes[i].evasion < sizes[i - 1].evasion, `${sizes[i].id} desvia menos que ${sizes[i - 1].id}`);
      assert.ok(sizes[i].rank >= sizes[i - 1].rank);
    }
  }
  assert.equal(getShipManeuverConfig().evasionCap, 40);
});

test("Portes: Veículo tem lista própria e mantém os números antigos de Mini/Pequeno", () => {
  const ship = getVesselSizes("ship");
  const vehicle = getVesselSizes("vehicle");
  assert.deepEqual(ship.map(s => s.id), ["mini", "pequeno", "medio", "grande", "capital"]);
  assert.deepEqual(vehicle.map(s => s.id), ["mini", "pequeno", "medio", "grande", "colossal"]);
  for (const id of ["mini", "pequeno"]) {
    const a = ship.find(s => s.id === id);
    const b = vehicle.find(s => s.id === id);
    for (const field of ["rank", "weaponBudget", "distributorBaseline", "conduitCapacitor", "move", "evasion"]) assert.equal(a[field], b[field], `${id}.${field}`);
  }
  // Porte apagado do catálogo: cai no padrão de mesmo id, nunca quebra.
  assert.equal(vesselSizeFor("ship", "capital").distributorBaseline, 1280);
  assert.equal(vesselSizeFor("ship", "nao-existe").id, "mini");
});

test("Classe limita os Portes: mínimo, máximo, faixa e texto", () => {
  const sizes = getVesselSizes("ship");
  const fighter = { minSize: "", maxSize: "pequeno" };
  const dread = { minSize: "capital", maxSize: "" };
  const mid = { minSize: "medio", maxSize: "grande" };
  assert.equal(sizeFitsClass("mini", fighter, sizes), true);
  assert.equal(sizeFitsClass("medio", fighter, sizes), false);
  assert.equal(sizeFitsClass("grande", dread, sizes), false);
  assert.equal(sizeFitsClass("capital", dread, sizes), true);
  assert.equal(sizeFitsClass("pequeno", mid, sizes), false);
  assert.equal(sizeFitsClass("grande", mid, sizes), true);
  assert.equal(sizeFitsClass("mini", null, sizes), true);
  assert.equal(sizeFitsClass("porte-sumido", fighter, sizes), true);
  assert.equal(describeClassSizeRange(fighter, sizes), "até Pequeno");
  assert.equal(describeClassSizeRange(dread, sizes), "a partir de Capital");
  assert.equal(describeClassSizeRange(mid, sizes), "de Médio a Grande");
  assert.equal(describeClassSizeRange({}, sizes), "");
});

/* -------------------------------------------- */
/*  Escudo pessoal absorve antes da Vida         */
/* -------------------------------------------- */

test("escudo pessoal: absorve até acabar, o resto vai pra Vida", () => {
  assert.deepEqual(splitShieldDamage(20, 10), { toShield: 10, toHp: 10 });
  assert.deepEqual(splitShieldDamage(5, 10), { toShield: 5, toHp: 0 });
  assert.deepEqual(splitShieldDamage(20, 0), { toShield: 0, toHp: 20 });
});

test("escudo pessoal: Dano Absoluto passa direto", () => {
  assert.deepEqual(splitShieldDamage(20, 10, { bypassShield: true }), { toShield: 0, toHp: 20 });
});

test("escudo pessoal: valores estranhos não quebram", () => {
  assert.deepEqual(splitShieldDamage(0, 10), { toShield: 0, toHp: 0 });
  assert.deepEqual(splitShieldDamage(10, -5), { toShield: 0, toHp: 10 });
  assert.deepEqual(splitShieldDamage(10.6, undefined), { toShield: 0, toHp: 11 });
});

/* -------------------------------------------- */
/*  Habilidade Concedida completa                */
/* -------------------------------------------- */

const GRANTABLE = ["extra", "normal", "racial"];

test("habilidade concedida: sem nome não cria nada", () => {
  assert.equal(buildGrantedSkillData({ name: "  " }, GRANTABLE), null);
  assert.equal(buildGrantedSkillData(null, GRANTABLE), null);
});

test("habilidade concedida: a mecânica inteira vai para a Skill da ficha", () => {
  const data = buildGrantedSkillData(
    {
      name: "Lâmina Flamejante", tier: "extra", level: 3, cost: 4, hasUpkeep: true, upkeepCost: 2,
      effectType: "damage", damageFormula: "2d6", isMagicDamage: true, damageElements: ["fire"],
      targetType: "emission", areaShape: "cone", areaDistance: 6
    },
    GRANTABLE
  );
  assert.equal(data.name, "Lâmina Flamejante");
  assert.equal(data.type, "skill");
  assert.equal(data.system.tier, "extra");
  assert.equal(data.system.level, 3);
  assert.equal(data.system.damageFormula, "2d6");
  assert.deepEqual(data.system.damageElements, ["fire"]);
  assert.equal(data.system.areaShape, "cone");
  assert.equal(data.system.upkeepCost, 2);
  assert.equal(data.system.isItemGranted, true);
});

test("habilidade concedida: começa desligada, inclusive as Sub-Skills, e é cópia", () => {
  const source = { name: "Arsenal", active: true, subSkills: [{ name: "Tiro", active: true, effects: [{ amount: 1 }] }] };
  const data = buildGrantedSkillData(source, GRANTABLE);
  assert.equal(data.system.active, false);
  assert.equal(data.system.subSkills[0].active, false);
  data.system.subSkills[0].effects[0].amount = 99;
  assert.equal(source.subSkills[0].effects[0].amount, 1);
});

test("habilidade concedida: tier fora da lista vira Normal; formato antigo (4 campos) continua valendo", () => {
  const data = buildGrantedSkillData({ name: "Velha", tier: "ultimate", cost: 2, description: "<p>x</p>" }, GRANTABLE);
  assert.equal(data.system.tier, "normal");
  assert.equal(data.system.cost, 2);
  assert.equal(data.system.level, 1);
  assert.equal(data.system.description, "<p>x</p>");
});

/* -------------------------------------------- */
/*  Modificadores de rolagem (shift+clique)      */
/* -------------------------------------------- */

import {
  normalizeRollOptions,
  isNeutralRollOptions,
  applyAdvantageToFormula,
  buildModifiedFormula,
  applyRollModifiers,
  describeRollOptions
} from "../module/core/roll-modifiers.js";

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

/* -------------------------------------------- */
/*  Dano por elemento, Imunidade, Escala         */
/* -------------------------------------------- */

import {
  splitDamageParts,
  resolveDamageParts,
  scaleMultiplier,
  resolveConditionEffect,
  refreshReapplication,
  rollChance, sustainedShieldGain, absorbLayer, resolveShipCascade, splitTargetedStructural, hardenedChance, consumeShieldPools, reconcileShieldPools,
  shieldAdaptationKey,
  shieldAdaptationFor,
  adaptShield,
  affinityMultiplier,
  cycleAffinityLevel,
  elementVsDefender,
  hitAffinityFactor,
  buildAffinityMatrix
} from "../module/combat/damage-rules.js";

test("elementos: o golpe é dividido em partes iguais", () => {
  assert.deepEqual(splitDamageParts(100, ["fire", "ice"]), [{ elementId: "fire", raw: 50 }, { elementId: "ice", raw: 50 }]);
  assert.deepEqual(splitDamageParts(100, []), [{ elementId: null, raw: 100 }]);
  assert.deepEqual(splitDamageParts(90, ["fire", "fire", "ice", "acid"]).map(p => p.raw), [30, 30, 30]);
});

test("imunidade zera só a parte do próprio elemento", () => {
  const parts = splitDamageParts(100, ["fire", "ice"]);
  const result = resolveDamageParts({ parts, resistanceFor: id => (id === "fire" ? 1 : 0) });
  assert.equal(result.final, 50);
  assert.equal(result.parts[0].immune, true);
});

test("resistências valem por parte, não em cadeia sobre o golpe inteiro", () => {
  const parts = splitDamageParts(100, ["fire", "ice"]);
  const result = resolveDamageParts({ parts, resistanceFor: () => 0.5 });
  assert.equal(result.final, 50);
});

test("penetração amolece Defesa Mágica e Resistências, mas nunca atravessa Imunidade", () => {
  const soft = resolveDamageParts({ parts: [{ elementId: "fire", raw: 100, penetration: 0.5 }], general: 0.5, resistanceFor: () => 0 });
  assert.equal(soft.final, 75);
  const immune = resolveDamageParts({ parts: [{ elementId: "fire", raw: 100, penetration: 1 }], resistanceFor: () => 1 });
  assert.equal(immune.final, 0);
});

test("Dano Absoluto ignora Defesa Mágica, Resistências e Imunidade", () => {
  const result = resolveDamageParts({
    parts: [{ elementId: "fire", raw: 100 }],
    magicDefense: 0.6,
    general: 0.5,
    resistanceFor: () => 1,
    absolute: true
  });
  assert.equal(result.final, 100);
});

test("bônus contra Traço multiplica a parte antes das defesas", () => {
  const result = resolveDamageParts({ parts: [{ elementId: "polaron", raw: 100, bonus: 0.2 }], general: 0.5 });
  assert.equal(result.final, 60);
});

test("resistências registram quanto cada uma bloqueou (XP de Resistência)", () => {
  const result = resolveDamageParts({ parts: [{ elementId: "fire", raw: 100 }], general: 0.5, resistanceFor: () => 0.5 });
  assert.equal(result.parts[0].blockedGeneral, 50);
  assert.equal(result.parts[0].blockedElement, 25);
});

test("escala: fator elevado à diferença de degraus", () => {
  assert.equal(scaleMultiplier(0, 2, 10), 0.01);
  assert.equal(scaleMultiplier(2, 0, 10), 100);
  assert.equal(scaleMultiplier(1, 1, 10), 1);
  assert.equal(scaleMultiplier(undefined, 1, 10), 0.1);
});

test("condição padrão: Queimadura em % do dano do golpe", () => {
  const burn = { id: "burn", effect: { kind: "tick", tickTarget: "hp", tickSign: "damage", valueMode: "hitPercent", value: 10, durationRounds: 2 } };
  assert.deepEqual(resolveConditionEffect(burn, { hitDamage: 5000 }), {
    target: "hp", amount: -500, periodic: true, durationRounds: 2, tickUnit: "combatRound", conditionId: "burn"
  });
  // Sem golpe (marcação à mão, Skill sem dano): fica só o ícone.
  assert.equal(resolveConditionEffect(burn, {}), null);
});

test("condição padrão: % da Vida máxima, cura, e Lentidão no Deslocamento", () => {
  const regen = { id: "regen", effect: { kind: "tick", tickTarget: "hp", tickSign: "heal", valueMode: "maxPercent", value: 5, durationRounds: 3 } };
  assert.equal(resolveConditionEffect(regen, { targetMax: { hp: 1000 } }).amount, 50);
  const slow = { id: "slow", effect: { kind: "modifier", modTarget: "movement", value: -50, durationRounds: 2 } };
  assert.deepEqual(resolveConditionEffect(slow, {}), {
    target: "movement", amount: -50, periodic: false, durationRounds: 2, tickUnit: "combatRound", conditionId: "slow"
  });
  const weak = { id: "weak", effect: { kind: "modifier", modTarget: "strength", modMode: "percent", value: -20, durationRounds: 2 } };
  assert.equal(resolveConditionEffect(weak, { attributeTotal: () => 50 }).amount, -10);
  assert.equal(resolveConditionEffect({ id: "blind" }, {}), null);
});

test("reaplicar renova (não soma) e fica com o valor mais forte", () => {
  assert.deepEqual(refreshReapplication({ rounds: 1, amount: -500 }, { rounds: 3, amount: -20 }), { rounds: 3, amount: -500 });
  assert.deepEqual(refreshReapplication({ rounds: 5, amount: -10 }, { rounds: 2, amount: -40 }), { rounds: 5, amount: -40 });
});

test("chance: 0 nunca, 100 sempre, o resto pelo sorteio", () => {
  assert.equal(rollChance(0), false);
  assert.equal(rollChance(100), true);
  assert.equal(rollChance(25, () => 0.1), true);
  assert.equal(rollChance(25, () => 0.9), false);
});

test("deslocamento: efeito percentual vale sobre o total", () => {
  assert.equal(movementAllowance({ permanentDexterity: 24, percent: -50 }, MOVE_CFG).total, 4);
  assert.equal(movementAllowance({ permanentDexterity: 24, percent: -100 }, MOVE_CFG).total, 0);
});

test("escudo pessoal: dreno bate só no Escudo e nunca passa pra Vida", () => {
  assert.deepEqual(splitShieldDamage(20, 15, { shieldExtra: 10 }), { toShield: 15, toHp: 15 });
  assert.deepEqual(splitShieldDamage(20, 0, { shieldExtra: 10 }), { toShield: 0, toHp: 20 });
});

test("traços: os da Espécie, mais os da ficha, menos os retirados", () => {
  const presets = { dragoide: { traits: ["organic", "draconic", "wingless"] } };
  assert.deepEqual(
    resolveActorTraits({ species: "dragoide", traits: ["flying"], traitsRemoved: ["wingless"] }, presets),
    ["organic", "draconic", "flying"]
  );
  assert.deepEqual(resolveActorTraits({ traits: ["mechanical"] }, presets), ["mechanical"]);
});

/* -------------------------------------------- */
/*  Modificadores Condicionais                   */
/* -------------------------------------------- */

import { matchesWhen, sumConditionalModifiers, perEachCount } from "../module/combat/conditional-modifiers.js";

const DRAGON_SLAYER = { when: { kind: "otherTrait", value: "draconic" }, then: { kind: "damagePercent", value: 25 } };

test("condicional: Caçador de Dragões só vale contra quem tem o Traço", () => {
  const vsDragon = { otherTraits: new Set(["draconic", "organic"]) };
  const vsHuman = { otherTraits: new Set(["organic"]) };
  assert.equal(sumConditionalModifiers([DRAGON_SLAYER], "damagePercent", vsDragon), 25);
  assert.equal(sumConditionalModifiers([DRAGON_SLAYER], "damagePercent", vsHuman), 0);
});

test("condicional: condições sobre si mesmo (Vida baixa, Condição, combate)", () => {
  assert.equal(matchesWhen({ kind: "selfHpBelow", threshold: 50 }, { selfHpPercent: 30 }), true);
  assert.equal(matchesWhen({ kind: "selfHpBelow", threshold: 50 }, { selfHpPercent: 80 }), false);
  assert.equal(matchesWhen({ kind: "selfCondition", value: "burn" }, { selfConditions: new Set(["burn"]) }), true);
  assert.equal(matchesWhen({ kind: "selfInCombat" }, { inCombat: false }), false);
  assert.equal(matchesWhen({ kind: "element", value: "fire" }, { elements: new Set(["fire"]) }), true);
  assert.equal(matchesWhen({ kind: "otherIsShip" }, { otherIsShip: true }), true);
  assert.equal(matchesWhen({}, {}), true);
});

test("condicional: '+N por cada Condição no oponente' multiplica pela contagem", () => {
  const perCondition = { when: { kind: "always" }, then: { kind: "damagePercent", value: 5 }, perEach: "otherConditions" };
  assert.equal(sumConditionalModifiers([perCondition], "damagePercent", { otherConditions: new Set(["burn", "slow", "poison"]) }), 15);
  assert.equal(perEachCount("", {}), 1);
});

test("condicional: rolagem e atributo filtram por atributo ('any' vale pra todos)", () => {
  const mods = [
    { when: { kind: "always" }, then: { kind: "rollFlat", target: "perception", value: 3 } },
    { when: { kind: "always" }, then: { kind: "rollFlat", target: "any", value: 1 } }
  ];
  assert.equal(sumConditionalModifiers(mods, "rollFlat", {}, { attribute: "perception" }), 4);
  assert.equal(sumConditionalModifiers(mods, "rollFlat", {}, { attribute: "strength" }), 1);
});

test("condicional: bônus contínuo de atributo só aceita condições sobre si mesmo", () => {
  const rage = { when: { kind: "selfHpBelow", threshold: 50 }, then: { kind: "attributeFlat", target: "strength", value: 10 } };
  const vsDragon = { when: { kind: "otherTrait", value: "draconic" }, then: { kind: "attributeFlat", target: "strength", value: 10 } };
  const ctx = { selfHpPercent: 20, otherTraits: new Set(["draconic"]) };
  assert.equal(sumConditionalModifiers([rage, vsDragon], "attributeFlat", ctx, { attribute: "strength" }), 10);
});

test("condicional: Resistência filtra pelo alvo da Resistência", () => {
  const mods = [{ when: { kind: "always" }, then: { kind: "resistancePercent", target: "fire", value: 20 } }];
  assert.equal(sumConditionalModifiers(mods, "resistancePercent", {}, { element: "fire" }), 20);
  assert.equal(sumConditionalModifiers(mods, "resistancePercent", {}, { element: "general" }), 0);
});

/* -------------------------------------------- */
/*  Categorias de Módulo e Classes               */
/* -------------------------------------------- */

import { moduleRole, categorySlotLimit, getModuleCategories } from "../module/core/config.js";

test("categorias: as 9 de sempre têm Função e ids antigos continuam válidos", () => {
  assert.equal(moduleRole("reactor"), "power");
  assert.equal(moduleRole("engine"), "propulsion");
  assert.equal(moduleRole("distributor"), "distribution");
  assert.equal(moduleRole("sumiu-do-catalogo"), "utility");
  const ids = getModuleCategories().map(c => c.id);
  for (const id of ["reactor", "battery", "distributor", "shield", "engine", "armor", "ftl", "weapon", "utility"]) assert.ok(ids.includes(id), id);
  // Raio Trator e Porão entraram depois, com Função própria.
  assert.equal(moduleRole("tractor"), "tractor");
  assert.equal(moduleRole("cargo"), "cargo");
});

test("classes: a Classe sobrescreve as vagas da Categoria; Distribuição é sempre 1", () => {
  const armor = { id: "armor", role: "armor", slots: 1 };
  const distributor = { id: "distributor", role: "distribution", slots: 1 };
  const battleship = { slots: { armor: 2, distributor: 3 } };
  assert.equal(categorySlotLimit(armor, null), 1);
  assert.equal(categorySlotLimit(armor, battleship), 2);
  assert.equal(categorySlotLimit(distributor, battleship), 1);
  assert.equal(categorySlotLimit({ id: "weapon", role: "weapon", slots: 0 }, battleship), 0);
});

/* -------------------------------------------- */
/*  Estruturas: geometria                        */
/* -------------------------------------------- */

import { capPolyline, polylineLength, structureSegments, pointsAlongPolyline, segmentCrossing, firstStructureOnPath, splitStructureHit,
  pointInSegments,
  segmentsCross
} from "../module/structures/structure-geometry.js";

test("estrutura: traçado livre para no comprimento máximo", () => {
  const capped = capPolyline([[0, 0], [100, 0], [100, 100]], 150);
  assert.deepEqual(capped, [[0, 0], [100, 0], [100, 50]]);
  assert.equal(polylineLength(capped), 150);
});

test("estrutura: linha usa só início e fim, cortada no tamanho", () => {
  assert.deepEqual(structureSegments("line", [[0, 0], [500, 0], [999, 999]], 200), [[0, 0, 200, 0]]);
});

test("estrutura: forma livre em L vira dois segmentos", () => {
  assert.deepEqual(structureSegments("free", [[0, 0], [100, 0], [100, 100]], 1000), [[0, 0, 100, 0], [100, 0, 100, 100]]);
});

test("estrutura: quadrado fecha 4 lados; círculo vira polígono fechado", () => {
  assert.equal(structureSegments("rect", [[0, 0]], 100).length, 4);
  const circle = structureSegments("circle", [[0, 0]], 100, 16);
  assert.equal(circle.length, 16);
  assert.deepEqual(circle[0].slice(0, 2), circle.at(-1).slice(2, 4));
});

test("estrutura: sem ponto ou tamanho, nenhuma parede", () => {
  assert.deepEqual(structureSegments("free", [[0, 0]], 100), []);
  assert.deepEqual(structureSegments("circle", [], 100), []);
  assert.deepEqual(structureSegments("line", [[0, 0], [10, 0]], 0), []);
});

/* -------------------------------------------- */
/*  Exportar/Importar e presets                  */
/* -------------------------------------------- */

import { readTransferBundle, diffTransfer, transferGroup } from "../module/core/config-transfer.js";
import { presetContent } from "../module/core/config.js";

test("importar: formato atual traz o mapa de settings, sem o registro de migrações", () => {
  const bundle = { _system: "nihility-rpg-system", settings: { xpFormula: "100 * @nivel", completedMigrations: "[]" } };
  assert.deepEqual(readTransferBundle(bundle, "nihility-rpg-system"), { xpFormula: "100 * @nivel" });
});

test("importar: arquivo antigo (4 listas parseadas) continua aceito", () => {
  const legacy = { currenciesData: [{ id: "gold" }], damageElementsData: [{ id: "fire" }] };
  const read = readTransferBundle(legacy, "nihility-rpg-system");
  assert.deepEqual(Object.keys(read).sort(), ["currenciesData", "damageElementsData"]);
  assert.equal(typeof read.currenciesData, "string");
});

test("importar: arquivo de outro sistema ou sem nada reconhecível é recusado", () => {
  assert.equal(readTransferBundle({ _system: "dnd5e", settings: {} }, "nihility-rpg-system"), null);
  assert.equal(readTransferBundle({ foo: 1 }, "nihility-rpg-system"), null);
});

test("importar: diferença ignora formatação de JSON e chaves desconhecidas", () => {
  const current = { a: '[{"id":1}]', b: 5 };
  const incoming = { a: '[\n  {"id": 1}\n]', b: 6, desconhecida: 1 };
  assert.deepEqual(diffTransfer(current, incoming), [{ key: "a", changed: false }, { key: "b", changed: true }]);
});

test("importar: grupos dos diálogos", () => {
  const features = new Set(["movementEnabled"]);
  assert.equal(transferGroup("movementEnabled", features), "Módulos do Sistema");
  assert.equal(transferGroup("traitsData", features), "Catálogos");
  assert.equal(transferGroup("xpFormula", features), "Regras");
});

test("presets: Sci-Fi carrega elementos de energia + os de fantasia, sem id repetido", () => {
  const content = presetContent("scifi");
  const ids = content.damageElementsData.map(e => e.id);
  assert.ok(ids.includes("phaser") && ids.includes("fire"));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(content.moduleCategoriesData.some(c => c.id === "thrusters"));
  assert.deepEqual(Object.keys(presetContent("inexistente")), []);
});

test("prioridade de energia: grupos 1–5, valores antigos caem no meio", () => {
  assert.equal(powerPriorityGroup(1), 1);
  assert.equal(powerPriorityGroup(5), 5);
  assert.equal(powerPriorityGroup(0), 1);
  assert.equal(powerPriorityGroup(50), 3); // padrão antigo do schema
  assert.equal(powerPriorityGroup(20), 3); // numeração 10/20/30 da lista antiga
  assert.equal(powerPriorityGroup(undefined), 3);
});

test("prioridade de energia: P1 primeiro, o mesmo grupo divide por igual", () => {
  const entries = [
    { id: "escudo", demand: 40, priority: 1 },
    { id: "motor", demand: 30, priority: 2 },
    { id: "arma", demand: 30, priority: 2 },
    { id: "hangar", demand: 20, priority: 5 },
    { id: "casco", demand: 0, priority: 5 }
  ];
  const ratios = fundByPriority(entries, 70);
  assert.equal(ratios.get("escudo"), 1);
  assert.equal(ratios.get("motor"), 0.5); // sobram 30 pra 60 pedidos: metade pra cada
  assert.equal(ratios.get("arma"), 0.5);
  assert.equal(ratios.get("hangar"), 0);
  assert.equal(ratios.get("casco"), 1); // sem demanda, nunca passa fome
  assert.ok([...fundByPriority(entries, 1000).values()].every(r => r === 1));
});

test("prioridade de energia: a posição na fila vale qualquer número de grupos", () => {
  // Posição 0 é o primeiro grupo (a Nave passa a posição, não mais o número 1–5).
  const ratios = fundByPriority([
    { id: "a", demand: 30, priority: 0 },
    { id: "b", demand: 160, priority: 1 },
    { id: "c", demand: 130, priority: 2 },
    { id: "d", demand: 80, priority: 7 }
  ], 294);
  assert.equal(ratios.get("a"), 1);
  assert.equal(ratios.get("b"), 1);
  assert.equal(ratios.get("c"), 0.8); // sobram 104 pra 130
  assert.equal(ratios.get("d"), 0);
});

test("fila de prioridade: vazia = cinco grupos padrão; ids repetidos e vazios caem fora", () => {
  const defaults = resolvePowerGroups([]);
  assert.deepEqual(defaults.map(g => g.id), ["p1", "p2", "p3", "p4", "p5"]);
  const custom = resolvePowerGroups([{ id: "a", label: "Vida" }, { id: "a", label: "dup" }, { id: "", label: "x" }, { id: "b", label: "" }]);
  assert.deepEqual(custom, [{ id: "a", label: "Vida" }, { id: "b", label: "Prioridade 2" }]);
});

test("fila de prioridade: Módulo antigo (1–5) continua no mesmo grupo; sem grupo cai no meio", () => {
  const groups = resolvePowerGroups([]);
  assert.equal(powerGroupIndex(groups, "", 1), 0);
  assert.equal(powerGroupIndex(groups, "", 50), 2); // padrão antigo → P3
  assert.equal(powerGroupIndex(groups, "p5", 1), 4); // o grupo escolhido vence o número
  const custom = [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }, { id: "d", label: "D" }];
  assert.equal(powerGroupIndex(custom, "sumiu", 3), 1); // grupo de outra Nave → meio
  assert.equal(powerGroupIndex(custom, "c", 3), 2);
});

test("fila de prioridade: subir/descer e apagar mandam os Módulos pro vizinho", () => {
  const groups = [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }];
  assert.deepEqual(movePowerGroup(groups, "b", -1).map(g => g.id), ["b", "a", "c"]);
  assert.deepEqual(movePowerGroup(groups, "a", -1).map(g => g.id), ["a", "b", "c"]); // já é o primeiro
  assert.deepEqual(removePowerGroup(groups, "b"), { groups: [{ id: "a", label: "A" }, { id: "c", label: "C" }], fallbackId: "c" });
  assert.equal(removePowerGroup(groups, "c").fallbackId, "b"); // o último vai pro anterior
  assert.equal(removePowerGroup([{ id: "a", label: "A" }], "a").fallbackId, null); // nunca fica vazia
});

test("foco de energia: vai pro topo e volta pro grupo de onde saiu", () => {
  const modules = [
    { id: "esc", role: "shield", groupId: "p3" },
    { id: "arm", role: "weapon", groupId: "p4" }
  ];
  const shields = focusGroupAssignments(modules, "shield", "p1", {});
  assert.deepEqual(shields.assign, { esc: "p1", arm: "p4" });
  assert.deepEqual(shields.moved, { esc: "p3" });
  // Depois de focar Escudos, o Escudo está em p1; focar Armas devolve o Escudo pra p3.
  const after = [{ id: "esc", role: "shield", groupId: "p1" }, { id: "arm", role: "weapon", groupId: "p4" }];
  const weapons = focusGroupAssignments(after, "weapon", "p1", shields.moved);
  assert.deepEqual(weapons.assign, { esc: "p3", arm: "p1" });
  assert.deepEqual(weapons.moved, { arm: "p4" });
  assert.deepEqual(focusGroupAssignments(after, null, "p1", shields.moved).assign, { esc: "p3", arm: "p4" });
});

test("estado do grupo: cheio, parcial, sem energia e vazio", () => {
  assert.equal(powerGroupState(0, 0), "empty");
  assert.equal(powerGroupState(130, 130), "full");
  assert.equal(powerGroupState(130, 104), "partial");
  assert.equal(powerGroupState(80, 0), "none");
});

test("orçamento de energia: a reserva cobre o que puder e a previsão bate com o tick", () => {
  // Os números do print: pedem 400, o Distribuidor deixa passar 25, a reserva tem 269.
  const short = powerBudget({ demand: 400, generation: 25, capacitor: 269, capacitorMax: 269 });
  assert.equal(short.shortage, true);
  assert.equal(short.delivered, 294);
  assert.equal(short.percent, 74);
  assert.equal(short.fromReserve, 269);
  assert.equal(short.missing, 106);
  assert.equal(short.roundsLeft, 0); // acaba nesta rodada
  assert.equal(short.afterReservePercent, 6);
  assert.equal(powerBudget({ demand: 400, generation: 25, capacitor: 800, capacitorMax: 1000 }).roundsLeft, 2);

  const ok = powerBudget({ demand: 400, generation: 750, capacitor: 120, capacitorMax: 1000 });
  assert.equal(ok.shortage, false);
  assert.equal(ok.slack, 350);
  assert.equal(ok.roundsToFull, 3); // 880 que faltam ÷ 350
  assert.equal(powerBudget({ demand: 400, generation: 750, capacitor: 1000, capacitorMax: 1000 }).roundsToFull, 0);
  assert.equal(powerBudget({ demand: 400, generation: 400, capacitor: 10, capacitorMax: 100 }).roundsToFull, null);
});

test("Estrutura: é Mecânica ao Usar, e a forma de 1.37 (Tipo de Alvo) é convertida", () => {
  assert.equal(isStructureMechanic({ effectType: "structure" }), true);
  assert.equal(isStructureMechanic({ effectType: "damage", targetType: "structure" }), true);
  assert.equal(isStructureMechanic({ effectType: "damage", targetType: "targeted" }), false);
  const legacy = migrateStructureTarget({ effectType: "none", targetType: "structure", structureId: "stone-wall" });
  assert.deepEqual(legacy, { effectType: "structure", targetType: "targeted", structureId: "stone-wall" });
  assert.ok(!MEU_SISTEMA.SKILL_TARGET_TYPES.includes("structure"));
  assert.ok(MEU_SISTEMA.SKILL_EFFECT_TYPES.includes("structure"));
});

test("elementos sem grupo salvo herdam o grupo do padrão de mesmo id", () => {
  // Sem setting (o stub lança), a lista é a padrão: todo elemento tem grupo e nada cai em "Outros".
  assert.ok(getActiveDamageElements().every(el => el.group && el.group !== "Outros"));
});

test("luz: sem 'enabled' não há luz; valores fora da faixa são limitados", () => {
  assert.equal(normalizeLightConfig(null), null);
  assert.equal(normalizeLightConfig({ enabled: false, color: "#ff0000" }), null);
  const light = normalizeLightConfig({ enabled: true, color: "vermelho", alpha: 3, dim: 4, bright: 9, speed: 50, intensity: -2, animation: "energy" });
  assert.deepEqual(light, { enabled: true, color: "#6ee7ff", alpha: 1, dim: 4, bright: 4, animation: "energy", speed: 10, intensity: 1 });
  // Raio 0 = automático: a luz forte não é cortada por um raio fraco que ainda não existe.
  assert.equal(normalizeLightConfig({ enabled: true, dim: 0, bright: 2 }).bright, 2);
});

test("luzes ao longo da parede: espalhadas por igual pelo comprimento", () => {
  assert.deepEqual(pointsAlongPolyline([[0, 0], [100, 0]], 2), [[25, 0], [75, 0]]);
  // Linha quebrada: o meio de 200 de comprimento cai na quina.
  assert.deepEqual(pointsAlongPolyline([[0, 0], [100, 0], [100, 100]], 1), [[100, 0]]);
  assert.deepEqual(pointsAlongPolyline([[5, 5]], 3), [[5, 5]]);
  assert.deepEqual(pointsAlongPolyline([], 3), []);
});

test("ataque atravessando Estrutura: acha a primeira no caminho", () => {
  assert.equal(segmentCrossing([0, 0], [100, 0], [50, -10, 50, 10]), 0.5);
  assert.equal(segmentCrossing([0, 0], [40, 0], [50, -10, 50, 10]), null); // para antes da parede
  assert.equal(segmentCrossing([0, 0], [100, 0], [0, 5, 100, 5]), null); // paralela
  const walls = [
    { id: "longe", segments: [[80, -10, 80, 10]] },
    { id: "perto", segments: [[30, -10, 30, 10]] }
  ];
  assert.deepEqual(firstStructureOnPath([0, 0], [100, 0], walls), { id: "perto", t: 0.3 });
  // Alvo e atacante dentro do mesmo quadrado: nada cruza.
  const box = { id: "caixa", segments: [[0, 0, 100, 0], [100, 0, 100, 100], [100, 100, 0, 100], [0, 100, 0, 0]] };
  assert.equal(firstStructureOnPath([20, 20], [80, 80], [box]), null);
  assert.equal(firstStructureOnPath([-50, 50], [50, 50], [box]).id, "caixa");
});

test("Estrutura segura até a capacidade e o resto passa", () => {
  assert.deepEqual(splitStructureHit(117, 60), { absorbed: 60, passed: 57 });
  assert.deepEqual(splitStructureHit(40, 60), { absorbed: 40, passed: 0 });
  assert.deepEqual(splitStructureHit(30, 0), { absorbed: 0, passed: 30 });
});

test("Dano Absoluto é o dano inteiro, com qualquer elemento junto", () => {
  // Fogo + Gelo, alvo imune a Fogo, resistente a Gelo, e o Pólaron teria bônus contra o Traço dele.
  const result = resolveDamageParts({
    parts: [
      { elementId: "fire", raw: 50, bonus: 0.3 },
      { elementId: "ice", raw: 50, penetration: 0.5 }
    ],
    magicDefense: 0.4,
    general: 0.2,
    resistanceFor: id => (id === "fire" ? 1 : 0.5),
    absolute: true
  });
  assert.equal(result.final, 100);
});

test("Escudo mantido: o pool regenera até o teto", () => {
  assert.equal(sustainedShieldGain(0, 40, 100), 40);
  assert.equal(sustainedShieldGain(80, 40, 100), 20); // não passa do teto
  assert.equal(sustainedShieldGain(130, 40, 100), 0); // Escudo de outra fonte acima do teto fica
  assert.equal(sustainedShieldGain(500, 40, 0), 40); // sem teto, entra tudo
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

test("camada de Nave: % por camada muda quanto a camada sofre, o vazamento segue na moeda do golpe", () => {
  assert.deepEqual(absorbLayer(100, 1000, 1), { absorbed: 100, leaked: 0 });
  assert.deepEqual(absorbLayer(100, 1000, 0.5), { absorbed: 50, leaked: 0 }); // torpedo fraco no Escudo
  assert.deepEqual(absorbLayer(100, 20, 0.5), { absorbed: 20, leaked: 60 }); // 20 de Escudo seguram 40 do golpe
  assert.deepEqual(absorbLayer(100, 0, 1), { absorbed: 0, leaked: 100 });
  assert.deepEqual(absorbLayer(100, 5, 0), { absorbed: 0, leaked: 0 }); // imune: segura sem sofrer
});

test("cascata de Nave: Resistência à Penetração por camada e % por camada", () => {
  // Sem resistência: 40% de Penetração passa direto pelo Escudo.
  const base = resolveShipCascade({ damage: 100, penetration: 0.4, shield: { value: 1000 }, casco: { value: 0 } });
  assert.deepEqual(base, { toShield: 60, toCasco: 0, toHull: 40, adapted: 0 });
  // Escudo com 15% de Resistência à Penetração: só 25% passa.
  const resisted = resolveShipCascade({ damage: 100, penetration: 0.4, shield: { value: 1000, penResist: 0.15 }, casco: { value: 0 } });
  assert.deepEqual(resisted, { toShield: 75, toCasco: 0, toHull: 25, adapted: 0 });
  // Torpedo: −50% no Escudo, +30% no Casco (Escudo zerado, Casco grande, sem Penetração).
  const torpedo = resolveShipCascade({ damage: 100, shield: { value: 0 }, casco: { value: 1000, multiplier: 1.3 } });
  assert.deepEqual(torpedo, { toShield: 0, toCasco: 130, toHull: 0, adapted: 0 });
  // Absoluto: Evasão vale, o resto vai inteiro pra Integridade, sem % de camada nem redução.
  const absolute = resolveShipCascade({ damage: 100, evasion: 0.2, absolute: true, damageReduction: 0.5, hullMultiplier: 2, shield: { value: 999 } });
  assert.deepEqual(absolute, { toShield: 0, toCasco: 0, toHull: 80, adapted: 0 });
  // Preparar para impacto: −50% de tudo que chegou.
  const braced = resolveShipCascade({ damage: 100, damageReduction: 0.5, shield: { value: 1000 } });
  assert.equal(braced.toShield, 50);
});

test("mirar num sistema e endurecimento", () => {
  assert.deepEqual(splitTargetedStructural(100, 500, 0.75), { toTarget: 75, toSpread: 25 });
  assert.deepEqual(splitTargetedStructural(100, 30, 0.75), { toTarget: 30, toSpread: 70 }); // Módulo não aguenta: o resto espalha
  assert.equal(hardenedChance(20, 30), 14);
  assert.equal(hardenedChance(50, 0), 50);
});

test("Escudo pessoal com % de camada: torpedo fraco no Escudo, phaser forte", () => {
  // 100 de dano, Escudo 20, elemento −50% no Escudo: o Escudo segura 40 do golpe (perde 20), 60 na Vida.
  assert.deepEqual(splitShieldDamage(100, 20, { shieldMultiplier: 0.5 }), { toShield: 20, toHp: 60 });
  // +20% no Escudo: 50 de dano com Escudo 100 = Escudo perde 60, Vida intacta.
  assert.deepEqual(splitShieldDamage(50, 100, { shieldMultiplier: 1.2 }), { toShield: 60, toHp: 0 });
  // Multiplicador 1 continua igual ao de sempre.
  assert.deepEqual(splitShieldDamage(20, 10), { toShield: 10, toHp: 10 });
});

test("Condição com tick no Casco de Nave", () => {
  const burn = { id: "plasma-burn", effect: { kind: "tick", tickTarget: "shipCasco", value: 12, durationRounds: 3 } };
  const entry = resolveConditionEffect(burn, {});
  assert.equal(entry.target, "shipCasco");
  assert.equal(entry.amount, -12);
  assert.equal(entry.periodic, true);
});

test("Escudo em pools: o mais recente apanha primeiro, um de cada vez", () => {
  const pools = [
    { id: "a", value: 30, order: 1 },
    { id: "b", value: 20, order: 2 } // mais recente
  ];
  const hit = consumeShieldPools(pools, 10, 35);
  assert.deepEqual(hit.pools.map(p => [p.id, p.value]), [["b", 0], ["a", 15]]);
  assert.equal(hit.loose, 10);
  assert.equal(hit.toShield, 35);
  assert.equal(hit.toHp, 0);
  // Estoura tudo: o avulso é o último.
  const big = consumeShieldPools(pools, 10, 100);
  assert.equal(big.toShield, 60);
  assert.equal(big.toHp, 40);
});

test("Escudo em pools: Penetração age em cada camada, e dano menor que 1 some", () => {
  // Penetração 50%, dois pools grandes: o 1º segura 50, passam 50; o 2º segura 25, passam 25.
  const hit = consumeShieldPools([{ id: "a", value: 1000, order: 1 }, { id: "b", value: 1000, order: 2 }], 0, 100, { penetration: 0.5 });
  assert.deepEqual(hit.pools.map(p => p.value), [950, 975]);
  assert.equal(hit.toHp, 25);
  // Cada camada divide de novo até sobrar menos de 1, que é descartado.
  const tiny = consumeShieldPools([{ id: "a", value: 999, order: 3 }, { id: "b", value: 999, order: 2 }, { id: "c", value: 999, order: 1 }], 0, 3, { penetration: 0.5 });
  assert.equal(tiny.toHp, 0);
});

test("Escudo digitado à mão ajusta os pools", () => {
  const pools = [{ id: "a", value: 30, order: 1 }, { id: "b", value: 20, order: 2 }];
  assert.deepEqual(reconcileShieldPools(pools, 40).map(p => p.value), [30, 10]); // tira do mais recente
  assert.deepEqual(reconcileShieldPools(pools, 15).map(p => p.value), [15, 0]); // atravessa pro mais antigo
  assert.deepEqual(reconcileShieldPools(pools, 80).map(p => p.value), [30, 20]); // aumentar vira avulso
});

test("Raio trator: segura conforme a diferença de Porte, sobrecarga ajuda", () => {
  assert.equal(tractorHold(2, 2), 1); // mesmo Porte
  assert.equal(tractorHold(2, 0), 1); // alvo menor
  assert.equal(tractorHold(1, 2), 0.5); // um Porte acima
  assert.equal(tractorHold(1, 3), 0.25);
  assert.equal(tractorHold(0, 4), 0); // grande demais
  assert.equal(tractorHold(1, 2, 2), 1); // throttle 200% compensa um Porte
});

test("Escudo adaptativo: aprende por elemento + frequência, com teto, e reduz o golpe de pé", () => {
  let adaptation = {};
  adaptation = adaptShield(adaptation, ["phaser"], 0, 30, 75);
  adaptation = adaptShield(adaptation, ["phaser"], 0, 30, 75);
  adaptation = adaptShield(adaptation, ["phaser"], 0, 30, 75);
  assert.equal(adaptation[shieldAdaptationKey("phaser", 0)], 75); // teto
  assert.equal(shieldAdaptationFor(adaptation, ["phaser"], 0), 75);
  assert.equal(shieldAdaptationFor(adaptation, ["phaser"], 412), 0); // modulou: recomeça
  assert.equal(shieldAdaptationFor(adaptation, ["phaser", "plasma"], 0), 37.5); // média das partes
  assert.equal(adaptShield({}, [], 0, 10, 200)[shieldAdaptationKey("", 0)], 10); // sem elemento
  assert.equal(adaptShield({}, ["x"], 0, 200, 200)[shieldAdaptationKey("x", 0)], 95); // nunca 100%
  const base = { damage: 100, shield: { value: 500 }, casco: { value: 0 } };
  assert.equal(resolveShipCascade(base).toShield, 100);
  const adapted = resolveShipCascade({ ...base, shield: { value: 500, adaptation: 0.75 } });
  assert.equal(adapted.toShield, 25);
  assert.equal(adapted.adapted, 75);
  // Escudo caído não adapta nada.
  assert.equal(resolveShipCascade({ damage: 100, shield: { value: 0, adaptation: 0.75 }, casco: { value: 0 } }).toHull, 100);
});

test("Antimagia: marca Mágica e custo extra por nível", () => {
  const char = { type: "character" };
  const ship = { type: "starship" };
  assert.equal(isMagicUse({ cost: 10 }, char), true); // custa Mana
  assert.equal(isMagicUse({ cost: 0, hasUpkeep: true, upkeepCost: 5 }, char), true);
  assert.equal(isMagicUse({ cost: 0, isMagicDamage: true }, char), true);
  assert.equal(isMagicUse({ cost: 0 }, char), false);
  assert.equal(isMagicUse({ cost: 10, magicTag: "mundane" }, char), false); // o Mestre desmarca
  assert.equal(isMagicUse({ cost: 0, magicTag: "magic" }, char), true);
  assert.equal(isMagicUse({ cost: 10 }, ship), false); // Nave paga com a Bateria
  assert.equal(antimagicSurcharge(20, 0), 0);
  assert.equal(antimagicSurcharge(20, 1), 30);
  assert.equal(antimagicSurcharge(20, 2), 90);
  assert.equal(antimagicSurcharge(20, 3), 210);
  assert.equal(antimagicSurcharge(0, 1, { base: 5, growth: 3 }), 10);
});

test("Vantagem entre elementos: níveis, multiplicação, média das partes e o antigo percentual", () => {
  const matrix = buildAffinityMatrix([
    { id: "fire", affinity: { ice: 1, plant: 2, fire: -1 } },
    { id: "water", effects: [{ type: "vsElement", element: "fire", percent: 50 }] }, // antigo → Efetivo
    { id: "ghost", affinity: { normal: -2 } }
  ]);
  assert.deepEqual(matrix.water, { fire: 1 });
  assert.equal(affinityMultiplier(-2), 0);
  assert.equal(affinityMultiplier(-1), 0.5);
  assert.equal(affinityMultiplier(0), 1);
  assert.equal(affinityMultiplier(1), 1.5);
  assert.equal(affinityMultiplier(2), 2);
  assert.equal(affinityMultiplier(2, { superEffective: 3 }), 3);
  assert.equal(elementVsDefender("fire", ["ice"], matrix), 1.5);
  assert.equal(elementVsDefender("fire", ["ice", "plant"], matrix), 3); // multiplica (1,5 × 2)
  assert.equal(elementVsDefender("fire", [], matrix), 1);
  assert.equal(elementVsDefender("ghost", ["normal"], matrix), 0);
  assert.equal(hitAffinityFactor(["fire", "water"], ["fire"], matrix), (0.5 + 1.5) / 2); // metade de cada
  assert.equal(hitAffinityFactor([], ["ice"], matrix), 1);
  assert.equal(cycleAffinityLevel(0, 1), 1);
  assert.equal(cycleAffinityLevel(2, 1), 2);
  assert.equal(cycleAffinityLevel(0, -1), -1);
  assert.equal(cycleAffinityLevel(-2, -1), -2);
});

test("Vantagem entre elementos no dano de Personagem e nos pools de Escudo", () => {
  // Parte de Fogo contra corpo de Gelo (×1,5): o Escudo recebe o golpe sem essa vantagem.
  const result = resolveDamageParts({ parts: [{ elementId: "fire", raw: 100, affinity: 1.5 }] });
  assert.equal(result.final, 150);
  assert.equal(result.shieldBase, 100);
  const immune = resolveDamageParts({ parts: [{ elementId: "fire", raw: 100, affinity: 0 }] });
  assert.equal(immune.final, 0);
  assert.equal(immune.shieldBase, 100);
  // Pool de Água (ineficaz contra ele: ×0,5 no que ele sofre) segura o dobro.
  const pools = [{ id: "a", value: 20, order: 2, elements: ["water"] }];
  const out = consumeShieldPools(pools, 0, 100, { layerMultiplier: pool => (pool.elements.includes("water") ? 0.5 : 1) });
  assert.equal(out.toShield, 20);
  assert.equal(out.toHp, 60); // 100 − 40 (20 de Escudo seguram 40 de golpe)
});

test("Geometria: ponto dentro de forma fechada e cruzamento de segmentos", () => {
  const square = [[0, 0, 10, 0], [10, 0, 10, 10], [10, 10, 0, 10], [0, 10, 0, 0]];
  assert.equal(pointInSegments([5, 5], square), true);
  assert.equal(pointInSegments([15, 5], square), false);
  assert.equal(segmentsCross([[-5, 5, 5, 5]], square), true);
  assert.equal(segmentsCross([[2, 2, 8, 8]], square), false);
});

test("Inventário: pilhas, contêineres, peso e carga", () => {
  assert.equal(stackCount(0, 20), 0);
  assert.equal(stackCount(1, 20), 1);
  assert.equal(stackCount(20, 20), 1);
  assert.equal(stackCount(21, 20), 2);
  assert.equal(stackCount(5, 0), 1); // sem tamanho: padrão 20
  const load = inventoryLoad(
    [
      { id: "potion", quantity: 25, stackSize: 20, weight: 0.5, containerId: "" },
      { id: "bag", quantity: 1, weight: 1, isContainer: true },
      { id: "rope", quantity: 1, stackSize: 1, weight: 10, containerId: "bag" },
      { id: "gold-bar", quantity: 3, stackSize: 1, weight: 2, containerId: "sumiu" }
    ],
    [{ id: "bag", slots: 4, weightReduction: 50 }]
  );
  assert.equal(load.looseSlots, 2 + 1 + 3); // poções (2 pilhas) + bolsa + barras soltas
  assert.equal(load.byContainer.bag.used, 1);
  assert.equal(load.weight, 12.5 + 1 + 5 + 6);
  assert.equal(currencyWeight({ gold: 100 }, [{ id: "gold", weight: 0.01 }]), 1);
  assert.equal(carryCapacity({ base: 30, strength: 10, defense: 10, bonus: 5 }), 50);
  assert.equal(encumbrancePenalty(40, 50), 0);
  assert.equal(encumbrancePenalty(60, 50), 20);
  assert.equal(encumbrancePenalty(200, 50), 100);
  assert.deepEqual(speciesCarry(undefined, "anao"), { slots: 12, carry: 45 });
  assert.deepEqual(speciesCarry({ inventorySlots: 5, carryBase: 7 }, "anao"), { slots: 5, carry: 7 });
  assert.deepEqual(speciesCarry(undefined, "especie-nova"), { slots: 10, carry: 30 });
});

test("Porão e munição", () => {
  assert.equal(cargoSlotsFor("compact"), 10);
  assert.equal(cargoSlotsFor("colossal", 1.5), 240);
  assert.equal(cargoSlotsFor("standard", 0.75), 15);
  assert.equal(cargoMassFactor(0, 2000), 1);
  assert.equal(cargoMassFactor(2000, 2000), 2);
  assert.equal(cargoMassFactor(500, 0), 1);
  const launcher = { usesAmmo: true, ammoTypes: ["torpedo", "mine"], moduleSize: "standard" };
  assert.equal(ammoFitsLauncher({ enabled: true, type: "torpedo" }, launcher), true);
  assert.equal(ammoFitsLauncher({ enabled: true, type: "missile" }, launcher), false);
  assert.equal(ammoFitsLauncher({ enabled: true, type: "torpedo", minLauncherSize: "reinforced" }, launcher), false);
  assert.equal(ammoFitsLauncher({ enabled: true, type: "torpedo" }, { ...launcher, usesAmmo: false }), false);
});

test("Active Effect: formato V13 e V14, e leitura dos dois", async () => {
  const { buildEffectChanges, readEffectChanges } = await import("../module/helpers/foundry-compat.js");
  const changes = [{ key: "system.attributes.combat.strength.buffDelta", mode: 2, value: 3 }, { key: "x", mode: 5, value: "fire" }];
  assert.deepEqual(buildEffectChanges(changes, 13), { changes: [{ key: "system.attributes.combat.strength.buffDelta", mode: 2, value: "3" }, { key: "x", mode: 5, value: "fire" }] });
  const v14 = buildEffectChanges(changes, 14);
  assert.deepEqual(v14.system.changes, [{ key: "system.attributes.combat.strength.buffDelta", type: "add", value: "3" }, { key: "x", type: "override", value: "fire" }]);
  assert.equal(v14.changes, undefined);
  assert.deepEqual(readEffectChanges(v14), [{ key: "system.attributes.combat.strength.buffDelta", mode: 2, value: "3" }, { key: "x", mode: 5, value: "fire" }]);
  assert.deepEqual(readEffectChanges(buildEffectChanges(changes, 13)), readEffectChanges(v14));
  assert.deepEqual(readEffectChanges({ system: { changes: [{ key: "k", type: "multiply", value: "1.2" }] } }), [{ key: "k", mode: 1, value: "1.2" }]);
});

import {
  makeAnchor,
  sameAnchor,
  addAnchor,
  removeAnchor,
  effectAnchors,
  finiteRemaining,
  serializeFinite,
  anchorLifetime,
  durationRemaining,
  refreshFiniteRounds,
  PERMANENT
} from "../module/combat/effect-anchors.js";

test("Âncoras de Skill Ativa: A e B seguram o mesmo efeito, desligar A não derruba B", () => {
  const a = makeAnchor({ skillUuid: "Actor.lux.Item.a", skillId: "a" });
  const b = makeAnchor({ skillUuid: "Actor.lux.Item.b", skillId: "b" });
  let anchors = addAnchor([], a);
  anchors = addAnchor(anchors, b);
  assert.equal(addAnchor(anchors, a).length, 2, "religar A não duplica");

  const afterA = removeAnchor(anchors, a);
  assert.equal(afterA.removed, true);
  assert.equal(anchorLifetime({ anchors: afterA.anchors }).alive, true, "B ainda segura");
  const afterB = removeAnchor(afterA.anchors, b);
  assert.equal(anchorLifetime({ anchors: afterB.anchors }).alive, false);
  assert.equal(removeAnchor(afterB.anchors, b).removed, false, "tirar de novo não faz nada");
});

test("Âncoras: Tokens não vinculados (mesmo id de Skill, uuids diferentes) são independentes", () => {
  const drone1 = makeAnchor({ skillUuid: "Scene.s.Token.t1.Actor.d.Item.x", skillId: "x" });
  const drone2 = makeAnchor({ skillUuid: "Scene.s.Token.t2.Actor.d.Item.x", skillId: "x" });
  assert.equal(sameAnchor(drone1, drone2), false);
  const { anchors, removed } = removeAnchor([drone1, drone2], drone1);
  assert.equal(removed, true);
  assert.deepEqual(anchors, [drone2]);
  // Sub-Skills da mesma Skill são âncoras diferentes.
  assert.equal(sameAnchor(makeAnchor({ skillUuid: "u", subSkillIndex: 0 }), makeAnchor({ skillUuid: "u", subSkillIndex: 1 })), false);
});

test("Âncoras: formato antigo (sem uuid / tiedToActive) continua sendo entendido", () => {
  const legacyPeriodic = { sourceSkillId: "a", sourceSubSkillIndex: null };
  assert.equal(sameAnchor(legacyPeriodic, makeAnchor({ skillUuid: "Actor.lux.Item.a", skillId: "a" })), true, "sem uuid compara por id");
  const flags = { tiedToActive: true, sourceSkillId: "a", sourceSubSkillIndex: null };
  const anchors = effectAnchors(flags, "Actor.lux.Item.a");
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].skillUuid, "Actor.lux.Item.a");
  assert.deepEqual(effectAnchors({ tiedToActive: false }), []);
  // Lista gravada (mesmo vazia) vence a flag antiga.
  assert.deepEqual(effectAnchors({ tiedToActive: true, sourceSkillId: "a", activeAnchors: [] }), []);
});

test("Âncoras: prazo finito corre em paralelo e volta quando a última Skill desliga", () => {
  const now = { round: 4, combatId: "c1" };
  // Buff comum de 3 rodadas aplicado na rodada 4 e depois ancorado por uma Skill Ativa.
  const finite = serializeFinite(3, now);
  assert.equal(finiteRemaining(finite, { round: 5, combatId: "c1" }), 2);
  assert.equal(finiteRemaining(finite, { round: 9, combatId: "c1" }), 0);
  assert.equal(finiteRemaining(finite, { round: 9, combatId: "outro" }), 3, "outro combate não conta tempo");
  assert.equal(finiteRemaining(serializeFinite(PERMANENT, now), now), PERMANENT);
  assert.equal(finiteRemaining(null, now), 0);

  const anchor = makeAnchor({ skillUuid: "u" });
  assert.deepEqual(anchorLifetime({ anchors: [anchor], finite: 2 }), { alive: true, untilOff: false, permanent: false });
  assert.deepEqual(anchorLifetime({ anchors: [anchor], finite: 0 }), { alive: true, untilOff: true, permanent: false });
  assert.equal(anchorLifetime({ anchors: [], finite: 2 }).alive, true, "Skill desligada, prazo finito ainda vale");
  assert.equal(anchorLifetime({ anchors: [], finite: 0 }).alive, false);
});

test("Âncoras: duração do Foundry e reaplicação com prazo (0 rodadas = permanente)", () => {
  assert.equal(durationRemaining({ rounds: 5, startRound: 2 }, 4), 3);
  assert.equal(durationRemaining({ rounds: 5, startRound: 2 }, 10), 0);
  assert.equal(durationRemaining({ rounds: 5, startRound: 2 }, null), 5);
  assert.equal(durationRemaining({ rounds: null }, 4), PERMANENT);
  assert.equal(durationRemaining({}, null), PERMANENT);

  assert.equal(refreshFiniteRounds(2, 5), 5);
  assert.equal(refreshFiniteRounds(5, 2), 5, "renova, não soma nem encurta");
  assert.equal(refreshFiniteRounds(PERMANENT, 3), PERMANENT, "3 rodadas por cima de permanente não o torna finito");
  assert.equal(refreshFiniteRounds(3, 0), PERMANENT, "aplicação permanente vence o prazo");
});

import { buildCatalogIndex, checkMechanic, checkConditionals, validateItem, validateActor, validateCatalogs } from "../module/world/world-validator.js";

const VALIDATOR_CATALOGS = {
  conditions: [{ id: "burn", label: "Queimadura", elements: ["fire"] }, { id: "slow", label: "Lentidão", effect: { kind: "modifier", modTarget: "movement" } }],
  elements: [
    { id: "fire", label: "Fogo", effects: [{ type: "condition", conditionId: "burn" }], affinity: { ice: 1 } },
    { id: "ice", label: "Gelo", effects: [{ type: "traitBonus", trait: "organic" }] }
  ],
  structures: [{ id: "wall", label: "Muralha", elements: ["ice"] }],
  scales: [{ id: "personal" }, { id: "ship" }],
  attributes: ["strength", "magic", "dexterity"],
  traits: [{ id: "organic" }],
  species: { humano: { label: "Humano", traits: ["organic"], skills: [] } },
  ammoTypes: [{ id: "torpedo" }],
  crewRoles: [{ id: "pilot" }],
  moduleCategories: [{ id: "weapon" }, { id: "shield" }],
  shipSizes: [{ id: "mini" }, { id: "medio" }, { id: "capital" }],
  vehicleSizes: [{ id: "mini" }],
  shipClasses: [{ id: "fighter", label: "Caça", minSize: "mini", maxSize: "mini", slots: { weapon: 2 } }],
  vehicleClasses: [],
  scaleMaps: { shipSizeMap: { mini: "personal", medio: "ship" }, vehicleSizeMap: {} }
};
const VIDX = buildCatalogIndex(VALIDATOR_CATALOGS);

test("Validador: referência válida não gera aviso; quebrada gera exatamente um", () => {
  const ok = { effects: [{ conditionId: "burn", damageElements: ["fire"] }], damageElements: ["ice"], structureId: "", damageScale: "ship", scalingAttribute: "magic", resistanceTarget: "general" };
  assert.deepEqual(checkMechanic(ok, VIDX), []);
  const broken = checkMechanic({ effects: [{ conditionId: "nullified" }] }, VIDX);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].catalog, "conditions");
  assert.equal(broken[0].where, "Efeito 1 › Condição");
  assert.match(broken[0].message, /"nullified" não existe em Condições/);
});

test("Validador: mecânica de Skill — Sub-Skills, Estrutura, Resistência e escala", () => {
  const issues = checkMechanic(
    { effectType: "structure", structureId: "gone", resistanceTarget: "void", damageScale: "galaxy", scalingAttribute: "luck", subSkills: [{ name: "Corte", damageElements: ["plasma"] }] },
    VIDX
  );
  assert.deepEqual(issues.map(i => i.catalog).sort(), ["attributes", "elements", "elements", "scales", "structures"]);
  assert.ok(issues.some(i => i.where === "Sub-Skill 1 (Corte) › Elementos de dano"));
});

test("Validador: Quando → Então e Itens", () => {
  const mods = [
    { when: { kind: "otherTrait", value: "dragon" }, then: { kind: "damagePercent", target: "any" } },
    { when: { kind: "selfCondition", value: "burn" }, then: { kind: "rollFlat", target: "any" } },
    { when: { kind: "always" }, then: { kind: "resistancePercent", target: "void" } }
  ];
  assert.deepEqual(checkConditionals(mods, VIDX).map(i => i.ref), ["dragon", "void"]);

  // Arma desligada não é conferida; ligada, sim.
  const weapon = { name: "Espada", type: "item", system: { weapon: { enabled: false, damageElements: ["x"] } } };
  assert.deepEqual(validateItem(weapon, VIDX), []);
  weapon.system.weapon.enabled = true;
  assert.equal(validateItem(weapon, VIDX).length, 1);
  // Habilidade Concedida sem nome = nunca usada.
  assert.deepEqual(validateItem({ type: "item", system: { grantsSkill: { name: "", damageElements: ["x"] } } }, VIDX), []);
  assert.equal(validateItem({ type: "starship_module", system: { category: "warpcore", ammoTypes: ["torpedo"] } }, VIDX).length, 1);
  assert.equal(validateItem({ type: "title", system: { resistances: [{ target: "general" }, { target: "x" }] } }, VIDX).length, 1);
});

test("Validador: Personagem — Espécie, Traços e contêiner", () => {
  const actor = {
    type: "character",
    system: { species: "dragao", traits: ["organic"], traitsRemoved: [], scale: "" },
    items: [
      { _id: "bag", name: "Mochila", type: "item", system: { container: { enabled: true } } },
      { _id: "a", name: "Poção", type: "item", system: { containerId: "bag" } },
      { _id: "b", name: "Corda", type: "item", system: { containerId: "lost" } },
      { _id: "s", name: "Bola de Fogo", type: "skill", system: { effects: [{ conditionId: "frozen" }] } }
    ]
  };
  const issues = validateActor(actor, VIDX);
  assert.deepEqual(issues.map(i => i.where), ["Espécie", "Corda › Guardado em", "Bola de Fogo › Efeito 1 › Condição"]);
  assert.equal(issues[2].itemId, "s");
});

test("Validador: Nave — Porte, Classe fora da faixa, tripulante apagado e grupo de prioridade", () => {
  const ship = {
    type: "starship",
    system: { shipSize: "medio", shipClass: "fighter", crewMembers: [{ actorUuid: "Actor.vivo", role: "pilot" }, { actorUuid: "Actor.morto", role: "cook" }], powerGroups: [] },
    items: [
      { _id: "m1", name: "Canhão", type: "starship_module", system: { category: "weapon", powerGroup: "p2" } },
      { _id: "m2", name: "Escudo", type: "starship_module", system: { category: "shield", powerGroup: "g-apagado" } }
    ]
  };
  const issues = validateActor(ship, VIDX, { uuidExists: uuid => uuid === "Actor.vivo" });
  assert.deepEqual(issues.map(i => i.where), ["Classe", "Tripulação 2", "Tripulação 2 › Posto", "Escudo › Prioridade"]);
  assert.match(issues[0].message, /fora da faixa/);
  // Porte apagado do catálogo.
  assert.equal(validateActor({ type: "starship", system: { shipSize: "titan" }, items: [] }, VIDX)[0].catalog, "shipSizes");
});

test("Validador: referências entre catálogos", () => {
  assert.deepEqual(validateCatalogs(VALIDATOR_CATALOGS), []);
  const broken = {
    ...VALIDATOR_CATALOGS,
    elements: [{ id: "void", label: "Vazio", effects: [{ type: "condition", conditionId: "nullified" }], affinity: { ghost: -2 } }],
    species: { dragao: { label: "Dragão", traits: ["wings"], skills: [{ name: "Sopro", damageElements: ["fire"] }] } }
  };
  const issues = validateCatalogs(broken);
  const byEntry = issues.map(i => `${i.entry}: ${i.where}`);
  assert.ok(byEntry.includes("Vazio: Efeito 1 › Condição"));
  assert.ok(byEntry.includes("Vazio: Tabela de vantagens"));
  assert.ok(byEntry.includes("Dragão: Traços"));
  assert.ok(byEntry.includes("Dragão: Skill Racial 1 (Sopro) › Elementos de dano"), "Fogo saiu do catálogo de elementos");
  assert.ok(byEntry.includes("Queimadura: Elementos"));
  assert.ok(byEntry.includes("Muralha: Elementos"));
});

import { explainAttribute, explainVital } from "../module/combat/stat-explain.js";

test("Explicação de Atributo: mesmas contas da ficha (Total, Efetivo, Bônus, Pool)", () => {
  const ex = explainAttribute({
    points: 20,
    titles: [{ label: "Caçador Arcano", value: 7 }],
    buffs: [{ label: "Bênção", value: 10 }],
    buffActual: 10,
    conditionals: [{ label: "Fúria (Vida < 30%)", value: 3 }],
    items: [{ label: "Espada", value: 4 }]
  });
  assert.equal(ex.total, 27, "pontos + Título");
  assert.equal(ex.effectiveTotal, 40, "Total + buff + condicional");
  assert.equal(ex.bonus, 13);
  assert.equal(ex.diceCount, 2);
  assert.equal(ex.flat, 3);
  assert.equal(ex.itemBonus, 4);
  assert.equal(ex.formula, "2d20+7", "o mesmo que buildAttributeRollFormula(13, 4)");
  assert.equal(buildAttributeRollFormula(ex.bonus, ex.itemBonus), ex.formula);
});

test("Explicação de Atributo: diferença não identificada e prévia de pontos pendentes", () => {
  const ex = explainAttribute({ points: 9, buffs: [{ label: "Bênção", value: 2 }], buffActual: 5, pending: 3 });
  const unknown = ex.temporary.find(row => row.unknown);
  assert.equal(unknown.value, 3, "efeito de outro módulo vira linha própria");
  assert.equal(ex.effectiveTotal, 14, "a conta fecha com o buffDelta real");
  assert.equal(ex.previewBonus, Math.floor(17 / 3));
  assert.equal(explainAttribute({ points: 9 }).previewBonus, null);
});

test("Explicação de Vida/Mana: fórmula, piso, modificadores e mínimo", () => {
  const hp = explainVital({
    pair: [{ label: "Força", total: 12 }, { label: "Defesa", total: 10 }],
    multiplier: 10,
    floor: 50,
    permanent: [{ label: "Título", value: 50 }, { label: "Anel", value: -20 }],
    buffs: [{ label: "Vigor", value: 30 }],
    buffActual: 30,
    min: 1
  });
  assert.equal(hp.formulaValue, 1200);
  assert.equal(hp.floorApplied, false);
  assert.equal(hp.max, 1260);

  const low = explainVital({ pair: [{ total: 1 }, { total: 2 }], multiplier: 10, floor: 50, permanent: [{ value: -200 }], min: 1 });
  assert.equal(low.formulaValue, 20);
  assert.equal(low.floorApplied, true);
  assert.equal(low.base, 50);
  assert.equal(low.minApplied, true);
  assert.equal(low.max, 1);

  assert.deepEqual(explainVital({ enabled: false }), { enabled: false, max: 0 });
});

import { describeDamageParts } from "../module/combat/damage-rules.js";

test("Rastro de dano (Mestre): uma linha por defesa, na ordem aplicada", () => {
  const labels = { elementLabel: id => ({ fire: "Fogo", ice: "Gelo" })[id] ?? id, generalLabel: "Resistência Geral (Pele de Pedra)", elementSourceLabel: id => (id === "ice" ? "Sangue Frio" : "") };
  const result = resolveDamageParts({
    parts: [
      { elementId: "fire", raw: 50, penetration: 0.3, bonus: 0.2, affinity: 1.5 },
      { elementId: "ice", raw: 50 }
    ],
    magicDefense: 0.2,
    general: 0.5,
    resistanceFor: id => (id === "ice" ? 1 : 0)
  });
  const rows = describeDamageParts(result.parts, labels);
  const labelsOnly = rows.map(r => r.label);
  assert.deepEqual(labelsOnly, [
    "Parte Fogo",
    "Bônus contra Traço do alvo",
    "Penetração (suaviza cada defesa)",
    "Defesa Mágica",
    "Resistência Geral (Pele de Pedra)",
    "Vantagem contra o elemento do corpo",
    "= Fogo",
    "Parte Gelo",
    "Imunidade a Gelo (Sangue Frio)",
    "= Gelo"
  ]);
  assert.equal(rows.find(r => r.label === "Defesa Mágica").value, "−14%", "20% suavizado por 30% de Penetração");
  assert.equal(rows.find(r => r.label === "= Gelo").value, "0");
  // Fecha com o final: 50 × 1.2 × 0.86 × 0.65 × 1.5 = 50.31
  assert.equal(rows.find(r => r.label === "= Fogo").value, "50.3");
  assert.equal(result.final, 50);

  const single = describeDamageParts(resolveDamageParts({ parts: [{ elementId: null, raw: 30 }], absolute: true }).parts, labels);
  assert.deepEqual(single.map(r => r.label), ["Dano (sem elemento)", "Dano Absoluto: ignora defesas e vantagem"]);
});

import {
  speciesSlug,
  normalizeSpeciesEntry,
  bumpSpeciesVersions,
  resolveSpeciesTemplate,
  speciesDiff,
  isSpeciesLocked,
  racialSkillSystem
} from "../module/species/species-rules.js";

const DRAGOIDE = {
  label: "Dragoide",
  traits: ["organic", "draconic"],
  parts: [
    { key: "head", label: "Cabeça", slot: "head", hpMax: 14 },
    { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 12 },
    { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 12 },
    { key: "tail", label: "Cauda", slot: "tail", hpMax: 12 }
  ],
  skills: [
    { name: "Escamas Ancestrais", level: 1, effectType: "none" },
    { name: "Sopro Dracônico", level: 1, cost: 20, effectType: "damage" },
    { name: "Presença de Dragão", level: 1, unlockLevel: 10 }
  ],
  lineages: [{ id: "gelo", label: "Gelo", elements: ["ice"], skills: [{ key: "sopro_gelido", name: "Sopro Gélido" }], replaces: { skills: ["sopro_draconico"] } }]
};
const HUMANO = {
  label: "Humano",
  traits: ["organic"],
  parts: [
    { key: "head", label: "Cabeça", slot: "head", hpMax: 10 },
    { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 8 },
    { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 8 }
  ],
  skills: [{ name: "Adaptabilidade", level: 1 }]
};

test("Espécie: chaves estáveis e versão", () => {
  assert.equal(speciesSlug("Sopro Dracônico"), "sopro_draconico");
  const entry = normalizeSpeciesEntry({ skills: [{ name: "Corte" }, { name: "Corte" }], parts: [{ label: "Asa" }] });
  assert.deepEqual(entry.skills.map(s => s.key), ["corte", "corte_2"]);
  assert.equal(entry.parts[0].key, "asa");
  assert.equal(entry.version, 1);

  const before = { dragoide: normalizeSpeciesEntry(DRAGOIDE), humano: normalizeSpeciesEntry(HUMANO) };
  const edited = { ...before, dragoide: { ...before.dragoide, label: "Dragoide!", traits: [] } };
  assert.equal(bumpSpeciesVersions(before, edited).dragoide.version, 1, "nome e Traços são ao vivo: não sobem a versão");
  const withPart = { ...before, dragoide: { ...before.dragoide, parts: [...before.dragoide.parts, { key: "horns", label: "Chifres", slot: "horn", hpMax: 8 }] } };
  assert.equal(bumpSpeciesVersions(before, withPart).dragoide.version, 2, "parte nova sobe a versão");
  assert.equal(bumpSpeciesVersions(before, withPart).humano.version, 1);
});

test("Espécie: molde com Linhagem, Herança e Skill liberada por nível", () => {
  const low = resolveSpeciesTemplate({ species: DRAGOIDE, speciesId: "dragoide", lineage: DRAGOIDE.lineages[0], level: 3 });
  assert.deepEqual(low.skills.map(s => s.key), ["escamas_ancestrais", "sopro_gelido"], "Linhagem substitui o Sopro pela chave");
  assert.deepEqual(low.locked.map(s => s.key), ["presenca_de_dragao"]);
  assert.deepEqual(low.elements, ["ice"]);
  assert.equal(low.skills[1].source.kind, "lineage");
  const high = resolveSpeciesTemplate({ species: DRAGOIDE, speciesId: "dragoide", level: 10 });
  assert.ok(high.skills.some(s => s.key === "presenca_de_dragao"));

  const heritage = { traits: ["undead"], removesTraits: ["organic"], parts: [{ key: "cyber_arm", label: "Braço Cibernético", slot: "arm", hpMax: 20 }], replaces: { slots: ["arm"] } };
  const withHeritage = resolveSpeciesTemplate({ species: HUMANO, speciesId: "humano", heritages: [{ id: "ciborgue", entry: heritage }] });
  assert.deepEqual(withHeritage.traits, ["undead"], "Herança tira Orgânico");
  assert.deepEqual(withHeritage.parts.map(p => p.key), ["head", "cyber_arm"], "Herança troca partes pelo slot");
});

const tplOf = (species, id, level = 1) => resolveSpeciesTemplate({ species, speciesId: id, level });

test("Espécie: criação aplica tudo; troca leva prótese pelo slot e guarda a Skill que sai", () => {
  const fresh = speciesDiff({ parts: [], skills: [] }, tplOf(HUMANO, "humano"));
  assert.equal(fresh.parts.create.length, 3);
  assert.equal(fresh.skills.create.length, 1);
  assert.equal(fresh.losses.length, 0);

  const current = {
    parts: [
      { id: "p1", name: "Cabeça", slot: "head", grant: { key: "head" }, hp: { value: 7, max: 14 }, mods: [] },
      { id: "p2", name: "Braço Direito", slot: "arm", grant: { key: "right_arm" }, hp: { value: 20, max: 20 }, isProsthetic: true, mods: ["Braço de Adamantita"] },
      { id: "p3", name: "Braço Esquerdo", slot: "arm", grant: { key: "left_arm" }, hp: { value: 12, max: 12 }, mods: [] },
      { id: "p4", name: "Cauda", slot: "tail", grant: { key: "tail" }, hp: { value: 12, max: 12 }, mods: ["Ferrão de Aço"] },
      { id: "manual", name: "Implante Neural", slot: "head", grant: null, origin: "", hp: { value: 5, max: 5 }, mods: [] }
    ],
    skills: [
      { id: "s1", name: "Sopro Ígneo", tier: "racial", grant: { key: "sopro_draconico", source: { kind: "species", id: "dragoide" } }, level: 6, xp: 340 },
      { id: "s2", name: "Bola de Fogo", tier: "normal", grant: null, level: 3 },
      { id: "s3", name: "Garra (do item)", tier: "racial", grant: null, itemGranted: true, level: 1 }
    ]
  };
  const diff = speciesDiff(current, tplOf(HUMANO, "humano"));
  const head = diff.parts.update.find(p => p.id === "p1");
  assert.equal(head.hpMax, 10);
  assert.equal(head.hpValue, 5, "Vida atual na proporção (7/14 → 5/10)");
  const arm = [...diff.parts.update, ...diff.parts.keep].find(p => p.id === "p2");
  assert.equal(arm.hpMax, 20, "prótese mantém a própria Vida");
  assert.deepEqual(diff.parts.detach.map(p => p.id), ["p4"], "Cauda com implante fica como parte avulsa");
  assert.equal(diff.parts.remove.length, 0);
  assert.ok(!JSON.stringify(diff).includes('"manual"'), "parte criada à mão nunca entra");
  assert.deepEqual(diff.skills.remove.map(s => s.id), ["s1"]);
  assert.deepEqual(diff.skills.create.map(s => s.key), ["adaptabilidade"]);
  assert.ok(!JSON.stringify(diff.skills).includes('"s2"'), "Skill comprada nunca entra");
  assert.ok(!JSON.stringify(diff.skills).includes('"s3"'), "Skill concedida por Item nunca entra");
  assert.deepEqual(diff.losses, [{ kind: "skill", name: "Sopro Ígneo", level: 6, xp: 340 }]);
});

test("Espécie: dados antigos (sem marca) são reconhecidos e a Skill volta do histórico", () => {
  const legacy = {
    parts: [{ id: "p1", name: "Cabeça", slot: "head", grant: null, origin: "humano", hp: { value: 10, max: 10 }, mods: [] }],
    skills: [{ id: "s1", name: "Adaptabilidade", tier: "racial", grant: null, level: 4, xp: 10 }]
  };
  const same = speciesDiff(legacy, tplOf(HUMANO, "humano"));
  assert.equal(same.skills.keep[0].needsMark, true, "Skill antiga ganha a marca de origem, sem perder nível");
  assert.equal(same.skills.remove.length, 0);
  assert.ok([...same.parts.update, ...same.parts.keep].some(p => p.id === "p1"));

  const back = speciesDiff(
    { parts: [], skills: [], archive: [{ key: "adaptabilidade", source: { kind: "species", id: "humano" }, level: 4, xp: 10 }] },
    tplOf(HUMANO, "humano")
  );
  assert.deepEqual(back.skills.create[0].restored, { level: 4, xp: 10 });
  assert.equal(racialSkillSystem({ name: "X", level: 1, effectType: "bogus" }, { level: 4, xp: 10 }).level, 4);
  assert.equal(racialSkillSystem({ name: "X", effectType: "bogus" }).effectType, "none");
});

test("Espécie: sincronizar só acrescenta e ajusta, a menos que peça para remover", () => {
  const current = {
    parts: [{ id: "p1", name: "Cauda", slot: "tail", grant: { key: "tail" }, hp: { value: 12, max: 12 }, mods: [] }],
    skills: [{ id: "s1", name: "Velha", tier: "racial", grant: { key: "velha", hash: "x" }, level: 2 }]
  };
  const sync = speciesDiff(current, tplOf(HUMANO, "humano"), { mode: "sync" });
  assert.equal(sync.parts.remove.length, 0);
  assert.equal(sync.skills.remove.length, 0);
  assert.equal(sync.parts.create.length, 3);
  const purge = speciesDiff(current, tplOf(HUMANO, "humano"), { mode: "sync", removeMissing: true });
  assert.equal(purge.parts.remove.length, 1);
  assert.equal(purge.skills.remove.length, 1);
});

test("Espécie: trava do jogador", () => {
  assert.equal(isSpeciesLocked({ attributes: { combat: { strength: { points: 0 } } } }), false);
  assert.equal(isSpeciesLocked({ speciesState: { lockedAt: 1 } }), true);
  assert.equal(isSpeciesLocked({ attributes: { combat: { strength: { points: 3 } } } }), true, "ficha antiga com pontos já confirmados");
  assert.equal(isSpeciesLocked({ speciesState: { lockedAt: 1, unlocked: true } }), false, "o Mestre destravou");
});

import { sanitizeSkillMechanics, sanitizeWeapon, sanitizeItemBonuses, mechanicsGuide, simpleFormulaCheck } from "../module/ai/ai-mechanics.js";

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

test("Espécie: ficha antiga sem diferença real não aparece como desatualizada", () => {
  const legacy = {
    parts: [
      { id: "p1", name: "Cabeça", slot: "head", grant: null, origin: "humano", hp: { value: 10, max: 10 }, mods: [] },
      { id: "p2", name: "Braço Esquerdo", slot: "arm", grant: null, origin: "humano", hp: { value: 8, max: 8 }, mods: [] },
      { id: "p3", name: "Braço Direito", slot: "arm", grant: null, origin: "humano", hp: { value: 8, max: 8 }, mods: [] }
    ],
    skills: [{ id: "s1", name: "Adaptabilidade", tier: "racial", grant: null, level: 2 }]
  };
  const sync = speciesDiff(legacy, tplOf(HUMANO, "humano"), { mode: "sync" });
  assert.equal(sync.empty, true);
  assert.equal(sync.parts.keep.length, 3, "as partes ficam (e ganham a marca quando aplicadas)");
  const changed = speciesDiff({ ...legacy, skills: [{ ...legacy.skills[0], grant: { key: "adaptabilidade", hash: "velho" } }] }, tplOf(HUMANO, "humano"), { mode: "sync" });
  assert.equal(changed.skills.update.length, 1, "com hash diferente, a mecânica é atualizada");
});

import { originLayers, originAttributeRows, originStatRows, originResistance, originConditionalSources, originScale, originMovement } from "../module/species/species-rules.js";
import { originTraitIdsOf } from "../module/core/config.js";

test("Origem: passivos de Espécie, Linhagem e Herança somam ao vivo", () => {
  const layers = originLayers({
    species: { label: "Ogro", traits: ["organic"], passives: { attributeBonuses: [{ attribute: "strength", amount: 3 }], statModifiers: { hp: 20 }, resistances: [{ target: "poison", amount: 25 }] }, movement: { base: 5, percent: 0 } },
    lineage: { id: "montanha", label: "da Montanha", passives: { attributeBonuses: [{ attribute: "strength", amount: 1 }], resistances: [{ target: "poison", amount: 40 }] }, movement: { percent: -10 }, scale: "vehicle" },
    heritages: [{ id: "vamp", entry: { label: "Vampirizado", traits: ["undead"], removesTraits: ["organic"], elements: ["dark"], passives: { conditionalModifiers: [{ when: { kind: "always" }, then: { kind: "rollFlat", target: "any", value: 1 } }] } } }]
  });
  assert.deepEqual(originAttributeRows(layers, "strength").map(r => [r.label, r.value]), [["Espécie: Ogro", 3], ["Linhagem: da Montanha", 1]]);
  assert.deepEqual(originStatRows(layers, "hp").map(r => r.value), [20]);
  assert.equal(originResistance(layers, "poison"), 0.4, "fica a melhor, como Título");
  assert.equal(originConditionalSources(layers)[0].item.name, "Herança: Vampirizado");
  assert.equal(originScale(layers), "vehicle");
  assert.deepEqual(originMovement(layers), { base: 5, percent: -10 });
  assert.deepEqual(originTraitIdsOf(layers), ["undead"], "Herança tira Orgânico e soma Morto-vivo");
  assert.deepEqual(originLayers({}), []);
});

import { heritageConflicts } from "../module/species/species-rules.js";

const CYBORG = {
  id: "ciborgue",
  label: "Convertido em Ciborgue",
  traits: ["mechanical"],
  parts: [
    { key: "cyber_left_arm", label: "Braço Cibernético Esquerdo", slot: "arm", hpMax: 20, prosthetic: true },
    { key: "cyber_right_arm", label: "Braço Cibernético Direito", slot: "arm", hpMax: 20, prosthetic: true }
  ],
  replaces: { slots: ["arm"] },
  excludes: ["mutacao"],
  allowedSpecies: { mode: "except", list: ["androide"] }
};

test("Herança: ganhar troca os braços por próteses (com os implantes) e perder devolve", () => {
  const natural = {
    parts: [
      { id: "h", name: "Cabeça", slot: "head", grant: { key: "head" }, hp: { value: 10, max: 10 }, mods: [] },
      { id: "la", name: "Braço Esquerdo", slot: "arm", grant: { key: "left_arm" }, hp: { value: 4, max: 8 }, mods: [] },
      { id: "ra", name: "Braço Direito", slot: "arm", grant: { key: "right_arm" }, hp: { value: 8, max: 8 }, mods: ["Garra de Osso"] }
    ],
    skills: []
  };
  const withHeritage = resolveSpeciesTemplate({ species: HUMANO, speciesId: "humano", heritages: [{ id: "ciborgue", entry: CYBORG }] });
  const gain = speciesDiff(natural, withHeritage);
  const arms = gain.parts.update.filter(p => p.slot === "arm");
  assert.equal(arms.length, 2, "os braços são transformados, não apagados");
  assert.ok(arms.every(p => p.isProsthetic && p.hpMax === 20 && p.hpValue === 20), "prótese nova, Vida cheia");
  assert.ok(arms.some(p => p.carries.includes("Garra de Osso")), "o implante vai junto");
  assert.equal(gain.parts.remove.length + gain.parts.create.length, 0);

  const cyborg = {
    parts: [
      natural.parts[0],
      { id: "la", name: "Braço Cibernético Esquerdo", slot: "arm", grant: { kind: "heritage", key: "cyber_left_arm" }, isProsthetic: true, hp: { value: 10, max: 20 }, mods: [] },
      { id: "ra", name: "Braço Cibernético Direito", slot: "arm", grant: { kind: "heritage", key: "cyber_right_arm" }, isProsthetic: true, hp: { value: 20, max: 20 }, mods: [] }
    ],
    skills: []
  };
  const lose = speciesDiff(cyborg, resolveSpeciesTemplate({ species: HUMANO, speciesId: "humano" }));
  const back = lose.parts.update.filter(p => p.slot === "arm");
  assert.ok(back.every(p => p.isProsthetic === false && p.hpMax === 8), "voltam a ser braços naturais");
  assert.equal(back.find(p => p.id === "la").hpValue, 4, "Vida na proporção (10/20 → 4/8)");
});

test("Herança: regras de convivência (só avisam)", () => {
  const catalog = [CYBORG, { id: "mutacao", label: "Mutação", excludes: [] }, { id: "abencoado", excludes: ["ciborgue"] }];
  assert.deepEqual(heritageConflicts(CYBORG, { species: "humano", heritages: ["ciborgue"] }, catalog), []);
  assert.deepEqual(heritageConflicts(CYBORG, { species: "androide", heritages: ["ciborgue"] }, catalog), ["species-excluded"]);
  assert.deepEqual(heritageConflicts(CYBORG, { species: "humano", heritages: ["mutacao", "ciborgue"] }, catalog), ["excludes:mutacao"]);
  assert.deepEqual(heritageConflicts(CYBORG, { species: "humano", heritages: ["abencoado", "ciborgue"] }, catalog), ["excludes:abencoado"], "vale nos dois sentidos");
  const only = { id: "x", allowedSpecies: { mode: "only", list: ["elfo"] } };
  assert.deepEqual(heritageConflicts(only, { species: "humano", heritages: [] }, []), ["species-not-allowed"]);
});

test("Validador: Herança e Linhagem que não existem", () => {
  const catalogs = { ...VALIDATOR_CATALOGS, heritages: [{ id: "vampirizado", label: "Vampirizado", excludes: ["sumida"], removesTraits: ["organic"] }], species: { humano: { label: "Humano", lineages: [{ id: "norte" }] } } };
  const idx = buildCatalogIndex(catalogs);
  const issues = validateActor({ type: "character", system: { species: "humano", lineage: "sul", heritages: [{ id: "vampirizado" }, { id: "lobisomem" }] }, items: [] }, idx, { catalogs });
  assert.deepEqual(issues.map(i => i.where), ["Heranças", "Linhagem"]);
  assert.ok(validateCatalogs(catalogs).some(i => i.entry === "Vampirizado" && i.where === "Não convive com"));
});

import { evolutionOptions, evolutionResistanceUpgrades } from "../module/species/species-rules.js";

test("Evolução: destinos com nível mínimo só como aviso; destino apagado some", () => {
  const slime = normalizeSpeciesEntry({ label: "Slime", evolvesTo: [{ species: "demon_slime", minLevel: 10, hint: "Nomeado", resistancesToImmunity: true }, { species: "metal", minLevel: 15 }, { species: "apagada" }] });
  const catalog = { demon_slime: { label: "Slime Demoníaco" }, metal: { label: "Slime Metálico" } };
  const opts = evolutionOptions(slime, 12, catalog);
  assert.deepEqual(opts.map(o => [o.label, o.ready, o.missing]), [["Slime Demoníaco", true, 0], ["Slime Metálico", false, 3]]);
  assert.equal(opts[0].resistancesToImmunity, true);
  assert.equal(opts[0].keepLineage, true);
});

test("Evolução: Resistências Elementais sobem para Imunidade, a Geral não", () => {
  const ups = evolutionResistanceUpgrades([
    { id: "a", name: "Resistência: Veneno", resistanceTarget: "poison", level: 6 },
    { id: "b", name: "Resistência Geral", resistanceTarget: "general", level: 5 },
    { id: "c", name: "Imunidade: Fogo", resistanceTarget: "fire", level: 10 }
  ]);
  assert.deepEqual(ups.map(u => [u.id, u.toLevel]), [["a", 10]]);
});

test("Evolução: as Skills Raciais antigas ficam, o corpo muda", () => {
  const current = {
    parts: [{ id: "core", name: "Núcleo", slot: "core", grant: { key: "core" }, hp: { value: 30, max: 30 }, mods: [] }],
    skills: [{ id: "s1", name: "Regeneração Amorfa", tier: "racial", grant: { key: "regeneracao_amorfa", hash: "h" }, level: 4, xp: 20 }]
  };
  const diff = speciesDiff(current, tplOf(HUMANO, "humano"), { mode: "evolution" });
  assert.equal(diff.skills.remove.length, 0);
  assert.ok(diff.skills.keep.some(s => s.id === "s1" && s.fromPrevious));
  assert.deepEqual(diff.parts.remove.map(p => p.id), ["core"], "parte sem par e sem implante sai");
  assert.equal(diff.skills.create[0].key, "adaptabilidade");
});

import { legacyFunctionsFor, implantFits, partFunctions, bodyFunctionState, injuredMovement } from "../module/species/anatomy-rules.js";

const BODY_FNS = MEU_SISTEMA.DEFAULT_BODY_FUNCTIONS;
const leg = (id, hp, max = 10, extra = {}) => ({ id, name: id, slot: "leg", hpValue: hp, hpMax: max, functions: ["locomocao"], ...extra });
const arm = (id, hp, extra = {}) => ({ id, name: id, slot: "arm", hpValue: hp, hpMax: 8, functions: ["manipulacao"], ...extra });

test("Anatomia: tags antigas viram Funções pelo slot", () => {
  const known = BODY_FNS.map(f => f.id);
  assert.deepEqual(legacyFunctionsFor(["limb"], "arm", known), ["manipulacao"]);
  assert.deepEqual(legacyFunctionsFor(["limb"], "leg", known), ["locomocao"]);
  assert.deepEqual(legacyFunctionsFor(["limb", "flight"], "wing", known), ["voo"]);
  assert.deepEqual(legacyFunctionsFor(["vital"], "head", known).sort(), ["audicao", "visao", "vital"]);
  assert.deepEqual(legacyFunctionsFor(["vital", "regenerative"], "core", known), ["vital", "regenerativa"]);
  assert.deepEqual(legacyFunctionsFor(["mechanical", "chitinous"], "torso", known), []);
  assert.deepEqual(legacyFunctionsFor(["locomocao"], "tail", known), ["locomocao"], "Função conhecida passa direto");
});

test("Anatomia: locomoção proporcional (2 pernas, 4 patas, perna ferida)", () => {
  const two = bodyFunctionState([leg("l", 10), leg("r", 0), arm("a", 8)], BODY_FNS);
  assert.equal(two.movement.factor, 0.5);
  assert.equal(two.movement.crawl, null);
  assert.equal(injuredMovement(9, two.movement), 4);

  const four = bodyFunctionState([leg("1", 10), leg("2", 10), leg("3", 10), leg("4", 0)], BODY_FNS);
  assert.equal(four.movement.factor, 0.75);

  const wounded = bodyFunctionState([leg("l", 10), leg("r", 1.4 * 4, 10)], BODY_FNS);
  assert.ok(Math.abs(wounded.movement.factor - 0.78) < 0.001, "perna a 56% conta como 0,56 perna");
});

test("Anatomia: sem pernas, arrasta 1 m com os braços; sem braços também, fica parado", () => {
  const crawl = bodyFunctionState([leg("l", 0), leg("r", 0), arm("a", 3)], BODY_FNS);
  assert.equal(crawl.movement.crawl, 1);
  assert.equal(injuredMovement(9, crawl.movement), 1);
  const stuck = bodyFunctionState([leg("l", 0), leg("r", 0), arm("a", 0), arm("b", 0)], BODY_FNS);
  assert.equal(injuredMovement(9, stuck.movement), 0);
  const slime = bodyFunctionState([{ id: "core", name: "Núcleo", slot: "core", hpValue: 5, hpMax: 30, functions: ["vital", "regenerativa"] }], BODY_FNS);
  assert.equal(injuredMovement(6, slime.movement), 6, "Espécie sem partes de locomoção não é afetada");
});

test("Anatomia: prótese repõe a Função; implante para com a parte destruída", () => {
  const prosthetic = arm("a", 18, { isProsthetic: true, mods: [{ kind: "prosthesis", functions: ["manipulacao"] }] });
  assert.deepEqual(partFunctions(prosthetic), ["manipulacao"]);
  const legacyProsthesis = arm("b", 5, { isProsthetic: true, mods: [] });
  assert.deepEqual(partFunctions(legacyProsthesis), ["manipulacao"], "prótese antiga mantém as Funções naturais");
  const eye = { id: "h", name: "Cabeça", slot: "head", hpValue: 0, hpMax: 10, functions: ["visao"], mods: [{ kind: "implant", functions: ["audicao"] }] };
  const st = bodyFunctionState([eye], BODY_FNS);
  assert.ok(st.conditions.some(c => c.conditionId === "blindness"));
  assert.ok(st.conditions.some(c => c.conditionId === "deafness"), "o implante numa parte destruída também para");
});

test("Anatomia: Condições por parte × quando todas se perdem, Traço e regeneração", () => {
  const oneHand = bodyFunctionState([arm("a", 0), arm("b", 8)], BODY_FNS);
  assert.deepEqual(oneHand.conditions.map(c => [c.conditionId, c.count]), [["maimed", 1]]);
  const twoHeads = bodyFunctionState(
    [
      { id: "h1", name: "Cabeça 1", slot: "head", hpValue: 0, hpMax: 10, functions: ["visao"] },
      { id: "h2", name: "Cabeça 2", slot: "head", hpValue: 5, hpMax: 10, functions: ["visao"] }
    ],
    BODY_FNS
  );
  assert.equal(twoHeads.conditions.length, 0, "Cego só quando perde todas as cabeças");
  const wing = bodyFunctionState([{ id: "w", name: "Asa", slot: "wing", hpValue: 0, hpMax: 10, functions: ["voo"] }, { id: "w2", name: "Asa 2", slot: "wing", hpValue: 10, hpMax: 10, functions: ["voo"] }], BODY_FNS);
  assert.deepEqual(wing.removedTraits, ["flying"], "uma asa perdida já tira o Voador");
  const regen = bodyFunctionState([{ id: "m", name: "Massa", slot: "body", hpValue: 20, hpMax: 40, functions: ["regenerativa"] }], BODY_FNS);
  assert.deepEqual(regen.regen, [{ id: "m", amount: 2 }]);
  const vital = bodyFunctionState([{ id: "t", name: "Tronco", slot: "torso", hpValue: 0, hpMax: 20, functions: ["vital"] }], BODY_FNS);
  assert.equal(vital.vitalLost[0].name, "Tronco");
});

test("Anatomia: implante só encaixa no slot certo", () => {
  assert.equal(implantFits({ fitsSlots: ["arm"] }, "arm"), true);
  assert.equal(implantFits({ fitsSlots: ["arm"] }, "head"), false);
  assert.equal(implantFits({ fitsSlots: [] }, "tail"), true, "sem slot marcado: cabe em qualquer parte");
});

import { sanitizeOriginEntry, originGuide } from "../module/ai/ai-mechanics.js";

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

test("Evolução: Skill de mesma chave recebe a mecânica nova e mantém o nível", () => {
  const SLIME = { label: "Slime", skills: [{ key: "regen", name: "Regeneração Amorfa", effectType: "none" }] };
  const DEMON = { label: "Slime Demoníaco", skills: [{ key: "regen", name: "Regeneração Demoníaca", effectType: "temporary", effects: [] }] };
  const old = resolveSpeciesTemplate({ species: SLIME, speciesId: "slime" }).skills[0];
  const current = { parts: [], skills: [{ id: "s", name: "Regeneração Amorfa", tier: "racial", grant: { key: "regen", hash: old.hash }, level: 4, xp: 7 }] };
  const diff = speciesDiff(current, resolveSpeciesTemplate({ species: DEMON, speciesId: "slime_demoniaco" }), { mode: "evolution" });
  assert.equal(diff.skills.update.length, 1);
  assert.equal(diff.skills.update[0].name, "Regeneração Demoníaca");
  assert.equal(diff.skills.update[0].level, 4);
});
