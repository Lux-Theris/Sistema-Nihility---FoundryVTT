/**
 * Ponto de entrada do sistema "Nihility RPG System".
 * Registra Data Models, Game Settings, Sheets, o AI Helper e a criação
 * automática de Compêndios de World.
 */
import {
  SYSTEM_ID,
  MEU_SISTEMA,
  registerSystemSettings,
  getSkillPointsPerLevel,
  getSkillPointsStarting,
  getCompletedMigrations,
  markMigrationCompleted
} from "./config.js";
import { CharacterDataModel } from "./data/character-model.js";
import { StarshipDataModel, VehicleDataModel } from "./data/starship-model.js";
import {
  SkillDataModel,
  BodyPartDataModel,
  TitleDataModel,
  StarshipModuleDataModel,
  GenericItemDataModel
} from "./data/item-models.js";
import { AIHelper } from "./ai-helper.js";
import { ensureSystemCompendiums } from "./compendium.js";
import { approveSkillCreationRequest, rejectSkillCreationRequest, removeGrantedSkill } from "./skill-economy.js";
import { announceLevelUp } from "./voice-of-the-world.js";
import { NihilityActorSheet } from "./sheets/actor-sheet.js";
import { NihilityStarshipSheet, NihilityVehicleSheet } from "./sheets/starship-sheet.js";
import { NihilityItemSheet } from "./sheets/item-sheet.js";
import { CurrencyConfigApp } from "./apps/currency-config.js";
import { SpeciesConfigApp } from "./apps/species-config.js";
import { DamageElementsConfigApp } from "./apps/damage-elements-config.js";
import { StatusConditionsConfigApp } from "./apps/status-conditions-config.js";
import { NihilityMenuApp } from "./apps/nihility-menu.js";
import { tickCombatRoundEffects, tickActorUpkeepSkills } from "./skill-effects.js";

Hooks.once("init", () => {
  console.log(`${SYSTEM_ID} | Inicializando sistema...`);

  // Namespace público para macros, módulos externos e o AI Helper (game.nihility.ai).
  // openAssistant() é o atalho de macro para o Assistente de IA, caso o botão
  // injetado no diretório de Atores não apareça em alguma versão do Foundry.
  game.nihility = {
    id: SYSTEM_ID,
    config: MEU_SISTEMA,
    ai: AIHelper,
    openAssistant: () => new NihilityMenuApp().render(true)
  };

  registerSystemSettings();

  // Editores visuais (Settings Menu) para as settings de config:false acima.
  game.settings.registerMenu(SYSTEM_ID, "currencyConfigMenu", {
    name: "Configurar Moedas",
    label: "Configurar Moedas",
    hint: "Adicione, edite ou remova as moedas usadas nas fichas.",
    icon: "fas fa-coins",
    type: CurrencyConfigApp,
    restricted: true
  });

  game.settings.registerMenu(SYSTEM_ID, "speciesConfigMenu", {
    name: "Configurar Presets de Espécie",
    label: "Configurar Presets de Espécie",
    hint: "Adicione, edite ou remova espécies e suas Partes do Corpo padrão.",
    icon: "fas fa-dna",
    type: SpeciesConfigApp,
    restricted: true
  });

  game.settings.registerMenu(SYSTEM_ID, "damageElementsConfigMenu", {
    name: "Configurar Tipos de Dano",
    label: "Configurar Tipos de Dano",
    hint: "Adicione, edite ou remova os tipos de dano elemental disponíveis para Skills.",
    icon: "fas fa-fire",
    type: DamageElementsConfigApp,
    restricted: true
  });

  game.settings.registerMenu(SYSTEM_ID, "statusConditionsConfigMenu", {
    name: "Configurar Condições de Status",
    label: "Configurar Condições de Status",
    hint: "Adicione, edite ou remova as Condições (Cegueira, Veneno, Atordoamento...) disponíveis nos Efeitos de Skills.",
    icon: "fas fa-skull-crossbones",
    type: StatusConditionsConfigApp,
    restricted: true
  });

  // Registro dos Data Models por tipo de documento (substitui template.json).
  CONFIG.Actor.dataModels.character = CharacterDataModel;
  CONFIG.Actor.dataModels.starship = StarshipDataModel;
  CONFIG.Actor.dataModels.vehicle = VehicleDataModel;

  CONFIG.Item.dataModels.skill = SkillDataModel;
  CONFIG.Item.dataModels.body_part = BodyPartDataModel;
  CONFIG.Item.dataModels.title = TitleDataModel;
  CONFIG.Item.dataModels.starship_module = StarshipModuleDataModel;
  CONFIG.Item.dataModels.item = GenericItemDataModel;

  // NPCs/monstros usam o tipo "character" com isPlayerCharacter=false (ver CreatureDataModel
  // em data/character-model.js, reservado para uso direto via API/macros quando necessário).

  // Registro das Sheets customizadas, substituindo as fichas padrão do core.
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet(SYSTEM_ID, NihilityActorSheet, { types: ["character"], makeDefault: true });
  Actors.registerSheet(SYSTEM_ID, NihilityStarshipSheet, { types: ["starship"], makeDefault: true });
  Actors.registerSheet(SYSTEM_ID, NihilityVehicleSheet, { types: ["vehicle"], makeDefault: true });

  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet(SYSTEM_ID, NihilityItemSheet, {
    types: ["skill", "body_part", "title", "starship_module", "item"],
    makeDefault: true
  });
});

