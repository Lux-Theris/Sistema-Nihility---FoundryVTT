/**
 * Manipulação do tempo, Reverter (8e.7/8e.8) e as peças do 8e.6 (Parar em área, câmara temporária): as contas puras
 * do anel de fotos, do registro de efeitos, dos vínculos e da Forma; a mecânica do efeito nas listas de leitura.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  clampRewindCap, rewindRoundsFor, rewindSeconds, pushPhoto, pickPhoto, formSignature, formChanged, bondPartnerUuids,
  bondCost, effectLogWorthy, logEffectEvent, effectLogPlan, effectLogAfterRewind, roundsText, changeRows, EFFECT_LOG_CAP
} from "../module/combat/time-rewind-rules.js";
import { resolveEffectChange } from "../module/skills/effect-targets.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";
import { suggestSkillCost } from "../module/skills/skill-cost-rules.js";
import { sanitizeSkillMechanics } from "../module/ai/ai-mechanics.js";
import { buildGlossary } from "../module/glossary/glossary-rules.js";
import { UNDO_FLAG_KEYS } from "../module/skills/skill-undo-rules.js";
import { RESTORE_SKIP_FLAGS, actorRestoreUpdate } from "../module/world/actor-snapshot-rules.js";

test("o teto de rodadas: inteiro de 1 a 100, lixo vira 10", () => {
  assert.equal(clampRewindCap(10), 10);
  assert.equal(clampRewindCap(0), 10);
  assert.equal(clampRewindCap("abc"), 10);
  assert.equal(clampRewindCap(500), 100);
  assert.equal(clampRewindCap(3.9), 3);
});

test("rodadas do Reverter: o pedido até o teto, encolhido pela força do alvo", () => {
  assert.equal(rewindRoundsFor(5, 1, 10), 5);
  assert.equal(rewindRoundsFor(50, 1, 10), 10, "o teto das Regras desta mesa");
  assert.equal(rewindRoundsFor(6, 0.5, 10), 3);
  assert.equal(rewindRoundsFor(5, 0, 10), 0, "alvo forte demais");
  assert.equal(rewindRoundsFor(0, 1, 10), 0);
  assert.equal(rewindRoundsFor(3, 0.9, 10), 2);
});

test("segundos de tempo pessoal: a rodada do relógio, ou 6 fora de combate", () => {
  assert.equal(rewindSeconds(4, 6), 24);
  assert.equal(rewindSeconds(4, 0), 0, "o combate não passa tempo: nada recua");
  assert.equal(rewindSeconds(4, 0, { fallback: true }), 24);
  assert.equal(rewindSeconds(0, 6), 0);
});

test("o anel de fotos: a mesma rodada e turno substitui e o excesso sai pelo começo", () => {
  let ring = [];
  for (let r = 1; r <= 5; r++) ring = pushPhoto(ring, { round: r, turn: 2, tag: `r${r}` }, 3);
  assert.deepEqual(ring.map(p => p.round), [3, 4, 5]);
  ring = pushPhoto(ring, { round: 5, turn: 2, tag: "novo" }, 3);
  assert.equal(ring.length, 3);
  assert.equal(ring.at(-1).tag, "novo");
  assert.deepEqual(pushPhoto(null, { round: 1, turn: 0 }).length, 1);
});

test("escolher a foto: a do turno dele N rodadas atrás; o anel curto devolve o que tem", () => {
  const ring = [4, 5, 6, 7, 8].map(round => ({ round, turn: 1 }));
  const a = pickPhoto(ring, 2, 8);
  assert.equal(a.photo.round, 6);
  assert.equal(a.rounds, 2);
  assert.equal(a.short, false);
  const b = pickPhoto(ring, 1, 9);
  assert.equal(b.photo.round, 8, "ele ainda não agiu na rodada 9: volta ao turno dele da rodada 8");
  const c = pickPhoto(ring, 10, 8);
  assert.equal(c.photo.round, 4);
  assert.equal(c.rounds, 4);
  assert.equal(c.short, true);
  assert.equal(pickPhoto(ring, 1, 4), null, "a única foto é desta rodada");
  assert.equal(pickPhoto([], 2, 8), null);
  assert.equal(pickPhoto(ring, 0, 8), null);
});

test("Forma: mudou desde a foto = recusa", () => {
  assert.equal(formChanged({}, {}), false);
  assert.equal(formChanged({}, { formOf: { originalUuid: "Actor.a", skillId: "s1" } }), true, "virou a cópia depois da foto");
  assert.equal(formChanged({ formActive: { copyUuid: "Actor.c", skillId: "s1" } }, {}), true, "voltou ao normal depois da foto");
  const same = { formOf: { originalUuid: "Actor.a", skillId: "s1", subSkillIndex: 0 } };
  assert.equal(formChanged(same, { formOf: { originalUuid: "Actor.a", skillId: "s1", subSkillIndex: 0 } }), false);
  assert.notEqual(formSignature(same), formSignature({ formOf: { originalUuid: "Actor.a", skillId: "s2" } }));
});

test("vínculos: Nomeação, Corredor de alma e Pacto levam o parceiro junto (sem repetir nem ele mesmo)", () => {
  assert.deepEqual(bondPartnerUuids({}), []);
  assert.deepEqual(bondPartnerUuids({ soulLink: { namerUuid: "Actor.n" } }, "Actor.eu"), ["Actor.n"]);
  const flags = {
    soulLink: { namerUuid: "Actor.n" },
    soulLinks: [{ namedUuid: "Actor.a" }, { namedUuid: "Actor.n" }, { namedUuid: "Actor.eu" }],
    borrowLinks: [{ kind: "pact", sourceUuid: "Actor.p" }],
    lendLinks: [{ borrowerUuid: "Actor.b" }]
  };
  assert.deepEqual(bondPartnerUuids(flags, "Actor.eu").sort(), ["Actor.a", "Actor.b", "Actor.n", "Actor.p"]);
});

test("custo dos vínculos: o custo da Skill por parceiro; sem energia para todos, não sai", () => {
  assert.deepEqual(bondCost({ unitCost: 10, partners: 1, available: 10 }), { extra: 10, ok: true, missing: 0 });
  assert.deepEqual(bondCost({ unitCost: 10, partners: 2, available: 15 }), { extra: 20, ok: false, missing: 5 });
  assert.deepEqual(bondCost({ unitCost: 10, partners: 0, available: 0 }), { extra: 0, ok: true, missing: 0 });
  assert.equal(bondCost({ unitCost: 10, partners: 3, available: 0, charges: false }).ok, true, "campanha sem Mana não cobra");
});

test("registro de efeitos: só status e Skill, com teto", () => {
  assert.equal(effectLogWorthy({ skillEffect: true }), true);
  assert.equal(effectLogWorthy({}, { statuses: ["burning"] }), true);
  assert.equal(effectLogWorthy({}, { statuses: new Set(["x"]) }), true);
  assert.equal(effectLogWorthy({}, {}), false);
  assert.equal(effectLogWorthy({ skillEffect: true }, { disabled: true }), false);
  let log = [];
  for (let i = 0; i < EFFECT_LOG_CAP + 5; i++) log = logEffectEvent(log, { op: "c", id: `e${i}`, at: i });
  assert.equal(log.length, EFFECT_LOG_CAP);
  assert.equal(log[0].id, "e5");
  assert.deepEqual(logEffectEvent([], { op: "x", id: "a", at: 1 }), [], "operação inválida não entra");
});

test("registro de efeitos: o que nasceu depois sai, o que foi apagado depois volta, nasceu e morreu não faz nada", () => {
  const log = [
    { op: "c", id: "antigo", at: 10 },
    { op: "d", id: "antigo", at: 100, data: { _id: "antigo", name: "Bênção" } },
    { op: "c", id: "novo", at: 120 },
    { op: "c", id: "breve", at: 130 },
    { op: "d", id: "breve", at: 140, data: { _id: "breve" } },
    { op: "d", id: "velho", at: 150, data: { _id: "velho", name: "Veneno" } }
  ];
  const plan = effectLogPlan(log, 50);
  assert.deepEqual(plan.remove, ["novo"]);
  assert.deepEqual(plan.recreate.map(d => d._id).sort(), ["antigo", "velho"]);
  assert.deepEqual(effectLogPlan(log, 500), { remove: [], recreate: [] });
  assert.deepEqual(effectLogAfterRewind(log, 100).map(e => e.id), ["antigo", "antigo"]);
});

test("textos do card", () => {
  assert.equal(roundsText(1), "1 rodada");
  assert.equal(roundsText(3), "3 rodadas");
  assert.deepEqual(changeRows([{ label: "Vida", before: 5, after: 9 }, { label: "Mana", before: 4, after: 4 }]), [{ label: "Vida", text: "5 → 9" }]);
});

test("o efeito Reverter: leitura do alvo, recusa em Nave, frase, custo e avisos", () => {
  const char = { type: "character" };
  const change = resolveEffectChange({ target: "timeRate", timeRewind: true, durationRounds: 4 }, char);
  assert.equal(change.key, null);
  assert.deepEqual(change.timeRewind, { rounds: 4 });
  assert.equal(resolveEffectChange({ target: "timeRate", timeRewind: true, durationRounds: 4 }, { type: "starship" }), null);
  const reverter = { effectType: "temporary", targetType: "targeted", cost: 20, level: 1, effects: [{ target: "timeRate", timeRewind: true, durationRounds: 3 }] };
  assert.match(skillSummary(reverter), /volta o tempo do alvo em 3 rodadas/);
  assert.ok(suggestSkillCost(reverter).points > 0);
  const codes = list => lintSkill(list).map(w => w.code);
  assert.ok(!codes(reverter).includes("timeRewindNoRounds"));
  assert.ok(codes({ ...reverter, effects: [{ target: "timeRate", timeRewind: true, durationRounds: 0 }] }).includes("timeRewindNoRounds"));
  assert.ok(codes({ ...reverter, hasUpkeep: true }).includes("timeRewindActive"));
  assert.ok(codes({ ...reverter, targetType: "zone", zoneRounds: 3, areaDistance: 5 }).includes("timeRewindZone"));
  assert.ok(codes({ ...reverter, targetType: "emission", areaDistance: 5, areaShape: "circle", areaAffects: "notCaster" }).includes("timeRewindArea"));
  assert.ok(!codes(reverter).includes("timeRateOne"), "Reverter não tem fator");
});

test("Parar em área: avisa quando a área inclui quem lança; câmara temporária numa Zona avisa o alcance", () => {
  const stop = { effectType: "temporary", targetType: "emission", areaDistance: 8, areaShape: "circle", cost: 30, level: 1, effects: [{ target: "timeRate", timeStop: true, durationRounds: 2 }] };
  const codes = m => lintSkill(m).map(w => w.code);
  assert.ok(codes({ ...stop, areaAffects: "all" }).includes("timeStopArea"));
  assert.ok(!codes({ ...stop, areaAffects: "notCaster" }).includes("timeStopArea"));
  assert.ok(!codes({ ...stop, areaAffects: "enemies" }).includes("timeStopArea"));
  const zone = { effectType: "temporary", targetType: "zone", zoneRounds: 3, areaDistance: 6, areaShape: "circle", cost: 20, level: 1, effects: [{ target: "timeRate", timeFactor: 3, durationRounds: 1 }] };
  assert.ok(codes(zone).includes("timeZoneNote"));
  assert.ok(!codes({ ...zone, targetType: "targeted" }).includes("timeZoneNote"));
});

test("IA: Reverter vira timeRewind com rodadas; sem rodadas cai", () => {
  const catalogs = { elements: [], conditions: [], traits: [], structures: [], weaponTypes: [], attributes: [] };
  const base = { effectType: "temporary", targetType: "targeted", cost: 5 };
  const out = sanitizeSkillMechanics({ ...base, effects: [{ target: "timeRate", timeRewind: true, durationRounds: 4 }] }, catalogs);
  assert.equal(out.effects[0].timeRewind, true);
  assert.equal(out.effects[0].durationRounds, 4);
  const none = sanitizeSkillMechanics({ ...base, effects: [{ target: "timeRate", timeRewind: true, durationRounds: 0 }] }, catalogs);
  assert.equal(none.effects.length, 0);
});

test("o Desfazer uso não registra o Reverter e o ponto de restauração do Reverter ignora a reserva e o dano acumulado", () => {
  assert.ok(Array.isArray(UNDO_FLAG_KEYS));
  const saved = { name: "A", system: { x: 1 }, flags: { sys: { timeReserve: { value: 9 }, timeCarry: 0.5, timeStopDamage: [{}], keep: 1 } } };
  const now = { name: "A", system: { x: 2 }, flags: { sys: { timeReserve: { value: 1 }, other: 2 } } };
  const base = actorRestoreUpdate(saved, now, "sys");
  assert.ok("timeReserve" in base.update.flags.sys, "o ponto comum devolve a reserva");
  const skip = [...RESTORE_SKIP_FLAGS, "timeReserve", "timeCarry", "timeStopDamage"];
  const rewind = actorRestoreUpdate(saved, now, "sys", { skipFlags: skip });
  assert.deepEqual(Object.keys(rewind.update.flags.sys), ["keep"]);
  assert.deepEqual(rewind.removeFlagKeys, ["other"]);
});

test("Glossário: Reverter existe e some com o bloco desligado", () => {
  const on = buildGlossary({ features: { timeManipulation: true } }, { isGM: false });
  assert.ok(on.some(e => e.key === "timeRewind"));
  const off = buildGlossary({ features: { timeManipulation: false } }, { isGM: false });
  assert.ok(!off.some(e => e.key === "timeRewind"));
});
