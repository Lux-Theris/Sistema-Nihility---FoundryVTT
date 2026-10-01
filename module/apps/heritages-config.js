/**
 * Editor de Heranças (board 2 do canvas "Rework de Espécies"): o mesmo editor das Espécies, com
 * as abas Geral · Corpo e Skills · Passivos · Regras. Herança é "o que aconteceu com você" — vale
 * para qualquer Espécie, um personagem pode ter várias, e quem dá/tira é o Mestre (aba Origem).
 *
 * O catálogo é uma LISTA (`heritagesData`); aqui vira objeto {id: entrada} para reaproveitar toda a
 * edição de species-config.js, e volta a lista ao salvar.
 */
import { SYSTEM_ID, MEU_SISTEMA, getActiveHeritages, getActiveSpeciesPresets } from "../core/config.js";
import { SpeciesConfigApp } from "./species-config.js";
import { normalizeSpeciesEntry } from "../species/species-rules.js";
import { wirePickerField, pickFromChecklist } from "./checklist-picker.js";
import { openSpeciesSync } from "../species/species.js";

const TABS = [
  { id: "general", label: "Geral" },
  { id: "body", label: "Corpo e Skills" },
  { id: "passives", label: "Passivos" },
  { id: "rules", label: "Regras" }
];

/** Atores (Diretório + Tokens não vinculados) que têm esta Herança. */
function actorsWithHeritage(id) {
  const seen = new Set();
  const list = [];
  const consider = actor => {
    if (!actor || actor.type !== "character" || seen.has(actor.uuid)) return;
    seen.add(actor.uuid);
    if ((actor.system.heritages ?? []).some(h => h.id === id)) list.push(actor);
  };
  for (const actor of game.actors) consider(actor);
  for (const scene of game.scenes) for (const token of scene.tokens) if (!token.actorLink) consider(token.actor);
  return list;
}

export class HeritagesConfigApp extends SpeciesConfigApp {
  static KIND = "heritage";

  static DEFAULT_OPTIONS = {
    id: "nihility-heritages-config",
    window: { title: "Heranças" },
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-species-editor", "is-heritage"]
  };

  _readCatalog() {
    const out = {};
    for (const h of getActiveHeritages()) out[h.id] = normalizeSpeciesEntry(h);
    return out;
  }

  async _writeCatalog(catalog) {
    const list = Object.entries(catalog).map(([id, entry]) => ({ ...entry, id }));
    await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.heritagesData, JSON.stringify(list, null, 2));
  }

  _tabs() {
    return TABS;
  }

  _blankEntry() {
    return {
      label: "Nova Herança",
      group: "",
      acquired: "acquired",
      description: "",
      traits: [],
      removesTraits: [],
      elements: [],
      parts: [],
      skills: [],
      replaces: { slots: [] },
      allowedSpecies: { mode: "any", list: [] },
      excludes: [],
      announce: ""
    };
  }

  _defaultCatalog() {
    const out = {};
    for (const h of MEU_SISTEMA.DEFAULT_HERITAGES) out[h.id] = normalizeSpeciesEntry(h);
    return out;
  }

  _sheetsFor(id) {
    return actorsWithHeritage(id);
  }

  async _syncSheets(id) {
    const label = this.catalog[id]?.label ?? id;
    await openSpeciesSync(null, { actors: actorsWithHeritage(id), label });
  }

  _extraContext(entry) {
    const mode = entry.allowedSpecies?.mode ?? "any";
    return {
      her: {
        acquired: entry.acquired ?? "acquired",
        removesJson: JSON.stringify(entry.removesTraits ?? []),
        allowedMode: mode,
        allowedJson: JSON.stringify(entry.allowedSpecies?.list ?? []),
        excludesJson: JSON.stringify(entry.excludes ?? []),
        announce: entry.announce ?? "",
        replacesSlots: (entry.replaces?.slots ?? []).join(", "),
        modes: [
          { id: "any", label: "Qualquer Espécie", on: mode === "any" },
          { id: "only", label: "Só estas…", on: mode === "only" },
          { id: "except", label: "Todas, menos…", on: mode === "except" }
        ],
        acquiredModes: [
          { id: "birth", label: "Nascimento", on: entry.acquired === "birth" },
          { id: "acquired", label: "Adquirida", on: (entry.acquired ?? "acquired") === "acquired" },
          { id: "both", label: "Ambos", on: entry.acquired === "both" }
        ]
      }
    };
  }

  /** Chips de Espécies (Espécies permitidas) ou de Heranças (não convive com). */
  _wireCustomPicker(el, onChange) {
    const kind = el.dataset.kind;
    const self = this.selected;
    const source = () =>
      kind === "species"
        ? Object.entries(getActiveSpeciesPresets()).map(([id, e]) => ({ id, label: e.label || id, group: e.group || "" }))
        : Object.entries(this.catalog).filter(([id]) => id !== self).map(([id, e]) => ({ id, label: e.label || id, group: e.group || "" }));
    wirePickerField(el, {
      noun: kind === "species" ? "Espécie" : "Herança",
      onChange,
      describe: ids => {
        const all = source();
        return { total: all.length, chips: ids.map(id => ({ id, label: all.find(o => o.id === id)?.label ?? `${id} (removida)`, color: "" })) };
      },
      pick: ids => {
        const groups = {};
        for (const o of source()) (groups[o.group] ??= []).push({ id: o.id, label: o.label });
        return pickFromChecklist({
          title: kind === "species" ? "Espécies" : "Heranças",
          groups: Object.entries(groups).map(([g, options]) => ({ label: MEU_SISTEMA.SPECIES_GROUP_LABELS[g] ?? "Outras", options })),
          selected: ids
        });
      }
    });
  }
}
