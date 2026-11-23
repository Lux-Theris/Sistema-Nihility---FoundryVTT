/**
 * Reações elementais (item 8.1b) e "Só se…" (8.1a): as regras puras. Critério e como rodar: ver
 * o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeReaction,
  normalizeReactions,
  reactionFactor,
  findReaction,
  idsWithAncestors,
  carriedMarks,
  bodyCarried,
  pickReaction,
  pickedFactor,
  affinityElementsExcluding,
  spreadTargets,
  spreadCarriesDamage,
  reactionTag,
  reactionSentence,
  permanentMarkSources,
  timedConditionIds,
  shipReactionAverage,
  mergeReactionDefaults
} from "../module/combat/reaction-rules.js";
import { resolveDamageParts, describeDamageParts, elementVsDefender, buildAffinityMatrix } from "../module/combat/damage-rules.js";
import { matchesWhen, WHEN_KINDS } from "../module/combat/conditional-modifiers.js";
import { normalizeOnlyIf, hasOnlyIf, onlyIfOutcome, onlyIfClause, onlyIfNeeds, ONLY_IF_KINDS, ONLY_IF_COST_FACTOR } from "../module/skills/only-if-rules.js";
import { lintSkill } from "../module/skills/skill-lint-rules.js";
import { suggestSkillCost } from "../module/skills/skill-cost-rules.js";
import { skillSummary } from "../module/skills/skill-summary.js";
import { sanitizeOnlyIf, sanitizeSkillMechanics } from "../module/ai/ai-mechanics.js";
import { checkMechanic, buildCatalogIndex, validateCatalogs } from "../module/world/world-validator.js";
import { NIHILITY, DEFAULT_ELEMENT_REACTIONS, REACTION_ELEMENTS, REACTION_CONDITIONS } from "../module/core/config.js";

const ELEMENTS = NIHILITY.DEFAULT_DAMAGE_ELEMENTS;
const CONDITIONS = NIHILITY.DEFAULT_STATUS_CONDITIONS;
const chainOf = id => [ELEMENTS.find(e => e.id === id)].map(e => ({ id: e.id, reactions: normalizeReactions(e.reactions) }));
const CONFIG = { immune: 0, ineffective: 0.5, effective: 1.5, superEffective: 2 };

/* ------------------------------------------------------------------ normalizar */

test("Reação: normaliza, limita e recusa o vazio", () => {
  assert.equal(normalizeReaction(null), null);
  assert.equal(normalizeReaction({}), null);
  assert.equal(normalizeReaction({ damagePercent: 0 }), null);
  const r = normalizeReaction({ label: " Vapor ", damagePercent: -250, spread: { radius: 2.04 }, applyCondition: { conditionId: "blindness", rounds: -3 } });
  assert.equal(r.label, "Vapor");
  assert.equal(r.damagePercent, -100); // nunca abaixo de −100
  assert.deepEqual(r.spread, { radius: 2, sameElement: true });
  assert.deepEqual(r.applyCondition, { conditionId: "blindness", rounds: 0 });
  assert.equal(r.consume, true); // padrão: consome
  assert.equal(r.bodyConducts, false);
  assert.deepEqual(r.against, { character: true, ship: false, structure: false });
  // Sem nome mas com efeito: ganha um nome genérico.
  assert.equal(normalizeReaction({ damagePercent: 20 }).label, "Reação");
  // Só o nome basta (uma reação "cosmética" que só consome).
  assert.equal(normalizeReaction({ label: "Apagar" }).damagePercent, 0);
  // Raio 0 não é espalhar.
  assert.equal(normalizeReaction({ label: "x", spread: { radius: 0 } }).spread, null);
  assert.equal(normalizeReaction({ label: "x", consume: false }).consume, false);
});

test("Reações: a tabela só guarda as válidas", () => {
  const table = normalizeReactions({ water: { label: "A", damagePercent: 10 }, "": { label: "B" }, ice: null, oil: {} });
  assert.deepEqual(Object.keys(table), ["water"]);
  assert.deepEqual(normalizeReactions(null), {});
  assert.deepEqual(normalizeReactions([1, 2]), {});
});

