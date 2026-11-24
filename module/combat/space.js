/**
 * Manipulação do espaço (8f, lotes 1 e 2) — o lado Foundry. As contas são puras, em `space-rules.js` (testado).
 *
 * **Saltar e Trocar** (efeito de Skill "Espaço"):
 *  - Quem USA a Skill escolhe, ANTES de pagar o Custo (`planSpaceUse`, um passo de `runSkillEffect`): o ponto no mapa (Saltar)
 *    ou o outro Token (Trocar). Ali também vão o alcance (com a Marca que dobra a distância, como as formas), as paredes (se a
 *    Skill as respeita), o Parado e a **Âncora**; qualquer recusa é um aviso na tela e **nada é gasto**.
 *  - Quem MOVE os Tokens é só o Mestre designado, pelo relay `spaceMove` (`spaceMoveAsGm`): ele refaz a mecânica da Skill que está
 *    na ficha (modo, paredes, alcance, nível), exige que quem pede seja dono dela, e revalida tudo do zero (alcance, Marca,
 *    paredes, Parado, Âncora). Do cliente só vêm os Tokens, o ponto e a Marca.
 *  - O teleporte NÃO desliza (o Token some e aparece) e passa pelos mesmos ganchos de fim de movimento do empurrão (campo de
 *    Antimagia, contato de Estrutura, Regiões, armadilhas). A elevação de cada Token fica como estava. O Desfazer uso guarda as
 *    posições (os Atores movidos entram no registro por `noteUseActor`); o Reverter (8e) devolve a posição que fotografou.
 *
 * **Âncora** (lote 2): bloqueia o que é espacial como a Antimagia bloqueia o mágico, por três fontes lidas aqui:
 *  - a Condição **Ancorado** no Token (`anchorLevel` da Condição; o nível vale o da Skill que ancorou, `sourceLevel` do efeito);
 *  - a Estrutura **Campo de Âncora** (`anchorLevel` do catálogo, `structures.js` `anchorFieldsAtPoint`);
 *  - o comportamento de Região **"Âncora (Nihility)"** (`nihilityAnchor`, o Mestre desenha a Região).
 *  Uma Skill de Zona com a Condição Ancorado ancora quem começa o turno dentro (a Zona só aplica efeitos). O teleporte que começa
 *  ou termina numa Âncora, ou é de quem usa/quem é movido Ancorado, falha se o nível da Âncora for igual ou maior que o da Skill.
 *
 * **Interdição** de Naves: `starship/interdiction.js` (Módulo com `interdictRange`), outra coisa no jogo que a Âncora.
 *
 * **Portal** (lote 3): quem usa escolhe as duas pontas antes de pagar (`planPortal`); o Mestre cria o par de Regiões com o "Teleport
 * Token" do core, nos dois sentidos, pelo relay `spaceRegion` (`spaceRegionAsGm`), com a duração no flag `space` da Região (rodadas em
 * combate, relógio do mundo fora). Pode ligar outra cena (o ponto inicial dela ou uma Marca de quem abre). A Âncora impede abrir; o
 * `preMoveToken` (`onPreMoveToken`) não deixa o Ancorado entrar. **Bolso** (lote 4): o contêiner concedido com 100% de redução e espaços
 * pelo nível (`pocketContainerOf` em `space-rules.js`, lido por `deriveInventory`); `pocketOpenBlock` barra o Ancorado.
 * **Domínio** (lote 5): uma Região com o comportamento "Domínio (Nihility)" que aplica a Condição Preso a quem entra (`trapActor`), com
 * ritmo de tempo próprio opcional (um segundo comportamento `nihilityTimeRate` na mesma Região).
 */
import {
  SYSTEM_ID,
  NIHILITY,
  sameActor,
  getActiveStatusConditions,
  isSpaceManipulationEnabled,
  isTimeManipulationEnabled,
  isSkillRangeEnabled
} from "../core/config.js";
import { runAsGm, mayActFor, isDesignatedGm } from "../helpers/gm-relay.js";
import { RELAY_REASONS, refuse, relayFailureMessage } from "../helpers/gm-relay-rules.js";
import { tokenElevation, effectRoundsUpdate } from "../helpers/foundry-compat.js";
import { reportError } from "../helpers/report.js";
import { escapeHtml } from "../helpers/html.js";
import { applyCondition } from "../environment/environment.js";
import { inStartedCombat } from "../skills/preparation.js";
import { TIME_RATE_BEHAVIOR } from "../core/calendar-rules.js";
import { isShipLike } from "../starship/ship-damage.js";
import { currentSkillUseId, noteUseActor } from "../skills/skill-use-context.js";
import { anchorFieldsAtPoint } from "../structures/structures.js";
import { pickCanvasPoint } from "../npc/npc-generator.js";
import { casterTokenOf, targetTokenOf, reachContext, pointReach, viaMarkFrom, pxPerUnit, markEffectOn, rangeChecksActive, measureTokenDistance } from "./range.js";
import { pointDistance, meters } from "./range-rules.js";
import { tokenDocCenter } from "./area-geometry.js";
import { isTimeStopped, blockIfTimeStopped } from "./time-stop-state.js";
import { moveTokenForced, moveBlockingWalls } from "./forced-movement.js";
import {
  spaceEntriesOf,
  spaceModeIsLive,
  normalizeSpaceMode,
  spaceModeLabel,
  skillTeleports,
  centerOf,
  cornerFor,
  swapDestinations,
  pathCrossesWalls,
  jumpInRange,
  swapInRange,
  anchorVerdict,
  anchorBlockText,
  spaceLife,
  advanceSpaceLife,
  spaceLifeExpired,
  spaceLifeToWorld,
  spaceLifeText,
  portalRadiusMeters,
  portalBlockText,
  portalCrossText,
  portalInRange,
  pocketEntryOf,
  pocketSlots,
  POCKET_DEFAULTS,
  pocketBlockText,
  domainRadiusMeters,
  bestSpatialLevel,
  domainEscapes,
  domainBlocksMove,
  domainTimeRate,
  domainBlockText,
  PRESO_CONDITION_ID
} from "./space-rules.js";

export const ANCHOR_BEHAVIOR = "nihilityAnchor";
/** O comportamento de Região do Domínio (8f, lote 5) e a chave do flag de Região que marca Portal e Domínio. */
export const DOMAIN_BEHAVIOR = "nihilityDomain";
export const SPACE_FLAG = "space";

/* ------------------------------------------------------------------ Âncora: as três fontes */

/** Condição Ancorado (e qualquer Condição com `anchorLevel`) no Ator: `[{kind: "condition", level}]`. */
export function conditionAnchorSources(actor) {
  const anchored = getActiveStatusConditions().filter(c => Number(c.anchorLevel) > 0);
  if (!anchored.length || !actor?.effects) return [];
  const out = [];
  for (const effect of actor.effects) {
    if (effect.disabled) continue;
    for (const status of effect.statuses ?? []) {
      const condition = anchored.find(c => c.id === status);
      if (!condition) continue;
      // O nível da Skill que ancorou manda; posta à mão, vale o do catálogo.
      const fromSkill = Number(effect.flags?.[SYSTEM_ID]?.sourceLevel) || 0;
      out.push({ kind: "condition", level: fromSkill > 0 ? fromSkill : Number(condition.anchorLevel) || 1, label: condition.label });
    }
  }
  return out;
}

/** O comportamento de Região "Âncora (Nihility)" que contém o ponto: `[{kind: "region", level, label}]`. */
export function regionAnchorSources(scene, point, elevation = 0) {
  const out = [];
  for (const region of scene?.regions ?? []) {
    for (const behavior of region.behaviors ?? []) {
      if (behavior.type !== ANCHOR_BEHAVIOR || behavior.disabled) continue;
      let inside = false;
      try {
        inside = Boolean(region.testPoint?.({ x: point.x, y: point.y }, elevation));
      } catch (err) {
        console.warn(`${SYSTEM_ID} | Âncora: não consegui testar a Região "${region.name}".`, err);
      }
      if (inside) out.push({ kind: "region", level: Math.max(1, Math.floor(Number(behavior.system?.level) || 1)), label: region.name ? `a Âncora "${region.name}"` : "" });
    }
  }
  return out;
}

/** Âncoras de lugar (Estrutura e Região) num ponto da cena. */
export function placeAnchorSources(scene, point, elevation = 0) {
  return [...anchorFieldsAtPoint(scene, point), ...regionAnchorSources(scene, point, elevation)];
}

