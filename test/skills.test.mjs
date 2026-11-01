/**
 * Skills: snapshot de fusão, Habilidade Concedida, a Skill numa frase, Desfazer uso e o Avançado dos editores.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { buildSubSkillsFromSources, buildGrantedSkillData } from "../module/skills/skill-snapshot.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import {
  diffFields,
  revertFields,
  revertPools,
  diffEffects,
  actorEntryHasChanges,
  undoWindowOpen,
  undoPreviewRows,
  fieldPairs,
  asFields
} from "../module/skills/skill-undo-rules.js";
import { advancedFold } from "../module/helpers/advanced-fold.js";

/* -------------------------------------------- */
/*  Snapshot de Sub-Skill (fusão)                */
/* -------------------------------------------- */

function fakeSkill(name, system = {}) {
  return { name, system: { tier: "normal", level: 1, cost: 0, effects: [], damageElements: [], ...system } };
}

test("snapshot de fusão: cada fonte vira uma Sub-Skill com a mecânica congelada", () => {
  const subs = buildSubSkillsFromSources([
    fakeSkill("Corte", { effectType: "damage", damageFormula: "2d6" }),
    fakeSkill("Escudo", { effectType: "temporary" })
  ]);
  assert.equal(subs.length, 2);
  assert.equal(subs[0].name, "Corte");
  assert.equal(subs[0].damageFormula, "2d6");
  assert.equal(subs[1].effectType, "temporary");
});

test("snapshot de fusão: fonte que já era fusão entra ACHATADA (nunca aninha)", () => {
  const alreadyFused = fakeSkill("Fusão Antiga", {
    subSkills: [{ name: "Parte A" }, { name: "Parte B" }]
  });
  const subs = buildSubSkillsFromSources([alreadyFused, fakeSkill("Nova")]);
  assert.deepEqual(subs.map(s => s.name), ["Parte A", "Parte B", "Nova"]);
});

test("snapshot de fusão: é cópia, não referência — editar a Sub-Skill não mexe na origem", () => {
  const source = fakeSkill("Corte", { effects: [{ target: "hp", amount: -5 }] });
  const [snapshot] = buildSubSkillsFromSources([source]);
  snapshot.effects[0].amount = 999;
  assert.equal(source.system.effects[0].amount, -5);
});

/* -------------------------------------------- */
/*  Habilidade Concedida completa                */
/* -------------------------------------------- */

const GRANTABLE = ["extra", "normal", "racial"];

test("habilidade concedida: sem nome não cria nada", () => {
  assert.equal(buildGrantedSkillData({ name: "  " }, GRANTABLE), null);
  assert.equal(buildGrantedSkillData(null, GRANTABLE), null);
});

test("habilidade concedida: a mecânica inteira vai para a Skill da ficha", () => {
  const data = buildGrantedSkillData(
    {
      name: "Lâmina Flamejante", tier: "extra", level: 3, cost: 4, hasUpkeep: true, upkeepCost: 2,
      effectType: "damage", damageFormula: "2d6", isMagicDamage: true, damageElements: ["fire"],
      targetType: "emission", areaShape: "cone", areaDistance: 6
    },
    GRANTABLE
  );
  assert.equal(data.name, "Lâmina Flamejante");
  assert.equal(data.type, "skill");
  assert.equal(data.system.tier, "extra");
  assert.equal(data.system.level, 3);
  assert.equal(data.system.damageFormula, "2d6");
  assert.deepEqual(data.system.damageElements, ["fire"]);
  assert.equal(data.system.areaShape, "cone");
  assert.equal(data.system.upkeepCost, 2);
  assert.equal(data.system.isItemGranted, true);
});

test("habilidade concedida: começa desligada, inclusive as Sub-Skills, e é cópia", () => {
  const source = { name: "Arsenal", active: true, subSkills: [{ name: "Tiro", active: true, effects: [{ amount: 1 }] }] };
  const data = buildGrantedSkillData(source, GRANTABLE);
  assert.equal(data.system.active, false);
  assert.equal(data.system.subSkills[0].active, false);
  data.system.subSkills[0].effects[0].amount = 99;
  assert.equal(source.subSkills[0].effects[0].amount, 1);
});

