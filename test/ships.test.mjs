/**
 * Naves: presets de Módulo, Capacitor, Integridade, dano estrutural, movimento/Evasão, Portes/Classes, Categorias, energia e cascata.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  MEU_SISTEMA,
  getModuleSizePreset,
  engineRatio,
  shipMovementCells,
  shipEvasionFraction,
  getShipManeuverConfig,
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
  tractorHold
} from "../module/core/config.js";
import { moduleIntegrityRatio } from "../module/starship/starship-model.js";
import { splitStructuralDamage } from "../module/starship/starship-power.js";
import {
  resolveConditionEffect,
  absorbLayer,
  resolveShipCascade,
  splitTargetedStructural,
  hardenedChance,
  shieldAdaptationKey,
  shieldAdaptationFor,
  adaptShield
} from "../module/combat/damage-rules.js";
import { moduleRole, categorySlotLimit, getModuleCategories } from "../module/core/config.js";

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
/*  Categorias de Módulo e Classes               */
/* -------------------------------------------- */

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

test("Condição com tick no Casco de Nave", () => {
  const burn = { id: "plasma-burn", effect: { kind: "tick", tickTarget: "shipCasco", value: 12, durationRounds: 3 } };
  const entry = resolveConditionEffect(burn, {});
  assert.equal(entry.target, "shipCasco");
  assert.equal(entry.amount, -12);
  assert.equal(entry.periodic, true);
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

const arm = (id, hp, extra = {}) => ({ id, name: id, slot: "arm", hpValue: hp, hpMax: 8, functions: ["manipulacao"], ...extra });
