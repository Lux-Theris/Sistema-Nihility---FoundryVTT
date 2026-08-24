import {
  SYSTEM_ID,
  MEU_SISTEMA,
  getEnergyLabel,
  getActiveCurrencies,
  getActiveSpeciesPresets,
  isEconomyEnabled,
  isTitlesEnabled,
  isAnatomyEnabled
} from "../config.js";
import { fuseSkills, registerItemInCompendium } from "../ai-helper.js";

const CREATABLE_ITEM_TYPES = ["skill", "body_part", "title", "item"];
const COMPENDIUM_MANAGED_TYPES = ["skill", "body_part", "title", "starship_module"];

/**
 * Ficha de Personagens e Criaturas (type "character").
 * Cobre criação/edição de Items embutidos, aplicação automática de preset de
 * anatomia por espécie e o fluxo de Fusão de Skills.
 */
export class NihilityActorSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: [SYSTEM_ID, "sheet", "actor"],
      template: `systems/${SYSTEM_ID}/templates/actor-sheet.hbs`,
      width: 760,
      height: 820,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "main" }]
    });
  }

  /** @override */
  async getData(options) {
    const context = await super.getData(options);
    const actor = this.actor;

    context.system = actor.system;
    context.config = MEU_SISTEMA;
    context.energyLabel = getEnergyLabel();
    context.economyEnabled = isEconomyEnabled();
    context.titlesEnabled = isTitlesEnabled();
    context.anatomyEnabled = isAnatomyEnabled();
    context.currencies = getActiveCurrencies();
    context.speciesPresets = getActiveSpeciesPresets();

    const skills = actor.items.filter(i => i.type === "skill");
    context.skillsByTier = {};
    for (const tier of MEU_SISTEMA.SKILL_TIERS) {
      context.skillsByTier[tier] = skills.filter(s => s.system.tier === tier);
    }
    context.tierLabels = MEU_SISTEMA.SKILL_TIER_LABELS;

    context.bodyParts = actor.items.filter(i => i.type === "body_part");
    context.statusLabels = MEU_SISTEMA.BODY_PART_STATUS_LABELS;
    context.titles = actor.items.filter(i => i.type === "title");
    context.gear = actor.items.filter(i => i.type === "item");

    return context;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;

    html.find(".species-select").on("change", this._onSpeciesChange.bind(this));
    html.find(".item-create").on("click", this._onItemCreate.bind(this));
    html.find(".item-edit").on("click", this._onItemEdit.bind(this));
    html.find(".item-delete").on("click", this._onItemDelete.bind(this));
    html.find(".title-set-active").on("click", this._onSetActiveTitle.bind(this));
    html.find(".skill-fuse-button").on("click", this._onFuseSkills.bind(this));
  }

  /* -------------------------------------------- */
  /*  Anatomia / Presets de Espécie                */
  /* -------------------------------------------- */

  async _onSpeciesChange(event) {
    event.preventDefault();
    const species = event.currentTarget.value;
    await this.actor.update({ "system.species": species });
    await this._applySpeciesPreset(species);
  }

  /**
   * Aplica automaticamente o Preset de Partes do Corpo da espécie selecionada,
   * substituindo as partes atuais após confirmação do usuário.
   */
  async _applySpeciesPreset(speciesKey) {
    if (!isAnatomyEnabled()) return;
    if (this.actor.system.lastAppliedSpeciesPreset === speciesKey) return;

    const presets = getActiveSpeciesPresets();
    const preset = presets[speciesKey];
    if (!preset) return;

    const confirmed = await Dialog.confirm({
      title: "Aplicar Preset de Anatomia",
      content: `<p>Substituir as Partes do Corpo atuais pelo preset de <strong>${preset.label}</strong>?</p>`
    });
    if (!confirmed) return;

    const existingParts = this.actor.items.filter(i => i.type === "body_part");
    if (existingParts.length) {
      await this.actor.deleteEmbeddedDocuments("Item", existingParts.map(p => p.id));
    }

    const newPartsData = preset.parts.map(part => ({
      name: part.label,
      type: "body_part",
      system: {
        slot: part.slot,
        speciesOrigin: speciesKey,
        hp: { value: part.hpMax, max: part.hpMax },
        status: "intact",
        isProsthetic: false,
        installedMods: []
      }
    }));

    const created = await this.actor.createEmbeddedDocuments("Item", newPartsData);
    for (const part of created) await registerItemInCompendium(part.toObject());

    await this.actor.update({ "system.lastAppliedSpeciesPreset": speciesKey });
  }

  /* -------------------------------------------- */
  /*  CRUD de Items embutidos                      */
  /* -------------------------------------------- */

  async _onItemCreate(event) {
    event.preventDefault();
    const type = event.currentTarget.dataset.type;
    if (!CREATABLE_ITEM_TYPES.includes(type)) return;

    const [created] = await this.actor.createEmbeddedDocuments("Item", [
      { name: `Novo: ${type}`, type }
    ]);
    if (COMPENDIUM_MANAGED_TYPES.includes(type)) {
      await registerItemInCompendium(created.toObject());
    }
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

  async _onSetActiveTitle(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item-row").dataset.itemId;
    await this.actor.update({ "system.activeTitleId": itemId });
  }

  /* -------------------------------------------- */
  /*  Fusão de Skills                              */
  /* -------------------------------------------- */

  async _onFuseSkills(event) {
    event.preventDefault();
    const ids = this.element
      .find(".skill-fuse-checkbox:checked")
      .map((_, el) => el.dataset.itemId)
      .get();

    if (ids.length < 2) {
      ui.notifications.warn("Selecione ao menos duas habilidades para fundir.");
      return;
    }

    const tier = await this._promptFusionTier();
    if (!tier) return;

    try {
      if (tier === "unique") {
        const manualData = await this._promptManualUniqueData();
        if (!manualData) return;
        await fuseSkills(this.actor, ids, { tier, mode: "manual", manualData });
      } else {
        await fuseSkills(this.actor, ids, { tier });
      }
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao fundir habilidades.`, err);
    }
  }

  async _promptFusionTier() {
    return Dialog.wait({
      title: "Fundir Habilidades",
      content: `
        <form>
          <div class="form-group">
            <label>Tier resultante</label>
            <select name="tier">
              <option value="common">Comum</option>
              <option value="extra">Extra</option>
              <option value="unique">Única (gatilho emocional)</option>
              <option value="ultimate">Ultimate</option>
            </select>
          </div>
        </form>`,
      buttons: {
        confirm: { label: "Continuar", callback: html => html.find("select[name=tier]").val() },
        cancel: { label: "Cancelar", callback: () => null }
      },
      default: "confirm",
      close: () => null
    });
  }

  /** Modo Manual: o Mestre insere/aprova o efeito e a emoção da Skill Única. */
  async _promptManualUniqueData() {
    return Dialog.wait({
      title: "Skill Única — Aprovação do Mestre",
      content: `
        <form>
          <div class="form-group"><label>Nome</label><input type="text" name="name"/></div>
          <div class="form-group"><label>Efeito</label><textarea name="effect" rows="4"></textarea></div>
          <div class="form-group"><label>Emoção / Gatilho</label><input type="text" name="emotion"/></div>
        </form>`,
      buttons: {
        confirm: {
          label: "Criar Skill Única",
          callback: html => ({
            name: html.find("[name=name]").val(),
            effect: html.find("[name=effect]").val(),
            emotion: html.find("[name=emotion]").val()
          })
        },
        cancel: { label: "Cancelar", callback: () => null }
      },
      default: "confirm",
      close: () => null
    });
  }
}
