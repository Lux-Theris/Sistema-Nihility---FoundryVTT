/**
 * Simulador de encontro (E3): rodadas, quem cai primeiro, veredito e sugestão de ajuste.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { unitHp, hitsToDrop, roundsToDefeat, roundsToDropEach, encounterVerdict, evaluateEncounter, suggestAdjustment, roundsText } from "../module/combat/encounter-rules.js";

const unit = (key, hpBase, perTarget, extra = {}) => ({ key, name: key, hpBase, shield: 0, count: 1, attack: { perTarget, targets: 1, uses: Infinity }, ...extra });

test("Vida efetiva e golpes para derrubar", () => {
  assert.equal(unitHp({ hpBase: 200 }), 200);
  assert.equal(unitHp({ hpBase: 200, shield: 30 }), 230);
  assert.equal(unitHp({ hpBase: 200, tier: "elite" }, { elite: 2 }), 400);
  assert.equal(unitHp({ hpBase: 200, tier: "minion" }), 1);
  assert.equal(hitsToDrop(150, 105), 2);
  assert.equal(hitsToDrop(100, 50), 2);
  assert.equal(hitsToDrop(100, 0), Infinity);
});

test("Rodadas para derrubar: foco em quem cai mais rápido e área acertando vários", () => {
  const hero = unit("hero", 100, { goblin: 50 });
  const goblins = unit("goblin", 100, { hero: 10 }, { count: 2 });
  // 4 golpes de 50 para derrubar 2 de 100 → 4 rodadas.
  assert.equal(roundsToDefeat([hero], [goblins]), 4);
  const mage = unit("mage", 100, { goblin: 50 }, { attack: { perTarget: { goblin: 50 }, targets: 3, uses: Infinity } });
  assert.equal(roundsToDefeat([mage], [goblins]), 2);
  assert.equal(roundsToDefeat([hero], []), 0);
  assert.equal(roundsToDefeat([], [goblins]), Infinity);
  // Sem dano não acaba.
  assert.equal(roundsToDefeat([unit("pacifist", 100, { goblin: 0 })], [goblins]), Infinity);
});

test("Mana acabando troca para o ataque de reserva", () => {
  const caster = unit("caster", 100, {}, { attack: { perTarget: { boss: 100 }, targets: 1, uses: 2, fallback: { perTarget: { boss: 10 }, targets: 1, uses: Infinity } } });
  const boss = unit("boss", 300, { caster: 1 });
  // 100 + 100 + 10×10 = 300 → 12 rodadas.
  assert.equal(roundsToDefeat([caster], [boss]), 12);
});

test("Quem cai primeiro com todos focando", () => {
  const foes = [unit("bandit", 180, { mira: 40, doran: 40 }, { count: 4 }), unit("kael", 900, { mira: 105, doran: 105 })];
  const drops = roundsToDropEach(foes, [unit("mira", 200, {}), unit("doran", 420, {})]);
  // 4×40 + 105 = 265 por rodada → Mira 1 rodada, Doran 2.
  assert.deepEqual(drops.map(d => d.rounds), [1, 2]);
});

test("Veredito: fácil, justo, perigoso, mortal", () => {
  assert.equal(encounterVerdict({ win: 2, dropFirst: 4, wipe: 8 }), "easy");
  assert.equal(encounterVerdict({ win: 4, dropFirst: 4, wipe: 8 }), "fair");
  assert.equal(encounterVerdict({ win: 5, dropFirst: 4, wipe: 8 }), "fair");
  assert.equal(encounterVerdict({ win: 6, dropFirst: 2, wipe: 8 }), "dangerous");
  assert.equal(encounterVerdict({ win: 9, dropFirst: 2, wipe: 8 }), "deadly");
  assert.equal(encounterVerdict({ win: Infinity, dropFirst: 2, wipe: 5 }), "deadly");
  assert.equal(encounterVerdict({ win: 3, dropFirst: Infinity, wipe: Infinity }), "easy");
});

test("Luta inteira e a sugestão para ficar justo", () => {
  const allies = [unit("mira", 200, { bandit: 60 }), unit("doran", 420, { bandit: 60 })];
  const foes = [unit("bandit", 180, { mira: 50, doran: 50 }, { count: 4, npc: true, tier: "normal" })];
  const result = evaluateEncounter({ allies, foes });
  assert.ok(["dangerous", "deadly", "fair", "easy"].includes(result.verdict));
  assert.equal(result.weakest.key, "mira");
  const tooHard = { allies, foes: [unit("bandit", 180, { mira: 70, doran: 70 }, { count: 6, npc: true, tier: "normal" })] };
  assert.notEqual(evaluateEncounter(tooHard).verdict, "fair");
  const suggestion = suggestAdjustment(tooHard);
  if (suggestion) {
    assert.match(suggestion.text, /tire 1|troque/);
    assert.equal(evaluateEncounter({ allies, foes: suggestion.foes }).verdict, "fair");
  }
  // Já justo: nada a sugerir.
  const fair = { allies: [unit("a", 100, { b: 50 })], foes: [unit("b", 100, { a: 50 }, { npc: true })] };
  assert.equal(evaluateEncounter(fair).verdict, "fair");
  assert.equal(suggestAdjustment(fair), null);
  assert.equal(roundsText(Infinity), "não acaba");
  assert.equal(roundsText(1), "1 rodada");
  assert.equal(roundsText(6), "~6 rodadas");
});
