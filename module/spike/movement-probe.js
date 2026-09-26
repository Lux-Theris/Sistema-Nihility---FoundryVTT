/**
 * SONDA DA FASE 0 — deslocamento por rodada.
 *
 * Código de investigação, não é a funcionalidade. Existe para responder, dentro de um Foundry
 * real, as perguntas que a documentação da V13 deixa em aberto antes de o deslocamento ser
 * construído em cima delas:
 *
 *  1. Sobrescrever `Token#constrainMovementPath` faz o arrasto parar num ponto e a régua
 *     tratar o resto como a parede trata (pontilhado)?  → modo "constrain"
 *  2. O que o `moveToken`/`preMoveToken` entrega (custo, distância, unidade)?  → todo modo loga
 *  3. `preMoveToken` retornando false serve de plano B (tudo-ou-nada)?  → modo "block"
 *  4. O histórico de movimento zera sozinho a cada turno?  → log em `updateCombat`
 *  5. Gravar o gasto no flag do Combatant chega a tempo do próximo arrasto?  → log de latência
 *
 * Só existe quando a setting `movementProbe` (client) está ligada: desligada, nada aqui é
 * instalado e o Foundry se comporta exatamente como antes. Quando a Fase 2 entrar, este arquivo
 * é apagado junto com a setting.
 *
 * Uso (console do navegador, com a setting ligada e o mundo recarregado):
 *   game.nihility.movementProbe.start({ limit: 5, mode: "constrain" })
 *   ...arraste tokens, troque turnos no combate...
 *   game.nihility.movementProbe.download()   // baixa o relatório JSON
 */
import { SYSTEM_ID, MEU_SISTEMA } from "../config.js";
import { saveTextToFile } from "../helpers/foundry-compat.js";

const FLAG_KEY = "probeMovementUsed";
const MAX_LOG = 800;

const state = {
  /** null = só registra, sem limitar nada. */
  limit: null,
  /** "log" | "constrain" | "block" */
  mode: "log",
  log: [],
  /** Gasto por token fora de combate (dentro de combate o gasto mora no flag do Combatant). */
  localUsed: new Map(),
  lastConstrainSignature: null,
  constrainCalls: 0,
  rulerSamples: 0
};

/* ------------------------------------------------------------------ utilidades */

/** Versão JSON-segura de um objeto qualquer do Foundry (sem ciclos, sem Documents, com teto). */
function snap(value, depth = 3, seen = new WeakSet()) {
  if (value === null || ["number", "string", "boolean", "undefined"].includes(typeof value)) return value;
  if (typeof value === "function") return "[fn]";
  if (depth <= 0) return "[…]";
  if (value instanceof foundry.abstract.Document) return `[Document ${value.uuid}]`;
  if (value instanceof Set) return snap([...value], depth, seen);
  if (value instanceof Map) return snap(Object.fromEntries(value), depth, seen);
  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 40).map(item => snap(item, depth - 1, seen));
    const out = {};
    for (const key of Object.keys(value).slice(0, 40)) {
      try {
        out[key] = snap(value[key], depth - 1, seen);
      } catch (err) {
        out[key] = "[erro ao ler]";
      }
    }
    return out;
  }
  return String(value);
}

function record(event, data = {}) {
  if (state.log.length >= MAX_LOG) state.log.shift();
  state.log.push({ t: Math.round(performance.now()), user: game.user?.name, event, ...snap(data) });
}

function isDesignatedGm() {
  const gms = game.users.filter(user => user.isGM && user.active).map(user => user.id).sort();
  return gms[0] === game.user.id;
}

function combatantFor(tokenLike) {
  const tokenId = tokenLike?.id ?? tokenLike?.document?.id;
  return game.combat?.combatants.find(c => c.tokenId === tokenId) ?? null;
}

function usedBy(token) {
  const combatant = combatantFor(token);
  if (combatant) return Number(combatant.getFlag(SYSTEM_ID, FLAG_KEY)) || 0;
  return state.localUsed.get(token.id ?? token.document?.id) ?? 0;
}

function remainingFor(token) {
  return Math.max(0, state.limit - usedBy(token));
}

/** Custo de um movimento, tentando os lugares onde a V13 pode ter posto o número. */
function movementCost(movement) {
  for (const candidate of [movement?.passed?.cost, movement?.pending?.cost, movement?.cost]) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return null;
}

/* ------------------------------------------------------------------ corte do caminho */

/**
 * Corta o caminho já restringido pelo core no último ponto que cabe no orçamento restante.
 * Devolve o mesmo formato do core: [waypoints, foiRestringido].
 */
