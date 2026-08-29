/**
 * Menu principal do Nihility RPG System — hub em duas colunas (trilha lateral + conteúdo).
 * "Fichas" é a única aba visível/usável para jogadores (abre qualquer Ator que já possuam
 * ou tenham permissão de Observador); Configurações/IA/Geração/Ferramentas continuam
 * exclusivas do Mestre — a trilha mostra essas abas com cadeado pro jogador em vez de
 * simplesmente escondê-las, pra deixar claro que existem e são intencionalmente bloqueadas.
 */
import { SYSTEM_ID, MEU_SISTEMA, debugLog } from "../config.js";
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

/** Abas exclusivas do Mestre — o jogador nunca consegue selecioná-las, mesmo clicando no item travado da trilha. */
const GM_ONLY_TABS = ["system", "ai", "generation", "tools"];

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
    position: { width: 880, height: 620 },
    actions: {
      selectTab: NihilityMenuApp.#onSelectTab,
      runAction: NihilityMenuApp.#onRunAction,
      openActor: NihilityMenuApp.#onOpenActor
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/nihility-menu.hbs`, scrollable: [".nm-content"] }
  };

  constructor(options = {}) {
    super(options);
    this.activeTab = "fichas";
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const isGM = game.user.isGM;
    context.isGM = isGM;

    // Jogador nunca cai numa aba GM-only, mesmo se essa era a última aba aberta (troca de usuário/re-render).
    if (!isGM && GM_ONLY_TABS.includes(this.activeTab)) this.activeTab = "fichas";
    context.activeTab = this.activeTab;

    context.railItems = [
      { id: "fichas", label: "Fichas", icon: "fas fa-users" },
      { id: "system", label: "Configurações Gerais", icon: "fas fa-cog", gmOnly: true },
      { id: "ai", label: "Assistente de IA", icon: "fas fa-robot", gmOnly: true },
      { id: "generation", label: "Geração Automática", icon: "fas fa-magic", gmOnly: true },
      { id: "tools", label: "Ferramentas de Admin", icon: "fas fa-tools", gmOnly: true }
    ].map(item => ({ ...item, active: item.id === context.activeTab, locked: item.gmOnly && !isGM }));

    context.actors = this._getVisibleActors();

    debugLog(`${SYSTEM_ID} | NihilityMenuApp._prepareContext, aba ativa:`, this.activeTab);
    return context;
  }

  /** Atores que este usuário pode abrir: o Mestre vê todo mundo, o jogador só quem possui/tem Observador. */
  _getVisibleActors() {
    const isGM = game.user.isGM;
    return game.actors
      .filter(actor => isGM || actor.testUserPermission(game.user, "OBSERVER"))
      .map(actor => ({
        id: actor.id,
        name: actor.name,
        nameLower: actor.name.toLowerCase(),
        img: actor.img,
        typeLabel: this._typeLabelFor(actor),
        typeClass: this._typeClassFor(actor),
        metaLine: this._metaLineFor(actor)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  _typeLabelFor(actor) {
    if (actor.type === "character") return actor.system.isPlayerCharacter ? "Personagem" : "NPC";
    if (actor.type === "starship") return "Nave";
    if (actor.type === "vehicle") return "Veículo";
    return actor.type;
  }

  _typeClassFor(actor) {
    if (actor.type === "character") return actor.system.isPlayerCharacter ? "pc" : "npc";
    if (actor.type === "starship") return "ship";
    if (actor.type === "vehicle") return "vehicle";
    return "";
  }

  _metaLineFor(actor) {
    if (actor.type === "character") return `Nível ${actor.system.attributes?.level ?? "?"}`;
    if (actor.type === "starship") return `Casco ${actor.system.hull?.value ?? 0}/${actor.system.hull?.max ?? 0}`;
    if (actor.type === "vehicle") return `Integridade ${actor.system.integrity?.value ?? 0}/${actor.system.integrity?.max ?? 0}`;
    return "";
  }

  /** @override — busca/filtro de tipo em Fichas são só DOM (sem re-render): a lista já está toda renderizada. */
  _onRender(context, options) {
    super._onRender(context, options);

    this.element.querySelector(".nm-actor-search")?.addEventListener("input", () => this._filterActorGrid());
    this.element.querySelectorAll(".nm-type-filter").forEach(chip => {
      chip.addEventListener("click", () => {
        this.element.querySelectorAll(".nm-type-filter").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        this._filterActorGrid();
      });
    });
  }

  _filterActorGrid() {
    const query = (this.element.querySelector(".nm-actor-search")?.value ?? "").trim().toLowerCase();
    const activeType = this.element.querySelector(".nm-type-filter.active")?.dataset.type ?? "all";
    let visibleCount = 0;

    this.element.querySelectorAll(".nm-actor-card").forEach(card => {
      const matchesType = activeType === "all" || card.dataset.type === activeType;
      const matchesQuery = !query || card.dataset.name.includes(query);
      const show = matchesType && matchesQuery;
      card.classList.toggle("hidden", !show);
      if (show) visibleCount++;
    });

    this.element.querySelector(".nm-actor-empty")?.classList.toggle("hidden", visibleCount > 0);
  }

  static #onSelectTab(event, target) {
    event.preventDefault();
    const tab = target.dataset.tab;
    if (GM_ONLY_TABS.includes(tab) && !game.user.isGM) return; // trava mesmo se o cadeado da trilha for clicado direto
    this.activeTab = tab;
    this.render();
  }

  static #onOpenActor(event, target) {
    event.preventDefault();
    const actorId = target.closest("[data-actor-id]")?.dataset.actorId;
    game.actors.get(actorId)?.sheet?.render(true);
  }

  static async #onRunAction(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return; // toda ação de Configurações/IA/Geração/Ferramentas é GM-only

    // Atributo separado de `data-action` (que a própria Foundry consome pra escolher ESTE
    // handler) — `data-menu-action` guarda qual ação específica do menu foi clicada.
    const action = target.dataset.menuAction;
    debugLog(`${SYSTEM_ID} | NihilityMenuApp: ação clicada ->`, action);

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
      case "status-conditions-config": {
        const { StatusConditionsConfigApp } = await import("./status-conditions-config.js");
        new StatusConditionsConfigApp().render(true);
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
