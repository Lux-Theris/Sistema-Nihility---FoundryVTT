/**
 * Dano: escudo pessoal, elementos, Imunidade, Escala, Condições padrão, condicionais, pools de Escudo, Antimagia, vantagens e hierarquia de elementos.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { MEU_SISTEMA, resolveActorTraits, isMagicUse, antimagicSurcharge } from "../module/core/config.js";
import { splitShieldDamage } from "../module/combat/damage-apply.js";
import {
  splitDamageParts,
  resolveDamageParts,
  scaleMultiplier,
  resolveConditionEffect,
  refreshReapplication,
  rollChance,
  sustainedShieldGain,
  consumeShieldPools,
  reconcileShieldPools,
  affinityMultiplier,
  cycleAffinityLevel,
  elementVsDefender,
  hitAffinityFactor,
  buildAffinityMatrix
} from "../module/combat/damage-rules.js";
import { matchesWhen, sumConditionalModifiers, perEachCount } from "../module/combat/conditional-modifiers.js";
import { validateCatalogs } from "../module/world/world-validator.js";
import { describeDamageParts } from "../module/combat/damage-rules.js";
import { clampAffinityLevel, affinityLevel } from "../module/combat/damage-rules.js";
import {
  elementAncestors,
  chainedResistance,
  inheritedElementEffects,
  buildAffinityMatrix as buildMatrixForHierarchy
} from "../module/combat/damage-rules.js";

/* -------------------------------------------- */
/*  Escudo pessoal absorve antes da Vida         */
/* -------------------------------------------- */

test("escudo pessoal: absorve até acabar, o resto vai pra Vida", () => {
  assert.deepEqual(splitShieldDamage(20, 10), { toShield: 10, toHp: 10 });
  assert.deepEqual(splitShieldDamage(5, 10), { toShield: 5, toHp: 0 });
  assert.deepEqual(splitShieldDamage(20, 0), { toShield: 0, toHp: 20 });
});

test("escudo pessoal: Dano Absoluto passa direto", () => {
  assert.deepEqual(splitShieldDamage(20, 10, { bypassShield: true }), { toShield: 0, toHp: 20 });
});

test("escudo pessoal: valores estranhos não quebram", () => {
  assert.deepEqual(splitShieldDamage(0, 10), { toShield: 0, toHp: 0 });
  assert.deepEqual(splitShieldDamage(10, -5), { toShield: 0, toHp: 10 });
  assert.deepEqual(splitShieldDamage(10.6, undefined), { toShield: 0, toHp: 11 });
});

/* -------------------------------------------- */
/*  Dano por elemento, Imunidade, Escala         */
/* -------------------------------------------- */

test("elementos: o golpe é dividido em partes iguais", () => {
  assert.deepEqual(splitDamageParts(100, ["fire", "ice"]), [{ elementId: "fire", raw: 50 }, { elementId: "ice", raw: 50 }]);
  assert.deepEqual(splitDamageParts(100, []), [{ elementId: null, raw: 100 }]);
  assert.deepEqual(splitDamageParts(90, ["fire", "fire", "ice", "acid"]).map(p => p.raw), [30, 30, 30]);
});

test("imunidade zera só a parte do próprio elemento", () => {
  const parts = splitDamageParts(100, ["fire", "ice"]);
  const result = resolveDamageParts({ parts, resistanceFor: id => (id === "fire" ? 1 : 0) });
  assert.equal(result.final, 50);
  assert.equal(result.parts[0].immune, true);
});

test("resistências valem por parte, não em cadeia sobre o golpe inteiro", () => {
  const parts = splitDamageParts(100, ["fire", "ice"]);
  const result = resolveDamageParts({ parts, resistanceFor: () => 0.5 });
  assert.equal(result.final, 50);
});

test("penetração amolece Defesa Mágica e Resistências, mas nunca atravessa Imunidade", () => {
  const soft = resolveDamageParts({ parts: [{ elementId: "fire", raw: 100, penetration: 0.5 }], general: 0.5, resistanceFor: () => 0 });
  assert.equal(soft.final, 75);
  const immune = resolveDamageParts({ parts: [{ elementId: "fire", raw: 100, penetration: 1 }], resistanceFor: () => 1 });
  assert.equal(immune.final, 0);
});

