/**
 * Menu principal do Nihility RPG System - organizado por abas
 */
import { SYSTEM_ID } from "../config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Ações da aba "Assistente de IA" que abrem o AIAssistantApp já no modo "Criar" com a tarefa certa. */
const AI_TASK_ACTIONS = {
  "generate-npc": "npc",
  "generate-mount": "mount",
  "generate-starship": "starship",
  "generate-vehicle": "vehicle",
  "generate-skill": "skill",
  freeform: "freeform"
};

export class NihilityMenuApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-menu",
    window: { title: "Nihility RPG System", resizable: true },
    classes: [SYSTEM_ID, "nihility-menu-app"],
    position: { width: 800, height: "auto" },
    actions: {
      selectTab: NihilityMenuApp.#onSelectTab,
      runAction: NihilityMenuApp.#onRunAction
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/nihility-menu.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this.activeTab = "system";
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.isGM = game.user.isGM;
    context.activeTab = this.activeTab;
    context.systemFeatures = [
      { id: "system", label: "Configurações Gerais", icon: "fas fa-cog" },
      { id: "ai", label: "Assistente de IA", icon: "fas fa-robot" },
      { id: "generation", label: "Geração Automática", icon: "fas fa-magic" },
      { id: "tools", label: "Ferramentas de Admin", icon: "fas fa-tools" }
    ];
    console.log(`${SYSTEM_ID} | NihilityMenuApp._prepareContext, aba ativa:`, this.activeTab);
    return context;
  }

  static #onSelectTab(event, target) {
    event.preventDefault();
    this.activeTab = target.dataset.tab;
    this.render();
  }

  static async #onRunAction(event, target) {
    event.preventDefault();
    // Atributo separado de `data-action` (que a própria Foundry consome pra escolher ESTE
    // handler) — `data-menu-action` guarda qual ação específica do menu foi clicada.
    const action = target.dataset.menuAction;
    console.log(`${SYSTEM_ID} | NihilityMenuApp: ação clicada ->`, action);

    if (action in AI_TASK_ACTIONS) {
      const { AIAssistantApp } = await import("./ai-assistant.js");
      new AIAssistantApp({ initialMode: "create", initialTask: AI_TASK_ACTIONS[action] }).render(true);
      return;
    }

    switch (action) {
      case "open-ai-assistant": {
        const { AIAssistantApp } = await import("./ai-assistant.js");
        new AIAssistantApp().render(true);
        break;
      }
      case "backup-manager": {
        // O gerenciador de backup/desfazer vive no modo "Agente" do Assistente de IA.
        const { AIAssistantApp } = await import("./ai-assistant.js");
        new AIAssistantApp({ initialMode: "agent" }).render(true);
        break;
      }
      // "generate-character"/"generate-item"/"sync-data"/"import-data"/"export-data"/
      // "economy-config"/"titles-config"/"anatomy-config" ainda não têm nenhuma
      // funcionalidade real por trás — ficam sem ação até serem implementados.
      default:
        console.warn(`${SYSTEM_ID} | NihilityMenuApp: ação "${action}" ainda não implementada.`);
    }
  }
}
