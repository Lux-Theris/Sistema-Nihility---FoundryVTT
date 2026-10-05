import { getAntimagicReach,
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
  getScaleConfig,
  isScaleEnabled,
  getActiveTraits,
  getAttributeLabels,
  getEffectTargetGroups,
  getModuleCategories,
  moduleRole,
  getStructures,
  isStructuresEnabled,
  isStructureMechanic,
  debugLog,
  getVesselSizes,
  vesselKind,
  isMagicUse,
  MAGIC_TAG_LABELS,
  getAmmoTypes,
  cargoSlotsFor,
  isInventoryEnabled,
  isAnatomyEnabled,
  getActiveSpeciesPresets,
  getActiveHeritages,
  getActiveBodyFunctions,
} from "../core/config.js";
import {
  WHEN_KINDS,
  WHEN_LABELS,
  SELF_WHEN_KINDS,
  THEN_KINDS,
  THEN_LABELS,
  PER_EACH_KINDS,
  PER_EACH_LABELS
} from "../combat/conditional-modifiers.js";
import { createGrantedSkill, removeGrantedSkill, refreshGrantedSkill, evolveSkill } from "../skills/skill-economy.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";
import { computeResistanceName, computeResistancePercent, resistanceMaxLevel } from "../combat/resistance.js";
import { openSkillEditorDialog, mechanicSummaryFor } from "../apps/skill-editor-dialog.js";
import { pickDamageElements, selectedElementChips } from "../apps/checklist-picker.js";
import { openLightConfigDialog, describeLight } from "../combat/lights.js";
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
 * Layout do redesenho aprovado (artifact "Redesenho da Ficha de Item"): abas por pergunta
 * (`tabsFor`), chips-resumo no cabeçalho (`headerChipsFor`) e seções em grade. Skill: todos os
 * campos são editados inline nas abas Geral/Mecânica/Passivos/Sub-Skills.
 * `openSkillEditorDialog` só sobrevive como formulário de CRIAÇÃO (Skill Racial em
 * species-config.js, "+ Nova Habilidade (direto)" em actor-sheet.js) e de Evolução. Os
 * Efeitos (`system.effects[]`) não usam `name=` de formulário: um array submetido por linhas
 * parciais perderia os campos que a linha não renderiza (ícone, elementos), então cada
 * controle é gravado por `_onSkillEffectFieldChange`, que reescreve só o campo tocado.
 */
/**
 * Para cada lista de `system` que chegou do formulário como objeto de índices (`{0: {...}}`),
 * devolve a lista atual com as entradas enviadas mescladas por cima. Listas inteiras (arrays de
 * verdade) passam intactas. Só olha o primeiro nível de `system`.
 */
