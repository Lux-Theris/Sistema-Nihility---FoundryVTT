/**
 * Janela "Validar Mundo" (Ferramentas de Admin, só o Mestre): coleta catálogos, Atores (Diretório
 * e Tokens não vinculados de todas as cenas), Itens do Diretório e — se marcado — os Compêndios do
 * sistema, e mostra o que world-validator.js encontrou. Só lê; cada linha abre a ficha para o
 * Mestre decidir o que fazer.
 */
import {
  SYSTEM_ID,
  MEU_SISTEMA,
  getActiveStatusConditions,
  getActiveDamageElements,
  getStructures,
  getScaleConfig,
  getActiveAttributes,
  getActiveTraits,
  getActiveSpeciesPresets,
  getActiveHeritages,
  getActiveBodyFunctions,
  getAmmoTypes,
  getCrewRoles,
  getModuleCategories,
  getVesselSizes,
  getVesselClasses
} from "../core/config.js";
import { buildCatalogIndex, validateActor, validateItem, validateCatalogs, CATALOG_LABELS } from "../world/world-validator.js";
import { syncPreviewFor } from "../species/species.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Os catálogos como o validador os espera (ver buildCatalogIndex). */
function readCatalogs() {
  const scaleConfig = getScaleConfig();
  return {
    conditions: getActiveStatusConditions(),
    elements: getActiveDamageElements(),
    structures: getStructures(),
    scales: scaleConfig.scales,
    scaleMaps: { shipSizeMap: scaleConfig.shipSizeMap, vehicleSizeMap: scaleConfig.vehicleSizeMap },
    attributes: getActiveAttributes().map(a => a.key),
    traits: getActiveTraits(),
    species: getActiveSpeciesPresets(),
    heritages: getActiveHeritages(),
    bodyFunctions: getActiveBodyFunctions(),
    ammoTypes: getAmmoTypes(),
    crewRoles: getCrewRoles(),
    moduleCategories: getModuleCategories(),
    shipSizes: getVesselSizes("starship"),
    vehicleSizes: getVesselSizes("vehicle"),
    shipClasses: getVesselClasses("starship"),
    vehicleClasses: getVesselClasses("vehicle")
  };
}

/** Atores do Diretório + sintéticos dos Tokens não vinculados (cada Drone é um Ator diferente). */
function worldActors() {
  const seen = new Set();
  const list = [];
  const push = actor => {
    if (!actor || seen.has(actor.uuid)) return;
    seen.add(actor.uuid);
    list.push(actor);
  };
  for (const actor of game.actors) push(actor);
  for (const scene of game.scenes) {
    for (const token of scene.tokens) if (!token.actorLink) push(token.actor);
  }
  return list;
}

function uuidExists(uuid) {
  try {
    return Boolean(fromUuidSync(uuid));
  } catch (err) {
    return false;
  }
}

/** Nome de quem vê: Token não vinculado leva o nome do Token e a cena. */
function documentLabel(doc) {
  if (doc.documentName === "Actor" && doc.isToken) return `${doc.token?.name ?? doc.name} (Token em ${doc.token?.parent?.name ?? "cena"})`;
  if (doc.pack) return `${doc.name} (${game.packs.get(doc.pack)?.title ?? doc.pack})`;
  return doc.name;
}

const TYPE_LABELS = {
  character: "Personagem",
  starship: "Nave",
  vehicle: "Veículo",
  skill: "Skill",
  item: "Item Geral",
  starship_module: "Módulo",
  body_part: "Parte do Corpo",
  title: "Título"
};

export class WorldValidatorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-world-validator",
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-world-validator"],
    window: { title: "Validar Mundo", resizable: true },
    position: { width: 640, height: 680 },
    actions: {
      revalidate: WorldValidatorApp.#onRevalidate,
      openDocument: WorldValidatorApp.#onOpenDocument
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/world-validator.hbs`, scrollable: [".wv-body"] }
  };

  /** Incluir os Compêndios do sistema (lento: carrega cada documento). */
  includePacks = false;

  static open() {
    const existing = foundry.applications.instances.get("nihility-world-validator");
    if (existing) {
      existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    return new WorldValidatorApp().render({ force: true });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const catalogs = readCatalogs();
    const idx = buildCatalogIndex(catalogs);

    const catalogIssues = validateCatalogs(catalogs, idx);
    const catalogGroups = [];
    for (const issue of catalogIssues) {
      const label = `${CATALOG_LABELS[issue.catalog] ?? issue.catalog} › ${issue.entry}`;
      let group = catalogGroups.find(g => g.label === label);
      if (!group) catalogGroups.push((group = { label, issues: [] }));
      group.issues.push(issue);
    }

    const documents = [];
    const actors = worldActors();
    for (const actor of actors) {
      const issues = validateActor(actor.toObject(), idx, { uuidExists, catalogs });
      // Ficha atrás do catálogo (a Espécie foi editada depois de aplicada): só aviso, a origem
      // continua funcionando — sincronizar é pela aba Origem ou pelo editor de Espécies.
      if (actor.type === "character" && syncPreviewFor(actor)) {
        issues.push({ where: "Espécie", catalog: "species", ref: actor.system.species, message: "a Espécie foi editada no catálogo depois de aplicada (sincronize pela aba Origem)" });
      }
      if (issues.length) documents.push(this.#documentRow(actor, issues));
    }
    for (const item of game.items) {
      const issues = validateItem(item.toObject(), idx);
      if (issues.length) documents.push(this.#documentRow(item, issues));
    }

    let packCount = 0;
    if (this.includePacks) {
      const keys = Object.values(MEU_SISTEMA.COMPENDIUM).filter(c => c.type === "Item").map(c => `world.${c.key}`);
      for (const key of keys) {
        const pack = game.packs.get(key);
        if (!pack) continue;
        for (const item of await pack.getDocuments()) {
          packCount += 1;
          const issues = validateItem(item.toObject(), idx);
          if (issues.length) documents.push(this.#documentRow(item, issues));
        }
      }
    }

    const total = catalogIssues.length + documents.reduce((sum, d) => sum + d.issues.length, 0);
    return Object.assign(context, {
      includePacks: this.includePacks,
      counts: { actors: actors.length, items: game.items.size, packs: packCount, total },
      catalogGroups,
      documents
    });
  }

  #documentRow(doc, issues) {
    return {
      uuid: doc.uuid,
      img: doc.img,
      name: documentLabel(doc),
      type: TYPE_LABELS[doc.type] ?? doc.type,
      issues: issues.map(issue => ({
        where: issue.where,
        message: issue.message,
        // Problema dentro de um Item do Ator: "Abrir" vai direto na ficha do Item.
        itemUuid: issue.itemId && doc.documentName === "Actor" ? doc.items.get(issue.itemId)?.uuid ?? "" : ""
      }))
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector("[name=includePacks]")?.addEventListener("change", event => {
      this.includePacks = event.currentTarget.checked;
    });
  }

  static async #onRevalidate() {
    await this.render();
  }

  static async #onOpenDocument(event, target) {
    const doc = await fromUuid(target.dataset.uuid);
    if (doc?.sheet) doc.sheet.render(true);
    else ui.notifications.warn("Documento não encontrado.");
  }
}
