/**
 * Ficha em modo criação (J10) e pedido de Skill com mecânica. Critério e como rodar: ver o
 * cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  requestSkillSystem,
  REQUEST_MECHANIC_FIELDS,
  isOpenRequest,
  skillSlots,
  creationSteps,
  creationStatusRow,
  quickSpread,
  QUICK_SPREADS,
  vitalPreview,
  attributePurpose,
  bodySummary,
  speciesCardLines,
  speciesBlurb
} from "../module/creation/creation-rules.js";
import { MEU_SISTEMA } from "../module/core/config.js";

test("Pedido de Skill: só a mecânica entra; Nível 1, desligada, Tier do ponto", () => {
  const system = requestSkillSystem(
    {
      name: "Asas de Brasa",
      tier: "ultimate",
      level: 9,
      xp: 500,
      active: true,
      isItemGranted: true,
      subSkills: [{ name: "x" }],
      cost: 24.6,
      hasUpkeep: false,
      upkeepCost: 7,
      effectType: "damage",
      damageFormula: "4d6",
      damageElements: ["fire"],
      targetType: "emission",
      areaShape: "circle",
      areaDistance: 4,
      description: "<p>Fogo</p>"
    },
    "normal"
  );
  assert.equal(system.tier, "normal");
  assert.equal(system.level, 1);
  assert.equal(system.xp, 0);
  assert.equal(system.active, false);
  assert.equal(system.cost, 25);
  assert.equal(system.upkeepCost, 0, "sem Ativa não há custo por rodada");
  assert.equal(system.isItemGranted, undefined);
  assert.equal(system.subSkills, undefined);
  assert.equal(system.damageFormula, "4d6");
  assert.deepEqual(system.damageElements, ["fire"]);
  assert.equal(system.areaShape, "circle");
  assert.ok(!REQUEST_MECHANIC_FIELDS.includes("subSkills"));

  const old = requestSkillSystem({ name: "Velha", targetType: "structure", structureId: "muro" }, "extra");
  assert.equal(old.effectType, "structure");
  assert.equal(old.targetType, "targeted");
  assert.deepEqual(old.effects, []);

  // Pedido de antes da 1.84 (só texto e custo): nasce Descritiva, como sempre.
  const plain = requestSkillSystem({ description: "texto", cost: 3 }, "normal");
  assert.equal(plain.effectType, undefined);
  assert.equal(plain.cost, 3);

  // Clonado: mexer no resultado não muda o pedido.
  const source = { effects: [{ target: "strength", amount: 2 }] };
  requestSkillSystem(source, "normal").effects[0].amount = 99;
  assert.equal(source.effects[0].amount, 2);
});

test("Pedido de Skill: aberto = aguardando ou devolvido; pontos reservados pelos pedidos", () => {
  assert.equal(isOpenRequest("pending"), true);
  assert.equal(isOpenRequest("changes"), true);
  assert.equal(isOpenRequest("approved"), false);
  assert.deepEqual(skillSlots({ owned: 1, pending: 1, points: 2 }), { used: 2, total: 3, free: 1, done: false });
  assert.equal(skillSlots({ owned: 2, pending: 1, points: 1 }).done, true);
  assert.equal(skillSlots({ owned: 0, pending: 3, points: 2 }).free, 0, "nunca negativo");
  assert.equal(skillSlots({}).done, false, "nada para pedir não conta como pronto");
});

test("Faixa Criando: passos, o atual e quando dá para clicar Pronto", () => {
  const empty = creationSteps({ name: "", concept: "", speciesNeeded: true, speciesLabel: "", pool: { spent: 0, total: 35 }, skills: { used: 0, total: 3, done: false } });
  assert.deepEqual(empty.steps.map(s => s.id), ["concept", "origin", "points", "skills"]);
  assert.equal(empty.current, "concept");
  assert.equal(empty.canReady, false);
  assert.equal(empty.steps[2].label, "Pontos 0/35");

  const named = creationSteps({ name: "Kael", concept: "Dragoide exilado", speciesLabel: "", pool: { spent: 0, total: 35 }, skills: null });
  assert.equal(named.current, "origin");
  assert.equal(named.canReady, false, "sem Espécie ainda");

  const ready = creationSteps({ name: "Kael", concept: "x", speciesLabel: "Dragoide do Fogo", pool: { spent: 35, total: 35 }, skills: { used: 2, total: 3, done: false } });
  assert.equal(ready.canReady, true);
  assert.equal(ready.steps[1].label, "Dragoide do Fogo");
  assert.equal(ready.steps[3].warn, true, "Skill não pedida só fica amarela");
  assert.equal(ready.steps[2].warn, false);
  assert.equal(ready.doneCount, 3);

  // Campanha sem Espécies, sem Pool e sem Pontos de Habilidade: só o conceito e o nome.
  const bare = creationSteps({ name: "Ana", concept: "", speciesNeeded: false });
  assert.deepEqual(bare.steps.map(s => s.id), ["concept"]);
  assert.equal(bare.canReady, true);

  assert.deepEqual(creationStatusRow("ready", 3, 4), { label: "aguardando você", kind: "wait" });
  assert.deepEqual(creationStatusRow("adjust", 3, 4), { label: "ajuste pedido", kind: "adjust" });
  assert.deepEqual(creationStatusRow("editing", 2, 4), { label: "criando · 2 de 4", kind: "creating" });
});

test("Começar de um jeito: reparte tudo, inteiro, só nos atributos que aparecem", () => {
  const keys = MEU_SISTEMA.COMBAT_ATTRIBUTES;
  for (const spread of Object.values(QUICK_SPREADS)) {
    const out = quickSpread(35, spread.weights, keys);
    assert.equal(Object.values(out).reduce((a, b) => a + b, 0), 35, spread.label);
    assert.ok(Object.values(out).every(Number.isInteger));
  }
  const fighter = quickSpread(35, QUICK_SPREADS.lutador.weights, keys);
  assert.ok(fighter.strength > fighter.magic);
  assert.equal(fighter.stealth, 0);
  const hidden = quickSpread(10, QUICK_SPREADS.equilibrado.weights, ["strength", "defense"]);
  assert.deepEqual(hidden, { strength: 5, defense: 5 });
  assert.deepEqual(quickSpread(0, { strength: 1 }, ["strength"]), { strength: 0 });
});

test("Ao confirmar: Vida e Mana pela fórmula com os pendentes; só a parte da fórmula muda", () => {
  const formula = { hp: ["strength", "defense"], energy: ["magic", "magicalDefense"], multiplier: 10, floor: 50, energyEnabled: true };
  const combat = {
    strength: { total: 0, pending: 6 },
    defense: { total: 0, pending: 5 },
    magic: { total: 0, pending: 8 },
    magicalDefense: { total: 0, pending: 4 }
  };
  const preview = vitalPreview({ combat, formula, hpNow: 50, energyNow: 50 });
  assert.equal(preview.hp.next, 300);
  assert.equal(preview.energy.next, 320);
  assert.deepEqual(preview.hp.a, { key: "strength", value: 6 });
  assert.equal(preview.changed, true);

  // Um Título que dá +20 de Vida continua somando por cima.
  const titled = vitalPreview({ combat: { strength: { total: 6, pending: 1 }, defense: { total: 5, pending: 0 } }, formula, hpNow: 320 });
  assert.equal(titled.hp.next, 370);
  assert.equal(vitalPreview({ combat: {}, formula: { ...formula, energyEnabled: false }, hpNow: 50 }).energy, null);
  assert.equal(vitalPreview({ combat: { strength: { total: 1, pending: 0 } }, formula, hpNow: 50 }).changed, false);
});

test("Uma frase por atributo, com o que ele alimenta neste mundo", () => {
  const ctx = { hpKeys: ["strength", "defense"], energyKeys: ["magic", "magicalDefense"], energyLabel: "Mana", initiativeKey: "dexterity", movement: true };
  assert.equal(attributePurpose("strength", ctx), "dano corpo a corpo · Vida");
  assert.equal(attributePurpose("magic", ctx), "poder das Skills · Mana");
  assert.equal(attributePurpose("dexterity", ctx), "iniciativa · deslocamento");
  assert.equal(attributePurpose("dexterity", {}), "agilidade");
  assert.equal(attributePurpose("stealth", ctx), "passar despercebido");
  assert.equal(attributePurpose("magic", { ...ctx, energyLabel: "Fluxo" }), "poder das Skills · Fluxo");
});

test("Origem: o cartão diz o que a Espécie com a Linhagem traz", () => {
  const dragoide = MEU_SISTEMA.DEFAULT_SPECIES_PRESETS.dragoide;
  const fogo = dragoide.lineages.find(l => l.id === "fogo");
  const lines = speciesCardLines(dragoide, fogo, { traitLabel: id => `T:${id}`, elementLabel: id => (id === "fire" ? "Fogo" : id) });
  const byLabel = Object.fromEntries(lines.map(l => [l.label, l]));
  assert.equal(byLabel["Corpo"].value, "cauda e asas");
  assert.equal(byLabel["Escamas Ancestrais"].value, "Racial");
  assert.equal(byLabel["Presença de Dragão"].later, true);
  assert.equal(byLabel["Resistência a Fogo"].value, "20%");
  assert.ok(byLabel["Traços"].value.includes("T:draconic"));

  // A Linhagem do Gelo troca o Sopro Dracônico pelo Gélido.
  const gelo = dragoide.lineages.find(l => l.id === "gelo");
  const iceNames = speciesCardLines(dragoide, gelo).map(l => l.label);
  assert.ok(iceNames.includes("Sopro Gélido"));
  assert.ok(!iceNames.includes("Sopro Dracônico"));

  assert.equal(bodySummary([{ slot: "head" }, { slot: "torso" }]), "2 partes");
  assert.equal(bodySummary([{ slot: "tail" }]), "cauda");
  assert.equal(bodySummary([]), "");
  assert.deepEqual(speciesCardLines(null), []);
  assert.equal(speciesBlurb({ description: "<p>Robusto. Resistente.</p>" }), "Robusto.");
  assert.equal(speciesBlurb({ traits: ["a", "b"] }, { traitLabel: id => id.toUpperCase() }), "A · B");
});
