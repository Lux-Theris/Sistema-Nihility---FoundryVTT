/**
 * Janela "Grupo de abordagem" (F2): quem do outro lado está a bordo desta nave, os Módulos dela como o Escanear mostrou
 * e as ações Sabotar / Desligar / Hackear. Modo sem mapa: vale com ou sem Região "A bordo" (com uma sala de Módulo, o
 * painel age sobre ele sem perguntar). Só lê e pede; quem escreve é o Mestre, pelo relay (`boardingGroup`,
 * `boardingAction`, em starship/boarding.js).
 */
import { SYSTEM_ID, getSensorTuning } from "../core/config.js";
import { isShipLike } from "../starship/ship-damage.js";
import { askBoarding, boarderRegionFields } from "../starship/boarding.js";
import { actionAllowed, moduleReadRows, roomLabel, seededRng, BOARDING_ACTIONS } from "../starship/boarding-rules.js";
import { scanQuality, scanMaxStep } from "../starship/sensor-rules.js";
import { shipSensorInfo, scanRealData, targetScanBlock } from "../starship/sensors.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const appId = actor => `nihility-boarding-${actor.uuid.replace(/[^a-zA-Z0-9]/g, "-")}`;

/** O estado do Módulo no texto da leitura (`online`/`damaged`…). */
const stateOf = row => row.state;

