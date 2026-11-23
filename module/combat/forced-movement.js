/**
 * Empurrar e puxar (J1) — o lado Foundry. As contas são puras, em `forced-movement-rules.js` (testado).
 *
 * Quem pede é o cliente de quem usou a Skill (efeito `push`) ou a arma de gravidade (`weapon.mode`).
 * Quem MOVE é só o Mestre designado (relay `forcedMove`): ele refaz tudo a partir da Skill/arma que
 * está na ficha — metros, direção, Traços imunes — e só aceita do cliente a origem, os alvos e a força
 * do investimento (limitada). O movimento:
 *  - é em linha reta, do centro do Token até onde as paredes deixam (`pathStop`; Estruturas são paredes
 *    de verdade, então param o empurrão do mesmo jeito; Tokens no meio não param ninguém);
 *  - NÃO gasta `movementUsed`, não é cortado pelo orçamento de Deslocamento e passa por Caído/Inconsciente
 *    (a opção `nihilityForced` da operação de mover, lida em movement.js e incapacitation.js);
 *  - dispara os ganchos de fim de movimento de sempre (campo de Antimagia, contato de Estrutura,
 *    Regiões), porque é um movimento de verdade do Token (`TokenDocument#move`, V14).
 * Os metros que sobram ao bater viram dano de impacto Contundente (card com Aplicar) e, se o que parou o
 * Token foi uma Estrutura, ela leva o mesmo dano.
 */
import {
  SYSTEM_ID,
  actorTraits,
  actorToken,
  skillLevelBonuses,
  getDamageElement,
  damageElementChain,
  getFeatureOption,
  getAttributeLabel,
  isForcedMovementEnabled,
  isMagicUse,
  isTechUse,
  sameActor
} from "../core/config.js";
import { skillIsMagic, itemIsTech } from "../core/magic-rules.js";
import { isCombinedSkill, combinedPartMech } from "../skills/combined-rules.js";
import { buildAttributeRollFormula } from "../core/dice.js";
import { luckOf } from "./luck-rules.js";
import { escapeHtml } from "../helpers/html.js";
import { runAsGm } from "../helpers/gm-relay.js";
import { RELAY_REASONS, refuse, relayFailureMessage } from "../helpers/gm-relay-rules.js";
import { isShipLike } from "../starship/ship-damage.js";
import { currentSkillUseId } from "../skills/skill-use-context.js";
import { chainedResistance } from "./damage-rules.js";
import { magicDefenseReduction, resistanceSourceFor } from "./resistance.js";
import { applyDamageReductions, personalTraceTail } from "./damage-roll.js";
import { damageApplyFlags, withDamageTrace } from "./damage-apply.js";
import { cardReactions } from "./reactions.js";
import { tokenDocCenter } from "./area-geometry.js";
import { gravityWeaponMeters } from "./weapon-mastery.js";
import { blockIfIncapacitated } from "./incapacitation.js";
import { isTimeStopped } from "./time-stop-state.js";
import { magazineState } from "../economy/consumable-rules.js";
import { chargeAntimagic, fieldGate, creditManipulation } from "./antimagic.js";
import { casterTokenOf, checkFlatRange, pxPerUnit } from "./range.js";
import {
  normalizePushDirection,
  effectivePushMeters,
  averageResistance,
  pushContestAttributes,
  pushContest,
  metersAfterContest,
  pushDestination,
  pathStop,
  leftoverMeters,
  impactDamage
} from "./forced-movement-rules.js";

/* ------------------------------------------------------------------ Mover o Token */

/**
 * Move o Token SEM gastar Deslocamento, sem parar em parede e passando por Caído/Inconsciente:
 * é o movimento do sistema (empurrão, queda, Desfazer uso), não o do jogador. `x`/`y` são o canto
 * do Token (como no documento). Devolve se o movimento foi feito.
 * @param {TokenDocument} tokenDoc
 * @param {{x?:number, y?:number, elevation?:number}} place
 */
