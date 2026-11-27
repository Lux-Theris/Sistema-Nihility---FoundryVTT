/**
 * Migrações únicas do sistema. Cada uma roda uma vez por mundo (`runMigrationIfNeeded`) e fica
 * marcada em `completedMigrations`. Uma migração nova entra no FIM da lista `MIGRATIONS`; a chave
 * nunca muda nem é reaproveitada, porque trocar uma faz a migração rodar de novo em todo mundo.
 */
import {
  SYSTEM_ID,
  NIHILITY,
  PHYSICAL_SUBTYPES,
  DEFAULT_ELEMENT_REACTIONS,
  DEFAULT_ELEMENT_SURFACES,
  REACTION_ELEMENTS,
  REACTION_CONDITIONS,
  RADIATION_ELEMENT,
  getCompletedMigrations,
  markMigrationCompleted
} from "./config.js";
import { MIGRATION_KEYS } from "./migration-keys.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { registerStatusConditions } from "../combat/conditions.js";
import { migrateSystemEffectIcons } from "../combat/effect-badges.js";
import { mergeReactionDefaults } from "../combat/reaction-rules.js";
import { mergeSurfaceDefaults } from "../environment/surface-rules.js";
import { addMissingById } from "../skills/combined-rules.js";
import { normalizeSpeciesCatalog } from "../species/species-rules.js";
import { planOriginDefenseMigration, originDefenseKeptNotice } from "../species/origin-defense-migration-rules.js";
import { planElementMigration, elementKeptNotice } from "../combat/element-migration-rules.js";
import { planOriginElementMigration, originElementKeptNotice } from "../species/origin-element-migration-rules.js";
import { newLineageIds } from "./config/defaults/species-elements.js";
import { escapeHtml } from "../helpers/html.js";

/**
 * Rework de Espécies: grava no catálogo salvo as chaves estáveis das Skills Raciais (antes só
 * tinham nome) e a versão 1. Só mexe se o Mestre já tinha salvo um catálogo; o padrão de fábrica
 * ganha as mesmas chaves (determinísticas) na leitura. Fichas não são migradas: o diff reconhece
 * dados antigos pelo nome/slot e grava a marca de origem na primeira aplicação.
 */
async function migrateSpeciesStableKeys() {
  const raw = game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.speciesPresetsData);
  if (!raw || (typeof raw === "string" && !raw.trim())) return;
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== "object") return;
  const normalized = normalizeSpeciesCatalog(parsed);
  await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.speciesPresetsData, JSON.stringify(normalized, null, 2));
}

/**
 * Roda uma migração única (`migrationFn`) só se `key` ainda não estiver marcada como concluída
 * em `getCompletedMigrations()` — sem isso, cada migração reescanearia todos os Atores/
 * Compêndios em TODO hook `ready`, pra sempre, mesmo anos depois de já ter rodado com sucesso
 * uma vez. Marca a chave como concluída ao terminar (`markMigrationCompleted`).
 * @param {string} key - identificador estável da migração (nunca reusar pra outra migração).
 * @param {() => Promise<void>} migrationFn
 */
async function runMigrationIfNeeded(key, migrationFn) {
  // Mestre designado, não `isGM`: com dois Mestres entrando juntos, os dois migravam ao mesmo tempo.
  if (!isDesignatedGm()) return;
  if (getCompletedMigrations().includes(key)) return;

  await migrationFn();
  await markMigrationCompleted(key);
  console.log(`${SYSTEM_ID} | Migração "${key}" concluída e marcada — não roda de novo neste mundo.`);
}

/**
 * Migração única: catálogo de Tipos de Dano já salvo que tem o Físico ganha os subtipos Cortante,
 * Perfurante e Contundente (só os que ainda não existem — nada é trocado nem removido). Catálogo
 * nunca salvo usa o padrão, que já os tem.
 */
/**
 * Migração única: catálogo de Condições já salvo ganha Caído e Inconsciente (Vida 0), só se ainda
 * não tiver — nada é trocado nem removido. Catálogo nunca salvo usa o padrão, que já os tem.
 */
