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
  needsRepair, deviceProgramIssues, programSlots, modHostRef, modUidOf, findModIndex, parseHostRef, reservePips, slotLayout,
  rechargeOptions, programCostTag, skillDeviceStatus, upkeepDeviceStep, restReserveLine
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
  assert.deepEqual(parseDeviceSourceKey(key), { hostItemId: "abc", hostRef: "abc", uid: "u1" });
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

/* ------------------------------------------------------------------ telas (fase 2) */

test("Endereço da placa: Item pelo id, implante instalado por <parte>~<uid>, a chave device: guarda os dois", () => {
  assert.equal(modHostRef("part1", "u9"), "part1~u9");
  assert.deepEqual(parseHostRef("abc123"), { kind: "item", itemId: "abc123" });
  assert.deepEqual(parseHostRef("part1~u9"), { kind: "mod", partId: "part1", modUid: "u9" });
  assert.equal(parseHostRef(""), null);
  assert.equal(parseHostRef(undefined), null);
  // O ref atravessa a chave da Skill concedida sem confundir com o uid do programa.
  const key = deviceSourceKey(modHostRef("part1", "u9"), "prog7");
  assert.deepEqual(parseDeviceSourceKey(key), { hostItemId: "part1~u9", hostRef: "part1~u9", uid: "prog7" });
  assert.deepEqual(parseHostRef(parseDeviceSourceKey(key).hostRef), { kind: "mod", partId: "part1", modUid: "u9" });
});

test("Uid da modificação: o gravado vale; a peça antiga cai em idxN; achar pelo uid sobrevive a mudar a ordem", () => {
  assert.equal(modUidOf({ uid: "a1" }, 3), "a1");
  assert.equal(modUidOf({}, 2), "idx2");
  const mods = [{ uid: "a" }, { uid: "b" }, {}];
  assert.equal(findModIndex(mods, "b"), 1);
  assert.equal(findModIndex(mods, "idx2"), 2);
  assert.equal(findModIndex(mods.slice(1), "b"), 0);
  assert.equal(findModIndex(mods, "zzz"), -1);
});

test("Pastilhas da Reserva: proporcional, nunca zera com Reserva, só enche quando cheia", () => {
  assert.deepEqual(reservePips(dev({ reserveMax: 6, reserve: 4 })), { on: 4, total: 6, pips: [true, true, true, true, false, false] });
  assert.equal(reservePips(dev({ reserveMax: 100, reserve: 1 })).on, 1);
  assert.equal(reservePips(dev({ reserveMax: 100, reserve: 99 })).on, 9);
  assert.equal(reservePips(dev({ reserveMax: 100, reserve: 100 })).on, 10);
  assert.equal(reservePips(dev({ reserveMax: 100, reserve: 0 })).on, 0);
  assert.equal(reservePips(dev({ reserveMax: 100, reserve: 3, infinite: true })).on, 10);
});

test("Encaixes: programas com os encaixes que ocupam e os livres para soltar", () => {
  const entry = (name, slotsUsed) => ({ uid: name, sourceItem: { name, system: { program: prog({ slotsUsed }) } } });
  const layout = slotLayout(dev({ slots: 3 }), [entry("A", 1), entry("B", 1)]);
  assert.deepEqual(layout.programs.map(p => [p.name, p.slots]), [["A", 1], ["B", 1]]);
  assert.equal(layout.free, 1);
  assert.deepEqual(layout.freeSlots, [0]);
  assert.equal(slotLayout(dev({ slots: 2 }), [entry("Grande", 2)]).free, 0);
  assert.equal(slotLayout(dev({ slots: 1 }), [entry("Grande", 2)]).overfull, true);
});

test("Menu Recarregar: só o que a placa permite e que vale agora", () => {
  const d = dev({ reserveMax: 6, reserve: 4, rechargeCell: true, rechargeAction: true, actionAmount: 2 });
  assert.deepEqual(rechargeOptions(d, { cells: 2, inCombat: false }).options.map(o => o.id), ["cell", "action"]);
  assert.match(rechargeOptions(d, { cells: 2 }).options[0].label, /2 no inventário/);
  assert.match(rechargeOptions(d, { cells: 2 }).options[1].label, /\+2/);
  assert.deepEqual(rechargeOptions(d, { cells: 0, inCombat: true }).options, []);
  assert.match(rechargeOptions(d, { cells: 0, inCombat: true }).reason, /Célula/);
  assert.deepEqual(rechargeOptions(dev({ reserveMax: 6, reserve: 4, rechargeCell: false }), { cells: 3 }).options, []);
  assert.equal(rechargeOptions(dev({ reserve: 50, reserveMax: 50 }), { cells: 3 }).reason, "a Reserva já está cheia");
  assert.equal(rechargeOptions(dev({ infinite: true }), { cells: 3 }).reason, "a Reserva é infinita");
});

