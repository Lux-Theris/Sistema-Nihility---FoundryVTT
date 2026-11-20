/**
 * Reações elementais (item 8.1), o lado Foundry: o que um Ator carrega agora, a reação de cada parte
 * do golpe, o que se espalha para quem está perto, o que acontece no Aplicar (consumir a marca,
 * aplicar/tirar Condição) e o nome da reação subindo do Token. As contas são puras em
 * reaction-rules.js (testadas); a do dano está em damage-rules.js (`resolveDamageParts`).
 *
 * Quem lê: `applyDamageReductions` (damage-roll.js) pergunta a reação de cada parte; o card de dano
 * (damage-apply.js) chama `applyReactionOutcome`/`undoReactionOutcome` no Aplicar/Desfazer.
 */
import { SYSTEM_ID, getActiveDamageElements, getActiveStatusConditions, damageElementChain, getDamageElement, actorBodyElements, actorToken, sameActor, isReactionsEnabled } from "../core/config.js";
import { carriedMarks, bodyCarried, pickReaction, pickedFactor, spreadTargets, spreadCarriesDamage, shipReactionAverage, idsWithAncestors } from "./reaction-rules.js";
import { measureTokenDistance } from "./range.js";
import { isDead } from "./incapacitation.js";
import { surfaceElementIdsUnder } from "../environment/surfaces.js";
import { applyEffectsToActor } from "../skills/effects-apply.js";
import { escapeHtml } from "../helpers/html.js";

/** Tipo de alvo para o `against` da reação. */
export function reactionKindOf(actor) {
  return ["starship", "vehicle"].includes(actor?.type) ? "ship" : "character";
}

/**
 * O que o Ator carrega agora: as marcas (Condições com "Elemento do corpo", a mais recente primeiro)
 * e o corpo (só conduz). `null` com o bloco desligado ou sem Ator.
 */
export function reactionState(actor) {
  if (!actor || !isReactionsEnabled()) return null;
  const elements = getActiveDamageElements();
  const effects = [...(actor.effects ?? [])].map((effect, index) => ({
    effectId: effect.id,
    statuses: [...(effect.statuses ?? [])],
    conditionId: effect.flags?.[SYSTEM_ID]?.conditionId ?? "",
    disabled: Boolean(effect.disabled),
    order: Number(effect._stats?.createdTime) || index
  }));
  // Quem pisa numa superfície (8.2) carrega o elemento dela: entra como marca de `surface: true` (sem consumo).
  const marks = carriedMarks(effects, getActiveStatusConditions(), elements, surfaceElementIdsUnder(actor));
  const bodyIds = actorBodyElements(actor);
  return { marks, body: bodyCarried(bodyIds, elements), bodyIds, kind: reactionKindOf(actor) };
}

/** A reação de UMA parte (elemento do golpe) contra o que o alvo carrega. */
export function reactionForPart(elementId, state) {
  if (!state || !elementId) return null;
  const chain = damageElementChain(elementId);
  if (!chain.length) return null;
  return pickReaction({ chain, marks: state.marks, body: state.body, kind: state.kind });
}

export { pickedFactor };

/**
 * O que o card guarda de uma reação (JSON simples): o nome, de onde veio, o que consumir e o que
 * aplicar no Aplicar. O corpo nunca consome nem aplica no próprio alvo (só vai para fora).
 */
export function reactionRecord(picked, part) {
  const reaction = picked.reaction;
  const fromMark = picked.source !== "body";
  return {
    label: reaction.label,
    source: picked.source,
    hitElementId: picked.hitElementId,
    carriedId: picked.carriedId,
    markElementId: picked.mark?.elementId ?? "",
    effectId: picked.source === "mark" ? picked.mark.effectId : "",
    consume: picked.source === "mark" && Boolean(reaction.consume),
    applyCondition: fromMark ? reaction.applyCondition : null,
    removeCondition: fromMark ? reaction.removeCondition : "",
    leaveSurface: reaction.leaveSurface || "",
    spread: reaction.spread,
    spreadCondition: reaction.applyCondition,
    shieldDrain: reaction.shieldDrain,
    partBase: Math.max(0, Number(part?.base) || 0),
    color: getDamageElement(picked.hitElementId)?.color ?? "#ffffff"
  };
}

