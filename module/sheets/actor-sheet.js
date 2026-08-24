import {
  SYSTEM_ID,
  MEU_SISTEMA,
  getCharacterEnergyLabel,
  getActiveCurrencies,
  getActiveSpeciesPresets,
  isEconomyEnabled,
  isTitlesEnabled,
  isAnatomyEnabled
} from "../config.js";
import {
  fuseSkills,
  registerItemInCompendium,
  breakSkillPoints,
  mergeSkillPoints,
  requestSkillCreation,
  convertActorCurrency,
  transferCurrency
} from "../ai-helper.js";
import { rollAttribute } from "../dice.js";

const CREATABLE_ITEM_TYPES = ["skill", "body_part", "title", "item"];
const COMPENDIUM_MANAGED_TYPES = ["skill", "body_part", "title", "starship_module"];

/** Tiers que fazem sentido como *resultado* de uma fusão (Racial nunca — só vem da Espécie). */
const FUSABLE_TARGET_TIERS = ["extra", "normal", "unique", "ultimate"];

/**
 * Ficha de Personagens e Criaturas (type "character") — cobre também Montarias
 * e qualquer outro ser vivo/não-vivo gerado como "character": todos têm acesso
 * total ao mesmo sistema de Atributos, Pontos de Habilidade e Fusão de Skills.
 */
