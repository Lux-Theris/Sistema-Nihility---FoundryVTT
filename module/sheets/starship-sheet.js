import {
  SYSTEM_ID,
  MEU_SISTEMA,
  getStarshipEnergyLabel,
  getStarshipEnergyAbbr,
  getModuleSizePreset,
  isPadShipEnabled,
  debugLog
} from "../config.js";
import { registerItemInCompendium } from "../compendium.js";
import { createGrantedSkill, removeGrantedSkill } from "../skill-economy.js";
import { useSkillEffect, fireStarshipWeapon } from "../skill-effects.js";
import { moduleCanRestart } from "../starship-power.js";
import { syncLibraryOwnershipToCrew } from "../pad/pad-library.js";
import { pickTargetActor } from "../helpers/target-picker.js";
import { pickImageFile, getDragEventData } from "../helpers/foundry-compat.js";

const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** Percentual (0-100) usado para desenhar as barras de Casco/Escudos/Integridade/Combustível. */
function percentOf(value, max) {
  if (!max) return 0;
  return Math.round(Math.clamp((value / max) * 100, 0, 100));
}

/**
 * Quem pode mexer no throttle dos Módulos. Não é permissão de edição da ficha: throttle é manobra
 * de combate — quem está a bordo decide na hora, sem esperar o dono da ficha. Por isso entra
 * qualquer jogador que possua um Personagem designado na Tripulação (ver `crewMembers` em
 * starship-model.js), além do Mestre e do dono da própria Nave.
 */
function canAdjustThrottle(actor) {
  if (game.user.isGM || actor.isOwner) return true;
  return actor.system.crewActors.some(entry => entry.actor?.isOwner);
}

/** Estado visual de uma barra de Vida/pool: verde, âmbar abaixo de 50%, vermelho abaixo de 20%. */
function meterState(percent) {
  if (percent <= 20) return "crit";
  if (percent <= 50) return "low";
  return "ok";
}

/**
 * Segunda linha do nome de um Módulo — o que aquela categoria faz de fato, já escalado por
 * throttle e fome de energia. Sem isso o Mestre precisaria abrir a ficha do Módulo pra saber se
 * o Escudo instalado é de 200 ou de 1600.
 */
