/**
 * Compêndios de World auto-geridos pelo sistema (Skills/Partes do Corpo/Títulos/Módulos de
 * Nave) — criação automática e registro/reaproveitamento de Items neles. Extraído de
 * ai-helper.js (Fase 4 do refactor) porque é usado por praticamente todo o resto do sistema
 * (Sheets, Apps, skill-economy.js, ai-generation.js), não só pela geração via IA.
 */
import { SYSTEM_ID, MEU_SISTEMA } from "./config.js";

const COMPENDIUM_TYPE_MAP = {
  skill: MEU_SISTEMA.COMPENDIUM.skills,
  body_part: MEU_SISTEMA.COMPENDIUM.bodyParts,
  title: MEU_SISTEMA.COMPENDIUM.titles,
  starship_module: MEU_SISTEMA.COMPENDIUM.starshipModules
};

/**
 * Garante que todos os Compêndios de World do sistema existam.
 * Só o GM pode criá-los (permissão do Foundry); chamado no hook `ready`.
 */
export async function ensureSystemCompendiums() {
  if (!game.user.isGM) return;
  for (const def of Object.values(MEU_SISTEMA.COMPENDIUM)) {
    const collectionId = `world.${def.key}`;
    if (game.packs.get(collectionId)) continue;
    await CompendiumCollection.createCompendium({
      type: def.type,
      label: def.label,
      name: def.key,
      package: "world",
      system: SYSTEM_ID
    });
    console.log(`${SYSTEM_ID} | Compêndio criado automaticamente: ${def.label}`);
  }
}

export function getCompendiumForItemType(itemType) {
  const def = COMPENDIUM_TYPE_MAP[itemType];
  if (!def) return null;
  return game.packs.get(`world.${def.key}`) ?? null;
}

/**
 * Registra (ou reaproveita) um Item no Compêndio global correspondente ao seu tipo.
 * Usado sempre que uma Skill, Parte do Corpo, Título ou Módulo é criado/fundido.
 * @param {object} itemData - dados no formato source (ex: item.toObject())
 * @returns {Promise<Item|null>}
 */
export async function registerItemInCompendium(itemData) {
  const pack = getCompendiumForItemType(itemData.type);
  if (!pack) return null;

  const index = await pack.getIndex();
  const existing = index.find(e => e.name === itemData.name);
  if (existing) return pack.getDocument(existing._id);

  const [doc] = await pack.documentClass.createDocuments([itemData], { pack: pack.collection });
  return doc;
}