async function migrateIncapacitationConditions() {
  const raw = game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.statusConditionsData);
  if (!raw) return;
  let list;
  try {
    list = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    return;
  }
  if (!Array.isArray(list)) return;
  const missing = NIHILITY.DEFAULT_STATUS_CONDITIONS.filter(c => c.incapacitates && !list.some(e => e?.id === c.id));
  if (!missing.length) return;
  list.push(...foundry.utils.deepClone(missing));
  await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.statusConditionsData, JSON.stringify(list, null, 2));
  // A paleta do HUD do Token já foi montada nesta carga: republica para as duas aparecerem agora.
  registerStatusConditions();
}

/**
 * Migração única (Natureza + PEM): catálogo de Condições já salvo ganha as que o PEM e a Antimagia
 * usam e podem faltar nele — "Suprimido (Tecnologia)", "Selo de Interferência", "Suprimido
 * (Antimagia)" e "Selo Antimagia". Só acrescenta o que não existe; nada é reescrito.
 */
async function migrateTechConditions() {
  const raw = game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.statusConditionsData);
  if (!raw) return;
  let list;
  try {
    list = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    return;
  }
  if (!Array.isArray(list)) return;
  const wanted = c => c.suppressesTech || c.suppressesMagic || Number(c.interferenceLevel) > 0 || Number(c.antimagicLevel) > 0;
  const missing = NIHILITY.DEFAULT_STATUS_CONDITIONS.filter(c => wanted(c) && !list.some(e => e?.id === c.id));
  if (!missing.length) return;
  list.push(...foundry.utils.deepClone(missing));
  await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.statusConditionsData, JSON.stringify(list, null, 2));
  registerStatusConditions();
}

/**
 * Migração única (H4): catálogo de Condições já salvo ganha "Marcado", a Condição que o efeito
 * "Marcar" aplica. Quem nunca salvou o catálogo já a recebe pelo padrão.
 */
async function migrateMarkCondition() {
  const raw = game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.statusConditionsData);
  if (!raw) return;
  let list;
  try {
    list = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    return;
  }
  if (!Array.isArray(list) || list.some(e => e?.id === "marked")) return;
  const mark = NIHILITY.DEFAULT_STATUS_CONDITIONS.find(c => c.id === "marked");
  if (!mark) return;
  list.push(foundry.utils.deepClone(mark));
  await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.statusConditionsData, JSON.stringify(list, null, 2));
  registerStatusConditions();
}

/**
 * Migração única (J9): catálogo de Condições já salvo ganha "Dormindo", a Condição do Descanso
 * fora de combate. Quem nunca salvou o catálogo já a recebe pelo padrão.
 */
async function migrateSleepingCondition() {
  const raw = game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.statusConditionsData);
  if (!raw) return;
  let list;
  try {
    list = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    return;
  }
  if (!Array.isArray(list) || list.some(e => e?.id === "sleeping")) return;
  const sleeping = NIHILITY.DEFAULT_STATUS_CONDITIONS.find(c => c.id === "sleeping");
  if (!sleeping) return;
  list.push(foundry.utils.deepClone(sleeping));
  await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.statusConditionsData, JSON.stringify(list, null, 2));
  registerStatusConditions();
}

/**
 * Migração única (item 8.1): os catálogos de Tipos de Dano e de Condições já salvos ganham, SÓ no que
 * falta, Água/Óleo, Molhado/Oleado, o "Elemento do corpo" de Queimadura/Lentidão e as reações de
 * fábrica dos elementos que nunca tiveram o campo. Nada editado é sobrescrito (mergeReactionDefaults).
 */
async function migrateReactionsDefaults() {
  const read = key => {
    const raw = game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS[key]);
    if (!raw) return null;
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      return null;
    }
  };
  const elementList = read("damageElementsData");
  const conditionList = read("statusConditionsData");
  if (!elementList && !conditionList) return;
  const conditionDefaults = NIHILITY.DEFAULT_STATUS_CONDITIONS;
  const merged = mergeReactionDefaults(elementList ?? [], conditionList ?? [], {
    reactions: DEFAULT_ELEMENT_REACTIONS,
    elements: elementList ? REACTION_ELEMENTS : [],
    conditions: [
      ...REACTION_CONDITIONS.map(c => ({ ...c, addIfMissing: true })),
      ...["burn", "slow"].map(id => conditionDefaults.find(c => c.id === id)).filter(Boolean)
    ]
  });
  if (elementList && merged.elementsChanged) await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.damageElementsData, JSON.stringify(merged.elements, null, 2));
  if (conditionList && merged.conditionsChanged) {
    await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.statusConditionsData, JSON.stringify(merged.conditions, null, 2));
    registerStatusConditions();
  }
}

