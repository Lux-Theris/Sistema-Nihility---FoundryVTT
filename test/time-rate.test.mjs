/**
 * Manipulação do tempo (8e.1–8e.3): as regras puras do Ritmo do tempo (fator, reserva, fração que acumula, ticks
 * em memória, enfraquecimento contra alvo mais forte) e as peças que leem o efeito (alvo, frase, avisos, custo, IA).
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  clampTimeFactor, isTimeFactorActive, composeTimeFactors, timeStrength, weakenTimeFactor, rateSteps, timeTurnPlan,
  allowedTicks, simulateTicks, spendExtra, reserveAfterSpend, reserveCovers, describeTimeFactor, timeStateLabel,
  reserveText, scaledMovement, advanceState, turnNoticeText, scaledCadence, cooldownReserveCost, prepReserveCost
} from "../module/combat/time-rate-rules.js";
import { MEU_SISTEMA } from "../module/core/config.js";
import { resolveEffectChange } from "../module/skills/effect-targets.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";
import { suggestSkillCost } from "../module/skills/skill-cost-rules.js";
import { sanitizeSkillMechanics } from "../module/ai/ai-mechanics.js";
import { effectBadge } from "../module/combat/effect-badge-rules.js";
import { composeRate } from "../module/core/calendar-rules.js";
import { buildGlossary } from "../module/glossary/glossary-rules.js";

test("fator: limites, lixo vira 1 e produto de efeitos", () => {
  assert.equal(clampTimeFactor(3), 3);
  assert.equal(clampTimeFactor("abc"), 1);
  assert.equal(clampTimeFactor(-2), 1);
  assert.equal(clampTimeFactor(0), 1);
  assert.equal(clampTimeFactor(5000), 1000);
  assert.equal(clampTimeFactor(0.0001), 0.01);
  assert.equal(isTimeFactorActive(1), false);
  assert.equal(isTimeFactorActive(1.0000001), false);
  assert.equal(isTimeFactorActive(0.5), true);
  assert.equal(composeTimeFactors([2, 3]), 6);
  assert.equal(composeTimeFactors([2, 0.5]), 1);
  assert.equal(composeTimeFactors([]), 1);
  assert.equal(composeTimeFactors([2000, 2000]), 1000);
});

test("alvo mais forte: cheio até o nível da Skill, reta até zero no dobro (não a curva do bloqueio de cura)", () => {
  assert.equal(timeStrength(12, 5), 1);
  assert.equal(timeStrength(12, 12), 1);
  assert.equal(timeStrength(12, 18), 0.5);
  assert.equal(timeStrength(12, 24), 0);
  assert.equal(timeStrength(12, 40), 0);
  // Uma Skill 12 contra alvo 9 pega cheia (a curva do bloqueio de cura deixaria de fora até 16).
  assert.equal(timeStrength(12, 9), 1);
  // Nível da Skill 0 conta como 1 (nunca divide por zero).
  assert.equal(timeStrength(0, 1), 1);
  assert.equal(timeStrength(0, 2), 0);
});

test("fator enfraquecido anda em direção a 1", () => {
  assert.equal(weakenTimeFactor(3, 1), 3);
  assert.equal(weakenTimeFactor(3, 0.5), 2);
  assert.equal(weakenTimeFactor(3, 0), 1);
  assert.equal(weakenTimeFactor(0.5, 0.5), 0.75);
  assert.equal(isTimeFactorActive(weakenTimeFactor(3, 0)), false);
});

test("passos do turno: a fração acumula (×2,5 + ×2,5 = 5) e Desacelerado anda em parte dos turnos", () => {
  let carry = 0;
  const got = [];
  for (let i = 0; i < 4; i++) {
    const r = rateSteps(2.5, carry);
    got.push(r.steps);
    carry = r.carry;
  }
  assert.deepEqual(got, [2, 3, 2, 3]);
  assert.equal(got.reduce((a, b) => a + b, 0), 10);
  // ×½: 0, 1, 0, 1.
  carry = 0;
  const slow = [];
  for (let i = 0; i < 4; i++) {
    const r = rateSteps(0.5, carry);
    slow.push(r.steps);
    carry = r.carry;
  }
  assert.deepEqual(slow, [0, 1, 0, 1]);
  assert.equal(rateSteps(3, 0).steps, 3);
  assert.equal(rateSteps(100, 0).steps, 100);
});

test("plano do turno: Acelerado tem reserva, Desacelerado não, normal é 1 passo", () => {
  assert.deepEqual(timeTurnPlan(1), { kind: "normal", factor: 1, steps: 1, reserve: 0, carry: 0 });
  const fast = timeTurnPlan(100);
  assert.equal(fast.kind, "fast");
  assert.equal(fast.reserve, 100);
  assert.equal(fast.steps, 100);
  const slow = timeTurnPlan(0.5, 0);
  assert.equal(slow.kind, "slow");
  assert.equal(slow.reserve, 0);
  assert.equal(slow.steps, 0);
  assert.equal(timeTurnPlan(0.5, 0.5).steps, 1);
  assert.equal(timeTurnPlan(2.5, 0.5).reserve, 3);
});

test("número por turno: limitado pela própria duração (Veneno de 10, faltando 5, ×100 = −50 e acaba)", () => {
  const ticks = allowedTicks({ steps: 100, remaining: 5, anchored: false });
  assert.equal(ticks, 5);
  const sim = simulateTicks({ value: 200, delta: -10, ticks });
  assert.equal(sim.done, 5);
  assert.equal(sim.total, -50);
  assert.equal(sim.value, 150);
  // Ativa segurando o efeito: só o N limita.
  assert.equal(allowedTicks({ steps: 7, remaining: 0, anchored: true }), 7);
  assert.equal(allowedTicks({ steps: 7, remaining: 0, anchored: false }), 0);
  assert.equal(allowedTicks({ steps: 3, remaining: 10 }), 3);
});

test("ticks em memória: cai a 0 no meio e para ali; cura trava no teto", () => {
  const dies = simulateTicks({ value: 25, delta: -10, ticks: 100 });
  assert.equal(dies.value, 0);
  assert.equal(dies.done, 3);
  assert.equal(dies.total, -25);
  const heal = simulateTicks({ value: 90, delta: 5, ticks: 400, ceiling: 100 });
  assert.equal(heal.value, 100);
  assert.equal(heal.total, 10);
  assert.equal(heal.done, 400);
  // Teto menor que o valor atual não derruba (cura bloqueada em parte do corpo).
  assert.equal(simulateTicks({ value: 80, delta: 5, ticks: 3, ceiling: 70 }).value, 80);
  assert.equal(simulateTicks({ value: 10, delta: 0, ticks: 5 }).value, 10);
});

test("estados andam por reserva gasta: o 1º vivido é o do núcleo, e o que sobra no fim também conta", () => {
  // ×3: reserva 3. Gasta 2 (o 1º é do núcleo): rende 1; o 1 que sobra no fim rende mais 1: total 2 = N − 1.
  const first = spendExtra(0, 2);
  assert.equal(first, 1);
  const end = spendExtra(2, 1);
  assert.equal(end, 1);
  assert.equal(first + end, 2);
  // Gastar tudo de uma vez rende o mesmo.
  assert.equal(spendExtra(0, 3), 2);
  // Gastar 1 não rende nada ainda.
  assert.equal(spendExtra(0, 1), 0);
  // Ficar parado (nada gasto) e o fim do turno conta o N inteiro menos o do núcleo.
  assert.equal(spendExtra(0, 100), 99);
  assert.equal(spendExtra(5, 0), 0);
});

test("reserva: gasto, cobertura e prazo de estado", () => {
  assert.equal(reserveAfterSpend(10, 3), 7);
  assert.equal(reserveAfterSpend(2, 5), 0);
  assert.equal(reserveCovers(5, 5), true);
  assert.equal(reserveCovers(4, 5), false);
  assert.equal(reserveCovers(5, 0), false);
  assert.deepEqual(advanceState(3, 2), { remaining: 1, expired: false });
  assert.deepEqual(advanceState(3, 3), { remaining: 0, expired: true });
  assert.deepEqual(advanceState(2, 50), { remaining: 0, expired: true });
  // Recarga guardada (com o +1) e Preparo viram custo em reserva.
  assert.equal(cooldownReserveCost(3), 3);
  assert.equal(cooldownReserveCost(0), 0);
  assert.equal(prepReserveCost(5), 5);
});

test("textos: fator, estado, reserva e aviso", () => {
  assert.equal(describeTimeFactor(3), "×3");
  assert.equal(describeTimeFactor(0.5), "×½");
  assert.equal(describeTimeFactor(2.5), "×2,5");
  assert.equal(timeStateLabel(100), "Acelerado ×100");
  assert.equal(timeStateLabel(0.5), "Desacelerado ×½");
  assert.equal(timeStateLabel(1), "");
  assert.equal(reserveText(89, 100), "89 de tempo restante (de 100)");
  assert.match(turnNoticeText("Kael", timeTurnPlan(2)), /Kael está Acelerado ×2: tem 2 de tempo neste turno/);
  assert.match(turnNoticeText("Mira", timeTurnPlan(0.5, 0)), /não anda/);
  assert.equal(turnNoticeText("X", timeTurnPlan(1)), "");
});

test("Deslocamento e cadência do Simulador × o fator", () => {
  assert.equal(scaledMovement(6, 3), 18);
  assert.equal(scaledMovement(6, 0.5), 3);
  assert.equal(scaledMovement(6, 1), 6);
  assert.ok(Number.isNaN(scaledMovement(NaN, 3)));
  assert.equal(scaledCadence(2, 3), 6);
});

test("o efeito timeRate: alvo, grupo Tempo, flag no Active Effect e recusa em Nave", () => {
  assert.ok(MEU_SISTEMA.EFFECT_TARGETS.includes("timeRate"));
  const group = MEU_SISTEMA.EFFECT_TARGET_GROUPS.find(g => g.label === "Tempo");
  assert.ok(group?.targets.includes("timeRate"));
  const char = { type: "character" };
  const change = resolveEffectChange({ target: "timeRate", timeFactor: 3 }, char);
  assert.equal(change.key, null);
  assert.deepEqual(change.timeRate, { factor: 3 });
  assert.equal(resolveEffectChange({ target: "timeRate", timeFactor: 3 }, { type: "starship" }), null);
  assert.equal(resolveEffectChange({ target: "timeRate", timeFactor: 3 }, { type: "vehicle" }), null);
  assert.equal(resolveEffectChange({ target: "timeRate", timeFactor: 1 }, char), null, "fator 1 não muda nada");
  assert.equal(resolveEffectChange({ target: "timeRate", timeFactor: 0.5 }, char).timeRate.factor, 0.5);
});

test("o bloco timeManipulation existe com grupo e frase curta (o toggle liga o grupo Tempo)", () => {
  const feature = MEU_SISTEMA.FEATURES.timeManipulation;
  assert.ok(feature);
  assert.equal(feature.group, "combat");
  assert.ok(feature.short);
  assert.equal(feature.heavy, false);
});

test("frase da Skill, custo sugerido e avisos do editor", () => {
  const acelerar = { effectType: "temporary", targetType: "self", cost: 8, level: 1, effects: [{ target: "timeRate", timeFactor: 3, durationRounds: 3 }] };
  assert.match(skillSummary(acelerar), /Acelerado ×3/);
  const desacelerar = { effectType: "temporary", targetType: "targeted", cost: 8, effects: [{ target: "timeRate", timeFactor: 0.5, durationRounds: 2 }] };
  assert.match(skillSummary(desacelerar), /Desacelerado ×½/);
  const cost = suggestSkillCost({ ...acelerar });
  assert.ok(cost.points > 0);
  assert.ok(cost.rows.some(r => /Ritmo do tempo/.test(r.label)));
  const bigger = suggestSkillCost({ ...acelerar, effects: [{ target: "timeRate", timeFactor: 100, durationRounds: 3 }] });
  assert.ok(bigger.points > cost.points, "fator maior custa mais");
  const codes = lintSkill({ ...acelerar, effects: [{ target: "timeRate", timeFactor: 1, durationRounds: 3 }] }).map(w => w.code);
  assert.ok(codes.includes("timeRateOne"));
  assert.equal(codes.includes("zeroEffect"), false, "o fator não é a quantidade");
  const forever = lintSkill({ ...acelerar, effects: [{ target: "timeRate", timeFactor: 3, durationRounds: 0 }] }).map(w => w.code);
  assert.ok(forever.includes("timeRateForever"));
  const active = lintSkill({ ...acelerar, hasUpkeep: true, upkeepCost: 2, effects: [{ target: "timeRate", timeFactor: 3, durationRounds: 0 }] }).map(w => w.code);
  assert.equal(active.includes("timeRateForever"), false, "Ativa: dura enquanto ligada");
});

test("IA: Ritmo do tempo saneado (fator nos limites; fator 1 cai)", () => {
  const catalogs = { elements: [], conditions: [], traits: [], structures: [], weaponTypes: [], attributes: [] };
  const base = { effectType: "temporary", targetType: "self", cost: 5 };
  const ok = sanitizeSkillMechanics({ ...base, effects: [{ target: "timeRate", timeFactor: 3, durationRounds: 2 }] }, catalogs);
  assert.equal(ok.effects[0].timeFactor, 3);
  assert.equal(ok.effects[0].amount, 0);
  const huge = sanitizeSkillMechanics({ ...base, effects: [{ target: "timeRate", timeFactor: 99999, durationRounds: 2 }] }, catalogs);
  assert.equal(huge.effects[0].timeFactor, 1000);
  const one = sanitizeSkillMechanics({ ...base, effects: [{ target: "timeRate", timeFactor: 1, durationRounds: 2 }] }, catalogs);
  assert.equal(one.effectType, "none");
});

test("selo do Token: o fator e o que sobra da reserva", () => {
  const badge = effectBadge({ timeRate: { text: "×3 · 2" } });
  assert.deepEqual(badge, { text: "×3 · 2", tone: "anchor" });
});

test("tempo pessoal: o fator do efeito multiplica o ritmo da linha (composeRate)", () => {
  assert.equal(composeRate([1, 1, 3]), 3);
  assert.equal(composeRate([10, 1, 0.5]), 5);
  assert.equal(composeRate([1, 1, 1]), 1);
});

test("Glossário: a entrada Ritmo do tempo existe e some com o bloco desligado", () => {
  const on = buildGlossary({ features: { timeManipulation: true } }, { isGM: false });
  assert.ok(on.some(e => e.key === "timeRate"));
  const off = buildGlossary({ features: { timeManipulation: false } }, { isGM: false });
  assert.ok(!off.some(e => e.key === "timeRate"));
});