test("Dano Absoluto ignora Defesa Mágica, Resistências e Imunidade", () => {
  const result = resolveDamageParts({
    parts: [{ elementId: "fire", raw: 100 }],
    magicDefense: 0.6,
    general: 0.5,
    resistanceFor: () => 1,
    absolute: true
  });
  assert.equal(result.final, 100);
});

test("bônus contra Traço multiplica a parte antes das defesas", () => {
  const result = resolveDamageParts({ parts: [{ elementId: "polaron", raw: 100, bonus: 0.2 }], general: 0.5 });
  assert.equal(result.final, 60);
});

test("resistências registram quanto cada uma bloqueou (XP de Resistência)", () => {
  const result = resolveDamageParts({ parts: [{ elementId: "fire", raw: 100 }], general: 0.5, resistanceFor: () => 0.5 });
  assert.equal(result.parts[0].blockedGeneral, 50);
  assert.equal(result.parts[0].blockedElement, 25);
});

test("escala: fator elevado à diferença de degraus", () => {
  assert.equal(scaleMultiplier(0, 2, 10), 0.01);
  assert.equal(scaleMultiplier(2, 0, 10), 100);
  assert.equal(scaleMultiplier(1, 1, 10), 1);
  assert.equal(scaleMultiplier(undefined, 1, 10), 0.1);
});

test("condição padrão: Queimadura em % do dano do golpe", () => {
  const burn = { id: "burn", effect: { kind: "tick", tickTarget: "hp", tickSign: "damage", valueMode: "hitPercent", value: 10, durationRounds: 2 } };
  assert.deepEqual(resolveConditionEffect(burn, { hitDamage: 5000 }), {
    target: "hp", amount: -500, periodic: true, durationRounds: 2, tickUnit: "combatRound", conditionId: "burn"
  });
  // Sem golpe (marcação à mão, Skill sem dano): fica só o ícone.
  assert.equal(resolveConditionEffect(burn, {}), null);
});

test("condição padrão: % da Vida máxima, cura, e Lentidão no Deslocamento", () => {
  const regen = { id: "regen", effect: { kind: "tick", tickTarget: "hp", tickSign: "heal", valueMode: "maxPercent", value: 5, durationRounds: 3 } };
  assert.equal(resolveConditionEffect(regen, { targetMax: { hp: 1000 } }).amount, 50);
  const slow = { id: "slow", effect: { kind: "modifier", modTarget: "movement", value: -50, durationRounds: 2 } };
  assert.deepEqual(resolveConditionEffect(slow, {}), {
    target: "movement", amount: -50, periodic: false, durationRounds: 2, tickUnit: "combatRound", conditionId: "slow"
  });
  const weak = { id: "weak", effect: { kind: "modifier", modTarget: "strength", modMode: "percent", value: -20, durationRounds: 2 } };
  assert.equal(resolveConditionEffect(weak, { attributeTotal: () => 50 }).amount, -10);
  assert.equal(resolveConditionEffect({ id: "blind" }, {}), null);
});

test("reaplicar renova (não soma) e fica com o valor mais forte", () => {
  assert.deepEqual(refreshReapplication({ rounds: 1, amount: -500 }, { rounds: 3, amount: -20 }), { rounds: 3, amount: -500 });
  assert.deepEqual(refreshReapplication({ rounds: 5, amount: -10 }, { rounds: 2, amount: -40 }), { rounds: 5, amount: -40 });
});

test("chance: 0 nunca, 100 sempre, o resto pelo sorteio", () => {
  assert.equal(rollChance(0), false);
  assert.equal(rollChance(100), true);
  assert.equal(rollChance(25, () => 0.1), true);
  assert.equal(rollChance(25, () => 0.9), false);
});

test("escudo pessoal: dreno bate só no Escudo e nunca passa pra Vida", () => {
  assert.deepEqual(splitShieldDamage(20, 15, { shieldExtra: 10 }), { toShield: 15, toHp: 15 });
  assert.deepEqual(splitShieldDamage(20, 0, { shieldExtra: 10 }), { toShield: 0, toHp: 20 });
});

