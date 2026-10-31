/**
 * Exportar/importar, presets de campanha, Validar Mundo e cache de catálogo.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { getActiveDamageElements } from "../module/core/config.js";
import { readTransferBundle, diffTransfer, transferGroup } from "../module/core/config-transfer.js";
import { presetContent } from "../module/core/config.js";
import {
  buildCatalogIndex,
  checkMechanic,
  checkConditionals,
  validateItem,
  validateActor,
  validateCatalogs
} from "../module/world/world-validator.js";
import { createRawCache, memoByObject } from "../module/core/config/cache.js";

/* -------------------------------------------- */
/*  Exportar/Importar e presets                  */
/* -------------------------------------------- */

test("importar: formato atual traz o mapa de settings, sem o registro de migrações", () => {
  const bundle = { _system: "nihility-rpg-system", settings: { xpFormula: "100 * @nivel", completedMigrations: "[]" } };
  assert.deepEqual(readTransferBundle(bundle, "nihility-rpg-system"), { xpFormula: "100 * @nivel" });
});

test("importar: arquivo antigo (4 listas parseadas) continua aceito", () => {
  const legacy = { currenciesData: [{ id: "gold" }], damageElementsData: [{ id: "fire" }] };
  const read = readTransferBundle(legacy, "nihility-rpg-system");
  assert.deepEqual(Object.keys(read).sort(), ["currenciesData", "damageElementsData"]);
  assert.equal(typeof read.currenciesData, "string");
});

test("importar: arquivo de outro sistema ou sem nada reconhecível é recusado", () => {
  assert.equal(readTransferBundle({ _system: "dnd5e", settings: {} }, "nihility-rpg-system"), null);
  assert.equal(readTransferBundle({ foo: 1 }, "nihility-rpg-system"), null);
});

test("importar: diferença ignora formatação de JSON e chaves desconhecidas", () => {
  const current = { a: '[{"id":1}]', b: 5 };
  const incoming = { a: '[\n  {"id": 1}\n]', b: 6, desconhecida: 1 };
  assert.deepEqual(diffTransfer(current, incoming), [{ key: "a", changed: false }, { key: "b", changed: true }]);
});

test("importar: grupos dos diálogos", () => {
  const features = new Set(["movementEnabled"]);
  assert.equal(transferGroup("movementEnabled", features), "Módulos do Sistema");
  assert.equal(transferGroup("traitsData", features), "Catálogos");
  assert.equal(transferGroup("xpFormula", features), "Regras");
});

test("presets: Sci-Fi carrega elementos de energia + os de fantasia, sem id repetido", () => {
  const content = presetContent("scifi");
  const ids = content.damageElementsData.map(e => e.id);
  assert.ok(ids.includes("phaser") && ids.includes("fire"));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(content.moduleCategoriesData.some(c => c.id === "thrusters"));
  assert.deepEqual(Object.keys(presetContent("inexistente")), []);
});

test("elementos sem grupo salvo herdam o grupo do padrão de mesmo id", () => {
  // Sem setting (o stub lança), a lista é a padrão: todo elemento tem grupo e nada cai em "Outros".
  assert.ok(getActiveDamageElements().every(el => el.group && el.group !== "Outros"));
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

const VIDX = buildCatalogIndex(VALIDATOR_CATALOGS);

test("Validador: referência válida não gera aviso; quebrada gera exatamente um", () => {
  const ok = { effects: [{ conditionId: "burn", damageElements: ["fire"] }], damageElements: ["ice"], structureId: "", damageScale: "ship", scalingAttribute: "magic", resistanceTarget: "general" };
  assert.deepEqual(checkMechanic(ok, VIDX), []);
  const broken = checkMechanic({ effects: [{ conditionId: "nullified" }] }, VIDX);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].catalog, "conditions");
  assert.equal(broken[0].where, "Efeito 1 › Condição");
  assert.match(broken[0].message, /"nullified" não existe em Condições/);
});

