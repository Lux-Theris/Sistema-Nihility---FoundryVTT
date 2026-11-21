/**
 * Voo, altura e escavação (J4) — o lado Foundry. As contas são puras, em `forced-movement-rules.js`.
 *
 * A altura é a `elevation` do Token (unidade da cena, metros), que existe na V13 e na V14. Regras:
 *  - pode voar = Traço efetivo `flying` (a Função de corpo `voo` tira o Traço quando a asa cai) ou o efeito
 *    ativo "Voando" (Skill de voo, Manipulação Espacial/Gravidade); pode cavar = Traço `burrowing` ou o
 *    efeito "Escavando";
 *  - os botões ↑/↓ do Token HUD sobem e descem um quadrado (`grid.distance`) por clique, pelo movimento
 *    nativo do Foundry (em combate o Deslocamento cobra a altura como qualquer passo); o Mestre pode tudo;
 *  - elevação posta à mão por quem não pode só AVISA, nunca bloqueia;
 *  - quem está no ar sem poder voar CAI: o Mestre designado recebe um card "está caindo de N m" com o botão
 *    "Calcular dano"; quem está embaixo sem poder cavar fica "soterrado" (aviso, sem conta);
 *  - a distância entre Tokens soma a altura (`measureActorDistance`, range.js) e as áreas viram esferas.
 * Desligado (`FEATURES.elevation`): nada é conferido nem mostrado; nada salvo se perde.
 */
import { SYSTEM_ID, actorTraits, isElevationEnabled, getFeatureOption } from "../core/config.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { isShipLike } from "../starship/ship-damage.js";
import { groundState, stepElevation, manualElevationWarning, fallDamage, hiddenUnderground, meleeOutOfVerticalReach } from "./forced-movement-rules.js";
import { moveTokenForced, postBluntDamageCard } from "./forced-movement.js";
import { movementRemainingFor, notifyMovementSpent } from "./movement.js";
import { tokenElevation } from "../helpers/foundry-compat.js";

/** Elevação (metros) de um Token ou documento de Token. */
export { tokenElevation };

/** O Ator tem um efeito ativo "Voando"/"Escavando"? */
export function hasMovementMode(actor, mode) {
  // `active` (V14) também deixa de fora o efeito que a duração já encerrou (a V14 só o suprime, não o apaga).
  return Boolean(actor?.effects?.some(e => !e.disabled && !e.isSuppressed && e.active !== false && e.getFlag?.(SYSTEM_ID, "movementMode") === mode));
}

/** O Ator tem algum efeito de voo/escavação (ativo ou já encerrado) — vale conferir o chão dele. */
function hasAnyMovementMode(actor) {
  return Boolean(actor?.effects?.some(e => e.getFlag?.(SYSTEM_ID, "movementMode")));
}

export function canFly(actor) {
  return actorTraits(actor).includes("flying") || hasMovementMode(actor, "flight");
}

export function canBurrow(actor) {
  return actorTraits(actor).includes("burrowing") || hasMovementMode(actor, "burrow");
}

/* ------------------------------------------------------------------ Distância e acesso na vertical */

/**
 * Acesso na vertical entre quem usa e o alvo (J4): debaixo da terra (elevação < 0) ninguém na superfície
 * ou no ar alcança; corpo a corpo (alcance 0) contra alvo fora do alcance da mão só avisa.
 * @param {Token} casterToken
 * @param {Token} targetToken
 * @param {{range?: number|null}} [options] - `range` só para arma/arremesso (null = Skill: sem aviso corpo a corpo)
 * @returns {{hidden: boolean, melee: boolean, gap: number}}
 */
export function verticalAccess(casterToken, targetToken, { range = null } = {}) {
  const none = { hidden: false, melee: false, gap: 0 };
  if (!isElevationEnabled() || !casterToken || !targetToken) return none;
  const from = tokenElevation(casterToken);
  const to = tokenElevation(targetToken);
  return {
    hidden: hiddenUnderground(from, to),
    melee: range !== null && meleeOutOfVerticalReach({ range, sourceElevation: from, targetElevation: to }),
    gap: Math.abs(to - from)
  };
}

/* ------------------------------------------------------------------ Botões ↑/↓ no Token HUD */