Hooks.once("ready", async () => {
  await ensureSystemCompendiums();
  await runMigrationIfNeeded("tierCommonToNormal", migrateCommonTierToNormal);
  await runMigrationIfNeeded("elementalDamageToMagicTag", migrateElementalDamageToMagicTag);
  console.log(`${SYSTEM_ID} | Sistema pronto.`);
});

/**
 * Roda uma migração única (`migrationFn`) só se `key` ainda não estiver marcada como concluída
 * em `getCompletedMigrations()` — sem isso, cada migração reescanearia todos os Atores/
 * Compêndios em TODO hook `ready`, pra sempre, mesmo anos depois de já ter rodado com sucesso
 * uma vez. Marca a chave como concluída ao terminar (`markMigrationCompleted`).
 * @param {string} key - identificador estável da migração (nunca reusar pra outra migração).
 * @param {() => Promise<void>} migrationFn
 */
async function runMigrationIfNeeded(key, migrationFn) {
  if (!game.user.isGM) return;
  if (getCompletedMigrations().includes(key)) return;

  await migrationFn();
  await markMigrationCompleted(key);
  console.log(`${SYSTEM_ID} | Migração "${key}" concluída e marcada — não roda de novo neste mundo.`);
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

  const pack = game.packs.get(`world.${MEU_SISTEMA.COMPENDIUM.skills.key}`);
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

  const pack = game.packs.get(`world.${MEU_SISTEMA.COMPENDIUM.skills.key}`);
  if (!pack) return;
  const documents = await pack.getDocuments();
  for (const doc of documents) {
    const patch = buildPatch(doc._source.system);
    if (patch) await doc.update(patch);
  }
}

// Concede os Pontos de Habilidade Normais iniciais (setting "Pontos de Habilidade Normais —
// Criação") em Personagens novos. Só entra se `system.skillPoints.normal` não veio explícito
// nos dados de criação — assim duplicar/importar um Ator existente (que carrega seu valor
// atual) não ganha pontos extra de graça.
Hooks.on("preCreateActor", (actor, data, options, userId) => {
  if (data.type !== "character") return;
  if (foundry.utils.getProperty(data, "system.skillPoints.normal") !== undefined) return;

  actor.updateSource({ "system.skillPoints.normal": getSkillPointsStarting() });
});

// Concede Pontos de Habilidade Normais automaticamente quando o Nível sobe
// (a quantidade por nível é a setting "Pontos de Habilidade Normais — Por Nível") e avisa
// pela Voz do Mundo. Usa preUpdate (não updateActor) pra mesclar o ganho na mesma escrita,
// em vez de disparar um segundo update — e assim funciona também quando é o próprio jogador
// quem sobe o nível na ficha, não só pelo botão de Level Up do Mestre.
Hooks.on("preUpdateActor", (actor, changes) => {
  if (actor.type !== "character") return;

  const newLevel = foundry.utils.getProperty(changes, "system.attributes.level");
  if (newLevel === undefined) return;

  const oldLevel = actor.system.attributes.level;
  if (newLevel <= oldLevel) return;

  // Sempre anuncia quando o nível sobe, mesmo que a setting de Pontos por Nível esteja
  // zerada (por isso fica ANTES do early-return de `gained <= 0` logo abaixo).
  announceLevelUp(actor, newLevel);

  const gained = (newLevel - oldLevel) * getSkillPointsPerLevel();
  if (gained <= 0) return;

  const currentNormal = actor.system.skillPoints.normal ?? 0;
  foundry.utils.setProperty(changes, "system.skillPoints.normal", currentNormal + gained);
});