/**
 * Confere as Âncoras de um teleporte, só por documentos (serve ao cliente e ao Mestre).
 * @param {{scene: Scene, skillLevel: number, label: string,
 *   moves: Array<{tokenDoc: TokenDocument, destCenter: {x:number,y:number}}>,
 *   caster?: {actor: Actor, tokenDoc: TokenDocument}|null}} args
 * @returns {{blocked: boolean, text?: string}}
 */
export function anchorCheck({ scene, skillLevel, label, moves, caster = null }) {
  const size = Number(scene?.grid?.size) || 100;
  const endpoints = [];
  const movedUuids = new Set();
  for (const { tokenDoc, destCenter } of moves) {
    const actor = tokenDoc.actor;
    const center = tokenDocCenter(tokenDoc, size);
    const name = tokenDoc.name || actor?.name || "Alguém";
    movedUuids.add(actor?.uuid);
    endpoints.push({ name, role: "origin", sources: [...conditionAnchorSources(actor), ...placeAnchorSources(scene, center, tokenElevation(tokenDoc))] });
    endpoints.push({ name, role: "destination", sources: placeAnchorSources(scene, destCenter, tokenElevation(tokenDoc)) });
  }
  // Quem usa a Skill também não teleporta preso (Ancorado, ou dentro de um campo), mesmo movendo outra pessoa.
  if (caster?.actor && !movedUuids.has(caster.actor.uuid) && caster.tokenDoc) {
    const center = tokenDocCenter(caster.tokenDoc, size);
    endpoints.push({
      name: caster.tokenDoc.name || caster.actor.name,
      role: "origin",
      sources: [...conditionAnchorSources(caster.actor), ...placeAnchorSources(scene, center, tokenElevation(caster.tokenDoc))]
    });
  }
  const verdict = anchorVerdict({ skillLevel, endpoints });
  return verdict.blocked ? { blocked: true, text: anchorBlockText(label, verdict) } : { blocked: false };
}

/* ------------------------------------------------------------------ Quem pede: o plano (antes do Custo) */

function warn(text) {
  ui.notifications?.warn(text);
}

/** O Token (placeable) é de Nave/Veículo? Eles não são teleportados. */
function tokenIsShip(token) {
  return isShipLike(token?.actor);
}