export async function moveTokenForced(tokenDoc, { x, y, elevation } = {}) {
  // Parado no tempo (8e.4): nem empurrão nem teleporte o move.
  if (isTimeStopped(tokenDoc?.actor)) return false;
  const waypoint = {};
  if (Number.isFinite(x)) waypoint.x = Math.round(x);
  if (Number.isFinite(y)) waypoint.y = Math.round(y);
  if (Number.isFinite(elevation)) waypoint.elevation = elevation;
  if (!Object.keys(waypoint).length) return false;
  if (typeof tokenDoc.move === "function") {
    try {
      return Boolean(
        await tokenDoc.move(waypoint, {
          nihilityForced: true,
          method: "api",
          showRuler: false,
          autoRotate: false,
          constrainOptions: { ignoreWalls: true, ignoreCost: true, nihilityForced: true }
        })
      );
    } catch (err) {
      console.warn(`${SYSTEM_ID} | TokenDocument#move falhou; usando update.`, err);
    }
  }
  // V13 (sem `move`): o update leva o Token ao lugar; a opção própria só serve aos nossos ganchos.
  return Boolean(await tokenDoc.update(waypoint, { nihilityForced: true, animate: true }));
}

/** Paredes que barram movimento na cena (porta aberta não barra). Estruturas são paredes marcadas. */
export function moveBlockingWalls(scene) {
  const open = CONST.WALL_DOOR_STATES?.OPEN ?? 1;
  const out = [];
  for (const wall of scene?.walls ?? []) {
    if (!Number(wall.move)) continue;
    if (wall.door && wall.ds === open) continue;
    out.push({ id: wall.id, segment: [...wall.c], structure: wall.getFlag?.(SYSTEM_ID, "structureInstance") ?? null });
  }
  return out;
}

const fmt = n => String(Math.round(Number(n) * 10) / 10).replace(".", ",");

/* ------------------------------------------------------------------ Quem pede (cliente de quem usou) */

/** Os efeitos `push` de uma mecânica (com o índice na lista, que o Mestre usa para achar o mesmo efeito). */
export function pushEntriesOf(mech) {
  if (!isForcedMovementEnabled()) return [];
  return (mech?.effects ?? [])
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry?.target === "push" && Number(entry.amount) > 0);
}

/** "Empurrar" ou "Puxar" (ou cancela, `null`). */
export async function promptPushDirection(label) {
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: `${label} — Empurrar ou puxar?` },
    content: `<div class="nihility-range-dialog"><p>Empurrar afasta o alvo de você; puxar o traz até você, sem passar de você.</p></div>`,
    buttons: [
      { action: "push", label: "Empurrar", default: true, callback: () => "push" },
      { action: "pull", label: "Puxar", callback: () => "pull" },
      { action: "cancel", label: "Cancelar", callback: () => null }
    ],
    rejectClose: false
  });
  return answer === "push" || answer === "pull" ? answer : null;
}

/** Uuid do Token do alvo (o marcado com T, se houver; senão o do Ator), ou `null`. */
function tokenUuidFor(actor) {
  return actorToken(actor, [...(game.user?.targets ?? [])])?.document?.uuid ?? null;
}

/** A origem do empurrão em pixels: o centro da área, o Marcado (uso pela Marca) ou o Token de quem usa. */
export function pushOriginFor(sourceActor, mech, areaOrigin = null) {
  if (areaOrigin) return { x: areaOrigin.x, y: areaOrigin.y };
  if (mech?.viaMark?.origin) return { x: mech.viaMark.origin.x, y: mech.viaMark.origin.y };
  const center = casterTokenOf(sourceActor)?.center;
  return center ? { x: center.x, y: center.y } : null;
}

