import { SYSTEM_ID, isPadShipEnabled, isPadLibraryEnabled, isPadMessagingEnabled } from "../config.js";
import { findCrewedShipsForActor } from "../pad/pad-crew.js";
import {
  getPersonalLibrary,
  addPersonalLibraryEntry,
  removePersonalLibraryEntry,
  getShipLibrary,
  addShipLibraryEntry,
  removeShipLibraryEntry,
  resolveLibraryEntries
} from "../pad/pad-library.js";
import {
  directThreadId,
  sendDirectMessage,
  sendGroupMessage,
  getThreadMessages,
  getRecentThreadsFor,
  getContactsFor,
  getGroup,
  createGroup,
  shareContactWithScene,
  addSavedContact,
  getPendingContactShares
} from "../pad/pad-messaging.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Percentual (0-100) usado nas barras de Casco/Escudo — mesma função local de actor-sheet.js/starship-sheet.js (duplicada de propósito, ver comentário equivalente nesses arquivos). */
function percentOf(value, max) {
  if (!max) return 0;
  return Math.round(Math.clamp((value / max) * 100, 0, 100));
}

function initialsOf(name) {
  return (name || "?").replace(/["().,]/g, "").split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

function personaEntry(actor, group) {
  return { uuid: actor.uuid, name: actor.name, img: actor.img, group, searchName: actor.name.toLowerCase() };
}

/**
 * PAD (celular in-game). Vinculado a um Personagem (`options.actor`) — normalmente o Ator a
 * partir de cuja ficha o botão "Abrir PAD" foi clicado (ver actor-sheet.js), mas o Mestre pode
 * trocar de persona livremente pelo seletor "Falando como" na tela de Mensagens (`this.actor` é
 * reatribuído; como toda tela lê de `this.actor`, o app inteiro passa a refletir a persona
 * escolhida — Nave/Biblioteca incluídos, não só Mensagens). Home mostra só os ícones das
 * sub-funcionalidades ligadas em Settings (`isPadShipEnabled`/`isPadLibraryEnabled`/
 * `isPadMessagingEnabled`).
 */
export class NihilityPadApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    // `id` fixo faria dois PADs abertos ao mesmo tempo (ex: um pra cada tripulante, ou o Mestre
    // abrindo o de um NPC enquanto o de um jogador já está aberto) brigarem pelo MESMO elemento
    // na tela — um sobrescreve o título/conteúdo do outro no meio do render. Um id por Ator
    // (ver `getPadAppForActor` abaixo) faz reabrir o PAD do mesmo Ator focar a janela já aberta,
    // em vez de duplicar.
    options.id ??= `nihility-pad-${options.actor?.id ?? foundry.utils.randomID()}`;
    super(options);
    this.actor = options.actor;
    this.activeScreen = "home"; // "home" | "nave" | "biblioteca" | "mensagens"
    this.selectedShipId = null; // usado só quando o Personagem tripula mais de uma Nave/Veículo
    this.shipMenuOpen = false;
    this.libraryTab = "pessoal"; // "pessoal" | "nave"
    this.activeThread = null; // null | {type:"direct", actorUuid} | {type:"group", groupId}
    this.newGroupMode = false;
  }

  static DEFAULT_OPTIONS = {
    window: { title: "PAD", resizable: false, minimizable: true },
    classes: [SYSTEM_ID, "nihility-pad-app"],
    position: { width: 380, height: 680 },
    actions: {
      openApp: NihilityPadApp.#onOpenApp,
      goBack: NihilityPadApp.#onGoBack,
      toggleShipMenu: NihilityPadApp.#onToggleShipMenu,
      selectShip: NihilityPadApp.#onSelectShip,
      openShipSheet: NihilityPadApp.#onOpenShipSheet,
      selectLibraryTab: NihilityPadApp.#onSelectLibraryTab,
      removeLibraryEntry: NihilityPadApp.#onRemoveLibraryEntry,
      openLibraryEntry: NihilityPadApp.#onOpenLibraryEntry,
      openThread: NihilityPadApp.#onOpenThread,
      sendMessage: NihilityPadApp.#onSendMessage,
      toggleNewGroup: NihilityPadApp.#onToggleNewGroup,
      createGroup: NihilityPadApp.#onCreateGroup,
      togglePersonaPicker: NihilityPadApp.#onTogglePersonaPicker,
      selectPersona: NihilityPadApp.#onSelectPersona,
      shareContact: NihilityPadApp.#onShareContact,
      addPendingContact: NihilityPadApp.#onAddPendingContact
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/nihility-pad.hbs`, scrollable: [".pad-content"] }
  };

  /** @override — só o nome do Ator, sem prefixo cru. */
  get title() {
    return `PAD — ${this.actor?.name ?? ""}`;
  }

  static #onOpenApp(event, target) {
    event.preventDefault();
    this.activeScreen = target.dataset.pad;
    this.render();
  }

  /** Botão "‹" do topo: primeiro fecha uma conversa aberta (volta pra lista de Mensagens), só depois volta pra Home. */
  static #onGoBack(event, target) {
    event.preventDefault();
    if (this.activeScreen === "mensagens" && this.activeThread) {
      this.activeThread = null;
    } else {
      this.activeScreen = "home";
      this.shipMenuOpen = false;
      this.activeThread = null;
      this.newGroupMode = false;
    }
    this.render();
  }

  static #onToggleShipMenu(event, target) {
    event.preventDefault();
    this.shipMenuOpen = !this.shipMenuOpen;
    this.render();
  }

  static #onSelectShip(event, target) {
    event.preventDefault();
    this.selectedShipId = target.dataset.shipId;
    this.shipMenuOpen = false;
    this.render();
  }

  static #onOpenShipSheet(event, target) {
    event.preventDefault();
    game.actors.get(this.selectedShipId)?.sheet.render(true);
  }

  static #onSelectLibraryTab(event, target) {
    event.preventDefault();
    this.libraryTab = target.dataset.libTab;
    this.render();
  }

  static async #onRemoveLibraryEntry(event, target) {
    event.preventDefault();
    const entryId = target.dataset.entryId;
    if (target.dataset.libTab === "nave") {
      const ship = game.actors.get(this.selectedShipId);
      if (ship) await removeShipLibraryEntry(ship, entryId);
    } else {
      await removePersonalLibraryEntry(this.actor, entryId);
    }
    this.render();
  }

  /** Abre o documento referenciado por uma entrada da Biblioteca (Item/JournalEntry/Actor/etc.). */
  static #onOpenLibraryEntry(event, target) {
    event.preventDefault();
    fromUuidSync(target.dataset.uuid)?.sheet?.render(true);
  }

  /** Recebe um Item/JournalEntry/Actor arrastado da barra lateral/ficha como novo favorito da Biblioteca (pessoal ou da Nave, conforme a aba ativa no momento do drop). */
  async _onDropLibraryEntry(event) {
    event.preventDefault();
    let data;
    try {
      data = TextEditor.getDragEventData(event);
    } catch (err) {
      return;
    }
    if (!data?.uuid) return;

    const doc = await fromUuid(data.uuid);
    if (!doc) return;

    const payload = { uuid: doc.uuid, label: doc.name };
    if (this.libraryTab === "nave") {
      const ship = game.actors.get(this.selectedShipId);
      if (!ship) return;
      await addShipLibraryEntry(ship, payload);
    } else {
      await addPersonalLibraryEntry(this.actor, payload);
    }
    this.render();
  }

  /** Abre uma conversa — direta (clicando num contato ou numa thread já existente) ou de grupo. */
  static #onOpenThread(event, target) {
    event.preventDefault();
    const type = target.dataset.threadType;
    this.activeThread = type === "group"
      ? { type: "group", groupId: target.dataset.groupId }
      : { type: "direct", actorUuid: target.dataset.actorUuid };
    this.render();
  }

  static async #onSendMessage(event, target) {
    event.preventDefault();
    const input = this.element.querySelector(".pad-compose-input");
    const body = input?.value.trim();
    if (!body || !this.activeThread) return;
    input.value = "";

    if (this.activeThread.type === "group") {
      await sendGroupMessage(this.actor, this.activeThread.groupId, body);
    } else {
      const recipient = fromUuidSync(this.activeThread.actorUuid);
      if (recipient) await sendDirectMessage(this.actor, recipient, body);
    }
    this.render();
  }

  static #onToggleNewGroup(event, target) {
    event.preventDefault();
    this.newGroupMode = !this.newGroupMode;
    this.render();
  }

  static async #onCreateGroup(event, target) {
    event.preventDefault();
    const name = this.element.querySelector(".pad-new-group-name")?.value.trim();
    if (!name) {
      ui.notifications.warn("Dê um nome ao grupo.");
      return;
    }
    const memberActorUuids = Array.from(this.element.querySelectorAll(".pad-new-group-check:checked")).map(el => el.value);
    if (!memberActorUuids.length) {
      ui.notifications.warn("Selecione ao menos um membro pro grupo.");
      return;
    }

    const group = await createGroup({ name, memberActorUuids, creatorActor: this.actor });
    this.newGroupMode = false;
    if (group) this.activeThread = { type: "group", groupId: group.groupId };
    this.render();
  }

  /** Compartilha o contato da persona atual com todo Personagem que tiver Token na cena atual. */
  static async #onShareContact(event, target) {
    event.preventDefault();
    // shareContactWithScene já avisa sozinho (ui.notifications.warn) quando não há ninguém na
    // cena pra compartilhar — só confirma sucesso aqui se ela realmente enviou algo.
    const shared = await shareContactWithScene(this.actor);
    if (shared) ui.notifications.info(`Contato de ${this.actor.name} compartilhado com a cena.`);
  }

  /** Adiciona um contato pendente (compartilhado por outro Personagem) à lista salva desta persona. */
  static async #onAddPendingContact(event, target) {
    event.preventDefault();
    await addSavedContact(this.actor, target.dataset.actorUuid);
    this.render();
  }

  /** Só Mestre: abre/fecha o painel de busca de personagem/NPC pra "falar como". Manipula o DOM direto (sem re-render) pra não perder o foco do campo de busca. */
  static #onTogglePersonaPicker(event, target) {
    event.preventDefault();
    this.element.querySelector(".pad-persona-picker")?.classList.toggle("hidden");
  }

  static #onSelectPersona(event, target) {
    event.preventDefault();
    const actor = fromUuidSync(target.dataset.actorUuid);
    if (!actor) return;
    this.actor = actor;
    this.activeThread = null;
    this.render();
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;

    context.actor = actor;
    context.activeScreen = this.activeScreen;
    context.padShipEnabled = isPadShipEnabled();
    context.padLibraryEnabled = isPadLibraryEnabled();
    context.padMessagingEnabled = isPadMessagingEnabled();

    const crewedShips = context.padShipEnabled ? findCrewedShipsForActor(actor) : [];
    context.crewedShips = crewedShips;
    context.hasMultipleShips = crewedShips.length > 1;
    context.shipMenuOpen = this.shipMenuOpen;

    if (crewedShips.length && !crewedShips.some(s => s.id === this.selectedShipId)) {
      this.selectedShipId = crewedShips[0].id;
    }
    const selectedShip = crewedShips.find(s => s.id === this.selectedShipId) ?? null;
    context.selectedShip = selectedShip;

    if (selectedShip) {
      const sys = selectedShip.system;
      context.shipIsVehicle = selectedShip.type === "vehicle";
      context.shipCascoPercent = percentOf(sys.casco.value, sys.casco.max);
      context.shipShieldPercent = percentOf(sys.shields.value, sys.shields.max);
      context.shipReactorOutput = sys.powerGrid.reactorOutput;
      context.shipConsumption = sys.totalConsumption;
      context.shipDeficit = sys.totalConsumption > sys.powerGrid.reactorOutput;
      context.shipModules = selectedShip.items.filter(i => i.type === "starship_module");
      context.shipCrew = sys.crewActors;
      context.canViewShipSheet = selectedShip.testUserPermission(game.user, "OBSERVER");
    }

    if (context.padLibraryEnabled) {
      // Se a Nave selecionada mudou (ou deixou de existir) enquanto a aba "Da Nave" estava
      // ativa, volta pra Pessoal em vez de mostrar uma aba vazia/quebrada.
      if (this.libraryTab === "nave" && !selectedShip) this.libraryTab = "pessoal";
      context.libraryTab = this.libraryTab;
      context.personalLibrary = resolveLibraryEntries(getPersonalLibrary(actor));
      if (selectedShip) context.shipLibrary = resolveLibraryEntries(await getShipLibrary(selectedShip));
    }

    if (context.padMessagingEnabled) {
      context.isGM = game.user.isGM;
      if (context.isGM) {
        context.personaPcs = game.actors
          .filter(a => a.type === "character" && a.system.isPlayerCharacter === true)
          .map(a => personaEntry(a, "pc"))
          .sort((a, b) => a.name.localeCompare(b.name));
        context.personaNpcs = game.actors
          .filter(a => a.type === "character" && a.system.isPlayerCharacter === false)
          .map(a => personaEntry(a, "npc"))
          .sort((a, b) => a.name.localeCompare(b.name));
      }

      context.contacts = getContactsFor(actor, { includeNpcs: context.isGM }).map(a => ({ uuid: a.uuid, name: a.name, initials: initialsOf(a.name) }));
      context.pendingContactShares = getPendingContactShares(actor).map(s => ({ ...s, avatarInitials: initialsOf(s.senderName) }));

      const rawThreads = await getRecentThreadsFor(actor);
      context.threads = rawThreads.map(t => t.conversationType === "group"
        ? {
          threadId: t.threadId, conversationType: "group", groupId: t.groupId,
          title: t.groupName, avatarInitials: initialsOf(t.groupName),
          preview: t.lastMessage ? `${t.lastMessage.senderName}: ${t.lastMessage.body}` : "Nenhuma mensagem ainda"
        }
        : {
          threadId: t.threadId, conversationType: "direct", otherActorUuid: t.otherActorUuid,
          title: fromUuidSync(t.otherActorUuid)?.name ?? "Desconhecido",
          avatarInitials: initialsOf(fromUuidSync(t.otherActorUuid)?.name),
          preview: t.lastMessage?.body ?? ""
        });

      context.newGroupMode = this.newGroupMode;
      context.activeThread = this.activeThread;

      if (this.activeThread) {
        if (this.activeThread.type === "group") {
          const group = await getGroup(this.activeThread.groupId);
          context.threadId = this.activeThread.groupId;
          context.threadTitle = group?.groupName ?? "Grupo";
          context.threadConversationType = "group";
        } else {
          const other = fromUuidSync(this.activeThread.actorUuid);
          context.threadId = directThreadId(actor.uuid, this.activeThread.actorUuid);
          context.threadTitle = other?.name ?? "Conversa";
          context.threadConversationType = "direct";
        }
        context.threadMessages = getThreadMessages(context.threadId);
      }
    }

    return context;
  }

  /** @override — atualização ao vivo enquanto o PAD estiver aberto (Ator vinculado ou Nave selecionada mudaram). */
  _onRender(context, options) {
    super._onRender(context, options);

    const libDropzone = this.element.querySelector(".pad-lib-dropzone");
    if (libDropzone) {
      libDropzone.addEventListener("dragover", event => event.preventDefault());
      libDropzone.addEventListener("drop", this._onDropLibraryEntry.bind(this));
    }

    // Busca do seletor de persona (só Mestre): filtra as linhas já renderizadas via DOM puro,
    // sem re-render a cada tecla — um this.render() no meio de digitar perderia o foco do campo.
    const personaSearch = this.element.querySelector(".pad-persona-search");
    if (personaSearch) {
      personaSearch.addEventListener("input", () => {
        const query = personaSearch.value.trim().toLowerCase();
        this.element.querySelectorAll(".pad-persona-row").forEach(row => {
          row.hidden = query.length > 0 && !row.dataset.search.includes(query);
        });
      });
    }

    // Rola pro final da conversa aberta.
    const bubbles = this.element.querySelector(".pad-bubbles");
    if (bubbles) bubbles.scrollTop = bubbles.scrollHeight;

    if (this._updateHook) return;
    this._updateHook = actor => {
      if (actor.id === this.actor.id || actor.id === this.selectedShipId) this.render();
    };
    Hooks.on("updateActor", this._updateHook);

    // Mensagem nova envolvendo o Ator atual (ou a persona ativa, se o Mestre trocou) — atualiza
    // a lista de conversas/a conversa aberta em tempo real, sem precisar reabrir o PAD.
    this._messageHook = message => {
      const pm = message.getFlag(SYSTEM_ID, "padMessage");
      const share = message.getFlag(SYSTEM_ID, "padContactShare");
      const involvesActor = (pm && (pm.senderActorUuid === this.actor.uuid || pm.recipientActorUuids.includes(this.actor.uuid)))
        || (share && share.recipientActorUuids.includes(this.actor.uuid));
      if (involvesActor) this.render();
    };
    Hooks.on("createChatMessage", this._messageHook);
  }

  /** @override */
  async close(options) {
    if (this._updateHook) {
      Hooks.off("updateActor", this._updateHook);
      this._updateHook = null;
    }
    if (this._messageHook) {
      Hooks.off("createChatMessage", this._messageHook);
      this._messageHook = null;
    }
    return super.close(options);
  }
}