/** O canto do Token cujo centro vai a `center`, preso à grade (a grade sem encaixe devolve o ponto). */
function snappedCorner(center, size) {
  const corner = cornerFor(center, size);
  try {
    const snapped = canvas.grid?.getSnappedPoint?.(corner, { mode: CONST.GRID_SNAPPING_MODES?.TOP_LEFT_CORNER ?? 2 });
    if (snapped && Number.isFinite(snapped.x) && Number.isFinite(snapped.y)) return { x: snapped.x, y: snapped.y };
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Espaço: não consegui encaixar o ponto na grade.`, err);
  }
  return corner;
}

/** O Token (placeable) sob um ponto do mapa, ou null. */
function tokenAtPoint(point) {
  return (canvas.tokens?.placeables ?? []).find(t => t.visible !== false && t.bounds?.contains?.(point.x, point.y)) ?? null;
}

async function planJump({ sourceActor, mech, entry, index, options, scene, casterToken, label }) {
  const self = mech.targetType === "self" || !options.targetActor || sameActor(options.targetActor, sourceActor);
  const movedActor = self ? sourceActor : options.targetActor;
  const movedToken = self ? casterToken : targetTokenOf(movedActor);
  if (!movedToken) {
    warn(`${label}: ${movedActor?.name ?? "o alvo"} não tem Token nesta cena.`);
    return { stop: true };
  }
  if (tokenIsShip(movedToken)) {
    warn(`${label}: Nave e Veículo não são teleportados.`);
    return { stop: true };
  }
  if (blockIfTimeStopped(movedActor, "ser teleportado")) return { stop: true };

  const point = await pickCanvasPoint(`${label}: clique no ponto de chegada de ${movedToken.name} (Esc cancela).`);
  if (!point) return { stop: true };

  // Alcance: dentro do círculo de quem usa, ou (dobrar a distância) dentro do círculo de uma Marca dele.
  const range = Number(mech.range) || 0;
  const reach = reachContext(sourceActor, { range, free: true, marks: true });
  let via = null;
  if (reach && reach.rangePx > 0) {
    const reached = pointReach(reach, point);
    if (!reached) {
      warn(`${label}: o ponto está fora do alcance (${meters(range)}).`);
      return { stop: true };
    }
    via = reached.via ? viaMarkFrom(reached.via, reach) : null;
  }

  const size = { w: movedToken.w, h: movedToken.h };
  const corner = snappedCorner(point, size);
  const destCenter = centerOf({ ...corner, ...size });
  if (entry.spaceWalls && pathCrossesWalls(movedToken.center, destCenter, moveBlockingWalls(scene))) {
    warn(`${label}: há uma parede no caminho (esta Skill respeita paredes).`);
    return { stop: true };
  }
  const anchor = anchorCheck({
    scene,
    skillLevel: mech.level,
    label,
    moves: [{ tokenDoc: movedToken.document, destCenter }],
    caster: { actor: sourceActor, tokenDoc: casterToken.document }
  });
  if (anchor.blocked) {
    warn(anchor.text);
    return { stop: true };
  }
  noteUseActor(movedActor);
  return { plan: { index, mode: "jump", tokenUuid: movedToken.document.uuid, center: { x: destCenter.x, y: destCenter.y }, markUuid: via?.markUuid ?? "", casterTokenUuid: casterToken.document.uuid }, via };
}

async function planSwap({ sourceActor, mech, entry, index, options, scene, casterToken, label }) {
  const target = options.targetActor;
  if (!target || sameActor(target, sourceActor)) {
    warn(`${label}: escolha um alvo para trocar de lugar.`);
    return { stop: true };
  }
  const first = targetTokenOf(target);
  if (!first) {
    warn(`${label}: ${target.name} não tem Token nesta cena.`);
    return { stop: true };
  }
  let second = casterToken;
  if (entry.spaceSwapOther) {
    const point = await pickCanvasPoint(`${label}: clique no Token que troca de lugar com ${first.name} (Esc cancela).`);
    if (!point) return { stop: true };
    second = tokenAtPoint(point);
    if (!second || second.id === first.id) {
      warn(`${label}: não havia um outro Token nesse ponto.`);
      return { stop: true };
    }
  }
  if (tokenIsShip(first) || tokenIsShip(second)) {
    warn(`${label}: Nave e Veículo não trocam de lugar.`);
    return { stop: true };
  }
  if (blockIfTimeStopped(first.actor, "trocar de lugar") || blockIfTimeStopped(second.actor, "trocar de lugar")) return { stop: true };

  const range = Number(mech.range) || 0;
  if (range > 0 && rangeChecksActive()) {
    const distances = [first, second].filter(t => t.id !== casterToken.id).map(t => measureTokenDistance(casterToken, t));
    const verdict = swapInRange(distances, range);
    if (!verdict.ok) {
      warn(`${label}: fora do alcance (${meters(verdict.farthest)} de ${meters(range)}).`);
      return { stop: true };
    }
  }
  if (entry.spaceWalls && pathCrossesWalls(first.center, second.center, moveBlockingWalls(scene))) {
    warn(`${label}: há uma parede entre os dois (esta Skill respeita paredes).`);
    return { stop: true };
  }
  const anchor = anchorCheck({
    scene,
    skillLevel: mech.level,
    label,
    moves: [
      { tokenDoc: first.document, destCenter: second.center },
      { tokenDoc: second.document, destCenter: first.center }
    ],
    caster: { actor: sourceActor, tokenDoc: casterToken.document }
  });
  if (anchor.blocked) {
    warn(anchor.text);
    return { stop: true };
  }
  noteUseActor(first.actor);
  noteUseActor(second.actor);
  return { plan: { index, mode: "swap", tokenUuid: first.document.uuid, otherUuid: second.document.uuid, casterTokenUuid: casterToken.document.uuid }, via: null };
}

/**
 * O plano de uso de uma Skill com efeito de Espaço, ANTES do Custo: escolhe o ponto/Token e confere tudo que dá para conferir daqui
 * (feature, cena, Parado, alcance, paredes, Âncora). `{stop: true}` = o uso não segue (aviso já na tela, nada gasto).
 * Sem efeito de Espaço, `{plan: null}`. `via` é a Marca usada para dobrar a distância (o Custo sobe como nas formas).
 * @returns {Promise<{stop?: boolean, plan?: Array<object>|null, via?: object|null}>}
 */
export async function planSpaceUse({ sourceActor, mech, label, options = {} }) {
  const all = spaceEntriesOf(mech);
  if (!all.length) return { plan: null };
  if (!isSpaceManipulationEnabled()) {
    warn(`${label}: o bloco Manipulação do espaço está desligado nesta mesa.`);
    return { stop: true };
  }
  // O Bolso é passivo (o contêiner já está no inventário): não há o que planejar nem o que pedir ao Mestre.
  const entries = all.filter(({ entry }) => normalizeSpaceMode(entry.spaceMode) !== "pocket");
  if (!entries.length) return { plan: [], via: null };
  if (["emission", "zone"].includes(mech.targetType)) {
    warn(`${label}: Espaço (Saltar, Trocar, Portal, Domínio) vale para si mesmo ou um alvo, não para área.`);
    return { stop: true };
  }
  if (!canvas?.ready || !canvas.scene) {
    warn(`${label}: Espaço precisa de uma cena aberta.`);
    return { stop: true };
  }
  const casterToken = casterTokenOf(sourceActor);
  if (!casterToken) {
    warn(`${label}: ${sourceActor.name} não tem Token nesta cena (selecione o Token).`);
    return { stop: true };
  }
  const plan = [];
  let via = null;
  for (const { entry, index } of entries) {
    const mode = normalizeSpaceMode(entry.spaceMode);
    if (!spaceModeIsLive(mode)) {
      warn(`${label}: o modo ${spaceModeLabel(mode)} não existe.`);
      return { stop: true };
    }
    const planner = { swap: planSwap, portal: planPortal, domain: planDomain }[mode] ?? planJump;
    const step = await planner({ sourceActor, mech, entry, index, options, scene: canvas.scene, casterToken, label });
    if (step.stop) return { stop: true };
    plan.push(step.plan);
    via ??= step.via ?? null;
  }
  return { plan, via };
}

/**
 * Executa o plano (depois do Custo): um pedido `spaceMove` ao Mestre por efeito. Sem plano (uso por Preparo adiantado, por
 * consumível), planeja agora, com o Custo já pago. Devolve as linhas do card do uso e quantos Tokens saíram do lugar (XP por uso).
 * @returns {Promise<{lines: string[], moved: number}>}
 */
export async function runSkillSpace({ sourceActor, item, mech, label, subSkillIndex = null, options = {} }) {
  const result = { lines: [], moved: 0 };
  const entries = spaceEntriesOf(mech);
  if (!entries.length) return result;
  // O Bolso não age no uso: só lembra onde ele está.
  for (const { entry } of entries) {
    if (normalizeSpaceMode(entry.spaceMode) !== "pocket") continue;
    const slots = pocketSlots({ base: entry.pocketBase ?? POCKET_DEFAULTS.base, perLevel: entry.pocketPerLevel ?? POCKET_DEFAULTS.perLevel, level: mech.level });
    result.lines.push(`Bolso dimensional: ${slots} espaços, sem peso (aba Inventário)`);
  }
  if (entries.every(({ entry }) => normalizeSpaceMode(entry.spaceMode) === "pocket")) return result;
  let plan = mech.spacePlan ?? null;
  if (!plan) {
    const late = await planSpaceUse({ sourceActor, mech, label, options });
    if (late.stop || !late.plan?.length) {
      result.lines.push("Espaço: ninguém mudou de lugar");
      return result;
    }
    plan = late.plan;
  }
  for (const step of plan) {
    const outcome = await runAsGm(
      ["portal", "domain"].includes(step.mode) ? "spaceRegion" : "spaceMove",
      {
        ...step,
        sourceUuid: item.uuid,
        subSkillIndex: Number.isInteger(subSkillIndex) ? subSkillIndex : null,
        entryIndex: step.index,
        sceneId: canvas.scene.id,
        useId: currentSkillUseId()
      },
      { reply: true, timeout: 20000 }
    );
    const failure = relayFailureMessage(outcome, ["portal", "domain"].includes(step.mode) ? `abrir ${label}` : `mudar de lugar com ${label}`);
    if (failure) {
      warn(failure);
      result.lines.push(`Espaço: ${outcome?.reason === RELAY_REASONS.timeout ? "pedido enviado ao Mestre (sem resposta)" : "não aplicado"}`);
      continue;
    }
    result.lines.push(...(outcome.value?.lines ?? []).map(String));
    result.moved += Number(outcome.value?.moved) || 0;
  }
  return result;
}

/* ------------------------------------------------------------------ Lado do Mestre */

/** A mecânica e o rótulo da Skill (ou consumível) que está na ficha, refeitos do lado do Mestre. */
function resolveSpaceMech(item, payload) {
  if (item.type === "skill") {
    let mech = item.system;
    const index = payload.subSkillIndex;
    if (Number.isInteger(index)) {
      const sub = (item.system.subSkills ?? [])[index];
      if (!sub) return { error: "a Sub-Skill não existe mais" };
      mech = sub;
    }
    return { mech };
  }
  if (item.system?.consumable?.enabled) return { mech: { effects: item.system.consumable.effects ?? [], level: 1, targetType: "targeted" } };
  return { error: "a origem não aplica Efeitos" };
}

/** O Token de um uuid, na cena, ou null. */
async function sceneToken(uuid, scene) {
  const doc = typeof uuid === "string" ? await fromUuid(uuid) : null;
  return doc?.documentName === "Token" && doc.parent?.id === scene.id ? doc : null;
}

/** Um Token não pode ser movido? O motivo, ou "". */
function cannotMove(tokenDoc) {
  const actor = tokenDoc.actor;
  const name = tokenDoc.name || actor?.name || "Alvo";
  if (!actor) return `${name}: sem ficha`;
  if (isShipLike(actor)) return `${name}: Nave e Veículo não são teleportados`;
  if (isTimeStopped(actor)) return `${name} está Parado no tempo: não é movido`;
  return "";
}

/**
 * Lado do Mestre do pedido `spaceMove`. O pedido não é confiável: a mecânica vem da Skill da ficha, quem pede é dono dela, e
 * alcance, Marca, paredes, Parado e Âncora são conferidos de novo. Devolve `{lines, moved}` (as linhas viram o card de quem usou).
 */
export async function spaceMoveAsGm(payload) {
  if (!isSpaceManipulationEnabled()) return refuse("o bloco Manipulação do espaço está desligado");
  const item = typeof payload?.sourceUuid === "string" ? await fromUuid(payload.sourceUuid) : null;
  const source = item?.parent;
  if (item?.documentName !== "Item" || !source) return refuse(RELAY_REASONS.invalid);
  const scene = typeof payload.sceneId === "string" ? game.scenes.get(payload.sceneId) : null;
  if (!scene) return refuse("a cena não existe mais");
  const resolved = resolveSpaceMech(item, payload);
  if (resolved.error) return refuse(resolved.error);
  const { mech } = resolved;
  const entry = (mech.effects ?? [])[payload.entryIndex];
  if (entry?.target !== "space") return refuse("o efeito de Espaço não existe mais");
  const mode = normalizeSpaceMode(entry.spaceMode);
  if (!["jump", "swap"].includes(mode)) return refuse(`o modo ${spaceModeLabel(mode)} não move Tokens`);

  const casterDoc = await sceneToken(payload.casterTokenUuid, scene);
  if (!casterDoc || !sameActor(casterDoc.actor, source)) return refuse(RELAY_REASONS.invalid);
  const first = await sceneToken(payload.tokenUuid, scene);
  if (!first) return refuse(RELAY_REASONS.invalid);
  if (mech.targetType === "self" && mode === "jump" && first.id !== casterDoc.id) return refuse("esta Skill só teleporta quem a usa");

  const size = Number(scene.grid?.size) || 100;
  const scale = pxPerUnit(scene);
  const range = Number(mech.range) || 0;
  const checkRange = isSkillRangeEnabled() && range > 0;
  const casterCenter = tokenDocCenter(casterDoc, size);
  const label = item.name;
  const walls = entry.spaceWalls ? moveBlockingWalls(scene) : [];
  const lines = [];

  const stuck = cannotMove(first);
  if (stuck) return { ok: true, value: { lines: [stuck], moved: 0 } };

  if (mode === "jump") {
    const dest = { x: Number(payload.center?.x), y: Number(payload.center?.y) };
    if (!Number.isFinite(dest.x) || !Number.isFinite(dest.y)) return refuse(RELAY_REASONS.invalid);
    const maxX = (scene.dimensions?.width ?? 1e6) + 1e4;
    const maxY = (scene.dimensions?.height ?? 1e6) + 1e4;
    if (dest.x < -1e4 || dest.y < -1e4 || dest.x > maxX || dest.y > maxY) return refuse(RELAY_REASONS.invalid);
    if (checkRange) {
      let ok = jumpInRange(pointDistance(casterCenter, dest) / scale, range);
      if (!ok && typeof payload.markUuid === "string" && payload.markUuid) {
        // Dobrar a distância: o ponto está no alcance de uma Marca que quem usa pôs, e o alvo da Marca está nesta cena.
        const markToken = scene.tokens.find(t => t.actor?.uuid === payload.markUuid);
        ok = Boolean(markToken && markEffectOn(markToken.actor, source.uuid) && jumpInRange(pointDistance(tokenDocCenter(markToken, size), dest) / scale, range));
      }
      if (!ok) return { ok: true, value: { lines: [`${label}: o ponto está fora do alcance (${meters(range)})`], moved: 0 } };
    }
    const from = tokenDocCenter(first, size);
    if (entry.spaceWalls && pathCrossesWalls(from, dest, walls)) return { ok: true, value: { lines: [`${label}: há uma parede no caminho`], moved: 0 } };
    const anchor = anchorCheck({ scene, skillLevel: mech.level, label, moves: [{ tokenDoc: first, destCenter: dest }], caster: { actor: source, tokenDoc: casterDoc } });
    if (anchor.blocked) return { ok: true, value: { lines: [anchor.text], moved: 0 } };

    const corner = cornerFor(dest, { w: (Number(first.width) || 1) * size, h: (Number(first.height) || 1) * size });
    const here = { x: first.x, y: first.y };
    const done = await moveTokenForced(first, corner, { teleport: true });
    if (!done) return { ok: true, value: { lines: [`${first.name || "Alvo"}: não saiu do lugar`], moved: 0 } };
    lines.push(`${first.name || "Alvo"} saltou ${meters(pointDistance({ x: here.x, y: here.y }, corner) / scale)}`);
    return { ok: true, value: { lines, moved: 1 } };
  }

  // Trocar
  const second = await sceneToken(payload.otherUuid, scene);
  if (!second || second.id === first.id) return refuse(RELAY_REASONS.invalid);
  const stuckSecond = cannotMove(second);
  if (stuckSecond) return { ok: true, value: { lines: [stuckSecond], moved: 0 } };
  if (checkRange) {
    const distances = [first, second].filter(t => t.id !== casterDoc.id).map(t => pointDistance(casterCenter, tokenDocCenter(t, size)) / scale);
    const verdict = swapInRange(distances, range);
    if (!verdict.ok) return { ok: true, value: { lines: [`${label}: fora do alcance (${meters(verdict.farthest)} de ${meters(range)})`], moved: 0 } };
  }
  const centerA = tokenDocCenter(first, size);
  const centerB = tokenDocCenter(second, size);
  if (entry.spaceWalls && pathCrossesWalls(centerA, centerB, walls)) return { ok: true, value: { lines: [`${label}: há uma parede entre os dois`], moved: 0 } };
  const anchor = anchorCheck({
    scene,
    skillLevel: mech.level,
    label,
    moves: [{ tokenDoc: first, destCenter: centerB }, { tokenDoc: second, destCenter: centerA }],
    caster: { actor: source, tokenDoc: casterDoc }
  });
  if (anchor.blocked) return { ok: true, value: { lines: [anchor.text], moved: 0 } };

  const pixels = t => ({ x: t.x, y: t.y, w: (Number(t.width) || 1) * size, h: (Number(t.height) || 1) * size });
  const swapped = swapDestinations(pixels(first), pixels(second));
  const movedFirst = await moveTokenForced(first, swapped.a, { teleport: true });
  if (!movedFirst) return { ok: true, value: { lines: [`${first.name || "Alvo"}: não saiu do lugar`], moved: 0 } };
  const movedSecond = await moveTokenForced(second, swapped.b, { teleport: true });
  if (!movedSecond) {
    // O segundo não foi: o primeiro volta (o teleporte é de dois ou de nenhum).
    await moveTokenForced(first, { x: pixels(first).x, y: pixels(first).y }, { teleport: true });
    return { ok: true, value: { lines: [`${second.name || "Alvo"}: não saiu do lugar, a troca foi desfeita`], moved: 0 } };
  }
  lines.push(`${first.name || "Alvo"} e ${second.name || "Alvo"} trocaram de lugar`);
  return { ok: true, value: { lines, moved: 2 } };
}

/* ------------------------------------------------------------------ Portal e Domínio (lotes 3 e 5): Regiões temporárias */

const PORTAL_COLOR = "#6ee7ff";
const DOMAIN_COLOR = "#9b7bff";

/** As Regiões de Portal e Domínio de uma cena (as que levam o flag `space`). */
export function spaceRegionsOnScene(scene) {
  return [...(scene?.regions ?? [])].filter(region => region.getFlag(SYSTEM_ID, SPACE_FLAG));
}

function allSpaceRegions() {
  return [...(game.scenes ?? [])].flatMap(scene => spaceRegionsOnScene(scene));
}

/** O maior nível entre as Skills que teleportam de um Ator (a regra de quem escapa do Domínio). */
export function actorSpatialLevel(actor) {
  const levels = [];
  for (const item of actor?.items ?? []) {
    if (item.type !== "skill") continue;
    if (skillTeleports(item.system)) levels.push(Number(item.system.level) || 1);
    for (const sub of item.system.subSkills ?? []) if (skillTeleports(sub)) levels.push(Number(sub.level ?? item.system.level) || 1);
  }
  return bestSpatialLevel(levels);
}

/** O centro de uma cena (onde cai um portal que leva a ela sem Marca). */
function sceneCenterPoint(scene) {
  const d = scene?.dimensions ?? {};
  const init = scene?.initial;
  if (Number.isFinite(init?.x) && Number.isFinite(init?.y)) return { x: init.x, y: init.y };
  return { x: (d.sceneX ?? 0) + (d.sceneWidth ?? d.width ?? 0) / 2, y: (d.sceneY ?? 0) + (d.sceneHeight ?? d.height ?? 0) / 2 };
}

/**
 * Onde um portal pode cair em OUTRA cena: o ponto inicial dela, ou um Token que quem abre marcou lá (a Marca é o "farol" do
 * mockup: "Sim, com Marca na cena"). Quem pede não escolhe um ponto qualquer: o Mestre confere contra esta lista.
 */
export function portalDestinationPoints(source, destScene) {
  if (!destScene) return [];
  const center = sceneCenterPoint(destScene);
  const points = [{ id: "initial", label: "ponto inicial da cena", x: center.x, y: center.y }];
  const size = Number(destScene.grid?.size) || 100;
  for (const token of destScene.tokens ?? []) {
    if (!token.actor || !markEffectOn(token.actor, source.uuid)) continue;
    const c = tokenDocCenter(token, size);
    points.push({ id: `mark:${token.id}`, label: `Marca: ${token.name || token.actor.name}`, x: c.x, y: c.y });
  }
  return points;
}

/** Pergunta a cena de destino e o ponto (uma lista só, sem script na janela). `null` = cancelou. */
async function chooseDestination({ label, scene, source }) {
  const options = [{ value: "here", text: "Esta cena (clicar no mapa)" }];
  for (const other of game.scenes) {
    if (other.id === scene.id) continue;
    for (const point of portalDestinationPoints(source, other)) options.push({ value: `${other.id}|${point.id}`, text: `${other.name} — ${point.label}` });
  }
  if (options.length === 1) return { here: true };
  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: `${label}: onde abre a outra ponta?` },
    classes: ["nihility-portal-dest"],
    content: `<div class="nihility-portal-dest"><p>O portal liga duas pontas, nos dois sentidos, e não deixa ver o outro lado. Escolha onde fica a ponta B.</p><select name="dest">${options.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.text)}</option>`).join("")}</select></div>`,
    buttons: [
      { action: "ok", label: "Abrir o portal", default: true, callback: (event, button) => button.form?.elements?.dest?.value ?? "here" },
      { action: "cancel", label: "Cancelar" }
    ],
    rejectClose: false
  });
  if (!picked || picked === "cancel") return null;
  if (picked === "here") return { here: true };
  const [sceneId, pointId] = String(picked).split("|");
  const destScene = game.scenes.get(sceneId);
  const point = portalDestinationPoints(source, destScene).find(p => p.id === pointId);
  return point ? { here: false, sceneId, x: point.x, y: point.y } : null;
}