test("Reação: o fator é 1 + o percentual", () => {
  assert.equal(reactionFactor({ damagePercent: 50 }), 1.5);
  assert.equal(reactionFactor({ damagePercent: -50 }), 0.5);
  assert.equal(reactionFactor({ damagePercent: -100 }), 0);
  assert.equal(reactionFactor(null), 1);
});

/* ------------------------------------------------------------------ achar a reação */

test("Reação: o elemento do golpe herda a do pai e o carregado casa com os ancestrais", () => {
  const elements = [{ id: "physical" }, { id: "slashing", parent: "physical" }, { id: "wet" }];
  assert.deepEqual(idsWithAncestors("slashing", elements), ["slashing", "physical"]);
  const chain = [
    { id: "slashing", reactions: {} },
    { id: "physical", reactions: { wet: { label: "Escorrega" } } }
  ];
  const found = findReaction(chain, ["wet"]);
  assert.equal(found.hitElementId, "physical");
  assert.equal(found.reaction.label, "Escorrega");
  // O próprio vence o do pai.
  chain[0].reactions = { wet: { label: "Corta molhado" } };
  assert.equal(findReaction(chain, ["wet"]).reaction.label, "Corta molhado");
  assert.equal(findReaction(chain, ["fire"]), null);
});

test("Marcas: Condição com Elemento do corpo, a mais recente primeiro, desligada não vale", () => {
  const conditions = [{ id: "wet", elements: ["water"] }, { id: "burn", elements: ["fire"] }, { id: "stun" }];
  const effects = [
    { effectId: "a", statuses: ["wet"], order: 10 },
    { effectId: "b", statuses: ["burn"], order: 30 },
    { effectId: "c", statuses: ["stun"], order: 40 },
    { effectId: "d", statuses: ["wet"], order: 99, disabled: true },
    { effectId: "e", conditionId: "wet", order: 20 }
  ];
  const marks = carriedMarks(effects, conditions, ELEMENTS);
  assert.deepEqual(marks.map(m => m.effectId), ["b", "e", "a"]);
  assert.deepEqual(marks.map(m => m.elementId), ["fire", "water", "water"]);
  // O chão (8.2) entra primeiro e não tem efeito para consumir.
  const withGround = carriedMarks(effects, conditions, ELEMENTS, ["oil"]);
  assert.equal(withGround[0].surface, true);
  assert.equal(withGround[0].effectId, "");
});

test("Reação: uma por parte, a da marca mais recente; o corpo só conduz", () => {
  const lightning = chainOf("lightning");
  const wet = { elementId: "water", ids: ["water"], effectId: "w", surface: false, order: 5 };
  const other = { elementId: "ice", ids: ["ice"], effectId: "i", surface: false, order: 9 };
  // Elétrico contra Molhado: Eletrocutado.
  const picked = pickReaction({ chain: lightning, marks: [other, wet] });
  assert.equal(picked.source, "mark");
  assert.equal(picked.reaction.label, "Eletrocutado");
  assert.equal(picked.mark.effectId, "w");
  assert.equal(pickedFactor(picked), 1.5);
  // Contra o corpo de Água (sem marca): Eletrocutado conduz, mas sem multiplicar.
  const body = pickReaction({ chain: lightning, marks: [], body: bodyCarried(["water"], ELEMENTS) });
  assert.equal(body.source, "body");
  assert.equal(pickedFactor(body), 1);
  // Reação sem "o corpo conduz": o corpo não dispara nada.
  const fire = chainOf("fire");
  assert.equal(pickReaction({ chain: fire, body: bodyCarried(["oil"], ELEMENTS) }), null);
  // Fogo contra Gelo pelo corpo: Derretimento conduz (de fábrica), sem fator.
  assert.equal(pickReaction({ chain: fire, body: bodyCarried(["ice"], ELEMENTS) }).source, "body");
  // Vale só onde `against` deixa: Nave não reage por padrão.
  assert.equal(pickReaction({ chain: lightning, marks: [wet], kind: "ship" }), null);
  // Elemento sem tabela não reage.
  assert.equal(pickReaction({ chain: chainOf("acid"), marks: [wet] }), null);
});

test("Reação: o chão reage como marca mas não é consumido", () => {
  const fire = chainOf("fire");
  const ground = carriedMarks([], [], ELEMENTS, ["oil"]);
  const picked = pickReaction({ chain: fire, marks: ground });
  assert.equal(picked.source, "surface");
  assert.equal(picked.reaction.label, "Explosão");
  assert.equal(pickedFactor(picked), 2);
});

