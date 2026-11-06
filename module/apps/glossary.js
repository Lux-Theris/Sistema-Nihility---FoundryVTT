/**
 * Janela do Glossário (1.85.0; design aprovado: artefato "Glossário do Mundo", pranchas 1–4).
 * Uma janela só, para jogador e Mestre: busca no topo, termos por assunto à esquerda, o verbete à
 * direita com links para os outros termos, "← Voltar" e "Veja também". O Mestre ainda vê os
 * filtros (Falta explicar, Reescritos, Da mesa, Só o Mestre), edita a explicação de qualquer
 * verbete, cria termos da mesa e pode "Ver como jogador".
 *
 * Tudo é calculado na hora de abrir (glossary.js → glossary-rules.js): renomear a energia, um
 * atributo ou uma Condição já aparece certo, sem "Atualizar".
 */
import { SYSTEM_ID } from "../core/config.js";
import { escapeHtml } from "../helpers/html.js";
import {
  buildGlossary,
  linkSegments,
  searchGlossary,
  glossaryCounts,
  filterGlossary,
  groupOrder,
  SYSTEM_TERMS
} from "../glossary/glossary-rules.js";
import {
  gatherGlossaryWorld,
  saveGlossaryEntry,
  resetGlossaryTerm,
  addCustomTerm,
  deleteCustomTerm
} from "../glossary/glossary.js";
import { reportError } from "../helpers/report.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

const KIND_LABELS = {
  system: "termo do sistema",
  attribute: "atributo deste mundo",
  condition: "Condição do catálogo",
  element: "Elemento do catálogo",
  species: "Espécie",
  heritage: "Herança",
  trait: "Traço do catálogo",
  custom: "termo da mesa"
};

/** Rótulo do campo de explicação, por tipo de verbete. */
const EXPLANATION_LABELS = { condition: "Na mesa", element: "Explicação", trait: "Explicação", species: "Descrição", heritage: "Descrição" };

const FILTERS = [
  ["all", "Tudo"],
  ["missing", "Falta explicar"],
  ["rewritten", "Reescritos pelo Mestre"],
  ["custom", "Da mesa"],
  ["gmOnly", "Só o Mestre"]
];

/** Ordem dos termos de sistema na lista: a do código (vai do mais básico ao mais avançado). */
const SYSTEM_ORDER = Object.fromEntries(SYSTEM_TERMS.map(([key], i) => [key, i]));

/** Pedaços de texto com links → HTML (tudo escapado; o link é um botão com a chave). */
function linkedHtml(segments) {
  return segments
    .map(s => (s.key ? `<button type="button" class="gl-link" data-action="openTerm" data-key="${escapeHtml(s.key)}">${escapeHtml(s.text)}</button>` : escapeHtml(s.text)))
    .join("");
}