/** O ponto cai dentro do mapa da cena? Uma ponta fora dele deixa o teleporte do core falhar em silêncio (o Token nem anda). */
function pointInSceneRect(scene, point) {
  const rect = scene?.dimensions?.sceneRect;
  if (!rect || !point) return true;
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

async function planPortal({ sourceActor, mech, entry, index, scene, casterToken, label }) {
  if (tokenIsShip(casterToken)) {
    warn(`${label}: Nave e Veículo não abrem portais.`);
    return { stop: true };
  }
  if (blockIfTimeStopped(sourceActor, "abrir um portal")) return { stop: true };
  const range = Number(mech.range) || 0;
  const checkRange = range > 0 && rangeChecksActive();
  const scale = pxPerUnit(scene);
  const casterCenter = casterToken.center;
  const snapCenter = point => {
    try {
      const c = canvas.grid?.getCenterPoint?.(point);
      if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) return { x: c.x, y: c.y };
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Portal: não consegui centrar o ponto na grade.`, err);
    }
    return { x: point.x, y: point.y };
  };

  const rawA = await pickCanvasPoint(`${label}: clique onde abre a ponta A do portal (Esc cancela).`);
  if (!rawA) return { stop: true };
  const a = snapCenter(rawA);
  if (!pointInSceneRect(scene, a)) {
    warn(`${label}: a ponta A fica fora do mapa. Clique dentro da cena.`);
    return { stop: true };
  }
  if (checkRange && !portalInRange([pointDistance(casterCenter, a) / scale], range).ok) {
    warn(`${label}: a ponta A está fora do alcance (${meters(range)}).`);
    return { stop: true };
  }

  let b = null;
  let destScene = scene;
  if (entry.spaceOtherScene) {
    const choice = await chooseDestination({ label, scene, source: sourceActor });
    if (!choice) return { stop: true };
    if (!choice.here) {
      destScene = game.scenes.get(choice.sceneId);
      b = { x: choice.x, y: choice.y };
    }
  }
  if (!b) {
    const rawB = await pickCanvasPoint(`${label}: clique onde abre a ponta B do portal (Esc cancela).`);
    if (!rawB) return { stop: true };
    b = snapCenter(rawB);
    if (!pointInSceneRect(scene, b)) {
      warn(`${label}: a ponta B fica fora do mapa. Clique dentro da cena.`);
      return { stop: true };
    }
    if (checkRange && !portalInRange([pointDistance(casterCenter, b) / scale], range).ok) {
      warn(`${label}: a ponta B está fora do alcance (${meters(range)}).`);
      return { stop: true };
    }
  }
  const anchor = portalAnchorCheck({ sourceActor, casterDoc: casterToken.document, scene, a, destScene, b, level: mech.level, label });
  if (anchor.blocked) {
    warn(anchor.text);
    return { stop: true };
  }
  return { plan: { index, mode: "portal", casterTokenUuid: casterToken.document.uuid, a, b: { sceneId: destScene.id, x: b.x, y: b.y } }, via: null };
}

async function planDomain({ sourceActor, mech, entry, index, scene, casterToken, label }) {
  if (tokenIsShip(casterToken)) {
    warn(`${label}: Nave e Veículo não erguem Domínios.`);
    return { stop: true };
  }
  if (blockIfTimeStopped(sourceActor, "erguer um Domínio")) return { stop: true };
  // Quem usa não pode estar preso numa Âncora (o Domínio é espacial): só as Âncoras do lugar e as Condições dele.
  const anchor = portalAnchorCheck({ sourceActor, casterDoc: casterToken.document, scene, a: null, destScene: null, b: null, level: mech.level, label, verb: "ergue" });
  if (anchor.blocked) {
    warn(anchor.text);
    return { stop: true };
  }
  return { plan: { index, mode: "domain", casterTokenUuid: casterToken.document.uuid }, via: null };
}

/**
 * As Âncoras de um Portal (ou do Domínio, sem pontas): cada ponta que cai num campo/Região de Âncora, e quem abre, se estiver
 * Ancorado ou dentro de um campo. Só documentos; serve ao cliente e ao Mestre.
 */
function portalAnchorCheck({ sourceActor, casterDoc, scene, a, destScene, b, level, label, verb = "abre" }) {
  const size = Number(scene?.grid?.size) || 100;
  const endpoints = [];
  if (a) endpoints.push({ name: "a ponta A", role: "origin", sources: placeAnchorSources(scene, a, tokenElevation(casterDoc)) });
  if (b && destScene) endpoints.push({ name: "a ponta B", role: "origin", sources: placeAnchorSources(destScene, b, 0) });
  const center = tokenDocCenter(casterDoc, size);
  endpoints.push({
    name: casterDoc.name || sourceActor.name,
    role: "origin",
    sources: [...conditionAnchorSources(sourceActor), ...placeAnchorSources(scene, center, tokenElevation(casterDoc))]
  });
  const verdict = anchorVerdict({ skillLevel: level, endpoints });
  if (!verdict.blocked) return { blocked: false };
  return { blocked: true, text: verb === "abre" ? portalBlockText(label, verdict) : portalBlockText(label, verdict).replace(" não abre:", " não se ergue:") };
}

/* ------------------------------------------------------------------ Portal e Domínio: o Mestre cria as Regiões */

/** O comportamento "Teleport Token" do core apontando para `destinationUuid` (V14: `destinations`, V13: `destination`). */
function teleportBehaviorData(destinationUuid, name) {
  const fieldsOf = CONFIG.RegionBehavior?.dataModels?.teleportToken?.schema?.fields ?? {};
  const system = { placement: "center", snap: true, choice: false, revealed: false };
  if ("destinations" in fieldsOf) system.destinations = [destinationUuid];
  else system.destination = destinationUuid;
  return { type: "teleportToken", name, system };
}

function regionVisibility() {
  return CONST.REGION_VISIBILITY?.ALWAYS ?? 2;
}

/** Apaga as Regiões de Portal e Domínio que casam com `match(info)` (a Região do par cai junto pelo gancho de apagar). */
async function deleteSpaceRegions(match) {
  let count = 0;
  for (const region of allSpaceRegions()) {
    const info = region.getFlag(SYSTEM_ID, SPACE_FLAG);
    if (!info || !match(info) || !region.parent?.regions?.has(region.id)) continue;
    try {
      await region.delete();
      count += 1;
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Espaço: não consegui apagar a Região "${region.name}".`, err);
    }
  }
  return count;
}