/**
 * Migração única (8.2): um catálogo de elementos já salvo ganha a seção "Deixa no chão" de fábrica
 * (Água, Óleo, Fogo, Gelo) só onde o elemento nunca teve o campo `surface`. Nada editado é sobrescrito.
 */
/**
 * Migração única (8c.2): os catálogos já salvos ganham o que o duelo precisa — a Condição "Marca do Duelo", a
 * Estrutura "Bolha do duelo" e o modelo de Skill "Duelo na bolha". Só acrescenta o que falta, pelo id.
 */
/**
 * Migração única (8d.1): os catálogos já salvos ganham os Traços "Sortudo"/"Azarado" e as Condições "Abençoado"/"Azarado".
 * Só acrescenta o que falta, pelo id; nada editado é sobrescrito.
 */
async function migrateLuckDefaults() {
  const targets = [
    [NIHILITY.SETTINGS.traitsData, NIHILITY.DEFAULT_TRAITS, ["lucky", "unlucky"]],
    [NIHILITY.SETTINGS.statusConditionsData, NIHILITY.DEFAULT_STATUS_CONDITIONS, ["blessed", "jinxed"]]
  ];
  for (const [key, defaults, wanted] of targets) {
    const raw = game.settings.get(SYSTEM_ID, key);
    if (!raw) continue;
    let list;
    try {
      list = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (err) {
      continue;
    }
    if (!Array.isArray(list)) continue;
    const merged = addMissingById(list, defaults, wanted);
    if (merged.changed) await game.settings.set(SYSTEM_ID, key, JSON.stringify(merged.list, null, 2));
  }
  registerStatusConditions();
}

/**
 * Migração única (8f.2): os catálogos já salvos ganham a Condição "Ancorado" e a Estrutura "Campo de Âncora". Só
 * acrescenta o que falta, pelo id; nada editado é sobrescrito.
 */
async function migrateSpaceDefaults() {
  const targets = [
    [NIHILITY.SETTINGS.statusConditionsData, NIHILITY.DEFAULT_STATUS_CONDITIONS, ["anchored"]],
    [NIHILITY.SETTINGS.structuresData, NIHILITY.DEFAULT_STRUCTURES, ["anchor-field"]]
  ];
  for (const [key, defaults, wanted] of targets) {
    const raw = game.settings.get(SYSTEM_ID, key);
    if (!raw) continue;
    let list;
    try {
      list = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (err) {
      continue;
    }
    if (!Array.isArray(list)) continue;
    const merged = addMissingById(list, defaults, wanted);
    if (merged.changed) await game.settings.set(SYSTEM_ID, key, JSON.stringify(merged.list, null, 2));
  }
  registerStatusConditions();
}

/** Migração única (8f.5): os catálogos de Condições já salvos ganham a Condição "Preso" (só o que falta, pelo id). */
/**
 * 1.117.0: resistências, fraquezas e Condições de fábrica das Espécies/Linhagens/Heranças (tabela aprovada pelo
 * dono). Só mexe no catálogo SALVO e só onde o campo ainda é o de fábrica anterior (`planOriginDefenseMigration`,
 * pura); o que o Mestre editou fica e entra num aviso único, sussurrado aos Mestres. Catálogo nunca salvo usa o
 * padrão novo direto.
 */
async function migrateOriginDefenses() {
  const parse = raw => {
    if (!raw || (typeof raw === "string" && !raw.trim())) return null;
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (err) {
      return null;
    }
  };
  const savedSpecies = parse(game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.speciesPresetsData));
  const savedHeritages = parse(game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.heritagesData));
  const hasSpecies = savedSpecies && typeof savedSpecies === "object" && !Array.isArray(savedSpecies);
  const hasHeritages = Array.isArray(savedHeritages);
  if (!hasSpecies && !hasHeritages) return;
  const plan = planOriginDefenseMigration({
    species: hasSpecies ? savedSpecies : {},
    heritages: hasHeritages ? savedHeritages : [],
    factory: { species: NIHILITY.DEFAULT_SPECIES_PRESETS, heritages: NIHILITY.DEFAULT_HERITAGES }
  });
  if (plan.changed.length) {
    if (hasSpecies) await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.speciesPresetsData, JSON.stringify(plan.species, null, 2));
    if (hasHeritages) await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.heritagesData, JSON.stringify(plan.heritages, null, 2));
    console.log(`${SYSTEM_ID} | Defesas de origem atualizadas: ${plan.changed.join("; ")}.`);
  }
  const notice = originDefenseKeptNotice(plan.kept);
  if (notice) {
    await ChatMessage.create({ whisper: game.users.filter(u => u.isGM).map(u => u.id), content: `<p>${escapeHtml(notice)}</p>` });
  }
}

