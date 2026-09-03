import { SYSTEM_ID, MEU_SISTEMA, getStarshipEnergyLabel, getModuleSizePreset, sceneActorCandidates, debugLog } from "../config.js";
import { registerItemInCompendium } from "../compendium.js";
import { createGrantedSkill, removeGrantedSkill } from "../skill-economy.js";
import { useSkillEffect, fireStarshipWeapon } from "../skill-effects.js";
import { moduleCanRestart } from "../starship-power.js";

const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** Percentual (0-100) usado para desenhar as barras de Casco/Escudos/Integridade/Combustível. */
function percentOf(value, max) {
  if (!max) return 0;
  return Math.round(Math.clamp((value / max) * 100, 0, 100));
}

/** Opções {value,label} de Porte pro `<select>` do cabeçalho — usa MEU_SISTEMA.SHIP_SIZE_LABELS pros dois tipos. */
function sizeOptions(sizeChoices) {
  return sizeChoices.map(id => ({ id, label: MEU_SISTEMA.SHIP_SIZE_LABELS[id] }));
}

/**
 * Diálogo simples de confirmar/cancelar com um `<form>` livre — mesmo padrão de
 * actor-sheet.js (não compartilhado direto porque as duas Sheets não têm uma classe-base
 * em comum além de ApplicationV2).
 */