test("traços: os da Espécie, mais os da ficha, menos os retirados", () => {
  const presets = { dragoide: { traits: ["organic", "draconic", "wingless"] } };
  assert.deepEqual(
    resolveActorTraits({ species: "dragoide", traits: ["flying"], traitsRemoved: ["wingless"] }, presets),
    ["organic", "draconic", "flying"]
  );
  assert.deepEqual(resolveActorTraits({ traits: ["mechanical"] }, presets), ["mechanical"]);
});

/* -------------------------------------------- */
/*  Modificadores Condicionais                   */
/* -------------------------------------------- */

const DRAGON_SLAYER = { when: { kind: "otherTrait", value: "draconic" }, then: { kind: "damagePercent", value: 25 } };

test("condicional: Caçador de Dragões só vale contra quem tem o Traço", () => {
  const vsDragon = { otherTraits: new Set(["draconic", "organic"]) };
  const vsHuman = { otherTraits: new Set(["organic"]) };
  assert.equal(sumConditionalModifiers([DRAGON_SLAYER], "damagePercent", vsDragon), 25);
  assert.equal(sumConditionalModifiers([DRAGON_SLAYER], "damagePercent", vsHuman), 0);
});

test("condicional: condições sobre si mesmo (Vida baixa, Condição, combate)", () => {
  assert.equal(matchesWhen({ kind: "selfHpBelow", threshold: 50 }, { selfHpPercent: 30 }), true);
  assert.equal(matchesWhen({ kind: "selfHpBelow", threshold: 50 }, { selfHpPercent: 80 }), false);
  assert.equal(matchesWhen({ kind: "selfCondition", value: "burn" }, { selfConditions: new Set(["burn"]) }), true);
  assert.equal(matchesWhen({ kind: "selfInCombat" }, { inCombat: false }), false);
  assert.equal(matchesWhen({ kind: "element", value: "fire" }, { elements: new Set(["fire"]) }), true);
  assert.equal(matchesWhen({ kind: "otherIsShip" }, { otherIsShip: true }), true);
  assert.equal(matchesWhen({}, {}), true);
});

test("condicional: '+N por cada Condição no oponente' multiplica pela contagem", () => {
  const perCondition = { when: { kind: "always" }, then: { kind: "damagePercent", value: 5 }, perEach: "otherConditions" };
  assert.equal(sumConditionalModifiers([perCondition], "damagePercent", { otherConditions: new Set(["burn", "slow", "poison"]) }), 15);
  assert.equal(perEachCount("", {}), 1);
});

test("condicional: rolagem e atributo filtram por atributo ('any' vale pra todos)", () => {
  const mods = [
    { when: { kind: "always" }, then: { kind: "rollFlat", target: "perception", value: 3 } },
    { when: { kind: "always" }, then: { kind: "rollFlat", target: "any", value: 1 } }
  ];
  assert.equal(sumConditionalModifiers(mods, "rollFlat", {}, { attribute: "perception" }), 4);
  assert.equal(sumConditionalModifiers(mods, "rollFlat", {}, { attribute: "strength" }), 1);
});

test("condicional: bônus contínuo de atributo só aceita condições sobre si mesmo", () => {
  const rage = { when: { kind: "selfHpBelow", threshold: 50 }, then: { kind: "attributeFlat", target: "strength", value: 10 } };
  const vsDragon = { when: { kind: "otherTrait", value: "draconic" }, then: { kind: "attributeFlat", target: "strength", value: 10 } };
  const ctx = { selfHpPercent: 20, otherTraits: new Set(["draconic"]) };
  assert.equal(sumConditionalModifiers([rage, vsDragon], "attributeFlat", ctx, { attribute: "strength" }), 10);
});

test("condicional: Resistência filtra pelo alvo da Resistência", () => {
  const mods = [{ when: { kind: "always" }, then: { kind: "resistancePercent", target: "fire", value: 20 } }];
  assert.equal(sumConditionalModifiers(mods, "resistancePercent", {}, { element: "fire" }), 20);
  assert.equal(sumConditionalModifiers(mods, "resistancePercent", {}, { element: "general" }), 0);
});

