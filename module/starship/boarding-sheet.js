/**
 * A aba "Acoplagem" da ficha da nave (F2): o par acoplado, quem está perto para acoplar, o grupo de abordagem e os
 * Módulos Teletransportadores. Só monta o contexto e trata os cliques; as regras estão em `boarding-rules.js` e quem
 * escreve é o Mestre, pelo relay (`shipDock`, `boardingTeleport`, em `boarding.js`).
 */
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { getBoardingDragMargin } from "../core/config.js";
import { isShipLike } from "./ship-damage.js";
import { boardingOn, dockCheck, dockInfo, askBoarding, teleportCheck, sharedScene } from "./boarding.js";
import { modulesWithFunction, moduleOperating } from "./sensors.js";

/** Os outros Tokens de nave na mesma cena que esta nave, com o veredito de acoplar. */
function nearbyShips(ship) {
  const scene = canvas?.scene;
  if (!scene) return [];
  const mine = scene.tokens.find(t => t.actor?.uuid === ship.uuid);
  if (!mine) return [];
  const out = [];
  for (const token of scene.tokens) {
    const other = token.actor;
    if (!other || !isShipLike(other) || other.uuid === ship.uuid || token.hidden) continue;
    const { verdict } = dockCheck(game.user, ship, other);
    out.push({
      uuid: other.uuid,
      name: token.name || other.name,
      ok: verdict.ok,
      via: verdict.via,
      canAsk: verdict.canAsk,
      reason: verdict.reason
    });
  }
  return out;
}

/** Tudo o que a aba Acoplagem mostra. */
export function boardingTabContext(ship) {
  const docked = dockInfo(ship);
  const nearby = docked ? [] : nearbyShips(ship);
  const partner = ship.system.dock?.withUuid ? fromUuidSync(ship.system.dock.withUuid) : null;
  const groupHosts = [ship, partner].filter(h => h && isShipLike(h) && (h.system.boarders ?? []).length);
  const teleporters = modulesWithFunction(ship, "teleporter").map(module => {
    const targets = game.scenes
      .flatMap(scene => scene.tokens.filter(t => t.actor && isShipLike(t.actor) && t.actor.uuid !== ship.uuid && sharedScene(ship, t.actor)?.scene === scene).map(t => t.actor))
      .filter((actor, i, all) => all.findIndex(a => a.uuid === actor.uuid) === i)
      .map(target => ({ uuid: target.uuid, name: target.name, ...teleportCheck(ship, target, { module }) }));
    return {
      id: module.id,
      uuid: module.uuid,
      name: module.name,
      range: Number(module.system.teleportRange) || 0,
      operating: moduleOperating(ship, module),
      targets,
      anyOk: targets.some(t => t.ok)
    };
  });
  return {
    boardingOn: boardingOn(),
    docked,
    hasNearby: nearby.length > 0,
    nearby,
    groupHosts: groupHosts.map(h => ({ uuid: h.uuid, name: h.name, count: (h.system.boarders ?? []).length, own: h.uuid === ship.uuid })),
    ownBoarders: (ship.system.boarders ?? []).map(b => ({ name: fromUuidSync(b.actorUuid)?.name ?? "(apagado)", room: ship.items.get(b.moduleId)?.name ?? "Corredor" })),
    teleporters,
    hasTeleporters: teleporters.length > 0,
    dragMargin: getBoardingDragMargin(),
    isOwner: ship.isOwner,
    isGM: game.user.isGM
  };
}

/** Acoplar a uma nave perto (ou pedir ao Mestre). */
export async function onDock(event, target) {
  event.preventDefault();
  const ask = target.dataset.ask === "true";
  await askBoarding("shipDock", { op: "dock", shipUuid: this.actor.uuid, targetUuid: target.dataset.targetUuid, ask }, { success: ask ? "" : "Acoplada." });
}

/** Desacoplar. */
export async function onUndock(event) {
  event.preventDefault();
  await askBoarding("shipDock", { op: "undock", shipUuid: this.actor.uuid }, { success: "Desacoplada." });
}

/** Abrir a janela do grupo de abordagem de uma nave. */
export async function onOpenBoarding(event, target) {
  event.preventDefault();
  try {
    const { BoardingGroupApp } = await import("../apps/boarding-group.js");
    await BoardingGroupApp.open(target.dataset.hostUuid || this.actor.uuid);
  } catch (err) {
    reportError("Não abriu o grupo de abordagem.", err);
  }
}

/** Abordar por Módulo Teletransportador: escolhe a nave e quem vai. */
export async function onTeleportBoard(event, target) {
  event.preventDefault();
  const ship = this.actor;
  const module = ship.items.get(target.dataset.itemId);
  if (!module) return;
  const targets = teleportTargets(ship, module);
  if (!targets.some(t => t.ok)) return ui.notifications.warn("Nenhuma nave pode ser abordada por teleporte agora (veja os motivos na aba).");
  const crew = (ship.system.crewActors ?? []).map(c => c.actor).filter(a => a && a.type === "character" && (game.user.isGM || a.isOwner));
  if (!crew.length) return ui.notifications.warn("Não há tripulantes seus para levar.");
  const options = targets.map((t, i) => `<option value="${escapeHtml(t.uuid)}" ${t.ok ? "" : "disabled"} ${i === 0 && t.ok ? "selected" : ""}>${escapeHtml(t.name)}${t.ok ? "" : ` (${escapeHtml(t.reason)})`}</option>`).join("");
  const people = crew.map(a => `<label class="boarding-pick-row"><input type="checkbox" name="who" value="${escapeHtml(a.uuid)}"/> ${escapeHtml(a.name)}</label>`).join("");
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `Abordar por teleporte — ${module.name}`, icon: "fa-solid fa-person-rays" },
    classes: ["nihility-condition-dialog"],
    content: `<div class="nihility-boarding-dialog"><p class="hint">Leva o grupo até a nave alvo, que precisa estar detectada no sensor. Interdição e Âncora bloqueiam.</p><label>Nave alvo <select name="target">${options}</select></label><div>${people}</div></div>`,
    buttons: [
      {
        action: "go",
        label: "Teletransportar",
        icon: "fa-solid fa-person-rays",
        default: true,
        callback: (event, button, dialog) => ({
          targetShipUuid: dialog.element.querySelector("[name=target]")?.value,
          actorUuids: [...dialog.element.querySelectorAll("[name=who]:checked")].map(i => i.value)
        })
      },
      { action: "cancel", label: "Cancelar", callback: () => null }
    ],
    rejectClose: false
  });
  if (!result?.targetShipUuid || !result.actorUuids.length) return;
  await askBoarding("boardingTeleport", { moduleUuid: module.uuid, ...result }, { success: "Abordagem por teleporte feita." });
}

/** Os alvos possíveis de um Teletransportador, com o veredito de cada um. */
function teleportTargets(ship, module) {
  return game.scenes
    .flatMap(scene => scene.tokens.filter(t => t.actor && isShipLike(t.actor) && t.actor.uuid !== ship.uuid && sharedScene(ship, t.actor)?.scene === scene).map(t => t.actor))
    .filter((actor, i, all) => all.findIndex(a => a.uuid === actor.uuid) === i)
    .map(target => ({ uuid: target.uuid, name: target.name, ...teleportCheck(ship, target, { module }) }));
}
