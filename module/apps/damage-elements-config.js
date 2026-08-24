import { SYSTEM_ID, MEU_SISTEMA, getActiveDamageElements } from "../config.js";

/**
 * Editor visual dos Tipos de Dano Elemental (substitui o campo de JSON cru).
 * Cada linha: id interno, nome exibido, cor (usada como flavor no chat).
 */
export class DamageElementsConfigApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "nihility-damage-elements-config",
      title: "Configurar Tipos de Dano",
      template: `systems/${SYSTEM_ID}/templates/apps/damage-elements-config.hbs`,
      classes: [SYSTEM_ID, "nihility-config-app"],
      width: 480,
      height: "auto",
      closeOnSubmit: true
    });
  }

  /** @override */
  getData() {
    return { elements: getActiveDamageElements() };
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    html.find(".element-add").on("click", this._onAdd.bind(this));
    this._bindRow(html.find(".element-row"));
  }

  _bindRow(rows) {
    rows.find(".element-delete").on("click", this._onDelete.bind(this));
  }

  _onAdd(event) {
    event.preventDefault();
    const row = $(`
      <div class="element-row">
        <input type="text" data-field="id" value="" placeholder="id (ex: fire)"/>
        <input type="text" data-field="label" value="" placeholder="Nome exibido"/>
        <input type="color" data-field="color" value="#c084fc"/>
        <a class="element-delete" title="Remover"><i class="fas fa-trash"></i></a>
      </div>
    `);
    this._bindRow(row);
    this.element.find(".element-list").append(row);
  }

  _onDelete(event) {
    event.preventDefault();
    $(event.currentTarget).closest(".element-row").remove();
  }

  /** @override */
  async _updateObject() {
    const elements = [];
    this.element.find(".element-row").each((_, row) => {
      const $row = $(row);
      const id = $row.find('[data-field="id"]').val()?.trim();
      if (!id) return;
      elements.push({
        id,
        label: $row.find('[data-field="label"]').val()?.trim() || id,
        color: $row.find('[data-field="color"]').val()?.trim() || "#c084fc"
      });
    });

    await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.damageElementsData, JSON.stringify(elements, null, 2));
    ui.notifications.info("Tipos de Dano atualizados.");
  }
}
