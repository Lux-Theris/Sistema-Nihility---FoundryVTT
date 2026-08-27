/**
 * Ponto de entrada principal do sistema Nihility RPG.
 */
import { NihilitySystem } from "./systems/nihility-system.js";
import { SkillFusionManager } from "./systems/skills/fusion-manager.js";
import { DamageManager } from "./systems/combat/damage-manager.js";
import { SkillManager } from "./core/managers/skill-manager.js";
import { PromptEngine } from "./ai/prompt-engine.js";
import { FusionAssistantDialog } from "./apps/fusion-assistant-dialog.js";

// Registrar o sistema quando o Foundry VTT carrega
Hooks.on("init", () => {
  console.log("Inicializando sistema Nihility RPG...");

  // Inicializar o sistema principal
  NihilitySystem.init();

  // Registrar os gerenciadores como classes globais para uso em scripts e macros
  CONFIG.Nihility = {
    SkillFusionManager,
    DamageManager,
    SkillManager,
    PromptEngine,
    FusionAssistantDialog
  };

  console.log("Sistema Nihility RPG inicializado com sucesso!");
});

// Registrar configurações do sistema quando o Foundry VTT carrega
Hooks.on("ready", () => {
  console.log("Sistema Nihility RPG pronto para uso!");

  // Verificar se o sistema está configurado corretamente
  if (!game.settings.get("nihility", "systemInitialized")) {
    // Configurações iniciais
    game.settings.set("nihility", "systemInitialized", true);
    console.log("Configurações iniciais do sistema Nihility RPG definidas.");
  }
});

// Registrar o assistente de fusão como uma ação disponível
Hooks.on("renderActorSheet", (sheet, html, data) => {
  // Adicionar botão de fusão na ficha do personagem se for um personagem
  if (sheet.actor.type === "character") {
    const button = $(`<button type="button" class="skill-fuse-button">
      <i class="fas fa-fire"></i> Fundir Habilidades
    </button>`);

    button.on("click", (event) => {
      event.preventDefault();

      // Criar e abrir o assistente de fusão
      const fusionAssistant = new FusionAssistantDialog(sheet.actor);
      fusionAssistant.render(true);
    });

    // Adicionar o botão ao cabeçalho da ficha
    html.find(".sheet-header").append(button);
  }
});

// Função para abrir o assistente de fusão diretamente
export function openFusionAssistant(actor) {
  const fusionAssistant = new FusionAssistantDialog(actor);
  fusionAssistant.render(true);
}

// Exportar funções úteis para uso em macros e scripts
export {
  NihilitySystem,
  SkillFusionManager,
  DamageManager,
  SkillManager,
  PromptEngine,
  FusionAssistantDialog,
  openFusionAssistant
};