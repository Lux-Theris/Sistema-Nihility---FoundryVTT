/**
 * Deslocamento por rodada — a parte que age no mapa (a regra numérica é `movementAllowance`, em
 * config.js, e o valor derivado fica em `actor.system.movement`).
 *
 * O desenho vem da sonda da Fase 0, rodada num Foundry V14 real:
 *  - `Token#constrainMovementPath` é o mesmo ponto que o core usa para cortar o caminho numa
 *    parede. Devolvendo um caminho mais curto, o arrasto para ali e a régua pontilha o resto, sem
 *    nenhum código nosso de desenho.
 *  - `preMoveToken` retornando `false` cancela o movimento inteiro; serve de rede de segurança
 *    para caminhos que não passem pelo `constrainMovementPath`.
 *  - O custo de um movimento vem em `movement.passed.cost`, na unidade da cena (metros).
 *
 * Regras que este arquivo aplica:
 *  - Só limita em combate INICIADO e só quem é combatente. Fora de combate o token anda livre.
 *  - O gasto do turno mora num flag do Combatant, lido de forma síncrona por qualquer cliente
 *    durante o arrasto. Quem grava é só o Mestre designado (mesma regra do gm-relay).
 *  - O gasto zera quando começa o turno do próprio combatente. Metros sobrando podem ser usados
 *    fora do turno; quem gastou tudo fica parado até o seu turno.
 *  - Correr dobra o deslocamento do turno (flag `movementDash`); o Mestre não gasta ação nenhuma,
 *    é o mesmo "o sistema calcula, a mesa julga" do resto.
 *  - O Mestre é isento quando `movementGmIgnores` está ligado, e o que ele move não é contado.
 *  - Nave/Veículo usam o mesmo mecanismo com `system.movementCells` (Porte × Motor, em casas do
 *    grid), atrás do bloco `shipManeuver`. As casas viram unidades da cena multiplicando por
 *    `grid.distance`, então funciona com o grid de 1 m ou com uma cena espacial em outra escala.
 */
import { SYSTEM_ID, isMovementEnabled, isShipManeuverEnabled, getMovementConfig } from "./config.js";
import { isDesignatedGm, runAsGm } from "./helpers/gm-relay.js";

const USED_FLAG = "movementUsed";
/** Correr: dobra o deslocamento do turno. Zera junto com o gasto. */
const DASH_FLAG = "movementDash";
/** Folga para erro de ponto flutuante nas diagonais (custo 1.4142…). */
const EPSILON = 1e-6;

/** Combatente de um Token, em qualquer Combate iniciado (não só o da cena que o Mestre está vendo). */
function combatantFor(tokenDocument) {
  const sceneId = tokenDocument.parent?.id;
  for (const combat of game.combats) {
    if (!combat.started) continue;
    const combatant = combat.combatants.find(c => c.tokenId === tokenDocument.id && (c.sceneId ?? combat.scene?.id) === sceneId);
    if (combatant) return combatant;
  }
  return null;
}

/** Nave/Veículo carregam `movementCells`; Personagem/Criatura carregam `movement`. */
function isShipLike(actor) {
  return Number.isFinite(actor?.system?.movementCells);
}

/** O bloco certo está ligado para este tipo de Ator? */
function limitEnabledFor(actor) {
  return isShipLike(actor) ? isShipManeuverEnabled() : isMovementEnabled();
}

/** Deslocamento-base do Ator em unidades da cena, ou NaN quando ele não tem. */
function baseAllowance(tokenDocument) {
  const system = tokenDocument.actor?.system;
  if (isShipLike(tokenDocument.actor)) return system.movementCells * (tokenDocument.parent?.grid?.distance ?? 1);
  return system?.movement?.total;
}

/**
 * Orçamento de movimento deste Token para o usuário atual, ou `null` quando ele não é limitado.
 * @returns {{allowance:number, used:number, remaining:number}|null}
 */
function budgetFor(tokenDocument) {
  if (!limitEnabledFor(tokenDocument.actor)) return null;
  if (game.user.isGM && getMovementConfig().gmIgnores) return null;

  const combatant = combatantFor(tokenDocument);
  if (!combatant || combatant.isDefeated) return null;

  const base = baseAllowance(tokenDocument);
  if (!Number.isFinite(base)) return null;
  // Correr é coisa de personagem; nave não tem o botão, então o flag nunca existe nela.
  const allowance = combatant.getFlag(SYSTEM_ID, DASH_FLAG) ? base * 2 : base;

  const used = Number(combatant.getFlag(SYSTEM_ID, USED_FLAG)) || 0;
  return { allowance, used, remaining: Math.max(0, allowance - used) };
}

/** Custo de um movimento já definido, somando o que já andou e o que falta (movimento retomado). */
function movementCost(movement) {
  return (Number(movement?.passed?.cost) || 0) + (Number(movement?.pending?.cost) || 0);
}

/**
 * Corta o caminho (já restringido pelo core) no último ponto que cabe em `remaining`.
 * Mesmo formato do core: `[waypoints, foiRestringido]`.
 */
function truncateToBudget(token, result, remaining) {
  const [path] = result;
  const total = token.measureMovementPath(path)?.cost;
  if (!(total > remaining + EPSILON)) return result;

  // O caminho completo tem um ponto por casa, então dá para cortar exatamente onde o custo estoura.
  const complete = token.document.getCompleteMovementPath(path);
  let cut = 0;
  for (let i = 1; i < complete.length; i++) {
    const cost = token.measureMovementPath(complete.slice(0, i + 1))?.cost;
    if (!(cost <= remaining + EPSILON)) break;
    cut = i;
  }
  const truncated = complete.slice(0, cut + 1).map(waypoint => {
    const copy = { ...waypoint };
    delete copy.intermediate;
    return copy;
  });
  return [truncated, true];
}