export class BoardingGroupApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #actorUuid = "";
  #moduleId = "";
  #roomApplied = "";
  #hookIds = [];

  constructor(host, options = {}) {
    super({ id: appId(host), ...options });
    this.host = host;
  }

  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "nihility-config-app", "nihility-boarding-app"],
    window: { title: "Grupo de abordagem", resizable: true, icon: "fa-solid fa-door-open" },
    position: { width: 640, height: 620 },
    actions: {
      selectBoarder: BoardingGroupApp.#onSelectBoarder,
      selectModule: BoardingGroupApp.#onSelectModule,
      boardingSabotage: BoardingGroupApp.#onAct,
      boardingDisable: BoardingGroupApp.#onAct,
      boardingHack: BoardingGroupApp.#onAct,
      leaveGroup: BoardingGroupApp.#onLeave,
      addBoarder: BoardingGroupApp.#onAdd
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/boarding-group.hbs`, scrollable: [".boarding-body"] }
  };

  /** Abre (ou traz para a frente) a janela da nave abordada. */
  static async open(hostOrUuid) {
    const host = typeof hostOrUuid === "string" ? await fromUuid(hostOrUuid).catch(() => null) : hostOrUuid;
    if (!host || !isShipLike(host)) return null;
    const existing = foundry.applications.instances?.get(appId(host));
    if (existing) {
      existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    return new BoardingGroupApp(host).render({ force: true });
  }

  get title() {
    return `Grupo de abordagem — ${this.host.name}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const host = this.host;
    const isGM = game.user.isGM;
    const boarders = (host.system.boarders ?? []).map(entry => ({ entry, actor: fromUuidSync(entry.actorUuid) })).filter(row => row.actor);
    const mine = boarders.filter(row => isGM || row.actor.isOwner);
    if (!this.#actorUuid || !mine.some(row => row.actor.uuid === this.#actorUuid)) this.#actorUuid = mine[0]?.actor.uuid ?? "";
    const acting = boarders.find(row => row.actor.uuid === this.#actorUuid) ?? null;

    // Os Módulos como o Escanear mostrou: a Resolução é a do sensor da nave de onde o grupo veio (o Mestre vê tudo limpo).
    const modules = host.system.modules ?? [];
    const real = scanRealData(host).modules.map((m, i) => ({ ...m, id: modules[i]?.id ?? "" }));
    let quality = "blocked";
    let reached = false;
    let readNote = "";
    if (isGM) {
      quality = "clean";
      reached = true;
      readNote = "Você é o Mestre: os números são os reais.";
    } else {
      const from = fromUuidSync(host.system.dock?.withUuid ?? acting?.entry.fromUuid ?? "");
      const token = from ? from.getActiveTokens?.()?.[0]?.document ?? null : null;
      const info = from ? shipSensorInfo(from, token) : { has: false, resolution: 0, mode: "active" };
      const block = targetScanBlock(host);
      const q = scanQuality(info.has ? info.resolution : 0, block.value, getSensorTuning());
      quality = q.quality;
      reached = scanMaxStep(quality, info.mode === "passive") >= 3;
      readNote = info.has ? "" : "Sem sensor na nave de origem: a leitura é a de quem está lá dentro.";
    }
    const rng = seededRng(`${host.uuid}:${game.combat?.round ?? 0}`);
    const rows = moduleReadRows(real.map(r => ({ id: r.id, name: r.name, state: stateOf(r), hpPercent: r.hpPercent })), { quality, reachedStep3: reached }, rng);

    // O Módulo da sala de quem age vem selecionado sem perguntar.
    const roomId = acting?.entry.moduleId ?? "";
    const roomKey = `${acting?.actor.uuid ?? ""}:${roomId}`;
    if (roomId && modules.some(m => m.id === roomId) && this.#roomApplied !== roomKey) {
      this.#moduleId = roomId;
      this.#roomApplied = roomKey;
    }
    if (!this.#moduleId || !modules.some(m => m.id === this.#moduleId)) this.#moduleId = rows[0]?.id ?? "";
    const selected = modules.find(m => m.id === this.#moduleId) ?? null;
    const selectedRow = rows.find(r => r.id === this.#moduleId) ?? null;

    const region = acting ? boarderRegionFields(acting.entry) : null;
    const perm = action => actionAllowed(action, region);
    const sabotage = perm("sabotage");
    const disable = perm("disable");
    const hack = perm("hack");

    // Quem pode entrar no grupo: o Mestre escolhe qualquer personagem; o jogador, quem da tripulação da nave acoplada ele possui.
    const inGroup = new Set(boarders.map(r => r.actor.uuid));
    const partner = host.system.dock?.withUuid ? fromUuidSync(host.system.dock.withUuid) : null;
    const candidates = (isGM ? game.actors.filter(a => a.type === "character") : (partner?.system?.crewActors ?? []).map(c => c.actor).filter(a => a?.isOwner))
      .filter(a => a && a.type === "character" && !inGroup.has(a.uuid));

    return Object.assign(context, {
      host,
      hostName: host.name,
      entryText: this.#entryText(),
      boarders: boarders.map(row => ({
        uuid: row.actor.uuid,
        name: row.actor.name,
        img: row.actor.img,
        room: roomLabel(row.entry.moduleId, host.items.get(row.entry.moduleId)?.name ?? ""),
        source: { dock: "acoplagem", teleport: "teleporte", region: "Região" }[row.entry.source] ?? "",
        status: "livre",
        acting: row.actor.uuid === this.#actorUuid,
        canAct: isGM || row.actor.isOwner,
        roomOptions: [{ id: "", label: "Corredor", selected: !row.entry.moduleId }, ...modules.map(m => ({ id: m.id, label: m.name, selected: m.id === row.entry.moduleId }))]
      })),
      modules: rows.map(r => ({ ...r, selected: r.id === this.#moduleId })),
      readNote,
      qualityLabel: { clean: "leitura limpa", distorted: "leitura distorcida: o estado pode estar errado", blocked: "sem leitura: os Módulos aparecem como não lidos" }[quality],
      hasModules: rows.length > 0,
      selectedName: selected?.name ?? "",
      selectedRead: selectedRow?.read ?? "",
      selectedHp: selected && (isGM || (reached && quality === "clean")) ? `${selected.system.hp?.value ?? 0}/${selected.system.hp?.max ?? 0}` : "?",
      fromRoom: Boolean(roomId),
      canSabotage: Boolean(acting) && sabotage.ok && (selected?.system.hp?.value ?? 0) > 0,
      canDisable: Boolean(acting) && disable.ok && selected?.system.status === "online",
      canHack: Boolean(acting) && hack.ok && selected?.system.status === "online",
      sabotageWhy: sabotage.reason,
      disableWhy: disable.reason,
      hackWhy: hack.reason,
      hasActing: Boolean(acting),
      actingName: acting?.actor.name ?? "",
      candidates: candidates.map(a => ({ uuid: a.uuid, name: a.name })),
      canAdd: candidates.length > 0,
      isGM
    });
  }

  #entryText() {
    const dock = this.host.system.dock;
    if (dock?.withUuid) return `entrou por Acoplagem a ${dock.withName || "outra nave"} · ficha sem mapa`;
    const first = (this.host.system.boarders ?? [])[0];
    const source = { teleport: "teleporte", region: "uma Região \"A bordo\"" }[first?.source];
    return source ? `entrou por ${source} · ficha sem mapa` : "ficha sem mapa";
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const refresh = actor => {
      if (actor?.uuid === this.host.uuid && this.rendered) this.render();
    };
    this.#hookIds.push(["updateActor", Hooks.on("updateActor", refresh)], ["updateItem", Hooks.on("updateItem", item => refresh(item.parent))]);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll("select[data-room]").forEach(select => {
      select.addEventListener("change", async () => {
        await askBoarding("boardingGroup", { op: "room", shipUuid: this.host.uuid, actorUuid: select.dataset.room, moduleId: select.value });
      });
    });
  }

  _onClose(options) {
    for (const [hook, id] of this.#hookIds) Hooks.off(hook, id);
    this.#hookIds = [];
    super._onClose?.(options);
  }

  static #onSelectBoarder(event, target) {
    event.preventDefault();
    this.#actorUuid = target.dataset.uuid ?? "";
    this.render();
  }

  static #onSelectModule(event, target) {
    event.preventDefault();
    this.#moduleId = target.dataset.id ?? "";
    this.render();
  }

  static async #onAct(event, target) {
    event.preventDefault();
    const op = target.dataset.op;
    if (!BOARDING_ACTIONS[op] || !this.#actorUuid || !this.#moduleId) return;
    const success = op === "sabotage" ? "" : "Pedido enviado ao Mestre.";
    await askBoarding("boardingAction", { op, shipUuid: this.host.uuid, actorUuid: this.#actorUuid, moduleId: this.#moduleId }, { success });
  }

  static async #onLeave(event, target) {
    event.preventDefault();
    await askBoarding("boardingGroup", { op: "remove", shipUuid: this.host.uuid, actorUuid: target.dataset.uuid });
  }

  static async #onAdd(event) {
    event.preventDefault();
    const uuid = this.element.querySelector("select[name=addBoarder]")?.value;
    if (!uuid) return;
    await askBoarding("boardingGroup", { op: "add", shipUuid: this.host.uuid, actorUuid: uuid });
  }
}