test("habilidade concedida: tier fora da lista vira Normal; formato antigo (4 campos) continua valendo", () => {
  const data = buildGrantedSkillData({ name: "Velha", tier: "ultimate", cost: 2, description: "<p>x</p>" }, GRANTABLE);
  assert.equal(data.system.tier, "normal");
  assert.equal(data.system.cost, 2);
  assert.equal(data.system.level, 1);
  assert.equal(data.system.description, "<p>x</p>");
});

test("Skill numa frase: o que faz · onde · custo · manutenção", () => {
  const ctx = { elements: { fire: "Fogo", ice: "Gelo" }, conditions: { poison: "Envenenado" }, targets: { strength: "Força", hp: "Vida" }, structures: { wall: "Muralha" }, energyLabel: "Mana" };
  assert.equal(
    skillSummary({ effectType: "damage", damageFormula: "3d6", damageElements: ["fire"], targetType: "emission", areaShape: "cone", areaDistance: 6, cost: 30 }, { ...ctx, cost: 20 }),
    "3d6 de Fogo · cone de 6 m · 20 Mana",
    "custo já com o desconto do nível vem do ctx"
  );
  assert.equal(skillSummary({ effectType: "damage", damageFormula: "2d8", isMagicDamage: true, targetType: "targeted" }, ctx), "2d8 mágico · num alvo");
  assert.equal(
    skillSummary({ effectType: "temporary", targetType: "self", hasUpkeep: true, upkeepCost: 3, cost: 10, effects: [{ target: "strength", amount: 3 }] }, ctx),
    "Força +3 · em si · 10 Mana · Ativa: −3/rodada"
  );
  assert.equal(
    skillSummary({ effectType: "temporary", targetType: "targeted", effects: [{ target: "hp", amount: -5, periodic: true, conditionId: "poison" }, { target: "strength", amount: -2 }, { target: "hp", amount: -1 }] }, ctx),
    "Envenenado (Vida −5/rodada) e Força −2 +1 · num alvo",
    "dois efeitos por extenso, o resto contado"
  );
  assert.equal(skillSummary({ effectType: "temporary", targetType: "zone", areaShape: "circle", areaDistance: 4, zoneRounds: 3, effects: [{ target: "hp", amount: 0, conditionId: "poison" }] }, ctx), "Envenenado · zona de 4 m por 3 rod.");
  assert.equal(skillSummary({ effectType: "structure", structureId: "wall", cost: 15 }, ctx), "ergue Muralha · 15 Mana", "Estrutura não tem alvo");
  assert.equal(skillSummary({ effectType: "none", variableMana: true, cost: 10 }, ctx), "Mana variável (base 10)");
  assert.equal(skillSummary({ effectType: "none", subSkills: [{}, {}] }, ctx), "2 Sub-Skills");
  assert.equal(skillSummary({ effectType: "none", resistanceTarget: "fire" }, { ...ctx, resistance: "Resistência Fogo 30%" }), "Resistência Fogo 30%");
  assert.equal(skillSummary({ effectType: "none" }, ctx), "", "Descritiva e de graça: sem frase");
});

test("Skill numa frase: efeito em % do máximo", () => {
  assert.equal(skillSummary({ effectType: "temporary", targetType: "self", effects: [{ target: "heal", amount: 25, amountMode: "percentMax" }] }, { targets: { heal: "Curar Vida (na hora)" } }), "Curar Vida (na hora) +25% do máx. · em si");
});

/* ------------------------------------------------------------------ Desfazer uso de Skill (L12) */

test("Desfazer uso: diffFields só lista o que mudou", () => {
  assert.deepEqual(diffFields({ a: 1, b: true, c: [1] }, { a: 3, b: true, c: [2] }), { a: [1, 3], c: [[1], [2]] });
  assert.deepEqual(diffFields({}, { x: 5 }), { x: [null, 5] });
});

