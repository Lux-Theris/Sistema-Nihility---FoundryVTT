/**
 * Ponto de entrada do sistema "Nihility RPG System".
 * Registra Data Models, Game Settings, Sheets, o AI Helper e a criação
 * automática de Compêndios de World.
 */
import { SYSTEM_ID, MEU_SISTEMA, registerSystemSettings } from "./config.js";
import { CharacterDataModel } from "./data/character-model.js";
import { StarshipDataModel, VehicleDataModel } from "./data/starship-model.js";
import {
  SkillDataModel,
  BodyPartDataModel,
  TitleDataModel,
  StarshipModuleDataModel,
  GenericItemDataModel
} from "./data/item-models.js";
import { AIHelper, ensureSystemCompendiums } from "./ai-helper.js";
import { NihilityActorSheet } from "./sheets/actor-sheet.js";
import { NihilityStarshipSheet, NihilityVehicleSheet } from "./sheets/starship-sheet.js";
import { NihilityItemSheet } from "./sheets/item-sheet.js";
import { CurrencyConfigApp } from "./apps/currency-config.js";
import { SpeciesConfigApp } from "./apps/species-config.js";
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
  console.log(`${SYSTEM_ID} | Sistema pronto.`);
});

// Botão do Assistente de IA no rodapé do diretório de Atores (só para o GM).
// Se o Foundry mudar essa estrutura de DOM em alguma versão futura, use
// game.nihility.openAssistant() num macro como alternativa.
Hooks.on("renderActorDirectory", (app, html) => {
  if (!game.user.isGM) return;

  const button = $(`
    <button type="button" class="nihility-ai-assistant-button">
      <i class="fas fa-robot"></i> Assistente de IA
    </button>
  `);
  button.on("click", () => new AIAssistantApp().render(true));

  const footer = html.find(".directory-footer");
  if (footer.length) footer.append(button);
  else html.find(".header-actions").first().append(button);
});