test("Dano Absoluto é o dano inteiro, com qualquer elemento junto", () => {
  // Fogo + Gelo, alvo imune a Fogo, resistente a Gelo, e o Pólaron teria bônus contra o Traço dele.
  const result = resolveDamageParts({
    parts: [
      { elementId: "fire", raw: 50, bonus: 0.3 },
      { elementId: "ice", raw: 50, penetration: 0.5 }
    ],
    magicDefense: 0.4,
    general: 0.2,
    resistanceFor: id => (id === "fire" ? 1 : 0.5),
    absolute: true
  });
  assert.equal(result.final, 100);
});

test("Escudo mantido: o pool regenera até o teto", () => {
  assert.equal(sustainedShieldGain(0, 40, 100), 40);
  assert.equal(sustainedShieldGain(80, 40, 100), 20); // não passa do teto
  assert.equal(sustainedShieldGain(130, 40, 100), 0); // Escudo de outra fonte acima do teto fica
  assert.equal(sustainedShieldGain(500, 40, 0), 40); // sem teto, entra tudo
});

test("Escudo pessoal com % de camada: torpedo fraco no Escudo, phaser forte", () => {
  // 100 de dano, Escudo 20, elemento −50% no Escudo: o Escudo segura 40 do golpe (perde 20), 60 na Vida.
  assert.deepEqual(splitShieldDamage(100, 20, { shieldMultiplier: 0.5 }), { toShield: 20, toHp: 60 });
  // +20% no Escudo: 50 de dano com Escudo 100 = Escudo perde 60, Vida intacta.
  assert.deepEqual(splitShieldDamage(50, 100, { shieldMultiplier: 1.2 }), { toShield: 60, toHp: 0 });
  // Multiplicador 1 continua igual ao de sempre.
  assert.deepEqual(splitShieldDamage(20, 10), { toShield: 10, toHp: 10 });
});

test("Escudo em pools: o mais recente apanha primeiro, um de cada vez", () => {
  const pools = [
    { id: "a", value: 30, order: 1 },
    { id: "b", value: 20, order: 2 } // mais recente
  ];
  const hit = consumeShieldPools(pools, 10, 35);
  assert.deepEqual(hit.pools.map(p => [p.id, p.value]), [["b", 0], ["a", 15]]);
  assert.equal(hit.loose, 10);
  assert.equal(hit.toShield, 35);
  assert.equal(hit.toHp, 0);
  // Estoura tudo: o avulso é o último.
  const big = consumeShieldPools(pools, 10, 100);
  assert.equal(big.toShield, 60);
  assert.equal(big.toHp, 40);
});

test("Escudo em pools: Penetração age em cada camada, e dano menor que 1 some", () => {
  // Penetração 50%, dois pools grandes: o 1º segura 50, passam 50; o 2º segura 25, passam 25.
  const hit = consumeShieldPools([{ id: "a", value: 1000, order: 1 }, { id: "b", value: 1000, order: 2 }], 0, 100, { penetration: 0.5 });
  assert.deepEqual(hit.pools.map(p => p.value), [950, 975]);
  assert.equal(hit.toHp, 25);
  // Cada camada divide de novo até sobrar menos de 1, que é descartado.
  const tiny = consumeShieldPools([{ id: "a", value: 999, order: 3 }, { id: "b", value: 999, order: 2 }, { id: "c", value: 999, order: 1 }], 0, 3, { penetration: 0.5 });
  assert.equal(tiny.toHp, 0);
});

test("Escudo digitado à mão ajusta os pools", () => {
  const pools = [{ id: "a", value: 30, order: 1 }, { id: "b", value: 20, order: 2 }];
  assert.deepEqual(reconcileShieldPools(pools, 40).map(p => p.value), [30, 10]); // tira do mais recente
  assert.deepEqual(reconcileShieldPools(pools, 15).map(p => p.value), [15, 0]); // atravessa pro mais antigo
  assert.deepEqual(reconcileShieldPools(pools, 80).map(p => p.value), [30, 20]); // aumentar vira avulso
});

