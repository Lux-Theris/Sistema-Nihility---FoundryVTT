/**
 * Menu principal do Nihility RPG System - organizado por abas
 */
import { SYSTEM_ID } from "../config.js";

/** Ações da aba "Assistente de IA" que abrem o AIAssistantApp já no modo "Criar" com a tarefa certa. */
const AI_TASK_ACTIONS = {
  "generate-npc": "npc",
  "generate-mount": "mount",
  "generate-starship": "starship",
  "generate-vehicle": "vehicle",
  "generate-skill": "skill",
  freeform: "freeform"
};

export class NihilityMenuApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "nihility-menu",
      title: "Nihility RPG System",
      template: `systems/${SYSTEM_ID}/templates/apps/nihility-menu.hbs`,
      classes: [SYSTEM_ID, "nihility-menu-app"],
      width: 800,
      height: "auto",
      resizable: true,
      tabs: [{
        navSelector: ".tabs",
        contentSelector: ".tab-content",
        initial: "system"
      }]
    });
  }

  constructor(options = {}) {
    super(options);
    this.activeTab = "system";
  }

  /** @override */
  getData() {
    return {
      isGM: game.user.isGM,
      activeTab: this.activeTab,
      systemFeatures: [
        { id: "system", label: "Configurações Gerais", icon: "fas fa-cog" },
        { id: "ai", label: "Assistente de IA", icon: "fas fa-robot" },
        { id: "generation", label: "Geração Automática", icon: "fas fa-magic" },
        { id: "tools", label: "Ferramentas de Admin", icon: "fas fa-tools" }
      ]
    };
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Navegação entre abas
    html.querySelectorAll(".tab-button").forEach(element => {
      element.addEventListener("click", this._onTabChange.bind(this));
    });

    // Botões de ações específicas
    html.querySelectorAll(".action-button").forEach(element => {
      element.addEventListener("click", this._onActionClick.bind(this));
    });
  }

  _onTabChange(event) {
    event.preventDefault();
    const tabId = event.currentTarget.dataset.tab;
    this.activeTab = tabId;
    this.render(false);
  }

  async _onActionClick(event) {
    event.preventDefault();
    const action = event.currentTarget.dataset.action;

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
    }
  }
}