/** Fecha um Portal ou Domínio (os dois lados de um Portal). */
export async function closeSpaceRegion(region) {
  const info = region?.getFlag?.(SYSTEM_ID, SPACE_FLAG);
  if (!info) return;
  const pair = info.pairUuid ? await fromUuid(info.pairUuid).catch(() => null) : null;
  if (pair) await pair.delete().catch(err => console.warn(`${SYSTEM_ID} | Portal: não consegui fechar a outra ponta.`, err));
  if (region.parent?.regions?.has(region.id)) await region.delete();
}

/** Lado do Mestre de `removeStructuresFor`/`removeZones` para Portais e Domínios de uma Skill Ativa. */
export async function removeSpaceRegionsAsGm({ sourceUuid, skillId, subSkillIndex }) {
  return deleteSpaceRegions(info => info.sourceUuid === sourceUuid && info.skillId === skillId && (info.subSkillIndex ?? null) === (subSkillIndex ?? null));
}

/** Desfazer uso: apaga o que este uso abriu. Só o Mestre chama. */
export async function removeSpaceRegionsOfUse(useId) {
  if (!useId) return 0;
  return deleteSpaceRegions(info => info.useId === useId);
}

/** O uso `useId` abriu algum Portal ou Domínio? (o Desfazer registra isso) */
export function spaceRegionsOfUse(useId) {
  if (!useId) return [];
  return allSpaceRegions().filter(region => region.getFlag(SYSTEM_ID, SPACE_FLAG)?.useId === useId);
}