/** "5" em vez de "5.000000001"; uma casa decimal no máximo. */
function formatMeters(value) {
  return String(Math.round(value * 10) / 10);
}

/** Chamado uma vez, no `init`. Cada peça confere `isMovementEnabled()` ao agir. */
export function registerMovementLimit() {
  const BaseToken = CONFIG.Token.objectClass;
  CONFIG.Token.objectClass = class NihilityToken extends BaseToken {
    /** @override */
    constrainMovementPath(waypoints, options) {
      const result = super.constrainMovementPath(waypoints, options);
      try {
        const budget = budgetFor(this.document);
        return budget ? truncateToBudget(this, result, budget.remaining) : result;
      } catch (err) {
        console.error(`${SYSTEM_ID} | Falha ao limitar o deslocamento.`, err);
        return result;
      }
    }
  };

  // Rótulo da régua: "gasto / máximo" no lugar do custo solto. Sem o gasto do turno na ficha, é
  // aqui que o jogador vê quanto tem.
  const BaseRuler = CONFIG.Token.rulerClass;
  if (BaseRuler) {
    CONFIG.Token.rulerClass = class NihilityTokenRuler extends BaseRuler {
      /** @override */
      _getWaypointLabelContext(waypoint, state) {
        const context = super._getWaypointLabelContext(waypoint, state);
        try {
          const budget = context?.cost ? budgetFor(this.token.document) : null;
          if (budget) context.cost.total = `${formatMeters(budget.used + waypoint.cost)} / ${formatMeters(budget.allowance)}`;
        } catch (err) {
          // Rótulo é cosmético: se falhar, fica o texto do core.
        }
        return context;
      }
    };
  }

  // Rede de segurança: movimento que não passou pelo corte acima (ex.: chamada direta de
  // `TokenDocument#move`) é cancelado inteiro se estourar o orçamento.
  Hooks.on("preMoveToken", (document, movement) => {
    const budget = budgetFor(document);
    if (!budget) return undefined;
    if (movementCost(movement) > budget.remaining + EPSILON) {
      ui.notifications.warn("Deslocamento do turno esgotado.");
      return false;
    }
    return undefined;
  });

  // Contabiliza o que foi andado. Roda em todos os clientes, mas só o Mestre designado grava.
  Hooks.on("moveToken", (document, movement, operation, user) => {
    if (!isDesignatedGm() || !limitEnabledFor(document.actor)) return;
    if (user?.isGM && getMovementConfig().gmIgnores) return;

    const combatant = combatantFor(document);
    const cost = Number(movement?.passed?.cost) || 0;
    if (!combatant || !(cost > 0)) return;

    const used = Number(combatant.getFlag(SYSTEM_ID, USED_FLAG)) || 0;
    combatant.setFlag(SYSTEM_ID, USED_FLAG, used + cost);
  });

  // Começou o turno de alguém: o gasto dele volta a zero.
  Hooks.on("updateCombat", (combat, changes) => {
    if ((!isMovementEnabled() && !isShipManeuverEnabled()) || !isDesignatedGm()) return;
    if (!("turn" in changes) && !("round" in changes)) return;

    const current = combat.combatant;
    if (current && (Number(current.getFlag(SYSTEM_ID, USED_FLAG)) || current.getFlag(SYSTEM_ID, DASH_FLAG))) {
      current.update({ [`flags.${SYSTEM_ID}.${USED_FLAG}`]: 0, [`flags.${SYSTEM_ID}.${DASH_FLAG}`]: false });
    }
  });

  // O botão Correr da ficha depende do turno e do flag: refaz as fichas abertas quando mudam.
  const refreshSheets = combat => {
    for (const combatant of combat.combatants) {
      const sheet = combatant.actor?.sheet;
      if (sheet?.rendered) sheet.render();
    }
  };
  Hooks.on("updateCombat", combat => refreshSheets(combat));
  Hooks.on("updateCombatant", combatant => {
    if (combatant.combat) refreshSheets(combatant.combat);
  });
}

/**
 * Situação do Correr para a ficha de um Ator: `null` quando não se aplica (bloco desligado, sem
 * combate iniciado, não é combatente ou não é personagem com deslocamento).
 * @returns {{combatantUuid:string, active:boolean, canToggle:boolean}|null}
 */
export function getMovementDashStatus(actor) {
  if (!isMovementEnabled() || !Number.isFinite(actor?.system?.movement?.total)) return null;
  for (const combat of game.combats) {
    if (!combat.started) continue;
    const combatant = combat.combatants.find(c => c.actorId === actor.id);
    if (!combatant || combatant.isDefeated) continue;
    return {
      combatantUuid: combatant.uuid,
      active: Boolean(combatant.getFlag(SYSTEM_ID, DASH_FLAG)),
      canToggle: combat.combatant?.id === combatant.id
    };
  }
  return null;
}

/** Liga/desliga o Correr do Ator no turno atual. Quem não é o Mestre pede pelo relay. */
export async function toggleMovementDash(actor) {
  const status = getMovementDashStatus(actor);
  if (!status) return;
  if (!status.canToggle) {
    ui.notifications.info("Só dá para correr no seu turno.");
    return;
  }
  await runAsGm("setMovementDash", { combatantUuid: status.combatantUuid, value: !status.active });
}
