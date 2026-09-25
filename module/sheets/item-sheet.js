import {
  SYSTEM_ID,
  MEU_SISTEMA,
  getActiveDamageElements,
  getActiveCurrencies,
  getResistanceTargetOptions,
  getModuleSizePreset,
  getStarshipEnergyAbbr,
  isResistancesEnabled,
  isSkillPointsEnabled,
  getVisibleAttributes,
  getAttributeLabel,
  getEffectTargetLabels,
  getActiveStatusConditions,
  getCharacterEnergyLabel,
  isStatusConditionsEnabled,
  isAreaEffectsEnabled,
  debugLog
} from "../config.js";
import { createGrantedSkill, removeGrantedSkill, evolveSkill } from "../skill-economy.js";
import { announceVoiceOfTheWorld } from "../voice-of-the-world.js";
import { computeResistanceName, computeResistancePercent, resistanceMaxLevel } from "../skill-effects.js";
import { openSkillEditorDialog } from "../apps/skill-editor-dialog.js";
import { pickImageFile } from "../helpers/foundry-compat.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Ficha genérica de Item, adaptável por `item.type`
 * (skill, body_part, title, starship_module, item).
 * Migrado pra ApplicationV2 (ItemSheetV2) — `form.submitOnChange` mantém o auto-save por
 * campo que a ficha sempre teve; sem `form.handler` explícito, o DocumentSheetV2 aplica o
 * default (grava direto no Item) — se algum campo parar de salvar sozinho ao editar, esse é
 * o primeiro lugar a olhar.
 *
 * Skill: TODOS os campos (Tier/Nível/Custo/Ativa/Descrição/Resistência/Mecânica ao Usar/
 * Alcance/Efeitos) são editados inline na aba Detalhes — não existe segunda camada de edição.
 * `openSkillEditorDialog` só sobrevive como formulário de CRIAÇÃO (Skill Racial em
 * species-config.js, "+ Nova Habilidade (direto)" em actor-sheet.js) e de Evolução. Os
 * Efeitos (`system.effects[]`) não usam `name=` de formulário: um array submetido por linhas
 * parciais perderia os campos que a linha não renderiza (ícone, elementos), então cada
 * controle é gravado por `_onSkillEffectFieldChange`, que reescreve só o campo tocado.
 */