export class NihilityActorSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: [SYSTEM_ID, "sheet", "actor"],
      template: `systems/${SYSTEM_ID}/templates/actor-sheet.hbs`,
      width: 780,
      height: 860,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "main" }]
    });
  }

  /** @override */
  async getData(options) {
    const context = await super.getData(options);
    const actor = this.actor;

    context.system = actor.system;
    context.config = MEU_SISTEMA;
    context.energyLabel = getCharacterEnergyLabel();
    context.economyEnabled = isEconomyEnabled();
    context.titlesEnabled = isTitlesEnabled();
    context.anatomyEnabled = isAnatomyEnabled();
    context.isGM = game.user.isGM;
    context.currencies = getActiveCurrencies();
    context.speciesPresets = getActiveSpeciesPresets();
    context.attributeLabels = MEU_SISTEMA.COMBAT_ATTRIBUTES.map(key => ({
      key,
      label: MEU_SISTEMA.COMBAT_ATTRIBUTE_LABELS[key],
      data: actor.system.attributes.combat[key]
    }));

    const hasUltimate = actor.system.hasUltimateSkill;
    const skills = actor.items.filter(i => i.type === "skill");
    context.skillsByTier = {};
    context.visibleTiers = MEU_SISTEMA.SKILL_TIERS.filter(t => t !== "ultimate" || hasUltimate);
    for (const tier of MEU_SISTEMA.SKILL_TIERS) {
      context.skillsByTier[tier] = skills.filter(s => s.system.tier === tier);
    }
    context.tierLabels = MEU_SISTEMA.SKILL_TIER_LABELS;
    context.fusableTiers = FUSABLE_TARGET_TIERS.filter(t => t !== "ultimate" || hasUltimate);
    context.hasUltimateSkill = hasUltimate;

    context.bodyParts = actor.items.filter(i => i.type === "body_part");
    context.statusLabels = MEU_SISTEMA.BODY_PART_STATUS_LABELS;
    context.titles = actor.system.titles;
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
    html.find(".skill-fuse-button").on("click", this._onFuseSkills.bind(this));
    html.find(".skill-request-button").on("click", this._onRequestSkillCreation.bind(this));
    html.find(".attribute-roll").on("click", this._onRollAttribute.bind(this));
    html.find(".sp-break").on("click", this._onBreakSkillPoints.bind(this));
    html.find(".sp-merge").on("click", this._onMergeSkillPoints.bind(this));
    html.find(".currency-convert").on("click", this._onConvertCurrency.bind(this));
    html.find(".currency-send").on("click", this._onSendCurrency.bind(this));
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
   * Aplica automaticamente o Preset de Partes do Corpo E Skills Raciais da
   * espécie selecionada, substituindo as partes/skills raciais atuais após
   * confirmação do usuário.
   */
  async _applySpeciesPreset(speciesKey) {
    if (this.actor.system.lastAppliedSpeciesPreset === speciesKey) return;

    const presets = getActiveSpeciesPresets();
    const preset = presets[speciesKey];
    if (!preset) return;

    const confirmed = await Dialog.confirm({
      title: "Aplicar Preset de Espécie",
      content: `<p>Substituir Partes do Corpo e Skills Raciais atuais pelo preset de <strong>${preset.label}</strong>?</p>`
    });
    if (!confirmed) return;

    if (isAnatomyEnabled()) {
      const existingParts = this.actor.items.filter(i => i.type === "body_part");
      if (existingParts.length) {
        await this.actor.deleteEmbeddedDocuments("Item", existingParts.map(p => p.id));
      }
      const newPartsData = (preset.parts ?? []).map(part => ({
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
      const createdParts = await this.actor.createEmbeddedDocuments("Item", newPartsData);
      for (const part of createdParts) await registerItemInCompendium(part.toObject());
    }

    const existingRacial = this.actor.items.filter(i => i.type === "skill" && i.system.tier === "racial");
    if (existingRacial.length) {
      await this.actor.deleteEmbeddedDocuments("Item", existingRacial.map(s => s.id));
    }
    const newSkillsData = (preset.skills ?? []).map(s => ({
      name: s.name,
      type: "skill",
      system: {
        tier: "racial",
        level: Number(s.level) || 1,
        cost: Number(s.cost) || 0,
        description: s.description || ""
      }
    }));
    if (newSkillsData.length) {
      const createdSkills = await this.actor.createEmbeddedDocuments("Item", newSkillsData);
      for (const s of createdSkills) await registerItemInCompendium(s.toObject());
    }

    await this.actor.update({ "system.lastAppliedSpeciesPreset": speciesKey });
  }

  /* -------------------------------------------- */
  /*  Atributos                                    */
  /* -------------------------------------------- */

  async _onRollAttribute(event) {
    event.preventDefault();
    const key = event.currentTarget.closest("[data-attribute]").dataset.attribute;
    await rollAttribute(this.actor, key);
  }

  /* -------------------------------------------- */
  /*  Pontos de Habilidade                         */
  /* -------------------------------------------- */

  async _onBreakSkillPoints(event) {
    event.preventDefault();
    const tier = event.currentTarget.closest("[data-tier]").dataset.tier;
    try {
      await breakSkillPoints(this.actor, tier);
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao quebrar Pontos de Habilidade.`, err);
    }
  }

  async _onMergeSkillPoints(event) {
    event.preventDefault();
    const tier = event.currentTarget.closest("[data-tier]").dataset.tier;
    try {
      await mergeSkillPoints(this.actor, tier);
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao fundir Pontos de Habilidade.`, err);
    }
  }

  /** Jogador pede pra criar uma skill gastando 1 Ponto de Habilidade — precisa de aprovação do Mestre. */
  async _onRequestSkillCreation(event) {
    event.preventDefault();
    const data = await this._promptSkillRequest();
    if (!data) return;
    try {
      await requestSkillCreation(this.actor, data);
      ui.notifications.info("Pedido enviado ao Mestre para aprovação.");
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao pedir criação de skill.`, err);
    }
  }

  async _promptSkillRequest() {
    const options = MEU_SISTEMA.SKILL_POINT_TIERS.map(
      t => `<option value="${t}">${MEU_SISTEMA.SKILL_TIER_LABELS[t]} (${this.actor.system.skillPoints[t] ?? 0} disponíveis)</option>`
    ).join("");

    return Dialog.wait({
      title: "Pedir Criação de Skill (gasta 1 Ponto de Habilidade)",
      content: `
        <form>
          <div class="form-group"><label>Tier</label><select name="tier">${options}</select></div>
          <div class="form-group"><label>Nome</label><input type="text" name="name"/></div>
          <div class="form-group"><label>Efeito</label><textarea name="description" rows="4"></textarea></div>
          <div class="form-group"><label>Custo de Energia (pra usar)</label><input type="number" name="cost" value="0"/></div>
        </form>`,
      buttons: {
        confirm: {
          label: "Enviar Pedido",
          callback: html => ({
            tier: html.find("[name=tier]").val(),
            name: html.find("[name=name]").val(),
            description: html.find("[name=description]").val(),
            cost: Number(html.find("[name=cost]").val()) || 0
          })
        },
        cancel: { label: "Cancelar", callback: () => null }
      },
      default: "confirm",
      close: () => null
    });
  }

  /* -------------------------------------------- */
  /*  Economia: conversão e transferência          */
  /* -------------------------------------------- */

  async _onConvertCurrency(event) {
    event.preventDefault();
    const data = await this._promptCurrencyConversion();
    if (!data) return;
    try {
      const received = await convertActorCurrency(this.actor, data.fromId, data.toId, data.amount);
      ui.notifications.info(`Convertido. Recebido: ${received.toFixed(2)}.`);
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao converter moeda.`, err);
    }
  }

  async _promptCurrencyConversion() {
    const currencies = getActiveCurrencies();
    const opts = currencies.map(c => `<option value="${c.id}">${c.label}</option>`).join("");
    return Dialog.wait({
      title: "Converter Moeda",
      content: `
        <form>
          <div class="form-group"><label>De</label><select name="fromId">${opts}</select></div>
          <div class="form-group"><label>Para</label><select name="toId">${opts}</select></div>
          <div class="form-group"><label>Quantidade</label><input type="number" name="amount" value="1" min="1"/></div>
        </form>`,
      buttons: {
        confirm: {
          label: "Converter",
          callback: html => ({
            fromId: html.find("[name=fromId]").val(),
            toId: html.find("[name=toId]").val(),
            amount: Number(html.find("[name=amount]").val()) || 0
          })
        },
        cancel: { label: "Cancelar", callback: () => null }
      },
      default: "confirm",
      close: () => null
    });
  }

  async _onSendCurrency(event) {
    event.preventDefault();
    const data = await this._promptCurrencyTransfer();
    if (!data) return;

    const toActor = game.actors.get(data.toActorId);
    if (!toActor) {
      ui.notifications.warn("Destinatário inválido.");
      return;
    }

    try {
      await transferCurrency(this.actor, toActor, data.currencyId, data.amount);
      ui.notifications.info(`Enviado ${data.amount} para ${toActor.name}.`);
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao enviar moeda.`, err);
    }
  }

  async _promptCurrencyTransfer() {
    const currencies = getActiveCurrencies();
    const currencyOpts = currencies.map(c => `<option value="${c.id}">${c.label}</option>`).join("");
    const recipients = game.actors.filter(a => a.id !== this.actor.id && a.testUserPermission(game.user, "OBSERVER"));
    const recipientOpts = recipients.map(a => `<option value="${a.id}">${a.name}</option>`).join("");

    if (!recipients.length) {
      ui.notifications.warn("Nenhum outro Ator visível para receber a transferência.");
      return null;
    }

    return Dialog.wait({
      title: "Enviar Dinheiro",
      content: `
        <form>
          <div class="form-group"><label>Destinatário</label><select name="toActorId">${recipientOpts}</select></div>
          <div class="form-group"><label>Moeda</label><select name="currencyId">${currencyOpts}</select></div>
          <div class="form-group"><label>Quantidade</label><input type="number" name="amount" value="1" min="1"/></div>
        </form>`,
      buttons: {
        confirm: {
          label: "Enviar",
          callback: html => ({
            toActorId: html.find("[name=toActorId]").val(),
            currencyId: html.find("[name=currencyId]").val(),
            amount: Number(html.find("[name=amount]").val()) || 0
          })
        },
        cancel: { label: "Cancelar", callback: () => null }
      },
      default: "confirm",
      close: () => null
    });
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
      if (tier === "unique" || tier === "ultimate") {
        const manualData = await this._promptManualSpecialData(tier);
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
    const hasUltimate = this.actor.system.hasUltimateSkill;
    const tiers = FUSABLE_TARGET_TIERS.filter(t => t !== "ultimate" || hasUltimate);
    const options = tiers
      .map(t => `<option value="${t}">${MEU_SISTEMA.SKILL_TIER_LABELS[t]}</option>`)
      .join("");

    return Dialog.wait({
      title: "Fundir Habilidades",
      content: `
        <form>
          <div class="form-group">
            <label>Tier resultante</label>
            <select name="tier">${options}</select>
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

  /** Modo Manual: o Mestre insere/aprova o efeito e a emoção da Skill Única/Ultimate. */
  async _promptManualSpecialData(tier) {
    const tierLabel = MEU_SISTEMA.SKILL_TIER_LABELS[tier];
    return Dialog.wait({
      title: `Skill ${tierLabel} — Aprovação do Mestre`,
      content: `
        <form>
          <div class="form-group"><label>Nome</label><input type="text" name="name"/></div>
          <div class="form-group"><label>Efeito</label><textarea name="effect" rows="4"></textarea></div>
          <div class="form-group"><label>Emoção / Gatilho</label><input type="text" name="emotion"/></div>
        </form>`,
      buttons: {
        confirm: {
          label: `Criar Skill ${tierLabel}`,
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
