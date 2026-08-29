import { SYSTEM_ID, MEU_SISTEMA, getActiveStatusConditions } from "../config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Editor visual das Condições de Status (Cegueira, Veneno, Atordoamento...) usadas pelas
 * entradas de `effects[]` de uma Skill (ver skill-editor-dialog.js). Cada linha: id interno,
 * nome exibido, ícone (com FilePicker, igual Moedas) — mesmo padrão de
 * damage-elements-config.js/currency-config.js, só trocando cor por ícone.
 */
export class StatusConditionsConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-status-conditions-config",
    tag: "form",
    window: { title: "Configurar Condições de Status" },
    classes: [SYSTEM_ID, "nihility-config-app"],
    position: { width: 520, height: "auto" },
    form: {
      handler: StatusConditionsConfigApp.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    },
    actions: {
      addCondition: StatusConditionsConfigApp.#onAdd,
      deleteCondition: StatusConditionsConfigApp.#onDelete,
      pickIcon: StatusConditionsConfigApp.#onPickIcon
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/status-conditions-config.hbs`, scrollable: [""] }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.conditions = getActiveStatusConditions();
    console.log(`${SYSTEM_ID} | StatusConditionsConfigApp._prepareContext:`, context.conditions.length, "condição(ões).");
    return context;
  }

  static #onAdd(event, target) {
    event.preventDefault();
    const row = document.createElement("div");
    row.className = "condition-row";
    row.innerHTML = `
      <input type="text" data-field="id" value="" placeholder="id (ex: poison)"/>
      <input type="text" data-field="label" value="" placeholder="Nome exibido"/>
      <input type="text" data-field="icon" value="icons/svg/aura.svg" placeholder="Caminho do ícone"/>
      <a class="condition-icon-pick" data-action="pickIcon" title="Escolher ícone"><i class="fas fa-image"></i></a>
      <a class="condition-delete" data-action="deleteCondition" title="Remover"><i class="fas fa-trash"></i></a>
    `;
    this.element.querySelector(".condition-list")?.appendChild(row);
  }

  static #onDelete(event, target) {
    event.preventDefault();
    target.closest(".condition-row")?.remove();
  }

  static #onPickIcon(event, target) {
    event.preventDefault();
    const row = target.closest(".condition-row");
    const input = row?.querySelector('[data-field="icon"]');
    if (!input) return;
    new FilePicker({
      type: "image",
      current: input.value,
      callback: path => {
        input.value = path;
      }
    }).render(true);
  }

  static async #onSubmit(event, form, formData) {
    const conditions = [];
    this.element.querySelectorAll(".condition-row").forEach(row => {
      const id = row.querySelector('[data-field="id"]')?.value.trim();
      if (!id) return;
      conditions.push({
        id,
        label: row.querySelector('[data-field="label"]')?.value.trim() || id,
        icon: row.querySelector('[data-field="icon"]')?.value.trim() || "icons/svg/aura.svg"
      });
    });

    await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.statusConditionsData, JSON.stringify(conditions, null, 2));
    ui.notifications.info("Condições de Status atualizadas.");
    console.log(`${SYSTEM_ID} | StatusConditionsConfigApp: ${conditions.length} condição(ões) salva(s).`, conditions);
  }
}
