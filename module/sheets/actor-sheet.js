import { effectAnchors, finiteRemaining, anchorLifetime, PERMANENT } from "../combat/effect-anchors.js";
import { changeActorSpecies, originContext, openSpeciesSync, changeActorHeritage, openEvolution } from "../species/species.js";
import { anatomyContext, installImplant, uninstallImplant, currentDraggedImplant, setBodyPartLost } from "../species/anatomy.js";
import { implantFits } from "../species/anatomy-rules.js";
import { isSpeciesLocked } from "../species/species-rules.js";
import { NPC_TIERS, NPC_TIER_LABELS } from "../npc/npc-generator-rules.js";
import { templateGroups, templateFillSentence, skillFromTemplate } from "../skills/skill-assist.js";
import { sheetTrim, allZero, shownSkillTiers } from "./sheet-trim-rules.js";
import {
  SYSTEM_ID,
  MEU_SISTEMA,
  getCharacterEnergyLabel,
  getActiveCurrencies,
  getSpeciesForCreation,
  isEconomyEnabled,
  isTitlesEnabled,
  isFeatureEnabled,
  isAnatomyEnabled,
  isPadEnabled,
  isPadMessagingEnabled,
  isSkillFusionEnabled,
  isSkillPointsEnabled,
  isAttributePoolEnabled,
  isEnergyPoolEnabled,
  getVisibleAttributes,
  sceneActorCandidates,
  debugLog,
  isMovementEnabled,
  describeMovement,
  getAttributeLabel,
  getScaleConfig,
  isScaleEnabled,
  actorDisplayName,
  isInventoryEnabled
} from "../core/config.js";
import { hasPadDevice } from "../pad/pad-crew.js";
import { getTotalUnread } from "../pad/pad-messaging.js";
import { fuseSkills, evolveSkill, breakSkillPoints, mergeSkillPoints, requestSkillCreation, openSkillRequests, openSkillRequestEditor, editSkillRequest, freeSkillPoints } from "../skills/skill-economy.js";
import {
  inCreation,
  isCreationEnabled,
  creationProgress,
  vitalPreviewFor,
  attributePurposeContext,
  attributePurpose,
  originPicker,
  applyQuickSpread,
  markReady,
  backToEditing,
  enterCreation,
  releaseCharacter,
  requestAdjustment,
  QUICK_SPREADS
} from "../creation/creation.js";
import { registerItemInCompendium } from "../core/compendium.js";
import { convertActorCurrency, transferCurrency } from "../economy/currency.js";
import { rollAttribute, buildAttributeRollFormula } from "../core/dice.js";
import { rollInitiativeForActor, getInitiativeLabel } from "../combat/combat.js";
import { getMovementDashStatus, toggleMovementDash } from "../combat/movement.js";
import { pickTargetActor } from "../helpers/target-picker.js";
import { rollOptionsFromEvent } from "../apps/roll-options-dialog.js";
import { traitContext, changeTrait, pickActorTraits } from "../helpers/traits-ui.js";
import { describeShieldPools } from "../combat/shield-pools.js";
import { useSkillFlow } from "../skills/skill-use-flow.js";
import { reportError } from "../helpers/report.js";
import { escapeHtml } from "../helpers/html.js";
import { useWeaponAttack } from "../combat/damage-roll.js";
import { tickPeriodicEffect } from "../skills/effects-apply.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";
import { openSkillEditorDialog } from "../apps/skill-editor-dialog.js";
import { editPortraitFrameAction, CLEAR_PORTRAIT_FRAME } from "../helpers/portrait-frame.js";
import { pickImageFile } from "../helpers/foundry-compat.js";

import { handleItemDrop, splitStack, toggleEquipped, inventoryContext } from "../economy/inventory.js";
import { EffectsListApp } from "../apps/effects-list.js";
import { enableHotbarDrag } from "../core/hotbar.js";
import { skillSummariesFor } from "../skills/skill-summary-ui.js";
import { useConsumable, reloadWeapon, weaponCanFire } from "../economy/consumables.js";
import { magazineState } from "../economy/consumable-rules.js";
import { blockIfIncapacitated } from "../combat/incapacitation.js";
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

/**
 * Janelinha de "Nova Habilidade": Nome, Tier e o Modelo de onde começar (L7; canvas "Editor de
 * Skill Assistido", prancha 2) — "Em branco" é o jeito de antes. O resto se edita na ficha.
 */