// Limpa a Habilidade Concedida (ver skill-economy.js) quando o Item Geral ou Módulo de
// Nave que a concedeu é excluído — evita skill "órfã" sobrando na ficha.
Hooks.on("preDeleteItem", item => {
  if (!["item", "starship_module"].includes(item.type)) return;
  if (!item.parent) return;
  removeGrantedSkill(item.parent, item.id);
});

/**
 * Overhaul de Naves (Fase 1) — compatibilidade de Porte: um Módulo só pode existir numa
 * Nave/Veículo cujo Porte seja igual ou maior ao dele (`MODULE_SIZE_RANK` vs `SHIP_SIZE_RANK`
 * em config.js). Bloqueia a criação/edição com um aviso em vez de deixar o Módulo instalado
 * incompatível silenciosamente.
 */
function checkModuleSizeCompatibility(actor, moduleSize) {
  if (!actor || !["starship", "vehicle"].includes(actor.type)) return true;
  if (MEU_SISTEMA.MODULE_SIZE_RANK[moduleSize] <= MEU_SISTEMA.SHIP_SIZE_RANK[actor.system.shipSize]) return true;

  ui.notifications.error(
    `${actor.name}: Módulo de Porte "${MEU_SISTEMA.MODULE_SIZE_LABELS[moduleSize]}" não cabe num Porte "${MEU_SISTEMA.SHIP_SIZE_LABELS[actor.system.shipSize]}".`
  );
  return false;
}

/**
 * Overhaul de Naves (Fase 2) — categorias de slot único (Reator/Bateria/Distribuidor/Escudo/
 * Motor/Casco/FTL, ver MEU_SISTEMA.STARSHIP_SINGLE_SLOT_CATEGORIES) só podem ter UM Módulo
 * instalado por vez na mesma Nave/Veículo — trocar exige remover o antigo primeiro.
 */
function checkSingleSlotAvailable(actor, category, excludeItemId) {
  if (!actor || !["starship", "vehicle"].includes(actor.type)) return true;
  if (!MEU_SISTEMA.STARSHIP_SINGLE_SLOT_CATEGORIES.includes(category)) return true;

  const existing = actor.items.find(
    i => i.type === "starship_module" && i.id !== excludeItemId && i.system.category === category
  );
  if (!existing) return true;

  ui.notifications.error(
    `${actor.name}: já existe um Módulo de "${MEU_SISTEMA.STARSHIP_MODULE_CATEGORY_LABELS[category]}" instalado — remova-o antes de instalar outro.`
  );
  return false;
}

/**
 * Overhaul de Naves (Fase 2) — orçamento de espaço de Arma por Porte da Nave/Veículo. Inerte
 * enquanto `MEU_SISTEMA.WEAPON_SLOT_BUDGET_BY_SHIP_SIZE` não existir: `weaponSlotBudget`
 * (ver ShipSystemsDataModel em starship-model.js) retorna `Infinity` até a tabela ser
 * preenchida na Fase 8 (valores a fechar com o Mestre), então esta checagem nunca bloqueia
 * nada por enquanto — só passa a valer sozinha quando a tabela existir.
 */
function checkWeaponBudget(actor, category, moduleSize, excludeItemId) {
  if (!actor || !["starship", "vehicle"].includes(actor.type)) return true;
  if (category !== "weapon") return true;

  const budget = actor.system.weaponSlotBudget;
  if (!Number.isFinite(budget)) return true;

  const usedByOthers = actor.items
    .filter(i => i.type === "starship_module" && i.id !== excludeItemId && i.system.category === "weapon")
    .reduce((sum, i) => sum + MEU_SISTEMA.MODULE_SIZE_RANK[i.system.moduleSize] + 1, 0);
  const thisUnit = MEU_SISTEMA.MODULE_SIZE_RANK[moduleSize] + 1;
  if (usedByOthers + thisUnit <= budget) return true;

  ui.notifications.error(`${actor.name}: orçamento de espaço de Arma excedido (${usedByOthers + thisUnit} / ${budget}).`);
  return false;
}

