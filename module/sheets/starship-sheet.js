import { SYSTEM_ID, MEU_SISTEMA, getStarshipEnergyLabel, debugLog } from "../config.js";
import { registerItemInCompendium, createGrantedSkill, removeGrantedSkill } from "../ai-helper.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** Percentual (0-100) usado para desenhar as barras de Casco/Escudos/Integridade/Combustível. */
function percentOf(value, max) {
  if (!max) return 0;
  return Math.round(Math.clamp((value / max) * 100, 0, 100));
}

/** Mesmo padrão manual de abas usado em NihilityItemSheet/NihilityMenuApp (ApplicationV2 não herda o mixin de abas do AppV1). */
class TabbedActorSheetV2 extends HandlebarsApplicationMixin(ActorSheetV2) {
  constructor(options = {}) {
    super(options);
    this.activeTab = "main";
  }

  /** @override — só o nome, sem o "TYPES.Actor.starship: nome" cru quando falta tradução do label. */
  get title() {
    return this.actor.name;
  }

  static onSelectTab(event, target) {
    event.preventDefault();
    this.activeTab = target.dataset.tab;
    this.render();
  }

  /** Clique no retrato abre o FilePicker de imagem — precisa de action explícita no ApplicationV2. */
  static async onEditImage(event, target) {
    const field = target.dataset.edit || "img";
    const current = foundry.utils.getProperty(this.actor, field);
    const fp = new FilePicker({
      type: "image",
      current,
      callback: path => this.actor.update({ [field]: path })
    });
    fp.render(true);
  }
}

/**
 * Ficha de Naves Espaciais (type "starship"): Casco, Escudos, Manobra e o
 * Grid de Energia (Reator + Baterias - Consumo), com alerta de sobrecarga.
 */
export class NihilityStarshipSheet extends TabbedActorSheetV2 {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "actor", "starship"],
    position: { width: 700, height: 760 },
    actions: {
      selectTab: TabbedActorSheetV2.onSelectTab,
      createItem: NihilityStarshipSheet.#onItemCreate,
      editItem: NihilityStarshipSheet.#onItemEdit,
      deleteItem: NihilityStarshipSheet.#onItemDelete,
      toggleModulePower: NihilityStarshipSheet.#onToggleModulePower,
      powerGridTick: NihilityStarshipSheet.#onPowerGridTick,
      editImage: TabbedActorSheetV2.onEditImage
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/starship-sheet.hbs`, scrollable: [".sheet-body"] }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;

    context.actor = actor;
    context.owner = actor.isOwner;
    context.activeTab = this.activeTab;
    context.system = actor.system;
    context.config = MEU_SISTEMA;
    context.energyLabel = getStarshipEnergyLabel();
    context.modules = actor.items.filter(i => i.type === "starship_module");
    context.skills = actor.system.skills;
    context.totalConsumption = actor.system.totalConsumption;
    context.availableEnergy = actor.system.availableEnergy;
    context.isOverloaded = actor.system.powerGrid.isOverloaded;
    context.primaryPercent = percentOf(actor.system.hull.value, actor.system.hull.max);
    context.secondaryPercent = percentOf(actor.system.shields.value, actor.system.shields.max);

    debugLog(`${SYSTEM_ID} | NihilityStarshipSheet._prepareContext:`, actor.name);
    return context;
  }

  static async #onItemCreate(event, target) {
    event.preventDefault();
    const [created] = await this.actor.createEmbeddedDocuments("Item", [
      { name: "Novo Módulo", type: "starship_module" }
    ]);
    await registerItemInCompendium(created.toObject());
    created.sheet.render(true);
  }

  static #onItemEdit(event, target) {
    event.preventDefault();
    const itemId = target.closest(".item-row").dataset.itemId;
    this.actor.items.get(itemId)?.sheet.render(true);
  }

  static async #onItemDelete(event, target) {
    event.preventDefault();
    const itemId = target.closest(".item-row").dataset.itemId;
    await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
  }

  static async #onToggleModulePower(event, target) {
    event.preventDefault();
    const itemId = target.closest(".item-row").dataset.itemId;
    const module = this.actor.items.get(itemId);
    if (!module) return;
    const next = module.system.status === "online" ? "offline" : "online";
    await module.update({ "system.status": next });

    if (next === "online") {
      await createGrantedSkill(this.actor, module.system.grantsSkill, module.id);
    } else {
      await removeGrantedSkill(this.actor, module.id);
    }
  }

  /** Recalcula o Grid de Energia: excedente carrega os capacitores, déficit os drena. */
  static async #onPowerGridTick(event, target) {
    event.preventDefault();
    const { available, overloaded } = await this.actor.system.applyPowerGridTick();
    if (overloaded) {
      ui.notifications.warn(
        `${this.actor.name}: Grid de Energia sobrecarregado! Energia disponível: ${available}.`
      );
    } else {
      ui.notifications.info(`${this.actor.name}: Energia disponível: ${available}.`);
    }
  }
}

/**
 * Ficha de Veículos Terrestres (type "vehicle"): Integridade, Velocidade,
 * Combustível/Bateria e Peças instaladas.
 */
export class NihilityVehicleSheet extends TabbedActorSheetV2 {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "actor", "vehicle"],
    position: { width: 640, height: 680 },
    actions: {
      selectTab: TabbedActorSheetV2.onSelectTab,
      createItem: NihilityVehicleSheet.#onItemCreate,
      editItem: NihilityVehicleSheet.#onItemEdit,
      deleteItem: NihilityVehicleSheet.#onItemDelete,
      editImage: TabbedActorSheetV2.onEditImage
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/starship-sheet.hbs`, scrollable: [".sheet-body"] }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;

    context.actor = actor;
    context.owner = actor.isOwner;
    context.activeTab = this.activeTab;
    context.system = actor.system;
    context.config = MEU_SISTEMA;
    context.isVehicle = true;
    context.parts = actor.system.parts;
    context.primaryPercent = percentOf(actor.system.integrity.value, actor.system.integrity.max);
    context.secondaryPercent = percentOf(actor.system.fuel.value, actor.system.fuel.max);

    debugLog(`${SYSTEM_ID} | NihilityVehicleSheet._prepareContext:`, actor.name);
    return context;
  }

  static async #onItemCreate(event, target) {
    event.preventDefault();
    const [created] = await this.actor.createEmbeddedDocuments("Item", [{ name: "Nova Peça", type: "item" }]);
    created.sheet.render(true);
  }

  static #onItemEdit(event, target) {
    event.preventDefault();
    const itemId = target.closest(".item-row").dataset.itemId;
    this.actor.items.get(itemId)?.sheet.render(true);
  }

  static async #onItemDelete(event, target) {
    event.preventDefault();
    const itemId = target.closest(".item-row").dataset.itemId;
    await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
  }
}
