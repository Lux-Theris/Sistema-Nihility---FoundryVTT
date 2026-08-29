import { SYSTEM_ID, MEU_SISTEMA, debugLog } from "../config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Larguras de coluna por tipo de campo — combinadas numa única string de
 * `grid-template-columns` (mais uma coluna fixa de 24px pro botão de excluir, sempre por
 * último). Aplicada via `style` inline no cabeçalho E em cada linha, então qualquer app criado
 * pela factory tem colunas coerentes sem precisar de CSS específico por app.
 */
function gridColumnsFor(fields) {
  const widths = fields.map(f => {
    if (f.type === "icon") return "1fr 24px"; // campo + botão de escolher ícone
    if (f.type === "color") return "50px";
    if (f.type === "number") return "70px";
    return "1fr";
  });
  return [...widths, "24px"].join(" ");
}

/**
 * Monta o innerHTML de UMA linha da lista a partir de `fields` + `values` — única fonte de
 * verdade usada tanto pra popular a lista inicial (`_onRender`) quanto pro botão "+ Nova Linha"
 * (`#onAdd`), pra nunca divergir estrutura entre os dois caminhos (o que aconteceria se um lado
 * fosse Handlebars e o outro DOM puro, como os 3 apps que essa factory substitui faziam antes).
 */
function buildRowInputsHtml(fields, values) {
  return fields
    .map(field => {
      const value = values[field.key] ?? field.default ?? "";
      if (field.type === "color") {
        return `<input type="color" data-field="${field.key}" value="${value}"/>`;
      }
      if (field.type === "number") {
        return `<input type="number" step="${field.step ?? 1}" data-field="${field.key}" value="${value}" placeholder="${field.label}"/>`;
      }
      if (field.type === "icon") {
        return (
          `<input type="text" data-field="${field.key}" value="${value}" placeholder="${field.placeholder ?? field.label}"/>` +
          `<a class="list-config-icon-pick" data-action="pickIcon" data-field="${field.key}" title="Escolher ícone"><i class="fas fa-image"></i></a>`
        );
      }
      return `<input type="text" data-field="${field.key}" value="${value}" placeholder="${field.placeholder ?? field.label}"/>`;
    })
    .join("");
}

/**
 * Factory de app de configuração visual pra uma lista GM-editável simples (Moedas, Elementos de
 * Dano, Condições de Status...) — cada linha é um objeto JS plano com uma chave por `field`,
 * salvo como JSON na `settingsKey` informada. Substitui a estrutura quase idêntica que
 * currency-config.js, damage-elements-config.js e status-conditions-config.js tinham cada um
 * por conta própria (mesmo `DEFAULT_OPTIONS`, mesmo `_prepareContext`/add/delete/submit, só
 * mudando a lista de campos e a chave da setting).
 *
 * `species-config.js` fica de fora de propósito: a estrutura aninhada (Partes do Corpo + Skills
 * Raciais por espécie) é genuinamente diferente — forçar no mesmo molde pioraria em vez de
 * ajudar.
 *
 * @param {object} config
 * @param {string} config.id - id do DOM/ApplicationV2 (ex: "nihility-currency-config")
 * @param {string} config.title - título da janela
 * @param {keyof MEU_SISTEMA["SETTINGS"]} config.settingsKey - chave em MEU_SISTEMA.SETTINGS
 *   onde a lista é salva (setting `config:false`, guardada como JSON)
 * @param {Array<{key:string,label:string,type:"text"|"number"|"color"|"icon",placeholder?:string,default?:*,step?:number}>} config.fields
 * @param {() => Array<object>} config.getActiveList - reader (setting > default) da lista atual
 * @param {string} [config.hint] - texto de ajuda (HTML) no topo do editor
 * @param {number} [config.width]
 * @returns {typeof ApplicationV2} a classe do app, pronta pra `new`/registrar como Settings Menu
 */
