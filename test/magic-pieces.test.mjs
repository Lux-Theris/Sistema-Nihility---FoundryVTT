/**
 * Lote 1 da magia (1.123.0): Refletir, Drenar, Purificar, Reviver, Golpes N com a corrente, Ver pela Marca.
 * Só as regras puras e os pontos onde elas entram (frase, aviso, custo, IA, listas de cópia, Glossário).
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { reflectedAmount, reflectFlagFrom, normalizeReflect, reflectSentence, reflectResultText, reflectLabel } from "../module/combat/reflect-rules.js";
import { drainKindOf, targetAcceptsDrain, drainGainEntry, drainGainAmount, drainSentence, drainResultText, linkedDrainEffects, drainLint } from "../module/skills/drain-rules.js";
import { pickPurified, isPurifiable, exposureToClear, purifyResultText } from "../module/skills/purify-rules.js";
import { reviveBlockReason, reviveHp, reviveSentence } from "../module/skills/revive-rules.js";
import { strikeCount, hasChain, chainChance, chainRadius, chainStep, strikesSentence, strikesLint } from "../module/skills/strikes-rules.js";
import { detectionNeeded, senseObserved, scryBlockReason, scryRadiusMeters, scryFlagFrom } from "../module/combat/scry-rules.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { suggestSkillCost } from "../module/skills/skill-cost-rules.js";
import { sanitizeSkillMechanics } from "../module/ai/ai-mechanics.js";
import { REQUEST_MECHANIC_FIELDS } from "../module/creation/creation-rules.js";
import { buildGrantedSkillData } from "../module/skills/skill-snapshot.js";
import { NIHILITY } from "../module/core/config.js";
import { buildGlossary } from "../module/glossary/glossary-rules.js";

/* ------------------------------------------------------------------ Refletir */

test("Refletir: % do que o golpe tirou; só o Escudo; soma sem passar do dano recebido", () => {
  assert.equal(reflectedAmount([{ percent: 50 }], { toShield: 4, toHp: 6 }), 5);
  assert.equal(reflectedAmount([{ percent: 50, shieldOnly: true }], { toShield: 4, toHp: 6 }), 2);
  assert.equal(reflectedAmount([{ percent: 80 }, { percent: 80 }], { toShield: 0, toHp: 10 }), 10, "nunca mais que o recebido");
  assert.equal(reflectedAmount([], { toHp: 10 }), 0);
  assert.equal(reflectedAmount([{ percent: 50 }], { toShield: 0, toHp: 0 }), 0);
  assert.equal(normalizeReflect(250), 100);
  assert.deepEqual(reflectFlagFrom({ amount: 30, reflectShieldOnly: true }), { percent: 30, shieldOnly: true });
  assert.equal(reflectFlagFrom({ amount: 0 }), null);
  assert.match(reflectSentence(30, true), /Escudo/);
  assert.equal(reflectResultText({ amount: 6, attackerName: "Kael" }), "Refletiu 6 de volta para Kael");
  assert.match(reflectLabel("Bola de Fogo"), /refletido/);
});

/* ------------------------------------------------------------------ Drenar */

test("Drenar: só com a caixa, valor negativo e alvo que drena", () => {
  assert.equal(drainKindOf({ drain: true, target: "heal", amount: -8 }), "life");
  assert.equal(drainKindOf({ drain: true, target: "restoreEnergy", amount: -8 }), "mana");
  assert.equal(drainKindOf({ drain: true, target: "strength", amount: -3 }), "attribute");
  assert.equal(drainKindOf({ drain: true, target: "hp", amount: -3, periodic: true }), "tick-life");
  assert.equal(drainKindOf({ drain: true, target: "energy", amount: -3, periodic: true }), "tick-mana");
  assert.equal(drainKindOf({ drain: false, target: "heal", amount: -8 }), null);
  assert.equal(drainKindOf({ drain: true, target: "heal", amount: 8 }), null);
  assert.equal(drainKindOf({ drain: true, target: "shield", amount: -8 }), null);
  assert.equal(targetAcceptsDrain("strength"), true);
  assert.equal(targetAcceptsDrain("hp", true), true);
  assert.equal(targetAcceptsDrain("hp", false), false);
});

