/**
 * Modelos de Skill (backlog L7; canvas "Editor de Skill Assistido", prancha 2 C): a lista que a
 * "+ Nova Habilidade" e o editor rápido oferecem. Os de fábrica mais os do Mestre ("Salvar como
 * modelo" na ficha de uma Skill, ou "+ Novo modelo" aqui). Cada modelo é editado no editor de
 * Skill de sempre. Trabalha numa cópia e só grava em "Salvar".
 */
import { SYSTEM_ID, MEU_SISTEMA, getActiveSkillTemplates, defaultSkillTemplates } from "../core/config.js";
import { openSkillEditorDialog } from "./skill-editor-dialog.js";
import { normalizeSkillTemplate, templateStatus, missingDefaultTemplates, TEMPLATE_GROUPS } from "../skills/skill-template-rules.js";
import { archetypeSlug } from "../npc/npc-generator-rules.js";
import { skillSentence } from "../skills/skill-assist.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const clone = value => foundry.utils.deepClone(value);

export class SkillTemplatesConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-skill-templates",
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-skill-templates"],
    window: { title: "Modelos de Skill", icon: "fa-solid fa-clone", resizable: true },
    position: { width: 720, height: 640 },
    actions: {
      add: SkillTemplatesConfigApp.#onAdd,
      edit: SkillTemplatesConfigApp.#onEdit,
      remove: SkillTemplatesConfigApp.#onRemove,
      move: SkillTemplatesConfigApp.#onMove,
      importDefaults: SkillTemplatesConfigApp.#onImportDefaults,
      cancel: SkillTemplatesConfigApp.#onCancel,
      save: SkillTemplatesConfigApp.#onSave
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/skill-templates-config.hbs`, scrollable: [".st-list"] }
  };

  constructor(options = {}) {
    super(options);
    this.#load();
  }

  #load() {
    this.list = clone(getActiveSkillTemplates());
    this.dirty = false;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const defaults = defaultSkillTemplates();
    const statusLabel = { default: "padrão", edited: "editado", custom: "do Mestre" };
    context.rows = this.list.map((t, index) => {
      const status = templateStatus(t, defaults);
      return {
        index,
        label: t.label,
        hint: t.hint,
        summary: skillSentence(t.skill) || "—",
        status,
        statusLabel: statusLabel[status],
        groups: TEMPLATE_GROUPS.map(g => ({ id: g, label: MEU_SISTEMA.SKILL_TEMPLATE_GROUP_LABELS[g], selected: g === t.group })),
        first: index === 0,
        last: index === this.list.length - 1
      };
    });
    context.dirty = this.dirty;
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll("[data-field]").forEach(el =>
      el.addEventListener("change", () => {
        const t = this.list[Number(el.dataset.index)];
        if (!t) return;
        t[el.dataset.field] = el.value;
        this.dirty = true;
        this.element.querySelector(".st-dirty")?.classList.remove("hidden");
      })
    );
  }

  static async #onAdd() {
    const data = await openSkillEditorDialog({}, { offerTemplates: false });
    if (!data) return;
    let id = archetypeSlug(data.name) || "modelo";
    for (let n = 2; this.list.some(t => t.id === id); n++) id = `${archetypeSlug(data.name) || "modelo"}_${n}`;
    this.list.push(normalizeSkillTemplate({ id, label: data.name, hint: "", group: data.effectType === "damage" ? "dano" : data.effectType === "structure" ? "controle" : "ajuda", skill: { ...data, level: 1 } }));
    this.dirty = true;
    this.render();
  }

  static async #onEdit(event, target) {
    const t = this.list[Number(target.dataset.index)];
    if (!t) return;
    const data = await openSkillEditorDialog({ ...t.skill, name: t.skill.name || t.label }, { offerTemplates: false });
    if (!data) return;
    t.skill = { ...data, level: 1 };
    t.label = data.name || t.label;
    this.dirty = true;
    this.render();
  }

  static #onRemove(event, target) {
    this.list.splice(Number(target.dataset.index), 1);
    this.dirty = true;
    this.render();
  }

  static #onMove(event, target) {
    const i = Number(target.dataset.index);
    const j = i + Number(target.dataset.dir);
    if (j < 0 || j >= this.list.length) return;
    [this.list[i], this.list[j]] = [this.list[j], this.list[i]];
    this.dirty = true;
    this.render();
  }

  static #onImportDefaults() {
    const missing = missingDefaultTemplates(this.list, defaultSkillTemplates());
    if (!missing.length) return ui.notifications.info("Nada a trazer: a lista já tem todos os modelos do padrão.");
    this.list.push(...clone(missing));
    this.dirty = true;
    ui.notifications.info(`Do padrão: ${missing.length} modelo(s). Revise e Salve.`);
    this.render();
  }

  static #onCancel() {
    this.#load();
    this.render();
  }

  static async #onSave() {
    const list = this.list.map(normalizeSkillTemplate);
    await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.skillTemplatesData, JSON.stringify(list, null, 2));
    ui.notifications.info("Modelos de Skill salvos.");
    this.#load();
    this.render();
  }
}