/* ------------------------------------------------------------------ a conta do dano */

test("Dano: a reação multiplica a parte antes de Defesa Mágica e Resistência, e imune continua imune", () => {
  const base = resolveDamageParts({ parts: [{ elementId: "lightning", raw: 100 }], magicDefense: 0.2, general: 0.1 });
  const reacted = resolveDamageParts({ parts: [{ elementId: "lightning", raw: 100, reaction: { factor: 1.5, label: "Eletrocutado" } }], magicDefense: 0.2, general: 0.1 });
  // 100 × 1,5 × 0,8 × 0,9 = 108 (as defesas valem sobre o já ampliado)
  assert.equal(reacted.final, 108);
  assert.equal(base.final, 72);
  assert.equal(reacted.parts[0].applied.reaction.label, "Eletrocutado");
  // Imune ao elemento: 0, com ou sem reação.
  const immune = resolveDamageParts({ parts: [{ elementId: "lightning", raw: 100, reaction: { factor: 2, label: "x" } }], resistanceFor: () => 1 });
  assert.equal(immune.final, 0);
  // Dano Absoluto não reage.
  const absolute = resolveDamageParts({ parts: [{ elementId: "lightning", raw: 100, reaction: { factor: 2, label: "x" } }], absolute: true });
  assert.equal(absolute.final, 100);
  // Fator 0 (−100%) zera só aquela parte.
  const two = resolveDamageParts({ parts: [{ elementId: "fire", raw: 50, reaction: { factor: 0, label: "Apaga" } }, { elementId: "ice", raw: 50 }] });
  assert.equal(two.final, 50);
});

test("Dano: o rastro do Mestre mostra a reação", () => {
  const result = resolveDamageParts({ parts: [{ elementId: "lightning", raw: 40, reaction: { factor: 1.5, label: "Eletrocutado" } }] });
  const rows = describeDamageParts(result.parts, { elementLabel: id => id });
  const row = rows.find(r => r.label.includes("Eletrocutado"));
  assert.ok(row);
  assert.equal(row.value, "×1.5");
  // Sem reação, sem linha.
  assert.ok(!describeDamageParts(resolveDamageParts({ parts: [{ elementId: "fire", raw: 10 }] }).parts).some(r => r.label.startsWith("Reação")));
});

test("Vantagem da Tabela: a da própria marca que reagiu não conta (Golem de Gelo × Fogo)", () => {
  const matrix = buildAffinityMatrix(ELEMENTS);
  // Alvo com a marca de Gelo (Lentidão) e o corpo de Gelo da Espécie: duas fontes do mesmo elemento.
  const mark = { elementId: "ice", effectId: "slow-1", surface: false };
  // Sem exclusão: Fogo × Gelo = Efetivo (×1,5) — e Derretimento viria por cima.
  assert.equal(elementVsDefender("fire", ["ice"], matrix, CONFIG), 1.5);
  // Reagiu pela marca: tira só a marca; o corpo (Espécie) continua valendo.
  assert.deepEqual(affinityElementsExcluding([], [mark], mark), []);
  assert.equal(elementVsDefender("fire", affinityElementsExcluding([], [mark], mark), matrix, CONFIG), 1);
  assert.deepEqual(affinityElementsExcluding(["ice"], [mark], mark), ["ice"]);
  // As outras marcas continuam.
  const other = { elementId: "water", effectId: "w", surface: false };
  assert.deepEqual(affinityElementsExcluding([], [mark, other], mark), ["water"]);
});

/* ------------------------------------------------------------------ espalhar */

