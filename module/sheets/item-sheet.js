import { SYSTEM_ID, MEU_SISTEMA, getActiveDamageElements } from "../config.js";
import { createGrantedSkill, removeGrantedSkill } from "../ai-helper.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Ficha genérica de Item, adaptável por `item.type`
 * (skill, body_part, title, starship_module, item).
 * Migrado pra ApplicationV2 (ItemSheetV2) — `form.submitOnChange` mantém o auto-save por
 * campo que a ficha sempre teve; sem `form.handler` explícito, o DocumentSheetV2 aplica o
 * default (grava direto no Item) — se algum campo parar de salvar sozinho ao editar, esse é
 * o primeiro lugar a olhar.
 */
export class NihilityItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "item"],
    position: { width: 560, height: 560 },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      addSubSkill: NihilityItemSheet.#onSubSkillAdd,
      deleteSubSkill: NihilityItemSheet.#onSubSkillDelete,
      addEffect: NihilityItemSheet.#onEffectAdd,
      deleteEffect: NihilityItemSheet.#onEffectDelete,
      addInstalledMod: NihilityItemSheet.#onInstalledModAdd,
      deleteInstalledMod: NihilityItemSheet.#onInstalledModDelete,
      toggleModGrant: NihilityItemSheet.#onModGrantToggle,
      addTitleBonus: NihilityItemSheet.#onTitleBonusAdd,
      deleteTitleBonus: NihilityItemSheet.#onTitleBonusDelete,
      addItemAttrBonus: NihilityItemSheet.#onItemAttrBonusAdd,
      deleteItemAttrBonus: NihilityItemSheet.#onItemAttrBonusDelete,
      addModAttrBonus: NihilityItemSheet.#onModAttrBonusAdd,
      deleteModAttrBonus: NihilityItemSheet.#onModAttrBonusDelete,
      selectTab: NihilityItemSheet.#onSelectTab
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/item-sheet.hbs` }
  };

  constructor(options = {}) {
    super(options);
    // ApplicationV2 não herda o mixin de abas do AppV1 — mesmo padrão manual já usado em
    // NihilityMenuApp (activeTab + ação "selectTab"), em vez de depender da config de
    // tabs nova (ainda não validada neste sistema).
    this.activeTab = "description";
  }

  static #onSelectTab(event, target) {
    event.preventDefault();
    this.activeTab = target.dataset.tab;
    this.render();
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.item.system;
    context.config = MEU_SISTEMA;
    context.itemType = this.item.type;
    context.activeTab = this.activeTab;
    context.item = this.item;
    context.owner = this.item.isOwner;

    if (this.item.type === "skill") {
      const owner = this.item.parent;
      const hasUltimate = owner?.system?.hasUltimateSkill ?? this.item.system.tier === "ultimate";
      const ultimateVisible = hasUltimate || game.user.isGM;
      context.visibleSkillTiers = MEU_SISTEMA.SKILL_TIERS.filter(t => t !== "ultimate" || ultimateVisible);
      const selectedElements = this.item.system.damageElements ?? [];
      context.damageElements = getActiveDamageElements().map(el => ({
        ...el,
        selected: selectedElements.includes(el.id)
      }));
    }

    console.log(`${SYSTEM_ID} | NihilityItemSheet._prepareContext (${this.item.type}):`, this.item.name);
    return context;
  }

  /**
   * @override
   * O toggle de equipar (type "item") dispara em "change", não em clique — a API de
   * `actions` só cobre clique, então esse listener é ligado manualmente aqui.
   */
  _onRender(context, options) {
    super._onRender(context, options);
    if (!this.isEditable) return;

    this.element.querySelectorAll(".item-equip-toggle").forEach(checkbox => {
      checkbox.addEventListener("change", this._onEquipToggle.bind(this));
    });
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

  static async #onSubSkillAdd(event, target) {
    event.preventDefault();
    const subSkills = foundry.utils.deepClone(this.item.system.subSkills ?? []);
    subSkills.push({ name: "Nova Sub-Skill", description: "" });
    await this.item.update({ "system.subSkills": subSkills });
  }

  static async #onSubSkillDelete(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const subSkills = foundry.utils.deepClone(this.item.system.subSkills ?? []);
    subSkills.splice(index, 1);
    await this.item.update({ "system.subSkills": subSkills });
  }

  static async #onEffectAdd(event, target) {
    event.preventDefault();
    const effects = foundry.utils.deepClone(this.item.system.effects ?? []);
    effects.push({ target: MEU_SISTEMA.EFFECT_TARGETS[0], amount: 1, durationRounds: 1 });
    await this.item.update({ "system.effects": effects });
  }

  static async #onEffectDelete(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const effects = foundry.utils.deepClone(this.item.system.effects ?? []);
    effects.splice(index, 1);
    await this.item.update({ "system.effects": effects });
  }

  static async #onInstalledModAdd(event, target) {
    event.preventDefault();
    const mods = foundry.utils.deepClone(this.item.system.installedMods ?? []);
    mods.push({ name: "Nova Modificação", description: "" });
    await this.item.update({ "system.installedMods": mods });
  }

  static async #onInstalledModDelete(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const mods = foundry.utils.deepClone(this.item.system.installedMods ?? []);

    const actor = this.item.parent;
    if (actor && mods[index]?.skillGranted) {
      await removeGrantedSkill(actor, `${this.item.id}:${index}`);
    }

    mods.splice(index, 1);
    await this.item.update({ "system.installedMods": mods });
  }

  /** Concede (ou revoga) a Habilidade de uma Modificação instalada em Parte do Corpo. */
  static async #onModGrantToggle(event, target) {
    event.preventDefault();
    const actor = this.item.parent;
    if (!actor) {
      ui.notifications?.warn("A Parte do Corpo precisa estar numa ficha de Ator para conceder a Habilidade.");
      return;
    }

    const index = Number(target.closest("[data-index]").dataset.index);
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

  static async #onItemAttrBonusAdd(event, target) {
    event.preventDefault();
    const bonuses = foundry.utils.deepClone(this.item.system.attributeBonuses ?? []);
    bonuses.push({ attribute: MEU_SISTEMA.COMBAT_ATTRIBUTES[0], amount: 1 });
    await this.item.update({ "system.attributeBonuses": bonuses });
  }

  static async #onItemAttrBonusDelete(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const bonuses = foundry.utils.deepClone(this.item.system.attributeBonuses ?? []);
    bonuses.splice(index, 1);
    await this.item.update({ "system.attributeBonuses": bonuses });
  }

  static async #onModAttrBonusAdd(event, target) {
    event.preventDefault();
    const modIndex = Number(target.dataset.index);
    const mods = foundry.utils.deepClone(this.item.system.installedMods ?? []);
    const mod = mods[modIndex];
    if (!mod) return;
    mod.attributeBonuses = mod.attributeBonuses ?? [];
    mod.attributeBonuses.push({ attribute: MEU_SISTEMA.COMBAT_ATTRIBUTES[0], amount: 1 });
    await this.item.update({ "system.installedMods": mods });
  }

  static async #onModAttrBonusDelete(event, target) {
    event.preventDefault();
    const li = target.closest("[data-bonus-index]");
    const modIndex = Number(li.dataset.index);
    const bonusIndex = Number(li.dataset.bonusIndex);
    const mods = foundry.utils.deepClone(this.item.system.installedMods ?? []);
    const mod = mods[modIndex];
    if (!mod?.attributeBonuses) return;
    mod.attributeBonuses.splice(bonusIndex, 1);
    await this.item.update({ "system.installedMods": mods });
  }

  static async #onTitleBonusAdd(event, target) {
    event.preventDefault();
    const bonuses = foundry.utils.deepClone(this.item.system.bonuses ?? []);
    bonuses.push({ attribute: MEU_SISTEMA.COMBAT_ATTRIBUTES[0], amount: 1 });
    await this.item.update({ "system.bonuses": bonuses });
  }

  static async #onTitleBonusDelete(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const bonuses = foundry.utils.deepClone(this.item.system.bonuses ?? []);
    bonuses.splice(index, 1);
    await this.item.update({ "system.bonuses": bonuses });
  }
}
