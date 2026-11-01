/**
 * Editor de Arquétipos de NPC (canvas "Gerador de NPC", prancha 2): lista agrupada com busca à
 * esquerda, o arquétipo aberto à direita em duas colunas — Geral + Atributos que favorece | Skills
 * + Equipamento. Mesmo modelo do editor de Espécies: trabalha numa CÓPIA do catálogo e só grava em
 * "Salvar".
 *
 * As Skills são Skills completas no formato solto das Raciais, editadas no editor de Skill de
 * sempre; arrastar uma Skill/Item Geral do Compêndio ou de uma ficha põe uma CÓPIA no arquétipo.
 */
import { SYSTEM_ID, MEU_SISTEMA, getActiveNpcArchetypes, defaultNpcArchetypes, getActiveSpeciesPresets, getAttributeLabel, debugLog } from "../core/config.js";
import { openSkillEditorDialog, mechanicSummaryFor } from "./skill-editor-dialog.js";
import { wirePickerField, pickFromChecklist } from "./checklist-picker.js";
import { normalizeArchetype, archetypeStatus, missingDefaultArchetypes, archetypeSlug, WEIGHT_FACTORS } from "../npc/npc-generator-rules.js";
import { getDragEventData, pickImageFile } from "../helpers/foundry-compat.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const clone = value => foundry.utils.deepClone(value);
const WEIGHT_LABELS = ["Pouco", "Normal", "Bastante", "Muito"];
const LUCK_LABELS = { low: "Pouca", medium: "Média", high: "Muita" };

/** Linha de equipamento: o que a arma/consumível faz, numa frase. */
function itemSummary(item) {
  const sys = item.system ?? {};
  if (sys.weapon?.enabled) return `Arma · ${sys.weapon.damageFormula || "sem fórmula"}${sys.equipped ? " · equipada" : ""}`;
  if (sys.consumable?.enabled) return sys.consumable.effectType === "damage" ? `Consumível · ${sys.consumable.damageFormula || "dano"}` : "Consumível";
  return "Item";
}