/** Nomes das reações de um golpe para o texto do card/chat (" · Eletrocutado"). */
export function reactionLabel(reactions) {
  const names = [...new Set((reactions ?? []).map(r => r.label).filter(Boolean))];
  return names.length ? ` · ${names.map(escapeHtml).join(", ")}` : "";
}

/** O que sobra no card: só o que precisa de Aplicar ou de um nome flutuante. */
export function cardReactions(reactions) {
  return (reactions ?? []).map(({ spread, spreadCondition, partBase, ...keep }) => keep);
}

/* ------------------------------------------------------------------ Nave */

/**
 * Reação do golpe contra o Escudo de uma Nave/Veículo (média das partes iguais): o fator entra no
 * multiplicador da camada do Escudo e o dreno soma dano extra só nele. Sem consumo. O Escudo só
 * conta enquanto está de pé.
 * @returns {{factor:number, drain:number, labels:string[]}}
 */
export function shipReactionFor(ship, elementIds, { shieldUp = false, absolute = false } = {}) {
  const neutral = { factor: 1, drain: 0, labels: [] };
  if (absolute || !isReactionsEnabled() || !ship) return neutral;
  const ids = [...new Set((elementIds ?? []).filter(Boolean))];
  if (!ids.length) return neutral;
  const state = reactionState(ship);
  const elements = getActiveDamageElements();
  const chains = ids.map(id => damageElementChain(id)).filter(chain => chain.length);
  const shieldElements = shieldUp ? bodyCarried(ship.system?.shieldElements ?? [], elements) : [];
  return shipReactionAverage(chains, state?.marks ?? [], shieldElements);
}

/* ------------------------------------------------------------------ espalhar (conduzir) */

/** O Ator carrega este elemento (marca ou corpo)? */
function carries(state, elementId) {
  if (!state) return false;
  return state.marks.some(m => m.ids.includes(elementId)) || state.body.some(b => b.ids.includes(elementId));
}

/** Uma entrada de card sem dano, só para aplicar uma Condição em quem foi atingido pela reação. */
function conditionOnlyEntry(actor, record, label) {
  return {
    targetUuid: actor.uuid,
    amount: 0,
    absolute: false,
    shieldExtra: 0,
    shieldMultiplier: 1,
    shieldPenetration: 0,
    triggeredConditions: [],
    shieldBase: 0,
    bodyFactor: 1,
    elementIds: [],
    bodyPartId: "",
    sever: false,
    noBodyPart: true,
    label: String(label || ""),
    applied: null,
    name: actor.name,
    conducted: record.label,
    reactions: [{ label: record.label, source: "spread", hitElementId: record.hitElementId, carriedId: record.carriedId, markElementId: "", effectId: "", consume: false, applyCondition: record.spreadCondition, removeCondition: "", leaveSurface: "", shieldDrain: 0, color: record.color }]
  };
}

/**
 * O que a reação espalha, resolvido já na rolagem: para cada reação com `spread`, os Personagens
 * vivos com Token na cena a até `radius` m do alvo. Com `sameElement`, quem carrega o mesmo
 * elemento leva o dano da parte (antes do fator da reação) pelas defesas dele e pela própria
 * reação dele; sem, só a Condição da reação. Um salto só (`hop` no cálculo de quem recebe).
 * @param {object[]} records - `reduction.reactions`
 * @param {Actor} targetActor
 * @param {object} mech - mecânica do golpe (elementos, magia…)
 * @param {{attacker?:Actor, reduce:Function, makeEntry:Function, label?:string}} io
 * @returns {Promise<{entries:object[], trace:Array<{name:string, rows:object[]}>, notes:string[]}>}
 */