test("Espalhar: Personagens vivos no raio, só quem carrega o mesmo elemento quando pede", () => {
  const list = [
    { uuid: "a", distance: 1.5, carries: ["water"] },
    { uuid: "b", distance: 2, carries: ["fire"] },
    { uuid: "c", distance: 2.5, carries: ["water"] },
    { uuid: "d", distance: 1, carries: ["water"], dead: true },
    { uuid: "e", distance: null, carries: ["water"] }
  ];
  assert.deepEqual(spreadTargets(list, { radius: 2, sameElement: true }, "water").map(t => t.uuid), ["a"]);
  // Sem "mesmo elemento": qualquer um no raio (só a Condição vai).
  assert.deepEqual(spreadTargets(list, { radius: 2, sameElement: false }, "water").map(t => t.uuid), ["a", "b"]);
  assert.deepEqual(spreadTargets(list, null, "water"), []);
  assert.equal(spreadCarriesDamage({ spread: { radius: 2, sameElement: true } }), true);
  assert.equal(spreadCarriesDamage({ spread: { radius: 2, sameElement: false } }), false);
  assert.equal(spreadCarriesDamage({}), false);
});

/* ------------------------------------------------------------------ texto e avisos */

test("Reação: etiqueta da célula e frase 'Na mesa'", () => {
  const r = normalizeReaction(DEFAULT_ELEMENT_REACTIONS.lightning.water);
  assert.equal(reactionTag(r), "×1,5 · conduz");
  assert.equal(reactionTag(null), "");
  assert.equal(reactionTag(normalizeReaction({ label: "Apagar", removeCondition: "burn" })), "tira");
  assert.equal(reactionTag(normalizeReaction({ label: "Congelar", applyCondition: { conditionId: "slow", rounds: 1 } })), "aplica");
  const text = reactionSentence("lightning", "water", r, { element: id => ({ lightning: "Elétrico", water: "Água" })[id] ?? id });
  assert.match(text, /Eletrocutado: Elétrico em quem carrega Água/);
  assert.match(text, /sobe 50%/);
  assert.match(text, /2 m/);
  assert.match(text, /consumida/);
  assert.match(text, /o corpo também conduz/);
  assert.equal(reactionSentence("a", "b", null), "");
});

test("Aviso: marca sem duração numa reação que consome", () => {
  const conditions = [
    { id: "wet", label: "Molhado", elements: ["water"] },
    { id: "drenched", label: "Encharcado", elements: ["water"], effect: { kind: "modifier", durationRounds: 3 } },
    { id: "burn", label: "Queimadura", elements: ["fire"] }
  ];
  // Molhado só tem duração se algum elemento o aplica com rodadas.
  assert.deepEqual(permanentMarkSources("water", conditions, new Set()), ["Molhado"]);
  assert.deepEqual(permanentMarkSources("water", conditions, new Set(["wet"])), []);
  const timed = timedConditionIds(ELEMENTS);
  assert.ok(timed.has("wet"), "Água aplica Molhado por 2 rodadas");
  assert.ok(timed.has("oiled"));
  assert.ok(timed.has("slow") && timed.has("blindness"), "as reações de fábrica também dão duração");
});

/* ------------------------------------------------------------------ Nave */

test("Nave: a reação vale no Escudo, em média das partes, sem consumo", () => {
  const fire = chainOf("fire");
  const lightning = chainOf("lightning");
  const shield = [{ elementId: "oil", ids: ["oil"] }];
  // Reação contra Nave desligada por padrão: nada muda.
  assert.deepEqual(shipReactionAverage([fire], [], shield), { factor: 1, drain: 0, labels: [] });
  const tuned = [{ id: "fire", reactions: { oil: normalizeReaction({ label: "Sobrecarga", damagePercent: 100, shieldDrain: 20, against: { ship: true } }) } }];
  const one = shipReactionAverage([tuned], [], shield);
  assert.equal(one.factor, 2);
  assert.ok(Math.abs(one.drain - 0.2) < 1e-9);
  assert.deepEqual(one.labels, ["Sobrecarga"]);
  // Golpe de dois elementos (partes iguais): a média das duas partes.
  const avg = shipReactionAverage([tuned, lightning], [], shield);
  assert.equal(avg.factor, 1.5);
  assert.deepEqual(shipReactionAverage([], [], shield), { factor: 1, drain: 0, labels: [] });
});

/* ------------------------------------------------------------------ conteúdo de fábrica */