test("Desfazer uso: números voltam pela diferença, o resto pelo valor de antes", () => {
  // Mana 100 → 80 no uso; depois uma reação gastou mais 10 (70). Desfazer devolve só os 20.
  assert.deepEqual(revertFields({ mana: 70 }, { mana: [100, 80] }), { mana: 90 });
  // Nunca abaixo de 0.
  assert.deepEqual(revertFields({ hp: 5 }, { hp: [10, 40] }), { hp: 0 });
  // Ligada/desligada e listas voltam ao valor de antes.
  assert.deepEqual(revertFields({ active: true }, { active: [false, true], subs: [[false], [true]] }), { active: false, subs: [false] });
  // Fração (integridade de parte) não arredonda.
  assert.equal(revertFields({ i: 0.75 }, { i: [0.5, 0.75] }).i, 0.5);
});

test("Desfazer uso: pools de Escudo", () => {
  const p = (skillId, value) => ({ holderUuid: "A", skillId, subSkillIndex: null, value });
  // Pool criado pelo uso some; pool que o uso não tocou fica.
  assert.deepEqual(revertPools([p("old", 5), p("new", 30)], [p("old", 5)], [p("old", 5), p("new", 30)]), [p("old", 5)]);
  // Pool que já tinha apanhado parte (30 → 12) depois do uso: perde o que o uso deu e some.
  assert.deepEqual(revertPools([p("new", 12)], [], [p("new", 30)]), []);
  // Pool que o uso aumentou (Escudo mantido 10 → 25) volta a 10.
  assert.deepEqual(revertPools([p("s", 25)], [p("s", 10)], [p("s", 25)]), [p("s", 10)]);
  // Pool que a Antimagia apagou volta.
  assert.deepEqual(revertPools([], [p("x", 20)], []), [p("x", 20)]);
});

test("Desfazer uso: diffEffects separa criados, mudados e apagados", () => {
  const before = [{ _id: "a", name: "Lentidão", duration: { rounds: 2 }, _stats: { modifiedTime: 1 } }, { _id: "b", name: "Bênção" }];
  const after = [{ _id: "a", name: "Lentidão", duration: { rounds: 5 }, _stats: { modifiedTime: 2 } }, { _id: "c", name: "Queimadura" }];
  const d = diffEffects(before, after);
  assert.deepEqual(d.created, [{ id: "c", name: "Queimadura" }]);
  assert.deepEqual(d.deleted, [{ _id: "b", name: "Bênção" }]);
  assert.deepEqual(d.changed, [{ _id: "a", name: "Lentidão", duration: { rounds: 2 } }]);
  // Só a data de modificação mudou: não conta.
  assert.equal(diffEffects([{ _id: "a", _stats: { t: 1 } }], [{ _id: "a", _stats: { t: 2 } }]).changed.length, 0);
  assert.equal(actorEntryHasChanges({ vitals: {}, effects: d, items: [], flags: {} }), true);
  assert.equal(actorEntryHasChanges({ vitals: {}, effects: { created: [], deleted: [], changed: [] }, items: [], flags: {} }), false);
});

test("Desfazer uso: prazo do botão", () => {
  const rec = { combat: { id: "c1", round: 2, turn: 1 } };
  assert.equal(undoWindowOpen(rec, { combat: { id: "c1", round: 2, turn: 1 } }), true);
  assert.equal(undoWindowOpen(rec, { combat: { id: "c1", round: 2, turn: 2 } }), false);
  assert.equal(undoWindowOpen(rec, { combat: { id: "c1", round: 3, turn: 1 } }), false);
  assert.equal(undoWindowOpen(rec, { combat: null }), false); // combate encerrado
  assert.equal(undoWindowOpen({ combat: null }, { newerUse: false }), true);
  assert.equal(undoWindowOpen({ combat: null }, { newerUse: true }), false);
  assert.equal(undoWindowOpen({ combat: null, undone: true }, {}), false);
});