export async function conductReactions(records, targetActor, mech, { attacker = null, reduce, makeEntry, label = "", exclude = [] } = {}) {
  const out = { entries: [], trace: [], notes: [] };
  const spreading = (records ?? []).filter(r => r.spread);
  if (!spreading.length || !canvas?.ready || !targetActor) return out;
  const targetToken = actorToken(targetActor, [...(game.user?.targets ?? [])]);
  if (!targetToken) return out;
  const seen = new Set([targetActor.uuid, ...exclude]);
  const candidates = [];
  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor;
    if (!actor || actor.type !== "character" || seen.has(actor.uuid) || sameActor(actor, targetActor)) continue;
    seen.add(actor.uuid);
    candidates.push({ actor, token, state: reactionState(actor), dead: isDead(actor), distance: measureTokenDistance(targetToken, token) });
  }
  const done = new Set();
  for (const record of spreading) {
    const reached = spreadTargets(
      candidates.map(c => ({ uuid: c.actor.uuid, distance: c.distance, dead: c.dead, carries: [...new Set([...(c.state?.marks ?? []).flatMap(m => m.ids), ...(c.state?.body ?? []).flatMap(b => b.ids)])] })),
      record.spread,
      record.carriedId
    );
    for (const hit of reached) {
      const key = `${hit.uuid}|${record.label}`;
      if (done.has(key)) continue;
      done.add(key);
      const candidate = candidates.find(c => c.actor.uuid === hit.uuid);
      if (!candidate) continue;
      if (spreadCarriesDamage({ spread: record.spread })) {
        const reduction = reduce(record.partBase, { ...mech, damageElements: [record.hitElementId] }, candidate.actor, { attacker, hop: true });
        const entry = makeEntry(candidate.actor, reduction, label);
        if (!entry) continue;
        entry.name = candidate.actor.name;
        entry.conducted = record.label;
        out.entries.push(entry);
        out.trace.push({ name: `${candidate.actor.name} (conduzido: ${record.label})`, rows: [...(reduction.traceRows ?? []), { label: "Final", value: String(reduction.finalDamage), kind: "total" }] });
        out.notes.push(`${candidate.actor.name} ${reduction.finalDamage}`);
      } else if (record.spreadCondition) {
        out.entries.push(conditionOnlyEntry(candidate.actor, record, label));
        out.notes.push(candidate.actor.name);
      }
    }
  }
  return out;
}

/** Texto público da condução (" — conduzido: Orc 12, Goblin 8"). */
export function conductionLabel(notes) {
  return notes?.length ? ` — conduzido: ${notes.join(", ")}` : "";
}

/* ------------------------------------------------------------------ Aplicar / Desfazer */

/** O efeito (Active Effect) mais recente do Ator que dá este elemento como marca, fora os já usados. */
function markEffectFor(actor, markElementId, skip = new Set()) {
  const state = reactionState(actor);
  const mark = state?.marks.find(m => !m.surface && m.elementId === markElementId && m.effectId && !skip.has(m.effectId));
  return mark ? actor.effects.get(mark.effectId) ?? null : null;
}

/**
 * No Aplicar: consome a marca, tira a Condição que a reação tira e aplica a que ela aplica. Devolve
 * o que o Desfazer precisa para voltar (`consumed`/`removed` são os efeitos apagados, `toObject()`),
 * os ids criados e os nomes das reações para o card/flutuante. Pura de efeito colateral só em quem chama.
 * @param {Actor} actor
 * @param {object[]} records - `state.reactions` do card
 * @param {{label?:string, hitDamage?:number}} [options]
 */
