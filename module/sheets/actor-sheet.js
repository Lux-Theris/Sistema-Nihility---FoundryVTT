import {
  SYSTEM_ID,
  MEU_SISTEMA,
  getCharacterEnergyLabel,
  getActiveCurrencies,
  getActiveSpeciesPresets,
  isEconomyEnabled,
  isTitlesEnabled,
  isAnatomyEnabled,
  debugLog
} from "../config.js";
import { fuseSkills, evolveSkill, breakSkillPoints, mergeSkillPoints, requestSkillCreation } from "../skill-economy.js";
import { registerItemInCompendium } from "../compendium.js";
import { convertActorCurrency, transferCurrency } from "../currency.js";
import { rollAttribute } from "../dice.js";
import { useSkillEffect, tickPeriodicEffect } from "../skill-effects.js";
import { areaEffectsSupported, pickAreaTargets } from "../area-effects.js";
import { openSkillEditorDialog } from "../apps/skill-editor-dialog.js";

const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

const CREATABLE_ITEM_TYPES = ["skill", "body_part", "title", "item"];
const COMPENDIUM_MANAGED_TYPES = ["skill", "body_part", "title", "starship_module"];

/** Tiers que fazem sentido como *resultado* de uma fusão (Racial nunca — só vem da Espécie). */
const FUSABLE_TARGET_TIERS = ["extra", "normal", "unique", "ultimate"];

/** Percentual (0-100) usado para desenhar as barras de HP/Energia no cabeçalho. */
function percentOf(value, max) {
  if (!max) return 0;
  return Math.round(Math.clamp((value / max) * 100, 0, 100));
}

/**
 * Diálogo simples de confirmar/cancelar com um `<form>` livre no conteúdo — substitui o
 * padrão `Dialog.wait({buttons:{confirm,cancel}})` do AppV1. `onConfirm(formElement)` lê os
 * campos via DOM puro (não mais jQuery `.val()`) e devolve o valor que a Promise resolve.
 */