/**
 * Empurra/puxa os alvos pelos efeitos `push` de uma Skill (ou consumível). Chamado por
 * `applySkillEffects` e `applySkillEffectsArea`, depois dos outros efeitos. Devolve as linhas do
 * resultado (uma por alvo) para entrarem no card do uso, e quantos saíram do lugar (XP por uso).
 * @param {{sourceActor: Actor, item: Item, mech: object, label: string, subSkillIndex?: number|null,
 *   targets: Actor[], origin: {x:number,y:number}|null}} args
 * @returns {Promise<{lines: string[], moved: number}>}
 */
export async function runSkillPushes({ sourceActor, item, mech, label, subSkillIndex = null, targets, origin }) {
  const result = { lines: [], moved: 0 };
  const entries = pushEntriesOf(mech);
  if (!entries.length) return result;
  if (!canvas?.ready || !canvas.scene) {
    result.lines.push("Empurrar/Puxar precisa de uma cena aberta: ninguém se move");
    return result;
  }
  if (!origin) {
    result.lines.push("sem Token de quem usa: ninguém se move");
    return result;
  }
  const others = (targets ?? []).filter(t => t && !sameActor(t, sourceActor));
  const tokenUuids = others.map(tokenUuidFor).filter(Boolean);
  if (!tokenUuids.length) return result;

  // Uma pergunta só por uso: todos os efeitos "Escolher ao usar" seguem a mesma resposta.
  let chosen = null;
  if (entries.some(({ entry }) => normalizePushDirection(entry.pushDirection) === "choose")) {
    chosen = await promptPushDirection(label);
    if (!chosen) {
      result.lines.push("empurrão cancelado");
      return result;
    }
  }

  for (const { index } of entries) {
    const outcome = await runAsGm(
      "forcedMove",
      {
        kind: "effect",
        sourceUuid: item.uuid,
        subSkillIndex,
        // Parte de uma Combinada (8c.2): o Mestre lê o efeito da parte, com o nível da Skill-mãe.
        partIndex: Number.isInteger(mech.combinedPartIndex) ? mech.combinedPartIndex : null,
        entryIndex: index,
        direction: chosen,
        sceneId: canvas.scene.id,
        origin: { x: origin.x, y: origin.y },
        tokenUuids,
        investPower: Number(mech.investPower) || 1,
        useId: currentSkillUseId()
      },
      { reply: true, timeout: 20000 }
    );
    const failure = relayFailureMessage(outcome, `empurrar com ${label}`);
    if (failure) {
      ui.notifications?.warn(failure);
      result.lines.push(`empurrão: ${outcome?.reason === RELAY_REASONS.timeout ? "pedido enviado ao Mestre (sem resposta)" : "não aplicado"}`);
      continue;
    }
    result.lines.push(...(outcome.value?.lines ?? []).map(String));
    result.moved += Number(outcome.value?.moved) || 0;
  }
  return result;
}

/* ------------------------------------------------------------------ Arma de gravidade */

/**
 * "Atacar" com uma arma no modo gravidade: pergunta Empurrar/Puxar, gasta o carregador, confere o
 * alcance e a Interferência como qualquer arma e pede o empurrão ao Mestre. Não rola dano.
 */