function truncateToBudget(token, result) {
  const [path] = result;
  const remaining = remainingFor(token);
  const total = token.measureMovementPath(path)?.cost;
  record("truncate:check", { remaining, total, points: path.length });
  if (!(total > remaining)) return result;

  const complete = token.document.getCompleteMovementPath(path);
  let cut = 0;
  for (let i = 1; i < complete.length; i++) {
    const cost = token.measureMovementPath(complete.slice(0, i + 1))?.cost;
    if (!(cost <= remaining)) break;
    cut = i;
  }
  const truncated = complete.slice(0, cut + 1).map(waypoint => {
    const copy = { ...waypoint };
    delete copy.intermediate;
    return copy;
  });
  record("truncate:done", { remaining, completePoints: complete.length, keptPoints: truncated.length, last: truncated.at(-1) });
  return [truncated, true];
}

/* ------------------------------------------------------------------ instalação */

function installTokenClass() {
  const BaseToken = CONFIG.Token.objectClass;
  CONFIG.Token.objectClass = class NihilityProbeToken extends BaseToken {
    /** @override */
    constrainMovementPath(waypoints, options) {
      const result = super.constrainMovementPath(waypoints, options);
      state.constrainCalls++;

      // O arrasto chama isto a cada movimento do mouse: só registra quando o formato muda.
      const last = result?.[0]?.at(-1);
      const signature = `${waypoints?.length}|${result?.[0]?.length}|${result?.[1]}|${last?.x},${last?.y}`;
      if (signature !== state.lastConstrainSignature) {
        state.lastConstrainSignature = signature;
        record("constrainMovementPath", {
          token: this.name,
          waypointsIn: waypoints,
          options,
          wasConstrained: result?.[1],
          waypointsOut: result?.[0],
          used: state.limit == null ? null : usedBy(this),
          calls: state.constrainCalls
        });
      }

      if (state.mode !== "constrain" || state.limit == null) return result;
      try {
        return truncateToBudget(this, result);
      } catch (err) {
        record("truncate:erro", { message: err?.message, stack: String(err?.stack).split("\n").slice(0, 4) });
        return result;
      }
    }
  };
}

/** Amostra o que a régua entrega por segmento/rótulo — é onde descobrimos como o core marca "inalcançável". */
function installRulerClass() {
  const BaseRuler = CONFIG.Token.rulerClass;
  if (!BaseRuler) {
    record("ruler:ausente", { nota: "CONFIG.Token.rulerClass não existe nesta versão" });
    return;
  }
  CONFIG.Token.rulerClass = class NihilityProbeRuler extends BaseRuler {
    /** @override */
    _getSegmentStyle(waypoint) {
      const style = super._getSegmentStyle(waypoint);
      if (state.rulerSamples < 12) {
        state.rulerSamples++;
        record("ruler:segmentStyle", { waypoint, style });
      }
      return style;
    }

    /** @override */
    _getWaypointLabelContext(waypoint, waypointState) {
      const context = super._getWaypointLabelContext(waypoint, waypointState);
      if (state.rulerSamples < 12) record("ruler:labelContext", { waypointKeys: Object.keys(waypoint ?? {}), context });
      return context;
    }
  };
}

