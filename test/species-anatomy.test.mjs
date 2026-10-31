/**
 * Espécies, Origem, Heranças, Evolução, Anatomia, Partes do corpo e Descanso.
 * Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import { MEU_SISTEMA } from "../module/core/config.js";
import {
  speciesSlug,
  normalizeSpeciesEntry,
  bumpSpeciesVersions,
  resolveSpeciesTemplate,
  speciesDiff,
  isSpeciesLocked,
  racialSkillSystem
} from "../module/species/species-rules.js";
import {
  originLayers,
  originAttributeRows,
  originStatRows,
  originResistance,
  originConditionalSources,
  originScale,
  originMovement
} from "../module/species/species-rules.js";
import { originTraitIdsOf } from "../module/core/config.js";
import { heritageConflicts } from "../module/species/species-rules.js";
import { normalizeSpeciesCatalog, speciesContentFingerprint, skillDataHash, skillHashMatches } from "../module/species/species-rules.js";
import { partHealable } from "../module/species/anatomy-rules.js";
import { evolutionOptions, evolutionResistanceUpgrades } from "../module/species/species-rules.js";
import {
  legacyFunctionsFor,
  implantFits,
  partFunctions,
  bodyFunctionState,
  injuredMovement,
  partHpPercentForSlot,
  partMaxFromPercent,
  resolvePartVitals,
  pickHitPart,
  partDamage,
  partHealing,
  healCap,
  restOutcome
} from "../module/species/anatomy-rules.js";

const DRAGOIDE = {
  label: "Dragoide",
  traits: ["organic", "draconic"],
  parts: [
    { key: "head", label: "Cabeça", slot: "head", hpMax: 14 },
    { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 12 },
    { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 12 },
    { key: "tail", label: "Cauda", slot: "tail", hpMax: 12 }
  ],
  skills: [
    { name: "Escamas Ancestrais", level: 1, effectType: "none" },
    { name: "Sopro Dracônico", level: 1, cost: 20, effectType: "damage" },
    { name: "Presença de Dragão", level: 1, unlockLevel: 10 }
  ],
  lineages: [{ id: "gelo", label: "Gelo", elements: ["ice"], skills: [{ key: "sopro_gelido", name: "Sopro Gélido" }], replaces: { skills: ["sopro_draconico"] } }]
};

const HUMANO = {
  label: "Humano",
  traits: ["organic"],
  parts: [
    { key: "head", label: "Cabeça", slot: "head", hpMax: 10 },
    { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 8 },
    { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 8 }
  ],
  skills: [{ name: "Adaptabilidade", level: 1 }]
};

test("Espécie: chaves estáveis e versão", () => {
  assert.equal(speciesSlug("Sopro Dracônico"), "sopro_draconico");
  const entry = normalizeSpeciesEntry({ skills: [{ name: "Corte" }, { name: "Corte" }], parts: [{ label: "Asa" }] });
  assert.deepEqual(entry.skills.map(s => s.key), ["corte", "corte_2"]);
  assert.equal(entry.parts[0].key, "asa");
  assert.equal(entry.version, 1);

  const before = { dragoide: normalizeSpeciesEntry(DRAGOIDE), humano: normalizeSpeciesEntry(HUMANO) };
  const edited = { ...before, dragoide: { ...before.dragoide, label: "Dragoide!", traits: [] } };
  assert.equal(bumpSpeciesVersions(before, edited).dragoide.version, 1, "nome e Traços são ao vivo: não sobem a versão");
  const withPart = { ...before, dragoide: { ...before.dragoide, parts: [...before.dragoide.parts, { key: "horns", label: "Chifres", slot: "horn", hpMax: 8 }] } };
  assert.equal(bumpSpeciesVersions(before, withPart).dragoide.version, 2, "parte nova sobe a versão");
  assert.equal(bumpSpeciesVersions(before, withPart).humano.version, 1);
});

test("Espécie: molde com Linhagem, Herança e Skill liberada por nível", () => {
  const low = resolveSpeciesTemplate({ species: DRAGOIDE, speciesId: "dragoide", lineage: DRAGOIDE.lineages[0], level: 3 });
  assert.deepEqual(low.skills.map(s => s.key), ["escamas_ancestrais", "sopro_gelido"], "Linhagem substitui o Sopro pela chave");
  assert.deepEqual(low.locked.map(s => s.key), ["presenca_de_dragao"]);
  assert.deepEqual(low.elements, ["ice"]);
  assert.equal(low.skills[1].source.kind, "lineage");
  const high = resolveSpeciesTemplate({ species: DRAGOIDE, speciesId: "dragoide", level: 10 });
  assert.ok(high.skills.some(s => s.key === "presenca_de_dragao"));

  const heritage = { traits: ["undead"], removesTraits: ["organic"], parts: [{ key: "cyber_arm", label: "Braço Cibernético", slot: "arm", hpMax: 20 }], replaces: { slots: ["arm"] } };
  const withHeritage = resolveSpeciesTemplate({ species: HUMANO, speciesId: "humano", heritages: [{ id: "ciborgue", entry: heritage }] });
  assert.deepEqual(withHeritage.traits, ["undead"], "Herança tira Orgânico");
  assert.deepEqual(withHeritage.parts.map(p => p.key), ["head", "cyber_arm"], "Herança troca partes pelo slot");
});

const tplOf = (species, id, level = 1) => resolveSpeciesTemplate({ species, speciesId: id, level });

test("Espécie: criação aplica tudo; troca leva prótese pelo slot e guarda a Skill que sai", () => {
  const fresh = speciesDiff({ parts: [], skills: [] }, tplOf(HUMANO, "humano"));
  assert.equal(fresh.parts.create.length, 3);
  assert.equal(fresh.skills.create.length, 1);
  assert.equal(fresh.losses.length, 0);

  const current = {
    parts: [
      { id: "p1", name: "Cabeça", slot: "head", grant: { key: "head" }, hp: { value: 7, max: 14 }, mods: [] },
      { id: "p2", name: "Braço Direito", slot: "arm", grant: { key: "right_arm" }, hp: { value: 20, max: 20 }, isProsthetic: true, mods: ["Braço de Adamantita"] },
      { id: "p3", name: "Braço Esquerdo", slot: "arm", grant: { key: "left_arm" }, hp: { value: 12, max: 12 }, mods: [] },
      { id: "p4", name: "Cauda", slot: "tail", grant: { key: "tail" }, hp: { value: 12, max: 12 }, mods: ["Ferrão de Aço"] },
      { id: "manual", name: "Implante Neural", slot: "head", grant: null, origin: "", hp: { value: 5, max: 5 }, mods: [] }
    ],
    skills: [
      { id: "s1", name: "Sopro Ígneo", tier: "racial", grant: { key: "sopro_draconico", source: { kind: "species", id: "dragoide" } }, level: 6, xp: 340 },
      { id: "s2", name: "Bola de Fogo", tier: "normal", grant: null, level: 3 },
      { id: "s3", name: "Garra (do item)", tier: "racial", grant: null, itemGranted: true, level: 1 }
    ]
  };
  const diff = speciesDiff(current, tplOf(HUMANO, "humano"));
  const head = diff.parts.update.find(p => p.id === "p1");
  assert.equal(head.hpMax, 10);
  assert.equal(head.hpValue, 5, "Vida atual na proporção (7/14 → 5/10)");
  const arm = [...diff.parts.update, ...diff.parts.keep].find(p => p.id === "p2");
  assert.equal(arm.hpMax, 20, "prótese mantém a própria Vida");
  assert.deepEqual(diff.parts.detach.map(p => p.id), ["p4"], "Cauda com implante fica como parte avulsa");
  assert.equal(diff.parts.remove.length, 0);
  assert.ok(!JSON.stringify(diff).includes('"manual"'), "parte criada à mão nunca entra");
  assert.deepEqual(diff.skills.remove.map(s => s.id), ["s1"]);
  assert.deepEqual(diff.skills.create.map(s => s.key), ["adaptabilidade"]);
  assert.ok(!JSON.stringify(diff.skills).includes('"s2"'), "Skill comprada nunca entra");
  assert.ok(!JSON.stringify(diff.skills).includes('"s3"'), "Skill concedida por Item nunca entra");
  assert.deepEqual(diff.losses, [{ kind: "skill", name: "Sopro Ígneo", level: 6, xp: 340 }]);
});

test("Espécie: dados antigos (sem marca) são reconhecidos e a Skill volta do histórico", () => {
  const legacy = {
    parts: [{ id: "p1", name: "Cabeça", slot: "head", grant: null, origin: "humano", hp: { value: 10, max: 10 }, mods: [] }],
    skills: [{ id: "s1", name: "Adaptabilidade", tier: "racial", grant: null, level: 4, xp: 10 }]
  };
  const same = speciesDiff(legacy, tplOf(HUMANO, "humano"));
  assert.equal(same.skills.keep[0].needsMark, true, "Skill antiga ganha a marca de origem, sem perder nível");
  assert.equal(same.skills.remove.length, 0);
  assert.ok([...same.parts.update, ...same.parts.keep].some(p => p.id === "p1"));

  const back = speciesDiff(
    { parts: [], skills: [], archive: [{ key: "adaptabilidade", source: { kind: "species", id: "humano" }, level: 4, xp: 10 }] },
    tplOf(HUMANO, "humano")
  );
  assert.deepEqual(back.skills.create[0].restored, { level: 4, xp: 10 });
  assert.equal(racialSkillSystem({ name: "X", level: 1, effectType: "bogus" }, { level: 4, xp: 10 }).level, 4);
  assert.equal(racialSkillSystem({ name: "X", effectType: "bogus" }).effectType, "none");
});

test("Espécie: sincronizar só acrescenta e ajusta, a menos que peça para remover", () => {
  const current = {
    parts: [{ id: "p1", name: "Cauda", slot: "tail", grant: { key: "tail" }, hp: { value: 12, max: 12 }, mods: [] }],
    skills: [{ id: "s1", name: "Velha", tier: "racial", grant: { key: "velha", hash: "x" }, level: 2 }]
  };
  const sync = speciesDiff(current, tplOf(HUMANO, "humano"), { mode: "sync" });
  assert.equal(sync.parts.remove.length, 0);
  assert.equal(sync.skills.remove.length, 0);
  assert.equal(sync.parts.create.length, 3);
  const purge = speciesDiff(current, tplOf(HUMANO, "humano"), { mode: "sync", removeMissing: true });
  assert.equal(purge.parts.remove.length, 1);
  assert.equal(purge.skills.remove.length, 1);
});

test("Espécie: trava do jogador", () => {
  assert.equal(isSpeciesLocked({ attributes: { combat: { strength: { points: 0 } } } }), false);
  assert.equal(isSpeciesLocked({ speciesState: { lockedAt: 1 } }), true);
  assert.equal(isSpeciesLocked({ attributes: { combat: { strength: { points: 3 } } } }), true, "ficha antiga com pontos já confirmados");
  assert.equal(isSpeciesLocked({ speciesState: { lockedAt: 1, unlocked: true } }), false, "o Mestre destravou");
});

test("Espécie: ficha antiga sem diferença real não aparece como desatualizada", () => {
  const legacy = {
    parts: [
      { id: "p1", name: "Cabeça", slot: "head", grant: null, origin: "humano", hp: { value: 10, max: 10 }, mods: [] },
      { id: "p2", name: "Braço Esquerdo", slot: "arm", grant: null, origin: "humano", hp: { value: 8, max: 8 }, mods: [] },
      { id: "p3", name: "Braço Direito", slot: "arm", grant: null, origin: "humano", hp: { value: 8, max: 8 }, mods: [] }
    ],
    skills: [{ id: "s1", name: "Adaptabilidade", tier: "racial", grant: null, level: 2 }]
  };
  const sync = speciesDiff(legacy, tplOf(HUMANO, "humano"), { mode: "sync" });
  assert.equal(sync.empty, true);
  assert.equal(sync.parts.keep.length, 3, "as partes ficam (e ganham a marca quando aplicadas)");
  const changed = speciesDiff({ ...legacy, skills: [{ ...legacy.skills[0], grant: { key: "adaptabilidade", hash: "velho" } }] }, tplOf(HUMANO, "humano"), { mode: "sync" });
  assert.equal(changed.skills.update.length, 1, "com hash diferente, a mecânica é atualizada");
});

test("Origem: passivos de Espécie, Linhagem e Herança somam ao vivo", () => {
  const layers = originLayers({
    species: { label: "Ogro", traits: ["organic"], passives: { attributeBonuses: [{ attribute: "strength", amount: 3 }], statModifiers: { hp: 20 }, resistances: [{ target: "poison", amount: 25 }] }, movement: { base: 5, percent: 0 } },
    lineage: { id: "montanha", label: "da Montanha", passives: { attributeBonuses: [{ attribute: "strength", amount: 1 }], resistances: [{ target: "poison", amount: 40 }] }, movement: { percent: -10 }, scale: "vehicle" },
    heritages: [{ id: "vamp", entry: { label: "Vampirizado", traits: ["undead"], removesTraits: ["organic"], elements: ["dark"], passives: { conditionalModifiers: [{ when: { kind: "always" }, then: { kind: "rollFlat", target: "any", value: 1 } }] } } }]
  });
  assert.deepEqual(originAttributeRows(layers, "strength").map(r => [r.label, r.value]), [["Espécie: Ogro", 3], ["Linhagem: da Montanha", 1]]);
  assert.deepEqual(originStatRows(layers, "hp").map(r => r.value), [20]);
  assert.equal(originResistance(layers, "poison"), 0.4, "fica a melhor, como Título");
  assert.equal(originConditionalSources(layers)[0].item.name, "Herança: Vampirizado");
  assert.equal(originScale(layers), "vehicle");
  assert.deepEqual(originMovement(layers), { base: 5, percent: -10 });
  assert.deepEqual(originTraitIdsOf(layers), ["undead"], "Herança tira Orgânico e soma Morto-vivo");
  assert.deepEqual(originLayers({}), []);
});

const CYBORG = {
  id: "ciborgue",
  label: "Convertido em Ciborgue",
  traits: ["mechanical"],
  parts: [
    { key: "cyber_left_arm", label: "Braço Cibernético Esquerdo", slot: "arm", hpMax: 20, prosthetic: true },
    { key: "cyber_right_arm", label: "Braço Cibernético Direito", slot: "arm", hpMax: 20, prosthetic: true }
  ],
  replaces: { slots: ["arm"] },
  excludes: ["mutacao"],
  allowedSpecies: { mode: "except", list: ["androide"] }
};

test("Herança: ganhar troca os braços por próteses (com os implantes) e perder devolve", () => {
  const natural = {
    parts: [
      { id: "h", name: "Cabeça", slot: "head", grant: { key: "head" }, hp: { value: 10, max: 10 }, mods: [] },
      { id: "la", name: "Braço Esquerdo", slot: "arm", grant: { key: "left_arm" }, hp: { value: 4, max: 8 }, mods: [] },
      { id: "ra", name: "Braço Direito", slot: "arm", grant: { key: "right_arm" }, hp: { value: 8, max: 8 }, mods: ["Garra de Osso"] }
    ],
    skills: []
  };
  const withHeritage = resolveSpeciesTemplate({ species: HUMANO, speciesId: "humano", heritages: [{ id: "ciborgue", entry: CYBORG }] });
  const gain = speciesDiff(natural, withHeritage);
  const arms = gain.parts.update.filter(p => p.slot === "arm");
  assert.equal(arms.length, 2, "os braços são transformados, não apagados");
  assert.ok(arms.every(p => p.isProsthetic && p.hpMax === 20 && p.hpValue === 20), "prótese nova, Vida cheia");
  assert.ok(arms.some(p => p.carries.includes("Garra de Osso")), "o implante vai junto");
  assert.equal(gain.parts.remove.length + gain.parts.create.length, 0);

  const cyborg = {
    parts: [
      natural.parts[0],
      { id: "la", name: "Braço Cibernético Esquerdo", slot: "arm", grant: { kind: "heritage", key: "cyber_left_arm" }, isProsthetic: true, hp: { value: 10, max: 20 }, mods: [] },
      { id: "ra", name: "Braço Cibernético Direito", slot: "arm", grant: { kind: "heritage", key: "cyber_right_arm" }, isProsthetic: true, hp: { value: 20, max: 20 }, mods: [] }
    ],
    skills: []
  };
  const lose = speciesDiff(cyborg, resolveSpeciesTemplate({ species: HUMANO, speciesId: "humano" }));
  const back = lose.parts.update.filter(p => p.slot === "arm");
  assert.ok(back.every(p => p.isProsthetic === false && p.hpMax === 8), "voltam a ser braços naturais");
  assert.equal(back.find(p => p.id === "la").hpValue, 4, "Vida na proporção (10/20 → 4/8)");
});

test("Herança: regras de convivência (só avisam)", () => {
  const catalog = [CYBORG, { id: "mutacao", label: "Mutação", excludes: [] }, { id: "abencoado", excludes: ["ciborgue"] }];
  assert.deepEqual(heritageConflicts(CYBORG, { species: "humano", heritages: ["ciborgue"] }, catalog), []);
  assert.deepEqual(heritageConflicts(CYBORG, { species: "androide", heritages: ["ciborgue"] }, catalog), ["species-excluded"]);
  assert.deepEqual(heritageConflicts(CYBORG, { species: "humano", heritages: ["mutacao", "ciborgue"] }, catalog), ["excludes:mutacao"]);
  assert.deepEqual(heritageConflicts(CYBORG, { species: "humano", heritages: ["abencoado", "ciborgue"] }, catalog), ["excludes:abencoado"], "vale nos dois sentidos");
  const only = { id: "x", allowedSpecies: { mode: "only", list: ["elfo"] } };
  assert.deepEqual(heritageConflicts(only, { species: "humano", heritages: [] }, []), ["species-not-allowed"]);
});

test("Evolução: destinos com nível mínimo só como aviso; destino apagado some", () => {
  const slime = normalizeSpeciesEntry({ label: "Slime", evolvesTo: [{ species: "demon_slime", minLevel: 10, hint: "Nomeado", resistancesToImmunity: true }, { species: "metal", minLevel: 15 }, { species: "apagada" }] });
  const catalog = { demon_slime: { label: "Slime Demoníaco" }, metal: { label: "Slime Metálico" } };
  const opts = evolutionOptions(slime, 12, catalog);
  assert.deepEqual(opts.map(o => [o.label, o.ready, o.missing]), [["Slime Demoníaco", true, 0], ["Slime Metálico", false, 3]]);
  assert.equal(opts[0].resistancesToImmunity, true);
  assert.equal(opts[0].keepLineage, true);
});

test("Evolução: Resistências Elementais sobem para Imunidade, a Geral não", () => {
  const ups = evolutionResistanceUpgrades([
    { id: "a", name: "Resistência: Veneno", resistanceTarget: "poison", level: 6 },
    { id: "b", name: "Resistência Geral", resistanceTarget: "general", level: 5 },
    { id: "c", name: "Imunidade: Fogo", resistanceTarget: "fire", level: 10 }
  ]);
  assert.deepEqual(ups.map(u => [u.id, u.toLevel]), [["a", 10]]);
});

test("Evolução: as Skills Raciais antigas ficam, o corpo muda", () => {
  const current = {
    parts: [{ id: "core", name: "Núcleo", slot: "core", grant: { key: "core" }, hp: { value: 30, max: 30 }, mods: [] }],
    skills: [{ id: "s1", name: "Regeneração Amorfa", tier: "racial", grant: { key: "regeneracao_amorfa", hash: "h" }, level: 4, xp: 20 }]
  };
  const diff = speciesDiff(current, tplOf(HUMANO, "humano"), { mode: "evolution" });
  assert.equal(diff.skills.remove.length, 0);
  assert.ok(diff.skills.keep.some(s => s.id === "s1" && s.fromPrevious));
  assert.deepEqual(diff.parts.remove.map(p => p.id), ["core"], "parte sem par e sem implante sai");
  assert.equal(diff.skills.create[0].key, "adaptabilidade");
});

const BODY_FNS = MEU_SISTEMA.DEFAULT_BODY_FUNCTIONS;

const leg = (id, hp, max = 10, extra = {}) => ({ id, name: id, slot: "leg", hpValue: hp, hpMax: max, functions: ["locomocao"], ...extra });

const arm = (id, hp, extra = {}) => ({ id, name: id, slot: "arm", hpValue: hp, hpMax: 8, functions: ["manipulacao"], ...extra });

test("Anatomia: tags antigas viram Funções pelo slot", () => {
  const known = BODY_FNS.map(f => f.id);
  assert.deepEqual(legacyFunctionsFor(["limb"], "arm", known), ["manipulacao"]);
  assert.deepEqual(legacyFunctionsFor(["limb"], "leg", known), ["locomocao"]);
  assert.deepEqual(legacyFunctionsFor(["limb", "flight"], "wing", known), ["voo"]);
  assert.deepEqual(legacyFunctionsFor(["vital"], "head", known).sort(), ["audicao", "visao", "vital"]);
  assert.deepEqual(legacyFunctionsFor(["vital", "regenerative"], "core", known), ["vital"], "regenerative não vira Função (parte não regenera sozinha)");
  assert.deepEqual(legacyFunctionsFor(["mechanical", "chitinous"], "torso", known), []);
  assert.deepEqual(legacyFunctionsFor(["locomocao"], "tail", known), ["locomocao"], "Função conhecida passa direto");
});

test("Anatomia: locomoção proporcional (2 pernas, 4 patas, perna ferida)", () => {
  const two = bodyFunctionState([leg("l", 10), leg("r", 0), arm("a", 8)], BODY_FNS);
  assert.equal(two.movement.factor, 0.5);
  assert.equal(two.movement.crawl, null);
  assert.equal(injuredMovement(9, two.movement), 4);

  const four = bodyFunctionState([leg("1", 10), leg("2", 10), leg("3", 10), leg("4", 0)], BODY_FNS);
  assert.equal(four.movement.factor, 0.75);

  const wounded = bodyFunctionState([leg("l", 10), leg("r", 1.4 * 4, 10)], BODY_FNS);
  assert.ok(Math.abs(wounded.movement.factor - 0.78) < 0.001, "perna a 56% conta como 0,56 perna");
});

test("Anatomia: sem pernas, arrasta 1 m com os braços; sem braços também, fica parado", () => {
  const crawl = bodyFunctionState([leg("l", 0), leg("r", 0), arm("a", 3)], BODY_FNS);
  assert.equal(crawl.movement.crawl, 1);
  assert.equal(injuredMovement(9, crawl.movement), 1);
  const stuck = bodyFunctionState([leg("l", 0), leg("r", 0), arm("a", 0), arm("b", 0)], BODY_FNS);
  assert.equal(injuredMovement(9, stuck.movement), 0);
  const slime = bodyFunctionState([{ id: "core", name: "Núcleo", slot: "core", hpValue: 5, hpMax: 30, functions: ["vital", "regenerativa"] }], BODY_FNS);
  assert.equal(injuredMovement(6, slime.movement), 6, "Espécie sem partes de locomoção não é afetada");
});

test("Anatomia: prótese repõe a Função; implante para com a parte destruída", () => {
  const prosthetic = arm("a", 18, { isProsthetic: true, mods: [{ kind: "prosthesis", functions: ["manipulacao"] }] });
  assert.deepEqual(partFunctions(prosthetic), ["manipulacao"]);
  const legacyProsthesis = arm("b", 5, { isProsthetic: true, mods: [] });
  assert.deepEqual(partFunctions(legacyProsthesis), ["manipulacao"], "prótese antiga mantém as Funções naturais");
  const eye = { id: "h", name: "Cabeça", slot: "head", hpValue: 0, hpMax: 10, functions: ["visao"], mods: [{ kind: "implant", functions: ["audicao"] }] };
  const st = bodyFunctionState([eye], BODY_FNS);
  assert.ok(st.conditions.some(c => c.conditionId === "blindness"));
  assert.ok(st.conditions.some(c => c.conditionId === "deafness"), "o implante numa parte destruída também para");
});

test("Anatomia: Condições por parte × quando todas se perdem, Traço e regeneração", () => {
  const oneHand = bodyFunctionState([arm("a", 0), arm("b", 8)], BODY_FNS);
  assert.deepEqual(oneHand.conditions.map(c => [c.conditionId, c.count]), [["maimed", 1]]);
  const twoHeads = bodyFunctionState(
    [
      { id: "h1", name: "Cabeça 1", slot: "head", hpValue: 0, hpMax: 10, functions: ["visao"] },
      { id: "h2", name: "Cabeça 2", slot: "head", hpValue: 5, hpMax: 10, functions: ["visao"] }
    ],
    BODY_FNS
  );
  assert.equal(twoHeads.conditions.length, 0, "Cego só quando perde todas as cabeças");
  const wing = bodyFunctionState([{ id: "w", name: "Asa", slot: "wing", hpValue: 0, hpMax: 10, functions: ["voo"] }, { id: "w2", name: "Asa 2", slot: "wing", hpValue: 10, hpMax: 10, functions: ["voo"] }], BODY_FNS);
  assert.deepEqual(wing.removedTraits, ["flying"], "uma asa perdida já tira o Voador");
  // Parte não regenera sozinha (quem regenera é Skill/Condição de Regeneração).
  assert.equal(bodyFunctionState([{ id: "m", name: "Massa", slot: "body", hpValue: 20, hpMax: 40, functions: ["regenerativa"] }], BODY_FNS).regen, undefined);
  const vital = bodyFunctionState([{ id: "t", name: "Tronco", slot: "torso", hpValue: 0, hpMax: 20, functions: ["vital"] }], BODY_FNS);
  assert.equal(vital.vitalLost[0].name, "Tronco");
});

test("Anatomia: implante só encaixa no slot certo", () => {
  assert.equal(implantFits({ fitsSlots: ["arm"] }, "arm"), true);
  assert.equal(implantFits({ fitsSlots: ["arm"] }, "head"), false);
  assert.equal(implantFits({ fitsSlots: [] }, "tail"), true, "sem slot marcado: cabe em qualquer parte");
});

test("Evolução: Skill de mesma chave recebe a mecânica nova e mantém o nível", () => {
  const SLIME = { label: "Slime", skills: [{ key: "regen", name: "Regeneração Amorfa", effectType: "none" }] };
  const DEMON = { label: "Slime Demoníaco", skills: [{ key: "regen", name: "Regeneração Demoníaca", effectType: "temporary", effects: [] }] };
  const old = resolveSpeciesTemplate({ species: SLIME, speciesId: "slime" }).skills[0];
  const current = { parts: [], skills: [{ id: "s", name: "Regeneração Amorfa", tier: "racial", grant: { key: "regen", hash: old.hash }, level: 4, xp: 7 }] };
  const diff = speciesDiff(current, resolveSpeciesTemplate({ species: DEMON, speciesId: "slime_demoniaco" }), { mode: "evolution" });
  assert.equal(diff.skills.update.length, 1);
  assert.equal(diff.skills.update[0].name, "Regeneração Demoníaca");
  assert.equal(diff.skills.update[0].level, 4);
});

test("Partes do corpo: Vida em % da Vida máxima, proporção salva e estados", () => {
  const table = { head: 30, arm: 20, default: 20 };
  assert.equal(partHpPercentForSlot("head", table), 30);
  assert.equal(partHpPercentForSlot("antena", table), 20, "slot sem linha usa o padrão");
  assert.equal(partMaxFromPercent(480, 30), 144);
  assert.equal(partMaxFromPercent(1, 5), 1, "nunca menos de 1");
  // A proporção fica: subir de nível (ou ganhar buff de Vida) não fere nem cura a parte.
  const head = { hpPercent: 30, integrity: 124 / 144 };
  assert.deepEqual(resolvePartVitals(head, 480), { max: 144, value: 124, state: "damaged" });
  assert.deepEqual(resolvePartVitals(head, 720), { max: 216, value: 186, state: "damaged" });
  assert.deepEqual(resolvePartVitals({ hpPercent: 20, integrity: 0 }, 480), { max: 96, value: 0, state: "destroyed" });
  assert.deepEqual(resolvePartVitals({ hpPercent: 20, integrity: 1, lost: true }, 480), { max: 96, value: 0, state: "lost" });
  assert.equal(resolvePartVitals({ hpPercent: 35, integrity: 1, lost: true, isProsthetic: true }, 480).state, "intact", "prótese ocupa o lugar do coto");
  // Sem %: a Vida fixa de antes.
  assert.deepEqual(resolvePartVitals({ hpValue: 8, hpMax: 14 }, 480), { max: 14, value: 8, state: "damaged" });
});

test("Partes do corpo: golpe sem mira cai numa parte sorteada pelo tamanho; perdidas não entram", () => {
  const parts = [
    { id: "torso", max: 240, state: "intact" },
    { id: "arm", max: 96, state: "lost" },
    { id: "tail", max: 60, state: "intact" }
  ];
  assert.equal(pickHitPart(parts, () => 0), "torso");
  assert.equal(pickHitPart(parts, () => 0.79), "torso");
  assert.equal(pickHitPart(parts, () => 0.81), "tail");
  assert.equal(pickHitPart([{ id: "a", max: 10, state: "lost" }], () => 0), null);
});

test("Partes do corpo: dano leva a Inutilizada; sobra grande ou Decepar deixa Perdida; prótese só quebra", () => {
  const arm = { value: 96, max: 96 };
  assert.deepEqual(partDamage(arm, 40), { value: 56, lost: false, overflow: 0 });
  assert.deepEqual(partDamage(arm, 120), { value: 0, lost: false, overflow: 24 }, "sobra de 25% < 50%: Inutilizada");
  assert.deepEqual(partDamage(arm, 150), { value: 0, lost: true, overflow: 54 }, "sobra de 56% ≥ 50%: Perdida");
  assert.equal(partDamage(arm, 150, { lossOverflow: 0 }).lost, false, "0 = nunca por sobra");
  assert.equal(partDamage(arm, 96, { sever: true }).lost, true, "Decepar quando chega no 0");
  assert.equal(partDamage(arm, 40, { sever: true }).lost, false, "Decepar sem chegar no 0 só fere");
  assert.equal(partDamage({ value: 0, max: 96 }, 48).lost, true, "inutilizada que leva mais metade da Vida dela cai");
  assert.equal(partDamage({ value: 50, max: 168, isProsthetic: true }, 500, { sever: true }).lost, false, "prótese nunca vira Perdida");
});

test("Partes do corpo: Cura × Regeneração × Reparo — o que a Vida subiu é repartido", () => {
  const parts = [
    { id: "leg", max: 120, value: 60, state: "damaged" },
    { id: "tail", max: 72, value: 0, state: "destroyed" },
    { id: "arm", max: 96, value: 0, state: "lost" },
    { id: "pro", max: 168, value: 100, state: "damaged", isProsthetic: true }
  ];
  const ids = list => list.map(h => h.id);
  // Cura: feridas e inutilizadas, nunca a perdida nem a prótese; proporcional ao que falta (60 + 72).
  const cura = partHealing(parts, 66, { kind: "cura" });
  assert.deepEqual(ids(cura), ["leg", "tail"]);
  assert.equal(cura.reduce((sum, h, i) => sum + h.value - [60, 0][i], 0), 66, "reparte exatamente o que a Vida subiu");
  assert.deepEqual(cura.map(h => h.value), [90, 36], "metade do que falta em cada uma");
  // Um membro só ferido leva tudo (até encher).
  assert.deepEqual(partHealing([{ id: "leg", max: 120, value: 60, state: "damaged" }], 500, { kind: "cura" }), [{ id: "leg", value: 120, regrow: false }]);
  // Focada: enche primeiro; o resto vai proporcional.
  const focused = partHealing(parts, 80, { kind: "cura", focusId: "tail" });
  assert.deepEqual(focused.map(h => [h.id, h.value]), [["leg", 68], ["tail", 72]]);
  const regen = partHealing(parts, 24, { kind: "regeneracao", focusId: "arm" });
  assert.deepEqual(regen, [{ id: "arm", value: 24, regrow: true }], "a perdida volta a crescer");
  assert.ok(ids(partHealing(parts, 500, { kind: "regeneracao", repairsProsthesis: true })).includes("pro"), "Regeneração de Skill Única conserta prótese");
  assert.deepEqual(partHealing(parts, 50, { kind: "regeneracao", blocked: true }), [], "bloqueada (Fogo, Ácido, Maldição)");
  assert.deepEqual(ids(partHealing(parts, 50, { kind: "reparo" })), ["pro"], "Reparo: só prótese");
});

test("Partes do corpo: parte a 0% que a cura não conserta bloqueia o % dela na Vida", () => {
  const arm = { id: "arm", max: 96, value: 0, state: "lost", share: 20 };
  const leg = { id: "leg", max: 120, value: 68, state: "damaged", share: 25 };
  assert.equal(healCap([arm, leg], 480, "cura"), 0.8, "Cura não refaz a perdida");
  assert.equal(healCap([arm, leg], 480, "regeneracao"), 1, "Regeneração refaz");
  assert.equal(healCap([{ ...arm, state: "destroyed" }, leg], 480, "cura"), 1, "Cura conserta a inutilizada");
  assert.equal(healCap([{ ...arm, state: "destroyed" }, leg], 480, "descanso"), 0.8, "Descanso não conserta nada a 0%");
});

test("Descanso: Curto/Completo, partes a 0% limitam a Vida, ferida recebe o que a Vida subiu", () => {
  const parts = [
    { id: "arm", max: 96, value: 0, state: "lost", share: 20 },
    { id: "leg", max: 120, value: 68, state: "damaged", share: 25 }
  ];
  const short = restOutcome({ hp: { value: 330, max: 480 }, energy: { value: 40, max: 240 }, parts, kind: "short", injury: true });
  assert.equal(short.hp, 384, "+120 daria 450; o braço perdido segura em 80%");
  assert.equal(short.energy, 160, "+50% de Mana");
  assert.deepEqual(short.healedParts, [{ id: "leg", value: 120, regrow: false }], "subiu 54; a perna só precisava de 52");
  const long = restOutcome({ hp: { value: 100, max: 480 }, energy: { value: 0, max: 240 }, parts, kind: "long", injury: true });
  assert.equal(long.hp, 384);
  assert.equal(long.energy, 240);
  const plain = restOutcome({ hp: { value: 100, max: 480 }, energy: { value: 0, max: 240 }, kind: "long" });
  assert.equal(plain.hp, 480, "sem Ferimentos por parte: enche como sempre");
  const above = restOutcome({ hp: { value: 420, max: 480 }, energy: { value: 0, max: 240 }, parts, kind: "short", injury: true });
  assert.equal(above.hp, 420, "descanso nunca tira Vida");
});

test("Espécie: parte com % — sincronizar troca a Vida fixa por % e mantém a proporção", () => {
  const species = { label: "Humano", parts: [{ key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 12, hpPercent: 20 }] };
  const tpl = resolveSpeciesTemplate({ species, speciesId: "humano" });
  assert.equal(tpl.parts[0].hpPercent, 20);
  const current = { parts: [{ id: "p", name: "Braço Esquerdo", slot: "arm", grant: { kind: "species", id: "humano", key: "left_arm" }, hp: { value: 6, max: 12 }, hpPercent: 0, mods: [] }], skills: [] };
  const diff = speciesDiff(current, tpl, { mode: "sync" });
  assert.equal(diff.parts.update.length, 1, "Vida fixa → % é uma mudança");
  assert.equal(diff.parts.update[0].hpPercent, 20);
  assert.equal(diff.parts.update[0].integrity, 0.5, "a proporção da parte segue");
  const same = speciesDiff({ parts: [{ ...current.parts[0], hpPercent: 20, integrity: 0.5, hp: { value: 48, max: 96 } }], skills: [] }, tpl, { mode: "sync" });
  assert.equal(same.parts.update.length, 0, "com o mesmo %, o número calculado não conta como mudança");
});

test("Cura: bloqueio preso numa parte e Cura de nível alto refazendo a perdida", () => {
  const parts = [
    { id: "leg", max: 120, value: 60, state: "damaged" },
    { id: "arm", max: 96, value: 0, state: "lost" }
  ];
  const blocked = partHealing(parts, 60, { kind: "cura", partFactor: { leg: 0.5 } });
  assert.deepEqual(blocked, [{ id: "leg", value: 90, regrow: false }].map(h => ({ ...h, value: 60 + Math.floor(60 * 0.5) })), "a parte amaldiçoada recebe só a fração que passa");
  assert.deepEqual(partHealing(parts, 60, { kind: "cura", partFactor: { leg: 0 } }), [], "totalmente bloqueada: fora da partilha");
  const regrow = partHealing(parts, 200, { kind: "cura", regrowLost: true });
  assert.ok(regrow.some(h => h.id === "arm" && h.regrow), "Cura nível 10+ refaz a perdida");
  const rest = restOutcome({ hp: { value: 100, max: 480 }, energy: { value: 0, max: 240 }, kind: "long", bodyFactor: 0 });
  assert.equal(rest.hp, 100, "maldição de toda cura no corpo segura o Descanso");
  assert.equal(rest.energy, 240, "a energia volta mesmo assim");
});

test("Partes do corpo: o que cada tipo de cura consegue consertar", () => {
  const ferida = { id: "a", max: 10, value: 4, state: "damaged" };
  const inutil = { id: "b", max: 10, value: 0, state: "destroyed" };
  const perdida = { id: "c", max: 10, value: 7, state: "lost" };
  const protese = { id: "d", max: 10, value: 3, state: "damaged", isProsthetic: true };
  const inteira = { id: "e", max: 10, value: 10, state: "intact" };

  // Descanso: só a natural ferida acima de 0%.
  assert.deepEqual([ferida, inutil, perdida, protese].map(p => partHealable(p, "descanso")), [true, false, false, false]);
  // Cura: ferida e inutilizada; perdida só com cura de nível alto (regrowLost).
  assert.deepEqual([ferida, inutil, perdida, protese].map(p => partHealable(p, "cura")), [true, true, false, false]);
  assert.equal(partHealable(perdida, "cura", { regrowLost: true }), true);
  // Regeneração: naturais, inclusive perdidas; prótese só com repairsProsthesis.
  assert.deepEqual([ferida, inutil, perdida, protese].map(p => partHealable(p, "regeneracao")), [true, true, true, false]);
  assert.equal(partHealable(protese, "regeneracao", { repairsProsthesis: true }), true);
  // Reparo: só prótese.
  assert.deepEqual([ferida, inutil, perdida, protese].map(p => partHealable(p, "reparo")), [false, false, false, true]);

  assert.equal(partHealable(inteira, "cura"), false, "parte cheia não precisa de cura");
  assert.equal(partHealable(perdida, "regeneracao"), true, "perdida conta como 0 mesmo com valor salvo");
  assert.equal(partHealable({ id: "f", max: 0, value: 0 }, "cura"), false, "sem Vida máxima não cura");
  assert.equal(partHealable(ferida, "cura", { partFactor: { a: 0 } }), false, "cura bloqueada na parte");
  assert.equal(partHealable(ferida, "cura", { partFactor: { a: 0.5 } }), true, "bloqueio parcial ainda deixa curar");
  assert.equal(partHealable(ferida), true, "tipo padrão é cura");
});

test("Espécie: catálogo inteiro normalizado, com as mesmas chaves e os padrões do rework", () => {
  const out = normalizeSpeciesCatalog({
    elfo: { label: "Elfo", skills: [{ name: "Visão Élfica" }, { name: "Visão Élfica" }], parts: [{ label: "Braço Esquerdo", slot: "arm" }] },
    vazio: {}
  });
  assert.deepEqual(Object.keys(out), ["elfo", "vazio"]);
  assert.equal(out.elfo.version, 1);
  assert.deepEqual(out.elfo.skills.map(s => s.key), ["visao_elfica", "visao_elfica_2"], "nome repetido ganha chave única");
  assert.equal(out.elfo.parts[0].key, "braco_esquerdo");
  assert.deepEqual(out.vazio.traits, []);
  assert.deepEqual(out.vazio.lineages, []);
  assert.deepEqual(out.vazio.passives, {});
  assert.equal(out.vazio.label, "");
  assert.deepEqual(normalizeSpeciesCatalog(null), {}, "sem catálogo devolve vazio");
});

test("Espécie: impressão digital só muda com o que é copiado para a ficha", () => {
  const base = {
    label: "Dragoide", traits: ["draconic"], elements: ["fire"],
    parts: [{ key: "cabeca", label: "Cabeça", slot: "head", hpMax: 20 }],
    skills: [{ key: "sopro", name: "Sopro", effectType: "damage", damageFormula: "2d6" }]
  };
  const fp = speciesContentFingerprint(base);
  assert.equal(speciesContentFingerprint({ ...base, label: "Draconato", traits: [], elements: [] }), fp, "nome, Traços e elementos são lidos ao vivo — não contam");
  assert.notEqual(speciesContentFingerprint({ ...base, parts: [{ ...base.parts[0], hpMax: 30 }] }), fp, "Vida da parte conta");
  assert.notEqual(speciesContentFingerprint({ ...base, skills: [{ ...base.skills[0], damageFormula: "3d6" }] }), fp, "mecânica da Skill Racial conta");
  assert.equal(speciesContentFingerprint({ ...base, skills: [{ ...base.skills[0], level: 5, xp: 40 }] }), fp, "nível e XP não contam");
  assert.notEqual(speciesContentFingerprint({ ...base, skills: [{ ...base.skills[0], unlockLevel: 10 }] }), fp, "nível de liberação conta");
  assert.notEqual(speciesContentFingerprint({ ...base, lineages: [{ id: "antigo" }] }), fp, "Linhagens contam");
  assert.equal(typeof speciesContentFingerprint({}), "string");
});

test("Espécie: hash da Skill Racial ignora estado e ordem das chaves", () => {
  const skill = { name: "Sopro", effectType: "damage", damageFormula: "2d6", cost: 10 };
  const h = skillDataHash(skill);
  assert.match(h, /^2-[0-9a-z]+$/, "hash da versão 2 leva o prefixo");
  assert.equal(skillDataHash({ cost: 10, damageFormula: "2d6", effectType: "damage", name: "Sopro" }), h, "ordem das chaves não importa");
  assert.equal(skillDataHash({ ...skill, key: "x", level: 9, xp: 99, active: true, unlockLevel: 5 }), h, "chave, nível, XP, ligada e liberação ficam de fora");
  assert.notEqual(skillDataHash({ ...skill, damageFormula: "3d6" }), h);
  assert.notEqual(skillDataHash({ ...skill, cost: 11 }), h);
  assert.equal(skillDataHash(null), skillDataHash({}), "nulo não quebra");
});

test("Espécie: hash da Skill Racial enxerga o que é aninhado (efeitos, área)", () => {
  const skill = { name: "Fúria", effectType: "temporary", effects: [{ target: "strength", amount: 2, durationRounds: 3 }] };
  const h = skillDataHash(skill);
  assert.notEqual(skillDataHash({ ...skill, effects: [{ target: "strength", amount: 5, durationRounds: 3 }] }), h, "mudar o valor de um efeito muda o hash");
  assert.equal(skillDataHash({ effects: [{ durationRounds: 3, amount: 2, target: "strength" }], effectType: "temporary", name: "Fúria" }), h, "ordem das chaves aninhadas não importa");
});

test("Espécie: marca antiga (hash de antes da 1.78) continua reconhecida", () => {
  const skill = { name: "Sopro", effectType: "damage", damageFormula: "2d6", effects: [{ amount: 1 }] };
  assert.equal(skillHashMatches(skillDataHash(skill), skill), true, "marca nova bate");
  assert.equal(skillHashMatches(skillDataHash({ ...skill, damageFormula: "3d6" }), skill), false);
  // O hash antigo só via o topo da Skill: a marca antiga de uma Skill igual tem que bater, senão
  // trocar a fórmula do hash marcaria todas as fichas como "Espécie mudou" de uma vez.
  const legacy = (() => {
    const { key, level, xp, active, unlockLevel, ...rest } = skill;
    const json = JSON.stringify(rest, Object.keys(rest).sort());
    let hash = 0;
    for (let i = 0; i < json.length; i++) hash = (Math.imul(31, hash) + json.charCodeAt(i)) | 0;
    return (hash >>> 0).toString(36);
  })();
  assert.equal(skillHashMatches(legacy, skill), true, "marca antiga de Skill igual bate");
  assert.equal(skillHashMatches(legacy, { ...skill, damageFormula: "3d6" }), false, "marca antiga ainda vê o topo");
  assert.equal(skillHashMatches("", skill), false, "sem marca não bate");
  assert.equal(skillHashMatches(undefined, skill), false);
});