async function promptDialog({ title, content, confirmLabel = "Confirmar", onConfirm }) {
  return DialogV2.wait({
    window: { title },
    content,
    buttons: [
      {
        action: "confirm",
        label: confirmLabel,
        default: true,
        callback: (event, button, dialog) => onConfirm(dialog.element)
      },
      // DialogV2.wait faz `result ?? button.action`: null/undefined viram a STRING "cancel"
      // (o `action`), que é truthy — o `if (!data) return;` dos chamadores nunca disparava.
      // `false` sobrevive ao `??` (só null/undefined são substituídos) e continua falsy.
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });
}

/**
 * Ficha de Personagens e Criaturas (type "character") — cobre também Montarias
 * e qualquer outro ser vivo/não-vivo gerado como "character": todos têm acesso
 * total ao mesmo sistema de Atributos, Pontos de Habilidade e Fusão de Skills.
 * Migrado pra ApplicationV2 (ActorSheetV2) — ver plano de migração.
 */
export class NihilityActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "actor"],
    position: { width: 780, height: 860 },
    // DocumentSheetV2 não liga auto-save por padrão — sem isso nenhum campo da ficha
    // (atributos, HP/Mana, Pontos de Habilidade, etc.) persiste ao editar (ver mesma
    // linha em item-sheet.js, que já tinha isso corretamente).
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      selectTab: NihilityActorSheet.#onSelectTab,
      createItem: NihilityActorSheet.#onItemCreate,
      editItem: NihilityActorSheet.#onItemEdit,
      deleteItem: NihilityActorSheet.#onItemDelete,
      fuseSkills: NihilityActorSheet.#onFuseSkills,
      useSkill: NihilityActorSheet.#onUseSkill,
      evolveSkill: NihilityActorSheet.#onEvolveSkill,
      requestSkillCreation: NihilityActorSheet.#onRequestSkillCreation,
      rollAttribute: NihilityActorSheet.#onRollAttribute,
      breakSkillPoints: NihilityActorSheet.#onBreakSkillPoints,
      mergeSkillPoints: NihilityActorSheet.#onMergeSkillPoints,
      convertCurrency: NihilityActorSheet.#onConvertCurrency,
      sendCurrency: NihilityActorSheet.#onSendCurrency,
      levelUpActor: NihilityActorSheet.#onLevelUpActor,
      toggleVitalAdjust: NihilityActorSheet.#onToggleVitalAdjust,
      adjustVital: NihilityActorSheet.#onAdjustVital,
      restActor: NihilityActorSheet.#onRest,
      editImage: NihilityActorSheet.#onEditImage,
      applyManualTick: NihilityActorSheet.#onApplyManualTick,
      deleteCondition: NihilityActorSheet.#onDeleteCondition
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/actor-sheet.hbs`, scrollable: [".sheet-body"] }
  };

  constructor(options = {}) {
    super(options);
    // ApplicationV2 não herda o mixin de abas do AppV1 — mesmo padrão manual usado nas
    // outras Sheets/Apps já migradas (activeTab + ação "selectTab").
    this.activeTab = "ficha";
  }

  /**
   * @override
   * Sem isso o título da janela cai no formato padrão do Foundry ("TYPES.Actor.character:
   * nome"), que mostra a chave de tradução crua quando ninguém registrou esse label em
   * lang/*.json — o nome sozinho já é suficiente, igual o resto das fichas deste sistema.
   */
  get title() {
    return this.actor.name;
  }

  /**
   * Clique no retrato abre o FilePicker de imagem — no ApplicationV2 isso não é mais
   * automático só por causa do atributo `data-edit`; precisa de uma action de verdade.
   */
  static async #onEditImage(event, target) {
    const field = target.dataset.edit || "img";
    const current = foundry.utils.getProperty(this.actor, field);
    const fp = new FilePicker({
      type: "image",
      current,
      callback: path => this.actor.update({ [field]: path })
    });
    fp.render(true);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;

    context.actor = actor;
    context.owner = actor.isOwner;
    context.activeTab = this.activeTab;
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
    context.hpPercent = percentOf(actor.system.attributes.hp.value, actor.system.attributes.hp.max);
    context.energyPercent = percentOf(actor.system.attributes.energy.value, actor.system.attributes.energy.max);
    context.shieldValue = actor.system.attributes.shield.value;

    // Condições ativas: só os Active Effects que este sistema criou (skillEffect: true) —
    // Active Effects de outras origens (módulos, core) não entram nessa lista. Periódicas com
    // tickUnit "manual" (cura/dano de longo prazo fora de combate) ganham o botão de tick;
    // "combatRound" tica sozinho pelo hook updateCombat, sem precisar de botão nenhum aqui.
    context.activeConditions = actor.effects
      .filter(e => e.flags?.[SYSTEM_ID]?.skillEffect)
      .map(e => {
        const flags = e.flags[SYSTEM_ID];
        return {
          id: e.id,
          name: e.name,
          img: e.img,
          periodic: Boolean(flags.periodic),
          manual: flags.tickUnit === "manual",
          ticksRemaining: flags.ticksRemaining,
          roundsRemaining: e.duration?.rounds ?? null
        };
      });

    // "Ultimate" só fica escondida do jogador — o Mestre sempre vê/pode escolher,
    // já que às vezes precisa conceder ou ajustar uma na mão.
    const ultimateVisible = actor.system.hasUltimateSkill || game.user.isGM;
    const skills = actor.items.filter(i => i.type === "skill");
    context.skillsByTier = {};
    context.visibleTiers = MEU_SISTEMA.SKILL_TIERS.filter(t => t !== "ultimate" || ultimateVisible);
    for (const tier of MEU_SISTEMA.SKILL_TIERS) {
      context.skillsByTier[tier] = skills.filter(s => s.system.tier === tier);
    }
    context.tierLabels = MEU_SISTEMA.SKILL_TIER_LABELS;
    context.fusableTiers = FUSABLE_TARGET_TIERS.filter(t => t !== "ultimate" || ultimateVisible);
    context.hasUltimateSkill = actor.system.hasUltimateSkill;

    context.bodyParts = actor.items.filter(i => i.type === "body_part");
    context.statusLabels = MEU_SISTEMA.BODY_PART_STATUS_LABELS;
    context.titles = actor.system.titles;
    context.gear = actor.items.filter(i => i.type === "item");

    debugLog(`${SYSTEM_ID} | NihilityActorSheet._prepareContext:`, actor.name);
    return context;
  }

  /**
   * @override
   * O select de Espécie dispara em "change", não em clique — fora da API de `actions`
   * (clique-only), então é ligado manualmente aqui, a cada render.
   */
  _onRender(context, options) {
    super._onRender(context, options);
    if (!this.isEditable) return;

    this.element.querySelector(".species-select")?.addEventListener("change", this._onSpeciesChange.bind(this));
  }

  static #onSelectTab(event, target) {
    event.preventDefault();
    this.activeTab = target.dataset.tab;
    this.render();
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

    const confirmed = await DialogV2.confirm({
      window: { title: "Aplicar Preset de Espécie" },
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
        hasUpkeep: Boolean(s.hasUpkeep),
        upkeepCost: Number(s.upkeepCost) || 0,
        animationPath: s.animationPath || "",
        description: s.description || "",
        effectType: MEU_SISTEMA.SKILL_EFFECT_TYPES.includes(s.effectType) ? s.effectType : "none",
        damageFormula: s.damageFormula || "",
        isMagicDamage: Boolean(s.isMagicDamage),
        damageElements: Array.isArray(s.damageElements) ? s.damageElements : [],
        effects: Array.isArray(s.effects) ? s.effects : [],
        resistanceTarget: s.resistanceTarget || "",
        targetType: s.targetType === "emission" ? "emission" : "targeted",
        areaShape: s.areaShape || "",
        areaDistance: Number(s.areaDistance) || 0,
        areaAngle: Number(s.areaAngle) || 53
      }
    }));
    if (newSkillsData.length) {
      const createdSkills = await this.actor.createEmbeddedDocuments("Item", newSkillsData);
      for (const s of createdSkills) await registerItemInCompendium(s.toObject());
    }

    await this.actor.update({ "system.lastAppliedSpeciesPreset": speciesKey });
  }

  /* -------------------------------------------- */
  /*  Level Up (só GM — o campo de Nível é readonly pro jogador)  */
  /* -------------------------------------------- */

  static async #onLevelUpActor(event, target) {
    event.preventDefault();
    const newLevel = this.actor.system.attributes.level + 1;
    await this.actor.update({ "system.attributes.level": newLevel });
  }

  /* -------------------------------------------- */
  /*  Ajuste rápido de HP/Mana (estilo D&D Beyond) */
  /* -------------------------------------------- */

  /** Abre/fecha o popover de "digite um valor + Dano/Cura" abaixo da barra de HP ou Mana clicada. */
  static #onToggleVitalAdjust(event, target) {
    event.preventDefault();
    const vital = target.closest(".vital-row")?.dataset.vital;
    if (!vital) return;
    this.element.querySelectorAll(".vital-adjust-popover").forEach(pop => {
      pop.classList.toggle("open", pop.dataset.vital === vital && !pop.classList.contains("open"));
    });
  }

  /** Aplica o valor digitado no popover como Dano (-) ou Cura (+), sem passar de 0 nem do Máximo. */
  static async #onAdjustVital(event, target) {
    event.preventDefault();
    const vital = target.dataset.vital;
    const dir = Number(target.dataset.dir);
    const popover = target.closest(".vital-adjust-popover");
    const input = popover?.querySelector(".vital-adjust-input");
    const amount = Math.max(0, Number(input?.value) || 0);
    if (!amount) return;

    const attr = this.actor.system.attributes[vital];
    const newValue = Math.clamp(attr.value + dir * amount, 0, attr.max);
    await this.actor.update({ [`system.attributes.${vital}.value`]: newValue });
  }

  /** Descanso Completo: cura HP e Mana/Energia direto pro Máximo. */
  static async #onRest(event, target) {
    event.preventDefault();
    const { hp, energy } = this.actor.system.attributes;
    await this.actor.update({
      "system.attributes.hp.value": hp.max,
      "system.attributes.energy.value": energy.max
    });
    ui.notifications.info(`${this.actor.name} descansou e recuperou HP/${getCharacterEnergyLabel()} ao máximo.`);
  }

  /* -------------------------------------------- */
  /*  Condições Ativas (Efeitos Periódicos/nomeados)*/
  /* -------------------------------------------- */

  /**
   * Bate um tick manual de uma Condição Periódica com `tickUnit: "manual"` (cura/dano de longo
   * prazo fora de combate — não tem hook de tempo/calendário, então é o jogador/Mestre quem
   * decide quando aplicar, ex: "descansou uma hora"). Condições `tickUnit: "combatRound"` já
   * ticam sozinhas pelo hook `updateCombat` — não aparecem com esse botão na ficha.
   */
  static async #onApplyManualTick(event, target) {
    event.preventDefault();
    const effectId = target.closest("[data-effect-id]")?.dataset.effectId;
    const effect = this.actor.effects.get(effectId);
    if (!effect) return;

    const result = await tickPeriodicEffect(this.actor, effect);
    if (!result) return;

    const attrLabel = result.attrKey === "hp" ? "HP" : getCharacterEnergyLabel();
    const reductionText = result.appliedReductions?.length ? ` — reduzido por ${result.appliedReductions.join(", ")}` : "";
    ui.notifications.info(
      `${effect.name}: ${result.delta >= 0 ? "+" : ""}${result.delta} ${attrLabel}${reductionText}` +
        (result.expired ? " (encerrou)." : ` (${result.ticksRemaining} tick(s) restante(s)).`)
    );
  }

  /** Remove uma Condição Ativa antes do prazo (ex: curada por outra Skill/poção). */
  static async #onDeleteCondition(event, target) {
    event.preventDefault();
    const effectId = target.closest("[data-effect-id]")?.dataset.effectId;
    await this.actor.deleteEmbeddedDocuments("ActiveEffect", [effectId]);
  }

  /* -------------------------------------------- */
  /*  Atributos                                    */
  /* -------------------------------------------- */

  static async #onRollAttribute(event, target) {
    event.preventDefault();
    const key = target.closest("[data-attribute]").dataset.attribute;
    const attr = this.actor.system.attributes.combat[key];
    // Bônus de Item/Modificação nunca entra no Pool de d20 — soma por fora, como número fixo.
    await rollAttribute(this.actor, key, { extraFlat: attr?.itemBonus ?? 0 });
  }

  /* -------------------------------------------- */
  /*  Pontos de Habilidade                         */
  /* -------------------------------------------- */

  static async #onBreakSkillPoints(event, target) {
    event.preventDefault();
    const tier = target.closest("[data-tier]").dataset.tier;
    try {
      await breakSkillPoints(this.actor, tier);
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao quebrar Pontos de Habilidade.`, err);
    }
  }

  static async #onMergeSkillPoints(event, target) {
    event.preventDefault();
    const tier = target.closest("[data-tier]").dataset.tier;
    try {
      await mergeSkillPoints(this.actor, tier);
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao fundir Pontos de Habilidade.`, err);
    }
  }

  /** Jogador pede pra criar uma skill gastando 1 Ponto de Habilidade — precisa de aprovação do Mestre. */
  static async #onRequestSkillCreation(event, target) {
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

    return promptDialog({
      title: "Pedir Criação de Skill (gasta 1 Ponto de Habilidade)",
      confirmLabel: "Enviar Pedido",
      content: `
        <form>
          <div class="form-group"><label>Tier</label><select name="tier">${options}</select></div>
          <div class="form-group"><label>Nome</label><input type="text" name="name"/></div>
          <div class="form-group"><label>Efeito</label><textarea name="description" rows="4"></textarea></div>
          <div class="form-group"><label>Custo de Energia (pra usar)</label><input type="number" name="cost" value="0"/></div>
        </form>`,
      onConfirm: form => ({
        tier: form.querySelector("[name=tier]").value,
        name: form.querySelector("[name=name]").value,
        description: form.querySelector("[name=description]").value,
        cost: Number(form.querySelector("[name=cost]").value) || 0
      })
    });
  }

  /* -------------------------------------------- */
  /*  Economia: conversão e transferência          */
  /* -------------------------------------------- */

  static async #onConvertCurrency(event, target) {
    event.preventDefault();
    const data = await this._promptCurrencyConversion();
    if (!data) return;
    try {
      const received = await convertActorCurrency(this.actor, data.fromId, data.toId, data.amount);
      ui.notifications.info(`Convertido. Recebido: ${received} (resto, se houver, caiu pra moeda de baixo).`);
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao converter moeda.`, err);
    }
  }

  async _promptCurrencyConversion() {
    const currencies = getActiveCurrencies();
    const opts = currencies.map(c => `<option value="${c.id}">${c.label}</option>`).join("");
    return promptDialog({
      title: "Converter Moeda",
      confirmLabel: "Converter",
      content: `
        <form>
          <div class="form-group"><label>De</label><select name="fromId">${opts}</select></div>
          <div class="form-group"><label>Para</label><select name="toId">${opts}</select></div>
          <div class="form-group"><label>Quantidade</label><input type="number" name="amount" value="1" min="1"/></div>
        </form>`,
      onConfirm: form => ({
        fromId: form.querySelector("[name=fromId]").value,
        toId: form.querySelector("[name=toId]").value,
        amount: Number(form.querySelector("[name=amount]").value) || 0
      })
    });
  }

  static async #onSendCurrency(event, target) {
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

    return promptDialog({
      title: "Enviar Dinheiro",
      confirmLabel: "Enviar",
      content: `
        <form>
          <div class="form-group"><label>Destinatário</label><select name="toActorId">${recipientOpts}</select></div>
          <div class="form-group"><label>Moeda</label><select name="currencyId">${currencyOpts}</select></div>
          <div class="form-group"><label>Quantidade</label><input type="number" name="amount" value="1" min="1"/></div>
        </form>`,
      onConfirm: form => ({
        toActorId: form.querySelector("[name=toActorId]").value,
        currencyId: form.querySelector("[name=currencyId]").value,
        amount: Number(form.querySelector("[name=amount]").value) || 0
      })
    });
  }

  /* -------------------------------------------- */
  /*  CRUD de Items embutidos                      */
  /* -------------------------------------------- */

  static async #onItemCreate(event, target) {
    event.preventDefault();
    const type = target.dataset.type;
    if (!CREATABLE_ITEM_TYPES.includes(type)) return;

    // Skill é o único tipo criado através do editor único (mesmo modal usado por Skills
    // Raciais em species-config.js e pelo botão "Editar Skill" na ficha de Item) — os
    // outros tipos continuam nascendo em branco e abrindo a própria ficha pra preencher.
    if (type === "skill") {
      const hasUltimate = this.actor.system.hasUltimateSkill;
      const ultimateVisible = hasUltimate || game.user.isGM;
      const tierChoices = MEU_SISTEMA.SKILL_TIERS.filter(t => t !== "racial" && (t !== "ultimate" || ultimateVisible));

      const data = await openSkillEditorDialog({}, { tierChoices, levelReadonly: !game.user.isGM });
      if (!data) return;

      const [created] = await this.actor.createEmbeddedDocuments("Item", [
        {
          name: data.name,
          type: "skill",
          system: {
            tier: data.tier,
            level: data.level,
            cost: data.cost,
            hasUpkeep: data.hasUpkeep,
            upkeepCost: data.upkeepCost,
            animationPath: data.animationPath,
            description: data.description,
            resistanceTarget: data.resistanceTarget,
            effectType: data.effectType,
            damageFormula: data.damageFormula,
            isMagicDamage: data.isMagicDamage,
            damageElements: data.damageElements,
            effects: data.effects,
            targetType: data.targetType,
            areaShape: data.areaShape,
            areaDistance: data.areaDistance,
            areaAngle: data.areaAngle
          }
        }
      ]);
      await registerItemInCompendium(created.toObject());
      created.sheet.render(true);
      return;
    }

    const [created] = await this.actor.createEmbeddedDocuments("Item", [
      { name: `Novo: ${type}`, type }
    ]);
    if (COMPENDIUM_MANAGED_TYPES.includes(type)) {
      await registerItemInCompendium(created.toObject());
    }
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

  /**
   * Evolução: 1 Skill vira uma Skill NOVA e diferente (definida do zero no editor único) — só
   * fica o registro histórico "Evoluiu de: X". Diferente de Fundir Selecionadas (2+ fontes),
   * essa ação parte de uma única linha da lista.
   */
  static async #onEvolveSkill(event, target) {
    event.preventDefault();
    const itemId = target.closest(".item-row").dataset.itemId;

    const hasUltimate = this.actor.system.hasUltimateSkill;
    const ultimateVisible = hasUltimate || game.user.isGM;
    const tierChoices = MEU_SISTEMA.SKILL_TIERS.filter(t => t !== "racial" && (t !== "ultimate" || ultimateVisible));

    const data = await openSkillEditorDialog({}, { tierChoices, levelReadonly: !game.user.isGM });
    if (!data) return;

    try {
      await evolveSkill(this.actor, itemId, data);
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao Evoluir habilidade.`, err);
    }
  }

  /* -------------------------------------------- */
  /*  Usar Habilidade (dano / efeito temporário)   */
  /* -------------------------------------------- */

  static async #onUseSkill(event, target) {
    event.preventDefault();
    const itemId = target.closest(".item-row").dataset.itemId;
    const skill = this.actor.items.get(itemId);
    if (!skill) return;

    const subSkills = skill.system.subSkills ?? [];
    let subSkillIndex = null;
    let mech = skill.system;

    if (subSkills.length) {
      subSkillIndex = await this._promptSubSkillChoice(skill, subSkills);
      if (subSkillIndex === null) return; // cancelou o picker
      mech = subSkills[subSkillIndex];
    }

    // Habilidade Ativa já ligada: este clique só DESATIVA — nunca re-pede alvo nem re-executa
    // a mecânica, mesmo se ela for "damage"/"temporary" (ver useSkillEffect em skill-effects.js).
    const isDeactivating = mech.hasUpkeep && mech.active;
    const usesMechanic = !isDeactivating && (mech.effectType === "temporary" || mech.effectType === "damage");
    if (!usesMechanic) {
      try {
        await useSkillEffect(this.actor, itemId, { subSkillIndex });
      } catch (err) {
        console.error(`${SYSTEM_ID} | Falha ao usar habilidade.`, err);
      }
      return;
    }

    try {
      if (mech.targetType === "emission") {
        // Sem alvo manual — o usuário posiciona a forma no canvas e a Skill afeta quem
        // estiver dentro dela, sem etapa de revisão (decisão explícita: aplica direto).
        if (!areaEffectsSupported()) {
          ui.notifications.warn("Skills de Emissão precisam de acesso ao canvas da cena ativa.");
          return;
        }
        const targetActors = await pickAreaTargets({ system: mech });
        await useSkillEffect(this.actor, itemId, { targetActors, subSkillIndex });
      } else {
        // Todo dano pode ser reduzido (Defesa Mágica, e/ou Resistência Geral/Elemental do
        // alvo — inclusive dano puramente físico, se o alvo tiver Resistência Física) — então
        // "damage" sempre pede alvo, igual "temporary" (buff/debuff) já pedia.
        const targetActor = await this._promptSkillTarget();
        if (!targetActor) return;
        await useSkillEffect(this.actor, itemId, { targetActor, subSkillIndex });
      }
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao usar habilidade.`, err);
    }
  }

  /**
   * Skill Fundida: deixa escolher QUAL componente disparar (cada um com seu próprio efeito) —
   * igual as Skills Únicas do Tensura, várias sub-habilidades nomeadas dentro de uma só Skill
   * "guarda-chuva". Devolve o índice escolhido em `subSkills`, ou `null` se cancelado.
   */
  async _promptSubSkillChoice(skill, subSkills) {
    const options = subSkills
      .map((sub, i) => `<option value="${i}">${sub.name} — ${sub.effectType === "damage" ? "Dano" : sub.effectType === "temporary" ? "Efeito Temporário" : "Descritiva"}</option>`)
      .join("");

    const index = await promptDialog({
      title: `Usar ${skill.name}`,
      confirmLabel: "Usar",
      content: `
        <form>
          <div class="form-group"><label>Qual componente disparar?</label><select name="subSkillIndex">${options}</select></div>
        </form>`,
      onConfirm: form => Number(form.querySelector("[name=subSkillIndex]").value)
    });
    // Cancelar resolve como `false` (ver comentário no botão "cancel" de promptDialog) —
    // precisa de checagem explícita porque índice 0 (primeira sub-skill) é um valor válido.
    return index === undefined || index === null || index === false ? null : index;
  }

  /** Escolhe o alvo de um Efeito Temporário (buff/debuff/escudo) ou de dano mágico — padrão: o próprio dono. */
  async _promptSkillTarget() {
    const candidates = game.actors.filter(a => a.testUserPermission(game.user, "OBSERVER"));
    const opts = candidates
      .map(a => `<option value="${a.id}" ${a.id === this.actor.id ? "selected" : ""}>${a.name}${a.id === this.actor.id ? " (você mesmo)" : ""}</option>`)
      .join("");

    const targetId = await promptDialog({
      title: "Escolher Alvo",
      confirmLabel: "Usar Habilidade",
      content: `
        <form>
          <div class="form-group"><label>Alvo</label><select name="targetId">${opts}</select></div>
        </form>`,
      onConfirm: form => form.querySelector("[name=targetId]").value
    });
    if (!targetId) return null;
    return game.actors.get(targetId) ?? null;
  }

  /* -------------------------------------------- */
  /*  Fusão de Skills                              */
  /* -------------------------------------------- */

  static async #onFuseSkills(event, target) {
    event.preventDefault();
    const ids = Array.from(this.element.querySelectorAll(".skill-fuse-checkbox:checked")).map(el => el.dataset.itemId);

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
    const ultimateVisible = this.actor.system.hasUltimateSkill || game.user.isGM;
    const tiers = FUSABLE_TARGET_TIERS.filter(t => t !== "ultimate" || ultimateVisible);
    const options = tiers
      .map(t => `<option value="${t}">${MEU_SISTEMA.SKILL_TIER_LABELS[t]}</option>`)
      .join("");

    return promptDialog({
      title: "Fundir Habilidades",
      confirmLabel: "Continuar",
      content: `
        <form>
          <div class="form-group">
            <label>Tier resultante</label>
            <select name="tier">${options}</select>
          </div>
        </form>`,
      onConfirm: form => form.querySelector("select[name=tier]").value
    });
  }

  /** Modo Manual: o Mestre insere/aprova o efeito e a emoção da Skill Única/Ultimate. */
  async _promptManualSpecialData(tier) {
    const tierLabel = MEU_SISTEMA.SKILL_TIER_LABELS[tier];
    return promptDialog({
      title: `Skill ${tierLabel} — Aprovação do Mestre`,
      confirmLabel: `Criar Skill ${tierLabel}`,
      content: `
        <form>
          <div class="form-group"><label>Nome</label><input type="text" name="name"/></div>
          <div class="form-group"><label>Efeito</label><textarea name="effect" rows="4"></textarea></div>
          <div class="form-group"><label>Emoção / Gatilho</label><input type="text" name="emotion"/></div>
        </form>`,
      onConfirm: form => ({
        name: form.querySelector("[name=name]").value,
        effect: form.querySelector("[name=effect]").value,
        emotion: form.querySelector("[name=emotion]").value
      })
    });
  }
}
