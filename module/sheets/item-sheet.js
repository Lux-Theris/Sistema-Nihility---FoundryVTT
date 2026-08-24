import { SYSTEM_ID, MEU_SISTEMA } from "../config.js";

/**
 * Ficha genérica de Item, adaptável por `item.type`
 * (skill, body_part, title, starship_module, item).
 */
export class NihilityItemSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: [SYSTEM_ID, "sheet", "item"],
      template: `systems/${SYSTEM_ID}/templates/item-sheet.hbs`,
      width: 560,
      height: 560,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "description" }]
    });
  }

  /** @override */
  async getData(options) {
    const context = await super.getData(options);
    context.system = this.item.system;
    context.config = MEU_SISTEMA;
    context.itemType = this.item.type;
    return context;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;

    // Sub-Skills (type "skill")
    html.find(".sub-skill-add").on("click", this._onSubSkillAdd.bind(this));
    html.find(".sub-skill-delete").on("click", this._onSubSkillDelete.bind(this));

    // Modificações/Próteses instaladas (type "body_part")
    html.find(".mod-add").on("click", this._onInstalledModAdd.bind(this));
    html.find(".mod-delete").on("click", this._onInstalledModDelete.bind(this));
  }

  async _onSubSkillAdd(event) {
    event.preventDefault();
    const subSkills = foundry.utils.deepClone(this.item.system.subSkills ?? []);
    subSkills.push({ name: "Nova Sub-Skill", description: "" });
    await this.item.update({ "system.subSkills": subSkills });
  }

  async _onSubSkillDelete(event) {
    event.preventDefault();
    const index = Number(event.currentTarget.closest("[data-index]").dataset.index);
    const subSkills = foundry.utils.deepClone(this.item.system.subSkills ?? []);
    subSkills.splice(index, 1);
    await this.item.update({ "system.subSkills": subSkills });
  }

  async _onInstalledModAdd(event) {
    event.preventDefault();
    const mods = foundry.utils.deepClone(this.item.system.installedMods ?? []);
    mods.push({ name: "Nova Modificação", description: "" });
    await this.item.update({ "system.installedMods": mods });
  }

  async _onInstalledModDelete(event) {
    event.preventDefault();
    const index = Number(event.currentTarget.closest("[data-index]").dataset.index);
    const mods = foundry.utils.deepClone(this.item.system.installedMods ?? []);
    mods.splice(index, 1);
    await this.item.update({ "system.installedMods": mods });
  }
}
