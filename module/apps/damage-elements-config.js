import { SYSTEM_ID, MEU_SISTEMA, getActiveDamageElements } from "../config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Editor visual dos Tipos de Dano Elemental (substitui o campo de JSON cru).
 * Cada linha: id interno, nome exibido, cor (usada como flavor no chat).
 * Migrado pra ApplicationV2 — ver plano de migração (jQuery não é mais assumido aqui).
 */
export class DamageElementsConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-damage-elements-config",
    tag: "form",
    window: { title: "Configurar Tipos de Dano" },
    classes: [SYSTEM_ID, "nihility-config-app"],
    position: { width: 480, height: "auto" },
    form: {
      handler: DamageElementsConfigApp.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    },
    actions: {
      addElement: DamageElementsConfigApp.#onAdd,
      deleteElement: DamageElementsConfigApp.#onDelete
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/damage-elements-config.hbs` }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.elements = getActiveDamageElements();
    console.log(`${SYSTEM_ID} | DamageElementsConfigApp._prepareContext:`, context.elements.length, "elemento(s).");
    return context;
  }

  static #onAdd(event, target) {
    event.preventDefault();
    const row = document.createElement("div");
    row.className = "element-row";
    row.innerHTML = `
      <input type="text" data-field="id" value="" placeholder="id (ex: fire)"/>
      <input type="text" data-field="label" value="" placeholder="Nome exibido"/>
      <input type="color" data-field="color" value="#c084fc"/>
      <a class="element-delete" data-action="deleteElement" title="Remover"><i class="fas fa-trash"></i></a>
    `;
    this.element.querySelector(".element-list")?.appendChild(row);
  }

  static #onDelete(event, target) {
    event.preventDefault();
    target.closest(".element-row")?.remove();
  }

  static async #onSubmit(event, form, formData) {
    const elements = [];
    this.element.querySelectorAll(".element-row").forEach(row => {
      const id = row.querySelector('[data-field="id"]')?.value.trim();
      if (!id) return;
      elements.push({
        id,
        label: row.querySelector('[data-field="label"]')?.value.trim() || id,
        color: row.querySelector('[data-field="color"]')?.value.trim() || "#c084fc"
      });
    });

    await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.damageElementsData, JSON.stringify(elements, null, 2));
    ui.notifications.info("Tipos de Dano atualizados.");
    console.log(`${SYSTEM_ID} | DamageElementsConfigApp: ${elements.length} tipo(s) de dano salvo(s).`, elements);
  }
}
