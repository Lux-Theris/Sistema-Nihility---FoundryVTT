/**
 * Resistência a Condição por exposição, "fura imunidade", roubo de vida e concentração da área (1.119.0).
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  exposureNeeded,
  stepExposure,
  exposureExpired,
  scaleEntryByResistance,
  resistExposureText,
  resistFloatText,
  resistLandedText,
  exposureNumber
} from "../module/combat/condition-resist-rules.js";
import { normalizeLifeSteal, lifeStealAmount, lifeStealNote, lifeStealResultText } from "../module/combat/life-steal-rules.js";
import { REQUEST_MECHANIC_FIELDS } from "../module/creation/creation-rules.js";
import { sanitizeSkillMechanics } from "../module/ai/ai-mechanics.js";
import { buildGrantedSkillData } from "../module/skills/skill-snapshot.js";
import { skillSummary } from "../module/skills/skill-summary.js";

const NOW = { combatId: "c1", round: 1, time: 1000 };

test("quantas exposições até pegar: 30% = 2, 75% = 4, 90% = 10, sem resistência = 1, imune nunca", () => {
  assert.equal(exposureNeeded(0), 1);
  assert.equal(exposureNeeded(0.3), 2);
  assert.equal(exposureNeeded(0.5), 2);
  assert.equal(exposureNeeded(0.75), 4);
  assert.equal(exposureNeeded(0.9), 10);
  assert.equal(exposureNeeded(1), Infinity);
});

function expose(times, resistPercent, startRound = 1) {
  let state = null;
  let last = null;
  for (let i = 0; i < times; i++) {
    last = stepExposure(state, { combatId: "c1", round: startRound + i, time: 0 }, { resistPercent });
    state = last.next;
  }
  return last;
}

test("a Condição pega quando o contador chega a 1 (30% na 2ª, 90% na 10ª)", () => {
  assert.equal(expose(1, 30).lands, false);
  assert.equal(expose(1, 30).hits, 1);
  assert.equal(expose(2, 30).lands, true);
  assert.equal(expose(3, 90).lands, false);
  assert.equal(expose(9, 90).lands, false, "9 × 0,1 = 0,9: ainda não");
  assert.equal(expose(10, 90).lands, true, "10 × 0,1 = 1");
  assert.equal(expose(4, 75).lands, true);
  assert.equal(expose(3, 75).lands, false);
});

test("sem resistência pega na primeira e não guarda contador; ao pegar o contador é apagado", () => {
  const first = stepExposure(null, NOW, { resistPercent: 0 });
  assert.deepEqual([first.lands, first.next, first.factor], [true, null, 1]);
  const land = expose(2, 30);
  assert.equal(land.next, null);
  assert.equal(Math.round(land.factor * 100), 70);
});

test("o contador zera depois de 3 rodadas sem exposição (afinável), na troca de combate e fora de combate pelo relógio", () => {
  const prev = { count: 0.7, hits: 1, combatId: "c1", round: 2, time: 0 };
  assert.equal(exposureExpired(prev, { combatId: "c1", round: 5, time: 0 }), false, "3 rodadas depois ainda vale");
  assert.equal(exposureExpired(prev, { combatId: "c1", round: 6, time: 0 }), true, "mais de 3 rodadas sem exposição");
  assert.equal(exposureExpired(prev, { combatId: "c1", round: 4, time: 0 }, { resetRounds: 1 }), true);
  assert.equal(exposureExpired(prev, { combatId: "c2", round: 2, time: 0 }), true);
  const out = { count: 0.7, hits: 1, combatId: "", round: 0, time: 1000 };
  assert.equal(exposureExpired(out, { combatId: "", round: 0, time: 1000 + 18000 }), false);
  assert.equal(exposureExpired(out, { combatId: "", round: 0, time: 1000 + 18001 }), true);
  // Venceu: a próxima exposição recomeça do zero.
  const again = stepExposure(prev, { combatId: "c1", round: 20, time: 0 }, { resistPercent: 30 });
  assert.equal(again.hits, 1);
  assert.equal(again.lands, false);
});

test("ambiente: uma exposição por rodada (sem rolar a cada passo)", () => {
  const first = stepExposure(null, { combatId: "c1", round: 3, time: 0 }, { resistPercent: 30, dedupe: true });
  assert.equal(first.hits, 1);
  const same = stepExposure(first.next, { combatId: "c1", round: 3, time: 5 }, { resistPercent: 30, dedupe: true });
  assert.equal(same.duplicate, true);
  assert.equal(same.hits, 1);
  const next = stepExposure(first.next, { combatId: "c1", round: 4, time: 9 }, { resistPercent: 30, dedupe: true });
  assert.equal(next.lands, true);
  // Fora de combate: uma por 6 s de relógio real.
  const o1 = stepExposure(null, { combatId: "", round: 0, time: 10000 }, { resistPercent: 30, dedupe: true });
  assert.equal(stepExposure(o1.next, { combatId: "", round: 0, time: 12000 }, { resistPercent: 30, dedupe: true }).duplicate, true);
  assert.equal(stepExposure(o1.next, { combatId: "", round: 0, time: 17000 }, { resistPercent: 30, dedupe: true }).lands, true);
});

test("força e duração saem × (1 − X), arredondadas; número que não era zero nunca zera; rodadas no mínimo 1", () => {
  const out = scaleEntryByResistance({ amount: -10, durationRounds: 3, target: "hp" }, 0.3);
  assert.deepEqual([out.amount, out.durationRounds], [-7, 2]);
  assert.equal(scaleEntryByResistance({ amount: -1, durationRounds: 1 }, 0.9).amount, -1);
  assert.equal(scaleEntryByResistance({ amount: 0, durationRounds: 2 }, 0.9).durationRounds, 1);
  assert.equal(scaleEntryByResistance({ amount: 0, durationRounds: 0 }, 0.5).durationRounds, 0, "sem prazo continua sem prazo");
  assert.equal(scaleEntryByResistance({ amount: 20, durationRounds: 0 }, 0.5).amount, 10);
  assert.equal(scaleEntryByResistance({ amount: 0, durationRounds: 0, hitDamage: 40 }, 0.25).hitDamage, 30);
});

test("textos de chat e flutuante (quadro Resistindo)", () => {
  assert.equal(
    resistExposureText({ actorName: "Anão", conditionLabel: "Veneno", resistPercent: 30, count: 0.7, hits: 1, needed: 2 }),
    "Anão resiste ao Veneno (30%): exposição 0,7 de 1. Pega na próxima."
  );
  assert.match(resistExposureText({ actorName: "Troll", conditionLabel: "Veneno", resistPercent: 90, count: 0.3, hits: 3, needed: 10 }), /Faltam 7 exposições/);
  assert.equal(resistFloatText({ kind: "resist", conditionLabel: "Veneno", hits: 1, needed: 2 }), "Resistindo: Veneno (1/2)");
  assert.equal(resistFloatText({ kind: "immune", conditionLabel: "Sangramento" }), "Imune: Sangramento");
  assert.equal(
    resistLandedText({ actorName: "Anão", conditionLabel: "Veneno", resistPercent: 30, before: { amount: 10, rounds: 3 }, after: { amount: 7, rounds: 2 }, periodic: true }),
    "Anão pegou Veneno com força e duração −30%: 7 por rodada, 2 rodadas (era 10 por 3)."
  );
  assert.match(resistLandedText({ actorName: "Anão", conditionLabel: "Medo", resistPercent: 30, before: { amount: 0, rounds: 0 }, after: { amount: 0, rounds: 0 } }), /só depois de resistir/);
  assert.equal(exposureNumber(0.7), "0,7");
  assert.equal(exposureNumber(1), "1");
});

test("roubo de vida: % do que entrou na Vida, inteiro, 0 a 100", () => {
  assert.equal(lifeStealAmount(8, 50), 4);
  assert.equal(lifeStealAmount(0, 50), 0, "o Escudo absorveu tudo: nada entrou");
  assert.equal(lifeStealAmount(8, 0), 0);
  assert.equal(lifeStealAmount(10, 250), 10, "teto de 100%");
  assert.equal(normalizeLifeSteal(-5), 0);
  assert.equal(normalizeLifeSteal("33.4"), 33);
  assert.equal(lifeStealNote(50), "Cura quem usa: 50% do dano que entrou");
  assert.equal(lifeStealResultText({ healed: 4, healerName: "Kaito", requested: 4 }), "+4 Vida em Kaito");
  assert.match(lifeStealResultText({ healed: 0, healerName: "Kaito", requested: 4 }), /não recuperou/);
  assert.equal(lifeStealResultText({}), "");
});

test("campos novos (Cura quem usa, Raio base da Estrutura) estão nas listas de cópia; a IA limpa os valores", () => {
  for (const key of ["lifeSteal", "structureSize"]) assert.ok(REQUEST_MECHANIC_FIELDS.includes(key), key);
  const granted = buildGrantedSkillData({ name: "Extração", tier: "normal", effectType: "damage", damageFormula: "1d8", lifeSteal: 50, structureSize: 4 }, ["normal"]);
  assert.equal(granted.system.lifeSteal, 50);
  assert.equal(granted.system.structureSize, 4);
  const catalogs = { elements: [], conditions: [], traits: [], structures: [{ id: "campo" }], attributes: [], weaponTypes: [] };
  const damage = sanitizeSkillMechanics({ effectType: "damage", damageFormula: "1d8", lifeSteal: 250 }, catalogs);
  assert.equal(damage.lifeSteal, 100, "teto de 100%");
  const other = sanitizeSkillMechanics({ effectType: "none", lifeSteal: 50 }, catalogs);
  assert.equal(other.lifeSteal, 0, "só vale numa Skill de dano");
  const field = sanitizeSkillMechanics({ effectType: "structure", structureId: "campo", structureSize: 4.3 }, catalogs);
  assert.equal(field.structureSize, 4.5);
});

test("a frase da Skill diz o Raio base da Estrutura e que a Condição fura imunidade", () => {
  const text = skillSummary({ effectType: "structure", structureId: "campo", structureSize: 5, areaPerLevel: 1 }, { structures: { campo: "Campo" }, structureSizes: { campo: 3 } });
  assert.match(text, /Campo de 5 m/);
  const effect = skillSummary({ effectType: "temporary", targetType: "targeted", effects: [{ target: "hp", amount: 0, conditionId: "bleeding", piercesCondition: true }] }, { conditions: { bleeding: "Sangramento" } });
  assert.match(effect, /Sangramento, fura imunidade/);
});