test("Desfazer uso: linhas da confirmação (Bola de Fogo do mockup)", () => {
  const record = {
    actors: [
      { name: "Kira", isSource: true, energyLabel: "Mana", vitals: { "system.attributes.energy.value": [100, 80] }, effects: {}, items: [{ name: "Bola de Fogo", changes: { "system.xp": [10, 16] } }] },
      { name: "Goblin 2", vitals: {}, effects: { created: [{ id: "x", name: "Lentidão" }] }, items: [] }
    ]
  };
  const rows = undoPreviewRows(record, { damage: [{ name: "Goblin 1", applied: { toHp: 34, toShield: 0 } }, { name: "Goblin 2", applied: null }] });
  assert.deepEqual(rows.map(r => `${r.tag} ${r.text}`), [
    "+20 Mana de volta para Kira",
    "+34 Vida de volta para Goblin 1 (dano já aplicado)",
    "— Goblin 2: dano ainda não aplicado, nada a voltar",
    "sai Lentidão em Goblin 2",
    "−6 XP XP de uso de Bola de Fogo"
  ]);
  // Skill Ativa que ligou desliga; cura desfeita sai.
  const active = undoPreviewRows({ actors: [{ name: "Kira", isSource: true, vitals: { "system.attributes.hp.value": [50, 70] }, items: [{ name: "Aura", changes: { "system.active": [false, true] } }] }], placed: { zone: true } }, { skillLabel: "Aura" });
  assert.deepEqual(active.map(r => `${r.tag} ${r.text}`), ["−20 Vida que Kira ganhou sai", "desliga Aura (Skill Ativa)", "some Zona criada por Aura"]);
});

test("Desfazer uso: o registro guarda pares (o flag não expande \"system.xp\")", () => {
  const pairs = fieldPairs({ "system.xp": [10, 16] });
  assert.deepEqual(pairs, [["system.xp", [10, 16]]]);
  assert.deepEqual(asFields(pairs), { "system.xp": [10, 16] });
  assert.deepEqual(revertFields({ "system.xp": 16 }, pairs), { "system.xp": 10 });
  const rows = undoPreviewRows({ actors: [{ name: "Kira", vitals: [["system.attributes.energy.value", [100, 80]]], items: [{ name: "Bola", changes: pairs }], flags: [] }] });
  assert.deepEqual(rows.map(r => r.tag), ["+20", "−6 XP"]);
  // XP de um alvo (Resistência que ele ganhou apanhando) não é "de uso".
  assert.equal(undoPreviewRows({ actors: [{ name: "Goblin", items: [{ name: "Resistência", changes: [["system.xp", [0, 3]]] }] }] })[0].text, "XP de Resistência (Goblin)");
  assert.equal(actorEntryHasChanges({ vitals: [], effects: {}, items: [], flags: [] }), false);
});

/* ------------------------------------------------------------------ "Avançado ▸" dobrado (K1) */

test("Avançado: lista os nomes, diz o que está em uso e abre sozinho", () => {
  const closed = advancedFold([{ label: "Dano Absoluto", used: false }, { label: "Escala", used: false }]);
  assert.deepEqual(closed, { show: true, labels: "Dano Absoluto · Escala", used: "", open: false });
  const used = advancedFold([{ label: "Dano Absoluto", used: true }, null, { label: "Escala" }]);
  assert.equal(used.labels, "Dano Absoluto · Escala");
  assert.equal(used.used, "Dano Absoluto");
  assert.equal(used.open, true);
  // Fechado à mão: continua fechado e o "em uso" continua na linha.
  assert.equal(advancedFold([{ label: "Luz", used: true }], false).open, false);
  assert.equal(advancedFold([{ label: "Luz", used: false }], true).open, true);
  // Nada a esconder: a linha some.
  assert.equal(advancedFold([null, undefined]).show, false);
});