export function createListConfigApp({ id, title, settingsKey, fields, getActiveList, hint = "", width = 520 }) {
  const gridColumns = gridColumnsFor(fields);
  const noun = title.replace(/^Configurar\s*/i, "");

  class ListConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id,
      tag: "form",
      window: { title },
      classes: [SYSTEM_ID, "nihility-config-app"],
      position: { width, height: "auto" },
      form: {
        handler: ListConfigApp.#onSubmit,
        submitOnChange: false,
        closeOnSubmit: true
      },
      actions: {
        addRow: ListConfigApp.#onAdd,
        deleteRow: ListConfigApp.#onDelete,
        pickIcon: ListConfigApp.#onPickIcon
      }
    };

    static PARTS = {
      body: { template: `systems/${SYSTEM_ID}/templates/apps/list-config-generic.hbs`, scrollable: [""] }
    };

    /** @override */
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      context.hint = hint;
      context.fieldLabels = fields.map(f => f.label);
      context.gridColumns = gridColumns;
      context.rows = getActiveList();
      debugLog(`${SYSTEM_ID} | ${id}._prepareContext:`, context.rows.length, "linha(s).");
      return context;
    }

    /**
     * @override
     * As linhas nunca vêm do Handlebars — só o cabeçalho/moldura são template, o conteúdo de
     * cada linha é montado aqui (mesma função que `#onAdd` usa pra uma linha em branco), pra
     * nunca ter duas implementações de "como desenhar uma linha" que possam divergir.
     */
    _onRender(context, options) {
      super._onRender(context, options);
      const list = this.element.querySelector(".list-config-list");
      list.innerHTML = "";
      for (const row of context.rows) this._appendRow(row);
    }

    _appendRow(values = {}) {
      const row = document.createElement("div");
      row.className = "list-config-row";
      row.style.gridTemplateColumns = gridColumns;
      row.innerHTML = `${buildRowInputsHtml(fields, values)}<a class="list-config-delete" data-action="deleteRow" title="Remover"><i class="fas fa-trash"></i></a>`;
      this.element.querySelector(".list-config-list")?.appendChild(row);
    }

    static #onAdd(event, target) {
      event.preventDefault();
      this._appendRow({});
    }

    static #onDelete(event, target) {
      event.preventDefault();
      target.closest(".list-config-row")?.remove();
    }

    static #onPickIcon(event, target) {
      event.preventDefault();
      const row = target.closest(".list-config-row");
      const input = row?.querySelector(`[data-field="${target.dataset.field}"]`);
      if (!input) return;
      new FilePicker({
        type: "image",
        current: input.value,
        callback: path => {
          input.value = path;
        }
      }).render(true);
    }

    /**
     * `label` (quando o campo existe) cai pro próprio `id` se deixado em branco — comportamento
     * que os 3 apps originais já tinham, cada um reimplementado do zero. Campos de texto/ícone/
     * cor caem pro `field.default` (mesmo valor pré-preenchido numa linha nova), nunca ficam
     * vazios sem necessidade.
     */
    static async #onSubmit(event, form, formData) {
      const rows = [];
      this.element.querySelectorAll(".list-config-row").forEach(rowEl => {
        const idValue = rowEl.querySelector('[data-field="id"]')?.value.trim();
        if (!idValue) return;

        const rowData = { id: idValue };
        for (const field of fields) {
          if (field.key === "id") continue;
          const input = rowEl.querySelector(`[data-field="${field.key}"]`);
          if (!input) continue;

          if (field.type === "number") {
            rowData[field.key] = Number(input.value) || field.default || 0;
          } else {
            const raw = input.value.trim();
            rowData[field.key] = raw || (field.key === "label" ? idValue : field.default) || "";
          }
        }
        rows.push(rowData);
      });

      await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS[settingsKey], JSON.stringify(rows, null, 2));
      ui.notifications.info(`${noun} atualizado(s).`);
      debugLog(`${SYSTEM_ID} | ${id}: ${rows.length} linha(s) salva(s).`, rows);
    }
  }

  return ListConfigApp;
}