export async function useGravityWeapon(sourceActor, weaponItem, targetActor) {
  const weapon = weaponItem?.system?.weapon;
  if (!weapon?.enabled || weapon.mode !== "gravity") return null;
  if (!isForcedMovementEnabled()) {
    ui.notifications?.warn("O recurso Empurrar e puxar está desligado nesta mesa.");
    return null;
  }
  if (!(Number(weapon.pushMeters) > 0)) {
    ui.notifications?.warn(`${weaponItem.name} não tem os metros do empurrão configurados.`);
    return null;
  }
  if (blockIfIncapacitated(sourceActor, "atacar")) return null;
  const magazine = magazineState({ size: weapon.magazineSize, loaded: weapon.loaded, capacity: weapon.loadedAmmo?.capacity });
  if (magazine.uses && magazine.empty) {
    ui.notifications?.warn(`${weaponItem.name} está sem munição — use Recarregar.`);
    return null;
  }
  if (!targetActor || sameActor(targetActor, sourceActor)) {
    ui.notifications?.warn("Escolha um alvo para empurrar ou puxar.");
    return null;
  }
  if (isShipLike(targetActor)) {
    ui.notifications?.warn("Nave e Veículo não são empurrados (o Raio Trator é o que puxa).");
    return null;
  }

  const shotMech = { isMagicDamage: Boolean(weapon.isMagicDamage), isTech: itemIsTech(weaponItem.system), weaponShot: true, level: 1 };
  const gate = fieldGate(sourceActor, shotMech);
  if (gate.blocked) {
    ui.notifications?.warn(gate.blocked);
    return null;
  }
  if (gate.resisted) await creditManipulation(gate.skill);
  if (!(await checkFlatRange(sourceActor, targetActor, weapon.range, { label: weaponItem.name }))) return null;
  const direction = await promptPushDirection(weaponItem.name);
  if (!direction) return null;
  if (!canvas?.ready || !canvas.scene) {
    ui.notifications?.warn("Empurrar/Puxar precisa de uma cena aberta.");
    return null;
  }
  const origin = pushOriginFor(sourceActor, {});
  const tokenUuid = tokenUuidFor(targetActor);
  if (!origin || !tokenUuid) {
    ui.notifications?.warn("Faltou o Token de quem atira ou do alvo na cena.");
    return null;
  }

  // O disparo gasta o carregador mesmo se a interferência o anular.
  const am = await chargeAntimagic(sourceActor, { ...shotMech, fieldGated: true }, [targetActor], { origin: null });
  const nulled = am.nulled.has(targetActor.uuid);
  let lines = [];
  if (!nulled) {
    const outcome = await runAsGm(
      "forcedMove",
      { kind: "weapon", sourceUuid: weaponItem.uuid, direction, sceneId: canvas.scene.id, origin, tokenUuids: [tokenUuid], useId: "" },
      { reply: true, timeout: 20000 }
    );
    const failure = relayFailureMessage(outcome, `empurrar com ${weaponItem.name}`);
    if (failure) {
      ui.notifications?.warn(failure);
      return null;
    }
    lines = (outcome.value?.lines ?? []).map(String);
  }
  if (magazine.uses) await weaponItem.update({ "system.weapon.loaded": magazine.loaded - 1 });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p><strong>${escapeHtml(sourceActor.name)}</strong> disparou <strong>${escapeHtml(weaponItem.name)}</strong> em <strong>${escapeHtml(targetActor.name)}</strong> (${direction === "pull" ? "puxar" : "empurrar"})${nulled ? escapeHtml(am.note) : ""}${lines.length ? `: ${lines.map(escapeHtml).join("; ")}` : ""}.</p>`
  });
  return true;
}

/* ------------------------------------------------------------------ Lado do Mestre */

/** Resistência (fração) do alvo ao elemento: a do próprio elemento e a de cada ancestral, encadeadas. */
function elementResistance(actor, elementId) {
  const chain = damageElementChain(elementId).map(el => el.id);
  const ids = chain.length ? chain : [elementId];
  return chainedResistance(ids.map(id => resistanceSourceFor(actor, id).percent));
}

/** Rola o atributo de combate pela fórmula do sistema (pool de d20 + bônus por fora), sem card no chat. */
async function rollContestAttribute(actor, key) {
  const attr = actor?.system?.attributes?.combat?.[key];
  if (!attr) return { total: 0, key, missing: true };
  const roll = await new Roll(buildAttributeRollFormula(attr.bonus, Number(attr.itemBonus) || 0, luckOf(actor, "attributes"))).evaluate();
  return { total: roll.total, key, roll };
}

/** O que o Mestre precisa saber do pedido, refeito da Skill/consumível/arma que está na ficha. */
function resolvePushSpec(item, payload) {
  const clampPower = Math.min(1000, Math.max(0.01, Number(payload.investPower) || 1));
  if (payload.kind === "weapon") {
    const weapon = item.system?.weapon;
    if (!weapon?.enabled || weapon.mode !== "gravity") return { error: "esta arma não é de gravidade" };
    const direction = payload.direction === "pull" ? "pull" : payload.direction === "push" ? "push" : null;
    if (!direction) return { error: "faltou a direção" };
    return {
      label: item.name,
      // Maestria de arma (H6): o mesmo % do dano, refeito aqui do que está na ficha do dono.
      meters: Math.max(0, gravityWeaponMeters(item.parent, item, Number(weapon.pushMeters) || 0)),
      direction,
      magical: Boolean(weapon.isMagicDamage),
      scalingAttribute: weapon.scalingAttribute || "",
      elements: weapon.damageElements ?? [],
      immuneTraits: []
    };
  }
  let mech;
  let label = item.name;
  let magical = false;
  if (item.type === "skill") {
    mech = item.system;
    const index = payload.subSkillIndex;
    if (Number.isInteger(index)) {
      const sub = (item.system.subSkills ?? [])[index];
      if (!sub) return { error: "a Sub-Skill não existe mais" };
      mech = sub;
      label = `${item.name} — ${sub.name}`;
    } else if (Number.isInteger(payload.partIndex) && isCombinedSkill(item.system)) {
      const part = item.system.subSkills[payload.partIndex];
      if (!part) return { error: "a parte da Combinada não existe mais" };
      mech = combinedPartMech(item.system, part, { magic: isMagicUse(item.system, item.parent), tech: isTechUse(item.system, item.parent) });
      label = `${item.name} — ${part.name}`;
    }
    magical = skillIsMagic({ ...(typeof mech.toObject === "function" ? mech.toObject() : mech), tier: item.system.tier });
  } else if (item.system?.consumable?.enabled) {
    // Consumível: a mecânica é a mesma de uma Skill (nível 1, sem Custo).
    mech = { effects: item.system.consumable.effects ?? [], level: 1 };
    magical = Boolean(item.system.consumable.isMagicDamage);
  } else {
    return { error: "a origem não aplica Efeitos" };
  }
  const entry = (mech.effects ?? [])[payload.entryIndex];
  if (entry?.target !== "push" || !(Number(entry.amount) > 0)) return { error: "o efeito de empurrar não existe mais" };
  const setting = normalizePushDirection(entry.pushDirection);
  const direction = setting === "choose" ? (payload.direction === "pull" ? "pull" : payload.direction === "push" ? "push" : null) : setting;
  if (!direction) return { error: "faltou a direção" };
  const levelPower = item.type === "skill" ? skillLevelBonuses(mech.level).power : 1;
  return {
    label,
    meters: Math.max(0, Number(entry.amount) * levelPower * clampPower),
    direction,
    magical,
    scalingAttribute: "",
    elements: Array.isArray(entry.damageElements) ? entry.damageElements : [],
    immuneTraits: Array.isArray(entry.immuneTraits) ? entry.immuneTraits : []
  };
}

/**
 * Card de dano Contundente (ou Físico, se o catálogo não tiver Contundente) com Aplicar — o de impacto
 * do empurrão e o de queda. As defesas do alvo valem como num golpe comum.
 * @param {{tokenDoc: TokenDocument, actor: Actor, source?: Actor|null, raw: number, headline: string,
 *   traceLabel: string, label: string, useId?: string}} args
 * @returns {Promise<number>} o dano final (depois das reduções)
 */
export async function postBluntDamageCard({ tokenDoc, actor, source = null, raw, headline, traceLabel, label, useId = "" }) {
  const elementId = getDamageElement("blunt") ? "blunt" : getDamageElement("physical") ? "physical" : null;
  const mech = { damageElements: elementId ? [elementId] : [], isMagicDamage: false, isAbsoluteDamage: false };
  const reduction = applyDamageReductions(raw, mech, actor, { attacker: source });
  const flags = withDamageTrace(
    damageApplyFlags(actor, reduction.finalDamage, {
      reactions: cardReactions(reduction.reactions),
      shieldBase: reduction.shieldBase,
      elementIds: reduction.elementIds,
      shieldExtra: reduction.shieldExtra ?? 0,
      shieldMultiplier: reduction.shieldMultiplier ?? 1,
      shieldPenetration: reduction.shieldPenetration ?? 0,
      triggeredConditions: reduction.triggeredConditions ?? [],
      sever: reduction.sever,
      label
    }),
    [{ name: tokenDoc.name, rows: [{ label: traceLabel, value: String(raw) }, ...personalTraceTail(reduction, actor)] }]
  );
  const chatFlags = { ...flags, [SYSTEM_ID]: { ...(flags[SYSTEM_ID] ?? {}), ...(useId ? { skillUseId: useId } : {}) } };
  await ChatMessage.create({
    speaker: { alias: label },
    content: `<p>${headline}: <strong>${reduction.finalDamage}</strong> de dano${elementId ? ` (${escapeHtml(getDamageElement(elementId)?.label ?? elementId)})` : ""}.</p>`,
    flags: chatFlags
  });
  return reduction.finalDamage;
}

/**
 * O dano de impacto de um Token que bateu: card com Aplicar, e a Estrutura que o parou leva o mesmo dano.
 * @returns {Promise<{damage:number, structure:string|null}>}
 */
async function applyImpact({ scene, tokenDoc, actor, source, leftover, wall, useId }) {
  const percent = getFeatureOption("forcedMovement", "collisionPercent");
  const raw = impactDamage({ leftover, maxHp: actor.system?.attributes?.hp?.max, percent });
  if (!(raw > 0)) return { damage: 0, structure: null };

  let structureLabel = null;
  if (wall?.structure) {
    const { structuresOnScene, damageStructure } = await import("../structures/structures.js");
    const instance = structuresOnScene(scene).find(i => i.id === wall.structure);
    if (instance) {
      structureLabel = instance.label ?? "Estrutura";
      await damageStructure(scene, instance.id, raw);
    }
  }
  const damage = await postBluntDamageCard({
    tokenDoc,
    actor,
    source,
    raw,
    headline: `<strong>${escapeHtml(tokenDoc.name)}</strong> bateu em ${escapeHtml(structureLabel ?? "uma parede")} com ${escapeHtml(fmt(leftover))} m de empurrão a mais`,
    traceLabel: `Impacto: ${fmt(leftover)} m a mais × ${percent}% da Vida máxima`,
    label: "Impacto",
    useId
  });
  return { damage, structure: structureLabel };
}

/**
 * Lado do Mestre do pedido `forcedMove` (ver o relay). Refaz a mecânica da Skill/arma da ficha, rola o
 * teste de Defesa (uma rolagem de quem empurra para todos), move cada Token em linha reta até a primeira
 * parede e cuida do impacto. Devolve `{lines, moved}` — as linhas viram parte do card de quem pediu.
 * @param {object} payload
 */
export async function forcedMoveAsGm(payload) {
  if (!isForcedMovementEnabled()) return refuse("o recurso Empurrar e puxar está desligado");
  const item = typeof payload?.sourceUuid === "string" ? await fromUuid(payload.sourceUuid) : null;
  const source = item?.parent;
  if (item?.documentName !== "Item" || !source) return refuse(RELAY_REASONS.invalid);
  const scene = typeof payload.sceneId === "string" ? game.scenes.get(payload.sceneId) : null;
  if (!scene) return refuse("a cena não existe mais");
  const origin = { x: Number(payload.origin?.x), y: Number(payload.origin?.y) };
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return refuse(RELAY_REASONS.invalid);
  const maxX = (scene.dimensions?.width ?? 1e6) + 1e4;
  const maxY = (scene.dimensions?.height ?? 1e6) + 1e4;
  if (origin.x < -1e4 || origin.y < -1e4 || origin.x > maxX || origin.y > maxY) return refuse(RELAY_REASONS.invalid);

  const spec = resolvePushSpec(item, payload);
  if (spec.error) return refuse(spec.error);
  if (!(spec.meters > 0)) return refuse("o empurrão não tem metros");

  const uuids = Array.isArray(payload.tokenUuids) ? [...new Set(payload.tokenUuids.filter(u => typeof u === "string"))].slice(0, 40) : [];
  const scale = pxPerUnit(scene);
  const walls = moveBlockingWalls(scene);
  const attrs = pushContestAttributes({ magical: spec.magical, scalingAttribute: spec.scalingAttribute });
  const pusherKey = source.system?.attributes?.combat?.[attrs.pusher] ? attrs.pusher : "strength";
  const pusher = await rollContestAttribute(source, pusherKey);
  const verb = spec.direction === "pull" ? "puxado" : "empurrado";
  const lines = [];
  let moved = 0;

  for (const uuid of uuids) {
    const tokenDoc = await fromUuid(uuid);
    if (tokenDoc?.documentName !== "Token" || tokenDoc.parent?.id !== scene.id) continue;
    const actor = tokenDoc.actor;
    const name = tokenDoc.name || actor?.name || "Alvo";
    if (!actor) continue;
    if (isShipLike(actor)) {
      lines.push(`${name}: Nave/Veículo não é empurrado`);
      continue;
    }
    const traits = actorTraits(actor);
    const immune = spec.immuneTraits.some(id => traits.includes(id));
    const resistance = averageResistance(spec.elements.map(id => elementResistance(actor, id)));
    const meters = effectivePushMeters({
      meters: spec.meters,
      magical: spec.magical,
      magicDefense: spec.magical ? magicDefenseReduction(actor) : 0,
      elementResistance: resistance,
      immune
    });
    if (meters <= 0) {
      lines.push(`${name}: não sai do lugar (${immune ? "Traço imune" : "a resistência anulou"})`);
      continue;
    }

    const defender = await rollContestAttribute(actor, attrs.defender);
    const { defenderWins } = pushContest({ pusherTotal: pusher.total, defenderTotal: defender.total });
    const final = metersAfterContest(meters, defenderWins);
    const test = `${getAttributeLabel(pusherKey)} ${pusher.total} × ${getAttributeLabel(attrs.defender)} ${defender.total}`;

    const size = Number(scene.grid?.size) || 100;
    const center = tokenDocCenter(tokenDoc, size);
    const planned = pushDestination({ origin, target: center, meters: final, direction: spec.direction, pxPerUnit: scale });
    if (!(planned.meters > 0)) {
      lines.push(`${name}: não sai do lugar (${test})`);
      continue;
    }
    const radiusPx = ((Number(tokenDoc.width) || 1) * size) / 2;
    const stop = pathStop(center, planned, walls, radiusPx);
    const traveled = stop.traveledPx / scale;
    if (stop.traveledPx > 0.5) {
      const half = { x: (Number(tokenDoc.width) || 1) * size / 2, y: (Number(tokenDoc.height) || 1) * size / 2 };
      await moveTokenForced(tokenDoc, { x: stop.point.x - half.x, y: stop.point.y - half.y });
      moved += 1;
    }

    let text = defenderWins
      ? `${name} resistiu: ${verb} só ${fmt(traveled)} m (${test})`
      : `${name} ${verb} ${fmt(traveled)} m (${test})`;
    const left = stop.hit ? leftoverMeters(planned.meters, traveled) : 0;
    if (left > 0) {
      const impact = await applyImpact({ scene, tokenDoc, actor, source, leftover: left, wall: stop.hit, useId: typeof payload.useId === "string" ? payload.useId.slice(0, 32) : "" });
      text += `, bateu em ${impact.structure ?? "uma parede"} (${fmt(left)} m a mais${impact.damage ? ` → ${impact.damage} de impacto` : ""})`;
    }
    lines.push(text);
  }
  return { ok: true, value: { lines, moved } };
}
