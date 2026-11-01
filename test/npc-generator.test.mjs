/**
 * Gerador de NPC e Níveis de NPC (M6): divisão de pontos, sorteios, nomes, Vida por nível e o
 * catálogo de arquétipos. Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  seededRng,
  attributeBudget,
  distributePoints,
  rollNpcLevel,
  skillLevelFor,
  pickSkills,
  pickItems,
  pickSpecies,
  randomName,
  nameCulture,
  npcTierHp,
  tierExtraSkills,
  rescaleHpValue,
  normalizeArchetype,
  archetypeStatus,
  missingDefaultArchetypes,
  keepKnownIds
} from "../module/npc/npc-generator-rules.js";
import { MEU_SISTEMA } from "../module/core/config.js";

const KEYS = ["strength", "defense", "magic", "magicalDefense", "dexterity", "stealth", "perception", "precision"];

test("Pontos do NPC: os mesmos de um PJ do nível, vezes o % do arquétipo", () => {
  assert.equal(attributeBudget(1, { starting: 35, perLevel: 5 }), 35);
  assert.equal(attributeBudget(4, { starting: 35, perLevel: 5 }), 50);
  assert.equal(attributeBudget(4, { starting: 35, perLevel: 5 }, 50), 25);
  assert.equal(attributeBudget(0, { starting: 35, perLevel: 5 }), 35);
});

test("Divisão de pontos: soma exata, peso alto recebe mais, repetível com a mesma semente", () => {
  const weights = { strength: 0, defense: 1, magic: 0, magicalDefense: 0, dexterity: 3, stealth: 3, perception: 2, precision: 2 };
  for (let seed = 1; seed < 40; seed++) {
    const points = distributePoints(50, weights, KEYS, { rng: seededRng(seed) });
    assert.equal(Object.values(points).reduce((a, b) => a + b, 0), 50);
    assert.ok(points.dexterity > points.strength, `semente ${seed}: Destreza ${points.dexterity} ≤ Força ${points.strength}`);
    assert.ok(Object.values(points).every(v => v >= 0));
  }
  assert.deepEqual(distributePoints(50, weights, KEYS, { rng: seededRng(7) }), distributePoints(50, weights, KEYS, { rng: seededRng(7) }));
  // Sem sorte nenhuma o peso manda: "Muito" fica perto de 4× "Pouco".
  const flat = distributePoints(100, { strength: 0, dexterity: 3 }, ["strength", "dexterity"], { rng: () => 0.5 });
  assert.deepEqual(flat, { strength: 20, dexterity: 80 });
  assert.deepEqual(distributePoints(0, weights, KEYS), Object.fromEntries(KEYS.map(k => [k, 0])));
});

test("Nível do NPC e nível das Skills", () => {
  assert.equal(rollNpcLevel(4, false), 4);
  assert.equal(rollNpcLevel(4, true, () => 0), 3);
  assert.equal(rollNpcLevel(4, true, () => 0.99), 5);
  assert.equal(rollNpcLevel(1, true, () => 0), 1);
  assert.equal(skillLevelFor(4, "follow"), 2);
  assert.equal(skillLevelFor(1, "follow"), 1);
  assert.equal(skillLevelFor(10, "one"), 1);
});

test("Skills sorteadas: as 'sempre' entram, o resto até o número pedido, nunca repete", () => {
  const skills = [{ key: "a", always: true }, { key: "b" }, { key: "c" }, { key: "d" }];
  for (let seed = 1; seed < 30; seed++) {
    const picked = pickSkills(skills, { min: 2, max: 3 }, seededRng(seed));
    assert.ok(picked.some(s => s.key === "a"));
    assert.ok(picked.length >= 2 && picked.length <= 3);
    assert.equal(new Set(picked.map(s => s.key)).size, picked.length);
  }
  // Elite/Chefe: Skills a mais, sem passar do que a lista tem.
  assert.equal(pickSkills(skills, { min: 3, max: 3, extra: 2 }).length, 4);
  assert.deepEqual(pickSkills([], { min: 2, max: 3 }), []);
});

test("Equipamento com chance e Espécie entre as aceitas", () => {
  const items = [{ key: "a", chance: 100 }, { key: "b", chance: 0 }, { key: "c", chance: 50 }];
  assert.deepEqual(pickItems(items, () => 0.4).map(i => i.key), ["a", "c"]);
  assert.deepEqual(pickItems(items, () => 0.6).map(i => i.key), ["a"]);
  assert.equal(pickSpecies(["elfo", "dragao"], ["humano", "elfo"], () => 0), "elfo");
  // Nenhuma aceita existe (ou lista vazia): qualquer disponível.
  assert.equal(pickSpecies(["dragao"], ["humano", "elfo"], () => 0.9), "elfo");
  assert.equal(pickSpecies([], [], () => 0), "");
});

test("Nomes: cultura pelo arquétipo/Espécie e às vezes só o primeiro nome", () => {
  const table = { first: ["Mira"], last: ["Vesk"] };
  assert.equal(randomName(table, () => 0.5), "Mira Vesk");
  assert.equal(randomName(table, () => 0.1), "Mira");
  assert.equal(nameCulture("scifi", "fantasia"), "scifi");
  assert.equal(nameCulture("comum", "scifi"), "scifi");
  assert.equal(nameCulture("comum", "fantasia"), "fantasia");
});

test("Nível de NPC: Lacaio Vida 1, Elite/Chefe multiplicam, troca mantém a fração", () => {
  assert.equal(npcTierHp(200, "minion"), 1);
  assert.equal(npcTierHp(200, "normal"), 200);
  assert.equal(npcTierHp(200, "elite", { elite: 2 }), 400);
  assert.equal(npcTierHp(200, "boss", { boss: 4 }), 800);
  assert.equal(tierExtraSkills("elite", { elite: 1, boss: 2 }), 1);
  assert.equal(tierExtraSkills("boss", { elite: 1, boss: 2 }), 2);
  assert.equal(tierExtraSkills("minion"), 0);
  assert.equal(rescaleHpValue(100, 200, 400), 200);
  assert.equal(rescaleHpValue(200, 200, 1), 1);
  assert.equal(rescaleHpValue(1, 1, 200), 200);
  assert.equal(rescaleHpValue(0, 200, 400), 0);
  // Ferido de leve não vira 0 ao encolher.
  assert.equal(rescaleHpValue(1, 400, 1), 1);
});

test("Catálogo de arquétipos: normaliza, sabe o que é padrão/editado/do Mestre e o que falta", () => {
  const a = normalizeArchetype({ label: "Ladrão de Rua", weights: { dexterity: 9 }, skillsMin: 3, skillsMax: 1, skills: [{ name: "Golpe" }, { name: "Golpe" }], items: [{ name: "Adaga", chance: 150 }] }, KEYS);
  assert.equal(a.id, "ladrao_de_rua");
  assert.equal(a.weights.dexterity, 3);
  assert.equal(a.weights.strength, 1);
  assert.equal(a.skillsMax, 3);
  assert.deepEqual(a.skills.map(s => s.key), ["golpe", "golpe_2"]);
  assert.equal(a.items[0].chance, 100);

  const defaults = MEU_SISTEMA.DEFAULT_NPC_ARCHETYPES.map(e => normalizeArchetype(e, KEYS));
  assert.ok(defaults.length >= 12);
  assert.equal(archetypeStatus(defaults[0], defaults), "default");
  assert.equal(archetypeStatus({ ...defaults[0], pointsPercent: 10 }, defaults), "edited");
  assert.equal(archetypeStatus(a, defaults), "custom");
  assert.deepEqual(missingDefaultArchetypes(defaults.slice(2), defaults).map(e => e.id), defaults.slice(0, 2).map(e => e.id));
  assert.deepEqual(keepKnownIds(["fire", "phaser"], ["fire"]), ["fire"]);
});

test("Arquétipos de fábrica: Civil sem Skill, todos com ids únicos e Skills com mecânica válida", () => {
  const defaults = MEU_SISTEMA.DEFAULT_NPC_ARCHETYPES;
  assert.equal(new Set(defaults.map(e => e.id)).size, defaults.length);
  const civil = defaults.find(e => e.id === "civil");
  assert.equal(civil.skills.length, 0);
  assert.equal(civil.pointsPercent, 50);
  for (const e of defaults) {
    for (const s of e.skills) {
      assert.ok(MEU_SISTEMA.SKILL_EFFECT_TYPES.includes(s.effectType), `${e.id}/${s.name}: effectType`);
      assert.ok(MEU_SISTEMA.SKILL_TARGET_TYPES.includes(s.targetType), `${e.id}/${s.name}: targetType`);
      for (const eff of s.effects ?? []) assert.ok(MEU_SISTEMA.EFFECT_TARGETS.includes(eff.target), `${e.id}/${s.name}: alvo ${eff.target}`);
    }
    assert.ok(e.skillsMax <= e.skills.length, `${e.id}: sorteia mais Skills do que tem`);
  }
});