function pointInBounds(scene, point) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
  const maxX = (scene.dimensions?.width ?? 1e6) + 1e4;
  const maxY = (scene.dimensions?.height ?? 1e6) + 1e4;
  return point.x >= -1e4 && point.y >= -1e4 && point.x <= maxX && point.y <= maxY;
}

/**
 * Lado do Mestre de `spaceRegion`: abre o Portal (par de Regiões com o "Teleport Token" do core) ou ergue o Domínio. O pedido não é
 * confiável: a mecânica vem da Skill da ficha, quem pede é dono dela, e alcance, Parado, Âncora e (numa cena de destino) o ponto
 * permitido são conferidos de novo.
 */
export async function spaceRegionAsGm(payload) {
  if (!isSpaceManipulationEnabled()) return refuse("o bloco Manipulação do espaço está desligado");
  const item = typeof payload?.sourceUuid === "string" ? await fromUuid(payload.sourceUuid) : null;
  const source = item?.parent;
  if (item?.documentName !== "Item" || !source) return refuse(RELAY_REASONS.invalid);
  const scene = typeof payload.sceneId === "string" ? game.scenes.get(payload.sceneId) : null;
  if (!scene) return refuse("a cena não existe mais");
  const resolved = resolveSpaceMech(item, payload);
  if (resolved.error) return refuse(resolved.error);
  const { mech } = resolved;
  const entry = (mech.effects ?? [])[payload.entryIndex];
  if (entry?.target !== "space") return refuse("o efeito de Espaço não existe mais");
  const mode = normalizeSpaceMode(entry.spaceMode);
  if (!["portal", "domain"].includes(mode)) return refuse("este modo não abre Regiões");
  const casterDoc = await sceneToken(payload.casterTokenUuid, scene);
  if (!casterDoc || !sameActor(casterDoc.actor, source)) return refuse(RELAY_REASONS.invalid);

  const label = item.name;
  const level = Math.max(1, Number(mech.level) || 1);
  const size = Number(scene.grid?.size) || 100;
  const scale = pxPerUnit(scene);
  if (isShipLike(source)) return { ok: true, value: { lines: [`${label}: Nave e Veículo não abrem Regiões`], moved: 0 } };
  if (isTimeStopped(source)) return { ok: true, value: { lines: [`${source.name} está Parado no tempo: ${label} não acontece`], moved: 0 } };

  const life = spaceLife({
    rounds: entry.durationRounds,
    hasUpkeep: Boolean(mech.hasUpkeep),
    inCombat: inStartedCombat(source),
    worldTime: Number(game.time?.worldTime) || 0,
    roundSeconds: Number(CONFIG.time?.roundTime) || 6
  });
  const base = {
    v: 1,
    kind: mode,
    sourceUuid: source.uuid,
    skillId: item.id,
    subSkillIndex: Number.isInteger(payload.subSkillIndex) ? payload.subSkillIndex : null,
    entryIndex: payload.entryIndex,
    useId: typeof payload.useId === "string" ? payload.useId : "",
    level,
    label,
    life,
    suspended: false
  };
  // A mesma Skill renova: o que ela já mantinha (a mesma entrada) fecha antes de abrir de novo (só depois de conferir tudo).
  const renew = () => deleteSpaceRegions(info => info.sourceUuid === source.uuid && info.skillId === item.id && (info.subSkillIndex ?? null) === base.subSkillIndex && info.entryIndex === base.entryIndex);

  if (mode === "domain") {
    const anchor = portalAnchorCheck({ sourceActor: source, casterDoc, scene, a: null, destScene: null, b: null, level, label, verb: "ergue" });
    if (anchor.blocked) return { ok: true, value: { lines: [anchor.text], moved: 0 } };
    await renew();
    const center = tokenDocCenter(casterDoc, size);
    const radius = domainRadiusMeters(entry) * scale;
    const behaviors = [{ type: DOMAIN_BEHAVIOR, name: `Domínio: ${label}`, system: { level } }];
    const rate = domainTimeRate(entry, { timeEnabled: isTimeManipulationEnabled() });
    if (rate !== 1) behaviors.push({ type: TIME_RATE_BEHAVIOR, name: `Ritmo do Domínio: ${label}`, system: { rate, combatWorld: "stop", network: false } });
    const [region] = await scene.createEmbeddedDocuments("Region", [{
      name: `Domínio de ${source.name}: ${label}`,
      color: DOMAIN_COLOR,
      shapes: [{ type: "circle", x: center.x, y: center.y, radius }],
      visibility: regionVisibility(),
      behaviors,
      flags: { [SYSTEM_ID]: { [SPACE_FLAG]: { ...base, primary: true, pairUuid: "" } } }
    }]);
    if (!region) return { ok: true, value: { lines: [`${label}: o Domínio não pôde ser erguido`], moved: 0 } };
    await syncDomainInside(region);
    const note = rate !== 1 ? `, tempo ×${String(Math.round(rate * 1000) / 1000).replace(".", ",")}` : "";
    return { ok: true, value: { lines: [`Domínio erguido (raio ${String(domainRadiusMeters(entry)).replace(".", ",")} m, ${spaceLifeText(life)}${note})`], moved: 1 } };
  }

  // Portal
  const a = { x: Number(payload.a?.x), y: Number(payload.a?.y) };
  const b = { x: Number(payload.b?.x), y: Number(payload.b?.y) };
  if (!pointInBounds(scene, a)) return refuse(RELAY_REASONS.invalid);
  const destScene = typeof payload.b?.sceneId === "string" ? game.scenes.get(payload.b.sceneId) : null;
  if (!destScene || !pointInBounds(destScene, b)) return refuse(RELAY_REASONS.invalid);
  const sameScene = destScene.id === scene.id;
  if (!sameScene) {
    if (!entry.spaceOtherScene) return refuse("esta Skill não liga outra cena");
    const allowed = portalDestinationPoints(source, destScene).some(p => Math.abs(p.x - b.x) <= 2 && Math.abs(p.y - b.y) <= 2);
    if (!allowed) return refuse("a ponta B tem de ser o ponto inicial da cena ou uma Marca sua nela");
  }
  const range = Number(mech.range) || 0;
  if (isSkillRangeEnabled() && range > 0) {
    const distances = [pointDistance(tokenDocCenter(casterDoc, size), a) / scale];
    if (sameScene) distances.push(pointDistance(tokenDocCenter(casterDoc, size), b) / scale);
    const verdict = portalInRange(distances, range);
    if (!verdict.ok) return { ok: true, value: { lines: [`${label}: uma ponta está fora do alcance (${meters(verdict.farthest)} de ${meters(range)})`], moved: 0 } };
  }
  if (!pointInSceneRect(scene, a) || !pointInSceneRect(destScene, b)) return { ok: true, value: { lines: [`${label}: uma ponta fica fora do mapa, o portal não abre`], moved: 0 } };
  const anchor = portalAnchorCheck({ sourceActor: source, casterDoc, scene, a, destScene, b, level, label });
  if (anchor.blocked) return { ok: true, value: { lines: [anchor.text], moved: 0 } };

  await renew();
  const radius = portalRadiusMeters(entry) * scale;
  const idA = foundry.utils.randomID();
  const idB = foundry.utils.randomID();
  const uuidA = `Scene.${scene.id}.Region.${idA}`;
  const uuidB = `Scene.${destScene.id}.Region.${idB}`;
  const regionData = (id, name, point, toUuid, pairUuid, primary) => ({
    _id: id,
    name,
    color: PORTAL_COLOR,
    shapes: [{ type: "circle", x: point.x, y: point.y, radius }],
    visibility: regionVisibility(),
    behaviors: [teleportBehaviorData(toUuid, `Portal: ${label}`)],
    flags: { [SYSTEM_ID]: { [SPACE_FLAG]: { ...base, primary, pairUuid } } }
  });
  let created = null;
  try {
    // Primeiro a ponta B (a de destino) e depois a A, para o par existir inteiro quando o primeiro Token entrar.
    await destScene.createEmbeddedDocuments("Region", [regionData(idB, `Portal B: ${label}`, b, uuidA, uuidA, false)], { keepId: true });
    created = destScene.regions.get(idB);
    await scene.createEmbeddedDocuments("Region", [regionData(idA, `Portal A: ${label}`, a, uuidB, uuidB, true)], { keepId: true });
  } catch (err) {
    if (created) await created.delete().catch(() => {});
    reportError(`${label}: não consegui abrir o portal.`, err, { gmOnly: true });
    return { ok: true, value: { lines: [`${label}: o portal não pôde ser aberto`], moved: 0 } };
  }
  const where = sameScene ? "" : ` (a ponta B está em ${destScene.name})`;
  return { ok: true, value: { lines: [`Portal aberto${where}: ${spaceLifeText(life)}; quem entra numa ponta sai na outra`], moved: 1 } };
}

