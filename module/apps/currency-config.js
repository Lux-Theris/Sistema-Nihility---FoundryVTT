import { SYSTEM_ID, MEU_SISTEMA, getActiveCurrencies } from "../config.js";

/**
 * Editor visual das Moedas Dinâmicas (substitui o campo de JSON cru).
 * Cada linha é uma moeda: id interno, nome exibido, ícone (com FilePicker), peso e
 * Valor-Base (usado para converter automaticamente entre quaisquer duas moedas —
 * ex: Cobre=1, Prata=10, Ouro=100 já dá conversão correta em qualquer direção).
 */
export class CurrencyConfigApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "nihility-currency-config",
      title: "Configurar Moedas",
      template: `systems/${SYSTEM_ID}/templates/apps/currency-config.hbs`,
      classes: [SYSTEM_ID, "nihility-config-app"],
      width: 520,
      height: "auto",
      closeOnSubmit: true
    });
  }

  /** @override */
  getData() {
    return { currencies: getActiveCurrencies() };
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    html.find(".currency-add").on("click", this._onAdd.bind(this));
    this._bindRow(html.find(".currency-row"));
  }

  _bindRow(rows) {
    rows.find(".currency-delete").on("click", this._onDelete.bind(this));
    rows.find(".currency-icon-pick").on("click", this._onPickIcon.bind(this));
  }

  _onAdd(event) {
    event.preventDefault();
    const row = $(`
      <div class="currency-row">
        <input type="text" data-field="id" value="" placeholder="id (ex: gold)"/>
        <input type="text" data-field="label" value="" placeholder="Nome exibido"/>
        <input type="text" data-field="icon" value="icons/commodities/currency/coins-plain-various.webp" placeholder="Caminho do ícone"/>
        <a class="currency-icon-pick" title="Escolher ícone"><i class="fas fa-image"></i></a>
        <input type="number" step="0.01" data-field="weight" value="0.02" placeholder="Peso"/>
        <input type="number" step="0.01" data-field="baseValue" value="1" placeholder="Valor-Base"/>
        <a class="currency-delete" title="Remover"><i class="fas fa-trash"></i></a>
      </div>
    `);
    this._bindRow(row);
    this.element.find(".currency-list").append(row);
  }

  _onDelete(event) {
    event.preventDefault();
    $(event.currentTarget).closest(".currency-row").remove();
  }

  _onPickIcon(event) {
    event.preventDefault();
    const row = $(event.currentTarget).closest(".currency-row");
    const input = row.find('[data-field="icon"]')[0];
    new FilePicker({
      type: "image",
      current: input.value,
      callback: path => {
        input.value = path;
      }
    }).render(true);
  }

  /** @override */
  async _updateObject() {
    const currencies = [];
    this.element.find(".currency-row").each((_, row) => {
      const $row = $(row);
      const id = $row.find('[data-field="id"]').val()?.trim();
      if (!id) return;
      currencies.push({
        id,
        label: $row.find('[data-field="label"]').val()?.trim() || id,
        icon: $row.find('[data-field="icon"]').val()?.trim() || "",
        weight: Number($row.find('[data-field="weight"]').val()) || 0,
        baseValue: Number($row.find('[data-field="baseValue"]').val()) || 1
      });
    });

    await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.currenciesData, JSON.stringify(currencies, null, 2));
    ui.notifications.info("Moedas atualizadas.");
  }
}
