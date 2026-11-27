/**
 * Catálogo de Conjuntos (J12, 1.122.0; mockup aprovado "Catálogo de Conjuntos"): a lista de conjuntos à esquerda; o
 * escolhido à direita com nome, "Para" (Personagem ou Nave/Veículo), as PEÇAS (arraste um Item do mundo, de um Compêndio
 * ou de uma ficha para a caixa) e os BÔNUS POR FAIXA ("+ bônus" abre o mesmo vocabulário do "Enquanto equipado" do Item:
 * atributo, Vida/Mana, Resistência, Sorte, Quando → Então e Habilidade concedida; o conjunto de Nave troca por Evasão,
 * Assinatura, Escudo, Casco e energia).
 *
 * Trabalha numa CÓPIA (`this.sets`): cada campo grava nela no "change" (`data-path` relativo ao conjunto aberto) e "Salvar"
 * grava o catálogo inteiro, normalizado. Arrastar uma peça só anota o Item (`this.pending`): o campo "Conjunto" dele é
 * gravado no Salvar. Tirar a peça do catálogo não apaga o campo do Item (o Validar Mundo avisa o que sobrar).
 */
import { SYSTEM_ID, NIHILITY, getActiveItemSets, getActiveAttributes, getActiveDamageElements, getActiveTraits, getActiveStatusConditions, isFeatureEnabled } from "../core/config.js";
import { openSkillEditorDialog } from "./skill-editor-dialog.js";
import { getDragEventData } from "../helpers/foundry-compat.js";
import { WHEN_KINDS, WHEN_LABELS, THEN_KINDS, THEN_LABELS } from "../combat/conditional-modifiers.js";
import {
  SET_FOR_LABELS,
  SHIP_BONUS_TARGETS,
  SHIP_BONUS_LABELS,
  addPiece,
  describeBonuses,
  missingFactorySets,
  normalizeItemSets,
  setSlug
} from "../economy/item-set-rules.js";
import { pieceFromItem, pieceRefusal, writeItemSet, ensureFactorySetItems } from "../economy/item-sets.js";
import { reportError } from "../helpers/report.js";
import { escapeHtml } from "../helpers/html.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const clone = value => foundry.utils.deepClone(value);

/** As linhas "Quando → Então" de uma faixa, com as opções de cada menu (como o editor de Espécies). */
function ruleRows(list, { attributes, elements }) {
  return (list ?? []).map((r, i) => {
    const whenKind = r.when?.kind || "always";
    const thenKind = r.then?.kind || "attributeFlat";
    const valueSource = { otherTrait: getActiveTraits(), otherCondition: getActiveStatusConditions(), otherConditionMine: getActiveStatusConditions(), selfCondition: getActiveStatusConditions(), element: elements }[whenKind];
    const targetSource = thenKind === "resistancePercent"
      ? [{ id: "general", label: "Geral" }, ...elements.map(e => ({ id: e.id, label: e.label }))]
      : thenKind === "damagePercent" ? [{ id: "any", label: "—" }]
        : [{ id: "any", label: "qualquer" }, ...attributes.map(a => ({ id: a.key, label: a.label }))];
    return {
      index: i,
      whenKind,
      thenKind,
      threshold: r.when?.threshold ?? 50,
      amount: r.then?.value ?? 0,
      valueOptions: valueSource ? valueSource.map(o => ({ id: o.id, label: o.label, selected: o.id === r.when?.value })) : null,
      needsThreshold: whenKind === "selfHpBelow" || whenKind === "otherHpBelow",
      targetOptions: targetSource.map(o => ({ id: o.id, label: o.label, selected: o.id === (r.then?.target ?? "any") }))
    };
  });
}

/** Abre (ou traz à frente) o catálogo; `fromItem` abre já com um conjunto novo que tem este Item como peça. */
export function openItemSetsConfig({ fromItem = null } = {}) {
  const app = new ItemSetsConfigApp({ fromItem });
  app.render(true);
  return app;
}

