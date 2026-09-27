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
  resistanceXpGain,
  movementAllowance,
  describeMovement,
  getMovementConfig,
  resolveActorTraits,
  engineRatio,
  shipMovementCells,
  shipEvasionFraction,
  getShipManeuverConfig,
  powerPriorityGroup,
  fundByPriority,
  isStructureMechanic,
  migrateStructureTarget,
  getActiveDamageElements,
  normalizeLightConfig
} from "../module/config.js";
import { computeResistancePercent, computeResistanceName, resistanceMaxLevel } from "../module/skill-effects.js";
import { buildSubSkillsFromSources, buildGrantedSkillData } from "../module/skill-snapshot.js";
import { buildBatchPrompt, summarizeCreatedDocument } from "../module/ai-generation.js";
import { moduleIntegrityRatio } from "../module/data/starship-model.js";
import { splitStructuralDamage } from "../module/starship-power.js";
import { splitShieldDamage } from "../module/damage-apply.js";

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
  const config = getShipManeuverConfig();
  const sizes = ["mini", "pequeno", "medio", "grande", "capital"];
  for (let i = 1; i < sizes.length; i++) {
    assert.ok(config.movement[sizes[i]] < config.movement[sizes[i - 1]], `${sizes[i]} anda menos que ${sizes[i - 1]}`);
    assert.ok(config.evasion[sizes[i]] < config.evasion[sizes[i - 1]], `${sizes[i]} desvia menos que ${sizes[i - 1]}`);
  }
  assert.equal(config.evasionCap, 40);
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
} from "../module/roll-modifiers.js";

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
  rollChance
} from "../module/damage-rules.js";

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

import { matchesWhen, sumConditionalModifiers, perEachCount } from "../module/conditional-modifiers.js";

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

import { moduleRole, categorySlotLimit, getModuleCategories } from "../module/config.js";

test("categorias: as 9 de sempre têm Função e ids antigos continuam válidos", () => {
  assert.equal(moduleRole("reactor"), "power");
  assert.equal(moduleRole("engine"), "propulsion");
  assert.equal(moduleRole("distributor"), "distribution");
  assert.equal(moduleRole("sumiu-do-catalogo"), "utility");
  assert.equal(getModuleCategories().length, 9);
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

import { capPolyline, polylineLength, structureSegments, pointsAlongPolyline } from "../module/structure-geometry.js";

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

import { readTransferBundle, diffTransfer, transferGroup } from "../module/config-transfer.js";
import { presetContent } from "../module/config.js";

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