/* ------------------------------------------------------------------ Domínio: o Preso */

function trappedEffectsOf(actor, regionUuid) {
  return (actor?.effects ?? []).filter(effect => effect.getFlag(SYSTEM_ID, "domainRegion") === regionUuid);
}

/** A Condição "Preso" do catálogo (ou a de fábrica, se o Mestre a apagou). */
function trappedCondition() {
  return getActiveStatusConditions().find(c => c.id === PRESO_CONDITION_ID)
    ?? NIHILITY.DEFAULT_STATUS_CONDITIONS?.find(c => c.id === PRESO_CONDITION_ID)
    ?? { id: PRESO_CONDITION_ID, label: "Preso", icon: "icons/svg/net.svg", anchorLevel: 1 };
}

/** Prende `actor` no Domínio (a Condição Preso com o nível do Domínio). Quem ergueu e quem escapa não são presos. */
async function trapActor(actor, region, info) {
  if (!actor || isShipLike(actor) || actor.uuid === info.sourceUuid) return false;
  if (domainEscapes(info.level, actorSpatialLevel(actor))) return false;
  if (trappedEffectsOf(actor, region.uuid).length) return true;
  const created = await applyCondition(actor, trappedCondition());
  for (const effect of created) {
    await effect.update({
      ...effectRoundsUpdate(0),
      [`flags.${SYSTEM_ID}.domainRegion`]: region.uuid,
      [`flags.${SYSTEM_ID}.sourceLevel`]: info.level
    });
  }
  return true;
}

async function freeActor(actor, regionUuid) {
  const ids = trappedEffectsOf(actor, regionUuid).map(effect => effect.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

/** Quem está dentro do Domínio agora fica Preso (ao erguer e ao religar depois de um Parar). */
async function syncDomainInside(region) {
  const info = region.getFlag(SYSTEM_ID, SPACE_FLAG);
  if (!info || info.kind !== "domain" || info.suspended) return;
  for (const token of region.tokens ?? []) {
    try {
      await trapActor(token.actor, region, info);
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Domínio: não consegui prender "${token.name}".`, err);
    }
  }
}

/** O Domínio acabou (ou foi apagado): ninguém fica Preso por ele. */
async function releaseDomainEffects(regionUuid) {
  const actors = new Set([...(game.actors ?? [])]);
  for (const scene of game.scenes ?? []) for (const token of scene.tokens ?? []) if (token.actor && !token.actorLink) actors.add(token.actor);
  for (const actor of actors) {
    try {
      await freeActor(actor, regionUuid);
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Domínio: não consegui soltar "${actor.name}".`, err);
    }
  }
}

/** Um Token entrou (`enter`) ou saiu (`exit`) da Região do comportamento Domínio. Só o Mestre designado escreve. */
export async function handleDomainMove(behavior, tokenDocument, kind) {
  if (!isDesignatedGm() || !isSpaceManipulationEnabled() || !behavior || behavior.disabled || !tokenDocument?.actor) return "off";
  const region = behavior.parent;
  const info = region?.getFlag?.(SYSTEM_ID, SPACE_FLAG);
  if (!info || info.kind !== "domain" || info.suspended) return "off";
  if (kind === "enter") return (await trapActor(tokenDocument.actor, region, info)) ? "trapped" : "free";
  await freeActor(tokenDocument.actor, region.uuid);
  return "released";
}

/* ------------------------------------------------------------------ Duração, suspensão e fim */

/**
 * Início de um turno: a vida dos Portais e Domínios anda (pelo turno de quem os abriu, ou pela virada da rodada), e eles fecham
 * ao zerar. Só o Mestre. O Portal só conta pela ponta A (a primária); a B cai com ela.
 */
export async function advanceSpaceRegions({ combat, combatant, roundChanged }) {
  if (!isDesignatedGm()) return;
  for (const region of allSpaceRegions()) {
    const info = region.getFlag(SYSTEM_ID, SPACE_FLAG);
    if (!info?.primary || info.suspended) continue;
    const casterFighting = Boolean(combat?.combatants?.some(c => c.actor?.uuid === info.sourceUuid));
    const casterTurn = combatant?.actor?.uuid === info.sourceUuid;
    const next = advanceSpaceLife(info.life, { casterFighting, casterTurn, roundChanged });
    if (next.life === info.life) continue;
    try {
      if (next.expired) await closeSpaceRegion(region);
      else await region.setFlag(SYSTEM_ID, SPACE_FLAG, { life: next.life });
    } catch (err) {
      reportError(`Espaço: falha ao contar a duração de "${region.name}".`, err, { gmOnly: true });
    }
  }
}

/** O relógio do mundo andou (ou o mundo abriu): fecha o que passou do prazo em segundos. */
async function sweepExpiredSpace() {
  if (!isDesignatedGm()) return;
  const now = Number(game.time?.worldTime) || 0;
  for (const region of allSpaceRegions()) {
    const info = region.getFlag(SYSTEM_ID, SPACE_FLAG);
    if (!info?.primary || info.suspended || !spaceLifeExpired(info.life, now)) continue;
    try {
      await closeSpaceRegion(region);
    } catch (err) {
      reportError(`Espaço: falha ao fechar "${region.name}".`, err, { gmOnly: true });
    }
  }
}

/** O combate acabou: o que contava em rodadas passa a contar pelo relógio do mundo. */
async function convertSpaceToWorldTime(combat) {
  if (!isDesignatedGm()) return;
  const now = Number(game.time?.worldTime) || 0;
  for (const region of allSpaceRegions()) {
    const info = region.getFlag(SYSTEM_ID, SPACE_FLAG);
    if (!info?.primary || !(Number(info.life?.roundsLeft) > 0)) continue;
    if (!combat?.combatants?.some(c => c.actor?.uuid === info.sourceUuid)) continue;
    try {
      await region.setFlag(SYSTEM_ID, SPACE_FLAG, { life: spaceLifeToWorld(info.life, now, Number(CONFIG.time?.roundTime) || 6) });
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Espaço: não consegui passar "${region.name}" para o relógio do mundo.`, err);
    }
  }
}

/**
 * Quem sustenta uma Skill Ativa de Portal/Domínio está Parado no tempo (8e): a Região fica suspensa (o portal não leva, o Domínio
 * solta) e religa sozinha quando ele volta, sem cobrar nada. Idempotente. Só as que valem "enquanto ligada" (as com prazo seguem).
 */
export async function setSpaceRegionsSuspended(actor, suspended) {
  if (!actor) return;
  for (const region of allSpaceRegions()) {
    const info = region.getFlag(SYSTEM_ID, SPACE_FLAG);
    if (!info || info.sourceUuid !== actor.uuid || !info.life?.untilDeactivated || Boolean(info.suspended) === suspended) continue;
    try {
      const pair = info.pairUuid ? await fromUuid(info.pairUuid).catch(() => null) : null;
      for (const doc of [region, pair].filter(Boolean)) {
        await doc.setFlag(SYSTEM_ID, SPACE_FLAG, { suspended });
        if (info.kind === "portal") await doc.updateEmbeddedDocuments("RegionBehavior", [...doc.behaviors].map(b => ({ _id: b.id, disabled: suspended })));
      }
      if (info.kind === "domain") {
        if (suspended) await releaseDomainEffects(region.uuid);
        else await syncDomainInside(region);
      }
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Parar: não consegui ${suspended ? "suspender" : "religar"} "${region.name}".`, err);
    }
  }
}

/* ------------------------------------------------------------------ Quem não passa: o movimento recusado */