/**
 * 1.120.0: Trevas (o antigo Sombrio), Luz, Demoníaco, Terra e Vento. O catálogo SALVO de Tipos de Dano ganha os
 * elementos novos e troca rótulo/afinidades só onde ainda estão como os de fábrica anteriores (`planElementMigration`,
 * pura); o que o Mestre editou fica e entra num aviso único, sussurrado aos Mestres. Catálogo nunca salvo usa o padrão novo.
 */
async function migrateNewElements() {
  const raw = game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.damageElementsData);
  if (!raw) return;
  let list;
  try {
    list = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    return;
  }
  if (!Array.isArray(list)) return;
  const plan = planElementMigration(list, NIHILITY.DEFAULT_DAMAGE_ELEMENTS);
  if (plan.added.length || plan.changed.length) {
    await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.damageElementsData, JSON.stringify(plan.list, null, 2));
    console.log(`${SYSTEM_ID} | Elementos novos: acrescentados ${plan.added.join(", ") || "nenhum"}; atualizados ${plan.changed.join("; ") || "nenhum"}.`);
  }
  const notice = elementKeptNotice(plan.kept);
  if (notice) await ChatMessage.create({ whisper: game.users.filter(u => u.isGM).map(u => u.id), content: `<p>${escapeHtml(notice)}</p>` });
}

/**
 * 1.122.0 (J12, Conjuntos): semeia nos Compêndios os Itens e Módulos das peças dos conjuntos de fábrica. O catálogo de
 * conjuntos em si não precisa de migração: sem nada salvo, o leitor devolve os de fábrica (e "Trazer do padrão" no
 * catálogo acrescenta os que faltarem, sem sobrescrever edições). Não apaga nem reescreve nada.
 */
async function migrateItemSetsFactory() {
  const { ensureFactorySetItems } = await import("../economy/item-sets.js");
  const created = await ensureFactorySetItems();
  if (created) console.log(`${SYSTEM_ID} | Conjuntos de fábrica: ${created} peça(s) nos Compêndios.`);
}

/**
 * 1.121.0: Linhagens por elemento, Slime Comum, Dragão de Trevas, Herança "Vampirizado por Demônio" e os corpos/fraquezas
 * novos. Como a `originDefenses`: acrescenta ao catálogo SALVO o que falta (pelo id) e troca um campo só onde ainda é o de
 * fábrica anterior (`planOriginElementMigration`, pura); o que o Mestre editou fica e vira um aviso único.
 */
async function migrateOriginElements() {
  const parse = raw => {
    if (!raw || (typeof raw === "string" && !raw.trim())) return null;
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (err) {
      return null;
    }
  };
  const savedSpecies = parse(game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.speciesPresetsData));
  const savedHeritages = parse(game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.heritagesData));
  const hasSpecies = savedSpecies && typeof savedSpecies === "object" && !Array.isArray(savedSpecies);
  const hasHeritages = Array.isArray(savedHeritages);
  if (!hasSpecies && !hasHeritages) return;
  const plan = planOriginElementMigration({
    species: hasSpecies ? savedSpecies : {},
    heritages: hasHeritages ? savedHeritages : [],
    factory: { species: NIHILITY.DEFAULT_SPECIES_PRESETS, heritages: NIHILITY.DEFAULT_HERITAGES },
    newLineages: newLineageIds()
  });
  if (plan.changed.length || plan.added.length) {
    if (hasSpecies) await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.speciesPresetsData, JSON.stringify(plan.species, null, 2));
    if (hasHeritages) await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.heritagesData, JSON.stringify(plan.heritages, null, 2));
    console.log(`${SYSTEM_ID} | Elementos nas Espécies: acrescentado ${plan.added.join("; ") || "nada"}; atualizado ${plan.changed.join("; ") || "nada"}.`);
  }
  const notice = originElementKeptNotice(plan.kept);
  if (notice) await ChatMessage.create({ whisper: game.users.filter(u => u.isGM).map(u => u.id), content: `<p>${escapeHtml(notice)}</p>` });
}

