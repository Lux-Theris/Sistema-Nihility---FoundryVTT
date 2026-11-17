import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  namingCost, namingOutcome, namingXpTotal, soulShare, xpGainFromChange, cleanNamingName, namingBlockReason, namingXpDistribution, namingPreviewLine
} from "../module/species/naming-rules.js";
import { soulLinkIssues, validateActor, buildCatalogIndex } from "../module/world/world-validator.js";

const curve = level => 100 * level;

test("o custo é a soma dos atributos vezes o fator, arredondada", () => {
  assert.equal(namingCost([10, 20, 5], 1), 35);
  assert.equal(namingCost({ a: 10, b: 15 }, 1.5), 38);
  assert.equal(namingCost([10, -5], 1), 10);
  assert.equal(namingCost([], 3), 0);
});

test("sem Mana máxima suficiente a Nomeação falha", () => {
  assert.deepEqual(namingOutcome(100, 35), { ok: true, cost: 35, shortBy: 0 });
  assert.deepEqual(namingOutcome(35, 35), { ok: true, cost: 35, shortBy: 0 });
  assert.deepEqual(namingOutcome(30, 35), { ok: false, cost: 35, shortBy: 5 });
});

test("XP total e parte do XP que passa a quem nomeou", () => {
  assert.equal(namingXpTotal(35, 10), 350);
  assert.equal(soulShare(99, 10), 9);
  assert.equal(soulShare(5, 10), 0);
  assert.equal(soulShare(100, 0), 0);
});

test("só conta como ganho o XP que sobe no mesmo nível", () => {
  assert.equal(xpGainFromChange({ oldLevel: 3, newLevel: 3, oldXp: 10, newXp: 40 }), 30);
  assert.equal(xpGainFromChange({ oldLevel: 3, newLevel: 4, oldXp: 90, newXp: 0 }), 0);
  assert.equal(xpGainFromChange({ oldLevel: 3, newLevel: 3, oldXp: 40, newXp: 10 }), 0);
});

test("o nome novo é aparado e limitado", () => {
  assert.equal(cleanNamingName("  Kaito   Sombra "), "Kaito Sombra");
  assert.equal(cleanNamingName(null), "");
  assert.equal(cleanNamingName("x".repeat(200)).length, 80);
});

test("quem não pode ser nomeado", () => {
  assert.equal(namingBlockReason({ isCharacter: true }), null);
  assert.ok(namingBlockReason({ isCharacter: false }));
  assert.ok(namingBlockReason({ isCharacter: true, isFormTemplate: true }));
  assert.ok(namingBlockReason({ isCharacter: true, isFormActor: true }));
  assert.ok(namingBlockReason({ isCharacter: true, alreadyNamed: true }));
  assert.ok(namingBlockReason({ isCharacter: true, sameAsNamer: true }));
});

test("o XP se divide igual e sobe vários níveis de uma vez", () => {
  const { updates, leftover } = namingXpDistribution(
    [{ id: "a", level: 1, xp: 0 }, { id: "b", level: 1, xp: 0 }],
    1000,
    { xpForLevel: curve }
  );
  // 500 cada: 100 (nv1 para 2) + 200 (nv2 para 3) = 300, sobra 200 no nv 3.
  assert.equal(leftover, 0);
  assert.deepEqual(updates.map(u => [u.id, u.level, u.xp, u.levelsGained]), [["a", 3, 200, 2], ["b", 3, 200, 2]]);
});

test("o XP já guardado na Skill conta", () => {
  const { updates } = namingXpDistribution([{ id: "a", level: 1, xp: 90 }], 20, { xpForLevel: curve });
  assert.deepEqual(updates, [{ id: "a", level: 2, xp: 10, levelsGained: 1, absorbed: 20 }]);
});