Hooks.on("preCreateItem", (item, data, options, userId) => {
  if (item.type !== "starship_module") return;
  const actor = item.parent;
  const { category, moduleSize } = item.system;
  if (!checkModuleSizeCompatibility(actor, moduleSize)) return false;
  if (!checkSingleSlotAvailable(actor, category, item.id)) return false;
  if (!checkWeaponBudget(actor, category, moduleSize, item.id)) return false;
});

Hooks.on("preUpdateItem", (item, changes, options, userId) => {
  if (item.type !== "starship_module") return;

  const sizeChanged = foundry.utils.getProperty(changes, "system.moduleSize") !== undefined;
  const categoryChanged = foundry.utils.getProperty(changes, "system.category") !== undefined;
  if (!sizeChanged && !categoryChanged) return;

  const actor = item.parent;
  const newSize = foundry.utils.getProperty(changes, "system.moduleSize") ?? item.system.moduleSize;
  const newCategory = foundry.utils.getProperty(changes, "system.category") ?? item.system.category;

  if (!checkModuleSizeCompatibility(actor, newSize)) return false;
  if (!checkSingleSlotAvailable(actor, newCategory, item.id)) return false;
  if (!checkWeaponBudget(actor, newCategory, newSize, item.id)) return false;
});

// Tica Efeitos Periódicos (veneno/cura contínua com tickUnit "combatRound", ver
// skill-effects.js) sempre que chega a vez de um combatente — só o dono desse turno tica,
// uma vez por turno próprio (não uma vez por rodada global). Guardado por isGM: só o GM
// aplica o dano/cura de verdade, senão cada cliente conectado ticaria o mesmo efeito.
Hooks.on("updateCombat", async (combat, changed) => {
  if (!game.user.isGM) return;
  if (changed.turn === undefined && changed.round === undefined) return;

  const actor = combat.combatant?.actor;
  if (!actor) return;

  try {
    await tickCombatRoundEffects(actor);
  } catch (err) {
    console.error(`${SYSTEM_ID} | Falha ao ticar Efeitos Periódicos no início do turno.`, err);
  }

  try {
    await tickActorUpkeepSkills(actor);
  } catch (err) {
    console.error(`${SYSTEM_ID} | Falha ao drenar Energia de Habilidades Ativas no início do turno.`, err);
  }
});

// Botões de Aprovar/Rejeitar nos pedidos de criação de Skill via Pontos de Habilidade.
Hooks.on("renderChatMessage", (message, html) => {
  const $html = html instanceof jQuery ? html : $(html);
  $html.find(".skill-request-approve").on("click", () => approveSkillCreationRequest(message));
  $html.find(".skill-request-reject").on("click", () => rejectSkillCreationRequest(message));
});

// Botão do Menu Principal no diretório de Atores — ponto de entrada único pro sistema.
// Visível pra todo mundo agora (não só GM): o Menu tem uma aba "Fichas" acessível a
// jogadores (abre qualquer Ator que já possuam/tenham Observador); Configurações/IA/
// Geração/Ferramentas continuam bloqueadas por dentro do próprio App pra quem não é GM.
// Se o Foundry mudar essa estrutura de DOM em alguma versão futura e nenhum dos
// seletores abaixo bater, use game.nihility.openAssistant() num macro.
const AI_BUTTON_CONTAINER_SELECTORS = [".directory-footer", ".header-actions", ".directory-header", ".action-buttons"];

Hooks.on("renderActorDirectory", (app, html) => {
  // Verifica se o botão já existe
  if (html.querySelector(".nihility-ai-assistant-button")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "nihility-ai-assistant-button";
  button.innerHTML = '<i class="fas fa-th-large"></i> Nihility RPG System';

  // Adiciona evento de clique
  button.addEventListener("click", () => new NihilityMenuApp().render(true));

  let container = null;
  for (const selector of AI_BUTTON_CONTAINER_SELECTORS) {
    const found = html.querySelector(selector);
    if (found) {
      container = found;
      break;
    }
  }

  // Se não encontrou um container específico, usa o próprio html
  (container ?? html).appendChild(button);
});

// Registro do menu principal do sistema
game.settings.registerMenu(SYSTEM_ID, "nihilityMainMenu", {
  name: "Menu Principal Nihility",
  label: "Menu Principal",
  hint: "Interface centralizada para todas as funcionalidades do sistema.",
  icon: "fas fa-th-large",
  type: NihilityMenuApp,
  restricted: true
});
