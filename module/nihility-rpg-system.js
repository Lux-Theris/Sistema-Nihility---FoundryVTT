/**
 * Ponto de entrada do sistema "Nihility RPG System".
 * Registra Data Models, Game Settings, Sheets, o AI Helper e a criação
 * automática de Compêndios de World.
 */
import { SYSTEM_ID, MEU_SISTEMA, registerSystemSettings, getSkillPointsPerLevel } from "./config.js";
import { CharacterDataModel } from "./data/character-model.js";
import { StarshipDataModel, VehicleDataModel } from "./data/starship-model.js";
import {
  SkillDataModel,
  BodyPartDataModel,
  TitleDataModel,
  StarshipModuleDataModel,
  GenericItemDataModel
} from "./data/item-models.js";
import {
  AIHelper,
  ensureSystemCompendiums,
  approveSkillCreationRequest,
  rejectSkillCreationRequest,
  removeGrantedSkill
} from "./ai-helper.js";
import { NihilityActorSheet } from "./sheets/actor-sheet.js";
import { NihilityStarshipSheet, NihilityVehicleSheet } from "./sheets/starship-sheet.js";
import { NihilityItemSheet } from "./sheets/item-sheet.js";
import { CurrencyConfigApp } from "./apps/currency-config.js";
import { SpeciesConfigApp } from "./apps/species-config.js";
import { DamageElementsConfigApp } from "./apps/damage-elements-config.js";
import { AIAssistantApp } from "./apps/ai-assistant.js";

Hooks.once("init", () => {
  console.log(`${SYSTEM_ID} | Inicializando sistema...`);

  // Namespace público para macros, módulos externos e o AI Helper (game.nihility.ai).
  // openAssistant() é o atalho de macro para o Assistente de IA, caso o botão
  // injetado no diretório de Atores não apareça em alguma versão do Foundry.
  game.nihility = {
    id: SYSTEM_ID,
    config: MEU_SISTEMA,
    ai: AIHelper,
    openAssistant: () => new AIAssistantApp().render(true)
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
  await migrateCommonTierToNormal();
  console.log(`${SYSTEM_ID} | Sistema pronto.`);
});

/**
 * Migração única: o tier de Skill "common" foi renomeado para "normal" quando
 * os tiers foram reordenados (Extra < Normal < Racial < Único < Ultimate).
 * Corrige Items já salvos em Atores e no Compêndio de Habilidades.
 */
async function migrateCommonTierToNormal() {
  if (!game.user.isGM) return;

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

// Concede Pontos de Habilidade Normais automaticamente quando o Nível sobe
// (a quantidade por nível é a setting "Pontos de Habilidade Normais — Por Nível").
// Usa preUpdate (não updateActor) pra mesclar o ganho na mesma escrita, em vez de
// disparar um segundo update — e assim funciona também quando é o próprio jogador
// quem sobe o nível na ficha, não só o GM.
Hooks.on("preUpdateActor", (actor, changes) => {
  if (actor.type !== "character") return;

  const newLevel = foundry.utils.getProperty(changes, "system.attributes.level");
  if (newLevel === undefined) return;

  const oldLevel = actor.system.attributes.level;
  if (newLevel <= oldLevel) return;

  const gained = (newLevel - oldLevel) * getSkillPointsPerLevel();
  if (gained <= 0) return;

  const currentNormal = actor.system.skillPoints.normal ?? 0;
  foundry.utils.setProperty(changes, "system.skillPoints.normal", currentNormal + gained);
});

// Limpa a Habilidade Concedida (ver ai-helper.js) quando o Item Geral ou Módulo de
// Nave que a concedeu é excluído — evita skill "órfã" sobrando na ficha.
Hooks.on("preDeleteItem", item => {
  if (!["item", "starship_module"].includes(item.type)) return;
  if (!item.parent) return;
  removeGrantedSkill(item.parent, item.id);
});

// Botões de Aprovar/Rejeitar nos pedidos de criação de Skill via Pontos de Habilidade.
Hooks.on("renderChatMessage", (message, html) => {
  const $html = html instanceof jQuery ? html : $(html);
  $html.find(".skill-request-approve").on("click", () => approveSkillCreationRequest(message));
  $html.find(".skill-request-reject").on("click", () => rejectSkillCreationRequest(message));
});

// Botão do Assistente de IA no diretório de Atores (só para o GM).
// Se o Foundry mudar essa estrutura de DOM em alguma versão futura e nenhum dos
// seletores abaixo bater, use game.nihility.openAssistant() num macro.
const AI_BUTTON_CONTAINER_SELECTORS = [".directory-footer", ".header-actions", ".directory-header", ".action-buttons"];

Hooks.on("renderActorDirectory", (app, html) => {
  if (!game.user.isGM) return;

  // Applications V2 (Foundry V13+) passam um HTMLElement puro, não um objeto jQuery.
  const $html = html instanceof jQuery ? html : $(html);
  if ($html.find(".nihility-ai-assistant-button").length) return;

  const button = $(`
    <button type="button" class="nihility-ai-assistant-button">
      <i class="fas fa-robot"></i> Assistente de IA
    </button>
  `);
  button.on("click", () => new AIAssistantApp().render(true));

  let container = null;
  for (const selector of AI_BUTTON_CONTAINER_SELECTORS) {
    const found = $html.find(selector).first();
    if (found.length) {
      container = found;
      break;
    }
  }
  (container ?? $html).append(button);
});
