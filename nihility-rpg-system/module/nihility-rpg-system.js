/**
 * Ponto de entrada do sistema "Nihility RPG System".
 * Registra Data Models, Game Settings e (nas próximas fases) Sheets,
 * o AI Helper e a criação automática de Compêndios de World.
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

Hooks.once("init", () => {
  console.log(`${SYSTEM_ID} | Inicializando sistema...`);

  // Namespace público para macros, módulos externos e o AI Helper (game.nihility.ai).
  game.nihility = {
    id: SYSTEM_ID,
    config: MEU_SISTEMA,
    ai: AIHelper
  };

  registerSystemSettings();

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
});

Hooks.once("ready", async () => {
  await ensureSystemCompendiums();
  console.log(`${SYSTEM_ID} | Sistema pronto.`);
});
