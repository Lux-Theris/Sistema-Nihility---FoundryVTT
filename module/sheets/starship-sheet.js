import { SYSTEM_ID, MEU_SISTEMA, getStarshipEnergyLabel, debugLog } from "../config.js";
import { registerItemInCompendium } from "../compendium.js";
import { createGrantedSkill, removeGrantedSkill } from "../skill-economy.js";
import { useSkillEffect } from "../skill-effects.js";

const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** Percentual (0-100) usado para desenhar as barras de Casco/Escudos/Integridade/Combustível. */
function percentOf(value, max) {
  if (!max) return 0;
  return Math.round(Math.clamp((value / max) * 100, 0, 100));
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

/** Mesmo padrão manual de abas usado em NihilityItemSheet/NihilityMenuApp (ApplicationV2 não herda o mixin de abas do AppV1). */
class TabbedActorSheetV2 extends HandlebarsApplicationMixin(ActorSheetV2) {
  constructor(options = {}) {
    super(options);
    this.activeTab = "main";
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
      createItem: NihilityStarshipSheet.#onItemCreate,
      editItem: NihilityStarshipSheet.#onItemEdit,
      deleteItem: NihilityStarshipSheet.#onItemDelete,
      toggleModulePower: NihilityStarshipSheet.#onToggleModulePower,
      powerGridTick: NihilityStarshipSheet.#onPowerGridTick,
      useSkill: NihilityStarshipSheet.#onUseSkill,
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
    context.energyLabel = getStarshipEnergyLabel();
    // Casco (Módulo category "armor") tem slot próprio, fora da lista geral — só um por vez.
    context.modules = actor.items.filter(i => i.type === "starship_module" && i.system.category !== "armor");
    context.armorModule = actor.system.armorModule;
    context.armorCandidates = actor.items.filter(i => i.type === "starship_module" && i.system.category === "armor");
    context.skills = actor.system.skills;
    context.totalConsumption = actor.system.totalConsumption;
    context.availableEnergy = actor.system.availableEnergy;
    context.isOverloaded = actor.system.powerGrid.isOverloaded;
    context.primaryPercent = percentOf(actor.system.hull.value, actor.system.hull.max);
    context.secondaryPercent = percentOf(actor.system.shields.value, actor.system.shields.max);

    debugLog(`${SYSTEM_ID} | NihilityStarshipSheet._prepareContext:`, actor.name);
    return context;
  }

  static async #onItemCreate(event, target) {
    event.preventDefault();
    const [created] = await this.actor.createEmbeddedDocuments("Item", [
      { name: "Novo Módulo", type: "starship_module" }
    ]);
    await registerItemInCompendium(created.toObject());
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

  static async #onToggleModulePower(event, target) {
    event.preventDefault();
    const itemId = target.closest(".item-row").dataset.itemId;
    const module = this.actor.items.get(itemId);
    if (!module) return;
    const next = module.system.status === "online" ? "offline" : "online";
    await module.update({ "system.status": next });

    if (next === "online") {
      await createGrantedSkill(this.actor, module.system.grantsSkill, module.id);
    } else {
      await removeGrantedSkill(this.actor, module.id);
    }
  }

  /** Recalcula o Grid de Energia: excedente carrega os capacitores, déficit os drena. */
  static async #onPowerGridTick(event, target) {
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
   * "Usar" uma Habilidade de Nave — mesmo `useSkillEffect` de actor-sheet.js, só que mais
   * simples: Nave não funde Skills (sem Sub-Skills a escolher). "damage" (armas) sempre pede
   * alvo, igual Personagem; "temporary" (aprimoramento) aplica na própria Nave por padrão —
   * uma Skill de "melhorar a arma" faz sentido mirar em si mesma, não noutro Ator.
   */
  static async #onUseSkill(event, target) {
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
        console.error(`${SYSTEM_ID} | Falha ao usar habilidade da Nave.`, err);
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
      console.error(`${SYSTEM_ID} | Falha ao usar habilidade da Nave.`, err);
    }
  }

  /** Escolhe o alvo de uma arma/efeito de Nave — padrão: a própria Nave (útil pra Escudo/testes). */
  async _promptSkillTarget() {
    const candidates = game.actors.filter(a => a.testUserPermission(game.user, "OBSERVER"));
    const opts = candidates
      .map(a => `<option value="${a.id}" ${a.id === this.actor.id ? "selected" : ""}>${a.name}${a.id === this.actor.id ? " (esta Nave)" : ""}</option>`)
      .join("");

    const targetId = await promptDialog({
      title: "Escolher Alvo",
      confirmLabel: "Usar Habilidade",
      content: `<form><div class="form-group"><label>Alvo</label><select name="targetId">${opts}</select></div></form>`,
      onConfirm: form => form.querySelector("[name=targetId]").value
    });
    return targetId ? game.actors.get(targetId) : null;
  }
}

/**
 * Ficha de Veículos Terrestres (type "vehicle"): Integridade, Velocidade,
 * Combustível/Bateria e Peças instaladas.
 */
export class NihilityVehicleSheet extends TabbedActorSheetV2 {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "actor", "vehicle"],
    position: { width: 640, height: 680 },
    // DocumentSheetV2 não liga auto-save por padrão — ver mesmo comentário em actor-sheet.js.
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      selectTab: TabbedActorSheetV2.onSelectTab,
      createItem: NihilityVehicleSheet.#onItemCreate,
      editItem: NihilityVehicleSheet.#onItemEdit,
      deleteItem: NihilityVehicleSheet.#onItemDelete,
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
    context.parts = actor.system.parts;
    context.primaryPercent = percentOf(actor.system.integrity.value, actor.system.integrity.max);
    context.secondaryPercent = percentOf(actor.system.fuel.value, actor.system.fuel.max);

    debugLog(`${SYSTEM_ID} | NihilityVehicleSheet._prepareContext:`, actor.name);
    return context;
  }

  static async #onItemCreate(event, target) {
    event.preventDefault();
    const [created] = await this.actor.createEmbeddedDocuments("Item", [{ name: "Nova Peça", type: "item" }]);
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
}