async function migrateSpaceDomainDefaults() {
  const raw = game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.statusConditionsData);
  if (!raw) return;
  let list;
  try {
    list = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    return;
  }
  if (!Array.isArray(list)) return;
  const merged = addMissingById(list, NIHILITY.DEFAULT_STATUS_CONDITIONS, ["trapped"]);
  if (merged.changed) await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.statusConditionsData, JSON.stringify(merged.list, null, 2));
  registerStatusConditions();
}

async function migrateDuelDefaults() {
  const targets = [
    [NIHILITY.SETTINGS.statusConditionsData, NIHILITY.DEFAULT_STATUS_CONDITIONS, ["duel-mark"]],
    [NIHILITY.SETTINGS.structuresData, NIHILITY.DEFAULT_STRUCTURES, ["duel-bubble"]],
    [NIHILITY.SETTINGS.skillTemplatesData, NIHILITY.DEFAULT_SKILL_TEMPLATES, ["duelo_bolha"]]
  ];
  for (const [key, defaults, wanted] of targets) {
    const raw = game.settings.get(SYSTEM_ID, key);
    if (!raw) continue;
    let list;
    try {
      list = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (err) {
      continue;
    }
    if (!Array.isArray(list)) continue;
    const merged = addMissingById(list, defaults, wanted);
    if (merged.changed) await game.settings.set(SYSTEM_ID, key, JSON.stringify(merged.list, null, 2));
  }
  registerStatusConditions();
}

async function migrateSurfaceDefaults() {
  const raw = game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.damageElementsData);
  if (!raw) return;
  let list;
  try {
    list = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    return;
  }
  if (!Array.isArray(list)) return;
  const merged = mergeSurfaceDefaults(list, DEFAULT_ELEMENT_SURFACES);
  if (merged.changed) await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.damageElementsData, JSON.stringify(merged.elements, null, 2));
}

/**
 * Migração única (J4b): catálogo de Condições já salvo ganha "Invisibilidade". O campo `mapStatus` das
 * Condições de fábrica (Cegueira) é preenchido na leitura, só quando falta.
 */
async function migrateSenseConditions() {
  const raw = game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.statusConditionsData);
  if (!raw) return;
  let list;
  try {
    list = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    return;
  }
  if (!Array.isArray(list) || list.some(e => e?.id === "invisibility")) return;
  const invisibility = NIHILITY.DEFAULT_STATUS_CONDITIONS.find(c => c.id === "invisibility");
  if (!invisibility) return;
  list.push(foundry.utils.deepClone(invisibility));
  await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.statusConditionsData, JSON.stringify(list, null, 2));
  registerStatusConditions();
}

/**
 * Migração única: catálogo de Tipos de Dano já salvo com os elementos Sci-Fi ganha "Radiação", que
 * o Ambiente usa para a Resistência ao dano de radiação. Catálogo de fantasia fica como está (o
 * Mestre acrescenta pelo editor se quiser).
 */
async function migrateRadiationElement() {
  const raw = game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.damageElementsData);
  if (!raw) return;
  let list;
  try {
    list = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    return;
  }
  if (!Array.isArray(list) || list.some(el => el?.id === RADIATION_ELEMENT.id)) return;
  const scifi = new Set(NIHILITY.SCIFI_DAMAGE_ELEMENTS.map(el => el.id));
  if (!list.some(el => scifi.has(el?.id))) return;
  list.push(foundry.utils.deepClone(RADIATION_ELEMENT));
  await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.damageElementsData, JSON.stringify(list, null, 2));
}

async function migratePhysicalSubtypes() {
  const raw = game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.damageElementsData);
  if (!raw) return;
  let list;
  try {
    list = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    return;
  }
  if (!Array.isArray(list) || !list.some(el => el?.id === "physical")) return;
  const missing = PHYSICAL_SUBTYPES.filter(sub => !list.some(el => el?.id === sub.id));
  if (!missing.length) return;
  const index = list.findIndex(el => el?.id === "physical");
  list.splice(index + 1, 0, ...foundry.utils.deepClone(missing));
  await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.damageElementsData, JSON.stringify(list, null, 2));
}

