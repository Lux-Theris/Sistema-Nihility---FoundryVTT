/**
 * Placas e programas (Lote 9): Reserva, pagamento, recarga, encaixes, PEM e curto-circuito.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultDevice, normalizeDevice, reserveState, programCost, payProgramCost, restRecharge, cellRecharge, actionRecharge,
  programFits, slotsFree, deviceWorks, deviceBlockReason, empDrainPercent, empReserveDrain, rollShortCircuit, shortCircuitHit,
  normalizeShortBands, disasterDamageFormula, offExpired, isEnergyCell, deviceSourceKey, parseDeviceSourceKey, canRepairDevice,
  needsRepair, deviceProgramIssues, programSlots
} from "../module/economy/device-rules.js";
import { itemIsTech, itemIsMagic, itemNature } from "../module/core/magic-rules.js";
import { NIHILITY } from "../module/core/config.js";

const dev = (patch = {}) => ({ ...defaultDevice({ enabled: true }), ...patch });
const prog = (patch = {}) => ({ enabled: true, slotsUsed: 1, costPerUse: 0, fits: "any", invasion: { enabled: false }, ...patch });

test("Placa: o padrão marca Descanso e Célula, ação e infinita desligadas", () => {
  const d = defaultDevice();
  assert.equal(d.enabled, false);
  assert.equal(d.rechargeRest, true);
  assert.equal(d.rechargeCell, true);
  assert.equal(d.rechargeAction, false);
  assert.equal(d.infinite, false);
  assert.equal(d.state, "normal");
  assert.equal(d.reserve, d.reserveMax);
  assert.deepEqual(d.programs, []);
});

test("Placa: normalizeDevice corrige o que está fora da faixa", () => {
  const d = normalizeDevice({ enabled: true, nature: "xx", slots: -3, reserveMax: 10, reserve: 99, accepts: "?", state: "?" });
  assert.equal(d.nature, "tech");
  assert.equal(d.slots, 0);
  assert.equal(d.reserve, 10);
  assert.equal(d.accepts, "any");
  assert.equal(d.state, "normal");
  assert.equal(normalizeDevice(null).enabled, false);
});

test("Reserva: estado, porcentagem, vazia e infinita", () => {
  assert.deepEqual(reserveState(dev({ reserveMax: 40, reserve: 10 })), { max: 40, current: 10, percent: 25, empty: false, full: false, infinite: false });
  assert.equal(reserveState(dev({ reserve: 0 })).empty, true);
  const inf = reserveState(dev({ reserve: 0, infinite: true }));
  assert.equal(inf.empty, false);
  assert.equal(inf.full, true);
  assert.equal(reserveState(dev({ reserveMax: 0, reserve: 0 })).percent, 0);
});

test("Custo: costPerUse do programa vence o Custo da Habilidade", () => {
  assert.equal(programCost({ skillCost: 12, costPerUse: 0 }), 12);
  assert.equal(programCost({ skillCost: 12, costPerUse: 5 }), 5);
  assert.equal(programCost({}), 0);
});

test("Pagar: Reserva basta, falta (tecnológica bloqueia, tecnomágica completa com Mana), infinita e custo 0", () => {
  assert.deepEqual(payProgramCost({ cost: 10, reserve: 30 }), { ok: true, reserveAfter: 20, manaCost: 0, reason: "reserve" });
  assert.deepEqual(payProgramCost({ cost: 30, reserve: 30 }), { ok: true, reserveAfter: 0, manaCost: 0, reason: "reserve" });
  assert.deepEqual(payProgramCost({ cost: 10, reserve: 4, nature: "tech" }), { ok: false, reserveAfter: 4, manaCost: 0, reason: "sem Reserva" });
  assert.deepEqual(payProgramCost({ cost: 10, reserve: 4, nature: "technomagic" }), { ok: true, reserveAfter: 0, manaCost: 6, reason: "mana" });
  assert.deepEqual(payProgramCost({ cost: 10, reserve: 0, nature: "technomagic" }), { ok: true, reserveAfter: 0, manaCost: 10, reason: "mana" });
  assert.deepEqual(payProgramCost({ cost: 99, reserve: 0, infinite: true }), { ok: true, reserveAfter: 0, manaCost: 0, reason: "infinite" });
  assert.deepEqual(payProgramCost({ cost: 0, reserve: 0 }), { ok: true, reserveAfter: 0, manaCost: 0, reason: "free" });
  assert.equal(payProgramCost({ cost: -5, reserve: 3 }).reserveAfter, 3);
});

test("Recarga: Descanso enche; só se a placa usa Descanso e não é infinita", () => {
  assert.deepEqual(restRecharge(dev({ reserve: 5 })), { changed: true, reserve: 50 });
  assert.equal(restRecharge(dev({ reserve: 50 })).changed, false);
  assert.equal(restRecharge(dev({ reserve: 5, rechargeRest: false })).changed, false);
  assert.equal(restRecharge(dev({ reserve: 5, infinite: true })).changed, false);
  assert.equal(restRecharge(defaultDevice({ enabled: false })).changed, false);
});

test("Recarga: Célula enche tudo, com os motivos da recusa", () => {
  assert.deepEqual(cellRecharge(dev({ reserve: 1 })), { ok: true, reserve: 50, reason: "" });
  assert.equal(cellRecharge(dev({ reserve: 1, rechargeCell: false })).ok, false);
  assert.match(cellRecharge(dev({ reserve: 50 })).reason, /cheia/);
  assert.equal(cellRecharge(dev({ reserve: 1, infinite: true })).ok, false);
  assert.equal(cellRecharge(defaultDevice()).ok, false);
});

test("Recarga: ação só fora de combate, soma o valor sem passar do máximo", () => {
  const d = dev({ rechargeAction: true, actionAmount: 10, reserve: 45 });
  assert.deepEqual(actionRecharge(d, false), { ok: true, reserve: 50, reason: "" });
  assert.equal(actionRecharge({ ...d, reserve: 10 }, false).reserve, 20);
  assert.match(actionRecharge(d, true).reason, /fora de combate/);
  assert.equal(actionRecharge(dev({ reserve: 1 }), false).ok, false);
  assert.equal(actionRecharge({ ...d, reserve: 50 }, false).ok, false);
});

test("Encaixes: livres e o que cada programa ocupa (mínimo 1)", () => {
  assert.equal(programSlots({ slotsUsed: 0 }), 1);
  assert.equal(programSlots({ slotsUsed: 3 }), 3);
  assert.equal(slotsFree(dev({ slots: 3 }), []), 3);
  assert.equal(slotsFree(dev({ slots: 3 }), [{ slotsUsed: 2 }]), 1);
  assert.equal(slotsFree(dev({ slots: 1 }), [{ slotsUsed: 2 }]), 0);
});

test("programFits: encaixe, accepts e fits", () => {
  assert.deepEqual(programFits(dev({ slots: 2 }), [], prog()), { ok: true, reason: "" });
  assert.equal(programFits(dev({ slots: 1 }), [prog()], prog()).ok, false);
  assert.match(programFits(dev({ slots: 1 }), [prog()], prog()).reason, /encaixe/);
  assert.equal(programFits(dev({ slots: 2 }), [], prog({ slotsUsed: 3 })).ok, false);
  assert.equal(programFits(dev({ accepts: "invasion" }), [], prog()).ok, false);
  assert.equal(programFits(dev({ accepts: "invasion" }), [], prog({ invasion: { enabled: true } })).ok, true);
  assert.equal(programFits(dev({ accepts: "weapon" }), [], prog()).ok, false);
  assert.equal(programFits(dev({ accepts: "weapon" }), [], prog({ fits: "weapon" }), { hostIsWeapon: true }).ok, true);
  // programa de arma exige que o hospedeiro seja arma
  assert.equal(programFits(dev(), [], prog({ fits: "weapon" })).ok, false);
  assert.equal(programFits(dev(), [], prog({ fits: "weapon" }), { hostIsWeapon: true }).ok, true);
  // não é placa / não é programa
  assert.equal(programFits(defaultDevice(), [], prog()).ok, false);
  assert.equal(programFits(dev(), [], { enabled: false }).ok, false);
  assert.equal(programFits(dev(), [], null).ok, false);
});

test("deviceWorks: ligada, normal e sem PEM", () => {
  assert.equal(deviceWorks(dev()), true);
  assert.equal(deviceWorks(dev(), { techSuppressed: true }), false);
  assert.equal(deviceWorks(dev({ state: "off" })), false);
  assert.equal(deviceWorks(dev({ state: "damaged" })), false);
  assert.equal(deviceWorks(defaultDevice()), false);
  assert.match(deviceBlockReason(dev({ state: "off" })), /desligada/);
  assert.match(deviceBlockReason(dev({ state: "damaged" })), /danificada/);
  assert.match(deviceBlockReason(dev(), { techSuppressed: true }), /PEM/);
  assert.equal(deviceBlockReason(dev()), "");
});

test("PEM: a fórmula da Nave (5% por ponto de alcance, de 5% a 75%) e a drenagem da Reserva", () => {
  assert.equal(empDrainPercent(0), 5);
  assert.equal(empDrainPercent(1), 5);
  assert.equal(empDrainPercent(4), 20);
  assert.equal(empDrainPercent(15), 75);
  assert.equal(empDrainPercent(99), 75);
  assert.deepEqual(empReserveDrain(50, 4, 50), { percent: 20, drained: 10, reserveAfter: 40 });
  assert.deepEqual(empReserveDrain(5, 15, 50), { percent: 75, drained: 5, reserveAfter: 0 });
  assert.deepEqual(empReserveDrain(0, 4, 50), { percent: 20, drained: 0, reserveAfter: 0 });
  assert.equal(empReserveDrain(3, 1, 10).drained, 1); // pelo menos 1 se há Reserva
});

test("Curto: faixas do d100 e a chance por PEM", () => {
  assert.deepEqual(rollShortCircuit(1), { severity: "leve", state: "off", disaster: false });
  assert.equal(rollShortCircuit(60).severity, "leve");
  assert.deepEqual(rollShortCircuit(61), { severity: "grave", state: "damaged", disaster: false });
  assert.equal(rollShortCircuit(95).severity, "grave");
  assert.deepEqual(rollShortCircuit(96), { severity: "desastre", state: "damaged", disaster: true });
  assert.equal(rollShortCircuit(100).disaster, true);
  // faixas por parâmetro e valores fora da faixa
  assert.equal(rollShortCircuit(30, { leveMax: 20, graveMax: 40 }).severity, "grave");
  assert.equal(rollShortCircuit(0).severity, "leve");
  assert.equal(rollShortCircuit(500).severity, "desastre");
  assert.deepEqual(normalizeShortBands({ leveMax: 80, graveMax: 50 }), { leveMax: 80, graveMax: 80 });
  assert.equal(rollShortCircuit(100, { leveMax: 100, graveMax: 100 }).severity, "leve");
  assert.equal(shortCircuitHit(25, 25), true);
  assert.equal(shortCircuitHit(26, 25), false);
  assert.equal(shortCircuitHit(1, 0), false);
  assert.equal(shortCircuitHit(100, 100), true);
});

test("Desastre: fórmula do dano Elétrico 2d6 × Reserva máxima ÷ 6", () => {
  assert.equal(disasterDamageFormula(60), "round(2d6 * 60 / 6)");
  assert.equal(disasterDamageFormula(0), "0");
  assert.equal(disasterDamageFormula(-4), "0");
  assert.equal(disasterDamageFormula(12.9), "round(2d6 * 12 / 6)");
});

test("Placa desligada: acaba com o combate, ou depois de 3 rodadas do relógio fora dele", () => {
  const inCombat = dev({ state: "off", offMode: "combat", offCombatId: "c1" });
  assert.equal(offExpired(inCombat, { liveCombatIds: ["c1"] }), false);
  assert.equal(offExpired(inCombat, { liveCombatIds: ["c2"] }), true);
  assert.equal(offExpired(inCombat, { liveCombatIds: [] }), true);
  const timed = dev({ state: "off", offMode: "time", offSince: 100, offRounds: 3 });
  assert.equal(offExpired(timed, { now: 117, roundSeconds: 6 }), false);
  assert.equal(offExpired(timed, { now: 118, roundSeconds: 6 }), true);
  assert.equal(offExpired(timed, { now: 118, roundSeconds: 0 }), true); // rodada de 0 s vira 6
  assert.equal(offExpired(dev({ state: "damaged" }), { now: 1e9 }), false);
  assert.equal(offExpired(dev(), {}), false);
});

test("Célula de energia, chave da Skill concedida e Engenharia", () => {
  assert.equal(isEnergyCell({ consumable: { energyCell: true }, quantity: 2 }), true);
  assert.equal(isEnergyCell({ consumable: { energyCell: true }, quantity: 0 }), false);
  assert.equal(isEnergyCell({ consumable: { energyCell: false }, quantity: 2 }), false);
  assert.equal(isEnergyCell({}), false);
  const key = deviceSourceKey("abc", "u1");
  assert.equal(key, "device:abc:u1");
  assert.deepEqual(parseDeviceSourceKey(key), { hostItemId: "abc", uid: "u1" });
  assert.equal(parseDeviceSourceKey("abc"), null);
  assert.equal(parseDeviceSourceKey(undefined), null);
  assert.equal(canRepairDevice([{ engineering: false }, { engineering: true }]), true);
  assert.equal(canRepairDevice([{}]), false);
  assert.equal(canRepairDevice(), false);
  assert.equal(needsRepair(dev({ state: "damaged" })), true);
  assert.equal(needsRepair(dev()), false);
});

test("Natureza: a placa é sempre tecnológica; tecnomágica também é mágica", () => {
  assert.equal(itemIsTech({ tech: false, device: { enabled: true } }), true);
  assert.equal(itemIsTech({ tech: false }), false);
  assert.equal(itemIsMagic({ device: { enabled: true, nature: "technomagic" } }), true);
  assert.equal(itemIsMagic({ device: { enabled: true, nature: "tech" } }), false);
  assert.equal(itemIsMagic({ device: { enabled: false, nature: "technomagic" } }), false);
  assert.equal(itemIsMagic({ magic: true }), true);
  assert.deepEqual(itemNature({ device: { enabled: true, nature: "technomagic" } }), { magic: true, tech: true });
  assert.deepEqual(itemNature({ device: { enabled: true, nature: "tech" } }), { magic: false, tech: true });
});

test("Validar Mundo: programa que a placa não aceita mais, encaixes estourados", () => {
  const entry = (program, name = "P") => ({ uid: "u", sourceItem: { name, system: { program } } });
  assert.deepEqual(deviceProgramIssues(dev({ programs: [entry(prog())] })), []);
  assert.equal(deviceProgramIssues(dev({ accepts: "invasion", programs: [entry(prog())] })).length, 1);
  assert.equal(deviceProgramIssues(dev({ accepts: "weapon", programs: [entry(prog())] })).length, 1);
  assert.equal(deviceProgramIssues(dev({ programs: [entry(prog({ fits: "weapon" }))] })).length, 1);
  assert.equal(deviceProgramIssues(dev({ programs: [entry(prog({ fits: "weapon" }))] }), { hostIsWeapon: true }).length, 0);
  assert.equal(deviceProgramIssues(dev({ slots: 1, programs: [entry(prog()), entry(prog())] })).length, 1);
  assert.equal(deviceProgramIssues(dev({ programs: [entry({ enabled: false })] })).length, 1);
});

test("Bloco de Placas e programas: desligado por padrão, ligado em Sci-Fi e Misto, opções com padrão", () => {
  const f = NIHILITY.FEATURES.devices;
  assert.equal(f.default, false);
  assert.equal(f.options.curtoChanceOnEmp.default, 25);
  assert.equal(f.options.shortLeveMax.default, 60);
  assert.equal(f.options.shortGraveMax.default, 95);
  assert.equal(NIHILITY.CAMPAIGN_PRESETS.scifi.features.devices, true);
  assert.equal(NIHILITY.CAMPAIGN_PRESETS.misto.features.devices, true);
  assert.equal(NIHILITY.CAMPAIGN_PRESETS.medieval.features.devices, false);
});
