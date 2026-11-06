/**
 * Glossário do mundo (1.85.0; design aprovado: artefato "Glossário do Mundo", pranchas 1–4) — o
 * lado do Foundry: lê o mundo para a parte pura (glossary-rules.js), grava o que o Mestre edita e
 * abre a janela (apps/glossary.js).
 *
 * Onde cada texto mora (prancha 4 B): a explicação de um item de catálogo fica NO catálogo
 * (Condições `explanation` — o "Na mesa" —, Elementos e Traços `explanation`), e anda junto com
 * ele; os termos da mesa e os termos de fábrica reescritos ficam na configuração `glossaryData`.
 * Espécies e Heranças usam a descrição do próprio editor delas.
 */
import {
  SYSTEM_ID,
  MEU_SISTEMA,
  isFeatureEnabled,
  getVisibleAttributes,
  getCharacterEnergyLabel,
  getActiveStatusConditions,
  getActiveDamageElements,
  getActiveTraits,
  getActiveSpeciesPresets,
  getActiveHeritages,
  getAttributeLabel,
  PHYSICAL_SUBTYPES,
  RADIATION_ELEMENT
} from "../core/config.js";
import { attributePurpose } from "../creation/creation-rules.js";
import { attributePurposeContext } from "../creation/creation.js";
import { conditionSentence } from "../core/table-rules-text.js";
import { elementSentence, traitSentence, originSentence, normalizeGlossaryData, customTermId } from "./glossary-rules.js";

const SETTING = () => MEU_SISTEMA.SETTINGS.glossaryData;

export function loadGlossaryData() {
  try {
    return normalizeGlossaryData(game.settings.get(SYSTEM_ID, SETTING()));
  } catch {
    return normalizeGlossaryData("");
  }
}

async function saveGlossaryData(data) {
  await game.settings.set(SYSTEM_ID, SETTING(), JSON.stringify(normalizeGlossaryData(data)));
}

/**
 * Atores que contam como "do jogador" para o que ele pode ver (Espécies fora da criação e
 * Heranças só aparecem se algum personagem dele tem). "Ver como jogador" do Mestre usa os de
 * todos os jogadores.
 */
function playerActors(asPlayerPreview) {
  const characters = game.actors.filter(a => a.type === "character");
  if (!game.user.isGM) return characters.filter(a => a.isOwner);
  if (asPlayerPreview) return characters.filter(a => game.users.some(u => !u.isGM && a.testUserPermission(u, "OWNER")));
  return characters;
}

/**
 * "O sistema faz" de uma Condição: a mesma frase do diário Regras desta mesa, como frase (maiúscula
 * e ponto). Sem efeito automático, diz isso claramente em vez de repetir o "Na mesa".
 */
function conditionGlossarySentence(condition, energyLabel) {
  const sentence = conditionSentence(condition, { attributeLabel: getAttributeLabel, energyLabel });
  if (sentence === "o Mestre decide o que ela impede") return "Só o ícone no Token: nenhuma conta muda sozinha.";
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/** O mundo como a parte pura precisa. */
export function gatherGlossaryWorld({ asPlayerPreview = false } = {}) {
  const features = Object.fromEntries(Object.keys(MEU_SISTEMA.FEATURES).map(key => [key, isFeatureEnabled(key)]));
  const energyLabel = getCharacterEnergyLabel();
  const purposeCtx = attributePurposeContext();
  const conditions = getActiveStatusConditions();
  const elements = getActiveDamageElements();
  const traits = getActiveTraits();
  const species = getActiveSpeciesPresets();
  const heritages = getActiveHeritages();
  const label = (list, id) => list.find(x => x.id === id)?.label ?? id;
  const defaultIds = list => new Set(list.map(x => x.id));
  const defConditions = defaultIds(MEU_SISTEMA.DEFAULT_STATUS_CONDITIONS);
  const defElements = new Set([...(MEU_SISTEMA.DEFAULT_DAMAGE_ELEMENTS ?? []), ...(MEU_SISTEMA.SCIFI_DAMAGE_ELEMENTS ?? []), ...(PHYSICAL_SUBTYPES ?? []), RADIATION_ELEMENT].filter(Boolean).map(e => e.id));
  const defTraits = defaultIds(MEU_SISTEMA.DEFAULT_TRAITS);
  const defSpecies = new Set(Object.keys(MEU_SISTEMA.DEFAULT_SPECIES_PRESETS ?? {}));
  const defHeritages = defaultIds(MEU_SISTEMA.DEFAULT_HERITAGES ?? []);
  const actors = playerActors(asPlayerPreview);
  const traitLabel = id => label(traits, id);
  const data = loadGlossaryData();

  return {
    features,
    energyLabel,
    attributes: getVisibleAttributes().map(a => ({ key: a.key, label: a.label, purpose: attributePurpose(a.key, purposeCtx) })),
    conditions: conditions.map(c => ({
      id: c.id,
      label: c.label,
      sentence: conditionGlossarySentence(c, energyLabel),
      explanation: c.explanation ?? "",
      custom: !defConditions.has(c.id)
    })),
    elements: elements.map(e => ({
      id: e.id,
      label: e.label,
      sentence: elementSentence(e, { elementLabel: id => label(elements, id), conditionLabel: id => label(conditions, id), traitLabel }),
      explanation: e.explanation ?? "",
      custom: !defElements.has(e.id)
    })),
    species: Object.entries(species).map(([id, s]) => ({
      id,
      label: s.label || id,
      sentence: originSentence(s, { traitLabel }),
      description: String(s.description ?? "").replace(/<[^>]*>/g, "").trim(),
      custom: !defSpecies.has(id),
      playerVisible: s.availableAtCreation !== false || actors.some(a => a.system.species === id)
    })),
    heritages: heritages.map(h => ({
      id: h.id,
      label: h.label || h.id,
      sentence: originSentence(h, { kind: "heritage", traitLabel }),
      description: String(h.description ?? "").replace(/<[^>]*>/g, "").trim(),
      custom: !defHeritages.has(h.id),
      playerVisible: actors.some(a => (a.system.heritages ?? []).some(x => x.id === h.id))
    })),
    traits: traits.map(t => ({
      id: t.id,
      label: t.label,
      sentence: traitSentence(t, Object.values(species).filter(s => (s.traits ?? []).includes(t.id)).map(s => s.label)),
      explanation: t.explanation ?? "",
      custom: !defTraits.has(t.id)
    })),
    custom: data.custom,
    overrides: data.overrides
  };
}

/* ------------------------------------------------------------------ edição (só o Mestre) */

/** Grava `explanation` num item de um catálogo salvo como lista JSON. */
async function setCatalogExplanation(settingKey, defaults, id, text) {
  let list;
  try {
    const raw = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS[settingKey]);
    const parsed = typeof raw === "string" && raw ? JSON.parse(raw) : raw;
    list = Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    list = null;
  }
  list = foundry.utils.deepClone(list ?? defaults);
  const entry = list.find(x => x?.id === id);
  if (!entry) throw new Error(`"${id}" não está mais no catálogo.`);
  entry.explanation = String(text ?? "").trim();
  await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS[settingKey], JSON.stringify(list, null, 2));
}