export class NpcArchetypesConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-npc-archetypes",
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-npc-archetypes"],
    window: { title: "Arquétipos de NPC", icon: "fa-solid fa-users-gear", resizable: true },
    position: { width: 1240, height: 780 },
    actions: {
      select: NpcArchetypesConfigApp.#onSelect,
      add: NpcArchetypesConfigApp.#onAdd,
      duplicate: NpcArchetypesConfigApp.#onDuplicate,
      remove: NpcArchetypesConfigApp.#onRemove,
      resetDefault: NpcArchetypesConfigApp.#onResetDefault,
      importDefaults: NpcArchetypesConfigApp.#onImportDefaults,
      setWeight: NpcArchetypesConfigApp.#onSetWeight,
      setValue: NpcArchetypesConfigApp.#onSetValue,
      addSkill: NpcArchetypesConfigApp.#onAddSkill,
      editSkill: NpcArchetypesConfigApp.#onEditSkill,
      removeRow: NpcArchetypesConfigApp.#onRemoveRow,
      pickImage: NpcArchetypesConfigApp.#onPickImage,
      cancel: NpcArchetypesConfigApp.#onCancel,
      save: NpcArchetypesConfigApp.#onSave
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/npc-archetypes-config.hbs`, scrollable: [".na-list", ".na-body"] }
  };

  constructor(options = {}) {
    super(options);
    this.#load();
    this.selected = this.catalog[0]?.id ?? null;
  }

  #load() {
    this.catalog = clone(getActiveNpcArchetypes());
    this.savedIds = new Set(this.catalog.map(a => a.id));
    this.dirty = false;
  }

  get entry() {
    return this.catalog.find(a => a.id === this.selected) ?? null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const defaults = defaultNpcArchetypes();
    const groupLabels = MEU_SISTEMA.NPC_ARCHETYPE_GROUP_LABELS;
    const groups = {};
    const statusLabel = { default: "padrão", edited: "editado", custom: "do Mestre" };
    for (const a of this.catalog) {
      const key = groupLabels[a.group] ? a.group : "";
      const status = archetypeStatus(a, defaults);
      (groups[key] ??= { label: groupLabels[key] ?? "Outros", items: [] }).items.push({ id: a.id, label: a.label, active: a.id === this.selected, status, statusLabel: statusLabel[status] });
    }
    const order = [...Object.keys(groupLabels), ""];
    context.groups = Object.entries(groups).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)).map(([, g]) => g);
    context.dirty = this.dirty;

    const entry = this.entry;
    if (!entry) return context;
    const status = archetypeStatus(entry, defaults);
    const species = getActiveSpeciesPresets();
    context.sel = {
      ...entry,
      idLocked: this.savedIds.has(entry.id),
      isDefault: status !== "custom",
      isEdited: status === "edited",
      speciesJson: JSON.stringify(entry.species),
      groupOptions: [...Object.entries(groupLabels).map(([id, label]) => ({ id, label })), { id: "", label: "Outros" }].map(o => ({ ...o, selected: o.id === (groupLabels[entry.group] ? entry.group : "") })),
      weights: MEU_SISTEMA.COMBAT_ATTRIBUTES.map(key => ({
        key,
        label: getAttributeLabel(key),
        levels: WEIGHT_LABELS.map((label, level) => ({ label, level, active: (entry.weights[key] ?? 1) === level, strong: level >= 2 }))
      })),
      luck: Object.entries(LUCK_LABELS).map(([id, label]) => ({ id, label, active: entry.luck === id })),
      skillLevelOne: entry.skillLevel === "one",
      skills: entry.skills.map((s, index) => ({ index, name: s.name, tier: MEU_SISTEMA.SKILL_TIER_LABELS[s.tier] ?? "Normal", summary: mechanicSummaryFor(s), always: s.always })),
      items: entry.items.map((i, index) => ({ index, name: i.name, summary: itemSummary(i), chance: i.chance }))
    };
    context.speciesCount = Object.keys(species).length;
    context.weightHint = `"Muito" recebe uns ${WEIGHT_FACTORS[3] / WEIGHT_FACTORS[0]}× mais pontos que "Pouco".`;
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    root.querySelector(".na-search")?.addEventListener("input", event => {
      const q = event.currentTarget.value.trim().toLowerCase();
      root.querySelectorAll(".na-li").forEach(li => li.classList.toggle("hidden", Boolean(q) && !li.dataset.label.toLowerCase().includes(q)));
    });
    root.querySelectorAll("[data-path]").forEach(el => el.addEventListener("change", this.#onFieldChange.bind(this)));
    const speciesField = root.querySelector(".na-species");
    if (speciesField) {
      const source = () => Object.entries(getActiveSpeciesPresets()).map(([id, e]) => ({ id, label: e.label || id, group: e.group || "" }));
      wirePickerField(speciesField, {
        noun: "Espécie",
        onChange: ids => this.#write("species", ids),
        describe: ids => {
          const all = source();
          return { total: all.length, chips: ids.map(id => ({ id, label: all.find(o => o.id === id)?.label ?? `${id} (removida)`, color: "" })) };
        },
        pick: ids => {
          const groups = {};
          for (const o of source()) (groups[o.group] ??= []).push({ id: o.id, label: o.label });
          return pickFromChecklist({
            title: "Espécies possíveis",
            groups: Object.entries(groups).map(([g, list]) => ({ label: MEU_SISTEMA.SPECIES_GROUP_LABELS[g] ?? "Outras", options: list })),
            selected: ids
          });
        }
      });
    }
    // Arrastar Skill/Item Geral do Compêndio ou de uma ficha: vira uma cópia no arquétipo.
    root.querySelectorAll("[data-drop]").forEach(zone => {
      zone.addEventListener("dragover", event => {
        event.preventDefault();
        zone.classList.add("over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("over"));
      zone.addEventListener("drop", event => {
        event.preventDefault();
        event.stopPropagation();
        zone.classList.remove("over");
        this.#onDrop(event, zone.dataset.drop);
      });
    });
  }

  /** Grava no arquétipo aberto (cópia de trabalho). */
  #write(path, value, { render = false } = {}) {
    const entry = this.entry;
    if (!entry) return;
    foundry.utils.setProperty(entry, path, value);
    this.dirty = true;
    if (render) this.render();
  }

  #onFieldChange(event) {
    const el = event.currentTarget;
    const path = el.dataset.path;
    let value = el.type === "checkbox" ? el.checked : el.value;
    if (el.dataset.kind === "int") value = Math.max(0, Math.round(Number(value) || 0));
    if (path === "__id") return this.#rename(String(value));
    this.#write(path, value, { render: el.dataset.render === "1" });
  }

  /** Só arquétipo ainda não salvo muda de chave. */
  #rename(raw) {
    const entry = this.entry;
    const id = archetypeSlug(raw);
    if (!entry || !id || id === entry.id || this.savedIds.has(entry.id)) return this.render();
    if (this.catalog.some(a => a.id === id)) {
      ui.notifications.warn(`Já existe um arquétipo com a chave "${id}".`);
      return this.render();
    }
    entry.id = id;
    this.selected = id;
    this.dirty = true;
    this.render();
  }

  async #onDrop(event, kind) {
    const data = getDragEventData(event);
    if (data?.type !== "Item" || !data.uuid) return;
    const item = await fromUuid(data.uuid);
    if (!item) return;
    const entry = this.entry;
    if (!entry) return;
    if (kind === "skills") {
      if (item.type !== "skill") return ui.notifications.warn("Aqui só entram Skills.");
      const { tier, xp, active, isItemGranted, ...system } = item.toObject().system;
      entry.skills.push({ ...system, tier: tier === "racial" ? "normal" : tier, name: item.name, img: item.img, key: archetypeSlug(item.name), always: false });
    } else {
      if (item.type !== "item") return ui.notifications.warn("Aqui só entram Itens Gerais.");
      const source = item.toObject();
      entry.items.push({ name: source.name, img: source.img, type: "item", system: { ...source.system, quantity: 1, containerId: "" }, key: archetypeSlug(source.name), chance: 100 });
    }
    this.#normalizeSelected();
    this.dirty = true;
    this.render();
  }

  /** Recalcula chaves únicas e campos depois de mexer em listas. */
  #normalizeSelected() {
    const i = this.catalog.findIndex(a => a.id === this.selected);
    if (i >= 0) this.catalog[i] = normalizeArchetype(this.catalog[i], MEU_SISTEMA.COMBAT_ATTRIBUTES);
  }

  /* -------------------------------------------- actions */

  static #onSelect(event, target) {
    this.selected = target.dataset.id;
    this.render();
  }

  static #onAdd() {
    let id = "novo_arquetipo";
    for (let n = 2; this.catalog.some(a => a.id === id); n++) id = `novo_arquetipo_${n}`;
    this.catalog.push(normalizeArchetype({ id, label: "Novo arquétipo", group: "", skillsMin: 1, skillsMax: 2 }, MEU_SISTEMA.COMBAT_ATTRIBUTES));
    this.selected = id;
    this.dirty = true;
    this.render();
  }

  static #onDuplicate() {
    const entry = this.entry;
    if (!entry) return;
    let id = `${entry.id}_copia`;
    for (let n = 2; this.catalog.some(a => a.id === id); n++) id = `${entry.id}_copia_${n}`;
    this.catalog.push({ ...clone(entry), id, label: `${entry.label} (cópia)` });
    this.selected = id;
    this.dirty = true;
    this.render();
  }

  static async #onRemove() {
    const entry = this.entry;
    if (!entry) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Remover arquétipo" },
      content: `<p>Remover <b>${foundry.utils.escapeHTML(entry.label)}</b>? As fichas já geradas não mudam.</p><p>Só vale depois de Salvar.</p>`
    });
    if (!ok) return;
    this.catalog = this.catalog.filter(a => a.id !== entry.id);
    this.selected = this.catalog[0]?.id ?? null;
    this.dirty = true;
    this.render();
  }

  static #onResetDefault() {
    const entry = this.entry;
    const original = defaultNpcArchetypes().find(a => a.id === entry?.id);
    if (!original) return;
    const i = this.catalog.findIndex(a => a.id === entry.id);
    this.catalog[i] = clone(original);
    this.dirty = true;
    this.render();
  }

  /** Traz só os arquétipos de fábrica que faltam; nada que o Mestre mudou é sobrescrito. */
  static #onImportDefaults() {
    const missing = missingDefaultArchetypes(this.catalog, defaultNpcArchetypes());
    if (!missing.length) return ui.notifications.info("Nada a trazer: o catálogo já tem todos os arquétipos do padrão.");
    this.catalog.push(...clone(missing));
    this.dirty = true;
    ui.notifications.info(`Do padrão: ${missing.length} arquétipo(s) novo(s). Revise e Salve.`);
    this.render();
  }

  static #onSetWeight(event, target) {
    this.#write(`weights.${target.dataset.attr}`, Number(target.dataset.level), { render: true });
  }

  /** Controles segmentados simples: `data-path` + `data-value`. */
  static #onSetValue(event, target) {
    this.#write(target.dataset.path, target.dataset.value, { render: true });
  }

  static async #onAddSkill() {
    const data = await openSkillEditorDialog({});
    if (!data || !this.entry) return;
    this.entry.skills.push({ ...data, key: archetypeSlug(data.name), always: false });
    this.#normalizeSelected();
    this.dirty = true;
    this.render();
  }

  static async #onEditSkill(event, target) {
    const entry = this.entry;
    const index = Number(target.dataset.index);
    const current = entry?.skills[index];
    if (!current) return;
    const data = await openSkillEditorDialog(current);
    if (!data) return;
    // A chave e o "sempre" não passam pelo editor de Skill.
    entry.skills[index] = { ...current, ...data, key: current.key, always: current.always };
    this.dirty = true;
    this.render();
  }

  static #onRemoveRow(event, target) {
    const list = this.entry?.[target.dataset.list];
    if (!Array.isArray(list)) return;
    list.splice(Number(target.dataset.index), 1);
    this.dirty = true;
    this.render();
  }

  static #onPickImage() {
    const entry = this.entry;
    if (!entry) return;
    pickImageFile(entry.img, path => this.#write("img", path, { render: true }));
  }

  static async #onCancel() {
    this.#load();
    if (!this.entry) this.selected = this.catalog[0]?.id ?? null;
    this.render();
  }

  static async #onSave() {
    const list = this.catalog.map(a => normalizeArchetype(a, MEU_SISTEMA.COMBAT_ATTRIBUTES));
    await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.npcArchetypesData, JSON.stringify(list, null, 2));
    debugLog(`${SYSTEM_ID} | Arquétipos de NPC: ${list.length} salvo(s).`);
    ui.notifications.info("Arquétipos salvos.");
    const keep = this.selected;
    this.#load();
    this.selected = this.catalog.some(a => a.id === keep) ? keep : this.catalog[0]?.id ?? null;
    this.render();
    // O gerador aberto passa a ver o catálogo novo.
    foundry.applications.instances.get("nihility-npc-generator")?.render();
  }
}