test("Drenar atributo: o ganho é o mesmo X, sem Condição nem periódico; os dois efeitos terminam juntos", () => {
  const gain = drainGainEntry({ target: "strength", amount: -4, conditionId: "x", periodic: true, drain: true, durationRounds: 3, chance: 40 });
  assert.equal(gain.amount, 4);
  assert.equal(gain.conditionId, "");
  assert.equal(gain.periodic, false);
  assert.equal(gain.drain, false);
  assert.equal(gain.chance, 100);
  assert.equal(gain.durationRounds, 3);
  const list = [{ id: "a", drainId: "d1" }, { id: "b", drainId: "d1" }, { id: "c", drainId: "d2" }, { id: "e" }];
  assert.deepEqual(linkedDrainEffects(list, list[0]).map(e => e.id), ["b"]);
  assert.deepEqual(linkedDrainEffects(list, list[3]), []);
  assert.equal(drainGainAmount(-3), 0);
  assert.equal(drainGainAmount(7.4), 7);
  assert.match(drainSentence({ drain: true, target: "strength", amount: -4 }, { targetLabel: "Força" }), /Força.*ganha 4/);
  assert.match(drainResultText({ kind: "mana", lost: 8, gained: 8, casterName: "Kael" }), /Kael recupera 8/);
  assert.equal(drainResultText({ lost: 0 }), "");
});

test("Drenar: avisos do editor", () => {
  assert.equal(drainLint({ drain: false }).length, 0);
  assert.equal(drainLint({ drain: true, amount: 3, target: "heal" })[0].code, "drainPositive");
  assert.equal(drainLint({ drain: true, amount: -3, target: "shield" })[0].code, "drainTarget");
  assert.equal(drainLint({ drain: true, amount: -3, target: "heal" }).length, 0);
});

/* ------------------------------------------------------------------ Purificar */

test("Purificar: só Condição de nível até o da Skill, de maior nível primeiro, até o máximo; protegidas ficam", () => {
  const list = [
    { id: "1", conditionId: "poison", sourceLevel: 3 },
    { id: "2", conditionId: "blind", sourceLevel: 8 },
    { id: "3", conditionId: "burn", sourceLevel: 5 },
    { id: "4", conditionId: "", sourceLevel: 0 },
    { id: "5", conditionId: "fallen", sourceLevel: 0, protectedFlag: true }
  ];
  assert.deepEqual(pickPurified(list, { level: 5 }), ["3", "1"]);
  assert.deepEqual(pickPurified(list, { level: 5, max: 1 }), ["3"]);
  assert.deepEqual(pickPurified(list, { level: 10, conditionId: "blind" }), ["2"]);
  assert.deepEqual(pickPurified(list, { level: 1 }), []);
  assert.equal(isPurifiable({ conditionId: "x", sourceLevel: 0 }, 0), true, "marcada à mão (nível 0) sai");
  assert.deepEqual(exposureToClear([{ conditionId: "a" }, { conditionId: "a" }, { conditionId: "b" }]), ["a", "b"]);
  assert.equal(purifyResultText(["Veneno", "Cegueira"]), "Purificou: Veneno, Cegueira");
  assert.match(purifyResultText([], { blockedByLevel: 2 }), /forte/);
});

/* ------------------------------------------------------------------ Reviver */

test("Reviver: só em morto; corpo predado não revive; Vida em pontos ou %", () => {
  assert.equal(reviveBlockReason({ dead: true }), null);
  assert.match(reviveBlockReason({ dead: false }), /não está morto/);
  assert.match(reviveBlockReason({ dead: true, predated: true }), /consumido/);
  assert.ok(reviveBlockReason({ dead: true, isCharacter: false }));
  assert.equal(reviveHp(10, { max: 50 }), 10);
  assert.equal(reviveHp(50, { percent: true, max: 80 }), 40);
  assert.equal(reviveHp(0, { max: 80 }), 1, "mínimo 1");
  assert.equal(reviveHp(500, { max: 80 }), 80);
  assert.match(reviveSentence({ amount: 30, amountMode: "percentMax" }), /30% da Vida/);
});

/* ------------------------------------------------------------------ Golpes N e a corrente */

