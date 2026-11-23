/**
 * Manipulação do tempo, Parar (8e.4/8e.5): as contas puras do Parado no tempo, o dano acumulado, o selo do Token,
 * a recusa do efeito (Nave), o Desfazer uso da reserva e as peças que leem o modo Parar.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  stopRoundsFor, stopCountdown, frozenRoundsLeft, needsFreeze, stopDamageAdd, stopDamageRemove, stopDamageFactor,
  stopReturnSummary, stopHitText, stopNoticeText, stopBadgeText, stopActionText
} from "../module/combat/time-stop-rules.js";
import { resolveEffectChange } from "../module/skills/effect-targets.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";
import { effectBadge } from "../module/combat/effect-badge-rules.js";
import { undoPreviewRows, UNDO_FLAG_KEYS } from "../module/skills/skill-undo-rules.js";
import { sanitizeSkillMechanics } from "../module/ai/ai-mechanics.js";
import { buildGlossary } from "../module/glossary/glossary-rules.js";

test("Parar: o prazo encolhe com a força do alvo e zera no dobro do nível", () => {
  assert.equal(stopRoundsFor(4, 1), 4);
  assert.equal(stopRoundsFor(4, 0.5), 2);
  assert.equal(stopRoundsFor(3, 0.5), 1);
  assert.equal(stopRoundsFor(4, 0), 0);
  assert.equal(stopRoundsFor("x", 1), 0);
});

test("Parar: o prazo desce no turno de quem lançou e a Ativa nunca acaba aqui", () => {
  assert.deepEqual(stopCountdown(3), { remaining: 2, ended: false });
  assert.deepEqual(stopCountdown(1), { remaining: 0, ended: true });
  assert.deepEqual(stopCountdown(0), { remaining: 0, ended: true });
  assert.deepEqual(stopCountdown(0, { forever: true }), { remaining: 0, ended: false });
});

test("Parado: os prazos dos efeitos dele ficam congelados a cada virada de rodada", () => {
  // Prazo 3 que começou na rodada 2; na rodada 3 passou 1 rodada, mas ele estava parado: continua 3.
  assert.equal(frozenRoundsLeft({ total: 3, start: 2, round: 2 }), 3, "na rodada em que começou, nada passou");
  assert.equal(frozenRoundsLeft({ total: 3, start: 2, round: 3 }), 2, "o que faltava ao fim da rodada 3 (antes de virar)");
  assert.equal(needsFreeze({ total: 3, start: 2, round: 3 }), true);
  assert.equal(needsFreeze({ total: 3, start: 3, round: 3 }), false, "já foi regravado nesta rodada");
  assert.equal(needsFreeze({ total: 0, start: 1, round: 3 }), false, "sem prazo não há o que congelar");
  assert.equal(needsFreeze({ total: 1, start: 1, round: 3 }), false, "já tinha vencido: fica com o núcleo");
});

test("dano acumulado: guarda, troca o fator do mesmo golpe, tira e respeita o teto", () => {
  let list = stopDamageAdd([], { messageId: "m1", index: null, factor: 1 });
  list = stopDamageAdd(list, { messageId: "m2", index: 0, factor: 0.5 });
  list = stopDamageAdd(list, { messageId: "m1", index: null, factor: 2 });
  assert.equal(list.length, 2);
  assert.equal(stopDamageFactor(list, { messageId: "m1", index: null }), 2);
  assert.equal(stopDamageFactor(list, { messageId: "m2", index: 0 }), 0.5);
  assert.equal(stopDamageFactor(list, { messageId: "zz", index: 0 }), null);
  list = stopDamageRemove(list, { messageId: "m2", index: 0 });
  assert.deepEqual(list.map(e => e.messageId), ["m1"]);
  assert.deepEqual(stopDamageAdd([], {}), []);
  let many = [];
  for (let i = 0; i < 250; i++) many = stopDamageAdd(many, { messageId: `m${i}`, index: 0, factor: 1 });
  assert.equal(many.length, 200);
  assert.equal(many.at(-1).messageId, "m249");
});

test("cartão 'O tempo voltou': soma por golpe e texto", () => {
  const sum = stopReturnSummary([{ label: "a", toShield: 20, toHp: 30 }, { label: "b", toShield: 0, toHp: 15 }]);
  assert.deepEqual(sum, { count: 2, toShield: 20, toHp: 45, total: 65 });
  assert.equal(stopHitText({ toShield: 20, toHp: 45 }), "20 no Escudo · 45 na Vida");
  assert.equal(stopHitText({ toShield: 0, toHp: 0 }), "sem efeito");
  assert.deepEqual(stopReturnSummary([]), { count: 0, toShield: 0, toHp: 0, total: 0 });
});

test("avisos do Parado: o turno, o selo do Token e a recusa", () => {
  const n = stopNoticeText("Gobbo", { remaining: 2, casterName: "Mira" });
  assert.equal(n.title, "Gobbo está Parado no tempo");
  assert.match(n.body, /Pule o turno dele\. Faltam 2 turnos de Mira\./);
  assert.match(stopNoticeText("Gobbo", { remaining: 1 }).body, /1 turno\./);
  assert.match(stopNoticeText("Gobbo", { forever: true, casterName: "Mira" }).body, /enquanto Mira mantiver/);
  assert.equal(stopBadgeText({ remaining: 2 }), "⏸ 2");
  assert.equal(stopBadgeText({ forever: true }), "⏸ ∞");
  assert.deepEqual(effectBadge({ timeStop: { text: "⏸ 2" }, timeRate: { text: "×3" } }), { text: "⏸ 2", tone: "time" });
  assert.match(stopActionText("Gobbo", "atacar"), /Gobbo está Parado no tempo e não pode atacar/);
});

test("o efeito Parar: resolve sem campo, recusa Nave, frase e avisos", () => {
  const char = { type: "character", system: { attributes: { combat: {} } } };
  const change = resolveEffectChange({ target: "timeRate", timeStop: true, durationRounds: 2 }, char);
  assert.deepEqual(change.timeStop, { rounds: 2 });
  assert.equal(resolveEffectChange({ target: "timeRate", timeStop: true, durationRounds: 2 }, { type: "starship" }), null);
  assert.equal(resolveEffectChange({ target: "timeRate", timeStop: true, durationRounds: 2 }, { type: "vehicle" }), null);
  const mech = { effectType: "temporary", targetType: "targeted", cost: 8, level: 1, effects: [{ target: "timeRate", timeStop: true, durationRounds: 2 }] };
  assert.match(skillSummary(mech, {}).text ?? skillSummary(mech, {}), /para o tempo/);
  const codes = lintSkill({ ...mech, effects: [{ target: "timeRate", timeStop: true, durationRounds: 0 }] }).map(w => w.code);
  assert.ok(codes.includes("timeStopForever"));
  assert.ok(!lintSkill(mech).map(w => w.code).includes("timeRateOne"), "Parar não vira 'fator 1'");
});

test("IA: Parar passa saneado (fator ignorado, não cai como fator 1)", () => {
  const catalogs = { elements: [], conditions: [], traits: [], structures: [], weaponTypes: [], attributes: [] };
  const base = { effectType: "temporary", targetType: "targeted", cost: 5 };
  const ok = sanitizeSkillMechanics({ ...base, effects: [{ target: "timeRate", timeStop: true, timeFactor: 1, durationRounds: 2 }] }, catalogs);
  assert.equal(ok.effects[0].timeStop, true);
});

test("Desfazer uso: o gasto da reserva volta (flag fotografada) e aparece na prévia", () => {
  assert.ok(UNDO_FLAG_KEYS.includes("timeReserve"));
  const rows = undoPreviewRows({ actors: [{ name: "Kira", isSource: true, vitals: [], flags: [["timeReserve", [{ value: 3 }, { value: 1 }]]] }] });
  assert.ok(rows.some(r => /Reserva de tempo de Kira/.test(r.text)));
});

test("Glossário: Parado no tempo e Dano acumulado existem e somem com o bloco desligado", () => {
  const on = buildGlossary({ features: { timeManipulation: true } }, { isGM: false });
  assert.ok(on.some(e => e.key === "timeStop"));
  assert.ok(on.some(e => e.key === "timeStopDamage"));
  const off = buildGlossary({ features: { timeManipulation: false } }, { isGM: false });
  assert.ok(!off.some(e => e.key === "timeStop"));
});