function mergeSubmittedArrays(data, document) {
  const submitted = data?.system;
  if (!submitted || typeof submitted !== "object") return data;
  for (const [key, value] of Object.entries(submitted)) {
    const current = document.system?.[key];
    if (!Array.isArray(current) || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const indices = Object.keys(value).filter(k => /^\d+$/.test(k));
    if (!indices.length) continue;
    const merged = current.map(entry => foundry.utils.deepClone(entry));
    for (const k of indices) {
      const i = Number(k);
      merged[i] = merged[i] ? foundry.utils.mergeObject(merged[i], value[k], { inplace: false }) : value[k];
    }
    submitted[key] = merged;
  }
  return data;
}

/**
 * Chips do cabeçalho: o Item resumido sem abrir aba (princípio A do redesenho) — Tier, Nível,
 * Custo, Ativa, mecânica e Resistência numa Skill; Categoria, Porte, consumo e o número-chave da
 * Função num Módulo; Equipado, quantidade, valor e arma num Item. Só leitura; `tone` muda a cor.
 */
function headerChipsFor(item) {
  const sys = item.system;
  const chips = [];
  const add = (label, title = "", tone = "") => chips.push({ label, title, tone });
  const fmt = n => String(n).replace(".", ",");
  switch (item.type) {
    case "skill": {
      add(MEU_SISTEMA.SKILL_TIER_LABELS[sys.tier] ?? sys.tier, "Tier", "violet");
      add(`Nv ${sys.level}`, "Nível");
      if (sys.cost) add(`${sys.cost} ${getCharacterEnergyLabel()}`, "Custo ao usar");
      if (sys.hasUpkeep) add(`Ativa · ${sys.upkeepCost}/rod.`, "Habilidade Ativa", sys.active ? "ok" : "accent");
      if (sys.variableMana) add(`${getCharacterEnergyLabel()} variável`, "Aceita investir mais ou menos que o Custo", "violet");
      if (isMagicUse(sys, item.parent)) add("Mágica", "Sofre Antimagia", "violet");
      const target = MEU_SISTEMA.SKILL_TARGET_TYPE_SHORT_LABELS[sys.targetType] ?? "";
      if (isStructureMechanic(sys)) add("Estrutura", "Mecânica ao usar");
      else if (sys.effectType === "damage") add(`Dano · ${target}`, "Mecânica ao usar", "hp");
      else if (sys.effectType === "temporary") add(`Efeito · ${target}`, "Mecânica ao usar");
      if (sys.resistanceTarget) {
        const percent = Math.round(computeResistancePercent(sys.resistanceTarget, sys.level) * 100);
        const element = sys.resistanceTarget === "general" ? "Geral" : getActiveDamageElements().find(el => el.id === sys.resistanceTarget)?.label ?? sys.resistanceTarget;
        add(`Resist. ${element} ${percent}%`, "Resistência passiva", "gold");
      }
      if ((sys.fusionSources ?? []).length) add(`Fusão de ${sys.fusionSources.length}`, "Linhagem de fusão");
      if (sys.isItemGranted) add("Concedida", "Concedida por Item/Módulo — fixa");
      break;
    }
    case "starship_module": {
      const role = moduleRole(sys.category);
      add(getModuleCategories().find(c => c.id === sys.category)?.label ?? sys.category, "Categoria", "violet");
      add(MEU_SISTEMA.MODULE_SIZE_LABELS[sys.moduleSize] ?? sys.moduleSize, "Porte");
      if (sys.powerConsumption) add(`${sys.powerConsumption} ${getStarshipEnergyAbbr()}`, "Consumo de energia a 100%");
      add(`Vida ${sys.hp?.max ?? 0}`, "Vida máxima");
      const key = {
        weapon: () => `${sys.damageFormula || "?"} · Pen ${sys.penetration ?? 0}%`,
        power: () => `gera ${sys.reactorOutput ?? 0}`,
        storage: () => `guarda ${sys.batteryCapacity ?? 0}`,
        distribution: () => `Fator ×${fmt(sys.transferFactor ?? 1)}`,
        shield: () => `Escudo ${sys.shieldCapacity ?? 0}`,
        propulsion: () => `Acel ${sys.acceleration ?? 0} · Rot ${sys.rotation ?? 0}`,
        armor: () => `Redução ${sys.armorReduction ?? 0}%`,
        ftl: () => (sys.ftlType === "jump" ? `Salto ${sys.jumpRange ?? 0}` : `Dobra ${fmt(sys.warpFactor ?? 1)}`)
      }[role];
      if (key) add(key(), "Número-chave da Função", "accent");
      break;
    }
    case "item": {
      if (sys.equipped) add("Equipado", "", "ok");
      if (sys.quantity > 1) add(`×${sys.quantity}`, "Quantidade");
      if (sys.value?.amount) {
        const currency = getActiveCurrencies().find(c => c.id === sys.value.currency)?.label ?? sys.value.currency;
        add(`${sys.value.amount} ${currency}`, "Valor");
      }
      if (sys.weapon?.enabled) add(`Arma · ${sys.weapon.damageFormula || "?"}`, "Dano", "accent");
      if (sys.weapon?.enabled && sys.weapon.magazineSize > 0) add(`Carregador ${Math.min(sys.weapon.loaded ?? 0, sys.weapon.magazineSize)}/${sys.weapon.magazineSize}`, "Disparos antes de recarregar");
      if (sys.consumable?.enabled) add(sys.consumable.charges > 1 ? `Consumível · ${sys.consumable.charges} cargas` : "Consumível", "Botão Usar no inventário", "accent");
      if (sys.container?.enabled) add(`Contêiner · ${sys.container.slots} slots`, "Guarda outros Itens");
      if (sys.ammo?.enabled) add(`Munição · ${getAmmoTypes().find(a => a.id === sys.ammo.type)?.label ?? "?"}`, "Munição", "accent");
      if (sys.grantsSkill?.name) add(`concede: ${sys.grantsSkill.name}`, "Habilidade Concedida", "violet");
      break;
    }
    case "title": {
      if (sys.rarity) add(sys.rarity, "Raridade", "gold");
      if (sys.grantedBy) add(sys.grantedBy, "Concedido por");
      if ((sys.bonuses ?? []).length) add(`${sys.bonuses.length} bônus`, "Bônus permanentes");
      if ((sys.resistances ?? []).length) add(`${sys.resistances.length} resistência(s)`, "Resistências");
      break;
    }
    case "body_part": {
      if (sys.slot) add(sys.slot, "Slot", "violet");
      add(`Vida ${sys.hp?.value ?? 0}/${sys.hp?.max ?? 0}`, "Vida");
      if (sys.isProsthetic) add("Protética", "", "accent");
      if ((sys.installedMods ?? []).length) add(`${sys.installedMods.length} modificação(ões)`, "Modificações instaladas");
      break;
    }
  }
  if ((sys.conditionalModifiers ?? []).length) add(`${sys.conditionalModifiers.length} condicional(is)`, "Bônus Condicionais", "gold");
  return chips;
}

/**
 * Abas por tipo, cada uma respondendo uma pergunta (princípio B): "o que é", "o que faz ao
 * usar", "o que dá sempre". A primeira é a que abre — nunca a Descrição. `count` é o número ou
 * a nota ao lado do nome ("dano", "3", "—"); `led` é o indicador de ligado/desligado.
 */
function tabsFor(item) {
  const sys = item.system;
  const n = value => (value ? String(value) : "");
  switch (item.type) {
    case "skill": {
      const mechanic = isStructureMechanic(sys)
        ? "estrutura"
        : { damage: "dano", temporary: `${(sys.effects ?? []).length} ef.` }[sys.effectType] ?? "";
      const passives =
        (sys.resistanceTarget ? 1 : 0) +
        (sys.statModifiers?.hp ? 1 : 0) +
        (sys.statModifiers?.energy ? 1 : 0) +
        (sys.attributeBonuses ?? []).length +
        (sys.conditionalModifiers ?? []).length;
      return [
        { id: "general", label: "Geral" },
        { id: "mechanic", label: "Mecânica", count: mechanic },
        { id: "passive", label: "Passivos", count: n(passives) },
        { id: "subskills", label: "Sub-Skills", count: n((sys.subSkills ?? []).length) },
        { id: "description", label: "Descrição" }
      ];
    }
    case "item": {
      const whileEquipped =
        (sys.grantsSkill?.name ? 1 : 0) +
        (sys.statModifiers?.hp ? 1 : 0) +
        (sys.statModifiers?.energy ? 1 : 0) +
        (sys.attributeBonuses ?? []).length +
        (sys.conditionalModifiers ?? []).length;
      return [
        { id: "general", label: "Geral" },
        { id: "weapon", label: "Arma", led: true, ledOn: Boolean(sys.weapon?.enabled) },
        { id: "consumable", label: "Consumível", led: true, ledOn: Boolean(sys.consumable?.enabled) },
        ...(isAnatomyEnabled() ? [{ id: "implant", label: "Implante", led: true, ledOn: Boolean(sys.implant?.enabled) }] : []),
        { id: "equipped", label: sys.implant?.enabled ? "Enquanto instalado" : "Enquanto equipado", count: n(whileEquipped) },
        { id: "description", label: "Descrição" }
      ];
    }
    case "starship_module":
      return [
        { id: "spec", label: "Especificação" },
        { id: "grant", label: "Habilidade Concedida", count: sys.grantsSkill?.name ? "1" : "—" },
        { id: "description", label: "Descrição" }
      ];
    case "body_part":
      return [
        { id: "details", label: "Detalhes" },
        { id: "mods", label: "Modificações", count: n((sys.installedMods ?? []).length) },
        { id: "description", label: "Descrição" }
      ];
    default:
      return [
        { id: "details", label: "Detalhes" },
        { id: "description", label: "Descrição" }
      ];
  }
}

/** Linhas prontas do editor de Bônus Condicionais (opções já com `selected`). */
function conditionalModifierRows(list) {
  const pickList = (pairs, current) => pairs.map(([value, label]) => ({ value, label, selected: String(value) === String(current ?? "") }));
  const traits = getActiveTraits().map(t => [t.id, t.label]);
  const conditions = getActiveStatusConditions().map(c => [c.id, c.label]);
  const elements = getActiveDamageElements().map(e => [e.id, e.label]);
  const attributeLabels = getAttributeLabels();
  const attributes = MEU_SISTEMA.COMBAT_ATTRIBUTES.map(k => [k, attributeLabels[k] ?? k]);

  return list.map((mod, index) => {
    const whenKind = mod.when?.kind || "always";
    const thenKind = mod.then?.kind || "damagePercent";
    const valueSource = { otherTrait: traits, otherCondition: conditions, selfCondition: conditions, element: elements }[whenKind];
    let targetOptions = null;
    if (thenKind === "rollFlat") targetOptions = pickList([["any", "qualquer atributo"], ...attributes], mod.then?.target);
    else if (thenKind === "attributeFlat") targetOptions = pickList(attributes, mod.then?.target);
    else if (thenKind === "resistancePercent") targetOptions = pickList([["general", "Geral"], ...elements], mod.then?.target);
    return {
      index,
      whenOptions: pickList(WHEN_KINDS.map(k => [k, WHEN_LABELS[k]]), whenKind),
      whenValueOptions: valueSource ? pickList(valueSource, mod.when?.value) : null,
      needsThreshold: whenKind === "selfHpBelow",
      threshold: mod.when?.threshold ?? 50,
      thenOptions: pickList(THEN_KINDS.map(k => [k, THEN_LABELS[k]]), thenKind),
      targetOptions,
      value: mod.then?.value ?? 0,
      perEachOptions: pickList(PER_EACH_KINDS.map(k => [k, PER_EACH_LABELS[k]]), mod.perEach ?? ""),
      // Bônus contínuo de atributo não sabe quem é o oponente nem qual o elemento.
      warning: thenKind === "attributeFlat" && !SELF_WHEN_KINDS.includes(whenKind) ? "Bônus no atributo só vale com condição sobre você mesmo." : ""
    };
  });
}

/**
 * Resumo de uma Habilidade Concedida pra ficha: nome, tier, custo, a mecânica numa linha e as
 * Sub-Skills. `null` quando o molde está vazio (sem nome) — a ficha mostra "+ Conceder".
 */
function grantedSkillSummary(grantsSkill, path) {
  if (!grantsSkill?.name?.trim()) return { path, empty: true };
  return {
    path,
    empty: false,
    name: grantsSkill.name,
    tierLabel: MEU_SISTEMA.SKILL_TIER_LABELS[grantsSkill.tier] ?? grantsSkill.tier,
    cost: grantsSkill.cost ?? 0,
    level: grantsSkill.level ?? 1,
    upkeep: grantsSkill.hasUpkeep ? grantsSkill.upkeepCost ?? 0 : null,
    mechanic: mechanicSummaryFor(grantsSkill),
    subSkills: (grantsSkill.subSkills ?? []).map((sub, index) => ({
      index,
      name: sub.name || "(sem nome)",
      mechanic: mechanicSummaryFor(sub)
    }))
  };
}

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
      pickElements: NihilityItemSheet.#onPickElements,
      toggleAmmoType: NihilityItemSheet.#onToggleAmmoType,
      toggleImplantList: NihilityItemSheet.#onToggleImplantList,
      removeElement: NihilityItemSheet.#onRemoveElement,
      showEffectCondition: NihilityItemSheet.#onShowEffectCondition,
      editEffectLight: NihilityItemSheet.#onEditEffectLight,
      toggleWeaponAmmoType: NihilityItemSheet.#onToggleWeaponAmmoType,
      addConditionalModifier: NihilityItemSheet.#onConditionalModifierAdd,
      editSubSkill: NihilityItemSheet.#onSubSkillEdit,
      deleteConditionalModifier: NihilityItemSheet.#onConditionalModifierDelete,
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
      editImage: NihilityItemSheet.#onEditImage,
      editGrantedSkill: NihilityItemSheet.#onEditGrantedSkill,
      clearGrantedSkill: NihilityItemSheet.#onClearGrantedSkill,
      addGrantedSubSkill: NihilityItemSheet.#onAddGrantedSubSkill,
      editGrantedSubSkill: NihilityItemSheet.#onEditGrantedSubSkill,
      deleteGrantedSubSkill: NihilityItemSheet.#onDeleteGrantedSubSkill
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/item-sheet.hbs`, scrollable: [".sheet-body"] }
  };

  /**
   * Linhas de Efeito com "+ Condição" aberto (estado de tela, nada é salvo): a Condição e o Ícone
   * ficam dobrados até alguém pedir ou até a linha já ter um dos dois.
   */
  #openConditionRows = new Set();

  constructor(options = {}) {
    super(options);
    // ApplicationV2 não herda o mixin de abas do AppV1 — mesmo padrão manual já usado em
    // NihilityMenuApp (activeTab + ação "selectTab"). `null` = a primeira aba do tipo (ver
    // tabsFor), que é sempre a dos campos.
    this.activeTab = null;
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
    const item = this.item;
    const sys = item.system;
    context.system = sys;
    context.config = MEU_SISTEMA;
    context.itemType = item.type;
    context.inventoryEnabled = isInventoryEnabled();
    context.currencies = getActiveCurrencies();
    context.item = item;
    context.owner = item.isOwner;
    context.isGM = game.user.isGM;
    context.resistancesEnabled = isResistancesEnabled();
    context.conditionsEnabled = isStatusConditionsEnabled();
    context.scaleEnabled = isScaleEnabled();
    context.energyLabel = getCharacterEnergyLabel();
    context.magicTagOptions = Object.entries(MAGIC_TAG_LABELS).map(([id, label]) => ({ id, label: id === "auto" ? `Automático (custa ${context.energyLabel})` : label }));
    context.energyAbbr = getStarshipEnergyAbbr();
    // Seletores de bônus de Atributo (Título, Item, Modificação) usam os rótulos e a
    // visibilidade atuais — atributo oculto sai da lista de opções novas.
    context.visibleAttributes = getVisibleAttributes();
    context.effectTargetLabels = getEffectTargetLabels();

    const helpers = {
      pick: (list, current) => list.map(([value, label]) => ({ value, label, selected: value === current })),
      seg: (list, current) => list.map(([value, label, title]) => ({ value, label, title: title ?? "", checked: value === current })),
      scaleOptions: current =>
        [{ id: "", label: "— a de quem ataca —" }, ...getScaleConfig().scales].map(s => ({ ...s, selected: s.id === (current ?? "") })),
      // Atributo escondido pela campanha continua listado se o dano JÁ escala por ele.
      scalingOptions: current => {
        const visible = context.visibleAttributes;
        const choices = [["", "— sem escala —"], ...visible.map(a => [a.key, a.label])];
        if (current && !visible.some(a => a.key === current)) choices.push([current, `${getAttributeLabel(current)} (oculto)`]);
        return choices.map(([value, label]) => ({ value, label, selected: value === (current ?? "") }));
      }
    };

    if (item.type === "skill") this.#prepareSkillContext(context, helpers);
    if (item.type === "item") this.#prepareGenericItemContext(context, helpers);
    if (item.type === "starship_module") this.#prepareModuleContext(context, helpers);
    if (item.type === "title") this.#prepareTitleContext(context);
    if (item.type === "body_part") {
      context.modGrantSummaries = (sys.installedMods ?? []).map((mod, index) =>
        grantedSkillSummary(mod.grantsSkill, `system.installedMods.${index}.grantsSkill`)
      );
    }
    if (["title", "skill", "item"].includes(item.type)) {
      context.conditionalRows = conditionalModifierRows(sys.conditionalModifiers ?? []);
    }

    context.headerChips = headerChipsFor(item);
    context.tabs = tabsFor(item);
    // Aba guardada que não existe neste tipo (ou primeira abertura): cai na primeira, que é
    // sempre a dos campos — nunca a Descrição.
    if (!context.tabs.some(tab => tab.id === this.activeTab)) this.activeTab = context.tabs[0].id;
    context.activeTab = this.activeTab;

    debugLog(`${SYSTEM_ID} | NihilityItemSheet._prepareContext (${item.type}):`, item.name);
    return context;
  }

  #prepareSkillContext(context, { pick, seg, scaleOptions, scalingOptions }) {
    const sys = this.item.system;
    const owner = this.item.parent;

    // Jogador pode comprar 1 nível de Skill com 1 Ponto de Habilidade do tier dela (Racial/
    // Ultimate não têm Pontos). O Mestre já tem o "+ Nível" livre, então o botão é só do jogador.
    context.canSpendPointLevel =
      !game.user.isGM && this.item.isOwner && Boolean(owner) && isSkillPointsEnabled() && MEU_SISTEMA.SKILL_POINT_TIERS.includes(sys.tier);
    context.levelPointBalance = owner?.system?.skillPoints?.[sys.tier] ?? 0;

    const hasUltimate = owner?.system?.hasUltimateSkill ?? sys.tier === "ultimate";
    const visibleTiers = MEU_SISTEMA.SKILL_TIERS.filter(t => t !== "ultimate" || hasUltimate || game.user.isGM);
    context.isRacialSkill = sys.tier === "racial";
    context.skillTierOptions = pick(visibleTiers.filter(t => t !== "racial").map(t => [t, MEU_SISTEMA.SKILL_TIER_LABELS[t]]), sys.tier);

    // Mecânica ao Usar: Estrutura é uma mecânica (não um Tipo de Alvo). Bloco desligado pela
    // campanha sai da lista, a não ser que a Skill já esteja nele.
    const mechanicType = isStructureMechanic(sys) ? "structure" : sys.effectType;
    context.skillMechanicType = mechanicType;
    context.skillEffectTypeSeg = seg(
      MEU_SISTEMA.SKILL_EFFECT_TYPES.filter(t => t !== "structure" || isStructuresEnabled() || mechanicType === "structure").map(t => [
        t,
        MEU_SISTEMA.SKILL_EFFECT_TYPE_SHORT_LABELS[t],
        MEU_SISTEMA.SKILL_EFFECT_TYPE_LABELS[t]
      ]),
      mechanicType
    );
    context.skillShowsTarget = mechanicType === "damage" || mechanicType === "temporary";
    const areaOn = isAreaEffectsEnabled();
    context.skillTargetTypeSeg = seg(
      MEU_SISTEMA.SKILL_TARGET_TYPES.filter(t => areaOn || !["emission", "zone"].includes(t) || t === sys.targetType).map(t => [
        t,
        MEU_SISTEMA.SKILL_TARGET_TYPE_SHORT_LABELS[t],
        MEU_SISTEMA.SKILL_TARGET_TYPE_LABELS[t]
      ]),
      sys.targetType
    );
    context.skillIsArea = sys.targetType === "emission" || sys.targetType === "zone";
    context.skillAreaShapeSeg = seg(
      MEU_SISTEMA.SKILL_AREA_SHAPES.filter(Boolean).map(s => [s, MEU_SISTEMA.SKILL_AREA_SHAPE_LABELS[s]]),
      sys.areaShape
    );

    const structures = getStructures();
    context.skillStructureOptions = structures.map(st => ({ value: st.id, label: st.label, selected: st.id === sys.structureId }));
    const structure = structures.find(st => st.id === sys.structureId);
    if (structure) {
      const life = structure.hp > 0 ? `Vida ${structure.hp}` : `barreira de mana (o dano sai da ${context.energyLabel} de quem ergueu)`;
      const duration = structure.durationRounds > 0 ? `${structure.durationRounds} rodada(s)` : sys.hasUpkeep ? "até desligar a Skill" : "até o Mestre derrubar";
      context.skillStructureSummary = `${MEU_SISTEMA.STRUCTURE_SHAPE_LABELS[structure.shape] ?? structure.shape} · tamanho ${structure.size} · ${life} · ${duration}`;
    }

    context.skillScalingOptions = scalingOptions(sys.scalingAttribute);
    context.damageScaleOptions = scaleOptions(sys.damageScale);
    context.skillElementField = selectedElementChips(sys.damageElements);

    context.skillResistanceOptions = pick(
      [["", "— nenhuma —"], ...getResistanceTargetOptions().map(o => [o.value, o.label])],
      sys.resistanceTarget ?? ""
    );
    const resistanceTarget = sys.resistanceTarget ?? "";
    context.isResistanceSkill = resistanceTarget !== "";
    if (context.isResistanceSkill) {
      context.resistanceMaxLevel = resistanceMaxLevel(resistanceTarget);
      context.resistancePercent = Math.round(computeResistancePercent(resistanceTarget, sys.level) * 100);
      context.skillResistanceName = computeResistanceName(resistanceTarget, sys.level);
    }

    context.skillEffects = this.#effectCards(context);
    context.subSkillRows = (sys.subSkills ?? []).map((sub, index) => ({
      index,
      name: sub.name,
      tier: sub.tier,
      tierLabel: MEU_SISTEMA.SKILL_TIER_LABELS[sub.tier] ?? sub.tier,
      mechanic: mechanicSummaryFor(sub)
    }));
  }

  /**
   * Um card por Efeito Temporário: selo do grupo do alvo, frase-resumo montada dos próprios
   * campos e só os extras que o alvo pede (prancheta 5 do redesenho). As opções já vêm com
   * `selected`, pro template não depender da profundidade de {{#each}} aninhado.
   */
  #effectCards(context) {
    const sys = this.item.system;
    const labels = getEffectTargetLabels();
    const conditions = getActiveStatusConditions();
    const elements = getActiveDamageElements();
    const groupClasses = ["attr", "vit", "arma", "nave"];
    const onShip = ["starship", "vehicle"].includes(this.item.parent?.type);
    const signed = n => (n > 0 ? `+${n}` : `${n}`);

    const effectsPath = this.#effectsPath();
    return (foundry.utils.getProperty(this.item, effectsPath) ?? []).map((entry, index) => {
      // Periódico: Vida/Mana de Personagem e Casco/Integridade de Nave (dano contínuo, reparo por rodada).
      const acceptsPeriodic = ["hp", "energy", "shipCasco", "shipHull"].includes(entry.target);
      const periodic = acceptsPeriodic && Boolean(entry.periodic);
      const isShipTarget = MEU_SISTEMA.SHIP_EFFECT_TARGETS.includes(entry.target);
      const groupIndex = MEU_SISTEMA.EFFECT_TARGET_GROUPS.findIndex(g => g.targets.includes(entry.target));
      const amount = Number(entry.amount) || 0;
      const targetLabel = labels[entry.target] ?? entry.target;
      const condition = conditions.find(c => c.id === entry.conditionId);

      let summary;
      if (["weaponElement", "bodyElement"].includes(entry.target)) summary = `${targetLabel} → ${elements.find(el => el.id === entry.elementId)?.label ?? "?"}`;
      else if (isShipTarget && entry.modifierType === "multiplier") summary = `${targetLabel} ×${(1 + amount / 100).toFixed(2).replace(".", ",")}`;
      else summary = `${targetLabel} ${signed(amount)}${entry.amountMode === "percentMax" && ["hp", "energy", "shield", "heal", "restoreEnergy"].includes(entry.target) ? "% do máx." : ""}${periodic ? " por tick" : ""}`;
      const extra = [];
      if (sys.hasUpkeep) extra.push("enquanto ativa");
      else if (entry.target === "shield") extra.push("até absorver");
      else extra.push(`${entry.durationRounds} ${periodic ? "tick(s)" : "rodada(s)"}`);
      if (condition) extra.push(condition.label);
      if (periodic && entry.target === "hp" && Number(entry.amount) > 0 && entry.healKind && entry.healKind !== "cura") extra.push(MEU_SISTEMA.HEAL_KIND_LABELS[entry.healKind] ?? entry.healKind);
      if (entry.target === "shield" && entry.damageElements?.length) {
        extra.push(`Escudo de ${entry.damageElements.map(id => elements.find(el => el.id === id)?.label ?? id).join(" + ")}`);
      }
      if (periodic && entry.damageElements?.length) {
        extra.push(entry.damageElements.map(id => elements.find(el => el.id === id)?.label ?? id).join(" + "));
      }

      // Nave primeiro numa Skill de Nave; num Personagem, na ordem de sempre.
      let targetGroups = getEffectTargetGroups(entry.target);
      if (onShip) targetGroups = [...targetGroups.filter(g => g.label === "Nave"), ...targetGroups.filter(g => g.label !== "Nave")];

      const showCondition = context.conditionsEnabled && Boolean(entry.conditionId || entry.icon || this.#openConditionRows.has(index));
      return {
        index,
        amount,
        durationRounds: entry.durationRounds,
        durationUnit: entry.target === "antimagic" ? "rod. de supressão (0 = até tirar)" : sys.hasUpkeep ? "ativa" : periodic ? "ticks" : "rod.",
        isAntimagic: entry.target === "antimagic",
        antimagicReach: Math.floor((Number(sys.level) || 0) * getAntimagicReach() + 1e-9),
        icon: entry.icon ?? "",
        summary,
        summaryExtra: extra.join(" · "),
        groupLabel: MEU_SISTEMA.EFFECT_TARGET_GROUPS[groupIndex]?.label ?? "—",
        groupClass: groupClasses[groupIndex] ?? "",
        targetGroups,
        isElementTarget: ["weaponElement", "bodyElement"].includes(entry.target),
        elementIdOptions: elements.map(el => ({ value: el.id, label: el.label, selected: el.id === entry.elementId })),
        acceptsPeriodic,
        periodic,
        isShipTarget,
        showCondition,
        canOpenCondition: context.conditionsEnabled && !showCondition && context.editable,
        isShieldTarget: entry.target === "shield",
        shieldRegen: entry.shieldRegen ?? 0,
        shieldCap: entry.shieldCap ?? 0,
        lightSummary: describeLight(entry.light),
        lightOn: Boolean(entry.light?.enabled),
        hasExtras: showCondition || acceptsPeriodic || isShipTarget || entry.target === "shield",
        conditionOptions: [{ value: "", label: "— sem Condição —", selected: !entry.conditionId }].concat(
          conditions.map(c => ({ value: c.id, label: c.label, selected: c.id === entry.conditionId }))
        ),
        tickUnitOptions: MEU_SISTEMA.PERIODIC_TICK_UNITS.map(u => ({
          value: u, label: MEU_SISTEMA.PERIODIC_TICK_UNIT_LABELS[u], selected: u === entry.tickUnit
        })),
        // Maldição: o que fazer sem Mana, só para esta Skill ("" = o da maldição).
        isCurse: Boolean(condition?.curse?.enabled),
        curseUnpaidOptions: [["", "Como na maldição"], ["hp", "Paga com Vida"], ["sleep", "Dorme"], ["worsen", "Piora"], ["continue", "Continua igual"]].map(([value, label]) => ({ value, label, selected: value === (entry.curseOnUnpaid ?? "") })),
        // Periódico de Vida positivo = cura: Cura / Regeneração / Reparo nas Partes do Corpo.
        isHeal: periodic && entry.target === "hp" && Number(entry.amount) > 0,
        healKindOptions: MEU_SISTEMA.HEAL_KINDS.map(k => ({
          value: k, label: MEU_SISTEMA.HEAL_KIND_LABELS[k], hint: MEU_SISTEMA.HEAL_KIND_HINTS[k], selected: k === (entry.healKind || "cura")
        })),
        modifierTypeOptions: MEU_SISTEMA.EFFECT_MODIFIER_TYPES.map(m => ({
          value: m, label: MEU_SISTEMA.EFFECT_MODIFIER_TYPE_LABELS[m], selected: m === (entry.modifierType || "flat")
        })),
        elementField: selectedElementChips(entry.damageElements),
        elementPath: `${effectsPath}.${index}.damageElements`,
        // Vida, Mana e Escudo aceitam "% do máximo do alvo" (Poção de 25%).
        acceptsPercent: ["hp", "energy", "shield", "heal", "restoreEnergy"].includes(entry.target),
        isPercent: entry.amountMode === "percentMax"
      };
    });
  }

  #prepareGenericItemContext(context, { scaleOptions, scalingOptions, seg }) {
    // Implante (board 5): slots conhecidos (das partes de todas as Espécies e Heranças) e Funções.
    const implant = this.item.system.implant ?? {};
    const slots = new Set(implant.fitsSlots ?? []);
    const knownSlots = new Set();
    for (const entry of Object.values(getActiveSpeciesPresets())) for (const p of entry.parts ?? []) if (p.slot) knownSlots.add(p.slot);
    for (const h of getActiveHeritages()) for (const p of h.parts ?? []) if (p.slot) knownSlots.add(p.slot);
    for (const s of slots) knownSlots.add(s);
    context.implantSlotChips = [...knownSlots].sort().map(id => ({ id, checked: slots.has(id) }));
    const fns = new Set(implant.functions ?? []);
    context.implantFunctionChips = getActiveBodyFunctions().map(f => ({ id: f.id, label: f.label, checked: fns.has(f.id) }));
    context.implantIsProsthesis = implant.kind === "prosthesis";
    context.implantHpFixed = implant.hpMode === "fixed";
    const weapon = this.item.system.weapon;
    context.weaponScalingOptions = scalingOptions(weapon.scalingAttribute);
    context.weaponScaleOptions = scaleOptions(weapon.damageScale);
    context.weaponElementField = selectedElementChips(weapon.damageElements);
    const ammo = this.item.system.ammo ?? {};
    context.ammoElementField = selectedElementChips(ammo.damageElements ?? []);
    context.ammoTypeOptions = [{ id: "", label: "—" }, ...getAmmoTypes()].map(a => ({ id: a.id, label: a.label, selected: a.id === (ammo.type ?? "") }));
    context.ammoSizeOptions = [["", "qualquer"], ...MEU_SISTEMA.MODULE_SIZES.map(s => [s, MEU_SISTEMA.MODULE_SIZE_LABELS[s]])].map(([id, label]) => ({
      id, label, selected: id === (ammo.minLauncherSize ?? "")
    }));
    context.grantSummary = grantedSkillSummary(this.item.system.grantsSkill, "system.grantsSkill");

    // Carregador (C7): tipos de munição aceitos como chips, e o que está dentro.
    const accepted = new Set(weapon.ammoTypes ?? []);
    context.weaponAmmoChips = getAmmoTypes().map(a => ({ id: a.id, label: a.label, checked: accepted.has(a.id) }));
    context.weaponLoadedLabel = weapon.magazineSize > 0 ? `${Math.min(weapon.loaded ?? 0, weapon.magazineSize)}/${weapon.magazineSize}${weapon.loadedAmmo?.label ? ` · ${weapon.loadedAmmo.label}` : ""}` : "";

    // Consumível (J6): o mesmo vocabulário da Skill (Efeito/Dano, em si/alvo/área) e o mesmo
    // editor de Efeitos (partial nihility.effectCards, caminho system.consumable.effects).
    const consumable = this.item.system.consumable ?? {};
    context.consumableEffectTypeSeg = seg([["temporary", "Efeito"], ["damage", "Dano"]], consumable.effectType ?? "temporary");
    context.consumableTargetSeg = seg(
      [["self", "Em si", "Quem usa"], ["targeted", "Num alvo", "Escolhe o alvo como numa Skill"], ["emission", "Área", "Posiciona a forma no mapa, como uma Emissão"]],
      consumable.targetType ?? "self"
    );
    context.consumableAreaSeg = seg([["circle", "Círculo"], ["cone", "Cone"], ["ray", "Linha"]], consumable.areaShape ?? "circle");
    context.consumableIsDamage = consumable.effectType === "damage";
    context.consumableIsArea = consumable.targetType === "emission";
    context.consumableScalingOptions = scalingOptions(consumable.scalingAttribute);
    context.consumableElementField = selectedElementChips(consumable.damageElements ?? []);
    context.consumableEffects = this.#effectCards(context);
  }

  #prepareModuleContext(context, { seg }) {
    const sys = this.item.system;
    // Categoria do catálogo editável; os campos da ficha seguem a FUNÇÃO dela (ver MODULE_ROLES).
    const categories = getModuleCategories();
    context.moduleRole = moduleRole(sys.category);
    context.moduleRoleLabel = MEU_SISTEMA.MODULE_ROLES[context.moduleRole]?.label ?? context.moduleRole;
    context.moduleCategoryOptions = categories.map(c => ({
      id: c.id,
      label: c.label,
      slots: Number(c.slots) || 0,
      roleLabel: MEU_SISTEMA.MODULE_ROLES[c.role]?.label ?? c.role,
      selected: c.id === sys.category
    }));
    // Categoria que sumiu do catálogo continua na lista, senão salvar a ficha a trocaria.
    if (!categories.some(c => c.id === sys.category)) {
      context.moduleCategoryOptions.push({ id: sys.category, label: `${sys.category} (fora do catálogo)`, slots: 0, roleLabel: context.moduleRoleLabel, selected: true });
    }
    context.moduleSizeSeg = seg(MEU_SISTEMA.MODULE_SIZES.map(size => [size, MEU_SISTEMA.MODULE_SIZE_LABELS[size]]), sys.moduleSize);
    context.moduleElementField = selectedElementChips(sys.damageElements);
    context.shieldElementField = selectedElementChips(sys.shieldElements ?? []);
    const accepted = new Set(sys.ammoTypes ?? []);
    context.launcherAmmoChips = getAmmoTypes().map(a => ({ id: a.id, label: a.label, checked: accepted.has(a.id) }));
    context.cargoSlotsPreview = cargoSlotsFor(sys.moduleSize, sys.cargoMultiplier);
    context.grantSummary = grantedSkillSummary(sys.grantsSkill, "system.grantsSkill");

    if (context.moduleRole === "shield" && sys.adaptive) {
      // "Phaser (freq. 412) 30%": o que este Escudo instalado já aprendeu.
      const elements = getActiveDamageElements();
      context.adaptationRows = Object.entries(this.item.getFlag(SYSTEM_ID, "shieldAdaptation") ?? {})
        .filter(([, percent]) => percent > 0)
        .map(([key, percent]) => {
          const [elementId, frequency] = key.split("@");
          const name = elementId === "none" ? "sem elemento" : elements.find(e => e.id === elementId)?.label ?? elementId;
          return { label: Number(frequency) ? `${name} (freq. ${frequency})` : name, percent };
        });
    }
    if (context.moduleRole === "distribution") {
      // "Fator 5" não diz nada sozinho: a Capacidade de Transferência sai de
      // `baseline(Porte) × fator`, e a tabela de baseline mora no código. Sem ver o RESULTADO,
      // não há como calibrar o número — nem quem escreveu o Módulo, nem quem recebe ele pronto.
      const factor = Number(sys.transferFactor) || 0;
      context.distributorPreview = {
        abbr: context.energyAbbr,
        // Portes do tipo da Nave onde o Módulo está (Nave, se estiver solto).
        rows: getVesselSizes(vesselKind(this.item.parent)).map(size => ({
          label: size.label,
          baseline: size.distributorBaseline,
          result: Math.round(size.distributorBaseline * factor),
          // Destaca a linha do Porte da Nave onde ESTE Módulo está instalado, quando está.
          current: this.item.parent?.system?.shipSize === size.id
        }))
      };
    }
  }

  #prepareTitleContext(context) {
    const sys = this.item.system;
    const labels = context.effectTargetLabels;
    const visible = new Set(context.visibleAttributes.map(a => a.key));
    // Alvos agrupados como no editor de Efeito, limitados a TITLE_BONUS_TARGETS. Atributo oculto
    // pela campanha sai da lista, a não ser que a linha já o use.
    context.titleBonusRows = (sys.bonuses ?? []).map((bonus, index) => {
      const allowed = MEU_SISTEMA.TITLE_BONUS_TARGETS.filter(
        t => !MEU_SISTEMA.COMBAT_ATTRIBUTES.includes(t) || visible.has(t) || t === bonus.attribute
      );
      const option = t => ({ value: t, label: labels[t] ?? t, selected: t === bonus.attribute });
      return {
        index,
        amount: bonus.amount,
        groups: [
          { label: "Atributos", options: allowed.filter(t => MEU_SISTEMA.COMBAT_ATTRIBUTES.includes(t)).map(option) },
          { label: "Vitais", options: allowed.filter(t => !MEU_SISTEMA.COMBAT_ATTRIBUTES.includes(t)).map(option) }
        ].filter(group => group.options.length)
      };
    });
    // Cada entrada de Resistência do Título já tem um alvo escolhido — sem opção "Nenhuma".
    const resistanceTargets = getResistanceTargetOptions();
    context.titleResistances = (sys.resistances ?? []).map(entry => ({
      ...entry,
      targetOptions: resistanceTargets.map(opt => ({ ...opt, selected: opt.value === entry.target }))
    }));
  }

  /* -------------------------------------------- */
  /*  Habilidade Concedida: editor completo        */
  /* -------------------------------------------- */

  /**
   * Chave que a Skill criada no Ator carrega em `grantedBySource`: o id do Item/Módulo, ou
   * `id:índice` pra uma Modificação de Parte do Corpo (mesma convenção de sempre).
   */
  _grantSourceKey(path) {
    const match = path.match(/^system\.installedMods\.(\d+)\.grantsSkill$/);
    return match ? `${this.item.id}:${match[1]}` : this.item.id;
  }

  /** Grava o molde e, se a fonte estiver concedendo agora, recria a Skill da ficha. */
  async _saveGrantedSkill(path, grantsSkill) {
    await this.item.update({ [path]: grantsSkill });
    const saved = foundry.utils.getProperty(this.item, path);
    const refreshed = await refreshGrantedSkill(this.item.parent, saved, this._grantSourceKey(path));
    if (refreshed) ui.notifications.info(`"${saved.name}" foi atualizada na ficha.`);
  }

  static async #onEditGrantedSkill(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const path = target.dataset.path;
    const current = foundry.utils.deepClone(foundry.utils.getProperty(this.item, path) ?? {});

    const data = await openSkillEditorDialog(
      { ...current, subSkills: [] },
      { tierChoices: MEU_SISTEMA.ITEM_GRANTABLE_SKILL_TIERS, levelReadonly: !game.user.isGM }
    );
    if (!data) return;
    // O editor não mexe em Sub-Skills (elas têm a própria lista na ficha); ficam como estavam.
    await this._saveGrantedSkill(path, { ...data, subSkills: current.subSkills ?? [] });
  }

  static async #onClearGrantedSkill(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const path = target.dataset.path;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Remover Habilidade Concedida" },
      content: "<p>Apagar a Habilidade Concedida deste item? Se ela estiver na ficha de alguém agora, sai de lá também.</p>"
    });
    if (!confirmed) return;

    const actor = this.item.parent;
    if (actor) await removeGrantedSkill(actor, this._grantSourceKey(path));
    await this.item.update({ [`${path}.name`]: "", [`${path}.subSkills`]: [], [`${path}.effectType`]: "none", [`${path}.effects`]: [] });
    // Parte do Corpo guarda "já concedida" na própria Modificação.
    const modMatch = path.match(/^(system\.installedMods\.\d+)\.grantsSkill$/);
    if (modMatch) await this.item.update({ [`${modMatch[1]}.skillGranted`]: false });
  }

  static async #onAddGrantedSubSkill(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const path = target.dataset.path;
    const current = foundry.utils.deepClone(foundry.utils.getProperty(this.item, path) ?? {});

    const data = await openSkillEditorDialog({ tier: current.tier }, { tierChoices: MEU_SISTEMA.ITEM_GRANTABLE_SKILL_TIERS, levelReadonly: !game.user.isGM });
    if (!data) return;
    await this._saveGrantedSkill(path, { ...current, subSkills: [...(current.subSkills ?? []), data] });
  }

  static async #onEditGrantedSubSkill(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const path = target.dataset.path;
    const index = Number(target.dataset.subIndex);
    const current = foundry.utils.deepClone(foundry.utils.getProperty(this.item, path) ?? {});
    const sub = current.subSkills?.[index];
    if (!sub) return;

    const data = await openSkillEditorDialog(sub, { tierChoices: MEU_SISTEMA.ITEM_GRANTABLE_SKILL_TIERS, levelReadonly: !game.user.isGM });
    if (!data) return;
    current.subSkills[index] = data;
    await this._saveGrantedSkill(path, current);
  }

  static async #onDeleteGrantedSubSkill(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const path = target.dataset.path;
    const index = Number(target.dataset.subIndex);
    const current = foundry.utils.deepClone(foundry.utils.getProperty(this.item, path) ?? {});
    if (!current.subSkills?.[index]) return;
    current.subSkills.splice(index, 1);
    await this._saveGrantedSkill(path, current);
  }

  /**
   * @override
   * O formulário manda só os campos de uma lista que estão na tela (`system.installedMods.0.name`,
   * `.description`, `.statModifiers.hp`…), e o Foundry transforma isso numa lista NOVA feita só
   * desses campos, trocando a inteira. Tudo o que não tem campo na tela voltava ao valor inicial
   * a cada edição: o "já concedida" de uma Modificação e, agora, a Habilidade Concedida inteira
   * guardada nela. Aqui cada entrada enviada é mesclada por cima da entrada que já existe.
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    return mergeSubmittedArrays(data, this.item);
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
      // Categoria e Porte são grupos de rádio (blocos e régua): o listener vai em cada opção.
      const presetChange = this._onModulePresetChange.bind(this);
      this.element
        .querySelectorAll('[name="system.category"], [name="system.moduleSize"]')
        .forEach(input => input.addEventListener("change", presetChange));
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
    const category = form.querySelector('[name="system.category"]:checked')?.value ?? this.item.system.category;
    const moduleSize = form.querySelector('[name="system.moduleSize"]:checked')?.value ?? this.item.system.moduleSize;

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

  /**
   * Onde moram os Efeitos editados nesta ficha: `system.effects` numa Skill, `system.consumable.effects`
   * num Item Geral (Consumível). O editor (partial `nihility.effectCards`) é o mesmo nos dois.
   */
  #effectsPath() {
    return this.item.type === "item" ? "system.consumable.effects" : "system.effects";
  }

  /** Cópia editável dos Efeitos (objetos simples, nunca o Data Model vivo). */
  #cloneEffects() {
    return foundry.utils.deepClone(foundry.utils.getProperty(this.item.toObject(), this.#effectsPath()) ?? []);
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
      if (!["hp", "energy", "shipCasco", "shipHull"].includes(entry.target)) entry.periodic = false;
      if (!MEU_SISTEMA.SHIP_EFFECT_TARGETS.includes(entry.target)) entry.modifierType = "flat";
      if (!["hp", "energy", "shield", "heal", "restoreEnergy"].includes(entry.target)) entry.amountMode = "flat";
    }
    await this.item.update({ [this.#effectsPath()]: effects });
  }

  static async #onSkillEffectAdd(event, target) {
    event.preventDefault();
    const effects = this.#cloneEffects();
    if (this.item.type === "item") {
      effects.push({ target: "heal", amount: 25, amountMode: "percentMax", modifierType: "flat", durationRounds: 0, conditionId: "", icon: "", periodic: false, tickUnit: "combatRound", damageElements: [] });
      return this.item.update({ [this.#effectsPath()]: effects });
    }
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
    await this.item.update({ [this.#effectsPath()]: effects });
  }

  static async #onSkillEffectDelete(event, target) {
    event.preventDefault();
    const index = Number(target.closest("[data-index]").dataset.index);
    const effects = this.#cloneEffects();
    effects.splice(index, 1);
    this.#openConditionRows.clear();
    await this.item.update({ [this.#effectsPath()]: effects });
  }

  static async #onConditionalModifierAdd(event) {
    event.preventDefault();
    const list = foundry.utils.deepClone(this.item.system.conditionalModifiers ?? []);
    list.push({ when: { kind: "always", value: "", threshold: 50 }, then: { kind: "damagePercent", target: "any", value: 10 }, perEach: "" });
    await this.item.update({ "system.conditionalModifiers": list });
  }

  static async #onConditionalModifierDelete(event, target) {
    event.preventDefault();
    const list = foundry.utils.deepClone(this.item.system.conditionalModifiers ?? []);
    list.splice(Number(target.dataset.index), 1);
    await this.item.update({ "system.conditionalModifiers": list });
  }

  /*  Elementos de Dano: chips dos escolhidos + janela de escolha (apps/checklist-picker.js)  */

  /**
   * Lê a lista de Elementos de um campo. `system.effects.N.damageElements` mora dentro de um
   * array que não pode ser gravado por caminho (o Foundry trocaria a lista inteira), então é
   * tratado à parte.
   */
  #readElementList(path) {
    const effect = path?.match(/^system\.(?:consumable\.)?effects\.(\d+)\.damageElements$/);
    if (effect) return foundry.utils.getProperty(this.item, this.#effectsPath())?.[Number(effect[1])]?.damageElements ?? [];
    // Tabela de elementos do Escudo dentro de um Efeito usa o mesmo campo (damageElements).
    return foundry.utils.getProperty(this.item, path) ?? [];
  }

  async #writeElementList(path, list) {
    const effect = path?.match(/^system\.(?:consumable\.)?effects\.(\d+)\.damageElements$/);
    if (effect) {
      const effects = this.#cloneEffects();
      const entry = effects[Number(effect[1])];
      if (!entry) return;
      entry.damageElements = list;
      return this.item.update({ [this.#effectsPath()]: effects });
    }
    if (!path?.startsWith("system.")) return;
    return this.item.update({ [path]: list });
  }

  /** Lançador: liga/desliga um Tipo de Munição aceito. */
  /** Chips do Implante: `data-list` = "fitsSlots" | "functions", `data-value` = o id. */
  static async #onToggleImplantList(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const key = target.dataset.list === "functions" ? "functions" : "fitsSlots";
    const list = new Set(this.item.system.implant?.[key] ?? []);
    const value = target.dataset.value;
    if (list.has(value)) list.delete(value);
    else list.add(value);
    await this.item.update({ [`system.implant.${key}`]: [...list] });
  }

  /** Arma com carregador: liga/desliga um Tipo de Munição aceito (vazio = aceita qualquer). */
  static async #onToggleWeaponAmmoType(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const type = target.dataset.ammoType;
    const list = new Set(this.item.system.weapon?.ammoTypes ?? []);
    if (list.has(type)) list.delete(type);
    else list.add(type);
    await this.item.update({ "system.weapon.ammoTypes": [...list] });
  }

  static async #onToggleAmmoType(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const type = target.dataset.ammoType;
    const list = new Set(this.item.system.ammoTypes ?? []);
    if (list.has(type)) list.delete(type);
    else list.add(type);
    await this.item.update({ "system.ammoTypes": [...list] });
  }

  static async #onPickElements(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const path = target.dataset.path;
    const picked = await pickDamageElements(this.#readElementList(path));
    if (picked) await this.#writeElementList(path, picked);
  }

  static async #onRemoveElement(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const path = target.dataset.path;
    await this.#writeElementList(path, this.#readElementList(path).filter(id => id !== target.dataset.element));
  }

  /** Luz do Escudo pessoal (Efeito de alvo "Escudo"): editor com pré-visualização no mapa. */
  static async #onEditEffectLight(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const index = Number(target.closest("[data-index]").dataset.index);
    const effects = this.#cloneEffects();
    const entry = effects[index];
    if (!entry) return;
    const light = await openLightConfigDialog(entry.light, {
      title: `Luz do Escudo — ${this.item.name}`,
      autoHint: "Raio 0 = automático (2 m em volta do Token)"
    });
    if (!light) return;
    entry.light = light.enabled ? light : null;
    await this.item.update({ [this.#effectsPath()]: effects });
  }

  /** "+ Condição" numa linha de Efeito: só abre os campos (estado de tela). */
  static #onShowEffectCondition(event, target) {
    event.preventDefault();
    this.#openConditionRows.add(Number(target.closest("[data-index]").dataset.index));
    this.render();
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
    if (this.item.system.isItemGranted) return;
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

  /** Sub-Skill de uma Skill (componente de fusão): edita a mecânica inteira no editor de Skill. Só o Mestre. */
  static async #onSubSkillEdit(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return;
    const index = Number(target.closest("[data-index]").dataset.index);
    const subSkills = foundry.utils.deepClone(this.item.system.subSkills ?? []);
    const sub = subSkills[index];
    if (!sub) return;
    const data = await openSkillEditorDialog(sub, { levelReadonly: false });
    if (!data) return;
    // `active` é estado de uso, não de edição: fica como estava.
    subSkills[index] = { ...sub, ...data, active: sub.active };
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
    // Skill concedida por Item/Módulo é fixa: o nível dela vem do molde da fonte.
    if (this.item.system.isItemGranted) {
      ui.notifications?.warn("Habilidade concedida não sobe de nível — edite o nível no Item/Módulo que a concede.");
      return;
    }
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