test("Golpes N: 1 a 10; a corrente precisa de mais de 1 golpe", () => {
  assert.equal(strikeCount({}), 1);
  assert.equal(strikeCount({ strikes: 3 }), 3);
  assert.equal(strikeCount({ strikes: 99 }), 10);
  assert.equal(hasChain({ strikes: 3, chainChance: 40 }), true);
  assert.equal(hasChain({ strikes: 1, chainChance: 40 }), false);
  assert.equal(chainChance({ chainChance: 40 }, 15), 55);
  assert.equal(chainChance({ chainChance: 95 }, 15), 100, "teto de 100%");
  assert.equal(chainRadius({}), 5);
  assert.equal(chainRadius({ chainRadius: 8 }), 8);
  assert.match(strikesSentence({ strikes: 3, chainChance: 40, chainRadius: 6 }), /3 golpes, saltando entre alvos \(40%, até 6 m/);
  assert.equal(strikesSentence({ strikes: 1 }), "");
  assert.equal(strikesLint({ strikes: 1, chainChance: 30 })[0].code, "chainNoStrikes");
});

test("Corrente: quem passou na chance e está no raio; vence o mais perto; o mesmo alvo só se permitido", () => {
  const near = [{ uuid: "A", distance: 0 }, { uuid: "B", distance: 4 }, { uuid: "C", distance: 2 }, { uuid: "D", distance: 9 }];
  const all = chainStep(near, { lastUuid: "A", radius: 5, chance: 50, roll: () => true });
  assert.equal(all.picked, "C", "o mais perto entre os que passaram");
  assert.equal(all.tried, 2, "A (o último) e D (fora do raio) não disputam");
  const none = chainStep(near, { lastUuid: "A", radius: 5, chance: 50, roll: () => false });
  assert.equal(none.picked, null);
  const repeat = chainStep(near, { lastUuid: "A", radius: 5, chance: 50, allowRepeat: true, roll: () => true });
  assert.equal(repeat.picked, "A", "o mesmo alvo de novo");
  const rolls = [false, true];
  const second = chainStep(near, { lastUuid: "A", radius: 5, chance: 50, roll: () => rolls.shift() });
  assert.equal(second.picked, "B", "C não passou; B passou");
});

/* ------------------------------------------------------------------ Ver pela Marca */

test("Ver pela Marca: curva da Detecção, recusas e raio", () => {
  assert.equal(detectionNeeded(1), 2);
  assert.equal(detectionNeeded(5), 9);
  assert.equal(detectionNeeded(10), 15);
  assert.equal(detectionNeeded(20), 27);
  assert.equal(detectionNeeded(100), 110);
  assert.equal(senseObserved(15, 10), true);
  assert.equal(senseObserved(14, 10), false);
  assert.equal(senseObserved(0, 10), false);
  assert.match(scryBlockReason({ hasMark: false }), /Marca sua/);
  assert.match(scryBlockReason({ hasMark: true, sameActor: true }), /própria/);
  assert.equal(scryBlockReason({ hasMark: true }), null);
  assert.equal(scryRadiusMeters(12), 12);
  assert.equal(scryRadiusMeters(0, 20), 20);
  assert.equal(scryRadiusMeters(0, 0), 30);
  assert.equal(scryFlagFrom({ markedUuid: "Actor.x", radius: 8, level: 3 }).markedUuid, "Actor.x");
});

/* ------------------------------------------------------------------ Onde entram */

test("os alvos novos existem, têm rótulo e grupo", () => {
  for (const t of ["reflect", "purify", "revive", "scry"]) {
    assert.ok(NIHILITY.EFFECT_TARGETS.includes(t), t);
    assert.ok(NIHILITY.EFFECT_TARGET_LABELS[t], t);
    assert.ok(NIHILITY.EFFECT_TARGET_GROUPS.some(g => g.targets.includes(t)), t);
  }
});

test("frase da Skill: as peças novas, o Drenar Vida e os golpes", () => {
  const sentence = effects => skillSummary({ effectType: "temporary", targetType: "targeted", cost: 6, effects });
  assert.match(sentence([{ target: "reflect", amount: 30, durationRounds: 3 }]), /reflete 30% do dano que recebe/);
  assert.match(sentence([{ target: "purify", amount: 0, durationRounds: 0 }]), /purifica as Condições/);
  assert.match(sentence([{ target: "revive", amount: 20, durationRounds: 0 }]), /revive com 20 de Vida/);
  assert.match(sentence([{ target: "scry", amount: 10, durationRounds: 3 }]), /vê pela Marca do alvo \(raio 10 m\)/);
  assert.match(sentence([{ target: "restoreEnergy", amount: -8, drain: true, durationRounds: 0 }]), /drena 8 de Mana/);
  assert.match(sentence([{ target: "stealth", amount: 2, chance: 40, id: "e1", durationRounds: 2 }]), /40% de chance/);
  assert.match(skillSummary({ effectType: "damage", damageFormula: "2d6", lifeSteal: 50, strikes: 3, chainChance: 30, cost: 5, targetType: "targeted" }), /drena 50% como Vida.*3 golpes, saltando entre alvos/);
});

test("aviso do editor: Reviver em área, Ver pela Marca em Si mesmo, Drenar sem valor negativo", () => {
  const codes = mech => lintSkill(mech).map(w => w.code);
  assert.ok(codes({ effectType: "temporary", targetType: "emission", areaDistance: 3, effects: [{ target: "revive", amount: 10, durationRounds: 0 }] }).includes("reviveArea"));
  assert.ok(codes({ effectType: "temporary", targetType: "self", effects: [{ target: "scry", amount: 5, durationRounds: 2 }] }).includes("scrySelf"));
  assert.ok(codes({ effectType: "temporary", targetType: "targeted", effects: [{ target: "heal", amount: 5, drain: true, durationRounds: 0 }] }).includes("drainPositive"));
  assert.ok(!codes({ effectType: "temporary", targetType: "targeted", effects: [{ target: "purify", amount: 0, durationRounds: 0 }] }).includes("zeroEffect"), "Purificar não pede valor");
  assert.ok(codes({ effectType: "damage", targetType: "targeted", damageFormula: "1d6", chainChance: 30, strikes: 1 }).includes("chainNoStrikes"));
});

test("custo sugerido: as peças novas somam pontos; golpes multiplicam; chance e Drenar pesam", () => {
  const cost = effects => suggestSkillCost({ effectType: "temporary", level: 1, targetType: "targeted", effects }).points;
  assert.ok(cost([{ target: "purify", amount: 0, durationRounds: 0 }]) > 0);
  assert.ok(cost([{ target: "revive", amount: 20, durationRounds: 0 }]) > cost([{ target: "revive", amount: 5, durationRounds: 0 }]));
  assert.ok(cost([{ target: "reflect", amount: 50, durationRounds: 3 }]) > 0);
  const one = suggestSkillCost({ effectType: "damage", damageFormula: "2d6", targetType: "targeted", level: 1 }).points;
  const three = suggestSkillCost({ effectType: "damage", damageFormula: "2d6", targetType: "targeted", level: 1, strikes: 3 }).points;
  assert.ok(three > one * 2.5);
  const sure = cost([{ target: "stealth", amount: -3, durationRounds: 2 }]);
  const half = cost([{ target: "stealth", amount: -3, durationRounds: 2, chance: 50 }]);
  assert.ok(half < sure);
  const plain = cost([{ target: "restoreEnergy", amount: -8, durationRounds: 0 }]);
  const drain = cost([{ target: "restoreEnergy", amount: -8, drain: true, durationRounds: 0 }]);
  assert.ok(drain > plain);
});

test("IA: as peças novas saneadas", () => {
  const base = { effectType: "temporary", targetType: "targeted", cost: 5 };
  const first = sanitizeSkillMechanics({
    ...base, strikes: 4, chainChance: 40, chainRadius: 6, chainRepeat: true,
    effects: [
      { target: "reflect", amount: 250, reflectShieldOnly: true, durationRounds: 3 },
      { target: "purify", amount: 2 },
      { target: "revive", amount: 20, amountMode: "percentMax" },
      { target: "scry", amount: 12, durationRounds: 3 }
    ]
  }, {});
  const second = sanitizeSkillMechanics({
    ...base,
    effects: [
      { target: "restoreEnergy", amount: -6, drain: true },
      { target: "heal", amount: 6, drain: true },
      { target: "stealth", amount: -2, durationRounds: 2, chance: 40 }
    ]
  }, {});
  const out = { ...first, effects: [...first.effects, ...second.effects] };
  const by = t => out.effects.find(e => e.target === t);
  assert.equal(by("reflect").amount, 100);
  assert.equal(by("reflect").reflectShieldOnly, true);
  assert.equal(by("purify").durationRounds, 0);
  assert.equal(by("revive").amountMode, "percentMax");
  assert.equal(by("scry").amount, 12);
  assert.equal(by("restoreEnergy").drain, true);
  assert.equal(by("heal").drain, undefined, "Drenar com valor positivo não vale");
  assert.equal(by("stealth").chance, 40);
  assert.deepEqual([out.strikes, out.chainChance, out.chainRadius, out.chainRepeat], [4, 40, 6, true]);
  const dmg = sanitizeSkillMechanics({ effectType: "damage", damageFormula: "1d8", lifeSteal: 50, strikes: 2 }, {});
  assert.equal(dmg.strikes, 2);
  assert.equal(dmg.chainChance, 0);
});

test("campo novo de Skill nas listas de cópia: pedido de Skill e Habilidade Concedida", () => {
  for (const key of ["strikes", "chainChance", "chainRadius", "chainRepeat"]) assert.ok(REQUEST_MECHANIC_FIELDS.includes(key), key);
  const granted = buildGrantedSkillData({ name: "Raio em cadeia", tier: "normal", effectType: "damage", damageFormula: "1d8", strikes: 3, chainChance: 40, chainRadius: 6, chainRepeat: true }, ["normal"]);
  assert.deepEqual([granted.system.strikes, granted.system.chainChance, granted.system.chainRadius, granted.system.chainRepeat], [3, 40, 6, true]);
});

test("Glossário: as peças novas têm verbete", () => {
  const entries = buildGlossary({});
  const keys = new Set(entries.map(e => e.key));
  for (const key of ["reflect", "purify", "revive", "drain", "strikes", "scry", "chanceProgression"]) assert.ok(keys.has(key), key);
});