/**
 * Salva o que o Mestre escreveu num verbete (prancha 4).
 * @param {object} entry - o verbete (de buildGlossary)
 * @param {{text?: string, gmOnly?: boolean, term?: string, group?: string}} values
 */
export async function saveGlossaryEntry(entry, values) {
  if (!game.user.isGM) return;
  const data = loadGlossaryData();
  const text = String(values.text ?? "").trim();
  const [kind, id] = entry.key.includes(":") ? [entry.key.slice(0, entry.key.indexOf(":")), entry.key.slice(entry.key.indexOf(":") + 1)] : ["system", entry.key];

  if (entry.kind === "custom") {
    const term = data.custom.find(c => c.id === id);
    if (term) Object.assign(term, { text, gmOnly: Boolean(values.gmOnly), term: values.term?.trim() || term.term, group: values.group?.trim() ?? term.group });
  } else {
    if (entry.kind === "system") {
      // Texto igual ao de fábrica (ou vazio) não conta como reescrito.
      const fallback = String(entry.defaultText ?? "").trim();
      data.overrides[entry.key] = { ...(data.overrides[entry.key] ?? {}), text: text && text !== fallback ? text : "" };
    } else if (kind === "condition") await setCatalogExplanation("statusConditionsData", MEU_SISTEMA.DEFAULT_STATUS_CONDITIONS, id, text);
    else if (kind === "element") await setCatalogExplanation("damageElementsData", getActiveDamageElements(), id, text);
    else if (kind === "trait") await setCatalogExplanation("traitsData", MEU_SISTEMA.DEFAULT_TRAITS, id, text);
    data.overrides[entry.key] = { ...(data.overrides[entry.key] ?? {}), gmOnly: Boolean(values.gmOnly) };
  }
  // Não deixa sobra vazia na configuração.
  for (const [key, o] of Object.entries(data.overrides)) if (!o.text && !o.gmOnly) delete data.overrides[key];
  await saveGlossaryData(data);
}

/** "Voltar ao padrão" de um termo de fábrica reescrito. */
export async function resetGlossaryTerm(key) {
  if (!game.user.isGM) return;
  const data = loadGlossaryData();
  if (data.overrides[key]) {
    delete data.overrides[key].text;
    if (!data.overrides[key].gmOnly) delete data.overrides[key];
  }
  await saveGlossaryData(data);
}

/** "+ Termo da mesa". Devolve a chave do verbete novo. */
export async function addCustomTerm({ term, group = "", text = "", gmOnly = false }) {
  if (!game.user.isGM || !String(term ?? "").trim()) return null;
  const data = loadGlossaryData();
  const id = customTermId(term, data.custom.map(c => c.id));
  data.custom.push({ id, term: term.trim(), group: group.trim(), text: text.trim(), gmOnly: Boolean(gmOnly) });
  await saveGlossaryData(data);
  return `custom:${id}`;
}

export async function deleteCustomTerm(key) {
  if (!game.user.isGM) return;
  const data = loadGlossaryData();
  const id = key.replace(/^custom:/, "");
  data.custom = data.custom.filter(c => c.id !== id);
  delete data.overrides[key];
  await saveGlossaryData(data);
}

/* ------------------------------------------------------------------ abrir */

/** Abre a janela (uma só), opcionalmente num verbete. */
export async function openGlossary(key = "") {
  const { GlossaryApp } = await import("../apps/glossary.js");
  return GlossaryApp.open(key);
}

/**
 * O diário "Regras desta mesa" tem um link `<a class="nihility-open-glossary">` (o diário não roda
 * script): um clique em qualquer lugar da página com essa classe abre o Glossário.
 */
export function registerGlossaryLinks() {
  document.addEventListener("click", event => {
    const link = event.target?.closest?.(".nihility-open-glossary");
    if (!link) return;
    event.preventDefault();
    openGlossary(link.dataset.glossaryKey ?? "");
  });
}