function registerHooks() {
  Hooks.on("preMoveToken", (document, movement, operation) => {
    const cost = movementCost(movement);
    const token = document.object;
    const remaining = state.limit == null || !token ? null : remainingFor(token);
    record("preMoveToken", { token: document.name, cost, remaining, movement, operation });

    if (state.mode === "block" && state.limit != null && cost != null && remaining != null && cost > remaining) {
      ui.notifications.warn(`[sonda] Movimento bloqueado: custo ${cost} > restante ${remaining}.`);
      return false;
    }
    return undefined;
  });

  Hooks.on("moveToken", (document, movement, operation, user) => {
    const cost = movementCost(movement);
    record("moveToken", {
      token: document.name,
      by: user?.name,
      cost,
      movement,
      historyLength: document.movementHistory?.length ?? null
    });
    if (cost == null) return;

    const combatant = combatantFor(document);
    if (combatant) {
      // Só o Mestre designado grava — é exatamente o papel que o gm-relay teria na versão real.
      if (!isDesignatedGm()) return;
      const next = (Number(combatant.getFlag(SYSTEM_ID, FLAG_KEY)) || 0) + cost;
      record("flag:gravando", { token: document.name, next });
      combatant.setFlag(SYSTEM_ID, FLAG_KEY, next);
    } else {
      state.localUsed.set(document.id, (state.localUsed.get(document.id) ?? 0) + cost);
    }
  });

  // Latência: toda ponta vê o flag chegar — comparar `t` daqui com o `flag:gravando` do Mestre.
  Hooks.on("updateCombatant", (combatant, changes) => {
    if (foundry.utils.hasProperty(changes, `flags.${SYSTEM_ID}.${FLAG_KEY}`)) {
      record("flag:observado", { token: combatant.name, value: combatant.getFlag(SYSTEM_ID, FLAG_KEY) });
    }
  });

  Hooks.on("updateCombat", (combat, changes) => {
    if (!("turn" in changes) && !("round" in changes)) return;
    const current = combat.combatant;

    // O histórico de movimento zera sozinho na virada de turno? Mede agora e meio segundo depois.
    const historyOf = () => combat.combatants.map(c => ({ name: c.name, history: c.token?.movementHistory?.length ?? null }));
    record("updateCombat:historico(agora)", { turn: combat.turn, round: combat.round, combatants: historyOf() });
    setTimeout(() => record("updateCombat:historico(+500ms)", { combatants: historyOf() }), 500);

    if (current && isDesignatedGm()) {
      record("flag:zerando", { token: current.name });
      current.setFlag(SYSTEM_ID, FLAG_KEY, 0);
    }
  });
}

function describeEnvironment() {
  const scene = canvas?.scene;
  return {
    foundry: game.version,
    system: game.system?.version,
    scene: scene ? { name: scene.name, gridSize: scene.grid?.size, distance: scene.grid?.distance, units: scene.grid?.units, type: scene.grid?.type } : null,
    classes: {
      tokenObject: CONFIG.Token.objectClass?.name,
      ruler: CONFIG.Token.rulerClass?.name ?? null
    },
    capabilities: {
      "Token#constrainMovementPath": typeof CONFIG.Token.objectClass?.prototype?.constrainMovementPath,
      "Token#measureMovementPath": typeof CONFIG.Token.objectClass?.prototype?.measureMovementPath,
      "TokenDocument#getCompleteMovementPath": typeof CONFIG.Token.documentClass?.prototype?.getCompleteMovementPath,
      "TokenDocument#revertRecordedMovement": typeof CONFIG.Token.documentClass?.prototype?.revertRecordedMovement,
      "TokenDocument#clearMovementHistory": typeof CONFIG.Token.documentClass?.prototype?.clearMovementHistory
    },
    movementActions: Object.keys(CONFIG.Token.movement?.actions ?? {}),
    defaultAction: CONFIG.Token.movement?.defaultAction ?? null
  };
}

function buildApi() {
  return {
    /** Liga a sonda. `mode`: "log" só registra, "constrain" corta o arrasto, "block" cancela via preMoveToken. */
    start({ limit = 5, mode = "constrain" } = {}) {
      state.limit = limit;
      state.mode = mode;
      state.lastConstrainSignature = null;
      record("start", { limit, mode, environment: describeEnvironment() });
      ui.notifications.info(`[sonda] limite ${limit} em modo "${mode}". Arraste um token.`);
    },
    stop() {
      state.limit = null;
      state.mode = "log";
      record("stop");
      ui.notifications.info("[sonda] só registrando, sem limitar.");
    },
    /** Zera o gasto (flags dos Combatants e contador fora de combate). */
    async reset() {
      state.localUsed.clear();
      for (const combatant of game.combat?.combatants ?? []) await combatant.setFlag(SYSTEM_ID, FLAG_KEY, 0);
      record("reset");
    },
    clearLog() {
      state.log.length = 0;
      state.rulerSamples = 0;
      state.constrainCalls = 0;
    },
    report() {
      return { generatedAt: new Date().toISOString(), environment: describeEnvironment(), state: { limit: state.limit, mode: state.mode }, log: state.log };
    },
    download() {
      saveTextToFile(JSON.stringify(this.report(), null, 2), "application/json", `nihility-movement-probe-${Date.now()}.json`);
    }
  };
}

/** Chamada no `init`. Sem a setting ligada, não instala nada. */
export function registerMovementProbe() {
  let enabled = false;
  try {
    enabled = Boolean(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.movementProbe));
  } catch (err) {
    return;
  }
  if (!enabled) return;

  installTokenClass();
  installRulerClass();
  registerHooks();
  game.nihility.movementProbe = buildApi();
  console.warn(`${SYSTEM_ID} | Sonda de movimento (Fase 0) ATIVA. Use game.nihility.movementProbe.start().`);
}