export class ItemSetsConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-item-sets",
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-item-sets"],
    window: { title: "Conjuntos", icon: "fa-solid fa-layer-group", resizable: true },
    position: { width: 940, height: 720 },
    actions: {
      selectSet: ItemSetsConfigApp.#onSelectSet,
      addSet: ItemSetsConfigApp.#onAddSet,
      removeSet: ItemSetsConfigApp.#onRemoveSet,
      aiSet: ItemSetsConfigApp.#onAiSet,
      importDefaults: ItemSetsConfigApp.#onImportDefaults,
      removePiece: ItemSetsConfigApp.#onRemovePiece,
      addTier: ItemSetsConfigApp.#onAddTier,
      removeTier: ItemSetsConfigApp.#onRemoveTier,
      toggleTier: ItemSetsConfigApp.#onToggleTier,
      addRow: ItemSetsConfigApp.#onAddRow,
      removeRow: ItemSetsConfigApp.#onRemoveRow,
      editSkill: ItemSetsConfigApp.#onEditSkill,
      clearSkill: ItemSetsConfigApp.#onClearSkill,
      cancel: ItemSetsConfigApp.#onCancel,
      save: ItemSetsConfigApp.#onSave
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/item-sets-config.hbs`, scrollable: [".is-main", ".is-list"] }
  };

  constructor(options = {}) {
    const { fromItem = null, ...rest } = options;
    super(rest);
    this.#load();
    if (fromItem) this.#startFromItem(fromItem);
  }

  #load() {
    this.sets = clone(getActiveItemSets());
    this.savedIds = new Set(this.sets.map(s => s.id));
    this.selected = this.sets[0]?.id ?? null;
    this.openTier = null;
    this.pending = new Map();
    this.dirty = false;
  }

  get set() {
    return this.sets.find(s => s.id === this.selected) ?? null;
  }

  #uniqueId(label) {
    const base = setSlug(label) || "conjunto";
    let id = base;
    for (let n = 2; this.sets.some(s => s.id === id); n++) id = `${base}_${n}`;
    return id;
  }

  #newSet({ label = "Novo conjunto", forKind = "character", pieces = [], tiers = null } = {}) {
    const set = {
      id: this.#uniqueId(label),
      label,
      for: forKind,
      pieces,
      tiers: tiers ?? [{ count: 2, bonuses: {} }, { count: 3, bonuses: {} }]
    };
    this.sets.push(set);
    this.selected = set.id;
    this.openTier = null;
    this.dirty = true;
    return set;
  }

  #startFromItem(item) {
    const vessel = item.type === "starship_module";
    const set = this.#newSet({ label: `Conjunto de ${item.name}`, forKind: vessel ? "vessel" : "character", pieces: addPiece([], pieceFromItem(item)) });
    this.pending.set(item.uuid, set.id);
  }

  /* -------------------------------------------- contexto */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const attributes = getActiveAttributes();
    const elements = getActiveDamageElements();
    const labels = {
      attributeLabel: key => attributes.find(a => a.key === key)?.label ?? key,
      targetLabel: id => elements.find(e => e.id === id)?.label ?? id,
      energyLabel: "Mana"
    };
    context.sets = this.sets.map(s => ({ id: s.id, label: s.label || s.id, selected: s.id === this.selected, forLabel: SET_FOR_LABELS[s.for] }));
    context.hasSets = this.sets.length > 0;
    context.aiOn = isFeatureEnabled("aiAssistant");
    const set = this.set;
    context.sel = null;
    if (set) {
      const vessel = set.for === "vessel";
      context.sel = {
        id: set.id,
        label: set.label,
        vessel,
        locked: this.savedIds.has(set.id),
        forOptions: Object.entries(SET_FOR_LABELS).map(([id, label]) => ({ id, label, selected: id === set.for })),
        total: set.pieces.length,
        pieces: set.pieces.map((p, i) => ({ index: i, name: p.name, kind: p.kind ?? "", linked: Boolean(p.uuid) })),
        tiers: set.tiers.map((tier, i) => {
          const open = this.openTier === i;
          const bonuses = tier.bonuses ?? {};
          const row = {
            index: i,
            count: tier.count,
            open,
            overflow: set.pieces.length > 0 && tier.count > set.pieces.length,
            summary: describeBonuses(bonuses, labels).join(" · ") || "sem bônus ainda"
          };
          if (open) {
            row.attributes = (bonuses.attributeBonuses ?? []).map((b, j) => ({
              index: j,
              amount: b.amount,
              options: attributes.map(a => ({ id: a.key, label: a.label, selected: a.key === b.attribute }))
            }));
            row.hp = bonuses.statModifiers?.hp ?? 0;
            row.energy = bonuses.statModifiers?.energy ?? 0;
            row.resistances = (bonuses.resistances ?? []).map((r, j) => ({
              index: j,
              amount: r.amount,
              options: [{ id: "general", label: "Geral", selected: r.target === "general" }, ...elements.map(e => ({ id: e.id, label: e.label, selected: e.id === r.target }))]
            }));
            row.luck = { attributes: bonuses.luck?.attributes ?? 0, damage: bonuses.luck?.damage ?? 0, chances: bonuses.luck?.chances ?? 0 };
            row.rules = ruleRows(bonuses.conditionalModifiers, { attributes, elements });
            row.skillName = bonuses.grantsSkill?.name ?? "";
            row.ship = (bonuses.ship ?? []).map((s, j) => ({
              index: j,
              amount: s.amount,
              options: SHIP_BONUS_TARGETS.map(id => ({ id, label: SHIP_BONUS_LABELS[id], selected: id === s.target }))
            }));
          }
          return row;
        })
      };
    }
    context.whenKinds = WHEN_KINDS.map(k => ({ key: k, label: WHEN_LABELS[k] }));
    context.thenKinds = THEN_KINDS.map(k => ({ key: k, label: THEN_LABELS[k] }));
    context.dirty = this.dirty;
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    root.querySelectorAll("[data-path]").forEach(el => el.addEventListener("change", event => this.#onFieldChange(event)));
    const drop = root.querySelector(".is-drop");
    if (drop) {
      drop.addEventListener("dragover", event => {
        event.preventDefault();
        drop.classList.add("over");
      });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", event => this.#onDropPiece(event));
    }
  }

  /* -------------------------------------------- edição */

  #write(path, value, { render = false } = {}) {
    const set = this.set;
    if (!set) return;
    foundry.utils.setProperty(set, path, value);
    this.dirty = true;
    this.element?.querySelector(".is-dirty")?.classList.remove("hidden");
    if (render) this.render();
  }

  #onFieldChange(event) {
    const el = event.currentTarget;
    const kind = el.dataset.kind ?? "text";
    let value = el.type === "checkbox" ? el.checked : el.value;
    if (kind === "int") value = Math.round(Number(value) || 0);
    else if (kind === "number") value = Number(value) || 0;
    if (el.dataset.path === "id") return this.#renameSet(String(value));
    this.#write(el.dataset.path, value, { render: el.dataset.render === "1" });
  }

  /** Só um conjunto ainda não salvo troca de id (o id é o que os Itens guardam). */
  #renameSet(text) {
    const set = this.set;
    if (!set || this.savedIds.has(set.id)) return this.render();
    const id = setSlug(text);
    if (!id || id === set.id) return this.render();
    if (this.sets.some(s => s.id === id)) {
      ui.notifications.warn(`Já existe um conjunto com o id "${id}".`);
      return this.render();
    }
    for (const [uuid, setId] of this.pending) if (setId === set.id) this.pending.set(uuid, id);
    set.id = id;
    this.selected = id;
    this.dirty = true;
    this.render();
  }

  async #onDropPiece(event) {
    event.preventDefault();
    event.currentTarget.classList.remove("over");
    const set = this.set;
    const data = getDragEventData(event);
    if (!set || !data?.uuid) return ui.notifications.warn("Arraste um Item (do mundo, de um Compêndio ou de uma ficha).");
    const doc = await fromUuid(data.uuid);
    const refusal = pieceRefusal(set, doc);
    if (refusal) return ui.notifications.warn(refusal);
    set.pieces = addPiece(set.pieces, pieceFromItem(doc));
    this.pending.set(doc.uuid, set.id);
    this.dirty = true;
    this.render();
  }

  /* -------------------------------------------- ações */

  static #onSelectSet(event, target) {
    this.selected = target.dataset.id;
    this.openTier = null;
    this.render();
  }

  static #onAddSet() {
    this.#newSet();
    this.render();
  }

  static async #onRemoveSet() {
    const set = this.set;
    if (!set) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Tirar conjunto" },
      content: `<div><p>Tirar o conjunto "${escapeHtml(set.label)}" do catálogo? Os Itens que o têm no campo "Conjunto" ficam como estão (o Validar Mundo avisa), e a faixa deixa de contar na hora.</p></div>`
    });
    if (!ok) return;
    this.sets = this.sets.filter(s => s.id !== set.id);
    this.selected = this.sets[0]?.id ?? null;
    this.dirty = true;
    this.render();
  }

  static async #onAiSet() {
    if (!isFeatureEnabled("aiAssistant")) return ui.notifications.warn("O Assistente de IA está desligado nos Módulos do Sistema.");
    const answer = await foundry.applications.api.DialogV2.wait({
      window: { title: "Criar conjunto com IA" },
      content: `<div class="nihility-set-ai"><label>Descreva o conjunto<textarea name="prompt" rows="4" placeholder="Ex.: armadura de couro de lobo, 4 peças, bônus de Destreza e Resistência a Gelo"></textarea></label>
        <label>Para <select name="for"><option value="character">Personagem</option><option value="vessel">Nave/Veículo</option></select></label></div>`,
      buttons: [
        { action: "ok", label: "Gerar", default: true, callback: (event, button, dialog) => ({ prompt: dialog.element.querySelector('[name="prompt"]').value.trim(), forKind: dialog.element.querySelector('[name="for"]').value }) },
        { action: "cancel", label: "Cancelar", callback: () => null }
      ],
      rejectClose: false
    });
    if (!answer?.prompt) return;
    try {
      const { generateItemSetFromAI } = await import("../ai/ai-generation.js");
      const generated = await generateItemSetFromAI(answer.prompt, { forKind: answer.forKind, existingIds: new Set(this.sets.map(s => s.id)) });
      this.sets.push(generated);
      this.selected = generated.id;
      this.openTier = null;
      this.dirty = true;
      ui.notifications.info(`"${generated.label}" gerado. Arraste os Itens reais para as peças e Salve.`);
      this.render();
    } catch (err) {
      reportError("Não consegui gerar o conjunto com a IA.", err, { notify: true });
    }
  }

  static async #onImportDefaults() {
    const missing = missingFactorySets(this.sets, NIHILITY.DEFAULT_ITEM_SETS);
    let seeded = 0;
    try {
      seeded = await ensureFactorySetItems();
    } catch (err) {
      reportError("Não consegui criar as peças de fábrica nos Compêndios.", err, { notify: true });
    }
    if (!missing.length) return ui.notifications.info(`Nada a trazer: o catálogo já tem todos os conjuntos de fábrica.${seeded ? ` ${seeded} peça(s) recriada(s) nos Compêndios.` : ""}`);
    this.sets.push(...clone(missing));
    this.dirty = true;
    ui.notifications.info(`Do padrão: ${missing.map(s => s.label).join(", ")}. Revise e Salve.`);
    this.render();
  }

  static #onRemovePiece(event, target) {
    const set = this.set;
    if (!set) return;
    set.pieces.splice(Number(target.dataset.index), 1);
    this.dirty = true;
    this.render();
  }

  static #onAddTier() {
    const set = this.set;
    if (!set) return;
    const next = Math.max(1, ...set.tiers.map(t => t.count)) + 1;
    set.tiers.push({ count: set.tiers.length ? next : 2, bonuses: {} });
    this.openTier = set.tiers.length - 1;
    this.dirty = true;
    this.render();
  }

  static #onRemoveTier(event, target) {
    const set = this.set;
    if (!set) return;
    set.tiers.splice(Number(target.dataset.index), 1);
    this.openTier = null;
    this.dirty = true;
    this.render();
  }

  static #onToggleTier(event, target) {
    const index = Number(target.dataset.index);
    this.openTier = this.openTier === index ? null : index;
    this.render();
  }

  /** "+" genérico: `data-list` é o caminho da lista dentro do conjunto; `data-template` o tipo de linha. */
  static #onAddRow(event, target) {
    const set = this.set;
    if (!set) return;
    const path = target.dataset.list;
    const list = clone(foundry.utils.getProperty(set, path) ?? []);
    const templates = {
      attribute: () => ({ attribute: getActiveAttributes()[0]?.key ?? "strength", amount: 1 }),
      resistance: () => ({ target: "general", amount: 10 }),
      rule: () => ({ when: { kind: "always", value: "", threshold: 50 }, then: { kind: "attributeFlat", target: "any", value: 1 }, perEach: "" }),
      ship: () => ({ target: "evasion", amount: 5 })
    };
    list.push(templates[target.dataset.template]());
    this.#write(path, list, { render: true });
  }

  static #onRemoveRow(event, target) {
    const set = this.set;
    if (!set) return;
    const path = target.dataset.list;
    const list = clone(foundry.utils.getProperty(set, path) ?? []);
    list.splice(Number(target.dataset.index), 1);
    this.#write(path, list, { render: true });
  }

  static async #onEditSkill(event, target) {
    const set = this.set;
    if (!set) return;
    const path = `tiers.${Number(target.dataset.index)}.bonuses.grantsSkill`;
    const current = clone(foundry.utils.getProperty(set, path) ?? {});
    const data = await openSkillEditorDialog({ ...current, subSkills: [] }, { tierChoices: NIHILITY.ITEM_GRANTABLE_SKILL_TIERS, levelReadonly: false, offerTemplates: false });
    if (!data) return;
    this.#write(path, { ...data, subSkills: current.subSkills ?? [] }, { render: true });
  }

  static #onClearSkill(event, target) {
    const set = this.set;
    if (!set) return;
    const tier = set.tiers[Number(target.dataset.index)];
    if (tier?.bonuses) delete tier.bonuses.grantsSkill;
    this.dirty = true;
    this.render();
  }

  static #onCancel() {
    this.#load();
    this.render();
  }

  static async #onSave() {
    const list = normalizeItemSets(this.sets);
    await game.settings.set(SYSTEM_ID, NIHILITY.SETTINGS.itemSetsData, JSON.stringify(list, null, 2));
    // O campo "Conjunto" dos Itens arrastados (só os que ainda são peça de um conjunto que existe).
    let failed = 0;
    for (const [uuid, setId] of this.pending) {
      const set = list.find(s => s.id === setId);
      if (!set) continue;
      if (!(await writeItemSet(uuid, setId))) failed++;
    }
    ui.notifications.info(`Conjuntos salvos (${list.length}).${failed ? ` ${failed} Item(ns) não aceitaram o campo.` : ""}`);
    this.#load();
    this.render();
  }
}