export async function applyReactionOutcome(actor, records, { label = "", hitDamage = 0 } = {}) {
  const result = { createdIds: [], consumed: [], removed: [], names: [] };
  if (!actor || !records?.length) return result;
  const usedMarks = new Set();
  for (const record of records) {
    result.names.push(record.label);
    if (record.consume) {
      let effect = record.effectId ? actor.effects.get(record.effectId) : null;
      if (effect && usedMarks.has(effect.id)) effect = null;
      else if (!effect) effect = markEffectFor(actor, record.markElementId, usedMarks);
      if (effect) {
        usedMarks.add(effect.id);
        result.consumed.push(effect.toObject());
        await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
      }
    }
    if (record.removeCondition) {
      const doomed = actor.effects.filter(e => e.statuses?.has?.(record.removeCondition) || e.flags?.[SYSTEM_ID]?.conditionId === record.removeCondition);
      if (doomed.length) {
        result.removed.push(...doomed.map(e => e.toObject()));
        await actor.deleteEmbeddedDocuments("ActiveEffect", doomed.map(e => e.id));
      }
    }
    if (record.applyCondition?.conditionId) {
      const before = new Set(actor.effects.map(e => e.id));
      const entry = {
        target: "hp",
        amount: 0,
        durationRounds: Math.max(0, Number(record.applyCondition.rounds) || 0),
        conditionId: record.applyCondition.conditionId,
        damageElements: record.hitElementId ? [record.hitElementId] : [],
        hitDamage: Math.max(0, Number(hitDamage) || 0)
      };
      await applyEffectsToActor({ effects: [entry], level: 1, hasUpkeep: false, sourceLevel: 1, sourceMagic: false }, label || record.label, null, actor);
      result.createdIds.push(...actor.effects.filter(e => !before.has(e.id)).map(e => e.id));
    }
  }
  return result;
}

/** No Desfazer: devolve a marca consumida e a Condição que a reação tirou (os criados saem pelo caminho comum). */
export async function undoReactionOutcome(actor, applied) {
  if (!actor) return;
  const back = [...(applied?.reactionConsumed ?? []), ...(applied?.reactionRemoved ?? [])].filter(data => data?._id && !actor.effects.has(data._id));
  if (back.length) await actor.createEmbeddedDocuments("ActiveEffect", foundry.utils.deepClone(back), { keepId: true, nihilityConfigured: true });
}

/* ------------------------------------------------------------------ nome flutuante */

/**
 * O nome da reação sobe do Token (mesa narrada por voz: o jogador olha o mapa, não o chat). Todo
 * cliente vê, pelo `updateChatMessage` do Aplicar; só quem enxerga o Token (mesmo critério dos
 * números flutuantes). O texto tem a cor do elemento do golpe.
 */
export function registerReactionFloats() {
  const recent = applied => applied?.reactionNames?.length && Number(applied.at) && Date.now() - Number(applied.at) < 6000;
  const float = (targetUuid, applied, records) => {
    if (!canvas?.ready || !recent(applied)) return;
    let actor = null;
    try {
      actor = fromUuidSync(targetUuid);
    } catch (err) {
      return;
    }
    const tokens = actor?.getActiveTokens?.(true) ?? [];
    (records ?? []).forEach((record, i) => {
      if (!record?.label) return;
      for (const token of tokens) {
        if (!token.visible || token.document.isSecret) continue;
        setTimeout(() => {
          if (token.destroyed || !token.visible) return;
          canvas.interface.createScrollingText(token.center, record.label, {
            anchor: CONST.TEXT_ANCHOR_POINTS.TOP,
            direction: CONST.TEXT_ANCHOR_POINTS.TOP,
            distance: 2.4 * token.h,
            fontSize: 32,
            fill: record.color || "#ffffff",
            stroke: 0x000000,
            strokeThickness: 5,
            jitter: 0.25
          });
        }, 250 + i * 350);
      }
    });
  };
  Hooks.on("updateChatMessage", (message, changes) => {
    const flagChanges = changes?.flags?.[SYSTEM_ID];
    if (!flagChanges || !("damageApply" in flagChanges || "damageApplyMany" in flagChanges)) return;
    const single = message.getFlag(SYSTEM_ID, "damageApply");
    if (single?.applied) float(single.targetUuid, single.applied, single.reactions);
    for (const entry of message.getFlag(SYSTEM_ID, "damageApplyMany")?.entries ?? []) {
      if (entry?.applied) float(entry.targetUuid, entry.applied, entry.reactions);
    }
  });
}

export { idsWithAncestors };
