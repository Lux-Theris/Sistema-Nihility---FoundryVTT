import { SYSTEM_ID, MEU_SISTEMA, getActiveCurrencies } from "../config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Editor visual das Moedas Dinâmicas (substitui o campo de JSON cru).
 * Cada linha é uma moeda: id interno, nome exibido, ícone (com FilePicker), peso e
 * Valor-Base (usado para converter automaticamente entre quaisquer duas moedas —
 * ex: Cobre=1, Prata=10, Ouro=100 já dá conversão correta em qualquer direção).
 */
export class CurrencyConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-currency-config",
    tag: "form",
    window: { title: "Configurar Moedas" },
    classes: [SYSTEM_ID, "nihility-config-app"],
    position: { width: 520, height: "auto" },
    form: {
      handler: CurrencyConfigApp.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    },
    actions: {
      addCurrency: CurrencyConfigApp.#onAdd,
      deleteCurrency: CurrencyConfigApp.#onDelete,
      pickIcon: CurrencyConfigApp.#onPickIcon
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/currency-config.hbs`, scrollable: [""] }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.currencies = getActiveCurrencies();
    console.log(`${SYSTEM_ID} | CurrencyConfigApp._prepareContext:`, context.currencies.length, "moeda(s).");
    return context;
  }

  static #onAdd(event, target) {
    event.preventDefault();
    const row = document.createElement("div");
    row.className = "currency-row";
    row.innerHTML = `
      <input type="text" data-field="id" value="" placeholder="id (ex: gold)"/>
      <input type="text" data-field="label" value="" placeholder="Nome exibido"/>
      <input type="text" data-field="icon" value="icons/commodities/currency/coins-plain-various.webp" placeholder="Caminho do ícone"/>
      <a class="currency-icon-pick" data-action="pickIcon" title="Escolher ícone"><i class="fas fa-image"></i></a>
      <input type="number" step="0.01" data-field="weight" value="0.02" placeholder="Peso"/>
      <input type="number" step="0.01" data-field="baseValue" value="1" placeholder="Valor-Base"/>
      <a class="currency-delete" data-action="deleteCurrency" title="Remover"><i class="fas fa-trash"></i></a>
    `;
    this.element.querySelector(".currency-list")?.appendChild(row);
  }

  static #onDelete(event, target) {
    event.preventDefault();
    target.closest(".currency-row")?.remove();
  }

  static #onPickIcon(event, target) {
    event.preventDefault();
    const row = target.closest(".currency-row");
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
    const currencies = [];
    this.element.querySelectorAll(".currency-row").forEach(row => {
      const id = row.querySelector('[data-field="id"]')?.value.trim();
      if (!id) return;
      currencies.push({
        id,
        label: row.querySelector('[data-field="label"]')?.value.trim() || id,
        icon: row.querySelector('[data-field="icon"]')?.value.trim() || "",
        weight: Number(row.querySelector('[data-field="weight"]')?.value) || 0,
        baseValue: Number(row.querySelector('[data-field="baseValue"]')?.value) || 1
      });
    });

    await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.currenciesData, JSON.stringify(currencies, null, 2));
    ui.notifications.info("Moedas atualizadas.");
    console.log(`${SYSTEM_ID} | CurrencyConfigApp: ${currencies.length} moeda(s) salva(s).`, currencies);
  }
}