/** Sobe/desce um quadrado, pelo movimento nativo (em combate o Deslocamento cobra, se estiver ligado). */
async function stepToken(tokenDoc, direction) {
  const actor = tokenDoc.actor;
  const gm = game.user.isGM;
  const step = Number(tokenDoc.parent?.grid?.distance) || 1;
  const next = stepElevation({
    current: tokenElevation(tokenDoc),
    direction,
    step,
    canFly: gm || canFly(actor),
    canBurrow: gm || canBurrow(actor)
  });
  if (next === null) {
    ui.notifications.warn(`${tokenDoc.name} não pode ${direction === "up" ? "subir" : "descer"} mais.`);
    return;
  }
  // Deslocamento da rodada gasto: o movimento nativo cortaria o passo em silêncio (achado de 21/11).
  const budget = gm ? null : movementRemainingFor(tokenDoc);
  if (budget && budget.remaining + 1e-6 < step) {
    notifyMovementSpent(budget);
    return;
  }
  if (typeof tokenDoc.move === "function") await tokenDoc.move({ elevation: next }, { method: "api", showRuler: false });
  else await tokenDoc.update({ elevation: next });
}

function addHudButtons(hud, html) {
  if (!isElevationEnabled()) return;
  const tokenDoc = hud.object?.document;
  const actor = tokenDoc?.actor;
  if (!tokenDoc || !actor || isShipLike(actor)) return;
  const gm = game.user.isGM;
  if (!gm && !canFly(actor) && !canBurrow(actor)) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const column = root?.querySelector(".col.left");
  if (!column || column.querySelector(".nihility-elevation-hud")) return;

  const make = (direction, icon, tip) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "control-icon nihility-elevation-hud";
    button.dataset.tooltip = tip;
    button.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      stepToken(tokenDoc, direction).catch(err => reportError("Falha ao mudar a altura.", err));
    });
    return button;
  };
  column.append(make("up", "fa-arrow-up", "Subir um quadrado"), make("down", "fa-arrow-down", "Descer um quadrado"));
}

/* ------------------------------------------------------------------ Queda e soterramento */

/** Os Tokens de um Ator em qualquer cena (vinculado: todos; sem vínculo: o dele). */
function tokensOf(actor) {
  if (actor.isToken) return actor.token ? [actor.token] : [];
  const out = [];
  for (const scene of game.scenes) for (const token of scene.tokens) if (token.actorLink && token.actorId === actor.id) out.push(token);
  return out;
}

const notified = new Set();
const pending = new Map();

/** Confere (com um respiro, para uma rajada de mudanças virar uma conta só) quem está fora do chão sem poder. */
export function scheduleGroundCheck(actor) {
  if (!actor || actor.documentName !== "Actor" || !isDesignatedGm() || !isElevationEnabled() || isShipLike(actor)) return;
  clearTimeout(pending.get(actor.uuid));
  pending.set(
    actor.uuid,
    setTimeout(() => {
      pending.delete(actor.uuid);
      checkGround(actor).catch(err => reportError("Falha ao conferir a altura.", err, { gmOnly: true }));
    }, 300)
  );
}

async function checkGround(actor) {
  if (!isElevationEnabled()) return;
  for (const tokenDoc of tokensOf(actor)) {
    const elevation = tokenElevation(tokenDoc);
    const state = groundState({ elevation, canFly: canFly(actor), canBurrow: canBurrow(actor) });
    const kind = state.falling ? "fall" : state.buried ? "buried" : null;
    for (const k of ["fall", "buried"]) if (k !== kind) for (const key of [...notified]) if (key.startsWith(`${tokenDoc.uuid}|${k}|`)) notified.delete(key);
    if (!kind) continue;
    const key = `${tokenDoc.uuid}|${kind}|${elevation}`;
    if (notified.has(key)) continue;
    notified.add(key);
    const meters = Math.abs(elevation);
    const name = escapeHtml(tokenDoc.name || actor.name);
    await ChatMessage.create({
      whisper: game.users.filter(u => u.isGM).map(u => u.id),
      speaker: { alias: "Altura" },
      content: kind === "fall" ? `<p><strong>${name}</strong> está caindo de ${meters} m.</p>` : `<p><strong>${name}</strong> está soterrado a ${meters} m.</p>`,
      flags: { [SYSTEM_ID]: { groundCard: { kind, tokenUuid: tokenDoc.uuid, meters, resolved: false } } }
    });
  }
}

