/**
 * Recarga, Preparo e investir além da Mana (H3 e C2): regras puras, frase da Skill, aviso do editor,
 * número no Token, simulador de encontro e Desfazer uso.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  overchargeExtraCooldown,
  totalCooldown,
  cooldownToStore,
  tickCooldown,
  onCooldown,
  preparationPayments,
  preparationStep,
  investCeiling,
  clampInvestment,
  overdrawInfo,
  cooldownMessage,
  packUseOptions,
  unpackUseOptions
} from "../module/skills/cooldown-rules.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";
import { effectBadge } from "../module/combat/effect-badge-rules.js";
import { attackCadence, attackReady, cadenceFactor, roundsToDefeat, roundsToDropEach } from "../module/combat/encounter-rules.js";
import { undoPreviewRows } from "../module/skills/skill-undo-rules.js";

test("Sobrecarga: só acima de 2× o Custo, curva (r − 2)² vezes k, arredondada para cima", () => {
  assert.equal(overchargeExtraCooldown(1), 0);
  assert.equal(overchargeExtraCooldown(2), 0);
  assert.equal(overchargeExtraCooldown(2.5), 1); // 0,25 → 1
  assert.equal(overchargeExtraCooldown(3), 1);
  assert.equal(overchargeExtraCooldown(4), 4);
  assert.equal(overchargeExtraCooldown(5), 9);
  assert.equal(overchargeExtraCooldown(4, 2), 8, "k multiplica");
  assert.equal(overchargeExtraCooldown(4, 0), 0, "k 0 desliga");
  assert.equal(overchargeExtraCooldown(NaN), 0);
  // Cresce de forma quadrática: dobrar o excesso quadruplica.
  assert.equal(overchargeExtraCooldown(6) / overchargeExtraCooldown(4), 4);
});

test("Recarga total e o que se guarda: N turnos bloqueada = N + 1 até poder usar", () => {
  assert.equal(totalCooldown(0, 1), 0, "sem recarga e sem sobrecarga");
  assert.equal(totalCooldown(0, 3), 1, "sobrecarga dá recarga a quem não tinha");
  assert.equal(totalCooldown(2, 4), 6, "soma à recarga da Skill");
  assert.equal(cooldownToStore(0), 0);
  assert.equal(cooldownToStore(1), 2);
  assert.equal(cooldownToStore(3), 4);
  // Recarga 1: usada na rodada 1 (2), bloqueada na 2 (1), livre na 3 (0).
  let stored = cooldownToStore(1);
  assert.equal(onCooldown(stored), true);
  stored = tickCooldown(stored);
  assert.equal(onCooldown(stored), true, "bloqueada no 1º turno seguinte");
  stored = tickCooldown(stored);
  assert.equal(onCooldown(stored), false, "livre no 2º");
  assert.equal(tickCooldown(0), 0);
  assert.equal(cooldownMessage("Bola", 2), "Bola está em recarga (2 rodadas).");
  assert.equal(cooldownMessage("Bola", 1), "Bola está em recarga (1 rodada).");
});

test("Preparo: o Custo é dividido em partes que somam o total", () => {
  assert.deepEqual(preparationPayments(90, 3), [30, 30, 30]);
  assert.deepEqual(preparationPayments(100, 3), [34, 33, 33]);
  assert.deepEqual(preparationPayments(10, 4), [3, 3, 2, 2]);
  assert.deepEqual(preparationPayments(0, 2), [0, 0]);
  assert.deepEqual(preparationPayments(50, 0), [50], "sem Preparo, uma parte só");
  for (const [total, turns] of [[7, 3], [90, 3], [1, 5], [123, 7]]) {
    assert.equal(preparationPayments(total, turns).reduce((a, b) => a + b, 0), total);
  }
});

test("Preparo 3 de Custo 90: 30 ao começar, 30 e 30 nos turnos seguintes, dispara no 4º sem pagar", () => {
  const payments = preparationPayments(90, 3);
  let state = { turnsLeft: 3, payments, paid: 1 };
  let step = preparationStep(state);
  assert.deepEqual(step, { action: "pay", amount: 30, turnsLeft: 2, paid: 2 });
  step = preparationStep({ ...state, turnsLeft: step.turnsLeft, paid: step.paid });
  assert.deepEqual(step, { action: "pay", amount: 30, turnsLeft: 1, paid: 3 });
  step = preparationStep({ ...state, turnsLeft: step.turnsLeft, paid: step.paid });
  assert.equal(step.action, "release");
  // Preparo 1: dispara já no turno seguinte.
  assert.equal(preparationStep({ turnsLeft: 1, payments: [40], paid: 1 }).action, "release");
});

test("Investir: teto de 2× a Mana máxima, piso no Custo", () => {
  assert.equal(investCeiling(100), 200);
  assert.equal(investCeiling(0), 0);
  assert.equal(investCeiling(-5), 0);
  assert.equal(clampInvestment(500, { floor: 20, maxEnergy: 100 }), 200);
  assert.equal(clampInvestment(5, { floor: 20, maxEnergy: 100 }), 20);
  assert.equal(clampInvestment("abc", { floor: 20, maxEnergy: 100 }), 20);
  assert.equal(clampInvestment(60, { floor: 20, maxEnergy: 100 }), 60);
});

test("Passar da Mana: quanto além, em % da Mana que se tem", () => {
  assert.deepEqual(overdrawInfo({ invested: 50, current: 100, max: 100 }), { over: false, excess: 0, percent: 0 });
  assert.deepEqual(overdrawInfo({ invested: 100, current: 100, max: 100 }), { over: false, excess: 0, percent: 0 });
  assert.deepEqual(overdrawInfo({ invested: 180, current: 100, max: 100 }), { over: true, excess: 80, percent: 80 });
  assert.equal(overdrawInfo({ invested: 200, current: 50, max: 100 }).percent, 300);
  // Com a Mana em 0, a base é a máxima (não divide por zero).
  assert.deepEqual(overdrawInfo({ invested: 100, current: 0, max: 100 }), { over: true, excess: 100, percent: 100 });
});

test("As opções do uso viajam como dados simples até o disparo do Preparo", () => {
  const target = { uuid: "Actor.alvo" };
  const area = { shape: "circle", x: 10, y: 20, radius: 100 };
  const list = [{ uuid: "Actor.a" }, { uuid: "Actor.b" }];
  list.area = area;
  list.origin = { x: 1, y: 2 };
  const packed = packUseOptions({ targetActor: target, targetActors: list, rollOptions: { advantage: "advantage", modifiers: [] }, manaInvested: 60, structurePlacement: { points: [{ x: 1, y: 1 }] } });
  assert.equal(packed.targetUuid, "Actor.alvo");
  assert.deepEqual(packed.targetUuids, ["Actor.a", "Actor.b"]);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(packed))), JSON.stringify(packed), "só dados simples");
  const world = { "Actor.alvo": { uuid: "Actor.alvo" }, "Actor.a": { uuid: "Actor.a" } };
  const back = unpackUseOptions(packed, uuid => world[uuid] ?? null);
  assert.equal(back.targetActor.uuid, "Actor.alvo");
  assert.equal(back.targetActors.length, 1, "alvo de área que sumiu fica de fora");
  assert.deepEqual(back.targetActors.area, area);
  assert.deepEqual(back.targetActors.origin, { x: 1, y: 2 });
  assert.equal(back.manaInvested, 60);
  assert.equal(back.rollOptions.advantage, "advantage");
  const lost = unpackUseOptions({ targetUuid: "Actor.sumiu" }, () => null);
  assert.equal(lost.targetUuidMissing, true);
  assert.deepEqual(packUseOptions({}), {});
});

test("A Skill numa frase mostra recarga e preparo só quando existem", () => {
  const base = { effectType: "damage", damageFormula: "2d6", targetType: "targeted", cost: 10 };
  assert.ok(!/recarga|pronta/.test(skillSummary(base, { energyLabel: "Mana" })));
  assert.match(skillSummary({ ...base, cooldown: 2 }, { energyLabel: "Mana" }), /recarga 2/);
  assert.match(skillSummary({ ...base, prepTurns: 3 }, { energyLabel: "Mana" }), /pronta em 3 rodadas/);
  assert.match(skillSummary({ ...base, prepTurns: 1 }, { energyLabel: "Mana" }), /pronta em 1 rodada(?!s)/);
});

test("Aviso do editor: Preparo numa Ativa é para conferir; negativo não vale", () => {
  const codes = mech => lintSkill(mech, {}).map(w => `${w.level}:${w.code}`);
  assert.ok(codes({ effectType: "none", hasUpkeep: true, upkeepCost: 2, prepTurns: 2 }).includes("soft:prepActive"));
  assert.ok(!codes({ effectType: "none", prepTurns: 2 }).includes("soft:prepActive"));
  assert.ok(codes({ effectType: "none", cooldown: -1 }).includes("hard:cooldownNegative"));
  assert.ok(codes({ effectType: "none", prepTurns: -2 }).includes("hard:prepNegative"));
});

test("Número no Token: Preparando mostra os turnos que faltam", () => {
  assert.deepEqual(effectBadge({ preparing: 3 }), { text: "3", tone: "prep" });
  assert.equal(effectBadge({ preparing: 0 }), null);
  assert.deepEqual(effectBadge({ rounds: 2 }), { text: "2", tone: "time" }, "o resto não muda");
});

test("Simulador: Recarga N cai a cada N+1 rodadas; Preparo N cai pela 1ª vez na rodada N+1", () => {
  assert.deepEqual(attackCadence({}), { first: 1, period: 1 });
  assert.deepEqual(attackCadence({ cooldown: 2 }), { first: 1, period: 3 });
  assert.deepEqual(attackCadence({ prep: 2 }), { first: 3, period: 2 });
  assert.deepEqual(attackCadence({ prep: 2, cooldown: 1 }), { first: 3, period: 4 });
  const rounds = attack => [1, 2, 3, 4, 5, 6, 7].filter(r => attackReady(r, attack));
  assert.deepEqual(rounds({}), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(rounds({ cooldown: 2 }), [1, 4, 7]);
  assert.deepEqual(rounds({ prep: 2 }), [3, 5, 7]);
  assert.equal(cadenceFactor({ cooldown: 3 }), 0.25);
  assert.equal(cadenceFactor({}), 1);
});

test("Simulador: a luta demora mais com Recarga e Preparo, e o ataque de reserva cobre as rodadas vazias", () => {
  const foe = { key: "foe", name: "foe", hpBase: 100, shield: 0, count: 1, attack: null };
  const hero = attack => ({ key: "hero", name: "hero", hpBase: 100, shield: 0, count: 1, attack: { perTarget: { foe: 50 }, targets: 1, uses: Infinity, ...attack } });
  assert.equal(roundsToDefeat([hero({})], [foe]), 2);
  assert.equal(roundsToDefeat([hero({ cooldown: 1 })], [foe]), 3, "cai nas rodadas 1 e 3");
  assert.equal(roundsToDefeat([hero({ prep: 2 })], [foe]), 5, "cai nas rodadas 3 e 5");
  const withFallback = hero({ cooldown: 1, fallback: { perTarget: { foe: 10 }, targets: 1, uses: Infinity } });
  assert.equal(roundsToDefeat([withFallback], [foe]), 3, "50 + 10 + 50 = 110 na rodada 3");
  // Pior caso sobre um PJ: o dano que cai por rodada soma só os ataques prontos.
  const target = { key: "foe", name: "foe", hpBase: 100, shield: 0, count: 1 };
  assert.equal(roundsToDropEach([hero({})], [target])[0].rounds, 2);
  assert.equal(roundsToDropEach([hero({ cooldown: 1 })], [target])[0].rounds, 3);
  assert.equal(roundsToDropEach([hero({ prep: 1 })], [target])[0].rounds, 3, "cai nas rodadas 2 e 3 (período 1)");
});

test("Desfazer uso: recarga e preparo aparecem na prévia", () => {
  const rows = undoPreviewRows({
    actors: [{ name: "Kira", isSource: true, vitals: [], flags: [["preparing", [null, [{ id: "x" }]]]], items: [{ name: "Bola", changes: [["system.cooldownRemaining", [0, 3]]] }] }]
  });
  const texts = rows.map(r => r.text);
  assert.ok(texts.includes("Recarga de Bola"));
  assert.ok(texts.includes("Preparo de Kira"));
  assert.ok(!texts.some(t => /volta como estava/.test(t)), "a recarga não vira a linha genérica");
});