test("Skill no teto devolve o que sobra, e as outras recebem", () => {
  const { updates, leftover } = namingXpDistribution(
    [{ id: "res", level: 4, xp: 0, cap: 5 }, { id: "n", level: 1, xp: 0 }],
    2000,
    { xpForLevel: curve }
  );
  // A Resistência recebe 1000, paga 400 (nv 4 para 5) e o resto volta (600); a normal fica com 1000 + 600.
  const res = updates.find(u => u.id === "res");
  assert.equal(res.level, 5);
  assert.equal(res.xp, 0);
  assert.equal(res.absorbed, 400);
  const normal = updates.find(u => u.id === "n");
  assert.equal(normal.absorbed, 1600);
  assert.equal(leftover, 0);
});

test("nada cabe em ninguém: o XP inteiro sobra (vai ao banco)", () => {
  const all = namingXpDistribution([{ id: "x", level: 5, cap: 5 }, { id: "y", level: 1, blocked: true }], 700, { xpForLevel: curve });
  assert.equal(all.leftover, 700);
  assert.deepEqual(all.updates, []);
  const none = namingXpDistribution([], 50, { xpForLevel: curve });
  assert.equal(none.leftover, 50);
});

test("o resto da divisão não se perde e a soma fecha", () => {
  const skills = [{ id: "a", level: 1 }, { id: "b", level: 1 }, { id: "c", level: 1 }];
  const { updates, leftover } = namingXpDistribution(skills, 10, { xpForLevel: curve });
  assert.equal(leftover, 0);
  assert.equal(updates.reduce((n, u) => n + u.absorbed, 0), 10);
});

test("a soma do XP usado mais o que sobra é sempre o total", () => {
  const skills = [{ id: "a", level: 4, cap: 5 }, { id: "b", level: 9, cap: 10 }, { id: "c", level: 1, blocked: true }];
  const { updates, leftover } = namingXpDistribution(skills, 5000, { xpForLevel: curve });
  const used = updates.reduce((n, u) => n + u.absorbed, 0);
  assert.equal(used + leftover, 5000);
  assert.ok(leftover > 0);
});

test("a linha da prévia", () => {
  assert.equal(namingPreviewLine("Fogo", { levelsGained: 2, level: 5, absorbed: 3 }, { level: 3 }), "Fogo: nv 3 → 5");
  assert.equal(namingPreviewLine("Fogo", { levelsGained: 0, level: 3, absorbed: 40 }, { level: 3 }), "Fogo: +40 XP");
});

test("Validar Mundo lista vínculos com ficha apagada", () => {
  const flags = {
    soulLink: { namerUuid: "Actor.gone" },
    soulLinks: [{ namedUuid: "Actor.ok" }, { namedUuid: "Actor.gone2" }],
    borrowLinks: [{ kind: "pact", sourceUuid: "Actor.gone3" }],
    lendLinks: [{ kind: "soul", borrowerUuid: "Actor.ok" }]
  };
  const issues = soulLinkIssues(flags, uuid => uuid.endsWith(".ok"));
  assert.equal(issues.length, 3);
  assert.deepEqual(soulLinkIssues(undefined), []);
  const idx = buildCatalogIndex({});
  const actor = { type: "character", system: { heritages: [{ id: "named" }] }, flags: { "nihility-rpg-system": flags }, items: [] };
  const found = validateActor(actor, idx, { uuidExists: () => false });
  assert.ok(found.some(i => i.catalog === "actors"));
  assert.ok(!found.some(i => i.catalog === "heritages"));
});

test("o De onde vem subtrai a Mana máxima perdida pela Nomeação depois do piso", async () => {
  const { explainVital } = await import("../module/combat/stat-explain.js");
  const base = explainVital({ pair: [{ label: "A", total: 10 }, { label: "B", total: 10 }], multiplier: 10, floor: 50 });
  assert.equal(base.max, 1000);
  const named = explainVital({ pair: [{ label: "A", total: 10 }, { label: "B", total: 10 }], multiplier: 10, floor: 50, named: 300 });
  assert.equal(named.max, 700);
  assert.equal(named.namedLoss, 300);
  assert.equal(explainVital({ pair: [{ total: 1 }, { total: 1 }], floor: 50, named: 500 }).max, 0);
});