test("Fábrica: Água, Óleo, Molhado e Oleado existem e as reações apontam para ids que existem", () => {
  const elementIds = new Set(ELEMENTS.map(e => e.id));
  const conditionIds = new Set(CONDITIONS.map(c => c.id));
  assert.ok(elementIds.has("water") && elementIds.has("oil"));
  assert.ok(conditionIds.has("wet") && conditionIds.has("oiled"));
  assert.deepEqual(CONDITIONS.find(c => c.id === "wet").elements, ["water"]);
  assert.deepEqual(CONDITIONS.find(c => c.id === "oiled").elements, ["oil"]);
  assert.deepEqual(CONDITIONS.find(c => c.id === "burn").elements, ["fire"]);
  assert.deepEqual(CONDITIONS.find(c => c.id === "slow").elements, ["ice"]);
  for (const element of ELEMENTS) {
    for (const [carried, reaction] of Object.entries(normalizeReactions(element.reactions))) {
      assert.ok(elementIds.has(carried), `${element.id}: carrega ${carried}`);
      if (reaction.applyCondition) assert.ok(conditionIds.has(reaction.applyCondition.conditionId), `${element.id}: aplica`);
      if (reaction.removeCondition) assert.ok(conditionIds.has(reaction.removeCondition), `${element.id}: tira`);
      if (reaction.leaveSurface) assert.ok(elementIds.has(reaction.leaveSurface), `${element.id}: deixa`);
    }
  }
  // As seis de fábrica pedidas pelo dono.
  const labels = new Set(ELEMENTS.flatMap(e => Object.values(e.reactions ?? {}).map(r => r.label)));
  for (const name of ["Derretimento", "Apagar", "Eletrocutado", "Explosão", "Vapor", "Congelar"]) assert.ok(labels.has(name), name);
  // Marcado "o corpo conduz" só em Eletrocutado, Derretimento e Vapor.
  const conducting = new Set(ELEMENTS.flatMap(e => Object.values(e.reactions ?? {}).filter(r => r.bodyConducts).map(r => r.label)));
  assert.deepEqual([...conducting].sort(), ["Derretimento", "Eletrocutado", "Vapor"]);
  // Água e Óleo aplicam a própria marca ao acertar, com duração (a marca não fica para sempre).
  for (const [id, cond] of [["water", "wet"], ["oil", "oiled"]]) {
    const effect = ELEMENTS.find(e => e.id === id).effects.find(e => e.type === "condition");
    assert.equal(effect.conditionId, cond);
    assert.ok(effect.rounds > 0);
  }
});

test("Migração reactionsDefaults: só acrescenta o que falta e nunca sobrescreve", () => {
  const saved = [
    { id: "fire", label: "Fogo Meu", effects: [] },
    { id: "ice", label: "Gelo", effects: [], reactions: { fire: { label: "Minha" } } },
    { id: "lightning", label: "Elétrico", effects: [], reactions: {} }
  ];
  const savedConditions = [{ id: "burn", label: "Queimadura" }, { id: "slow", label: "Lentidão", elements: ["ice", "water"] }];
  const out = mergeReactionDefaults(saved, savedConditions, {
    reactions: DEFAULT_ELEMENT_REACTIONS,
    elements: REACTION_ELEMENTS,
    conditions: [...REACTION_CONDITIONS.map(c => ({ ...c, addIfMissing: true })), ...CONDITIONS.filter(c => ["burn", "slow"].includes(c.id))]
  });
  assert.ok(out.elementsChanged && out.conditionsChanged);
  assert.equal(out.elements.find(e => e.id === "fire").label, "Fogo Meu"); // nome editado fica
  assert.equal(out.elements.find(e => e.id === "fire").reactions.ice.label, "Derretimento"); // ganhou as de fábrica
  assert.equal(out.elements.find(e => e.id === "ice").reactions.fire.label, "Minha"); // editada fica
  assert.deepEqual(out.elements.find(e => e.id === "lightning").reactions, {}); // vazia de propósito fica vazia
  assert.ok(out.elements.some(e => e.id === "water") && out.elements.some(e => e.id === "oil"));
  assert.ok(out.conditions.some(c => c.id === "wet") && out.conditions.some(c => c.id === "oiled"));
  assert.ok(!("addIfMissing" in out.conditions.find(c => c.id === "wet")), "a marca interna não vai para o catálogo");
  assert.deepEqual(out.conditions.find(c => c.id === "burn").elements, ["fire"]);
  assert.deepEqual(out.conditions.find(c => c.id === "slow").elements, ["ice", "water"]); // editado fica
  // Segunda passada: nada a mudar.
  const again = mergeReactionDefaults(out.elements, out.conditions, { reactions: DEFAULT_ELEMENT_REACTIONS, elements: REACTION_ELEMENTS, conditions: out.conditions.map(c => ({ ...c, addIfMissing: true })) });
  assert.equal(again.elementsChanged, false);
  assert.equal(again.conditionsChanged, false);
  // O original não é alterado.
  assert.equal(saved[0].reactions, undefined);
});