/** "Calcular dano" do card de queda: card de dano Contundente com Aplicar e o Token desce a 0. */
async function resolveFall(message) {
  const card = message.getFlag(SYSTEM_ID, "groundCard");
  if (!card || card.resolved) return;
  const tokenDoc = await fromUuid(card.tokenUuid);
  const actor = tokenDoc?.actor;
  const meters = tokenElevation(tokenDoc);
  await message.update({ [`flags.${SYSTEM_ID}.groundCard.resolved`]: true });
  if (!actor || meters <= 0) {
    ui.notifications.info("Ele já não está no ar.");
    return;
  }
  const percent = getFeatureOption("elevation", "fallPercent");
  const raw = fallDamage({ meters, maxHp: actor.system?.attributes?.hp?.max, percent });
  if (raw > 0) {
    await postBluntDamageCard({
      tokenDoc,
      actor,
      raw,
      headline: `<strong>${escapeHtml(tokenDoc.name)}</strong> caiu de ${meters} m`,
      traceLabel: `Queda: ${meters} m (3 m não machucam) × ${percent}% da Vida máxima por metro`,
      label: "Queda"
    });
  } else {
    await ChatMessage.create({ speaker: { alias: "Queda" }, content: `<p><strong>${escapeHtml(tokenDoc.name)}</strong> caiu de ${meters} m e não se machucou.</p>` });
  }
  await moveTokenForced(tokenDoc, { elevation: 0 });
}

/** Botão "Calcular dano" no card de queda (só o Mestre vê, só enquanto não foi usado). */
function renderGroundCard(message, html) {
  const card = message.getFlag(SYSTEM_ID, "groundCard");
  if (!card || card.kind !== "fall" || card.resolved || !game.user.isGM) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nihility-fall-calc";
  button.textContent = "Calcular dano";
  button.addEventListener("click", () => {
    button.disabled = true;
    resolveFall(message).catch(err => reportError("Falha ao calcular a queda.", err));
  });
  html.append(button);
}

/* ------------------------------------------------------------------ Registro */

/** Chamado uma vez, no `init`: tudo confere `isElevationEnabled()` ao agir, então o bloco vale sem reload. */
export function registerElevation() {
  Hooks.on("renderTokenHUD", addHudButtons);
  Hooks.on("renderChatMessageHTML", renderGroundCard);

  // Quem perdeu o voo/escavação: efeito que acabou, Skill que desligou, Antimagia, PEM, Mana em 0…
  const onEffect = effect => {
    if (effect?.parent?.documentName === "Actor" && effect.getFlag?.(SYSTEM_ID, "movementMode")) scheduleGroundCheck(effect.parent);
  };
  Hooks.on("deleteActiveEffect", onEffect);
  Hooks.on("updateActiveEffect", onEffect);
  // A asa caiu (Função voo → o Traço some) ou a espécie mudou.
  const onPart = item => {
    if (item?.type === "body_part" && item.parent) scheduleGroundCheck(item.parent);
  };
  // Um efeito que a duração encerrou (V14 só o suprime) é percebido na virada de turno.
  Hooks.on("updateCombat", (combat, changes) => {
    if (!("turn" in changes) && !("round" in changes)) return;
    for (const combatant of combat.combatants) if (combatant.actor && hasAnyMovementMode(combatant.actor)) scheduleGroundCheck(combatant.actor);
  });
  Hooks.on("updateItem", onPart);
  Hooks.on("deleteItem", onPart);
  Hooks.on("updateActor", (actor, changes) => {
    if (foundry.utils.hasProperty(changes, "system.traits") || foundry.utils.hasProperty(changes, "system.traitsRemoved") || foundry.utils.hasProperty(changes, "system.species")) scheduleGroundCheck(actor);
  });

  // Elevação mudou: o aviso já dado vale só para aquela altura; posta à mão por quem não pode, só avisa.
  Hooks.on("updateToken", (tokenDoc, changes, options, userId) => {
    if (!isElevationEnabled() || !foundry.utils.hasProperty(changes, "elevation")) return;
    for (const key of [...notified]) if (key.startsWith(`${tokenDoc.uuid}|`) && !key.endsWith(`|${tokenElevation(tokenDoc)}`)) notified.delete(key);
    const actor = tokenDoc.actor;
    if (userId !== game.user.id || options?.nihilityForced || !actor || isShipLike(actor)) return;
    const text = manualElevationWarning({
      name: tokenDoc.name || actor.name,
      elevation: tokenElevation(tokenDoc),
      canFly: canFly(actor),
      canBurrow: canBurrow(actor)
    });
    if (text) ui.notifications.warn(text);
  });
}
