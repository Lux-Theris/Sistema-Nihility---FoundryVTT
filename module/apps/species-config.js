/**
 * Editor de Espécies (board 1 do canvas "Rework de Espécies"): lista agrupada com busca à
 * esquerda; a Espécie escolhida à direita com seis abas — Geral · Corpo · Skills Raciais ·
 * Passivos · Linhagens · Evolução.
 *
 * Trabalha numa CÓPIA do catálogo (`this.catalog`): cada campo grava nela no "change"
 * (`data-path` relativo à Espécie aberta), e "Salvar" grava o catálogo inteiro, normalizado e com
 * a versão subindo onde partes/Skills mudaram (species-rules.js#bumpSpeciesVersions). Chaves são
 * estrutura: a da Espécie, das partes e das Linhagens travam depois de salvas.
 */
import { SYSTEM_ID, MEU_SISTEMA, getActiveSpeciesPresets, debugLog, speciesCarry, getActiveAttributes, getActiveDamageElements, getScaleConfig, getActiveTraits, getActiveStatusConditions } from "../core/config.js";
import { openSkillEditorDialog, mechanicSummaryFor } from "./skill-editor-dialog.js";
import { wireTraitPickerField, wireElementPickerField, selectedTraitChips, selectedElementChips } from "./checklist-picker.js";
import { normalizeSpeciesCatalog, bumpSpeciesVersions, speciesSlug } from "../species/species-rules.js";
import { actorsWithSpecies, syncPreviewFor, openSpeciesSync } from "../species/species.js";
import { WHEN_KINDS, WHEN_LABELS, THEN_KINDS, THEN_LABELS } from "../combat/conditional-modifiers.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TABS = [
  { id: "general", label: "Geral" },
  { id: "body", label: "Corpo" },
  { id: "skills", label: "Skills Raciais" },
  { id: "passives", label: "Passivos" },
  { id: "lineages", label: "Linhagens" },
  { id: "evolution", label: "Evolução" }
];

const clone = value => foundry.utils.deepClone(value);