/**
 * Migração única: o tier de Skill "common" foi renomeado para "normal" quando
 * os tiers foram reordenados (Extra < Normal < Racial < Único < Ultimate).
 * Corrige Items já salvos em Atores e no Compêndio de Habilidades.
 */
async function migrateCommonTierToNormal() {
  for (const actor of game.actors) {
    const toFix = actor.items.filter(i => i.type === "skill" && i.system.tier === "common");
    if (!toFix.length) continue;
    await actor.updateEmbeddedDocuments(
      "Item",
      toFix.map(i => ({ _id: i.id, "system.tier": "normal" }))
    );
  }

  const pack = game.packs.get(`world.${NIHILITY.COMPENDIUM.skills.key}`);
  if (!pack) return;
  const index = await pack.getIndex({ fields: ["system.tier"] });
  const toFixInPack = index.filter(e => e.system?.tier === "common");
  for (const entry of toFixInPack) {
    const doc = await pack.getDocument(entry._id);
    await doc.update({ "system.tier": "normal" });
  }
}

/**
 * Migração única: `isElementalDamage` (booleano) + `damageElement` (string única) viraram
 * `isMagicDamage` (independente) + `damageElements` (lista). Lê de `_source` (dado bruto
 * salvo) porque esses dois campos antigos já saíram do schema — `item.system` não os
 * exporia mais depois de limpo pelo DataModel novo. Assume que todo dano elemental antigo
 * já era mágico (o toggle antigo conflava os dois conceitos).
 */
async function migrateElementalDamageToMagicTag() {
  function buildPatch(rawSystem) {
    if (!rawSystem || rawSystem.isElementalDamage === undefined) return null;
    return {
      "system.isMagicDamage": Boolean(rawSystem.isElementalDamage),
      "system.damageElements": rawSystem.damageElement ? [rawSystem.damageElement] : [],
      "system.-=isElementalDamage": null,
      "system.-=damageElement": null
    };
  }

  for (const actor of game.actors) {
    const updates = [];
    for (const item of actor.items) {
      if (item.type !== "skill") continue;
      const patch = buildPatch(item._source.system);
      if (patch) updates.push({ _id: item.id, ...patch });
    }
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  }

  const pack = game.packs.get(`world.${NIHILITY.COMPENDIUM.skills.key}`);
  if (!pack) return;
  const documents = await pack.getDocuments();
  for (const doc of documents) {
    const patch = buildPatch(doc._source.system);
    if (patch) await doc.update(patch);
  }
}

/**
 * Função de cada migração, por chave. A ordem e as chaves vêm de `MIGRATION_KEYS`
 * (`migration-keys.js`, congelada por teste); aqui só se liga a chave à função.
 */
const MIGRATION_FUNCTIONS = {
  tierCommonToNormal: migrateCommonTierToNormal,
  elementalDamageToMagicTag: migrateElementalDamageToMagicTag,
  speciesStableKeys: migrateSpeciesStableKeys,
  physicalSubtypes: migratePhysicalSubtypes,
  incapacitationConditions: migrateIncapacitationConditions,
  radiationElement: migrateRadiationElement,
  techConditions: migrateTechConditions,
  systemEffectIcons: migrateSystemEffectIcons,
  markCondition: migrateMarkCondition,
  senseConditions: migrateSenseConditions,
  sleepingCondition: migrateSleepingCondition,
  reactionsDefaults: migrateReactionsDefaults,
  surfaceDefaults: migrateSurfaceDefaults,
  duelDefaults: migrateDuelDefaults,
  luckDefaults: migrateLuckDefaults,
  spaceDefaults: migrateSpaceDefaults,
  spaceDomainDefaults: migrateSpaceDomainDefaults,
  originDefenses: migrateOriginDefenses,
  newElements: migrateNewElements,
  originElements: migrateOriginElements,
  itemSetsFactory: migrateItemSetsFactory
};

/** As migrações na ordem em que rodam: `[chave estável, função]`. */
export const MIGRATIONS = MIGRATION_KEYS.map(key => {
  const fn = MIGRATION_FUNCTIONS[key];
  if (typeof fn !== "function") throw new Error(`Migração sem função para a chave "${key}".`);
  return [key, fn];
});

/** Roda, em ordem, toda migração que ainda não foi concluída neste mundo (chamado no `ready`). */
export async function runPendingMigrations() {
  for (const [key, migrationFn] of MIGRATIONS) {
    await runMigrationIfNeeded(key, migrationFn);
  }
}