async function promptNewSkill(tierChoices) {
  const esc = escapeHtml;
  const options = tierChoices.map(t => `<option value="${t}" ${t === "normal" ? "selected" : ""}>${esc(MEU_SISTEMA.SKILL_TIER_LABELS[t] ?? t)}</option>`).join("");
  const tile = (id, label, hint, extra = "") =>
    `<label class="sa-tile ${extra}"><input type="radio" name="template" value="${esc(id)}" ${id ? "" : "checked"}/><span class="sa-tile-name">${esc(label)}</span><small>${esc(hint)}</small></label>`;
  const groups = templateGroups();
  const tiles = groups
    .map((g, i) => `<p class="sa-tile-group">${esc(g.label)}</p><div class="sa-tiles">${i === 0 ? tile("", "Em branco", "Tudo vazio, como antes", "blank") : ""}${g.templates.map(t => tile(t.id, t.label, t.hint)).join("")}</div>`)
    .join("");
  return foundry.applications.api.DialogV2.wait({
    window: { title: "Nova Habilidade" },
    classes: ["nihility-skill-editor-dialog", "nihility-new-skill"],
    position: { width: 640 },
    content: `<div class="skill-editor-form">
      <div class="sa-new-row">
        <div class="form-group"><label>Nome</label><input type="text" name="name" placeholder="Bola de Fogo" autofocus/></div>
        <div class="form-group"><label>Tier</label><select name="tier">${options}</select></div>
      </div>
      ${groups.length ? `<div class="form-group"><label>Começar de</label>${tiles}</div>` : ""}
      <p class="sa-fill hint-inline">A ficha da Habilidade abre em seguida: Mecânica, alvo, efeitos e passivos ficam lá.</p>
    </div>`,
    render: (event, dialog) => {
      const fill = dialog.element.querySelector(".sa-fill");
      const update = () => {
        const id = dialog.element.querySelector("[name=template]:checked")?.value ?? "";
        dialog.element.querySelectorAll(".sa-tile").forEach(t => t.classList.toggle("on", t.querySelector("input").checked));
        fill.textContent = id
          ? `Vem preenchido: ${templateFillSentence(id)}. Você troca nome, elemento e números na ficha que abre em seguida.`
          : "A ficha da Habilidade abre em seguida: Mecânica, alvo, efeitos e passivos ficam lá.";
      };
      dialog.element.querySelectorAll("[name=template]").forEach(r => r.addEventListener("change", update));
      update();
    },
    buttons: [
      {
        action: "create",
        label: "Criar e abrir",
        default: true,
        callback: (event, button, dialog) => {
          const name = dialog.element.querySelector("[name=name]").value.trim();
          return {
            name,
            tier: dialog.element.querySelector("[name=tier]").value,
            template: dialog.element.querySelector("[name=template]:checked")?.value ?? ""
          };
        }
      },
      { action: "cancel", label: "Cancelar" }
    ],
    rejectClose: false
  }).then(result => (result && typeof result === "object" ? result : null));
}

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
      toggleShowEmpty: NihilityActorSheet.#onToggleShowEmpty,
      createItem: NihilityActorSheet.#onItemCreate,
      editItem: NihilityActorSheet.#onItemEdit,
      deleteItem: NihilityActorSheet.#onItemDelete,
      fuseSkills: NihilityActorSheet.#onFuseSkills,
      useSkill: NihilityActorSheet.#onUseSkill,
      evolveSkill: NihilityActorSheet.#onEvolveSkill,
      requestSkillCreation: NihilityActorSheet.#onRequestSkillCreation,
      rollAttribute: NihilityActorSheet.#onRollAttribute,
      incrementAttributePoint: NihilityActorSheet.#onIncrementAttributePoint,
      decrementAttributePoint: NihilityActorSheet.#onDecrementAttributePoint,
      confirmAttributePoints: NihilityActorSheet.#onConfirmAttributePoints,
      resetAttributePoints: NihilityActorSheet.#onResetAttributePoints,
      gmResetAllAttributePoints: NihilityActorSheet.#onGmResetAllAttributePoints,
      attackWithWeapon: NihilityActorSheet.#onAttackWithWeapon,
      useConsumable: NihilityActorSheet.#onUseConsumable,
      reloadWeapon: NihilityActorSheet.#onReloadWeapon,
      breakSkillPoints: NihilityActorSheet.#onBreakSkillPoints,
      mergeSkillPoints: NihilityActorSheet.#onMergeSkillPoints,
      adjustSkillPoints: NihilityActorSheet.#onAdjustSkillPoints,
      convertCurrency: NihilityActorSheet.#onConvertCurrency,
      sendCurrency: NihilityActorSheet.#onSendCurrency,
      levelUpActor: NihilityActorSheet.#onLevelUpActor,
      toggleVitalAdjust: NihilityActorSheet.#onToggleVitalAdjust,
      adjustVital: NihilityActorSheet.#onAdjustVital,
      restActor: NihilityActorSheet.#onRest,
      rollInitiative: NihilityActorSheet.#onRollInitiative,
      toggleDash: NihilityActorSheet.#onToggleDash,
      grantXp: NihilityActorSheet.#onGrantXp,
      editImage: NihilityActorSheet.#onEditImage,
      editPortraitFrame: editPortraitFrameAction,
      applyManualTick: NihilityActorSheet.#onApplyManualTick,
      deleteCondition: NihilityActorSheet.#onDeleteCondition,
      openPad: NihilityActorSheet.#onOpenPad,
      removeTrait: NihilityActorSheet.#onRemoveTrait,
      restoreTrait: NihilityActorSheet.#onRestoreTrait,
      pickTraits: NihilityActorSheet.#onPickTraits,
      toggleEquip: NihilityActorSheet.#onToggleEquip,
      openEffectsList: NihilityActorSheet.#onOpenEffectsList,
      explainStat: NihilityActorSheet.#onExplainStat,
      originChange: NihilityActorSheet.#onOriginChange,
      originLineage: NihilityActorSheet.#onOriginLineage,
      originSync: NihilityActorSheet.#onOriginSync,
      originUnlock: NihilityActorSheet.#onOriginUnlock,
      heritageAdd: NihilityActorSheet.#onHeritageAdd,
      originEvolve: NihilityActorSheet.#onOriginEvolve,
      uninstallImplant: NihilityActorSheet.#onUninstallImplant,
      toggleBodyPartLost: NihilityActorSheet.#onToggleBodyPartLost,
      heritageRemove: NihilityActorSheet.#onHeritageRemove,
      splitStack: NihilityActorSheet.#onSplitStack,
      editSkillRequest: NihilityActorSheet.#onEditSkillRequest,
      creationGo: NihilityActorSheet.#onCreationGo,
      creationReady: NihilityActorSheet.#onCreationReady,
      creationBack: NihilityActorSheet.#onCreationBack,
      creationEnter: NihilityActorSheet.#onCreationEnter,
      creationRelease: NihilityActorSheet.#onCreationRelease,
      creationAdjust: NihilityActorSheet.#onCreationAdjust,
      originPick: NihilityActorSheet.#onOriginPick,
      originPickLineage: NihilityActorSheet.#onOriginPickLineage,
      originApply: NihilityActorSheet.#onOriginApply,
      quickSpread: NihilityActorSheet.#onQuickSpread
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
    // Estado de tela da aba Inventário (não é salvo).
    this.inventoryFilter = "all";
    this.inventorySort = "name";
    // Cartão marcado na grade de Espécies do modo criação (só tela; aplica em "Ficar com…").
    this.originPick = {};
  }

  /**
   * @override Menu ⋮ do cabeçalho, só do Mestre: "Pôr em modo criação" ou, já em criação,
   * "Liberar…" e "Pedir ajuste…" (J10, prancha 5 C). Montado na hora em que o menu abre.
   */
  _getHeaderControls() {
    const controls = super._getHeaderControls();
    const gmCharacter = () => game.user.isGM && this.actor.type === "character" && isCreationEnabled();
    controls.push(
      { icon: "fas fa-user-pen", label: "Pôr em modo criação", action: "creationEnter", visible: () => gmCharacter() && !inCreation(this.actor) },
      { icon: "fas fa-user-check", label: "Liberar personagem…", action: "creationRelease", visible: () => gmCharacter() && inCreation(this.actor) },
      { icon: "fas fa-comment", label: "Pedir ajuste…", action: "creationAdjust", visible: () => gmCharacter() && inCreation(this.actor) }
    );
    return controls;
  }

  /** @override Item Geral solto na ficha: empilha, move entre fichas, guarda em contêiner (inventory.js). */
  async _onDropItem(event, item) {
    // Implante solto sobre uma Parte do Corpo (aba Anatomia): instala em vez de ir para o inventário.
    const partEl = event?.target?.closest?.("[data-part-id]");
    if (partEl && this.actor.isOwner) {
      const doc = item instanceof foundry.abstract.Document ? item : await Item.implementation.fromDropData(item);
      if (doc?.type === "item" && doc.system?.implant?.enabled) {
        partEl.classList.remove("drop-ok", "drop-no");
        await installImplant(this.actor, partEl.dataset.partId, doc);
        return doc;
      }
    }
    return handleItemDrop(this, event, item, () => super._onDropItem(event, item));
  }

  /** Janela "Efeitos": tudo o que age sobre este personagem (ver apps/effects-list.js). */
  static #onOpenEffectsList(event) {
    event.preventDefault();
    EffectsListApp.open(this.actor);
  }

  /** Mestre: "Trocar…" na aba Origem — escolhe Espécie (e Linhagem) e abre a prévia. */
  static async #onOriginChange(event) {
    event.preventDefault();
    if (!game.user.isGM) return;
    const { pickSpeciesDialog } = await import("../apps/species-preview.js");
    const target = await pickSpeciesDialog({ species: this.actor.system.species, lineage: this.actor.system.lineage });
    if (!target) return;
    await changeActorSpecies(this.actor, target, { reason: "change" });
  }

  /** Mestre: "Trocar…" da Linhagem. */
  static async #onOriginLineage(event) {
    event.preventDefault();
    if (!game.user.isGM) return;
    const { pickSpeciesDialog } = await import("../apps/species-preview.js");
    const target = await pickSpeciesDialog({ species: this.actor.system.species, lineage: this.actor.system.lineage }, { lineageOnly: true });
    if (!target) return;
    await changeActorSpecies(this.actor, target, { reason: "lineage" });
  }

  /** Mestre: selo "a Espécie mudou" → prévia de sincronização desta ficha. */
  static async #onOriginSync(event) {
    event.preventDefault();
    if (!game.user.isGM) return;
    await openSpeciesSync(this.actor.system.species, { actors: [this.actor] });
  }

  /** Remove um implante/prótese da parte: o Item volta ao inventário (prótese devolve a parte natural). */
  static async #onUninstallImplant(event, target) {
    event.preventDefault();
    if (!this.actor.isOwner) return;
    const row = target.closest("[data-part-id]");
    await uninstallImplant(this.actor, row.dataset.partId, Number(target.dataset.index));
  }

  /** Mestre: marca/desmarca uma parte como Perdida (decepada) — só Regeneração refaz uma perdida. */
  static async #onToggleBodyPartLost(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return;
    const partId = target.closest("[data-part-id]")?.dataset.partId;
    const part = this.actor.items.get(partId);
    if (!part) return;
    await setBodyPartLost(this.actor, partId, part.system.status !== "lost");
  }

  /** Mestre: "Evoluir…" — destinos da Espécie, prévia e anúncio (species.js#openEvolution). */
  static async #onOriginEvolve(event) {
    event.preventDefault();
    await openEvolution(this.actor);
  }

  /** Mestre: "+ Herança…" — escolhe a Herança e de onde veio, depois a prévia (com aviso de regra). */
  static async #onHeritageAdd(event) {
    event.preventDefault();
    if (!game.user.isGM) return;
    const { pickHeritageDialog } = await import("../apps/species-preview.js");
    const picked = await pickHeritageDialog(this.actor);
    if (!picked) return;
    await changeActorHeritage(this.actor, picked.id, { op: "add", source: picked.source });
  }

  /** Mestre: "Retirar…" de uma Herança — a mesma prévia, ao contrário. */
  static async #onHeritageRemove(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return;
    await changeActorHeritage(this.actor, target.dataset.heritage, { op: "remove" });
  }

  /** Mestre: devolve ao jogador a escolha de Espécie/Linhagem (até o próximo "Confirmar" de pontos). */
  static async #onOriginUnlock(event) {
    event.preventDefault();
    if (!game.user.isGM) return;
    await this.actor.update({ "system.speciesState.unlocked": true });
    ui.notifications.info(`${this.actor.name}: o jogador pode trocar a Espécie de novo até confirmar pontos.`);
  }

  /** ⓘ ao lado de um Atributo ou de Vida/Mana: a janela "De onde vem" (apps/stat-breakdown.js). */
  static async #onExplainStat(event, target) {
    event.preventDefault();
    const stat = target.dataset.stat;
    if (!stat) return;
    const { StatBreakdownApp } = await import("../apps/stat-breakdown.js");
    StatBreakdownApp.open(this.actor, stat);
  }

  static async #onToggleEquip(event, target) {
    event.preventDefault();
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (item) await toggleEquipped(item);
  }

  static async #onSplitStack(event, target) {
    event.preventDefault();
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (item) await splitStack(item);
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
   * @override
   * O retrato só muda pelo FilePicker (`editImage`), nunca pelo envio do formulário. Se `img`
   * chegar aqui, é eco do valor atual — e um retrato cujo caminho não tem extensão de arquivo
   * válida (URL sem extensão, por exemplo) reprovava a validação e impedia salvar QUALQUER
   * campo da ficha, inclusive o nome.
   */
  _prepareSubmitData(event, form, formData, updateData) {
    // Tem que sair ANTES do super: é ele quem valida o diff inteiro contra o schema.
    if (formData?.object) delete formData.object.img;
    const data = super._prepareSubmitData(event, form, formData, updateData);
    delete data.img;
    return data;
  }

  /**
   * Clique no retrato abre o FilePicker de imagem — no ApplicationV2 isso não é mais
   * automático só por causa do atributo `data-edit`; precisa de uma action de verdade.
   */
  static async #onEditImage(event, target) {
    const field = target.dataset.edit || "img";
    const current = foundry.utils.getProperty(this.actor, field);
    // Imagem nova = enquadramento novo: o recorte da anterior não vale pra ela.
    pickImageFile(current, path => this.actor.update({ [field]: path, ...(field === "img" ? CLEAR_PORTRAIT_FRAME : {}) }));
  }

  /**
   * Abre o PAD vinculado a este Personagem. Import dinâmico igual todo outro app aberto sob
   * demanda no sistema (ver `#onRunAction` em nihility-menu.js).
   */
  static async #onOpenPad(event, target) {
    event.preventDefault();
    const { NihilityPadApp } = await import("../apps/nihility-pad.js");
    // Reaproveita a janela já aberta pra este Ator (ver comentário sobre `id` no construtor de
    // NihilityPadApp) em vez de abrir uma segunda instância brigando pelo mesmo `id`.
    const existing = foundry.applications.instances.get(`nihility-pad-${this.actor.id}`);
    if (existing) {
      existing.bringToFront();
      return;
    }
    new NihilityPadApp({ actor: this.actor }).render(true);
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
    context.skillFusionEnabled = isSkillFusionEnabled();
    context.skillPointsEnabled = isSkillPointsEnabled();
    context.attributePoolEnabled = isAttributePoolEnabled();
    context.energyPoolEnabled = isEnergyPoolEnabled();
    context.isGM = game.user.isGM;
    // Nível de NPC (M6): select só do Mestre, só em NPC, só com o bloco ligado.
    context.npcTierOptions =
      game.user.isGM && !this.actor.system.isPlayerCharacter && isFeatureEnabled("npcTiers")
        ? NPC_TIERS.map(id => ({ id, label: NPC_TIER_LABELS[id], selected: (this.actor.system.npcTier || "normal") === id }))
        : null;
    // Mestre sempre vê o botão (ferramenta de Mestre, independente de o NPC possuir o Item
    // físico); jogador só vê se o próprio Ator tiver ao menos um Item marcado como PAD.
    context.showPadButton = isPadEnabled() && (game.user.isGM || hasPadDevice(actor));
    // Badge de não lidas no botão do PAD — as mensagens ficam fora do log de chat, então sem
    // isto (e sem o aviso da Voz do Mundo) só quem abre o PAD por acaso descobre que chegou algo.
    context.padUnread = context.showPadButton && isPadMessagingEnabled() ? await getTotalUnread(actor) : 0;
    // Peso por moeda e total — cada moeda já tinha `weight` configurável e nada usava o número.
    // É só exibição: não existe limite de carga nem penalidade por excesso.
    const currencyTotals = { weight: 0 };
    context.currencies = getActiveCurrencies().map(currency => {
      const amount = Number(actor.system.currencies?.[currency.id]) || 0;
      const weight = amount * (Number(currency.weight) || 0);
      currencyTotals.weight += weight;
      return { ...currency, amount, weight: weight.toFixed(2) };
    });
    context.currencyWeightTotal = currencyTotals.weight.toFixed(2);
    // Só as espécies oferecidas na criação (o Mestre vê todas) — ver getSpeciesForCreation.
    context.speciesOptions = getSpeciesForCreation();
    // Depois do primeiro "Confirmar" de pontos, só o Mestre troca a Espécie.
    context.speciesLocked = !game.user.isGM && isSpeciesLocked(actor.system);
    // Origem (Espécie · Linhagem · Heranças): cabeçalho e aba Origem — ver originContext em species.js.
    context.origin = originContext(actor);
    // Só os atributos que a campanha exibe (ver getActiveAttributes em config.js). Um atributo
    // oculto continua valendo por baixo — só não aparece nem é rolável.
    const purposeCtx = attributePurposeContext();
    context.attributeLabels = getVisibleAttributes().map(({ key, label }) => {
      const data = actor.system.attributes.combat[key];
      const hasPending = (data.pendingPoints ?? 0) > 0;
      return {
        key,
        label,
        data,
        // Para que serve, numa frase (prancha 2 C): fica para sempre, não só na criação.
        purpose: attributePurpose(key, purposeCtx),
        formula: buildAttributeRollFormula(data.bonus),
        previewFormula: hasPending ? buildAttributeRollFormula(data.previewBonus) : null,
        // Só a linha de Destreza carrega o deslocamento (ver deriveMovement em character-model.js).
        movement: key === "dexterity" && isMovementEnabled() ? describeMovement(actor.system.movement) : null
      };
    });
    context.attributePointsPending = MEU_SISTEMA.COMBAT_ATTRIBUTES.reduce(
      (sum, key) => sum + (actor.system.attributes.combat[key].pendingPoints ?? 0),
      0
    );
    // Modo criação (J10): faixa "Criando", grade de Espécies na Origem, "Confirmar" guardado.
    context.creation = inCreation(actor) ? await this.#creationContext() : null;
    // "Ao confirmar" (prancha 2 B): Vida/Mana/iniciativa com os pendentes, dentro e fora da criação.
    context.vitalPreview = context.attributePoolEnabled && (context.creation || context.attributePointsPending) ? vitalPreviewFor(actor) : null;
    // "Começar de um jeito" (prancha 2 D): só enquanto nenhum ponto foi confirmado.
    context.quickSpreads =
      context.attributePoolEnabled && actor.isOwner && MEU_SISTEMA.COMBAT_ATTRIBUTES.every(k => !(actor.system.attributes.combat[k]?.points > 0))
        ? Object.entries(QUICK_SPREADS).map(([id, s]) => ({ id, label: s.label }))
        : null;
    context.attributePoolPercent = percentOf(
      actor.system.attributePointsPool.spent,
      actor.system.attributePointsPool.total
    );
    context.initiativeLabel = getInitiativeLabel();
    context.movementDash = getMovementDashStatus(actor);
    context.traits = traitContext(actor);
    // Escala do Ator: só o Mestre escolhe, e só com o bloco ligado (um dragão pode ser "Veículo").
    context.scaleOptions = isScaleEnabled()
      ? getScaleConfig().scales.map((s, i) => ({ id: i === 0 ? "" : s.id, label: s.label, selected: (actor.system.scale || "") === (i === 0 ? "" : s.id) }))
      : null;

    // Experiência — bloco SÓ do Mestre (o jogador nem sabe que existe). Uma linha pro Personagem
    // e uma por Skill, todas já com o teto do nível atual calculado em prepareDerivedData.
    if (context.isGM) {
      const attributes = actor.system.attributes;
      context.xpEntries = [
        {
          scope: "actor",
          id: "",
          name: actor.name,
          detail: `nível ${attributes.level}`,
          xp: attributes.xp,
          xpMax: attributes.xpMax,
          percent: attributes.xpPercent,
          ready: attributes.xpReady
        },
        ...actor.items
          // Skill concedida por Item/Módulo é fixa: não entra na lista de quem recebe XP.
          .filter(i => i.type === "skill" && !i.system.isItemGranted)
          .map(skill => ({
            scope: "skill",
            id: skill.id,
            name: skill.name,
            detail: `nível ${skill.system.level}`,
            xp: skill.system.xp,
            xpMax: skill.system.xpMax,
            percent: skill.system.xpPercent,
            ready: skill.system.xpReady
          }))
      ];
    }
    context.hpPercent = percentOf(actor.system.attributes.hp.value, actor.system.attributes.hp.max);
    context.energyPercent = percentOf(actor.system.attributes.energy.value, actor.system.attributes.energy.max);
    context.shieldValue = actor.system.attributes.shield.value;
    // Um pool por Skill de Escudo (o mais recente apanha primeiro) — ver shield-pools.js.
    context.shieldPoolsText = (actor.system.attributes.shield.pools ?? []).length ? describeShieldPools(actor) : "";

    // Condições ativas: só os Active Effects que este sistema criou (skillEffect: true) —
    // Active Effects de outras origens (módulos, core) não entram nessa lista. Periódicas com
    // tickUnit "manual" (cura/dano de longo prazo fora de combate) ganham o botão de tick;
    // "combatRound" tica sozinho pelo hook updateCombat, sem precisar de botão nenhum aqui.
    const combatNow = game.combat?.started ? { round: game.combat.round ?? 0, combatId: game.combat.id } : {};
    context.activeConditions = actor.effects
      .filter(e => e.flags?.[SYSTEM_ID]?.skillEffect)
      .map(e => {
        const flags = e.flags[SYSTEM_ID];
        // "Até desativar" só quando nenhum prazo finito corre junto com a âncora (ver
        // effect-anchors.js): periódico com os ticks finitos zerados; comum sem `finite` sobrando.
        const anchors = effectAnchors(flags, e.origin);
        const ticksExhausted = flags.periodic && (flags.ticksRemaining ?? 0) <= 0;
        const finite = !flags.periodic && anchors.length ? finiteRemaining(flags.finite, combatNow) : 0;
        return {
          id: e.id,
          name: e.name,
          img: e.img,
          periodic: Boolean(flags.periodic),
          manual: flags.tickUnit === "manual",
          tiedToActive: flags.periodic ? anchors.length > 0 && ticksExhausted : anchorLifetime({ anchors, finite }).untilOff,
          ticksRemaining: flags.ticksRemaining,
          roundsRemaining: anchors.length ? (finite > 0 && finite !== PERMANENT ? finite : null) : e.duration?.rounds ?? null
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
    // Pedidos de Skill abertos (prancha 3 A): linha tracejada na faixa do Tier, com o recado do Mestre.
    const { skillSentence } = await import("../skills/skill-assist.js");
    context.requestsByTier = {};
    for (const message of openSkillRequests(actor)) {
      const req = message.flags[SYSTEM_ID].skillRequest;
      (context.requestsByTier[req.tier] ??= []).push({
        messageId: message.id,
        name: req.name,
        sentence: req.mechanics ? skillSentence(req.mechanics) : "",
        changes: req.status === "changes",
        gmNote: req.gmNote ?? "",
        canEdit: message.isOwner
      });
    }
    context.freeSkillPoints = MEU_SISTEMA.SKILL_POINT_TIERS.reduce((sum, t) => sum + freeSkillPoints(actor, t), 0);
    // A Skill numa frase, na linha da ficha (o que faz · onde · custo · manutenção).
    context.skillSummaries = skillSummariesFor(actor);
    context.fusableTiers = FUSABLE_TARGET_TIERS.filter(t => t !== "ultimate" || ultimateVisible);
    context.hasUltimateSkill = actor.system.hasUltimateSkill;

    context.bodyParts = actor.items.filter(i => i.type === "body_part");
    // Anatomia (board 5): Funções, implantes e o que as partes perdidas estão causando.
    context.anatomy = anatomyContext(actor);
    context.statusLabels = MEU_SISTEMA.BODY_PART_STATUS_LABELS;
    context.titles = actor.system.titles;
    context.gear = actor.items.filter(i => i.type === "item");
    // Com o Inventário ligado, a aba Ficha mostra só os equipados (as armas atacam dali) e o resto
    // mora na aba Inventário.
    context.inventoryEnabled = isInventoryEnabled();
    context.canSeeEffects = actor.isOwner || game.user.isGM;
    context.effectsCount = actor.effects.size;
    context.fichaGear = context.inventoryEnabled ? context.gear.filter(i => i.system.equipped) : context.gear;
    // Carregador de cada arma da lista: o máximo é a Carga da munição que está dentro (ver magazineState).
    context.gearMagazines = Object.fromEntries(
      (context.fichaGear ?? []).filter(i => i.system?.weapon?.enabled).map(i => [i.id, magazineState({ size: i.system.weapon.magazineSize, loaded: i.system.weapon.loaded, capacity: i.system.weapon.loadedAmmo?.capacity })])
    );
    if (context.inventoryEnabled) context.inventory = inventoryContext(actor, { filter: this.inventoryFilter, sort: this.inventorySort });

    // K3: o jogador vê só os blocos que têm alguma coisa; o Mestre vê tudo, marcado.
    context.trim = sheetTrim({
      isGM: game.user.isGM,
      showAll: this.#showEmptyBlocks(),
      empty: {
        titles: Boolean(context.titlesEnabled) && !context.titles.length,
        skillPoints: Boolean(context.skillPointsEnabled) && allZero(actor.system.skillPoints),
        gear: !context.fichaGear.length,
        economy: Boolean(context.economyEnabled) && allZero(actor.system.currencies),
        anatomy: Boolean(context.anatomyEnabled) && !actor.items.some(i => i.type === "body_part")
      }
    });
    context.skillTierList = shownSkillTiers(
      context.visibleTiers,
      Object.fromEntries(Object.entries(context.skillsByTier).map(([tier, list]) => [tier, list.length + (context.requestsByTier[tier]?.length ?? 0)])),
      { isGM: game.user.isGM, showAll: context.trim.showAll }
    );
    if (context.trim.anatomy.hide && this.activeTab === "anatomy") context.activeTab = this.activeTab = "ficha";
    // Em criação a Anatomia some (prancha 1 D); volta quando o personagem é liberado.
    if (context.creation && this.activeTab === "anatomy") context.activeTab = this.activeTab = "ficha";

    debugLog(`${SYSTEM_ID} | NihilityActorSheet._prepareContext:`, actor.name);
    return context;
  }

  /** O que a faixa e a aba Origem mostram em modo criação. */
  async #creationContext() {
    const actor = this.actor;
    const progress = await creationProgress(actor);
    const creation = actor.system.creation;
    return {
      ...progress,
      status: creation.status,
      gmNote: creation.gmNote,
      ready: creation.status === "ready",
      adjust: creation.status === "adjust",
      canAct: actor.isOwner,
      picker: originPicker(actor, this.originPick)
    };
  }

  /** "mostrar" os blocos vazios nesta ficha, neste navegador (K3). */
  #showEmptyBlocks() {
    try {
      return localStorage.getItem(`${SYSTEM_ID}.showEmpty.${this.actor.uuid}`) === "1";
    } catch (err) {
      return false;
    }
  }

  /** Linha tracejada de um pedido de Skill: "editar" abre o mesmo editor do pedido. */
  static async #onEditSkillRequest(event, target) {
    event.preventDefault();
    const message = game.messages.get(target.closest("[data-message-id]")?.dataset.messageId);
    if (message) await editSkillRequest(message);
  }

  /** Item da faixa "Criando": leva ao lugar onde aquilo se resolve. */
  static async #onCreationGo(event, target) {
    event.preventDefault();
    const step = target.dataset.step;
    // O conceito fica no cabeçalho durante a criação: só põe o cursor nele.
    if (step === "concept") {
      this.element.querySelector(".creation-concept-input")?.focus();
      return;
    }
    this.activeTab = step === "origin" ? "origin" : "ficha";
    await this.render();
    const anchor = step === "points" ? ".attr-block" : step === "skills" ? ".skills-block" : null;
    if (anchor) this.element.querySelector(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  static async #onCreationReady(event) {
    event.preventDefault();
    await markReady(this.actor);
  }

  static async #onCreationBack(event) {
    event.preventDefault();
    await backToEditing(this.actor);
  }

  static async #onCreationEnter(event) {
    event?.preventDefault?.();
    await enterCreation(this.actor);
  }

  static async #onCreationRelease(event) {
    event?.preventDefault?.();
    await releaseCharacter(this.actor);
  }

  static async #onCreationAdjust(event) {
    event?.preventDefault?.();
    await requestAdjustment(this.actor);
  }

  /** Grade de Espécies: marca o cartão (ainda não aplica). */
  static #onOriginPick(event, target) {
    event.preventDefault();
    const species = target.dataset.species;
    this.originPick = { species, lineage: species === this.actor.system.species ? this.actor.system.lineage : "" };
    this.render();
  }

  static #onOriginPickLineage(event, target) {
    event.preventDefault();
    this.originPick = { species: this.originPick.species ?? this.actor.system.species, lineage: target.dataset.lineage };
    this.render();
  }

  /** "Ficar com…": aplica pela troca de Espécie de sempre (prévia quando já há algo dado). */
  static async #onOriginApply(event) {
    event.preventDefault();
    const picker = originPicker(this.actor, this.originPick);
    if (!picker.canApply) return;
    if (!game.user.isGM && isSpeciesLocked(this.actor.system)) {
      ui.notifications.warn("A Espécie já está definida: só o Mestre pode trocar agora.");
      return;
    }
    const applied = await changeActorSpecies(this.actor, { species: picker.speciesId, lineage: picker.lineageId }, { reason: "change" });
    if (applied) this.originPick = {};
  }

  static async #onQuickSpread(event, target) {
    event.preventDefault();
    await applyQuickSpread(this.actor, target.dataset.spread);
  }

  static #onToggleShowEmpty(event) {
    event.preventDefault();
    try {
      const key = `${SYSTEM_ID}.showEmpty.${this.actor.uuid}`;
      if (localStorage.getItem(key) === "1") localStorage.removeItem(key);
      else localStorage.setItem(key, "1");
    } catch (err) {
      /* armazenamento bloqueado: fica como está */
    }
    this.render();
  }

  /**
   * @override
   * O select de Espécie dispara em "change", não em clique — fora da API de `actions`
   * (clique-only), então é ligado manualmente aqui, a cada render.
   */
  /** Aba Inventário: busca (sem redesenhar, pra não perder o foco), filtro, ordem, contêiner e arrastar. */
  _onRenderInventory() {
    const root = this.element;
    const search = root.querySelector(".inventory-search");
    search?.addEventListener("input", () => {
      const term = search.value.trim().toLowerCase();
      root.querySelectorAll(".inventory-row").forEach(row => {
        row.hidden = Boolean(term) && !row.dataset.name.toLowerCase().includes(term);
      });
    });
    root.querySelector(".inventory-filter")?.addEventListener("change", event => {
      this.inventoryFilter = event.target.value;
      this.render();
    });
    root.querySelector(".inventory-sort")?.addEventListener("change", event => {
      this.inventorySort = event.target.value;
      this.render();
    });
    root.querySelectorAll(".inventory-container-select").forEach(select => {
      select.addEventListener("change", async event => {
        event.stopPropagation();
        const item = this.actor.items.get(select.closest("[data-item-id]")?.dataset.itemId);
        if (item && this.isEditable) await item.update({ "system.containerId": select.value });
      });
    });
    root.querySelectorAll(".inventory-row[draggable]").forEach(row => {
      row.addEventListener("dragstart", event => {
        const item = this.actor.items.get(row.dataset.itemId);
        if (item) event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
      });
    });
  }

  /** Grade de Espécies do modo criação: busca e grupo só escondem cartões (sem redesenhar). */
  _onRenderOriginGrid() {
    const root = this.element.querySelector(".creation-origin");
    if (!root) return;
    let group = "";
    const apply = () => {
      const term = root.querySelector(".co-search")?.value.trim().toLowerCase() ?? "";
      root.querySelectorAll(".co-card").forEach(card => {
        card.hidden = (Boolean(group) && card.dataset.group !== group) || (Boolean(term) && !card.dataset.name.includes(term));
      });
    };
    root.querySelector(".co-search")?.addEventListener("input", apply);
    root.querySelectorAll(".co-group").forEach(chip =>
      chip.addEventListener("click", event => {
        event.preventDefault();
        group = chip.dataset.group;
        root.querySelectorAll(".co-group").forEach(c => c.classList.toggle("on", c === chip));
        apply();
      })
    );
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._onRenderInventory();
    enableHotbarDrag(this.element, this.actor);
    if (!this.isEditable) return;

    this.element.querySelector(".species-select")?.addEventListener("change", this._onSpeciesChange.bind(this));
    this._onRenderOriginGrid();
    this.element.querySelector(".lineage-select")?.addEventListener("change", this._onLineageChange.bind(this));
    // Arrastando um implante: verde onde cabe, vermelho onde não cabe (o motivo aparece na linha).
    this.element.querySelectorAll("[data-part-id]").forEach(row => {
      row.addEventListener("dragenter", () => {
        const dragged = currentDraggedImplant();
        if (!dragged) return;
        const fits = implantFits(dragged, row.dataset.slot);
        row.classList.toggle("drop-ok", fits);
        row.classList.toggle("drop-no", !fits);
        row.dataset.dropHint = fits ? "soltar: instala" : `não cabe: só ${dragged.fitsSlots.join(", ")}`;
      });
      row.addEventListener("dragleave", event => {
        if (!row.contains(event.relatedTarget)) row.classList.remove("drop-ok", "drop-no");
      });
    });
  }

  static async #onRemoveTrait(event, target) {
    event.preventDefault();
    await changeTrait(this.actor, target.dataset.trait, "remove");
  }

  static async #onPickTraits(event) {
    event.preventDefault();
    await pickActorTraits(this.actor);
  }

  static async #onRestoreTrait(event, target) {
    event.preventDefault();
    await changeTrait(this.actor, target.dataset.trait, "restore");
  }

  static #onSelectTab(event, target) {
    event.preventDefault();
    this.activeTab = target.dataset.tab;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Anatomia / Presets de Espécie                */
  /* -------------------------------------------- */

  /**
   * Trocar a Espécie passa pela prévia (species.js): nada é gravado antes de "Aplicar", e Cancelar
   * devolve o seletor ao que era. O jogador só troca até confirmar os primeiros Pontos de Atributo.
   */
  /** Linhagem no cabeçalho (criação / jogador antes de travar): mesma prévia da Espécie. */
  async _onLineageChange(event) {
    event.preventDefault();
    const select = event.currentTarget;
    const lineage = select.value;
    if (lineage === (this.actor.system.lineage || "")) return;
    if (!game.user.isGM && isSpeciesLocked(this.actor.system)) {
      select.value = this.actor.system.lineage || "";
      return;
    }
    const applied = await changeActorSpecies(this.actor, { species: this.actor.system.species, lineage }, { reason: "lineage" });
    if (!applied) select.value = this.actor.system.lineage || "";
  }

  async _onSpeciesChange(event) {
    event.preventDefault();
    const select = event.currentTarget;
    const species = select.value;
    if (species === (this.actor.system.species || "")) return;
    if (!game.user.isGM && isSpeciesLocked(this.actor.system)) {
      ui.notifications.warn("A Espécie já está definida: só o Mestre pode trocar agora.");
      select.value = this.actor.system.species || "";
      return;
    }
    const applied = await changeActorSpecies(this.actor, { species });
    if (!applied) select.value = this.actor.system.species || "";
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

  /**
   * Concede XP ao Personagem ou a uma Skill dele (só Mestre). O XP para no teto do nível atual —
   * ver `deriveExperience` em character-model.js: não existe "800/100", porque acumular além do
   * teto daria níveis já pagos adiantados assim que o Mestre clicasse em subir.
   */
  static async #onGrantXp(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return;

    const skills = this.actor.items.filter(i => i.type === "skill");
    const options = [
      `<option value="actor:">${escapeHtml(this.actor.name)} (Personagem)</option>`,
      ...skills.map(s => `<option value="skill:${s.id}">${escapeHtml(s.name)} — nível ${s.system.level}</option>`)
    ].join("");

    const data = await promptDialog({
      title: "Conceder XP",
      confirmLabel: "Conceder",
      content: `
        <form>
          <div class="form-group"><label>Para</label><select name="alvo">${options}</select></div>
          <div class="form-group"><label>Quantidade</label><input type="number" name="amount" value="50"/></div>
        </form>`,
      onConfirm: form => ({
        alvo: form.querySelector("[name=alvo]").value,
        amount: Number(form.querySelector("[name=amount]").value) || 0
      })
    });
    if (!data || !data.amount) return;

    const [scope, id] = data.alvo.split(":");
    const doc = scope === "skill" ? this.actor.items.get(id) : this.actor;
    if (!doc) return;

    const path = scope === "skill" ? "system.xp" : "system.attributes.xp";
    const current = scope === "skill" ? doc.system.xp : doc.system.attributes.xp;
    const max = scope === "skill" ? doc.system.xpMax : doc.system.attributes.xpMax;
    const next = Math.clamp(current + data.amount, 0, max);

    if (next === current) {
      ui.notifications.info(`${doc.name} já está no teto de XP deste nível (${max}).`);
      return;
    }
    await doc.update({ [path]: next });
  }

  /** Rola a iniciativa deste Ator e lança no rastreador de combate (ver module/combat.js). */
  static async #onToggleDash(event, target) {
    event.preventDefault();
    if (blockIfIncapacitated(this.actor, "correr")) return;
    try {
      await toggleMovementDash(this.actor);
    } catch (err) {
      reportError("Falha ao alternar o Correr.", err);
    }
  }

  static async #onRollInitiative(event, target) {
    event.preventDefault();
    const { cancelled, options } = await rollOptionsFromEvent(event, "Iniciativa");
    if (cancelled) return;
    try {
      await rollInitiativeForActor(this.actor, options);
    } catch (err) {
      reportError("Falha ao rolar iniciativa.", err);
    }
  }

  /** "Descansar…": Curto ou Completo, com prévia (combat/regeneration.js#openRestDialog). */
  static async #onRest(event, target) {
    event.preventDefault();
    const { openRestDialog } = await import("../combat/regeneration.js");
    await openRestDialog(this.actor);
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
    const statusText = result.expired
      ? " (encerrou)."
      : result.ticksRemaining === null
        ? " (até desativar)."
        : ` (${result.ticksRemaining} tick(s) restante(s)).`;
    ui.notifications.info(`${effect.name}: ${result.delta >= 0 ? "+" : ""}${result.delta} ${attrLabel}${reductionText}${result.note ? ` — ${result.note}` : ""}${statusText}`);
  }

  /** Remove uma Condição Ativa antes do prazo (ex: curada por outra Skill/poção). */
  static async #onDeleteCondition(event, target) {
    event.preventDefault();
    const effectId = target.closest("[data-effect-id]")?.dataset.effectId;
    // Maldição e Supressão só saem com Antimagia ou pelo Mestre.
    const effect = this.actor.effects.get(effectId);
    if (!game.user.isGM && (effect?.getFlag(SYSTEM_ID, "curse") || effect?.getFlag(SYSTEM_ID, "suppression") !== undefined)) {
      ui.notifications.warn("Só uma Antimagia de nível suficiente — ou o Mestre — tira isto.");
      return;
    }
    await this.actor.deleteEmbeddedDocuments("ActiveEffect", [effectId]);
  }

  /* -------------------------------------------- */
  /*  Atributos                                    */
  /* -------------------------------------------- */

  static async #onRollAttribute(event, target) {
    event.preventDefault();
    const key = target.closest("[data-attribute]").dataset.attribute;
    const attr = this.actor.system.attributes.combat[key];
    const { cancelled, options } = await rollOptionsFromEvent(event, `Rolar ${getAttributeLabel(key)}`);
    if (cancelled) return;
    // Bônus de Item/Modificação nunca entra no Pool de d20 — soma por fora, como número fixo.
    await rollAttribute(this.actor, key, { extraFlat: attr?.itemBonus ?? 0, rollOptions: options });
  }

  /* -------------------------------------------- */
  /*  Alocação de Pontos de Atributo (pendente → Confirmar/Resetar)  */
  /* -------------------------------------------- */

  /** +1 pendente no atributo — só se sobrar Pool livre (confirmado + pendente de TODOS os atributos). */
  static async #onIncrementAttributePoint(event, target) {
    event.preventDefault();
    if (!isAttributePoolEnabled()) return;
    const key = target.closest("[data-attribute]").dataset.attribute;
    if (this.actor.system.attributePointsPool.remaining <= 0) return;
    const current = this.actor.system.attributes.combat[key].pendingPoints ?? 0;
    await this.actor.update({ [`system.attributes.combat.${key}.pendingPoints`]: current + 1 });
  }

  /** -1 pendente no atributo — nunca mexe em `points` já confirmado, só no que ainda não foi salvo. */
  static async #onDecrementAttributePoint(event, target) {
    event.preventDefault();
    const key = target.closest("[data-attribute]").dataset.attribute;
    const current = this.actor.system.attributes.combat[key].pendingPoints ?? 0;
    if (current <= 0) return;
    await this.actor.update({ [`system.attributes.combat.${key}.pendingPoints`]: current - 1 });
  }

  /** Move todo `pendingPoints` pendente pra `points` de verdade (num update só) e zera o pendente. */
  static async #onConfirmAttributePoints(event, target) {
    event.preventDefault();
    const combat = this.actor.system.attributes.combat;
    const updates = {};
    for (const key of MEU_SISTEMA.COMBAT_ATTRIBUTES) {
      const pending = combat[key].pendingPoints ?? 0;
      if (!pending) continue;
      updates[`system.attributes.combat.${key}.points`] = combat[key].points + pending;
      updates[`system.attributes.combat.${key}.pendingPoints`] = 0;
    }
    if (!Object.keys(updates).length) return;
    // O primeiro "Confirmar" trava a Espécie para o jogador (só o Mestre troca depois).
    updates["system.speciesState.lockedAt"] = this.actor.system.speciesState?.lockedAt ?? Date.now();
    updates["system.speciesState.unlocked"] = false;
    await this.actor.update(updates);
  }

  /** Descarta todo `pendingPoints` (volta pro último estado confirmado) — nunca toca em `points`. */
  static async #onResetAttributePoints(event, target) {
    event.preventDefault();
    const combat = this.actor.system.attributes.combat;
    const updates = {};
    for (const key of MEU_SISTEMA.COMBAT_ATTRIBUTES) {
      if (combat[key].pendingPoints) updates[`system.attributes.combat.${key}.pendingPoints`] = 0;
    }
    if (Object.keys(updates).length) await this.actor.update(updates);
  }

  /**
   * Só Mestre: zera TODOS os pontos de atributo do Personagem — confirmados E pendentes — de volta
   * pro Pool livre, pra o jogador realocar do zero (ex.: distribuiu errado e não tem como desfazer,
   * já que "Resetar" comum só descarta o que ainda não foi confirmado). Nada além de `points`/
   * `pendingPoints` é tocado: Nível, Título, Skills e Itens ficam como estão, então o Pool total
   * devolvido é exatamente o que o Mestre concede pelo nível atual. Só faz sentido com o Pool ligado
   * — sem ele os pontos são digitados à mão e o Mestre já edita o número direto.
   */
  static async #onGmResetAllAttributePoints(event, target) {
    event.preventDefault();
    if (!game.user.isGM || !isAttributePoolEnabled()) return;

    const combat = this.actor.system.attributes.combat;
    const refunded = MEU_SISTEMA.COMBAT_ATTRIBUTES.reduce(
      (sum, key) => sum + (combat[key].points ?? 0) + (combat[key].pendingPoints ?? 0),
      0
    );
    if (!refunded) {
      ui.notifications.info(`${this.actor.name} não tem pontos de atributo alocados.`);
      return;
    }

    const confirmed = await DialogV2.confirm({
      window: { title: "Zerar Pontos de Atributo" },
      content: `<p>Zerar os <strong>${refunded}</strong> pontos de atributo alocados por <strong>${escapeHtml(this.actor.name)}</strong>? Todos voltam pro Pool livre pra serem distribuídos de novo. Nível, Títulos, Habilidades e Itens não mudam.</p>`
    });
    if (!confirmed) return;

    const updates = {};
    for (const key of MEU_SISTEMA.COMBAT_ATTRIBUTES) {
      updates[`system.attributes.combat.${key}.points`] = 0;
      updates[`system.attributes.combat.${key}.pendingPoints`] = 0;
    }
    await this.actor.update(updates);

    await announceVoiceOfTheWorld(this.actor, {
      kind: "attribute-reset",
      title: "Pontos de Atributo devolvidos",
      body: `O Mestre devolveu ${refunded} ponto(s) de atributo de ${this.actor.name} ao Pool — distribua-os de novo.`
    });
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
      reportError("Falha ao quebrar Pontos de Habilidade.", err);
    }
  }

  static async #onMergeSkillPoints(event, target) {
    event.preventDefault();
    const tier = target.closest("[data-tier]").dataset.tier;
    try {
      await mergeSkillPoints(this.actor, tier);
    } catch (err) {
      reportError("Falha ao fundir Pontos de Habilidade.", err);
    }
  }

  /** Mestre dá (+1) ou tira (−1) um Ponto de Habilidade do tier, sem passar pela economia de quebra/fusão. */
  static async #onAdjustSkillPoints(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return;
    const tier = target.closest("[data-tier]").dataset.tier;
    const delta = Number(target.dataset.delta) || 0;
    const current = this.actor.system.skillPoints[tier] ?? 0;
    await this.actor.update({ [`system.skillPoints.${tier}`]: Math.max(0, current + delta) });
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
      reportError("Falha ao pedir criação de skill.", err);
    }
  }

  /**
   * O pedido é montado no editor de Skill de sempre (J10, prancha 3 B): Modelo, Compêndio ou
   * "Só descrever", custo sugerido e avisos. Antes era só Tier, nome, texto e custo, e a Skill
   * aprovada nascia sem mecânica.
   */
  async _promptSkillRequest() {
    return openSkillRequestEditor(this.actor);
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
      reportError("Falha ao converter moeda.", err);
    }
  }

  async _promptCurrencyConversion() {
    const currencies = getActiveCurrencies();
    const opts = currencies.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join("");
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

    const toActor = data.toActorUuid ? fromUuidSync(data.toActorUuid) : null;
    if (!toActor) {
      ui.notifications.warn("Destinatário inválido.");
      return;
    }

    try {
      await transferCurrency(this.actor, toActor, data.currencyId, data.amount);
      ui.notifications.info(`Enviado ${data.amount} para ${toActor.name}.`);
    } catch (err) {
      reportError("Falha ao enviar moeda.", err);
    }
  }

  async _promptCurrencyTransfer() {
    const currencies = getActiveCurrencies();
    const currencyOpts = currencies.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join("");
    // Só Personagens na mesma cena — Nave/Veículo não tem conceito de moeda própria, e listar
    // o mundo inteiro (em vez de só quem está na cena) deixava mandar dinheiro pra qualquer um.
    const recipients = sceneActorCandidates({ types: ["character"], exclude: this.actor });
    const recipientOpts = recipients.map(a => `<option value="${a.uuid}">${escapeHtml(actorDisplayName(a))}</option>`).join("");

    if (!recipients.length) {
      ui.notifications.warn("Nenhum outro Personagem na cena atual pra receber a transferência.");
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
        toActorUuid: form.querySelector("[name=toActorId]").value,
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
    // Título e Item só o Mestre cria (o botão some da ficha do jogador; isto fecha a porta dos fundos).
    if ((type === "title" || type === "item") && !game.user.isGM) return;

    // Skill: só Nome e Tier numa janelinha, e a mecânica é editada na própria ficha de Item (o
    // redesenho aprovado, com Geral · Mecânica · Passivos). O modal grande de antes duplicava a
    // ficha, era o editor menos completo e não seguia o desenho. O registro no Compêndio espera a
    // ficha fechar, para guardar a Skill já preenchida, e não uma vazia.
    if (type === "skill") {
      const hasUltimate = this.actor.system.hasUltimateSkill;
      const ultimateVisible = hasUltimate || game.user.isGM;
      const tierChoices = MEU_SISTEMA.SKILL_TIERS.filter(t => t !== "racial" && (t !== "ultimate" || ultimateVisible));
      const picked = await promptNewSkill(tierChoices);
      if (!picked) return;
      // Modelo escolhido: a Skill já nasce montada (o nome digitado e o Tier valem por cima).
      const fromTemplate = picked.template ? skillFromTemplate(picked.template, { name: picked.name, tier: picked.tier }) : null;
      const { name: templateName, ...templateSystem } = fromTemplate ?? {};
      const [created] = await this.actor.createEmbeddedDocuments("Item", [
        { name: picked.name || templateName || "Nova Habilidade", type: "skill", system: fromTemplate ? { ...templateSystem, tier: picked.tier, level: 1 } : { tier: picked.tier, level: 1 } }
      ]);
      const sheet = created.sheet;
      const hookId = Hooks.on("closeApplicationV2", async app => {
        if (app !== sheet) return;
        Hooks.off("closeApplicationV2", hookId);
        const current = this.actor.items.get(created.id);
        if (current) await registerItemInCompendium(current.toObject());
      });
      sheet.render(true);
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
    // Só Mestre: o botão some da ficha do jogador; isto fecha a porta dos fundos.
    if (!game.user.isGM) return;
    const itemId = target.closest(".item-row").dataset.itemId;

    const hasUltimate = this.actor.system.hasUltimateSkill;
    const ultimateVisible = hasUltimate || game.user.isGM;
    const tierChoices = MEU_SISTEMA.SKILL_TIERS.filter(t => t !== "racial" && (t !== "ultimate" || ultimateVisible));

    const data = await openSkillEditorDialog({}, { tierChoices, levelReadonly: !game.user.isGM });
    if (!data) return;

    try {
      await evolveSkill(this.actor, itemId, data);
    } catch (err) {
      reportError("Falha ao Evoluir habilidade.", err);
    }
  }

  /* -------------------------------------------- */
  /*  Usar Habilidade (dano / efeito temporário)   */
  /* -------------------------------------------- */

  static async #onUseSkill(event, target) {
    event.preventDefault();
    await this.useSkillItem(target.closest(".item-row").dataset.itemId, event);
  }

  /**
   * O corpo do botão "Usar", público para a macro da hotbar (`core/hotbar.js`) seguir exatamente o
   * mesmo caminho. `event` só serve para o Shift (modificadores de rolagem): a macro passa `{shiftKey}`.
   */
  async useSkillItem(itemId, event = null) {
    await useSkillFlow(this.actor, itemId, { event, pickTarget: () => this._promptSkillTarget() });
  }

  /**
   * "Atacar" numa Arma (Item Geral com `system.weapon.enabled`). Sempre pede alvo, igual uma
   * Skill de dano: mesmo golpe puramente físico precisa de alguém pra Resistência checar.
   *
   * Só arma EQUIPADA ataca — mesma regra que já vale pra `attributeBonuses`/`statModifiers`/
   * `grantsSkill` de um Item Geral (só contam "enquanto equipado"). O botão já some da ficha
   * pra item desequipado; este `if` é a segunda checagem, pro caso do botão ter ficado no DOM
   * de um render anterior enquanto o campo mudava.
   */
  static async #onAttackWithWeapon(event, target) {
    event.preventDefault();
    await this.attackWithWeaponItem(target.closest(".item-row").dataset.itemId, event);
  }

  /** "Usar" num consumível do inventário (granada, poção, kit). Ver economy/consumables.js. */
  static async #onUseConsumable(event, target) {
    event.preventDefault();
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (item) await useConsumable(this.actor, item, event);
  }

  /** "Recarregar" uma arma com carregador: gasta 1 munição compatível do inventário. */
  static async #onReloadWeapon(event, target) {
    event.preventDefault();
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (item) await reloadWeapon(this.actor, item);
  }

  /** O corpo do botão "Atacar", público para a macro da hotbar (ver `useSkillItem`). */
  async attackWithWeaponItem(itemId, event = null) {
    const weapon = this.actor.items.get(itemId);
    if (!weapon?.system.weapon?.enabled) return;
    if (!weapon.system.equipped) {
      ui.notifications.warn(`${weapon.name} precisa estar equipada pra atacar.`);
      return;
    }

    try {
      if (!weapon.system.weapon.damageFormula?.trim()) {
        ui.notifications.warn(`${weapon.name} não tem uma Fórmula de Dano configurada.`);
        return;
      }
      if (blockIfIncapacitated(this.actor, "atacar")) return;
      // Carregador vazio: avisa antes de pedir alvo (o Recarregar fica na linha da arma).
      if (!weaponCanFire(weapon)) return;
      const { cancelled, options } = await rollOptionsFromEvent(event, `Atacar com ${weapon.name}`);
      if (cancelled) return;
      const targetActor = await pickTargetActor({ self: this.actor, title: `Atacar com ${weapon.name}`, confirmLabel: "Atacar", preferMap: true });
      if (!targetActor) return;
      await useWeaponAttack(this.actor, weapon, targetActor, options);
    } catch (err) {
      reportError("Falha ao atacar com arma.", err);
    }
  }

  /**
   * Escolhe o alvo de uma Habilidade. Toda a lógica (alvo já marcado no mapa, grupos, busca no
   * diretório) mora em helpers/target-picker.js, compartilhada com a ficha de Nave.
   */
  async _promptSkillTarget() {
    return pickTargetActor({ self: this.actor, title: "Escolher Alvo", confirmLabel: "Usar Habilidade", preferMap: true });
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
      reportError("Falha ao fundir habilidades.", err);
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