test("Validador: mecânica de Skill — Sub-Skills, Estrutura, Resistência e escala", () => {
  const issues = checkMechanic(
    { effectType: "structure", structureId: "gone", resistanceTarget: "void", damageScale: "galaxy", scalingAttribute: "luck", subSkills: [{ name: "Corte", damageElements: ["plasma"] }] },
    VIDX
  );
  assert.deepEqual(issues.map(i => i.catalog).sort(), ["attributes", "elements", "elements", "scales", "structures"]);
  assert.ok(issues.some(i => i.where === "Sub-Skill 1 (Corte) › Elementos de dano"));
});

test("Validador: Quando → Então e Itens", () => {
  const mods = [
    { when: { kind: "otherTrait", value: "dragon" }, then: { kind: "damagePercent", target: "any" } },
    { when: { kind: "selfCondition", value: "burn" }, then: { kind: "rollFlat", target: "any" } },
    { when: { kind: "always" }, then: { kind: "resistancePercent", target: "void" } }
  ];
  assert.deepEqual(checkConditionals(mods, VIDX).map(i => i.ref), ["dragon", "void"]);

  // Arma desligada não é conferida; ligada, sim.
  const weapon = { name: "Espada", type: "item", system: { weapon: { enabled: false, damageElements: ["x"] } } };
  assert.deepEqual(validateItem(weapon, VIDX), []);
  weapon.system.weapon.enabled = true;
  assert.equal(validateItem(weapon, VIDX).length, 1);
  // Habilidade Concedida sem nome = nunca usada.
  assert.deepEqual(validateItem({ type: "item", system: { grantsSkill: { name: "", damageElements: ["x"] } } }, VIDX), []);
  assert.equal(validateItem({ type: "starship_module", system: { category: "warpcore", ammoTypes: ["torpedo"] } }, VIDX).length, 1);
  assert.equal(validateItem({ type: "title", system: { resistances: [{ target: "general" }, { target: "x" }] } }, VIDX).length, 1);
});

test("Validador: Personagem — Espécie, Traços e contêiner", () => {
  const actor = {
    type: "character",
    system: { species: "dragao", traits: ["organic"], traitsRemoved: [], scale: "" },
    items: [
      { _id: "bag", name: "Mochila", type: "item", system: { container: { enabled: true } } },
      { _id: "a", name: "Poção", type: "item", system: { containerId: "bag" } },
      { _id: "b", name: "Corda", type: "item", system: { containerId: "lost" } },
      { _id: "s", name: "Bola de Fogo", type: "skill", system: { effects: [{ conditionId: "frozen" }] } }
    ]
  };
  const issues = validateActor(actor, VIDX);
  assert.deepEqual(issues.map(i => i.where), ["Espécie", "Corda › Guardado em", "Bola de Fogo › Efeito 1 › Condição"]);
  assert.equal(issues[2].itemId, "s");
});

test("Validador: Nave — Porte, Classe fora da faixa, tripulante apagado e grupo de prioridade", () => {
  const ship = {
    type: "starship",
    system: { shipSize: "medio", shipClass: "fighter", crewMembers: [{ actorUuid: "Actor.vivo", role: "pilot" }, { actorUuid: "Actor.morto", role: "cook" }], powerGroups: [] },
    items: [
      { _id: "m1", name: "Canhão", type: "starship_module", system: { category: "weapon", powerGroup: "p2" } },
      { _id: "m2", name: "Escudo", type: "starship_module", system: { category: "shield", powerGroup: "g-apagado" } }
    ]
  };
  const issues = validateActor(ship, VIDX, { uuidExists: uuid => uuid === "Actor.vivo" });
  assert.deepEqual(issues.map(i => i.where), ["Classe", "Tripulação 2", "Tripulação 2 › Posto", "Escudo › Prioridade"]);
  assert.match(issues[0].message, /fora da faixa/);
  // Porte apagado do catálogo.
  assert.equal(validateActor({ type: "starship", system: { shipSize: "titan" }, items: [] }, VIDX)[0].catalog, "shipSizes");
});

