/**
 * Glossário do mundo (1.85.0). Critério e como rodar: ver o cabeçalho de test/setup.mjs.
 */
import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  SYSTEM_TERMS,
  buildGlossary,
  linkSegments,
  searchGlossary,
  glossaryCounts,
  filterGlossary,
  groupOrder,
  customTermId,
  normalizeGlossaryData,
  fold,
  elementSentence,
  traitSentence,
  originSentence
} from "../module/glossary/glossary-rules.js";

const world = (over = {}) => ({
  features: {},
  energyLabel: "Fluxo Quântico",
  attributes: [
    { key: "strength", label: "Força", purpose: "dano corpo a corpo · Vida" },
    { key: "defense", label: "Defesa", purpose: "aguentar golpes · Vida" },
    { key: "magic", label: "Arcano", purpose: "poder das Skills · Fluxo Quântico" },
    { key: "magicalDefense", label: "Defesa Mágica", purpose: "" },
    { key: "dexterity", label: "Destreza", purpose: "iniciativa" }
  ],
  conditions: [
    { id: "blindness", label: "Cegueira", sentence: "o Mestre decide o que ela impede", explanation: "Não enxerga." },
    { id: "zumbi", label: "Zumbificado", sentence: "não regenera", explanation: "", custom: true }
  ],
  elements: [{ id: "fire", label: "Fogo", sentence: "Tipo de dano. Pode deixar Queimadura.", explanation: "" }],
  species: [
    { id: "humano", label: "Humano", sentence: "Espécie.", description: "Versátil.", playerVisible: true },
    { id: "kijin", label: "Kijin", sentence: "Espécie evoluída.", description: "", playerVisible: false }
  ],
  heritages: [],
  traits: [{ id: "voador", label: "Voador", sentence: "Uma marca da criatura.", explanation: "", custom: true }],
  custom: [{ id: "eter", term: "Éter", group: "Cenário", text: "O mar entre os mundos.", gmOnly: false }],
  overrides: {},
  ...over
});

test("Glossário: nomes do mundo no lugar dos de fábrica (energia e atributos renomeados)", () => {
  const entries = buildGlossary(world(), { isGM: true });
  const energy = entries.find(e => e.key === "energy");
  assert.equal(energy.term, "Fluxo Quântico");
  assert.ok(energy.text.includes("Arcano × Defesa Mágica"), "a fórmula usa o nome atual do atributo");
  assert.equal(entries.find(e => e.key === "attr:magic").term, "Arcano");
  assert.ok(entries.find(e => e.key === "cost").text.includes("Fluxo Quântico"));
  assert.ok(SYSTEM_TERMS.every(([key]) => key && !key.includes(" ")), "chaves fixas, sem espaço");
  assert.equal(new Set(SYSTEM_TERMS.map(t => t[0])).size, SYSTEM_TERMS.length, "chaves únicas");
});

test("Glossário: bloco desligado some; Condições somem com as Condições desligadas", () => {
  const off = buildGlossary(world({ features: { vessels: false, statusConditions: false } }), { isGM: true });
  assert.ok(!off.some(e => e.key === "module"));
  assert.ok(!off.some(e => e.kind === "condition"));
  assert.ok(off.some(e => e.key === "evasion"), "sub-bloco ligado à parte continua (a regra do pai mora em isFeatureEnabled)");
});

test("Glossário: o que o jogador não vê", () => {
  const w = world({ overrides: { "custom:eter": { gmOnly: true }, "trait:voador": { gmOnly: true } } });
  const gm = buildGlossary(w, { isGM: true });
  const player = buildGlossary(w, { isGM: false });
  assert.ok(gm.some(e => e.key === "species:kijin"));
  assert.ok(!player.some(e => e.key === "species:kijin"), "Espécie fora da criação, sem personagem do jogador");
  assert.ok(!player.some(e => e.key === "custom:eter"));
  assert.ok(!player.some(e => e.key === "trait:voador"));
  assert.equal(gm.find(e => e.key === "custom:eter").gmOnly, true);
});

test("Glossário: termo de fábrica reescrito, termos da mesa e o que falta explicar", () => {
  const entries = buildGlossary(world({ overrides: { energy: { text: "A corrente que atravessa o Éter." } } }), { isGM: true });
  const energy = entries.find(e => e.key === "energy");
  assert.equal(energy.rewritten, true);
  assert.equal(energy.text, "A corrente que atravessa o Éter.");
  assert.ok(energy.defaultText.startsWith("A energia"));
  const missing = filterGlossary(entries, "missing").map(e => e.key).sort();
  assert.deepEqual(missing, ["condition:zumbi", "trait:voador"], "só o que o Mestre criou e deixou sem texto");
  const counts = glossaryCounts(entries);
  assert.equal(counts.rewritten, 1);
  assert.equal(counts.custom, 1);
  assert.equal(counts.missing, 2);
  assert.equal(entries.find(e => e.key === "custom:eter").group, "Cenário");
  const order = groupOrder(entries);
  assert.equal(order[0], "Ficha e rolagem");
  assert.equal(order.at(-1), "Cenário", "assuntos da mesa por último");
});