export class GlossaryApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-glossary",
    classes: [SYSTEM_ID, "nihility-glossary"],
    window: { title: "Glossário", resizable: true, icon: "fas fa-book-open" },
    position: { width: 900, height: 660 },
    actions: {
      openTerm: GlossaryApp.#onOpenTerm,
      back: GlossaryApp.#onBack,
      setFilter: GlossaryApp.#onSetFilter,
      edit: GlossaryApp.#onEdit,
      cancelEdit: GlossaryApp.#onCancelEdit,
      saveEdit: GlossaryApp.#onSaveEdit,
      resetTerm: GlossaryApp.#onResetTerm,
      deleteTerm: GlossaryApp.#onDeleteTerm,
      addTerm: GlossaryApp.#onAddTerm,
      saveNew: GlossaryApp.#onSaveNew,
      togglePlayerView: GlossaryApp.#onTogglePlayerView,
      openCatalog: GlossaryApp.#onOpenCatalog
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/glossary.hbs`, scrollable: [".gl-list", ".gl-entry"] }
  };

  constructor(options = {}) {
    super(options);
    this.current = "";
    this.history = [];
    this.query = "";
    this.filter = "all";
    this.editing = false;
    this.adding = false;
    this.asPlayer = false;
  }

  /** Abre (ou traz para frente) a janela, opcionalmente num verbete. */
  static open(key = "") {
    const existing = foundry.applications.instances.get("nihility-glossary");
    const app = existing ?? new GlossaryApp();
    if (key) app.goTo(key, { keepHistory: Boolean(existing) });
    app.render(true);
    if (existing) existing.bringToFront?.();
    return app;
  }

  goTo(key, { keepHistory = true } = {}) {
    if (!key || key === this.current) return;
    if (keepHistory && this.current) this.history.push(this.current);
    this.current = key;
    this.editing = false;
    this.adding = false;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const isGM = game.user.isGM;
    const gmView = isGM && !this.asPlayer;
    const entries = buildGlossary(gatherGlossaryWorld({ asPlayerPreview: isGM && this.asPlayer }), { isGM: gmView });
    const byKey = new Map(entries.map(e => [e.key, e]));
    const pool = gmView ? filterGlossary(entries, this.filter) : entries;

    if (!byKey.has(this.current)) this.current = byKey.has("energy") ? "energy" : entries[0]?.key ?? "";
    const entry = byKey.get(this.current) ?? null;

    // A lista: busca (plana, com o trecho) ou por assunto.
    const query = this.query.trim();
    let results = [];
    let groups = [];
    if (query) {
      results = searchGlossary(pool, query).map(r => {
        const s = r.snippet;
        const snippetHtml =
          r.matchStart >= 0
            ? `${escapeHtml(s.slice(0, r.matchStart))}<mark>${escapeHtml(s.slice(r.matchStart, r.matchStart + r.matchLength))}</mark>${escapeHtml(s.slice(r.matchStart + r.matchLength))}`
            : escapeHtml(s);
        return { key: r.entry.key, term: r.entry.term, group: r.entry.group, snippetHtml, active: r.entry.key === this.current, missing: r.entry.missing, gmOnly: r.entry.gmOnly && gmView };
      });
    } else {
      groups = groupOrder(pool).map(group => ({
        label: group,
        items: pool
          .filter(e => e.group === group)
          .sort((a, b) => (a.kind === "system" && b.kind === "system" ? SYSTEM_ORDER[a.key] - SYSTEM_ORDER[b.key] : a.term.localeCompare(b.term)))
          .map(e => ({ key: e.key, term: e.term, active: e.key === this.current, missing: e.missing && gmView, gmOnly: e.gmOnly && gmView }))
      }));
    }

    let view = null;
    if (entry) {
      const isCatalog = ["condition", "element", "trait", "species", "heritage", "attribute"].includes(entry.kind);
      view = {
        key: entry.key,
        term: entry.term,
        kindLabel: KIND_LABELS[entry.kind] ?? "",
        isCatalog,
        autoHtml: entry.auto ? linkedHtml(linkSegments(entry.auto, entries, entry.key)) : "",
        textHtml: entry.text ? linkedHtml(linkSegments(entry.text, entries, entry.key)) : "",
        explanationLabel: EXPLANATION_LABELS[entry.kind] ?? "Explicação",
        rewritten: entry.rewritten,
        gmOnly: entry.gmOnly,
        missing: entry.missing,
        see: (entry.see ?? []).filter(k => byKey.has(k)).map(k => ({ key: k, term: byKey.get(k).term })),
        // O que o Mestre pode fazer aqui.
        canEdit: gmView && (entry.editable || entry.kind === "species" || entry.kind === "heritage"),
        editInline: gmView && entry.editable,
        editInCatalog: gmView && (entry.kind === "species" || entry.kind === "heritage"),
        isSystem: entry.kind === "system",
        isCustom: entry.kind === "custom",
        group: entry.group,
        rawText: entry.text,
        canGmOnly: entry.kind !== "attribute"
      };
    }

    const counts = gmView ? glossaryCounts(entries) : null;
    Object.assign(context, {
      isGM,
      gmView,
      asPlayer: this.asPlayer,
      query: this.query,
      searching: Boolean(query),
      results,
      groups,
      noResults: query ? !results.length : !groups.length,
      entry: view,
      canBack: this.history.length > 0,
      editing: this.editing && view?.editInline,
      adding: this.adding && gmView,
      filters: gmView ? FILTERS.map(([id, label]) => ({ id, label, count: id === "all" ? null : counts[id], active: this.filter === id, warn: id === "missing" && counts.missing > 0 })) : []
    });
    return context;
  }

  /** @override A busca re-renderiza sem perder o cursor; os hooks deixam a janela em dia. */
  _onRender(context, options) {
    super._onRender(context, options);
    const input = this.element.querySelector(".gl-search");
    if (input) {
      input.addEventListener("input", () => {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => {
          this.query = input.value;
          this._refocusSearch = true;
          this.render();
        }, 150);
      });
      if (this._refocusSearch) {
        this._refocusSearch = false;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
    if (!this._settingHook) {
      // Catálogo, nome da energia ou o próprio glossário mudou (aqui ou noutro cliente): redesenha.
      this._settingHook = Hooks.on("updateSetting", setting => {
        if (String(setting?.key ?? "").startsWith(`${SYSTEM_ID}.`)) this.render();
      });
    }
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    if (this._settingHook) Hooks.off("updateSetting", this._settingHook);
    this._settingHook = null;
  }

  static #onOpenTerm(event, target) {
    event.preventDefault();
    this.goTo(target.dataset.key);
    this.render();
  }

  static #onBack(event) {
    event.preventDefault();
    const prev = this.history.pop();
    if (!prev) return;
    this.current = prev;
    this.editing = false;
    this.render();
  }

  static #onSetFilter(event, target) {
    event.preventDefault();
    this.filter = target.dataset.filter || "all";
    this.render();
  }

  static #onEdit(event) {
    event.preventDefault();
    this.editing = true;
    this.adding = false;
    this.render();
  }

  static #onCancelEdit(event) {
    event.preventDefault();
    this.editing = false;
    this.adding = false;
    this.render();
  }

  /** O verbete atual, como a parte pura o monta (para salvar). */
  #currentEntry() {
    const entries = buildGlossary(gatherGlossaryWorld(), { isGM: true });
    return entries.find(e => e.key === this.current) ?? null;
  }

  static async #onSaveEdit(event) {
    event.preventDefault();
    const entry = this.#currentEntry();
    if (!entry) return;
    const form = this.element.querySelector(".gl-edit");
    try {
      await saveGlossaryEntry(entry, {
        text: form.querySelector("[name=text]")?.value ?? "",
        gmOnly: Boolean(form.querySelector("[name=gmOnly]")?.checked),
        term: form.querySelector("[name=term]")?.value,
        group: form.querySelector("[name=group]")?.value
      });
      this.editing = false;
      this.render();
    } catch (err) {
      reportError("Não deu para salvar o verbete.", err);
    }
  }

  static async #onResetTerm(event) {
    event.preventDefault();
    await resetGlossaryTerm(this.current);
    this.editing = false;
    this.render();
  }

  static async #onDeleteTerm(event) {
    event.preventDefault();
    const entry = this.#currentEntry();
    if (!entry || entry.kind !== "custom") return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Apagar termo da mesa" },
      content: `<p>Apagar "<b>${escapeHtml(entry.term)}</b>" do glossário?</p>`
    });
    if (!ok) return;
    await deleteCustomTerm(entry.key);
    this.current = this.history.pop() ?? "";
    this.editing = false;
    this.render();
  }

  static #onAddTerm(event) {
    event.preventDefault();
    this.adding = true;
    this.editing = false;
    this.render();
  }

  static async #onSaveNew(event) {
    event.preventDefault();
    const form = this.element.querySelector(".gl-new");
    const term = form.querySelector("[name=term]").value.trim();
    if (!term) {
      ui.notifications.warn("Dê um nome ao termo.");
      return;
    }
    const key = await addCustomTerm({
      term,
      group: form.querySelector("[name=group]").value,
      text: form.querySelector("[name=text]").value,
      gmOnly: form.querySelector("[name=gmOnly]").checked
    });
    this.adding = false;
    if (key) this.goTo(key);
    this.render();
  }

  static #onTogglePlayerView(event) {
    event.preventDefault();
    this.asPlayer = !this.asPlayer;
    this.editing = false;
    this.adding = false;
    this.render();
  }

  /** Espécie/Herança: a descrição mora no editor delas. */
  static async #onOpenCatalog(event) {
    event.preventDefault();
    const id = this.current.slice(this.current.indexOf(":") + 1);
    const { HeritagesConfigApp } = await import("./heritages-config.js");
    const { SpeciesConfigApp } = await import("./species-config.js");
    const app = this.current.startsWith("heritage:") ? new HeritagesConfigApp() : new SpeciesConfigApp();
    // Abre já no item deste verbete.
    if (id && app.catalog && id in app.catalog) app.selected = id;
    else if (Array.isArray(app.catalog) && app.catalog.some(e => e.id === id)) app.selected = id;
    app.render(true);
  }
}