import { skillStateUpdate } from "../module/skills/skill-state.js";
test("Sub-Skill: ligar regrava a lista inteira (a V14 trocava o array por um com só aquele campo)", () => {
  const skill = { _source: { system: { subSkills: [{ name: "A", active: false }, { name: "B", active: false }] } } };
  const update = skillStateUpdate(skill, 1, { active: true, investRatio: 2 });
  assert.deepEqual(update, { "system.subSkills": [{ name: "A", active: false }, { name: "B", active: true, investRatio: 2 }] });
  // Não mexe no original.
  assert.equal(skill._source.system.subSkills[1].active, false);
  assert.deepEqual(skillStateUpdate(skill, null, { active: true }), { "system.active": true });
  assert.deepEqual(skillStateUpdate(skill, 5, { active: true }), {});
});

test("XP por uso: alvo sem Vida máxima (Nave sem Módulos) não enche a XP", async () => {
  const { measureFraction } = await import("../module/skills/skill-xp-rules.js");
  assert.equal(measureFraction({ value: 50, base: 0 }), 0);
  assert.equal(measureFraction({ value: 50, base: 100 }), 0.5);
});

test("Efeito em alvo alheio: o pedido ao Mestre é limpo e limitado", async () => {
  const { normalizeEffectRequest, MAX_RELAYED_TARGETS } = await import("../module/skills/effect-relay-rules.js");
  assert.equal(normalizeEffectRequest({}), null);
  assert.equal(normalizeEffectRequest({ sourceUuid: "Actor.a.Item.b", targetUuids: [] }), null);
  const many = Array.from({ length: 80 }, (_, i) => `Actor.t${i}`);
  const clean = normalizeEffectRequest({
    sourceUuid: "Actor.a.Item.b",
    targetUuids: ["Actor.x", "Actor.x", 5, "", ...many],
    subSkillIndex: -1,
    investPower: 1e9,
    focusPartId: { evil: true },
    healBlockPartId: "parte1",
    mech: { effects: [{ amount: 99999 }] }
  });
  assert.equal(clean.targetUuids.length, MAX_RELAYED_TARGETS);
  assert.equal(clean.targetUuids[0], "Actor.x");
  assert.equal(clean.subSkillIndex, null);
  assert.equal(clean.investPower, 1000);
  assert.equal(clean.focusPartId, "");
  assert.equal(clean.healBlockPartId, "parte1");
  // A mecânica nunca vem do cliente.
  assert.equal("mech" in clean, false);
  assert.equal(normalizeEffectRequest({ sourceUuid: "s", targetUuids: ["t"], subSkillIndex: 2, investPower: "abc" }).investPower, 1);
  assert.equal(normalizeEffectRequest({ sourceUuid: "s", targetUuids: ["t"], subSkillIndex: 2 }).subSkillIndex, 2);
});

test("Efeito em alvo alheio: escolhas da hora de usar e separação por permissão", async () => {
  const { applyEffectChoices, splitByWriteAccess } = await import("../module/skills/effect-relay-rules.js");
  const effects = [{ target: "heal", amount: 10 }, { target: "strength", amount: 2, conditionId: "ferida" }, { target: "speed", amount: 1 }];
  const tests = { isHeal: e => e.target === "heal", blocksPart: e => e.conditionId === "ferida" };
  const out = applyEffectChoices(effects, { focusPartId: "braco", healBlockPartId: "perna" }, tests);
  assert.equal(out[0].focusPartId, "braco");
  assert.equal(out[1].healBlockPartId, "perna");
  assert.equal(out[2], effects[2]);
  assert.equal("focusPartId" in effects[0], false);
  assert.deepEqual(applyEffectChoices(effects, {}, tests), effects);

  const { local, remote } = splitByWriteAccess([{ n: "eu", own: true }, { n: "npc", own: false }, { n: "aliado", own: true }], t => t.own);
  assert.deepEqual(local.map(t => t.n), ["eu", "aliado"]);
  assert.deepEqual(remote.map(t => t.n), ["npc"]);
});