function moduleDetail(actor, module, abbr) {
  const sys = module.system;
  const stat = field => actor.system.effectiveModuleStat(module, field);

  switch (sys.category) {
    case "reactor":
      return `gera ${stat("reactorOutput")} ${abbr}`;
    case "battery":
      return `reserva ${stat("batteryCapacity")} ${abbr}`;
    case "distributor":
      return `teto de ${actor.system.transferCapacity} ${abbr}/rodada`;
    case "shield":
      return `capacidade ${stat("shieldCapacity")} · regen ${stat("shieldRegen")}/rodada`;
    case "engine":
      return `aceleração ${stat("acceleration")} · rotação ${stat("rotation")}`;
    case "armor":
      return `redução ${sys.armorReduction}%`;
    case "ftl":
      return sys.ftlType === "jump"
        ? `Salto · alcance ${sys.jumpRange} · carga ${sys.chargeRemaining}/${sys.chargeTime}`
        : `Dobra · fator ×${sys.warpFactor}`;
    default:
      return "";
  }
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

  /**
   * @override
   * Eventos que não são clique-em-data-action (drop de tripulante, edição de cargo por linha)
   * precisam ser ligados manualmente a cada render — mesmo padrão de ai-assistant.js.
   */
  _onRender(context, options) {
    super._onRender(context, options);
    this._onRenderThrottleInputs();
    if (!game.user.isGM) return;

    const dropzone = this.element.querySelector(".crew-dropzone");
    if (dropzone) {
      dropzone.addEventListener("dragover", event => event.preventDefault());
      dropzone.addEventListener("drop", this._onDropCrewMember.bind(this));
    }

    this.element.querySelectorAll(".crew-role-input").forEach(input => {
      input.addEventListener("change", this._onChangeCrewRole.bind(this));
    });
  }

  /**
   * @override
   * O campo de throttle dispara em "change", fora da API de `actions` (que é só clique). Fica
   * separado do `_onRender` acima de propósito: aquele é GM-only (drop de tripulante, cargo), e
   * o throttle vale pra toda a tripulação.
   */
  _onRenderThrottleInputs() {
    this.element.querySelectorAll(".throttle-input").forEach(input => {
      input.addEventListener("change", this._onThrottleInput.bind(this));
    });
  }

  /** Recebe um Ator (PJ ou NPC) arrastado da barra lateral/ficha como novo tripulante da aba Tripulação. */
  async _onDropCrewMember(event) {
    event.preventDefault();
    const data = getDragEventData(event);
    if (!data?.uuid) return;

    const doc = await fromUuid(data.uuid);
    if (!doc || doc.documentName !== "Actor" || doc.type !== "character") {
      ui.notifications.warn("Só é possível designar Personagens (PJ ou NPC) como tripulantes.");
      return;
    }

    const current = this.actor.system.crewMembers;
    if (current.some(entry => entry.actorUuid === doc.uuid)) {
      ui.notifications.info(`${doc.name} já é tripulante.`);
      return;
    }

    await this.actor.update({ "system.crewMembers": [...current, { actorUuid: doc.uuid, role: "" }] });
    await syncLibraryOwnershipToCrew(this.actor);
  }

  /** Edita o cargo (rótulo livre) de um tripulante já designado — sempre ler-array-inteiro/patch-por-uuid/regravar. */
  async _onChangeCrewRole(event) {
    const input = event.currentTarget;
    const actorUuid = input.dataset.actorUuid;
    const current = this.actor.system.crewMembers;
    const patched = current.map(entry => entry.actorUuid === actorUuid ? { ...entry, role: input.value } : entry);
    await this.actor.update({ "system.crewMembers": patched });
  }

  /** Remove um tripulante da lista. */
  static async onRemoveCrew(event, target) {
    event.preventDefault();
    const actorUuid = target.dataset.actorUuid;
    const current = this.actor.system.crewMembers;
    await this.actor.update({ "system.crewMembers": current.filter(entry => entry.actorUuid !== actorUuid) });
    await syncLibraryOwnershipToCrew(this.actor);
  }

  /** Clique no retrato abre o FilePicker de imagem — precisa de action explícita no ApplicationV2. */
  static async onEditImage(event, target) {
    const field = target.dataset.edit || "img";
    const current = foundry.utils.getProperty(this.actor, field);
    pickImageFile(current, path => this.actor.update({ [field]: path }));
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

  /**
   * Ajusta o throttle de um Módulo direto da ficha — era editável só abrindo a ficha do Módulo,
   * o que não serve pra um controle que se mexe NO MEIO do combate (subir o Escudo, cortar o
   * Motor, sobrecarregar o Reator).
   *
   * Dois passos por botão: 5 pro ajuste fino e 20 pro grosso. Sem teto superior (a sobrecarga
   * é uma escolha legítima, com consequência mecânica própria), mas nunca abaixo de 0.
   */
  static async onAdjustThrottle(event, target) {
    event.preventDefault();
    if (!canAdjustThrottle(this.actor)) {
      ui.notifications.warn("Só a tripulação da Nave pode ajustar o throttle dos Módulos.");
      return;
    }

    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    const module = this.actor.items.get(itemId);
    if (!module) return;

    const step = Number(target.dataset.step) || 0;
    const next = Math.max(0, (module.system.powerAllocationPercent ?? 100) + step);
    await module.update({ "system.powerAllocationPercent": next });
  }

  /** Throttle digitado direto no campo — mesmo caminho e mesma permissão dos botões. */
  async _onThrottleInput(event) {
    if (!canAdjustThrottle(this.actor)) return;
    const input = event.currentTarget;
    const module = this.actor.items.get(input.closest("[data-item-id]")?.dataset.itemId);
    if (!module) return;

    const value = Math.max(0, Math.round(Number(input.value) || 0));
    await module.update({ "system.powerAllocationPercent": value });
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

  /** Escolhe o alvo de uma Arma/Habilidade — ver helpers/target-picker.js (compartilhado com a ficha de Personagem). */
  async _promptSkillTarget() {
    return pickTargetActor({ self: this.actor, title: "Escolher Alvo", confirmLabel: "Usar Habilidade" });
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

    const abbr = getStarshipEnergyAbbr();
    context.energyAbbr = abbr;
    context.canAdjustThrottle = canAdjustThrottle(actor);

    /**
     * Cada linha da grade já vem calculada daqui — o template não faz conta nenhuma. Foi o que
     * permitiu trocar a frase corrida de estatísticas por colunas de verdade: cada célula tem um
     * valor só, e todas alinham de uma linha pra outra.
     */
    const buildRow = module => {
      const sys = module.system;
      const hpPercent = percentOf(sys.hp.value, sys.hp.max);
      const throttle = sys.powerAllocationPercent ?? 100;
      const ratio = Math.round(actor.system.powerRatioFor(module) * 100);
      return {
        id: module.id,
        name: module.name,
        img: module.img,
        category: sys.category,
        categoryLabel: MEU_SISTEMA.STARSHIP_MODULE_CATEGORY_LABELS[sys.category],
        sizeLabel: MEU_SISTEMA.MODULE_SIZE_LABELS[sys.moduleSize],
        detail: moduleDetail(actor, module, abbr),
        online: sys.status === "online",
        hpValue: sys.hp.value,
        hpMax: sys.hp.max,
        hpPercent,
        hpState: meterState(hpPercent),
        throttle,
        // Abaixo de 100% economiza, acima sobrecarrega: a borda do campo muda de cor nos dois
        // sentidos, senão "90%" e "190%" pareceriam a mesma coisa de relance.
        throttleState: throttle > 100 ? "over" : throttle < 100 ? "under" : "",
        // Consumo REAL (já escalado pelo throttle) — é este que pesa no Grid, não o valor base.
        consumption: Math.round((sys.powerConsumption ?? 0) * (throttle / 100)),
        starved: ratio < 100,
        powerRatio: ratio,
        // Só Arma
        damageFormula: sys.damageFormula,
        penetration: sys.penetration,
        cooldownRemaining: sys.cooldownRemaining,
        cooldownRounds: sys.cooldownRounds
      };
    };

    context.specialModuleRows = specialModules.map(buildRow);
    context.moduleRows = context.modules.map(buildRow);
    context.weaponRows = context.weaponModules.map(buildRow);

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
    context.padShipEnabled = isPadShipEnabled();
    context.crewActors = actor.system.crewActors;
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

    // O número cru (a corrente do Grid mostra o valor sozinho, com o rótulo no cabeçalho da
    // coluna); o label pronto continua pra onde a frase inteira ainda faz sentido.
    context.transferCapacity = actor.system.transferCapacity;
    context.transferCapacityLabel = `${actor.system.transferCapacity} ${context.energyLabel}/rodada`;

    // Cascata de dano Escudo→Casco→Estrutura (Fase 4) — as 3 barras compartilhadas do cabeçalho.
    context.shieldPercent = percentOf(actor.system.shields.value, actor.system.shields.max);
    context.cascoPercent = percentOf(actor.system.casco.value, actor.system.casco.max);
    context.structurePercent = percentOf(actor.system.hull.value, actor.system.hull.max);
    // Estado de cada pool, pra barra mudar de cor — "Escudo em 1%" precisa gritar mais que o texto.
    context.shieldState = meterState(context.shieldPercent);
    context.cascoState = meterState(context.cascoPercent);
    context.structureState = meterState(context.structurePercent);

    // Grid de Energia desenhado como corrente: quem é o gargalo agora, o Reator ou o Distribuidor?
    const generation = actor.system.powerGrid.reactorOutput;
    const transfer = actor.system.transferCapacity;
    context.powerCeiling = Math.min(generation, transfer);
    context.distributorIsBottleneck = transfer < generation;
    context.demandPercent = percentOf(actor.system.totalConsumption, context.powerCeiling);
    context.demandSlack = Math.max(0, context.powerCeiling - actor.system.totalConsumption);
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
      adjustThrottle: TabbedActorSheetV2.onAdjustThrottle,
      powerGridTick: TabbedActorSheetV2.onPowerGridTick,
      useSkill: TabbedActorSheetV2.onUseSkill,
      fireWeapon: TabbedActorSheetV2.onFireWeapon,
      toggleModuleVitalAdjust: TabbedActorSheetV2.onToggleModuleVitalAdjust,
      adjustModuleVital: TabbedActorSheetV2.onAdjustModuleVital,
      editImage: TabbedActorSheetV2.onEditImage,
      removeCrew: TabbedActorSheetV2.onRemoveCrew
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
      adjustThrottle: TabbedActorSheetV2.onAdjustThrottle,
      powerGridTick: TabbedActorSheetV2.onPowerGridTick,
      useSkill: TabbedActorSheetV2.onUseSkill,
      fireWeapon: TabbedActorSheetV2.onFireWeapon,
      toggleModuleVitalAdjust: TabbedActorSheetV2.onToggleModuleVitalAdjust,
      adjustModuleVital: TabbedActorSheetV2.onAdjustModuleVital,
      editImage: TabbedActorSheetV2.onEditImage,
      removeCrew: TabbedActorSheetV2.onRemoveCrew
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