test("Validar Mundo: reação apontando para o que sumiu", () => {
  const catalogs = {
    elements: [
      { id: "fire", label: "Fogo", effects: [], reactions: { water: { label: "Vapor", applyCondition: { conditionId: "sumiu", rounds: 1 }, removeCondition: "burn", leaveSurface: "lava" } } }
    ],
    conditions: [{ id: "burn", label: "Queimadura" }]
  };
  const issues = validateCatalogs(catalogs, buildCatalogIndex(catalogs));
  const text = issues.map(i => `${i.where}: ${i.message}`).join("\n");
  assert.match(text, /elemento carregado.*"water"/);
  assert.match(text, /aplica Condição.*"sumiu"/);
  assert.match(text, /deixa no chão.*"lava"/);
  assert.doesNotMatch(text, /tira Condição/);
});

/* ------------------------------------------------------------------ "Só se…" */

test("Só se…: normaliza e só aceita os tipos do menu", () => {
  assert.equal(normalizeOnlyIf(null), null);
  assert.equal(normalizeOnlyIf({ kind: "" }), null);
  assert.equal(normalizeOnlyIf({ kind: "element", value: "fire" }), null); // "O dano é do elemento" não é do menu de efeito
  assert.deepEqual(normalizeOnlyIf({ kind: "otherCondition", value: " wet " }), { kind: "otherCondition", value: "wet", threshold: 50 });
  assert.deepEqual(normalizeOnlyIf({ kind: "otherHpBelow", threshold: 250 }), { kind: "otherHpBelow", value: "", threshold: 100 });
  assert.deepEqual(normalizeOnlyIf({ kind: "otherIsShip", value: "lixo" }), { kind: "otherIsShip", value: "", threshold: 50 });
  assert.equal(hasOnlyIf({ kind: "otherTrait", value: "undead" }), true);
  assert.equal(hasOnlyIf({ kind: "" }), false);
  assert.equal(onlyIfNeeds("otherCondition"), "condition");
  assert.equal(onlyIfNeeds("otherTrait"), "trait");
  assert.equal(onlyIfNeeds("selfHpBelow"), "threshold");
  assert.equal(onlyIfNeeds("otherIsShip"), "");
  // Todo tipo do menu é um tipo do "Quando", mais o novo.
  for (const kind of ONLY_IF_KINDS) assert.ok(WHEN_KINDS.includes(kind), kind);
});

test("Só se…: lido do lado do alvo, com o motivo da recusa", () => {
  const ctx = {
    otherConditions: new Set(["wet"]),
    otherTraits: new Set(["undead"]),
    otherIsShip: false,
    otherHpPercent: 20,
    selfHpPercent: 90,
    selfConditions: new Set(),
    inCombat: true
  };
  const label = (kind, value) => ({ wet: "Molhado", undead: "Morto-vivo" })[value] ?? value;
  assert.deepEqual(onlyIfOutcome(null, ctx, label), { ok: true });
  assert.deepEqual(onlyIfOutcome({ kind: "otherCondition", value: "wet" }, ctx, label), { ok: true });
  const fail = onlyIfOutcome({ kind: "otherCondition", value: "burn" }, ctx, label);
  assert.equal(fail.ok, false);
  assert.equal(fail.reason, "não aplicado: o alvo não está burn");
  assert.equal(onlyIfOutcome({ kind: "otherCondition", value: "wet" }, { ...ctx, otherConditions: new Set() }, label).reason, "não aplicado: o alvo não está Molhado");
  assert.equal(onlyIfOutcome({ kind: "otherTrait", value: "undead" }, ctx, label).ok, true);
  assert.equal(onlyIfOutcome({ kind: "otherTrait", value: "undead" }, { ...ctx, otherTraits: new Set() }, label).reason, "não aplicado: o alvo não tem o Traço Morto-vivo");
  assert.equal(onlyIfOutcome({ kind: "otherIsShip" }, ctx, label).reason, "não aplicado: o alvo não é Nave nem Veículo");
  assert.equal(onlyIfOutcome({ kind: "otherHpBelow", threshold: 30 }, ctx, label).ok, true);
  assert.equal(onlyIfOutcome({ kind: "otherHpBelow", threshold: 10 }, ctx, label).reason, "não aplicado: a Vida do alvo não está abaixo de 10%");
  assert.equal(onlyIfOutcome({ kind: "selfHpBelow", threshold: 50 }, ctx, label).ok, false);
  assert.equal(onlyIfOutcome({ kind: "selfInCombat" }, ctx, label).ok, true);
  // Condição escolhida vazia: o efeito não pega, e diz por quê.
  assert.equal(onlyIfOutcome({ kind: "otherCondition", value: "" }, ctx, label).ok, false);
  // Alvo sem Vida conhecida (NaN): a regra de Vida não vale.
  assert.equal(onlyIfOutcome({ kind: "otherHpBelow", threshold: 99 }, { ...ctx, otherHpPercent: NaN }, label).ok, false);
});