test("Etiqueta do programa e da Habilidade: custo, sem Reserva, tecnomágica e placa parada", () => {
  assert.equal(programCostTag({ cost: 2 }), "2 de Reserva");
  assert.equal(programCostTag({ cost: 0 }), "sem custo");
  assert.equal(programCostTag({ cost: 5, infinite: true }), "sem custo");
  const ok = skillDeviceStatus({ device: dev({ reserve: 6 }), cost: 2, hostName: "Cyberdeck" });
  assert.deepEqual([ok.text, ok.tone, ok.disabled], ["2 de Reserva · Cyberdeck", "ok", false]);
  const empty = skillDeviceStatus({ device: dev({ reserve: 2 }), cost: 3, hostName: "Cyberdeck" });
  assert.equal(empty.text, "sem Reserva (3) · Cyberdeck");
  assert.equal(empty.disabled, true);
  assert.match(empty.reason, /sem Reserva/);
  const magic = skillDeviceStatus({ device: dev({ nature: "technomagic", reserve: 0 }), cost: 3, hostName: "Pulso", energyLabel: "Mana" });
  assert.equal(magic.text, "sem Reserva → 3 Mana · Pulso");
  assert.equal(magic.disabled, false);
  assert.equal(skillDeviceStatus({ device: dev({ state: "off" }), cost: 1 }).disabled, true);
  assert.match(skillDeviceStatus({ device: dev({ state: "damaged" }), cost: 1, hostName: "X" }).text, /danificada/);
  assert.match(skillDeviceStatus({ device: dev(), cost: 1, suppressed: true }).text, /suprimida/);
});

test("Manutenção de Skill Ativa de programa: sai da Reserva; tecnológica sem Reserva desliga; tecnomágica completa com energia", () => {
  assert.deepEqual(upkeepDeviceStep({ cost: 2, reserve: 5, energy: 10 }), { reserve: 3, energy: 10, dropped: false, spentReserve: 2, spentEnergy: 0 });
  const tech = upkeepDeviceStep({ cost: 3, reserve: 1, energy: 10 });
  assert.equal(tech.dropped, true);
  assert.equal(tech.reserve, 1);
  assert.equal(tech.energy, 10);
  assert.deepEqual(upkeepDeviceStep({ cost: 5, reserve: 2, nature: "technomagic", energy: 10 }), { reserve: 0, energy: 7, dropped: false, spentReserve: 2, spentEnergy: 3 });
  const broke = upkeepDeviceStep({ cost: 5, reserve: 2, nature: "technomagic", energy: 1 });
  assert.equal(broke.dropped, true);
  assert.equal(broke.reserve, 0);
  assert.equal(broke.energy, 0);
  const free = upkeepDeviceStep({ cost: 9, reserve: 0, infinite: true, energy: 4 });
  assert.deepEqual([free.dropped, free.energy], [false, 4]);
});

test("Descanso: a linha de Reserva só lista as placas que voltam", () => {
  const hosts = [
    { name: "Cyberdeck", device: dev({ reserveMax: 6, reserve: 4 }) },
    { name: "Rifle", device: dev({ reserveMax: 4, reserve: 4 }) },
    { name: "Bateria", device: dev({ reserveMax: 8, reserve: 1, rechargeRest: false }) },
    { name: "Eterna", device: dev({ infinite: true, reserve: 0 }) }
  ];
  assert.equal(restReserveLine(hosts), "Reserva volta: Cyberdeck 6/6");
  assert.equal(restReserveLine([]), "");
});

test("A frase da Skill de programa diz o custo em Reserva da placa", async () => {
  const { skillSummary } = await import("../module/skills/skill-summary.js");
  const mech = { effectType: "temporary", targetType: "self", cost: 2, hasUpkeep: false, effects: [] };
  assert.match(skillSummary(mech, { cost: 2, reserve: { name: "Cyberdeck", cost: 2, infinite: false } }), /custa 2 de Reserva do Cyberdeck/);
  assert.doesNotMatch(skillSummary(mech, { cost: 2, reserve: { name: "Cyberdeck", cost: 2 } }), /2 Mana/);
  assert.match(skillSummary(mech, { cost: 2, reserve: { name: "Rifle", cost: 0, infinite: true } }), /Reserva infinita de Rifle/);
  assert.match(skillSummary({ ...mech, hasUpkeep: true, upkeepCost: 1 }, { cost: 2, upkeep: 1, reserve: { name: "Cyberdeck", cost: 2 } }), /Ativa: −1 de Reserva\/rodada/);
  assert.match(skillSummary(mech, { cost: 2 }), /2 Mana/);
});
