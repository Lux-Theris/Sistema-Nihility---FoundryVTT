/**
 * Menu principal do Nihility RPG System - organizado por abas
 */
import { SYSTEM_ID, MEU_SISTEMA } from "../config.js";
import { ensureSystemCompendiums } from "../ai-helper.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Ações que abrem o AIAssistantApp já no modo "Criar" com a tarefa certa. */
const AI_TASK_ACTIONS = {
  "generate-npc": "npc",
  "generate-character": "npc", // mesma capacidade da aba de IA, rótulo diferente na aba de Geração
  "generate-mount": "mount",
  "generate-starship": "starship",
  "generate-vehicle": "vehicle",
  "generate-skill": "skill",
  "generate-note": "note",
  "generate-item": "item",
  freeform: "freeform"
};

/** Recria os compêndios auto-geridos do sistema (Skills/Partes do Corpo/Títulos/Módulos), caso algum tenha sido apagado. */
async function syncData() {
  await ensureSystemCompendiums();
  ui.notifications.info("Compêndios do sistema sincronizados (recriados se algum estava faltando).");
}

/** Exporta as 3 configurações editáveis visualmente (Moedas/Presets de Espécie/Elementos de Dano) num único JSON. */
async function exportData() {
  const S = MEU_SISTEMA.SETTINGS;
  const bundle = {
    _system: SYSTEM_ID,
    _exportedAt: new Date().toISOString(),
    currenciesData: JSON.parse(game.settings.get(SYSTEM_ID, S.currenciesData)),
    speciesPresetsData: JSON.parse(game.settings.get(SYSTEM_ID, S.speciesPresetsData)),
    damageElementsData: JSON.parse(game.settings.get(SYSTEM_ID, S.damageElementsData))
  };
  saveDataToFile(JSON.stringify(bundle, null, 2), "application/json", "nihility-config.json");
}

/** Importa um JSON exportado por `exportData()`, sobrescrevendo as 3 configurações após confirmação. */
async function importData() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await readTextFromFile(file);
      const bundle = JSON.parse(text);
      const hasExpectedShape =
        bundle && typeof bundle === "object" && "currenciesData" in bundle && "speciesPresetsData" in bundle && "damageElementsData" in bundle;
      if (!hasExpectedShape) {
        ui.notifications.error("Arquivo inválido — não parece ser uma exportação de configurações do Nihility RPG System.");
        return;
      }

      const confirmed = await DialogV2.confirm({
        window: { title: "Importar Configurações" },
        content:
          "<p>Isso substitui Moedas, Presets de Espécie e Elementos de Dano atuais do mundo pelos dados desse arquivo. Confirma?</p>"
      });
      if (!confirmed) return;

      const S = MEU_SISTEMA.SETTINGS;
      await game.settings.set(SYSTEM_ID, S.currenciesData, JSON.stringify(bundle.currenciesData, null, 2));
      await game.settings.set(SYSTEM_ID, S.speciesPresetsData, JSON.stringify(bundle.speciesPresetsData, null, 2));
      await game.settings.set(SYSTEM_ID, S.damageElementsData, JSON.stringify(bundle.damageElementsData, null, 2));
      ui.notifications.info("Configurações importadas com sucesso.");
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao importar configurações.`, err);
      ui.notifications.error(`Falha ao importar: ${err.message}`);
    }
  });
  input.click();
}

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
      case "economy-config": {
        const { CurrencyConfigApp } = await import("./currency-config.js");
        new CurrencyConfigApp().render(true);
        break;
      }
      case "anatomy-config": {
        // Presets de Espécie SÃO a configuração de Anatomia (Partes do Corpo + Skills Raciais).
        const { SpeciesConfigApp } = await import("./species-config.js");
        new SpeciesConfigApp().render(true);
        break;
      }
      case "titles-config": {
        // Não existe preset global de Títulos (são só Items por Ator) — o mais útil que já
        // existe é abrir o Compêndio de Títulos do mundo pra navegar/gerenciar.
        const pack = game.packs.get(`world.${MEU_SISTEMA.COMPENDIUM.titles.key}`);
        if (pack) pack.render(true);
        else ui.notifications.warn("Compêndio de Títulos ainda não existe — use 'Sincronizar' primeiro.");
        break;
      }
      case "sync-data":
        await syncData();
        break;
      case "export-data":
        await exportData();
        break;
      case "import-data":
        await importData();
        break;
      default:
        console.warn(`${SYSTEM_ID} | NihilityMenuApp: ação "${action}" ainda não implementada.`);
    }
  }
}