test("Quando → Então: 'Vida do oponente abaixo de' é um tipo novo", () => {
  assert.ok(WHEN_KINDS.includes("otherHpBelow"));
  assert.equal(matchesWhen({ kind: "otherHpBelow", threshold: 30 }, { otherHpPercent: 29 }), true);
  assert.equal(matchesWhen({ kind: "otherHpBelow", threshold: 30 }, { otherHpPercent: 30 }), false);
  assert.equal(matchesWhen({ kind: "otherHpBelow", threshold: 30 }, {}), false);
});

test("Só se…: a frase da Skill", () => {
  const ctx = { conditions: { wet: "Molhado" }, traits: { undead: "Morto-vivo" }, targets: { strength: "Força" }, energyLabel: "Mana" };
  assert.equal(onlyIfClause({ kind: "otherCondition", value: "wet" }, (k, v) => ctx.conditions[v]), "o alvo estiver Molhado");
  assert.equal(onlyIfClause({ kind: "otherHpBelow", threshold: 30 }), "a Vida do alvo estiver abaixo de 30%");
  assert.equal(onlyIfClause(null), "");
  const mech = { effectType: "temporary", targetType: "targeted", effects: [{ target: "strength", amount: -3, conditionId: "stun", onlyIf: { kind: "otherCondition", value: "wet" } }] };
  const sentence = skillSummary(mech, { ...ctx, conditions: { wet: "Molhado", stun: "Atordoamento" } });
  assert.match(sentence, /só se o alvo estiver Molhado/);
  // Sem "Só se…", a frase é a de sempre.
  assert.ok(!/só se/.test(skillSummary({ ...mech, effects: [{ ...mech.effects[0], onlyIf: { kind: "", value: "", threshold: 50 } }] }, { ...ctx, conditions: { stun: "Atordoamento" } })));
});

test("Só se…: aviso do editor para Condição ou Traço que sumiu", () => {
  const mech = effects => ({ effectType: "temporary", targetType: "targeted", effects });
  const e = onlyIf => ({ target: "strength", amount: -2, durationRounds: 2, onlyIf });
  const w = lintSkill(mech([e({ kind: "otherCondition", value: "sumiu" })]), { conditions: ["wet"], traits: ["undead"] });
  assert.ok(w.some(x => x.code === "onlyIfUnknown" && x.level === "hard" && x.effect === 0));
  assert.ok(lintSkill(mech([e({ kind: "otherTrait", value: "sumiu" })]), { traits: ["undead"] }).some(x => x.code === "onlyIfUnknown"));
  assert.ok(lintSkill(mech([e({ kind: "otherCondition", value: "" })]), {}).some(x => x.code === "onlyIfEmpty"));
  // Tudo existindo: nada a avisar.
  assert.deepEqual(lintSkill(mech([e({ kind: "otherCondition", value: "wet" })]), { conditions: ["wet"] }).filter(x => x.code.startsWith("onlyIf")), []);
  assert.deepEqual(lintSkill(mech([e({ kind: "otherHpBelow", threshold: 30 })]), { conditions: ["wet"] }).filter(x => x.code.startsWith("onlyIf")), []);
});