test("Links: primeira menção, plural, nome mais longo, nunca no meio da palavra", () => {
  const entries = buildGlossary(world(), { isGM: true });
  const segs = linkSegments("As Habilidades gastam Fluxo Quântico; uma Habilidade Ativa também. Habilidade de novo. Habilidadezinha não.", entries, "energy");
  const links = segs.filter(s => s.key);
  assert.deepEqual(links.map(s => [s.text, s.key]), [
    ["Habilidades", "skill"],
    ["Habilidade Ativa", "active"]
  ], "na ordem do texto; Fluxo Quântico é o próprio verbete e não vira link");
  assert.equal(segs.map(s => s.text).join(""), "As Habilidades gastam Fluxo Quântico; uma Habilidade Ativa também. Habilidade de novo. Habilidadezinha não.");

  const compound = linkSegments("Em 0, todas as Habilidades Ativas desligam.", entries, "energy");
  assert.deepEqual(compound.filter(s => s.key).map(s => [s.text, s.key]), [["Habilidades Ativas", "active"]], "plural em cada palavra do nome");

  const self = linkSegments("Gasta Fluxo Quântico.", entries, "cost");
  assert.equal(self.find(s => s.key)?.key, "energy", "a energia renomeada vira link pelo nome novo");

  const common = linkSegments("Um golpe, uma magia, uma técnica. Arcano é outra coisa.", entries, "skill");
  assert.deepEqual(common.filter(s => s.key).map(s => s.text), ["Arcano"], "a palavra comum em minúscula não vira link do atributo");

  const noMid = linkSegments("Forçado e reforço não são Força.", entries, "");
  assert.deepEqual(noMid.filter(s => s.key).map(s => s.text), ["Força"]);
});

test("Links: termo da mesa com o mesmo nome de um termo do sistema ganha o link", () => {
  const entries = buildGlossary(world({ custom: [{ id: "escudo", term: "Escudo", text: "O brasão da casa." }] }), { isGM: true });
  const segs = linkSegments("Ergueu o Escudo.", entries, "skill");
  assert.equal(segs.find(s => s.key)?.key, "custom:escudo");
});

test("Busca: sem acento, maiúscula nem plural; nome antes da explicação; trecho em volta", () => {
  const entries = buildGlossary(world(), { isGM: true });
  const cego = searchGlossary(entries, "cego");
  assert.equal(cego[0].entry.key, "condition:blindness", "'cego' acha 'Cegueira'");
  assert.equal(cego[0].inTerm, true);
  const pen = searchGlossary(entries, "PENETRACAO");
  assert.equal(pen[0].entry.key, "penetration");
  assert.ok(pen.slice(1).every(r => !r.inTerm), "quem só cita vem depois");
  const shield = pen.find(r => r.entry.key === "shield");
  assert.ok(shield.snippet.toLowerCase().includes("penetra"));
  assert.ok(shield.matchStart >= 0);
  assert.deepEqual(searchGlossary(entries, "   "), []);
  assert.equal(searchGlossary(entries, "eter mar")[0].entry.key, "custom:eter", "várias palavras: todas precisam estar");
});

test("Frases dos catálogos: Elemento, Traço, Espécie e Herança", () => {
  const fire = elementSentence(
    { group: "Fantasia", effects: [{ type: "condition", conditionId: "burn", chance: 30 }, { type: "blockRegen", chance: 100 }] },
    { conditionLabel: id => (id === "burn" ? "Queimadura" : id) }
  );
  assert.equal(fire, "Tipo de dano do grupo Fantasia. Ao acertar, pode deixar Queimadura (30%); impede a regeneração.");
  const cut = elementSentence({ parent: "physical" }, { elementLabel: () => "Físico" });
  assert.ok(cut.includes("É um tipo de Físico"));
  assert.equal(elementSentence({}), "Tipo de dano.");
  assert.ok(traitSentence({}, ["Androide", "Ciborgue"]).endsWith("Vem de: Androide, Ciborgue."));
  const elf = originSentence({ traits: ["organic"], skills: [{ name: "Visão Élfica" }], lineages: [{ label: "Alto" }] }, { traitLabel: () => "Orgânico" });
  assert.equal(elf, "Espécie. Traços: Orgânico · Skills Raciais: Visão Élfica · Linhagens: Alto.");
  assert.equal(originSentence({}, { kind: "heritage" }), "Herança, dada pelo Mestre.");
});

test("Termos da mesa: id sem repetir; configuração salva normalizada", () => {
  assert.equal(customTermId("Éter Profundo!", []), "eter-profundo");
  assert.equal(customTermId("Éter", ["eter"]), "eter-2");
  assert.deepEqual(normalizeGlossaryData("lixo"), { custom: [], overrides: {} });
  const data = normalizeGlossaryData(JSON.stringify({ custom: [{ id: "a", term: "A" }, { term: "sem id" }], overrides: { energy: { text: "x" } } }));
  assert.equal(data.custom.length, 1);
  assert.equal(data.overrides.energy.text, "x");
  assert.equal(fold("Ação Mágica"), "acao magica");
});
