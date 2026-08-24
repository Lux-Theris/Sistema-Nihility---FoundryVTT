import { SYSTEM_ID, MEU_SISTEMA, getStarshipEnergyLabel } from "../config.js";
import { registerItemInCompendium, createGrantedSkill, removeGrantedSkill } from "../ai-helper.js";

/** Percentual (0-100) usado para desenhar as barras de Casco/Escudos/Integridade/Combustível. */
function percentOf(value, max) {
  if (!max) return 0;
  return Math.round(Math.clamp((value / max) * 100, 0, 100));
}

/**
 * Ficha de Naves Espaciais (type "starship"): Casco, Escudos, Manobra e o
 * Grid de Energia (Reator + Baterias - Consumo), com alerta de sobrecarga.
 */
export class NihilityStarshipSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: [SYSTEM_ID, "sheet", "actor", "starship"],
      template: `systems/${SYSTEM_ID}/templates/starship-sheet.hbs`,
      width: 700,
      height: 760,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "main" }]
    });
  }

  /** @override */
  async getData(options) {
    const context = await super.getData(options);
    const actor = this.actor;

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

    return context;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;

    html.find(".item-create").on("click", this._onItemCreate.bind(this));
    html.find(".item-edit").on("click", this._onItemEdit.bind(this));
    html.find(".item-delete").on("click", this._onItemDelete.bind(this));
    html.find(".module-toggle-power").on("click", this._onToggleModulePower.bind(this));
    html.find(".power-grid-tick").on("click", this._onPowerGridTick.bind(this));
  }

  async _onItemCreate(event) {
    event.preventDefault();
    const [created] = await this.actor.createEmbeddedDocuments("Item", [
      { name: "Novo Módulo", type: "starship_module" }
    ]);
    await registerItemInCompendium(created.toObject());
    created.sheet.render(true);
  }

  _onItemEdit(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item-row").dataset.itemId;
    this.actor.items.get(itemId)?.sheet.render(true);
  }

  async _onItemDelete(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item-row").dataset.itemId;
    await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
  }

  async _onToggleModulePower(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item-row").dataset.itemId;
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
  async _onPowerGridTick(event) {
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
export class NihilityVehicleSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: [SYSTEM_ID, "sheet", "actor", "vehicle"],
      template: `systems/${SYSTEM_ID}/templates/starship-sheet.hbs`,
      width: 640,
      height: 680,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "main" }]
    });
  }

  /** @override */
  async getData(options) {
    const context = await super.getData(options);
    const actor = this.actor;

    context.system = actor.system;
    context.config = MEU_SISTEMA;
    context.isVehicle = true;
    context.parts = actor.system.parts;
    context.primaryPercent = percentOf(actor.system.integrity.value, actor.system.integrity.max);
    context.secondaryPercent = percentOf(actor.system.fuel.value, actor.system.fuel.max);

    return context;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;

    html.find(".item-create").on("click", this._onItemCreate.bind(this));
    html.find(".item-edit").on("click", this._onItemEdit.bind(this));
    html.find(".item-delete").on("click", this._onItemDelete.bind(this));
  }

  async _onItemCreate(event) {
    event.preventDefault();
    const [created] = await this.actor.createEmbeddedDocuments("Item", [{ name: "Nova Peça", type: "item" }]);
    created.sheet.render(true);
  }

  _onItemEdit(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item-row").dataset.itemId;
    this.actor.items.get(itemId)?.sheet.render(true);
  }

  async _onItemDelete(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item-row").dataset.itemId;
    await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
  }
}
