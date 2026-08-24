import { SYSTEM_ID, MEU_SISTEMA, getActiveDamageElements } from "../config.js";
import { createGrantedSkill, removeGrantedSkill } from "../ai-helper.js";

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

    if (this.item.type === "skill") {
      const owner = this.item.parent;
      const hasUltimate = owner?.system?.hasUltimateSkill ?? this.item.system.tier === "ultimate";
      const ultimateVisible = hasUltimate || game.user.isGM;
      context.visibleSkillTiers = MEU_SISTEMA.SKILL_TIERS.filter(t => t !== "ultimate" || ultimateVisible);
      context.damageElements = getActiveDamageElements();
    }

    return context;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;

    // Sub-Skills (type "skill")
    html.find(".sub-skill-add").on("click", this._onSubSkillAdd.bind(this));
    html.find(".sub-skill-delete").on("click", this._onSubSkillDelete.bind(this));

    // Efeitos (type "skill", effectType "temporary")
    html.find(".effect-add").on("click", this._onEffectAdd.bind(this));
    html.find(".effect-delete").on("click", this._onEffectDelete.bind(this));

    // Modificações/Próteses instaladas (type "body_part")
    html.find(".mod-add").on("click", this._onInstalledModAdd.bind(this));
    html.find(".mod-delete").on("click", this._onInstalledModDelete.bind(this));
    html.find(".mod-grant-toggle").on("click", this._onModGrantToggle.bind(this));

    // Bônus permanentes (type "title")
    html.find(".title-bonus-add").on("click", this._onTitleBonusAdd.bind(this));
    html.find(".title-bonus-delete").on("click", this._onTitleBonusDelete.bind(this));

    // Habilidade Concedida ao equipar (type "item")
    html.find(".item-equip-toggle").on("change", this._onEquipToggle.bind(this));
  }

  /* -------------------------------------------- */
  /*  Habilidade Concedida (Item Geral / equipar)  */
  /* -------------------------------------------- */

  async _onEquipToggle(event) {
    const actor = this.item.parent;
    if (!actor) return; // Item ainda não está numa ficha — nada a conceder/revogar.

    if (event.currentTarget.checked) {
      await createGrantedSkill(actor, this.item.system.grantsSkill, this.item.id);
    } else {
      await removeGrantedSkill(actor, this.item.id);
    }
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

  async _onEffectAdd(event) {
    event.preventDefault();
    const effects = foundry.utils.deepClone(this.item.system.effects ?? []);
    effects.push({ target: MEU_SISTEMA.EFFECT_TARGETS[0], amount: 1, durationRounds: 1 });
    await this.item.update({ "system.effects": effects });
  }

  async _onEffectDelete(event) {
    event.preventDefault();
    const index = Number(event.currentTarget.closest("[data-index]").dataset.index);
    const effects = foundry.utils.deepClone(this.item.system.effects ?? []);
    effects.splice(index, 1);
    await this.item.update({ "system.effects": effects });
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

    const actor = this.item.parent;
    if (actor && mods[index]?.skillGranted) {
      await removeGrantedSkill(actor, `${this.item.id}:${index}`);
    }

    mods.splice(index, 1);
    await this.item.update({ "system.installedMods": mods });
  }

  /** Concede (ou revoga) a Habilidade de uma Modificação instalada em Parte do Corpo. */
  async _onModGrantToggle(event) {
    event.preventDefault();
    const actor = this.item.parent;
    if (!actor) {
      ui.notifications?.warn("A Parte do Corpo precisa estar numa ficha de Ator para conceder a Habilidade.");
      return;
    }

    const index = Number(event.currentTarget.closest("[data-index]").dataset.index);
    const mods = foundry.utils.deepClone(this.item.system.installedMods ?? []);
    const mod = mods[index];
    if (!mod) return;

    const sourceKey = `${this.item.id}:${index}`;
    if (mod.skillGranted) {
      await removeGrantedSkill(actor, sourceKey);
      mod.skillGranted = false;
    } else {
      const created = await createGrantedSkill(actor, mod.grantsSkill, sourceKey);
      if (!created) {
        ui.notifications?.warn("Preencha o nome da Habilidade Concedida antes de conceder.");
        return;
      }
      mod.skillGranted = true;
    }

    await this.item.update({ "system.installedMods": mods });
  }

  async _onTitleBonusAdd(event) {
    event.preventDefault();
    const bonuses = foundry.utils.deepClone(this.item.system.bonuses ?? []);
    bonuses.push({ attribute: MEU_SISTEMA.COMBAT_ATTRIBUTES[0], amount: 1 });
    await this.item.update({ "system.bonuses": bonuses });
  }

  async _onTitleBonusDelete(event) {
    event.preventDefault();
    const index = Number(event.currentTarget.closest("[data-index]").dataset.index);
    const bonuses = foundry.utils.deepClone(this.item.system.bonuses ?? []);
    bonuses.splice(index, 1);
    await this.item.update({ "system.bonuses": bonuses });
  }
}