test("Antimagia: marca Mágica e custo extra por nível", () => {
  const char = { type: "character" };
  const ship = { type: "starship" };
  assert.equal(isMagicUse({ cost: 10 }, char), true); // custa Mana
  assert.equal(isMagicUse({ cost: 0, hasUpkeep: true, upkeepCost: 5 }, char), true);
  assert.equal(isMagicUse({ cost: 0, isMagicDamage: true }, char), true);
  assert.equal(isMagicUse({ cost: 0 }, char), false);
  assert.equal(isMagicUse({ cost: 10, magicTag: "mundane" }, char), false); // o Mestre desmarca
  assert.equal(isMagicUse({ cost: 0, magicTag: "magic" }, char), true);
  assert.equal(isMagicUse({ cost: 10 }, ship), false); // Nave paga com a Bateria
  assert.equal(antimagicSurcharge(20, 0), 0);
  assert.equal(antimagicSurcharge(20, 1), 30);
  assert.equal(antimagicSurcharge(20, 2), 90);
  assert.equal(antimagicSurcharge(20, 3), 210);
  assert.equal(antimagicSurcharge(0, 1, { base: 5, growth: 3 }), 10);
});

test("Vantagem entre elementos: níveis, multiplicação, média das partes e o antigo percentual", () => {
  const matrix = buildAffinityMatrix([
    { id: "fire", affinity: { ice: 1, plant: 2, fire: -1 } },
    { id: "water", effects: [{ type: "vsElement", element: "fire", percent: 50 }] }, // antigo → Efetivo
    { id: "ghost", affinity: { normal: -2 } }
  ]);
  assert.deepEqual(matrix.water, { fire: 1 });
  assert.equal(affinityMultiplier(-2), 0);
  assert.equal(affinityMultiplier(-1), 0.5);
  assert.equal(affinityMultiplier(0), 1);
  assert.equal(affinityMultiplier(1), 1.5);
  assert.equal(affinityMultiplier(2), 2);
  assert.equal(affinityMultiplier(2, { superEffective: 3 }), 3);
  assert.equal(elementVsDefender("fire", ["ice"], matrix), 1.5);
  assert.equal(elementVsDefender("fire", ["ice", "plant"], matrix), 3); // multiplica (1,5 × 2)
  assert.equal(elementVsDefender("fire", [], matrix), 1);
  assert.equal(elementVsDefender("ghost", ["normal"], matrix), 0);
  assert.equal(hitAffinityFactor(["fire", "water"], ["fire"], matrix), (0.5 + 1.5) / 2); // metade de cada
  assert.equal(hitAffinityFactor([], ["ice"], matrix), 1);
  assert.equal(cycleAffinityLevel(0, 1), 1);
  assert.equal(cycleAffinityLevel(2, 1), 2);
  assert.equal(cycleAffinityLevel(0, -1), -1);
  assert.equal(cycleAffinityLevel(-2, -1), -2);
});

test("Vantagem entre elementos no dano de Personagem e nos pools de Escudo", () => {
  // Parte de Fogo contra corpo de Gelo (×1,5): o Escudo recebe o golpe sem essa vantagem.
  const result = resolveDamageParts({ parts: [{ elementId: "fire", raw: 100, affinity: 1.5 }] });
  assert.equal(result.final, 150);
  assert.equal(result.shieldBase, 100);
  const immune = resolveDamageParts({ parts: [{ elementId: "fire", raw: 100, affinity: 0 }] });
  assert.equal(immune.final, 0);
  assert.equal(immune.shieldBase, 100);
  // Pool de Água (ineficaz contra ele: ×0,5 no que ele sofre) segura o dobro.
  const pools = [{ id: "a", value: 20, order: 2, elements: ["water"] }];
  const out = consumeShieldPools(pools, 0, 100, { layerMultiplier: pool => (pool.elements.includes("water") ? 0.5 : 1) });
  assert.equal(out.toShield, 20);
  assert.equal(out.toHp, 60); // 100 − 40 (20 de Escudo seguram 40 de golpe)
});

