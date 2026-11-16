/**
 * Tipos de arma, Maestria e ataque desarmado (H6): regras puras.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_WEAPON_TYPES } from "../module/core/config/defaults/weapons.js";
import {
  weaponTypeChain,
  weaponTypeTop,
  isWeaponSubtype,
  resolveWeaponType,
  weaponTypeLabel,
  weaponTypeOptions,
  weaponTypeCatalogIssues,
  masteryCovers,
  masteryEffectiveLevel,
  masteryPercent,
  bestMastery,
  masteryFactor,
  formatMasteryPercent,
  masteryTraceRow,
  masterySentence,
  masteryLevelUpBlock,
  evolvedMasteryRank,
  masteryEarnsXp,
  masteryXpFromConfig,
  practiceKey,
  bumpPractice,
  resolveUnarmedFormula,
  buildUnarmedWeapon,
  resolveUnarmedElement,
  attackRollFlat,
  attackRollFlavor,
  masteryPushMeters,
  resolveWeaponStrike,
  strikeSentence,
  damageMeasures
} from "../module/combat/weapon-mastery-rules.js";
import { skillUseXp } from "../module/skills/skill-xp-rules.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";

const T = DEFAULT_WEAPON_TYPES;
const SIMPLE = { detailed: false };
const DETAILED = { detailed: true };

test("catálogo: cadeia, grupo de cima e subtipo", () => {
  assert.deepEqual(weaponTypeChain("swords", T).map(t => t.id), ["swords", "blades"]);
  assert.equal(weaponTypeTop("swords", T), "blades");
  assert.equal(weaponTypeTop("blades", T), "blades");
  assert.equal(weaponTypeTop("nao-existe", T), "nao-existe");
  assert.equal(isWeaponSubtype("swords", T), true);
  assert.equal(isWeaponSubtype("blades", T), false);
});

test("lista simples x detalhada: resolução e rótulo", () => {
  assert.equal(resolveWeaponType("swords", T, false), "blades");
  assert.equal(resolveWeaponType("swords", T, true), "swords");
  assert.equal(resolveWeaponType("", T, true), "");
  assert.equal(weaponTypeLabel("swords", T, { detailed: true }), "Lâminas › Espadas");
  assert.equal(weaponTypeLabel("swords", T, { detailed: false }), "Lâminas");
  assert.equal(weaponTypeLabel("zzz", T), "zzz");
});

test("opções do select: simples só grupos; detalhada com caminho; subtipo salvo continua com o valor exato", () => {
  const simple = weaponTypeOptions(T, { detailed: false });
  assert.equal(simple.length, 8);
  assert.ok(simple.every(o => !o.label.includes("›")));
  const detailed = weaponTypeOptions(T, { detailed: true });
  assert.ok(detailed.some(o => o.value === "swords" && o.label === "Lâminas › Espadas"));
  assert.equal(detailed[0].value, "blades");
  const kept = weaponTypeOptions(T, { detailed: false, current: "swords" });
  assert.ok(kept.some(o => o.value === "swords" && o.label === "Lâminas (Espadas)"));
  assert.ok(weaponTypeOptions(T, { current: "fantasma" }).some(o => o.value === "fantasma" && o.label.includes("fora do catálogo")));
});

test("catálogo: pai desconhecido, de si mesmo e ciclo", () => {
  assert.deepEqual(weaponTypeCatalogIssues(T), []);
  const bad = [
    { id: "a", label: "A", parent: "a" },
    { id: "b", label: "B", parent: "zz" },
    { id: "c", label: "C", parent: "d" },
    { id: "d", label: "D", parent: "c" }
  ];
  const kinds = Object.fromEntries(weaponTypeCatalogIssues(bad).map(i => [i.id, i.kind]));
  assert.deepEqual(kinds, { a: "selfParent", b: "unknownParent", c: "cycle", d: "cycle" });
});

test("cobertura: grupo cobre subtipos; subtipo só a si; simples iguala ao grupo", () => {
  assert.equal(masteryCovers("blades", "swords", T, true), true);
  assert.equal(masteryCovers("swords", "blades", T, true), false);
  assert.equal(masteryCovers("swords", "daggers", T, true), false);
  assert.equal(masteryCovers("swords", "swords", T, true), true);
  assert.equal(masteryCovers("swords", "daggers", T, false), true);
  assert.equal(masteryCovers("blades", "firearms", T, false), false);
  assert.equal(masteryCovers("", "swords", T, true), false);
});

test("bônus: 5%/nível no grupo, teto no nível 10", () => {
  const cfg = { ...DETAILED };
  assert.equal(masteryPercent({ type: "blades", level: 3, rank: 1 }, "swords", T, cfg), 15);
  assert.equal(masteryPercent({ type: "blades", level: 10, rank: 1 }, "blades", T, cfg), 50);
  assert.equal(masteryPercent({ type: "blades", level: 25, rank: 1 }, "blades", T, cfg), 50);
  assert.equal(masteryPercent({ type: "blades", level: 4, rank: 1 }, "firearms", T, cfg), 0);
});

test("bônus: subtipo rende 7,5%/nível (detalhada); na simples vale a taxa do grupo", () => {
  assert.equal(masteryPercent({ type: "swords", level: 2, rank: 1 }, "swords", T, DETAILED), 15);
  assert.equal(masteryPercent({ type: "swords", level: 10, rank: 1 }, "swords", T, DETAILED), 75);
  assert.equal(masteryPercent({ type: "swords", level: 2, rank: 1 }, "daggers", T, SIMPLE), 10);
});

test("bônus: evoluída é fixa (100%), 150% no subtipo, sem níveis", () => {
  assert.equal(masteryPercent({ type: "blades", level: 1, rank: 2 }, "blades", T, DETAILED), 100);
  assert.equal(masteryPercent({ type: "swords", level: 1, rank: 2 }, "swords", T, DETAILED), 150);
  assert.equal(masteryPercent({ type: "swords", level: 1, rank: 2 }, "swords", T, SIMPLE), 100);
  assert.equal(masteryEffectiveLevel({ level: 1, rank: 2 }, {}), 10);
});

test("a melhor Maestria conta, sem somar", () => {
  const list = [
    { type: "blades", level: 4, rank: 1, ref: "grupo" },
    { type: "swords", level: 4, rank: 1, ref: "sub" }
  ];
  const best = bestMastery(list, "swords", T, DETAILED);
  assert.equal(best.mastery.ref, "sub");
  assert.equal(best.percent, 30);
  assert.equal(best.level, 4);
  assert.equal(bestMastery(list, "firearms", T, DETAILED), null);
  assert.equal(bestMastery([], "swords", T, DETAILED), null);
});

test("fator, formatação, rastro e frase", () => {
  assert.equal(masteryFactor(15), 1.15);
  assert.equal(formatMasteryPercent(7.5), "7,5");
  assert.equal(formatMasteryPercent(15), "15");
  assert.deepEqual(masteryTraceRow("Lâminas", 15), { label: "Maestria Lâminas", value: "+15%" });
  assert.equal(masterySentence({ typeLabel: "Lâminas", level: 3, rank: 1, type: "blades" }, T, DETAILED), "Maestria: Lâminas · +15% de dano");
  assert.equal(masterySentence({ typeLabel: "Espadas", level: 1, rank: 2, type: "swords" }, T, DETAILED), "Maestria evoluída: Espadas · +150% de dano");
});

test("subir de nível: para no teto e a evoluída não tem níveis; Evolução sobe o rank", () => {
  assert.equal(masteryLevelUpBlock({ rank: 1, level: 5 }, {}), null);
  assert.match(masteryLevelUpBlock({ rank: 1, level: 10 }, {}), /Evolução/);
  assert.match(masteryLevelUpBlock({ rank: 2, level: 1 }, {}), /Evolução/);
  assert.equal(evolvedMasteryRank(1), 2);
  assert.equal(evolvedMasteryRank(2), 3);
});

test("XP da Maestria: 1/4 do XP de uso, e nada no teto nem na evoluída", () => {
  const measures = [{ value: 20, base: 100 }];
  const cfg = { factor: 100, flatPercent: 10 };
  assert.equal(skillUseXp(measures, cfg), 20);
  assert.equal(skillUseXp(measures, masteryXpFromConfig(cfg, 25)), 5);
  assert.equal(skillUseXp([{ value: 100, base: 100 }], masteryXpFromConfig(cfg, 25)), 25);
  assert.equal(masteryEarnsXp({ level: 3, rank: 1 }, {}), true);
  assert.equal(masteryEarnsXp({ level: 10, rank: 1 }, {}), false);
  assert.equal(masteryEarnsXp({ level: 1, rank: 2 }, {}), false);
});

test("aprender pela prática: conta por grupo (simples) ou tipo exato, sugere uma vez no limiar", () => {
  assert.equal(practiceKey("swords", T, false), "blades");
  assert.equal(practiceKey("swords", T, true), "swords");
  let state = {};
  let suggested = 0;
  for (let i = 0; i < 6; i++) {
    const step = bumpPractice(state, "blades", 3);
    state = step.state;
    if (step.suggest) suggested++;
  }
  assert.equal(suggested, 1);
  assert.equal(state.counts.blades, 6);
  assert.equal(state.suggested.blades, true);
  assert.equal(bumpPractice({}, "blades", 0).suggest, false);
  assert.equal(bumpPractice({}, "", 3).count, 0);
});

test("desarmado: fórmula do mundo com reserva, e elemento com reservas", () => {
  assert.equal(resolveUnarmedFormula("1d6", () => true), "1d6");
  assert.equal(resolveUnarmedFormula("lixo", () => false), "1d4");
  assert.equal(resolveUnarmedFormula("", () => true), "1d4");
  assert.equal(resolveUnarmedFormula("x", () => { throw new Error("x"); }), "1d4");
  const exists = ids => id => ids.includes(id);
  assert.equal(resolveUnarmedElement("blunt", exists(["blunt", "physical"])), "blunt");
  assert.equal(resolveUnarmedElement("blunt", exists(["physical"])), "physical");
  assert.equal(resolveUnarmedElement("blunt", exists([])), "");
});

test("desarmado: arma sintética simples, com item que reforça e com efeito de Skill", () => {
  const base = { formula: "1d4", attribute: "strength", element: "blunt" };
  const plain = buildUnarmedWeapon(base);
  assert.equal(plain.damageFormula, "1d4");
  assert.deepEqual(plain.damageElements, ["blunt"]);
  assert.equal(plain.weaponType, "unarmed");
  assert.equal(plain.range, 0);
  assert.equal(plain.isMagicDamage, false);

  const knuckle = { name: "Soco-inglês", formula: "1d4", elements: ["slash"], weaponType: "blades" };
  const glove = { name: "Luva", formula: "2", elements: [], weaponType: "" , magic: true };
  const one = buildUnarmedWeapon(base, [knuckle]);
  assert.equal(one.damageFormula, "1d4 + 1d4");
  assert.deepEqual(one.damageElements, ["slash"]);
  assert.equal(one.weaponType, "blades");

  // Vários itens: fórmulas somam; o último com elemento/tipo vence; mágico de qualquer um vale.
  const two = buildUnarmedWeapon(base, [knuckle, glove]);
  assert.equal(two.damageFormula, "1d4 + 1d4 + 2");
  assert.deepEqual(two.damageElements, ["slash"]);
  assert.equal(two.weaponType, "blades");
  assert.equal(two.isMagicDamage, true);
  const lastWins = buildUnarmedWeapon(base, [knuckle, { name: "Garra", formula: "1d6", elements: ["fire"], weaponType: "natural" }]);
  assert.deepEqual(lastWins.damageElements, ["fire"]);
  assert.equal(lastWins.weaponType, "natural");

  // Efeito de Skill ("conjurado") vence o item.
  assert.equal(buildUnarmedWeapon(base, [knuckle], "firearms").weaponType, "firearms");
  assert.deepEqual(two.augmentedBy, ["Soco-inglês", "Luva"]);
});

test("🎲 de ataque e gravidade", () => {
  assert.equal(attackRollFlat({ itemBonus: 2, masteryLevel: 4 }), 6);
  assert.equal(attackRollFlat({}), 0);
  assert.equal(attackRollFlavor("Espada", 4), "Ataque com Espada (Maestria +4)");
  assert.equal(attackRollFlavor("Espada", 0), "Ataque com Espada");
  assert.equal(masteryPushMeters(4, 50), 6);
  assert.equal(masteryPushMeters(4, 0), 4);
});

test("golpe de arma: a Sub-Skill vazia herda da mãe; a própria vence", () => {
  assert.equal(resolveWeaponStrike("", "unarmed"), "unarmed");
  assert.equal(resolveWeaponStrike("blades", "unarmed"), "blades");
  assert.equal(resolveWeaponStrike("", ""), "");
  assert.equal(resolveWeaponStrike(undefined, undefined), "");
});

test("golpe de arma: frase, medidas de XP e Maestria que cobre o tipo resolvido", () => {
  assert.equal(strikeSentence("unarmed", "Desarmado"), "golpe desarmado");
  assert.equal(strikeSentence("blades", "Lâminas"), "golpe de Lâminas");
  assert.equal(strikeSentence("", "x"), "");
  const dmg = { effectType: "damage", damageFormula: "2d6", weaponStrike: "unarmed" };
  assert.match(skillSummary(dmg, { strikesOn: true, weaponTypes: { unarmed: "Desarmado" } }), /golpe desarmado/);
  assert.doesNotMatch(skillSummary(dmg, { strikesOn: false, weaponTypes: {} }), /golpe/);
  // Medidas: alvo único e área.
  assert.deepEqual(damageMeasures({ finalDamage: 10 }, { id: 1 }, () => 100), [{ value: 10, base: 100 }]);
  assert.deepEqual(damageMeasures({ hits: [{ actor: 1, damage: 5 }, { actor: 2, damage: 0 }] }, null, () => 50), [{ value: 5, base: 50 }]);
  assert.deepEqual(damageMeasures({ finalDamage: 0 }, { id: 1 }, () => 100), []);
  // A Maestria de Desarmado cobre o golpe desarmado de uma Skill (tipo resolvido da mãe).
  const strike = resolveWeaponStrike("", "unarmed");
  assert.equal(masteryPercent({ type: "unarmed", level: 4, rank: 1 }, strike, T, DETAILED), 20);
  assert.equal(masteryPercent({ type: "fists", level: 4, rank: 1 }, "unarmed", T, DETAILED), 0);
});

test("aviso: Golpe de arma numa Skill que não é de dano; Maestria com mecânica", () => {
  const warn = (mech, ctx) => lintSkill(mech, ctx).map(w => w.code);
  assert.ok(warn({ effectType: "none", weaponStrike: "unarmed" }).includes("strikeNotDamage"));
  assert.ok(!warn({ effectType: "damage", damageFormula: "1d6", weaponStrike: "unarmed" }).includes("strikeNotDamage"));
  assert.ok(warn({ effectType: "damage", damageFormula: "1d6", targetType: "targeted", weaponMastery: "blades" }).includes("masteryMechanic"));
  assert.ok(!warn({ effectType: "none", weaponMastery: "blades" }).includes("masteryMechanic"));
  assert.ok(warn({ effectType: "none", weaponMastery: "zzz" }, { weaponTypes: ["blades"] }).includes("unknownWeaponType"));
});

/* ------------------------------------------------------------------ Golpe de arma exige arma (16/11) */