test("Só se…: custo sugerido pesa menos num efeito condicional", () => {
  const eff = onlyIf => ({ effectType: "temporary", targetType: "targeted", effects: [{ target: "strength", amount: -5, durationRounds: 3, onlyIf }] });
  const plain = suggestSkillCost(eff(null), { manaPerPoint: 1 });
  const gated = suggestSkillCost(eff({ kind: "otherIsShip", value: "", threshold: 50 }), { manaPerPoint: 1 });
  assert.ok(gated.points < plain.points);
  assert.ok(Math.abs(gated.points - plain.points * ONLY_IF_COST_FACTOR) < 1e-9);
  assert.ok(gated.rows.some(r => /Só se/.test(r.label)));
  // Empurrar não tem "Só se…".
  const push = suggestSkillCost({ effectType: "temporary", effects: [{ target: "push", amount: 3, onlyIf: { kind: "otherIsShip" } }] }, { manaPerPoint: 1 });
  assert.ok(!push.rows.some(r => /Só se/.test(r.label)));
});

test("Só se…: a IA só passa tipos sobre o alvo e ids que existem", () => {
  const sets = { conditions: new Set(["wet"]), traits: new Set(["undead"]) };
  assert.deepEqual(sanitizeOnlyIf({ kind: "otherCondition", value: "wet" }, sets), { kind: "otherCondition", value: "wet", threshold: 50 });
  assert.equal(sanitizeOnlyIf({ kind: "otherCondition", value: "inventada" }, sets), null);
  assert.equal(sanitizeOnlyIf({ kind: "otherTrait", value: "undead" }, sets).kind, "otherTrait");
  assert.equal(sanitizeOnlyIf({ kind: "otherHpBelow", threshold: 500 }, sets).threshold, 100);
  assert.equal(sanitizeOnlyIf({ kind: "selfHpBelow", threshold: 10 }, sets), null);
  assert.equal(sanitizeOnlyIf("x", sets), null);
  const out = sanitizeSkillMechanics(
    { effectType: "temporary", targetType: "targeted", effects: [{ target: "strength", amount: -3, durationRounds: 2, onlyIf: { kind: "otherCondition", value: "wet" } }, { target: "dexterity", amount: -1, durationRounds: 1, onlyIf: { kind: "otherCondition", value: "nada" } }] },
    { elements: ELEMENTS, conditions: [{ id: "wet" }], attributes: [{ key: "strength" }, { key: "dexterity" }], traits: [] }
  );
  assert.equal(out.effects[0].onlyIf.value, "wet");
  assert.equal(out.effects[1].onlyIf, undefined);
});

test("Só se…: Validar Mundo aponta a Condição/Traço que sumiu", () => {
  const idx = buildCatalogIndex({ conditions: [{ id: "wet" }], traits: [{ id: "undead" }], elements: [] });
  const mech = { effects: [{ target: "strength", onlyIf: { kind: "otherCondition", value: "wet" } }, { target: "strength", onlyIf: { kind: "otherCondition", value: "burn" } }, { target: "strength", onlyIf: { kind: "otherTrait", value: "ghost" } }] };
  const issues = checkMechanic(mech, idx);
  assert.equal(issues.length, 2);
  assert.match(issues[0].message, /"burn"/);
  assert.match(issues[1].message, /"ghost"/);
});

test("reação pelo chão também consome a marca do mesmo elemento (achado de 20/11)", async () => {
  const R = await import("../module/combat/reaction-rules.js");
  const reaction = { label: "Eletrocutado", consume: true, against: { character: true } };
  const chain = [{ id: "lightning", reactions: { water: reaction } }];
  const marks = [
    { elementId: "water", ids: ["water"], effectId: "", surface: true, order: 999 },
    { elementId: "water", ids: ["water"], effectId: "wet-1", surface: false, order: 3 }
  ];
  const picked = R.pickReaction({ chain, marks });
  assert.equal(picked?.source, "surface");
  assert.equal(picked?.alsoMark?.effectId, "wet-1");
  assert.equal(R.pickReaction({ chain, marks: [marks[0]] })?.alsoMark, undefined);
});