const VALIDATOR_CATALOGS = {
  conditions: [{ id: "burn", label: "Queimadura", elements: ["fire"] }, { id: "slow", label: "Lentidão", effect: { kind: "modifier", modTarget: "movement" } }],
  elements: [
    { id: "fire", label: "Fogo", effects: [{ type: "condition", conditionId: "burn" }], affinity: { ice: 1 } },
    { id: "ice", label: "Gelo", effects: [{ type: "traitBonus", trait: "organic" }] }
  ],
  structures: [{ id: "wall", label: "Muralha", elements: ["ice"] }],
  scales: [{ id: "personal" }, { id: "ship" }],
  attributes: ["strength", "magic", "dexterity"],
  traits: [{ id: "organic" }],
  species: { humano: { label: "Humano", traits: ["organic"], skills: [] } },
  ammoTypes: [{ id: "torpedo" }],
  crewRoles: [{ id: "pilot" }],
  moduleCategories: [{ id: "weapon" }, { id: "shield" }],
  shipSizes: [{ id: "mini" }, { id: "medio" }, { id: "capital" }],
  vehicleSizes: [{ id: "mini" }],
  shipClasses: [{ id: "fighter", label: "Caça", minSize: "mini", maxSize: "mini", slots: { weapon: 2 } }],
  vehicleClasses: [],
  scaleMaps: { shipSizeMap: { mini: "personal", medio: "ship" }, vehicleSizeMap: {} }
};

test("Rastro de dano (Mestre): uma linha por defesa, na ordem aplicada", () => {
  const labels = { elementLabel: id => ({ fire: "Fogo", ice: "Gelo" })[id] ?? id, generalLabel: "Resistência Geral (Pele de Pedra)", elementSourceLabel: id => (id === "ice" ? "Sangue Frio" : "") };
  const result = resolveDamageParts({
    parts: [
      { elementId: "fire", raw: 50, penetration: 0.3, bonus: 0.2, affinity: 1.5 },
      { elementId: "ice", raw: 50 }
    ],
    magicDefense: 0.2,
    general: 0.5,
    resistanceFor: id => (id === "ice" ? 1 : 0)
  });
  const rows = describeDamageParts(result.parts, labels);
  const labelsOnly = rows.map(r => r.label);
  assert.deepEqual(labelsOnly, [
    "Parte Fogo",
    "Bônus contra Traço do alvo",
    "Penetração (suaviza cada defesa)",
    "Defesa Mágica",
    "Resistência Geral (Pele de Pedra)",
    "Vantagem contra o elemento do corpo",
    "= Fogo",
    "Parte Gelo",
    "Imunidade a Gelo (Sangue Frio)",
    "= Gelo"
  ]);
  assert.equal(rows.find(r => r.label === "Defesa Mágica").value, "−14%", "20% suavizado por 30% de Penetração");
  assert.equal(rows.find(r => r.label === "= Gelo").value, "0");
  // Fecha com o final: 50 × 1.2 × 0.86 × 0.65 × 1.5 = 50.31
  assert.equal(rows.find(r => r.label === "= Fogo").value, "50.3");
  assert.equal(result.final, 50);

  const single = describeDamageParts(resolveDamageParts({ parts: [{ elementId: null, raw: 30 }], absolute: true }).parts, labels);
  assert.deepEqual(single.map(r => r.label), ["Dano (sem elemento)", "Dano Absoluto: ignora defesas e vantagem"]);
});

test("Elementos: hierarquia (Subtipo de) — ancestrais, ciclo e resistência em cadeia", () => {
  const els = [{ id: "physical" }, { id: "slashing", parent: "physical" }, { id: "a", parent: "b" }, { id: "b", parent: "a" }];
  assert.deepEqual(elementAncestors("slashing", els), ["physical"]);
  assert.deepEqual(elementAncestors("physical", els), []);
  assert.deepEqual(elementAncestors("a", els), ["b"], "ciclo é cortado");
  // Resistência a Cortante 20% depois da Física 30%: passa 0,8 × 0,7 = 56%.
  assert.ok(Math.abs(chainedResistance([0.2, 0.3]) - 0.44) < 1e-9);
  assert.equal(chainedResistance([0, 1]), 1, "Imunidade a Físico imuniza contra Cortante");
  assert.equal(chainedResistance([]), 0);
});