import { resolveStrikeRequirement, strikeWeaponOk } from "../module/combat/weapon-mastery-rules.js";

test("golpe de arma: Sub-Skill herda tipo e exigência da Skill-mãe; desarmado nunca exige", () => {
  const parent = { weaponStrike: "blades", strikeRequiresWeapon: true };
  assert.deepEqual(resolveStrikeRequirement({ weaponStrike: "" }, parent), { type: "blades", requiresWeapon: true });
  assert.deepEqual(resolveStrikeRequirement({ weaponStrike: "", strikeRequiresWeapon: false }, parent), { type: "blades", requiresWeapon: true });
  assert.deepEqual(resolveStrikeRequirement({ weaponStrike: "swords", strikeRequiresWeapon: false }, parent), { type: "swords", requiresWeapon: false });
  assert.deepEqual(resolveStrikeRequirement({ weaponStrike: "unarmed" }, null), { type: "unarmed", requiresWeapon: false });
  assert.deepEqual(resolveStrikeRequirement({ weaponStrike: "" }, null), { type: "", requiresWeapon: false });
  // Campo ausente (Skill salva antes) = exige.
  assert.equal(resolveStrikeRequirement({ weaponStrike: "blades" }).requiresWeapon, true);
});

test("golpe de arma: arma compatível = o tipo ou um subtipo dele (detalhada); mesmo grupo (simples)", () => {
  const types = DEFAULT_WEAPON_TYPES;
  const swords = types.find(t => t.parent === "blades")?.id;
  const daggers = types.filter(t => t.parent === "blades")[1]?.id;
  assert.ok(swords && daggers);
  assert.equal(strikeWeaponOk("unarmed", [], types, true), true);
  assert.equal(strikeWeaponOk("blades", [], types, true), false);
  assert.equal(strikeWeaponOk("blades", [swords], types, true), true);
  assert.equal(strikeWeaponOk(swords, ["blades"], types, true), false);
  assert.equal(strikeWeaponOk(swords, [daggers], types, true), false);
  assert.equal(strikeWeaponOk(swords, [daggers], types, false), true);
  assert.equal(strikeWeaponOk("blades", ["firearms"], types, false), false);
});
