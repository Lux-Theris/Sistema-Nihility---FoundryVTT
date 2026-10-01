import { SYSTEM_ID, MEU_SISTEMA, debugLog } from "../core/config.js";
import { pickImageFile } from "../helpers/foundry-compat.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Irmã de `list-config-app-factory.js` para catálogos cujas linhas têm mais do que um punhado de
 * campos planos (Condições com efeito padrão, Tipos de Dano com grupo e efeitos). Cada entrada
 * vira um cartão desenhado por `renderCard` e lido de volta por `readCard` — as duas funções são
 * do app que usa a factory, que é quem sabe o formato da entrada.
 *
 * O resto é o mesmo contrato da factory de listas: moldura em Handlebars, conteúdo montado em JS
 * (a MESMA função desenha a lista inicial e o cartão novo), gravado como JSON na setting.
 *
 * @param {object} config
 * @param {string} config.id
 * @param {string} config.title
 * @param {keyof MEU_SISTEMA["SETTINGS"]} config.settingsKey
 * @param {() => object[]} config.getActiveList
 * @param {(values: object) => string} config.renderCard - HTML de dentro do cartão
 * @param {(card: HTMLElement) => object|null} config.readCard - `null` descarta o cartão (ex.: sem id)
 * @param {(root: HTMLElement) => void} [config.wireCard] - liga comportamento dinâmico (mostrar/esconder campos)
 * @param {string} [config.hint]
 * @param {string} [config.addLabel]
 * @param {number} [config.width]
 * @param {() => void} [config.afterSave]
 */
export function createCardListConfigApp({ id, title, settingsKey, getActiveList, renderCard, readCard, wireCard = null, hint = "", addLabel = "+ Novo", width = 640, afterSave = null }) {
  const noun = title.replace(/^Configurar\s*/i, "");

  class CardListConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id,
      tag: "form",
      window: { title, resizable: true },
      classes: [SYSTEM_ID, "nihility-config-app", "nihility-card-config"],
      position: { width, height: 640 },
      form: { handler: CardListConfigApp.#onSubmit, submitOnChange: false, closeOnSubmit: true },
      actions: {
        addCard: CardListConfigApp.#onAdd,
        deleteCard: CardListConfigApp.#onDelete,
        pickIcon: CardListConfigApp.#onPickIcon
      }
    };

    static PARTS = {
      body: { template: `systems/${SYSTEM_ID}/templates/apps/card-list-config.hbs`, scrollable: [".card-config-list"] }
    };

    /** @override */
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      context.hint = hint;
      context.addLabel = addLabel;
      context.rows = getActiveList();
      return context;
    }

    /** @override */
    _onRender(context, options) {
      super._onRender(context, options);
      const list = this.element.querySelector(".card-config-list");
      list.innerHTML = "";
      for (const row of context.rows) this._appendCard(row);
    }

    _appendCard(values = {}) {
      const card = document.createElement("div");
      card.className = "card-config-card";
      card.innerHTML = `${renderCard(values)}<a class="card-config-delete" data-action="deleteCard" title="Remover"><i class="fas fa-trash"></i></a>`;
      this.element.querySelector(".card-config-list")?.appendChild(card);
      wireCard?.(card);
      return card;
    }

    static #onAdd(event) {
      event.preventDefault();
      this._appendCard({})?.scrollIntoView({ block: "nearest" });
    }

    static #onDelete(event, target) {
      event.preventDefault();
      target.closest(".card-config-card")?.remove();
    }

    static #onPickIcon(event, target) {
      event.preventDefault();
      const input = target.closest(".card-config-card")?.querySelector(`[data-field="${target.dataset.field}"]`);
      if (!input) return;
      pickImageFile(input.value, path => {
        input.value = path;
      });
    }

    static async #onSubmit() {
      const rows = [];
      this.element.querySelectorAll(".card-config-card").forEach(card => {
        const row = readCard(card);
        if (row) rows.push(row);
      });
      await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS[settingsKey], JSON.stringify(rows, null, 2));
      afterSave?.();
      ui.notifications.info(`${noun} atualizado(s).`);
      debugLog(`${SYSTEM_ID} | ${id}: ${rows.length} entrada(s) salva(s).`, rows);
    }
  }

  return CardListConfigApp;
}

/** Escapa texto de catálogo pra atributo/conteúdo HTML. */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

/** `<option>`s de uma lista `[valor, rótulo]`, com o atual selecionado. */
export function optionsHtml(pairs, current) {
  return pairs.map(([value, label]) => `<option value="${escapeHtml(value)}" ${String(value) === String(current ?? "") ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}