export class SpeciesConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** "species" aqui; "heritage" na subclasse (apps/heritages-config.js). */
  static KIND = "species";

  static DEFAULT_OPTIONS = {
    id: "nihility-species-config",
    window: { title: "Espécies", resizable: true },
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-species-editor"],
    position: { width: 800, height: 700 },
    actions: {
      selectSpecies: SpeciesConfigApp.#onSelectSpecies,
      selectTab: SpeciesConfigApp.#onSelectTab,
      addSpecies: SpeciesConfigApp.#onAddSpecies,
      duplicateSpecies: SpeciesConfigApp.#onDuplicateSpecies,
      deleteSpecies: SpeciesConfigApp.#onDeleteSpecies,
      addRow: SpeciesConfigApp.#onAddRow,
      removeRow: SpeciesConfigApp.#onRemoveRow,
      moveRow: SpeciesConfigApp.#onMoveRow,
      addRacialSkill: SpeciesConfigApp.#onAddRacialSkill,
      editRacialSkill: SpeciesConfigApp.#onEditRacialSkill,
      toggleLineage: SpeciesConfigApp.#onToggleLineage,
      save: SpeciesConfigApp.#onSave,
      importDefaults: SpeciesConfigApp.#onImportDefaults,
      syncSheets: SpeciesConfigApp.#onSyncSheets
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/species-config.hbs`, scrollable: [".se-list", ".se-body"] }
  };

  constructor(options = {}) {
    super(options);
    this.#loadFromSettings();
    this.selected = Object.keys(this.catalog)[0] ?? null;
    this.tab = "general";
    this.openLineage = 0;
  }

  /* -------------------------------------------- pontos de extensão (HeritagesConfigApp) */

  /** Catálogo salvo, normalizado, como objeto {id: entrada}. */
  _readCatalog() {
    return normalizeSpeciesCatalog(getActiveSpeciesPresets());
  }

  /** Grava o catálogo (já normalizado e versionado). */
  async _writeCatalog(catalog) {
    await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.speciesPresetsData, JSON.stringify(catalog, null, 2));
  }

  _tabs() {
    return TABS;
  }

  _blankEntry() {
    return { label: "Nova Espécie", group: "", availableAtCreation: true, traits: [], parts: [], skills: [] };
  }

  /** O catálogo de fábrica (para "Trazer do padrão…"). */
  _defaultCatalog() {
    return normalizeSpeciesCatalog(MEU_SISTEMA.DEFAULT_SPECIES_PRESETS);
  }

  /** Fichas afetadas por esta entrada (contagem no rodapé e sincronização). */
  _sheetsFor(id) {
    return actorsWithSpecies(id);
  }

  async _syncSheets(id) {
    await openSpeciesSync(id);
  }

  /** Campos extras do contexto (a subclasse de Heranças acrescenta os dela). */
  _extraContext(entry, id) {
    return {};
  }

  /** Catálogo salvo → cópia de trabalho; anota o que já está salvo (chaves travadas). */
  #loadFromSettings() {
    this.catalog = clone(this._readCatalog());
    this.savedIds = new Set(Object.keys(this.catalog));
    this.savedPartKeys = {};
    this.savedLineageIds = {};
    for (const [id, entry] of Object.entries(this.catalog)) {
      this.savedPartKeys[id] = new Set(entry.parts.map(p => p.key));
      this.savedLineageIds[id] = new Set(entry.lineages.map(l => l.id));
    }
    this.dirty = new Set();
  }

  get entry() {
    return this.selected ? this.catalog[this.selected] : null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const groupLabels = MEU_SISTEMA.SPECIES_GROUP_LABELS;
    const groups = {};
    for (const [id, entry] of Object.entries(this.catalog)) {
      const key = entry.group || "";
      (groups[key] ??= { label: groupLabels[key] ?? "Outras", items: [] }).items.push({
        id,
        label: entry.label || id,
        note: entry.availableAtCreation === false ? "GM" : entry.evolvesTo?.length ? "evolui" : entry.lineages?.length ? `${entry.lineages.length} lin.` : "",
        active: id === this.selected,
        dirty: this.dirty.has(id)
      });
    }
    const order = [...Object.keys(groupLabels), ""];
    context.groups = Object.entries(groups)
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([, g]) => ({ ...g, items: g.items.sort((x, y) => x.label.localeCompare(y.label)) }));
    context.isGM = game.user.isGM;
    context.dirtyCount = this.dirty.size;
    context.isHeritage = this.constructor.KIND === "heritage";
    context.nounNew = context.isHeritage ? "+ Nova Herança" : "+ Nova Espécie";
    context.searchPlaceholder = context.isHeritage ? "Buscar Herança…" : "Buscar Espécie…";

    const entry = this.entry;
    if (!entry) return context;
    const id = this.selected;
    const lockedParts = this.savedPartKeys[id] ?? new Set();
    const lockedLineages = this.savedLineageIds[id] ?? new Set();
    const attributes = getActiveAttributes().map(a => ({ key: a.key, label: a.label }));
    const elements = getActiveDamageElements();
    const sheets = this._sheetsFor(id);

    context.sel = {
      id,
      idLocked: this.savedIds.has(id),
      label: entry.label,
      group: entry.group ?? "",
      availableAtCreation: entry.availableAtCreation !== false,
      description: entry.description ?? "",
      scale: entry.scale ?? "",
      movementBase: entry.movement?.base ?? "",
      movementPercent: entry.movement?.percent ?? 0,
      inventorySlots: entry.inventorySlots ?? "",
      carryBase: entry.carryBase ?? "",
      defaultCarry: speciesCarry(undefined, id),
      traitsJson: JSON.stringify(entry.traits ?? []),
      elementsJson: JSON.stringify(entry.elements ?? []),
      chips: [
        `id: ${id}`,
        `${entry.parts.length} partes`,
        `${entry.skills.length} Skills`,
        ...(entry.lineages.length ? [`${entry.lineages.length} Linhagens`] : []),
        ...(entry.evolvesTo.length ? [`evolui → ${entry.evolvesTo.length}`] : []),
        `v${entry.version}`
      ],
      parts: entry.parts.map((p, i) => ({ ...p, index: i, locked: lockedParts.has(p.key), tagsText: (p.tags ?? []).join(", "), first: i === 0, last: i === entry.parts.length - 1 })),
      skills: entry.skills.map((s, i) => ({ index: i, name: s.name, key: s.key, summary: mechanicSummaryFor(s), unlockLevel: s.unlockLevel ?? "" })),
      bonuses: (entry.passives.attributeBonuses ?? []).map((b, i) => ({ ...b, index: i })),
      hpMod: entry.passives.statModifiers?.hp ?? 0,
      energyMod: entry.passives.statModifiers?.energy ?? 0,
      resistances: (entry.passives.resistances ?? []).map((r, i) => ({ ...r, index: i })),
      rules: (entry.passives.conditionalModifiers ?? []).map((r, i) => {
        const whenKind = r.when?.kind || "always";
        const thenKind = r.then?.kind || "attributeFlat";
        const valueSource = { otherTrait: getActiveTraits(), otherCondition: getActiveStatusConditions(), selfCondition: getActiveStatusConditions(), element: elements }[whenKind];
        const targetSource =
          thenKind === "resistancePercent" ? [{ id: "general", label: "Geral" }, ...elements.map(e => ({ id: e.id, label: e.label }))]
          : thenKind === "damagePercent" ? [{ id: "any", label: "—" }]
          : [{ id: "any", label: "qualquer" }, ...attributes.map(a => ({ id: a.key, label: a.label }))];
        return {
          index: i,
          whenKind,
          thenKind,
          value: r.when?.value ?? "",
          threshold: r.when?.threshold ?? 50,
          amount: r.then?.value ?? 0,
          target: r.then?.target ?? "any",
          valueOptions: valueSource ? valueSource.map(o => ({ id: o.id, label: o.label, selected: o.id === r.when?.value })) : null,
          needsThreshold: whenKind === "selfHpBelow",
          targetOptions: targetSource.map(o => ({ ...o, selected: o.id === (r.then?.target ?? "any") }))
        };
      }),
      lineages: entry.lineages.map((l, i) => ({
        index: i,
        id: l.id,
        label: l.label || l.id,
        description: l.description ?? "",
        locked: lockedLineages.has(l.id),
        open: i === this.openLineage,
        traitsJson: JSON.stringify(l.traits ?? []),
        elementsJson: JSON.stringify(l.elements ?? []),
        replaceOptions: entry.skills.map(s => ({ key: s.key, name: s.name, checked: (l.replaces?.skills ?? []).includes(s.key) })),
        skills: (l.skills ?? []).map((s, j) => ({ index: j, name: s.name, summary: mechanicSummaryFor(s) })),
        summary: [
          ...(l.elements ?? []).map(e => elements.find(x => x.id === e)?.label ?? e),
          ...(l.skills ?? []).map(s => s.name)
        ].join(" · ")
      })),
      lineageRequired: Boolean(entry.lineageRequired),
      evolutions: entry.evolvesTo.map((e, i) => ({ ...e, index: i })),
      evolvesFrom: Object.entries(this.catalog)
        .filter(([otherId, other]) => otherId !== id && (other.evolvesTo ?? []).some(e => e.species === id))
        .map(([, other]) => other.label),
      sheetCount: sheets.length,
      outdatedCount: sheets.filter(a => syncPreviewFor(a)).length
    };
    context.tabs = this._tabs().map(t => ({
      ...t,
      active: t.id === this.tab,
      count: { body: entry.parts.length + (this._tabs().some(x => x.id === "skills") ? 0 : entry.skills.length), skills: entry.skills.length, rules: (entry.excludes?.length ?? 0) + (entry.allowedSpecies?.list?.length ?? 0), passives: (entry.passives.attributeBonuses?.length ?? 0) + (entry.passives.resistances?.length ?? 0) + (entry.passives.conditionalModifiers?.length ?? 0), lineages: entry.lineages.length, evolution: entry.evolvesTo.length }[t.id] || ""
    }));
    context.tab = this.tab;
    context.attributes = attributes;
    context.elements = elements.map(e => ({ id: e.id, label: e.label }));
    context.resistanceTargets = [{ id: "general", label: "Geral" }, ...context.elements];
    context.scales = getScaleConfig().scales;
    context.groupOptions = Object.entries(MEU_SISTEMA.SPECIES_GROUP_LABELS).map(([key, label]) => ({ key, label }));
    context.otherSpecies = Object.entries(this.catalog).filter(([o]) => o !== id).map(([o, e]) => ({ id: o, label: e.label || o }));
    context.whenKinds = WHEN_KINDS.map(k => ({ key: k, label: WHEN_LABELS[k] }));
    Object.assign(context, this._extraContext(entry, id));
    context.thenKinds = THEN_KINDS.map(k => ({ key: k, label: THEN_LABELS[k] }));
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    // Busca: só esconde linhas, sem redesenhar (não perde o foco).
    root.querySelector(".se-search")?.addEventListener("input", event => {
      const q = event.currentTarget.value.trim().toLowerCase();
      root.querySelectorAll(".se-li").forEach(li => li.classList.toggle("hidden", Boolean(q) && !li.dataset.label.toLowerCase().includes(q)));
    });
    root.querySelectorAll("[data-path]").forEach(el => el.addEventListener("change", this.#onFieldChange.bind(this)));
    root.querySelectorAll(".se-picker[data-picker]").forEach(el => {
      const onChange = ids => this.#write(el.dataset.picker, ids);
      if (el.dataset.kind === "traits") wireTraitPickerField(el, { onChange });
      else if (el.dataset.kind === "elements") wireElementPickerField(el, { onChange });
      else this._wireCustomPicker(el, onChange);
    });
  }

  /** Campos de escolha que não são Traço/Elemento (a subclasse de Heranças usa para Espécies/Heranças). */
  _wireCustomPicker(el, onChange) {}

  /** Grava um valor na Espécie aberta (cópia de trabalho) e marca como alterada. */
  #write(path, value, { render = false } = {}) {
    const entry = this.entry;
    if (!entry) return;
    foundry.utils.setProperty(entry, path, value);
    this.dirty.add(this.selected);
    if (render) this.render();
  }

  #onFieldChange(event) {
    const el = event.currentTarget;
    const path = el.dataset.path;
    const kind = el.dataset.kind ?? "text";
    let value = el.type === "checkbox" ? el.checked : el.value;
    if (kind === "int") value = Math.round(Number(value) || 0);
    else if (kind === "number") value = Number(value) || 0;
    else if (kind === "optint") value = value === "" ? null : Math.max(0, Math.round(Number(value) || 0));
    else if (kind === "tags") value = String(value).split(",").map(t => t.trim()).filter(Boolean);
    else if (kind === "listToggle") {
      const list = new Set(foundry.utils.getProperty(this.entry, path) ?? []);
      if (el.checked) list.add(el.value);
      else list.delete(el.value);
      value = [...list];
    }
    if (path === "__id") return this.#renameSpecies(String(value).trim());
    // Chave nova de parte/Linhagem: normaliza (sem espaço/acento).
    if (/\.(key|id)$/.test(path)) value = speciesSlug(value);
    this.#write(path, value, { render: el.dataset.render === "1" || /label$|\.key$|\.id$/.test(path) });
  }

  /** Só Espécie ainda não salva pode mudar de chave. */
  #renameSpecies(newId) {
    const oldId = this.selected;
    const id = speciesSlug(newId);
    if (!id || id === oldId || this.savedIds.has(oldId)) return this.render();
    if (this.catalog[id]) {
      ui.notifications.warn(`Já existe uma Espécie com a chave "${id}".`);
      return this.render();
    }
    this.catalog[id] = this.catalog[oldId];
    delete this.catalog[oldId];
    this.dirty.delete(oldId);
    this.dirty.add(id);
    this.selected = id;
    this.render();
  }

  /* -------------------------------------------- actions */

  static #onSelectSpecies(event, target) {
    this.selected = target.dataset.id;
    this.openLineage = 0;
    this.render();
  }

  static #onSelectTab(event, target) {
    this.tab = target.dataset.tab;
    this.render();
  }

  static #onAddSpecies() {
    const base = this.constructor.KIND === "heritage" ? "nova_heranca" : "nova_especie";
    let id = base;
    for (let n = 2; this.catalog[id]; n++) id = `${base}_${n}`;
    this.catalog[id] = normalizeSpeciesCatalog({ [id]: this._blankEntry() })[id];
    this.dirty.add(id);
    this.selected = id;
    this.tab = "general";
    this.render();
  }

  static #onDuplicateSpecies() {
    const entry = this.entry;
    if (!entry) return;
    let id = `${this.selected}_copia`;
    for (let n = 2; this.catalog[id]; n++) id = `${this.selected}_copia_${n}`;
    this.catalog[id] = { ...clone(entry), label: `${entry.label} (cópia)`, version: 1 };
    this.dirty.add(id);
    this.selected = id;
    this.render();
  }

  static async #onDeleteSpecies() {
    const id = this.selected;
    if (!id) return;
    const sheets = actorsWithSpecies(id).length;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Remover Espécie" },
      content: `<p>Remover <b>${foundry.utils.escapeHTML(this.catalog[id].label || id)}</b> do catálogo?${sheets ? ` ${sheets} ficha(s) usam esta Espécie: elas não mudam, mas o Validar Mundo vai apontá-las.` : ""}</p><p>Só vale depois de Salvar.</p>`
    });
    if (!ok) return;
    delete this.catalog[id];
    this.dirty.add(id);
    this.selected = Object.keys(this.catalog)[0] ?? null;
    this.render();
  }

  /** "+" genérico: `data-list` é o caminho do array dentro da Espécie; `data-template` o tipo de linha. */
  static #onAddRow(event, target) {
    const entry = this.entry;
    if (!entry) return;
    const path = target.dataset.list;
    const list = clone(foundry.utils.getProperty(entry, path) ?? []);
    const templates = {
      part: () => ({ key: "", label: "", slot: "body", hpMax: 10, tags: [] }),
      bonus: () => ({ attribute: "strength", amount: 1 }),
      resistance: () => ({ target: "general", amount: 10 }),
      rule: () => ({ when: { kind: "always", value: "", threshold: 50 }, then: { kind: "attributeFlat", target: "any", value: 1 }, perEach: "" }),
      lineage: () => {
        let lid = "nova_linhagem";
        for (let n = 2; entry.lineages.some(l => l.id === lid); n++) lid = `nova_linhagem_${n}`;
        return { id: lid, label: "Nova Linhagem", description: "", traits: [], elements: [], skills: [], parts: [], passives: {}, replaces: { skills: [], parts: [] } };
      },
      evolution: () => ({ species: Object.keys(this.catalog).find(o => o !== this.selected) ?? "", minLevel: null, hint: "", keepLineage: true, resistancesToImmunity: false })
    };
    list.push(templates[target.dataset.template]());
    this.#write(path, list, { render: true });
    if (target.dataset.template === "lineage") {
      this.openLineage = list.length - 1;
      this.render();
    }
  }

  static #onRemoveRow(event, target) {
    const path = target.dataset.list;
    const list = clone(foundry.utils.getProperty(this.entry, path) ?? []);
    list.splice(Number(target.dataset.index), 1);
    this.#write(path, list, { render: true });
  }

  static #onMoveRow(event, target) {
    const path = target.dataset.list;
    const list = clone(foundry.utils.getProperty(this.entry, path) ?? []);
    const i = Number(target.dataset.index);
    const j = i + Number(target.dataset.dir);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.#write(path, list, { render: true });
  }

  /** `data-list`: "skills" (da Espécie) ou "lineages.N.skills". */
  static async #onAddRacialSkill(event, target) {
    const data = await openSkillEditorDialog({}, { lockTier: "racial" });
    if (!data) return;
    const path = target.dataset.list;
    const list = clone(foundry.utils.getProperty(this.entry, path) ?? []);
    const used = new Set([...this.entry.skills.map(s => s.key), ...this.entry.lineages.flatMap(l => (l.skills ?? []).map(s => s.key))]);
    let key = speciesSlug(data.name);
    for (let n = 2; used.has(key); n++) key = `${speciesSlug(data.name)}_${n}`;
    list.push({ ...data, key });
    this.#write(path, list, { render: true });
  }

  static async #onEditRacialSkill(event, target) {
    const path = `${target.dataset.list}.${target.dataset.index}`;
    const current = foundry.utils.getProperty(this.entry, path) ?? {};
    const data = await openSkillEditorDialog(current, { lockTier: "racial" });
    if (!data) return;
    // A chave e o nível de liberação não passam pelo editor de Skill: sem isto, renomear a Skill
    // gerava chave nova e as fichas a perdiam (com nível e XP) na próxima sincronização.
    this.#write(path, { ...data, key: current.key, ...(current.unlockLevel ? { unlockLevel: current.unlockLevel } : {}) }, { render: true });
  }

  static #onToggleLineage(event, target) {
    const i = Number(target.dataset.index);
    this.openLineage = this.openLineage === i ? -1 : i;
    this.render();
  }

  static async #onSave() {
    const previous = this._readCatalog();
    // Linha de parte/Skill/Linhagem sem chave nem nome é descartada; chave vazia vira slug do nome.
    for (const entry of Object.values(this.catalog)) {
      entry.parts = (entry.parts ?? []).filter(p => p.key || p.label).map(p => ({ ...p, key: p.key || speciesSlug(p.label), label: p.label || p.key }));
      entry.lineages = (entry.lineages ?? []).filter(l => l.id || l.label).map(l => ({ ...l, id: l.id || speciesSlug(l.label) }));
    }
    const saved = bumpSpeciesVersions(previous, normalizeSpeciesCatalog(this.catalog));
    await this._writeCatalog(saved);
    debugLog(`${SYSTEM_ID} | ${this.constructor.name}: ${Object.keys(saved).length} entrada(s) salva(s).`);
    ui.notifications.info(this.constructor.KIND === "heritage" ? "Heranças salvas." : "Espécies salvas.");
    const keep = this.selected;
    this.#loadFromSettings();
    this.selected = this.catalog[keep] ? keep : Object.keys(this.catalog)[0] ?? null;
    this.render();
  }

  /**
   * Traz do padrão de fábrica só o que FALTA: entradas novas (ex.: Slime Demoníaco, Kijin) e, nas
   * que já existem, Linhagens/Evolução quando a entrada salva não tem nenhuma. Nada que o Mestre
   * editou é sobrescrito. Fica na cópia de trabalho: vale depois de Salvar.
   */
  static async #onImportDefaults() {
    const defaults = this._defaultCatalog();
    let added = 0;
    let extended = 0;
    for (const [id, entry] of Object.entries(defaults)) {
      const current = this.catalog[id];
      if (!current) {
        this.catalog[id] = clone(entry);
        this.dirty.add(id);
        added += 1;
        continue;
      }
      let touched = false;
      for (const key of ["lineages", "evolvesTo"]) {
        if (!(current[key] ?? []).length && (entry[key] ?? []).length) {
          current[key] = clone(entry[key]);
          touched = true;
        }
      }
      if (entry.lineageRequired && current.lineageRequired === undefined) current.lineageRequired = true;
      if (touched) {
        this.dirty.add(id);
        extended += 1;
      }
    }
    ui.notifications.info(added || extended ? `Do padrão: ${added} nova(s), ${extended} com Linhagens/Evolução acrescentadas. Revise e Salve.` : "Nada a trazer: o catálogo já tem tudo o que o padrão tem.");
    this.render();
  }

  static async #onSyncSheets() {
    if (!game.user.isGM || !this.selected) return;
    if (this.dirty.has(this.selected)) {
      ui.notifications.warn("Salve antes de sincronizar as fichas.");
      return;
    }
    await this._syncSheets(this.selected);
    this.render();
  }
}