test("Elementos: subtipo herda efeitos e vantagens do pai (os dele mandam)", () => {
  const fire = { id: "fire", effects: [{ type: "condition", conditionId: "burn", chance: 25 }, { type: "penetration", percent: 10 }], affinity: { ice: 1 } };
  const hellfire = { id: "hellfire", parent: "fire", effects: [{ type: "condition", conditionId: "burn", chance: 60 }], affinity: { holy: 2 } };
  const effects = inheritedElementEffects([hellfire, fire]);
  assert.deepEqual(effects.map(e => [e.type, e.chance ?? e.percent]), [["condition", 60], ["penetration", 10]], "Queimadura não rola duas vezes");
  const matrix = buildMatrixForHierarchy([fire, hellfire, { id: "ice" }, { id: "glacier", parent: "ice" }, { id: "holy" }]);
  assert.equal(matrix.hellfire.ice, 1, "herda a linha do Fogo");
  assert.equal(matrix.hellfire.holy, 2, "e mantém a dele");
  assert.equal(matrix.fire.glacier, 1, "contra um subtipo de Gelo vale o que vale contra o Gelo");
  assert.equal(matrix.fire.holy, undefined);
});

test("Elementos: Físico de fábrica tem Cortante, Perfurante e Contundente; validador acusa Subtipo inválido", () => {
  const subs = MEU_SISTEMA.DEFAULT_DAMAGE_ELEMENTS.filter(el => el.parent === "physical").map(el => el.id);
  assert.deepEqual(subs, ["slashing", "piercing", "blunt"]);
  assert.ok(MEU_SISTEMA.DEFAULT_DAMAGE_ELEMENTS.find(el => el.id === "slashing").effects.some(e => e.type === "sever"));
  const broken = { ...VALIDATOR_CATALOGS, elements: [...(VALIDATOR_CATALOGS.elements ?? []), { id: "x", label: "X", parent: "nao-existe" }, { id: "y", label: "Y", parent: "y" }] };
  const issues = validateCatalogs(broken).flatMap(group => group.items ?? [group]).flatMap(item => item.issues ?? [item]);
  const text = JSON.stringify(validateCatalogs(broken));
  assert.match(text, /nao-existe/);
  assert.match(text, /subtipo de si mesmo/);
  assert.ok(issues.length > 0);
});

test("Vantagem entre elementos: nível fica entre −2 e 2, arredondado; lixo vira Neutro", () => {
  assert.equal(clampAffinityLevel(1), 1);
  assert.equal(clampAffinityLevel(-2), -2);
  assert.equal(clampAffinityLevel(7), 2, "acima de Super efetivo para em 2");
  assert.equal(clampAffinityLevel(-9), -2, "abaixo de Imune para em −2");
  assert.equal(clampAffinityLevel(1.6), 2);
  assert.ok(clampAffinityLevel(-0.4) === 0, "arredonda para Neutro (−0 conta como 0)");
  assert.equal(clampAffinityLevel("1"), 1, "texto numérico do formulário vale");
  assert.equal(clampAffinityLevel("abc"), 0);
  assert.equal(clampAffinityLevel(undefined), 0);
  assert.equal(clampAffinityLevel(NaN), 0);
});

test("Vantagem entre elementos: nível de ataque × defesa lido da tabela, Neutro quando falta", () => {
  const matrix = { fire: { ice: 2, water: -1, stone: 5 }, light: {} };
  assert.equal(affinityLevel(matrix, "fire", "ice"), 2);
  assert.equal(affinityLevel(matrix, "fire", "water"), -1);
  assert.equal(affinityLevel(matrix, "fire", "stone"), 2, "valor salvo fora da faixa é limitado");
  assert.equal(affinityLevel(matrix, "fire", "fire"), 0, "par sem entrada = Neutro");
  assert.equal(affinityLevel(matrix, "light", "ice"), 0);
  assert.equal(affinityLevel(matrix, "void", "ice"), 0, "elemento de ataque sem linha = Neutro");
  assert.equal(affinityLevel(null, "fire", "ice"), 0, "sem tabela não quebra");
});