export class NihilityItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "item"],
    position: { width: 560, height: 560 },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      addSubSkill: NihilityItemSheet.#onSubSkillAdd,
      deleteSubSkill: NihilityItemSheet.#onSubSkillDelete,
      addSkillEffect: NihilityItemSheet.#onSkillEffectAdd,
      deleteSkillEffect: NihilityItemSheet.#onSkillEffectDelete,
      toggleSkillElement: NihilityItemSheet.#onSkillElementToggle,
      toggleEffectElement: NihilityItemSheet.#onEffectElementToggle,
      toggleWeaponElement: NihilityItemSheet.#onWeaponElementToggle,
      evolveSkill: NihilityItemSheet.#onEvolveSkill,
      addInstalledMod: NihilityItemSheet.#onInstalledModAdd,
      deleteInstalledMod: NihilityItemSheet.#onInstalledModDelete,
      toggleModGrant: NihilityItemSheet.#onModGrantToggle,
      addTitleBonus: NihilityItemSheet.#onTitleBonusAdd,
      deleteTitleBonus: NihilityItemSheet.#onTitleBonusDelete,
      addItemAttrBonus: NihilityItemSheet.#onItemAttrBonusAdd,
      deleteItemAttrBonus: NihilityItemSheet.#onItemAttrBonusDelete,
      addModAttrBonus: NihilityItemSheet.#onModAttrBonusAdd,
      deleteModAttrBonus: NihilityItemSheet.#onModAttrBonusDelete,
      selectTab: NihilityItemSheet.#onSelectTab,
      levelUpSkill: NihilityItemSheet.#onLevelUpSkill,
      spendPointLevelUp: NihilityItemSheet.#onSpendPointLevelUp,
      addTitleResistance: NihilityItemSheet.#onTitleResistanceAdd,
      deleteTitleResistance: NihilityItemSheet.#onTitleResistanceDelete,
      editImage: NihilityItemSheet.#onEditImage
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/item-sheet.hbs`, scrollable: [".sheet-body"] }
  };

  constructor(options = {}) {
    super(options);
    // ApplicationV2 não herda o mixin de abas do AppV1 — mesmo padrão manual já usado em
    // NihilityMenuApp (activeTab + ação "selectTab"), em vez de depender da config de
    // tabs nova (ainda não validada neste sistema).
    // Skill não tem a aba "Descrição": o <prose-mirror> dela mora dentro de Detalhes.
    this.activeTab = this.item?.type === "skill" ? "details" : "description";
  }

  /**
   * @override
   * Sem isso o título da janela cai no formato padrão do Foundry ("TYPES.Item.skill: nome"),
   * que mostra a chave de tradução crua quando ninguém registrou esse label em lang/*.json.
   */
  get title() {
    return this.item.name;
  }

  static #onSelectTab(event, target) {
    event.preventDefault();
    this.activeTab = target.dataset.tab;
    this.render();
  }

  /** Clique no retrato abre o FilePicker de imagem — precisa de action explícita no ApplicationV2. */
  static async #onEditImage(event, target) {
    const field = target.dataset.edit || "img";
    const current = foundry.utils.getProperty(this.item, field);
    pickImageFile(current, path => this.item.update({ [field]: path }));
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.item.system;
    context.config = MEU_SISTEMA;
    context.itemType = this.item.type;
    context.activeTab = this.activeTab;
    context.currencies = getActiveCurrencies();
    context.item = this.item;
    context.owner = this.item.isOwner;
    context.isGM = game.user.isGM;
    context.resistancesEnabled = isResistancesEnabled();
    // Jogador pode comprar 1 nível de Skill com 1 Ponto de Habilidade do tier dela (Racial/
    // Ultimate não têm Pontos). O Mestre já tem o "+ Nível" livre, então o botão é só do jogador.
    const pointTier = this.item.system?.tier;
    context.canSpendPointLevel =
      this.item.type === "skill" && !game.user.isGM && this.item.isOwner && Boolean(this.item.parent) &&
      isSkillPointsEnabled() && MEU_SISTEMA.SKILL_POINT_TIERS.includes(pointTier);
    context.levelPointBalance = this.item.parent?.system?.skillPoints?.[pointTier] ?? 0;
    // Seletores de bônus de Atributo (Título, Item, Modificação) usam os rótulos e a
    // visibilidade atuais — atributo oculto sai da lista de opções novas.
    context.visibleAttributes = getVisibleAttributes();
    context.effectTargetLabels = getEffectTargetLabels();
    context.titleBonusTargets = MEU_SISTEMA.TITLE_BONUS_TARGETS.filter(
      t => !MEU_SISTEMA.COMBAT_ATTRIBUTES.includes(t) || context.visibleAttributes.some(a => a.key === t)
    );

    // Alvos de Resistência (Geral + cada Elemento ativo) — usado pela Skill (com "Nenhuma"
    // na frente) e pelo Título (uma entrada sempre tem um alvo, sem opção "Nenhuma").
    const resistanceTargets = getResistanceTargetOptions();

    if (this.item.type === "skill") {
      const sys = this.item.system;

      const owner = this.item.parent;
      const hasUltimate = owner?.system?.hasUltimateSkill ?? sys.tier === "ultimate";
      const ultimateVisible = hasUltimate || game.user.isGM;
      context.visibleSkillTiers = MEU_SISTEMA.SKILL_TIERS.filter(t => t !== "ultimate" || ultimateVisible);

      const pick = (list, current) => list.map(([value, label]) => ({ value, label, selected: value === current }));
      const elements = getActiveDamageElements();
      const visibleAttrs = context.visibleAttributes;

      context.energyLabel = getCharacterEnergyLabel();
      context.isRacialSkill = sys.tier === "racial";
      context.skillTierOptions = pick(
        context.visibleSkillTiers.filter(t => t !== "racial").map(t => [t, MEU_SISTEMA.SKILL_TIER_LABELS[t]]),
        sys.tier
      );
      context.skillEffectTypeOptions = pick(
        MEU_SISTEMA.SKILL_EFFECT_TYPES.map(t => [t, MEU_SISTEMA.SKILL_EFFECT_TYPE_LABELS[t]]),
        sys.effectType
      );
      context.skillTargetTypeOptions = pick(
        MEU_SISTEMA.SKILL_TARGET_TYPES.filter(t => isAreaEffectsEnabled() || !["emission", "zone"].includes(t) || sys.targetType === t)
          .map(t => [t, MEU_SISTEMA.SKILL_TARGET_TYPE_LABELS[t]]),
        sys.targetType
      );
      context.skillAreaShapeOptions = pick(
        MEU_SISTEMA.SKILL_AREA_SHAPES.map(s => [s, MEU_SISTEMA.SKILL_AREA_SHAPE_LABELS[s]]),
        sys.areaShape
      );
      // Atributo escondido pela campanha continua listado se a Skill JÁ escala por ele.
      context.skillScalingOptions = pick(
        [["", "— sem escala —"]]
          .concat(visibleAttrs.map(a => [a.key, a.label]))
          .concat(
            sys.scalingAttribute && !visibleAttrs.some(a => a.key === sys.scalingAttribute)
              ? [[sys.scalingAttribute, `${getAttributeLabel(sys.scalingAttribute)} (oculto)`]]
              : []
          ),
        sys.scalingAttribute ?? ""
      );
      context.skillResistanceOptions = pick(
        [["", "— nenhuma —"]].concat(resistanceTargets.map(o => [o.value, o.label])),
        sys.resistanceTarget ?? ""
      );
      context.skillElementChips = elements.map(el => ({
        id: el.id, label: el.label, color: el.color, checked: (sys.damageElements ?? []).includes(el.id)
      }));

      // Efeitos Temporários: uma linha pronta por entrada (opções já com `selected`, pra o
      // template não depender da profundidade de {{#each}} aninhado).
      const targetLabels = getEffectTargetLabels();
      const hiddenAttrs = new Set(MEU_SISTEMA.COMBAT_ATTRIBUTES.filter(k => !visibleAttrs.some(a => a.key === k)));
      context.conditionsEnabled = isStatusConditionsEnabled();
      const conditions = getActiveStatusConditions();
      context.skillEffects = (sys.effects ?? []).map((entry, index) => {
        const acceptsPeriodic = entry.target === "hp" || entry.target === "energy";
        const entryElements = entry.damageElements ?? [];
        return {
          index,
          amount: entry.amount,
          durationRounds: entry.durationRounds,
          icon: entry.icon ?? "",
          periodic: acceptsPeriodic && Boolean(entry.periodic),
          acceptsPeriodic,
          isShipTarget: MEU_SISTEMA.SHIP_EFFECT_TARGETS.includes(entry.target),
          targetOptions: pick(
            MEU_SISTEMA.EFFECT_TARGETS.filter(t => !hiddenAttrs.has(t) || t === entry.target).map(t => [t, targetLabels[t]]),
            entry.target
          ),
          conditionOptions: pick(
            [["", "— sem Condição —"]].concat(conditions.map(c => [c.id, c.label])),
            entry.conditionId ?? ""
          ),
          tickUnitOptions: pick(
            MEU_SISTEMA.PERIODIC_TICK_UNITS.map(u => [u, MEU_SISTEMA.PERIODIC_TICK_UNIT_LABELS[u]]),
            entry.tickUnit
          ),
          modifierTypeOptions: pick(
            MEU_SISTEMA.EFFECT_MODIFIER_TYPES.map(m => [m, MEU_SISTEMA.EFFECT_MODIFIER_TYPE_LABELS[m]]),
            entry.modifierType || "flat"
          ),
          elementChips: elements.map(el => ({
            id: el.id, label: el.label, color: el.color, checked: entryElements.includes(el.id)
          }))
        };
      });

      const resistanceTarget = sys.resistanceTarget ?? "";
      context.isResistanceSkill = resistanceTarget !== "";
      if (context.isResistanceSkill) {
        context.resistanceMaxLevel = resistanceMaxLevel(resistanceTarget);
        context.resistancePercent = Math.round(computeResistancePercent(resistanceTarget, sys.level) * 100);
        context.skillResistanceSummary = `${computeResistanceName(resistanceTarget, sys.level)} — ${context.resistancePercent}% (nível ${sys.level}/${context.resistanceMaxLevel})`;
      }
    }

    if (this.item.type === "item") {
      const weapon = this.item.system.weapon;
      const visibleAttrs = context.visibleAttributes;
      const scalingChoices = [["", "— sem escala —"]].concat(visibleAttrs.map(a => [a.key, a.label]));
      // Atributo escondido pela campanha continua listado se a arma JÁ escala por ele.
      if (weapon.scalingAttribute && !visibleAttrs.some(a => a.key === weapon.scalingAttribute)) {
        scalingChoices.push([weapon.scalingAttribute, `${getAttributeLabel(weapon.scalingAttribute)} (oculto)`]);
      }
      context.weaponScalingOptions = scalingChoices.map(([value, label]) => ({
        value, label, selected: value === (weapon.scalingAttribute ?? "")
      }));
      context.weaponElementChips = getActiveDamageElements().map(el => ({
        id: el.id, label: el.label, color: el.color, checked: (weapon.damageElements ?? []).includes(el.id)
      }));
    }

    if (this.item.type === "starship_module" && this.item.system.category === "distributor") {
      // "Fator 5" não diz nada sozinho: a Capacidade de Transferência sai de
      // `baseline(Porte) × fator`, e a tabela de baseline mora no código. Sem ver o RESULTADO,
      // não há como calibrar o número — nem quem escreveu o Módulo, nem quem recebe ele pronto.
      const factor = Number(this.item.system.transferFactor) || 0;
      const abbr = getStarshipEnergyAbbr();
      context.distributorPreview = {
        abbr,
        rows: MEU_SISTEMA.SHIP_SIZES.map(size => ({
          label: MEU_SISTEMA.SHIP_SIZE_LABELS[size],
          baseline: MEU_SISTEMA.DISTRIBUTOR_BASELINE_BY_SHIP_SIZE[size] ?? 0,
          result: Math.round((MEU_SISTEMA.DISTRIBUTOR_BASELINE_BY_SHIP_SIZE[size] ?? 0) * factor),
          // Destaca a linha do Porte da Nave onde ESTE Módulo está instalado, quando está.
          current: this.item.parent?.system?.shipSize === size
        }))
      };
    }

    if (this.item.type === "title") {
      // Cada entrada de Resistência do Título já tem um alvo escolhido — sem opção "Nenhuma".
      context.titleResistances = (this.item.system.resistances ?? []).map(entry => ({
        ...entry,
        targetOptions: resistanceTargets.map(opt => ({ ...opt, selected: opt.value === entry.target }))
      }));
    }

    debugLog(`${SYSTEM_ID} | NihilityItemSheet._prepareContext (${this.item.type}):`, this.item.name);
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

    this.element.querySelectorAll(".skill-effect-input").forEach(input => {
      input.addEventListener("change", this._onSkillEffectFieldChange.bind(this));
    });

    if (this.item.type === "starship_module") {
      const presetChange = this._onModulePresetChange.bind(this);
      this.element.querySelector('[name="system.category"]')?.addEventListener("change", presetChange);
      this.element.querySelector('[name="system.moduleSize"]')?.addEventListener("change", presetChange);
    }
  }

  /**
   * Autopreenche os campos numéricos de um Módulo de Nave (Overhaul de Naves, Fase 1/8) quando
   * o usuário troca Categoria ou Porte, a partir de `MEU_SISTEMA.MODULE_SIZE_PRESETS`/
   * `MODULE_HP_BY_SIZE` — só sobrescreve um campo se ele ainda estiver no valor-padrão do
   * schema, nunca uma edição manual já feita. `stopPropagation` evita que este mesmo "change"
   * TAMBÉM dispare o submitOnChange padrão do DocumentSheetV2 — os dois juntos fariam dois
   * `update()` concorrentes no mesmo Item (um só com Categoria/Porte, outro com os presets).
   */
  async _onModulePresetChange(event) {
    event.stopPropagation();
    const form = event.currentTarget.closest("form");
    const category = form.querySelector('[name="system.category"]').value;
    const moduleSize = form.querySelector('[name="system.moduleSize"]').value;

    const sys = this.item.system;
    const updates = { "system.category": category, "system.moduleSize": moduleSize };
    const fieldDefaults = { "system.transferFactor": 1, "system.warpFactor": 1, "system.hp.max": 20, "system.hp.value": 20 };

    for (const [key, value] of Object.entries(getModuleSizePreset(category, moduleSize))) {
      const field = key.replace(/^system\./, "");
      const current = foundry.utils.getProperty(sys, field);
      const defaultValue = fieldDefaults[key] ?? (typeof value === "string" ? "" : 0);
      if (current === defaultValue || current === undefined) updates[key] = value;
    }

    await this.item.update(updates);
  }

  /* -------------------------------------------- */
  /*  Efeitos Temporários da Skill (edição inline) */
  /* -------------------------------------------- */

  /** Cópia editável de `system.effects` (objetos simples, nunca o Data Model vivo). */
  #cloneEffects() {
    return foundry.utils.deepClone(this.item.toObject().system.effects ?? []);
  }

  /**
   * Grava UM campo de UMA linha de Efeito. Alvo que não aceita Periódico desliga o Periódico e
   * alvo que não é "de Nave" volta o modificador pra "flat" — o mesmo saneamento que o antigo
   * modal fazia ao trocar o Alvo.
   */
  async _onSkillEffectFieldChange(event) {
    event.stopPropagation();
    const input = event.currentTarget;
    const index = Number(input.closest("[data-index]").dataset.index);
    const effects = this.#cloneEffects();
    const entry = effects[index];
    if (!entry) return;

    const field = input.dataset.effectField;
    if (input.type === "checkbox") entry[field] = input.checked;
    else if (input.type === "number") entry[field] = Number(input.value) || 0;
    else entry[field] = input.value.trim();

    if (field === "target") {
      if (entry.target !== "hp" && entry.target !== "energy") entry.periodic = false;
      if (!MEU_SISTEMA.SHIP_EFFECT_TARGETS.includes(entry.target)) entry.modifierType = "flat";
    }
    await this.item.update({ "system.effects": effects });
  }

  static async #onSkillEffectAdd(event, target) {
    event.preventDefault();
    const effects = this.#cloneEffects();
    effects.push({
      target: MEU_SISTEMA.EFFECT_TARGETS[0],
      amount: 1,
      modifierType: "flat",
      durationRounds: 1,
      conditionId: "",
      icon: "",
      periodic: false,
      tickUnit: "combatRound",
      damageElements: []
    });
    await this.item.update({ "system.effects": effects });
  }

  static async #onSkillEffectDelete(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const effects = this.#cloneEffects();
    effects.splice(index, 1);
    await this.item.update({ "system.effects": effects });
  }

  /** Liga/desliga um Elemento no dano da Skill (chips não são campos de formulário). */
  static async #onSkillElementToggle(event, target) {
    event.preventDefault();
    const elements = new Set(this.item.system.damageElements ?? []);
    const id = target.dataset.element;
    if (!elements.delete(id)) elements.add(id);
    await this.item.update({ "system.damageElements": [...elements] });
  }

  /** Liga/desliga um Elemento no dano de uma Arma (Item Geral). */
  static async #onWeaponElementToggle(event, target) {
    event.preventDefault();
    const elements = new Set(this.item.system.weapon.damageElements ?? []);
    const id = target.dataset.element;
    if (!elements.delete(id)) elements.add(id);
    await this.item.update({ "system.weapon.damageElements": [...elements] });
  }

  /** Liga/desliga um Elemento no tick de dano de uma linha de Efeito Periódico. */
  static async #onEffectElementToggle(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const effects = this.#cloneEffects();
    const entry = effects[index];
    if (!entry) return;
    const elements = new Set(entry.damageElements ?? []);
    const id = target.dataset.element;
    if (!elements.delete(id)) elements.add(id);
    entry.damageElements = [...elements];
    await this.item.update({ "system.effects": effects });
  }

  /**
   * Evolução: 1 Skill vira uma Skill NOVA e diferente (não uma fusão — nada de Sub-Skills
   * aqui), só ficando o registro histórico "Evoluiu de: X". A Skill antiga é preservada no
   * Compêndio e removida do Ator, igual `fuseSkills` já faz — ver `evolveSkill` em skill-economy.js.
   */
  static async #onEvolveSkill(event, target) {
    event.preventDefault();
    // Só Mestre: o botão some da ficha do jogador; isto fecha a porta dos fundos.
    if (!game.user.isGM) return;
    const actor = this.item.parent;
    if (!actor) {
      ui.notifications?.warn("Só é possível Evoluir uma Skill que já está numa ficha de Ator.");
      return;
    }

    const hasUltimate = actor.system?.hasUltimateSkill;
    const ultimateVisible = hasUltimate || game.user.isGM;
    const tierChoices = MEU_SISTEMA.SKILL_TIERS.filter(t => t !== "racial" && (t !== "ultimate" || ultimateVisible));

    const data = await openSkillEditorDialog({}, { tierChoices, levelReadonly: !game.user.isGM });
    if (!data) return;

    await evolveSkill(actor, this.item.id, data);
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

  /* -------------------------------------------- */
  /*  Level Up de Skill (só GM — campo Nível é readonly pro jogador)  */
  /* -------------------------------------------- */

  static async #onLevelUpSkill(event, target) {
    event.preventDefault();
    await this.#raiseSkillLevel();
  }

  /** Jogador paga 1 Ponto de Habilidade do tier da Skill por 1 nível (sem esperar o XP encher). */
  static async #onSpendPointLevelUp(event, target) {
    event.preventDefault();
    const actor = this.item.parent;
    const tier = this.item.system.tier;
    if (!actor || !MEU_SISTEMA.SKILL_POINT_TIERS.includes(tier)) return;
    const balance = actor.system.skillPoints?.[tier] ?? 0;
    if (balance < 1) {
      ui.notifications.warn(`Sem Pontos ${MEU_SISTEMA.SKILL_TIER_LABELS[tier]} para subir o nível.`);
      return;
    }
    // O ponto só é gasto se o nível realmente subiu (teto de Resistência recusa antes).
    await this.#raiseSkillLevel({ spendPointFrom: actor, tier, balance });
  }

  async #raiseSkillLevel({ spendPointFrom = null, tier = null, balance = 0 } = {}) {
    const resistanceTarget = this.item.system.resistanceTarget;
    const currentLevel = this.item.system.level;

    if (resistanceTarget) {
      const maxLevel = resistanceMaxLevel(resistanceTarget);
      if (currentLevel >= maxLevel) {
        ui.notifications.warn(
          resistanceTarget === "general"
            ? "Resistência Geral já está no teto (nível 5, 50%) — não existe Imunidade Geral."
            : `Essa Skill já está no nível máximo (${maxLevel}, Imunidade).`
        );
        return;
      }
    }

    const newLevel = currentLevel + 1;
    const updates = { "system.level": newLevel };
    if (resistanceTarget) updates.name = computeResistanceName(resistanceTarget, newLevel);
    if (spendPointFrom) await spendPointFrom.update({ [`system.skillPoints.${tier}`]: balance - 1 });
    await this.item.update(updates);

    const actor = this.item.parent;
    if (actor) {
      await announceVoiceOfTheWorld(actor, {
        kind: "skill-level-up",
        title: "Habilidade Evoluiu",
        body: `${this.item.name} de ${actor.name} subiu para o nível ${newLevel}${spendPointFrom ? " (1 Ponto de Habilidade gasto)" : ""}.`
      });
    }
  }

  /* -------------------------------------------- */
  /*  Resistência concedida por Título             */
  /* -------------------------------------------- */

  static async #onTitleResistanceAdd(event, target) {
    event.preventDefault();
    const resistances = foundry.utils.deepClone(this.item.system.resistances ?? []);
    resistances.push({ target: "general", amount: 0 });
    await this.item.update({ "system.resistances": resistances });
  }

  static async #onTitleResistanceDelete(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const resistances = foundry.utils.deepClone(this.item.system.resistances ?? []);
    resistances.splice(index, 1);
    await this.item.update({ "system.resistances": resistances });
  }
}