/**
 * `preMoveToken`: o Domínio prende (quem está dentro, Preso por ele, não sai da área, a não ser que tenha uma Skill espacial de
 * nível maior) e o Portal não leva quem está Ancorado. O Mestre sempre pode mover o Token (é ele quem decide quem escapa).
 * Empurrão e teleporte do sistema (`nihilityForced`) não passam por aqui: o teleporte olha a Âncora, o empurrão é força.
 */
function onPreMoveToken(document, movement, operation) {
  if (operation?.nihilityForced || game.user?.isGM) return undefined;
  const actor = document?.actor;
  const destination = movement?.destination;
  if (!actor || !destination) return undefined;
  const regions = spaceRegionsOnScene(document.parent);
  if (!regions.length) return undefined;
  const centerPoint = position => {
    try {
      const c = document.getCenterPoint(position);
      return Number.isFinite(c?.x) && Number.isFinite(c?.y) ? c : null;
    } catch (err) {
      return null;
    }
  };
  const elevation = Number(destination.elevation ?? tokenElevation(document)) || 0;
  const points = [destination, ...(movement.pending?.waypoints ?? [])].map(centerPoint).filter(Boolean);
  if (!points.length) return undefined;
  const test = (region, point) => {
    try {
      return Boolean(region.testPoint({ x: point.x, y: point.y }, elevation));
    } catch (err) {
      return false;
    }
  };
  for (const region of regions) {
    const info = region.getFlag(SYSTEM_ID, SPACE_FLAG);
    if (!info || info.suspended) continue;
    const here = Boolean(document.regions?.has?.(region));
    if (info.kind === "domain") {
      if (!here || !trappedEffectsOf(actor, region.uuid).length) continue;
      const escapes = domainEscapes(info.level, actorSpatialLevel(actor));
      if (domainBlocksMove({ startInside: true, endInside: points.every(p => test(region, p)), escapes })) {
        ui.notifications.warn(domainBlockText(escapeHtml(document.name || actor.name), escapeHtml(info.label ?? "")));
        return false;
      }
    } else if (info.kind === "portal" && !here && points.some(p => test(region, p))) {
      const verdict = anchorVerdict({
        skillLevel: info.level,
        endpoints: [{ name: document.name || actor.name, role: "origin", sources: conditionAnchorSources(actor) }]
      });
      if (verdict.blocked) {
        ui.notifications.warn(portalCrossText(escapeHtml(document.name || actor.name), verdict));
        return false;
      }
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ Bolso: quem está Ancorado não o abre */

/**
 * Mexer no que está dentro do Bolso (pôr ou tirar um Item) estando Ancorado, ou dentro de um campo de Âncora de nível igual ou maior
 * que o da Skill do Bolso, é recusado: devolve o aviso, ou "" se pode. Nada se perde (os Itens continuam lá). O Mestre sempre pode.
 */
export function pocketOpenBlock(actor, containerId) {
  if (!containerId || game.user?.isGM || !isSpaceManipulationEnabled()) return "";
  const skill = actor?.items?.get(containerId);
  if (skill?.type !== "skill" || !pocketEntryOf(skill.system)) return "";
  const sources = [...conditionAnchorSources(actor)];
  const token = actor.isToken ? actor.token : actor.getActiveTokens?.(false, true)?.[0];
  if (token?.parent) {
    const size = Number(token.parent.grid?.size) || 100;
    sources.push(...placeAnchorSources(token.parent, tokenDocCenter(token, size), tokenElevation(token)));
  }
  const verdict = anchorVerdict({ skillLevel: Number(skill.system.level) || 1, endpoints: [{ name: actor.name, role: "origin", sources }] });
  return verdict.blocked ? pocketBlockText(actor.name, verdict) : "";
}

/* ------------------------------------------------------------------ Comportamento de Região "Domínio" */

function defineDomainBehavior() {
  const { fields } = foundry.data;
  const Base = foundry.data.regionBehaviors.RegionBehaviorType;
  const E = CONST.REGION_EVENTS;
  const events = {};
  for (const [event, kind] of [[E.TOKEN_ENTER, "enter"], [E.TOKEN_EXIT, "exit"]]) {
    events[event] = async function (eventData) {
      const token = eventData.data?.token;
      if (!token) return;
      try {
        await handleDomainMove(this.behavior ?? this.parent, token, kind);
      } catch (err) {
        reportError("Domínio: falha ao prender/soltar.", err, { gmOnly: true });
      }
    };
  }
  return class DomainRegionBehavior extends Base {
    static defineSchema() {
      return {
        level: new fields.NumberField({
          required: true, nullable: false, integer: true, min: 1, initial: 1,
          label: "Nível do Domínio",
          hint: "Quem entra fica Preso (a Condição Preso) e não sai da área. Quem tem uma Skill que teleporta de nível maior que este escapa. Para soltar alguém à mão, tire a Condição Preso dele."
        })
      };
    }

    static events = events;
  };
}

/* ------------------------------------------------------------------ Comportamento de Região "Âncora" */

function defineAnchorBehavior() {
  const { fields } = foundry.data;
  const Base = foundry.data.regionBehaviors.RegionBehaviorType;
  return class AnchorRegionBehavior extends Base {
    static defineSchema() {
      return {
        level: new fields.NumberField({
          required: true, nullable: false, integer: true, min: 1, initial: 1,
          label: "Nível da Âncora",
          hint: "Saltar, Trocar (e o Portal, quando existir) que começa, termina ou é de quem está dentro desta Região falha se o nível da Skill for igual ou menor que este. Não faz nada sozinho: só marca o lugar."
        })
      };
    }

    static events = {};
  };
}

/** Registra o comportamento de Região (no `init`) e a ficha dele. */
export function registerSpace() {
  if (foundry.data?.regionBehaviors?.RegionBehaviorType && CONFIG.RegionBehavior) {
    CONFIG.RegionBehavior.dataModels[ANCHOR_BEHAVIOR] = defineAnchorBehavior();
    CONFIG.RegionBehavior.typeIcons ??= {};
    CONFIG.RegionBehavior.typeIcons[ANCHOR_BEHAVIOR] = "fa-solid fa-anchor";
    CONFIG.RegionBehavior.dataModels[DOMAIN_BEHAVIOR] = defineDomainBehavior();
    CONFIG.RegionBehavior.typeIcons[DOMAIN_BEHAVIOR] = "fa-solid fa-lock";
  }
  // Portal e Domínio (8f, lotes 3 e 5): o movimento recusado, a Região que se apaga e os prazos.
  Hooks.on("preMoveToken", onPreMoveToken);
  Hooks.on("deleteRegion", async region => {
    if (!isDesignatedGm()) return;
    const info = region.getFlag?.(SYSTEM_ID, SPACE_FLAG);
    if (!info) return;
    try {
      if (info.kind === "domain") await releaseDomainEffects(region.uuid);
      const pair = info.pairUuid ? await fromUuid(info.pairUuid).catch(() => null) : null;
      if (pair) await pair.delete();
    } catch (err) {
      reportError("Espaço: falha ao fechar a Região.", err, { gmOnly: true });
    }
  });
  Hooks.on("updateWorldTime", () => sweepExpiredSpace());
  Hooks.on("deleteCombat", combat => convertSpaceToWorldTime(combat));
  Hooks.once("ready", () => sweepExpiredSpace());
}

/* ------------------------------------------------------------------ Ações do relay */

export const RELAY_HANDLERS = {
  /**
   * Saltar/Trocar (8f): o Mestre teleporta os Tokens. Quem pede tem de ser dono da Skill de origem; a mecânica e todas as
   * conferências são refeitas do lado do Mestre (ver spaceMoveAsGm).
   */
  async spaceMove(payload, user) {
    if (!(await mayActFor(user, payload?.sourceUuid))) return refuse(RELAY_REASONS.permission);
    return spaceMoveAsGm(payload ?? {});
  },

  /**
   * Portal e Domínio (8f, lotes 3 e 5): o Mestre cria as Regiões temporárias (o par com o "Teleport Token" do core, ou a Região do
   * Domínio). Quem pede tem de ser dono da Skill de origem; a mecânica e as conferências são refeitas do lado do Mestre.
   */
  async spaceRegion(payload, user) {
    if (!(await mayActFor(user, payload?.sourceUuid))) return refuse(RELAY_REASONS.permission);
    return spaceRegionAsGm(payload ?? {});
  }
};