test("Validador: referências entre catálogos", () => {
  assert.deepEqual(validateCatalogs(VALIDATOR_CATALOGS), []);
  const broken = {
    ...VALIDATOR_CATALOGS,
    elements: [{ id: "void", label: "Vazio", effects: [{ type: "condition", conditionId: "nullified" }], affinity: { ghost: -2 } }],
    species: { dragao: { label: "Dragão", traits: ["wings"], skills: [{ name: "Sopro", damageElements: ["fire"] }] } }
  };
  const issues = validateCatalogs(broken);
  const byEntry = issues.map(i => `${i.entry}: ${i.where}`);
  assert.ok(byEntry.includes("Vazio: Efeito 1 › Condição"));
  assert.ok(byEntry.includes("Vazio: Tabela de vantagens"));
  assert.ok(byEntry.includes("Dragão: Traços"));
  assert.ok(byEntry.includes("Dragão: Skill Racial 1 (Sopro) › Elementos de dano"), "Fogo saiu do catálogo de elementos");
  assert.ok(byEntry.includes("Queimadura: Elementos"));
  assert.ok(byEntry.includes("Muralha: Elementos"));
});

test("Validador: Herança e Linhagem que não existem", () => {
  const catalogs = { ...VALIDATOR_CATALOGS, heritages: [{ id: "vampirizado", label: "Vampirizado", excludes: ["sumida"], removesTraits: ["organic"] }], species: { humano: { label: "Humano", lineages: [{ id: "norte" }] } } };
  const idx = buildCatalogIndex(catalogs);
  const issues = validateActor({ type: "character", system: { species: "humano", lineage: "sul", heritages: [{ id: "vampirizado" }, { id: "lobisomem" }] }, items: [] }, idx, { catalogs });
  assert.deepEqual(issues.map(i => i.where), ["Heranças", "Linhagem"]);
  assert.ok(validateCatalogs(catalogs).some(i => i.entry === "Vampirizado" && i.where === "Não convive com"));
});

test("Cache de catálogo: mesmo texto salvo, mesmo resultado; texto novo reconstrói", () => {
  const cache = createRawCache();
  let builds = 0;
  const build = raw => { builds++; return { list: typeof raw === "string" ? JSON.parse(raw) : [] }; };
  const a = cache("elements", '[{"id":"fire"}]', build);
  const b = cache("elements", '[{"id":"fire"}]', build);
  assert.equal(a, b, "mesmo objeto enquanto o texto não muda");
  assert.equal(builds, 1, "o JSON é lido uma vez só");
  const c = cache("elements", '[{"id":"ice"}]', build);
  assert.notEqual(c, a, "o Mestre salvou outro catálogo: reconstrói");
  assert.equal(c.list[0].id, "ice");
  assert.equal(cache("traits", '[{"id":"fire"}]', build).list[0].id, "fire", "cada setting tem o seu");
  cache("elements", undefined, build); cache("elements", undefined, build);
  assert.equal(builds, 5, "setting ausente (carga do Foundry, testes) nunca é guardada");
  let calls = 0;
  const matrix = memoByObject(list => { calls++; return list.length; });
  const list = [1, 2];
  matrix(list); matrix(list); matrix([1, 2]);
  assert.equal(calls, 2, "a Tabela de Vantagens só é refeita quando a lista é outra");
});

test("Validar Mundo: Traço apagado no Contágio de uma Condição aparece", () => {
  const issues = validateCatalogs({
    conditions: [{ id: "plague", label: "Praga", spread: { chance: 25, radius: 2, immuneTraits: ["mechanical", "ghost"] } }],
    elements: [], structures: [], scales: [], attributes: [], traits: [{ id: "mechanical" }]
  });
  const text = JSON.stringify(issues);
  assert.ok(text.includes("ghost"), "o Traço que não existe é listado");
  assert.ok(!text.includes('"mechanical"'), "o que existe não");
});
