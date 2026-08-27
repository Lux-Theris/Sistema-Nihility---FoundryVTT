/**
 * Menu principal do Nihility RPG System - organizado por abas
 */
import { SYSTEM_ID } from "../config.js";

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

    switch (action) {
      case "open-ai-assistant":
        // Abre o assistente de IA existente
        new (await import("./ai-assistant-enhanced.js")).AIAssistantEnhancedApp().render(true);
        break;
      case "backup-manager":
        // Abre o gerenciador de backup
        this._openBackupManager();
        break;
      case "generate-npc":
        // Gera um NPC via IA
        this._generateNPC();
        break;
      // Adicionar mais ações conforme necessário
    }
  }

  async _openBackupManager() {
    // Implementar gerenciador de backup
    ui.notifications.info("Gerenciador de Backup em desenvolvimento");
  }

  async _generateNPC() {
    // Implementar geração automática de NPC
    ui.notifications.info("Geração de NPC em desenvolvimento");
  }
}