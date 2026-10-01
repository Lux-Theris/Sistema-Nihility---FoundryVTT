import { SYSTEM_ID, MEU_SISTEMA, getScaleConfig, getFeatureOption, isScaleEnabled, getVesselSizes } from "../core/config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * "Configurar Escalas": a lista ordenada de Escalas (Pessoal → Veículo → Nave → Capital) e a
 * Escala de cada Porte de Nave e de Veículo. O fator por degrau mora em Módulos do Sistema
 * (campo do bloco "Escala"). Ver scaleMultiplier em damage-rules.js.
 *
 * A ORDEM da lista é a regra: cada posição é um degrau. Por isso há botões de subir/descer, e
 * trocar a ordem muda o dano entre todo mundo de escalas diferentes.
 */
export class ScalesConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-scales-config",
    tag: "form",
    window: { title: "Configurar Escalas" },
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-scales-config"],
    position: { width: 560, height: "auto" },
    form: { handler: ScalesConfigApp.#onSubmit, submitOnChange: false, closeOnSubmit: true },
    actions: {
      addScale: ScalesConfigApp.#onAdd,
      removeScale: ScalesConfigApp.#onRemove,
      moveScale: ScalesConfigApp.#onMove
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/scales-config.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this.draft = foundry.utils.deepClone(getScaleConfig());
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const scales = this.draft.scales;
    const factor = getFeatureOption("scale", "scaleFactor");
    context.enabled = isScaleEnabled();
    context.factor = factor;
    context.scales = scales.map((scale, index) => ({
      ...scale,
      index,
      first: index === 0,
      last: index === scales.length - 1,
      // "×10 contra a anterior" ajuda a ler a escada sem fazer conta.
      step: index === 0 ? "base" : `×${factor} sobre ${scales[index - 1].label}`
    }));
    const sizeRows = (sizes, map) =>
      sizes.map(({ id: size, label }) => ({
        size,
        label,
        options: scales.map(s => ({ id: s.id, label: s.label, selected: s.id === map[size] }))
      }));
    context.shipSizes = sizeRows(getVesselSizes("ship"), this.draft.shipSizeMap);
    context.vehicleSizes = sizeRows(getVesselSizes("vehicle"), this.draft.vehicleSizeMap);
    return context;
  }

  /** Copia o que está digitado na tela pro rascunho, pra não perder ao redesenhar. */
  _readForm() {
    const root = this.element;
    this.draft.scales = Array.from(root.querySelectorAll(".scale-row")).map(row => ({
      id: row.querySelector('[data-field="id"]').value.trim(),
      label: row.querySelector('[data-field="label"]').value.trim()
    }));
    for (const [key, attr] of [["shipSizeMap", "ship"], ["vehicleSizeMap", "vehicle"]]) {
      root.querySelectorAll(`[data-map="${attr}"]`).forEach(select => {
        this.draft[key][select.dataset.size] = select.value;
      });
    }
  }

  static #onAdd(event) {
    event.preventDefault();
    this._readForm();
    this.draft.scales.push({ id: "", label: "" });
    this.render();
  }

  static #onRemove(event, target) {
    event.preventDefault();
    this._readForm();
    this.draft.scales.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static #onMove(event, target) {
    event.preventDefault();
    this._readForm();
    const index = Number(target.dataset.index);
    const to = index + Number(target.dataset.dir);
    if (to < 0 || to >= this.draft.scales.length) return;
    const [moved] = this.draft.scales.splice(index, 1);
    this.draft.scales.splice(to, 0, moved);
    this.render();
  }

  static async #onSubmit() {
    this._readForm();
    const scales = this.draft.scales
      .filter(s => s.id)
      .map(s => ({ id: s.id, label: s.label || s.id }));
    if (!scales.length) {
      ui.notifications.warn("É preciso pelo menos uma Escala.");
      return;
    }
    await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.scalesData, JSON.stringify({ ...this.draft, scales }, null, 2));
    ui.notifications.info("Escalas atualizadas.");
  }
}
