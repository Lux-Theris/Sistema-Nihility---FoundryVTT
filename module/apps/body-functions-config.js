/**
 * Catálogo "Funções de Parte" (board 5): o que acontece quando a parte que tem a Função é perdida.
 * Lista com uma linha por Função; o "detalhe" muda com o efeito (Condição, Traço, metros de
 * arrastar). Vale só com "Ferimentos por parte" ligado.
 */
import { SYSTEM_ID, MEU_SISTEMA, getActiveBodyFunctions, getActiveStatusConditions, getActiveTraits } from "../core/config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const KINDS = [
  { id: "none", label: "Só marca" },
  { id: "notify", label: "Aviso ao Mestre" },
  { id: "condition", label: "Condição" },
  { id: "movement", label: "Reduz Deslocamento" },
  { id: "removeTrait", label: "Tira Traço" }
];
const COUNTS = [
  { id: "proportional", label: "Proporcional" },
  { id: "perPart", label: "Ao perder qualquer uma" },
  { id: "once", label: "Ao perder todas" }
];

export class BodyFunctionsConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-body-functions",
    window: { title: "Funções de Parte", resizable: true },
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-body-functions"],
    position: { width: 760, height: "auto" },
    actions: {
      addRow: BodyFunctionsConfigApp.#onAdd,
      removeRow: BodyFunctionsConfigApp.#onRemove,
      save: BodyFunctionsConfigApp.#onSave
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/body-functions-config.hbs` }
  };

  constructor(options = {}) {
    super(options);
    this.rows = foundry.utils.deepClone(getActiveBodyFunctions());
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const conditions = getActiveStatusConditions();
    const traits = getActiveTraits();
    const fnIds = this.rows.map(r => r.id).filter(Boolean);
    context.rows = this.rows.map((r, index) => {
      const kind = r.effect?.kind ?? "none";
      return {
        index,
        id: r.id,
        label: r.label,
        kinds: KINDS.map(k => ({ ...k, selected: k.id === kind })),
        counts: COUNTS.map(c => ({ ...c, selected: c.id === (r.count ?? "perPart") })),
        isCondition: kind === "condition",
        isTrait: kind === "removeTrait",
        isMovement: kind === "movement",

        conditionOptions: conditions.map(c => ({ id: c.id, label: c.label, selected: c.id === r.effect?.conditionId })),
        traitOptions: traits.map(t => ({ id: t.id, label: t.label, selected: t.id === r.effect?.traitId })),
        crawlMeters: r.effect?.crawlMeters ?? 1,
        crawlOptions: [{ id: "", label: "— nenhuma —", selected: !r.effect?.crawlFunction }, ...fnIds.filter(id => id !== r.id).map(id => ({ id, label: id, selected: id === r.effect?.crawlFunction }))],

        woundedByHp: Boolean(r.woundedByHp)
      };
    });
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll("[data-field]").forEach(el =>
      el.addEventListener("change", event => {
        const input = event.currentTarget;
        const row = this.rows[Number(input.closest("[data-index]").dataset.index)];
        let value = input.type === "checkbox" ? input.checked : input.value;
        if (input.type === "number") value = Number(value) || 0;
        if (input.dataset.field === "id") value = String(value).trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
        foundry.utils.setProperty(row, input.dataset.field, value);
        if (input.dataset.render === "1") this.render();
      })
    );
  }

  static #onAdd() {
    this.rows.push({ id: "", label: "", count: "perPart", effect: { kind: "none" } });
    this.render();
  }

  static #onRemove(event, target) {
    this.rows.splice(Number(target.closest("[data-index]").dataset.index), 1);
    this.render();
  }

  static async #onSave() {
    const rows = this.rows.filter(r => r.id).map(r => ({ ...r, label: r.label || r.id }));
    await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.bodyFunctionsData, JSON.stringify(rows, null, 2));
    ui.notifications.info("Funções de Parte salvas.");
    this.close();
  }
}