async function promptDialog({ title, content, confirmLabel = "Confirmar", onConfirm }) {
  return DialogV2.wait({
    window: { title },
    content,
    buttons: [
      { action: "confirm", label: confirmLabel, default: true, callback: (event, button, dialog) => onConfirm(dialog.element) },
      // Ver comentário equivalente em actor-sheet.js: `false` sobrevive ao `??` do
      // DialogV2.wait (só null/undefined são substituídos pela string do `action`).
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });
}

/**
 * Base compartilhada por Nave Espacial e Veículo — desde o overhaul de Porte os dois tipos
 * usam o MESMO sistema de Módulos/Grid de Energia/Habilidades concedidas (StarshipDataModel e
 * VehicleDataModel compartilham `ShipSystemsDataModel`, ver starship-model.js), então toda a
 * lógica de item-CRUD/toggle de energia/uso de Skill mora aqui uma vez só; as duas Sheets
 * concretas abaixo só diferem em DEFAULT_OPTIONS e no que cada uma acrescenta ao contexto
 * (Veículo tem Peças/Velocidade/Combustível, que não existem em Nave).
 */
class TabbedActorSheetV2 extends HandlebarsApplicationMixin(ActorSheetV2) {
  constructor(options = {}) {
    super(options);
    this.activeTab = "sistemas";
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

  /**
   * Cria um Módulo de Nave (`data-type="starship_module"`) ou uma Peça genérica de Veículo
   * (`data-type="item"`) — `data-category` opcional pré-seleciona a Categoria do Módulo (ex: o
   * botão "+ Nova Arma" da aba Armas já cria com `category:"weapon"`, em vez de nascer
   * "Utilidade" e o jogador ter que trocar na mão). Já nasce com os presets Standard de
   * `MEU_SISTEMA.MODULE_SIZE_PRESETS`/`MODULE_HP_BY_SIZE` (Overhaul de Naves, Fase 8) — o mesmo
   * autopreenchimento que rodaria se o usuário trocasse a Categoria manualmente depois (ver
   * `_onModulePresetChange` em item-sheet.js), só que direto na criação.
   */
  static async onItemCreate(event, target) {
    event.preventDefault();
    const type = target.dataset.type || "item";
    const name = type === "starship_module" ? "Novo Módulo" : "Nova Peça";
    const data = { name, type };

    if (type === "starship_module") {
      const category = target.dataset.category || "utility";
      data["system.category"] = category;
      Object.assign(data, getModuleSizePreset(category, "standard"));
    }

    const [created] = await this.actor.createEmbeddedDocuments("Item", [data]);
    if (type === "starship_module") await registerItemInCompendium(created.toObject());
    created.sheet.render(true);
  }

  static onItemEdit(event, target) {
    event.preventDefault();
    const itemId = target.closest(".item-row").dataset.itemId;
    this.actor.items.get(itemId)?.sheet.render(true);
  }

  static async onItemDelete(event, target) {
    event.preventDefault();
    const itemId = target.closest(".item-row").dataset.itemId;
    await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
  }

  static async onToggleModulePower(event, target) {
    event.preventDefault();
    const itemId = target.closest(".item-row").dataset.itemId;
    const module = this.actor.items.get(itemId);
    if (!module) return;
    const next = module.system.status === "online" ? "offline" : "online";

    // Módulo desligado por Vida zerada (dano por sobrecarga, combate, etc.) não pode religar
    // manualmente até estar reparado a 15%+ da Vida Máxima — mesma regra do tick automático.
    if (next === "online" && !moduleCanRestart(module)) {
      ui.notifications.warn(
        `${module.name}: Vida baixa demais pra religar (precisa de ${MEU_SISTEMA.MODULE_RESTART_HP_THRESHOLD_PERCENT}%+ da Vida Máxima).`
      );
      return;
    }

    await module.update({ "system.status": next });

    if (next === "online") {
      await createGrantedSkill(this.actor, module.system.grantsSkill, module.id);
    } else {
      await removeGrantedSkill(this.actor, module.id);
    }
  }

  /** Recalcula o Grid de Energia: excedente carrega os capacitores, déficit os drena. */
  static async onPowerGridTick(event, target) {
    event.preventDefault();
    // Clicar logo após editar Reator/Capacitores dispara o "change" (submitOnChange) e este
    // "click" quase ao mesmo tempo; como o update do actor é assíncrono, ler
    // `this.actor.system.powerGrid` aqui podia pegar o valor ainda não salvo. `submit()` força
    // o flush do formulário atual ANTES do cálculo, garantindo que o Reator/Capacitor usado é
    // o que está na tela, não um valor obsoleto de antes da última edição.
    await this.submit();
    const { available, overloaded } = await this.actor.system.applyPowerGridTick();
    if (overloaded) {
      ui.notifications.warn(
        `${this.actor.name}: Grid de Energia sobrecarregado! Energia disponível: ${available}.`
      );
    } else {
      ui.notifications.info(`${this.actor.name}: Energia disponível: ${available}.`);
    }
  }

  /**
   * "Usar" uma Habilidade de Nave/Veículo — mesmo `useSkillEffect` de actor-sheet.js, só que
   * mais simples: nem Nave nem Veículo fundem Skills (sem Sub-Skills a escolher). "damage"
   * (armas) sempre pede alvo, igual Personagem; "temporary" (aprimoramento) aplica no próprio
   * Ator por padrão — uma Skill de "melhorar a arma" faz sentido mirar em si mesma, não noutro.
   */
  static async onUseSkill(event, target) {
    event.preventDefault();
    const itemId = target.closest(".item-row")?.dataset.itemId;
    const skill = this.actor.items.get(itemId);
    if (!skill) return;

    const mech = skill.system;
    // Habilidade Ativa já ligada: este clique só DESATIVA — nunca re-pede alvo (ver mesmo
    // comentário em actor-sheet.js#onUseSkill).
    const isDeactivating = mech.hasUpkeep && mech.active;
    const usesMechanic = !isDeactivating && (mech.effectType === "temporary" || mech.effectType === "damage");

    if (!usesMechanic) {
      try {
        await useSkillEffect(this.actor, itemId, {});
      } catch (err) {
        console.error(`${SYSTEM_ID} | Falha ao usar habilidade.`, err);
      }
      return;
    }

    try {
      if (mech.effectType === "damage") {
        const targetActor = await this._promptSkillTarget();
        if (!targetActor) return;
        await useSkillEffect(this.actor, itemId, { targetActor });
      } else {
        await useSkillEffect(this.actor, itemId, { targetActor: this.actor });
      }
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao usar habilidade.`, err);
    }
  }

  /**
   * Ajuste manual do Mestre (Overhaul de Naves, Fase 6) — mesmo padrão de `.vital-adjust-popover`
   * já usado no cabeçalho de Personagem (actor-sheet.js), generalizado pra qualquer campo
   * numérico de Nave/Veículo ou de um Módulo específico: Vida de Módulo (`hp`), pools do Ator
   * que a cascata de dano lê (`shields.value`/`casco.value`/`hull.value`), Recarga de Escudo
   * (`shields.rechargeRemaining`) e Recarga de Arma (`cooldownRemaining`) — todos pelo mesmo
   * par de actions, diferenciados só pelos `data-*` de cada botão (`data-scope`: "actor"|"item",
   * `data-item-id`, `data-field`, `data-max-field` opcional).
   */
  static onToggleModuleVitalAdjust(event, target) {
    event.preventDefault();
    const key = target.closest("[data-key]")?.dataset.key;
    if (!key) return;
    this.element.querySelectorAll(".vital-adjust-popover").forEach(pop => {
      pop.classList.toggle("open", pop.dataset.key === key && !pop.classList.contains("open"));
    });
  }

  /** Aplica o valor digitado no popover como Dano/Redução (-) ou Reparo/Aumento (+), clampado em [0, max] se `data-max-field` existir. */
  static async onAdjustModuleVital(event, target) {
    event.preventDefault();
    const dir = Number(target.dataset.dir);
    const popover = target.closest(".vital-adjust-popover");
    const input = popover?.querySelector(".vital-adjust-input");
    const amount = Math.max(0, Number(input?.value) || 0);
    if (!amount) return;

    const { scope, itemId, field, maxField } = target.dataset;
    const doc = scope === "item" ? this.actor.items.get(itemId) : this.actor;
    if (!doc) return;

    const current = foundry.utils.getProperty(doc.system, field) ?? 0;
    const max = maxField ? (foundry.utils.getProperty(doc.system, maxField) ?? Infinity) : Infinity;
    const newValue = Math.clamp(current + dir * amount, 0, max);
    await doc.update({ [`system.${field}`]: newValue });
  }

  /** Dispara uma Arma nativa (Overhaul de Naves, Fase 5) — sempre pede alvo, igual "damage" de Skill. */
  static async onFireWeapon(event, target) {
    event.preventDefault();
    const itemId = target.closest(".weapon-row")?.dataset.itemId;
    const weaponModule = this.actor.items.get(itemId);
    if (!weaponModule) return;

    const targetActor = await this._promptSkillTarget();
    if (!targetActor) return;

    try {
      await fireStarshipWeapon(this.actor, weaponModule, targetActor);
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao disparar Arma.`, err);
    }
  }

  /** Escolhe o alvo de uma arma/efeito — padrão: o próprio Ator (útil pra Escudo/testes). Só Atores com Token na cena atual. */
  async _promptSkillTarget() {
    // Sempre inclui o próprio Ator mesmo sem Token na cena — os demais exigem Token na cena atual.
    const candidates = sceneActorCandidates();
    if (!candidates.some(a => a.id === this.actor.id)) candidates.unshift(this.actor);
    const opts = candidates
      .map(a => `<option value="${a.id}" ${a.id === this.actor.id ? "selected" : ""}>${a.name}${a.id === this.actor.id ? " (este Ator)" : ""}</option>`)
      .join("");

    const targetId = await promptDialog({
      title: "Escolher Alvo",
      confirmLabel: "Usar Habilidade",
      content: `<form><div class="form-group"><label>Alvo</label><select name="targetId">${opts}</select></div></form>`,
      onConfirm: form => form.querySelector("[name=targetId]").value
    });
    return targetId ? game.actors.get(targetId) : null;
  }

  /**
   * Preenche a parte do contexto compartilhada entre Nave e Veículo (Módulos, Grid de Energia,
   * Skills concedidas) — cada Sheet concreta chama isso e só acrescenta o que é próprio dela.
   */
  _prepareShipSystemsContext(context) {
    const actor = this.actor;
    context.isGM = game.user.isGM;
    context.energyLabel = getStarshipEnergyLabel();

    // Módulos de slot único (Reator/Bateria/Distribuidor/Escudo/Motor/Casco/FTL) ganham um
    // bloco dedicado próprio — saem da lista genérica de Módulos pra não duplicar.
    const specialModules = MEU_SISTEMA.STARSHIP_SINGLE_SLOT_CATEGORIES
      .map(category => actor.system.singleSlotModule(category))
      .filter(Boolean);
    context.specialModules = specialModules;
    context.weaponModules = actor.system.weaponModules;
    const excludedIds = new Set([...specialModules, ...context.weaponModules].map(m => m.id));
    context.modules = actor.items.filter(i => i.type === "starship_module" && !excludedIds.has(i.id));

    const budgetUsed = actor.system.weaponSpaceUsed;
    const budget = actor.system.weaponSlotBudget;
    context.weaponBudgetLabel = Number.isFinite(budget)
      ? `${budgetUsed} / ${budget} espaço de Arma usado`
      : `${budgetUsed} espaço de Arma usado`;

    // Fome de energia (Fase 3, Distribuidor) — mapa id→percentual pra badge "⚠ Energia
    // insuficiente" nas linhas de Módulo; 100 (sem badge) pra quem não tem déficit agora.
    context.powerRatios = Object.fromEntries(
      actor.items
        .filter(i => i.type === "starship_module")
        .map(m => [m.id, Math.round(actor.system.powerRatioFor(m) * 100)])
    );

    context.skills = actor.system.skills;
    context.totalConsumption = actor.system.totalConsumption;
    context.availableEnergy = actor.system.availableEnergy;
    context.isOverloaded = actor.system.powerGrid.isOverloaded;

    // Reator/Bateria/Distribuidor/Escudo/Casco são 100% derivados do Módulo instalado — sem o
    // Módulo, o valor é 0 (não um fallback editável), então esses campos do cabeçalho/Grid
    // ficam sempre só-leitura (ver prepareDerivedData em starship-model.js).
    context.reactorModule = actor.system.reactorModule;
    context.shieldModule = actor.system.shieldModule;
    context.engineModule = actor.system.engineModule;
    context.armorModule = actor.system.armorModule;
    context.batteryModule = actor.system.batteryModule;
    context.distributorModule = actor.system.distributorModule;

    context.transferCapacityLabel = `${actor.system.transferCapacity} EPS/rodada`;

    // Cascata de dano Escudo→Casco→Estrutura (Fase 4) — as 3 barras compartilhadas do cabeçalho.
    context.shieldPercent = percentOf(actor.system.shields.value, actor.system.shields.max);
    context.cascoPercent = percentOf(actor.system.casco.value, actor.system.casco.max);
    context.structurePercent = percentOf(actor.system.hull.value, actor.system.hull.max);
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
    // DocumentSheetV2 não liga auto-save por padrão — ver mesmo comentário em actor-sheet.js.
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      selectTab: TabbedActorSheetV2.onSelectTab,
      createItem: TabbedActorSheetV2.onItemCreate,
      editItem: TabbedActorSheetV2.onItemEdit,
      deleteItem: TabbedActorSheetV2.onItemDelete,
      toggleModulePower: TabbedActorSheetV2.onToggleModulePower,
      powerGridTick: TabbedActorSheetV2.onPowerGridTick,
      useSkill: TabbedActorSheetV2.onUseSkill,
      fireWeapon: TabbedActorSheetV2.onFireWeapon,
      toggleModuleVitalAdjust: TabbedActorSheetV2.onToggleModuleVitalAdjust,
      adjustModuleVital: TabbedActorSheetV2.onAdjustModuleVital,
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
    context.shipSizeOptions = sizeOptions(MEU_SISTEMA.SHIP_SIZES);

    this._prepareShipSystemsContext(context);

    debugLog(`${SYSTEM_ID} | NihilityStarshipSheet._prepareContext:`, actor.name);
    return context;
  }
}

/**
 * Ficha de Veículos Terrestres (type "vehicle"): Integridade, Velocidade, Combustível/Bateria e
 * Peças instaladas — desde o overhaul de Porte, também tem o mesmo Grid de Energia/Módulos de
 * slot único de Nave (ver `ShipSystemsDataModel` em starship-model.js).
 */
export class NihilityVehicleSheet extends TabbedActorSheetV2 {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "actor", "vehicle"],
    position: { width: 700, height: 780 },
    // DocumentSheetV2 não liga auto-save por padrão — ver mesmo comentário em actor-sheet.js.
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      selectTab: TabbedActorSheetV2.onSelectTab,
      createItem: TabbedActorSheetV2.onItemCreate,
      editItem: TabbedActorSheetV2.onItemEdit,
      deleteItem: TabbedActorSheetV2.onItemDelete,
      toggleModulePower: TabbedActorSheetV2.onToggleModulePower,
      powerGridTick: TabbedActorSheetV2.onPowerGridTick,
      useSkill: TabbedActorSheetV2.onUseSkill,
      fireWeapon: TabbedActorSheetV2.onFireWeapon,
      toggleModuleVitalAdjust: TabbedActorSheetV2.onToggleModuleVitalAdjust,
      adjustModuleVital: TabbedActorSheetV2.onAdjustModuleVital,
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
    context.shipSizeOptions = sizeOptions(MEU_SISTEMA.VEHICLE_SIZES);
    context.parts = actor.system.parts;
    context.fuelPercent = percentOf(actor.system.fuel.value, actor.system.fuel.max);

    this._prepareShipSystemsContext(context);

    debugLog(`${SYSTEM_ID} | NihilityVehicleSheet._prepareContext:`, actor.name);
    return context;
  }
}
