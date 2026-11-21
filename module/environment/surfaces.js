/**
 * Superfícies elementais (item 8.2), o lado Foundry. Regras puras em surface-rules.js (testadas).
 * Bloco `FEATURES.surfaces` (desligado por padrão, pesado).
 *
 * Uma superfície é um documento de cena SEM dono — Region na V14, Measured Template na V13, o mesmo
 * que uma Zona, mas com o flag `surface` em vez de `zone`, então `zonesOnScene`/`tickZonesForCombatant`
 * nunca a tratam como Zona de Skill. A área vai no flag (círculo em pixels); o documento só a desenha
 * (cor do elemento, nome no mapa). Quem escreve é sempre o Mestre designado (pedido `createSurface` do
 * relay), inclusive quando o Aplicar de um card ou uma Skill a pedem.
 *
 *  - NASCE: (1) golpe de um elemento com "Deixa no chão" — no Aplicar do card, rola a chance e cria no
 *    Token do alvo; (2) `leaveSurface` de uma Reação (8.1) — no Aplicar; (3) efeito de Skill "Cria
 *    superfície" (elemento + raio) — no ponto do alvo, ou no centro da área.
 *  - AGE: ao ENTRAR (`moveToken`, o destino do movimento; andar, ser empurrado e teleporte contam) e no
 *    começo do turno de quem está dentro: rola o dano pelas defesas do alvo (card com Aplicar) e aplica
 *    a Condição com o efeito padrão. Pula quem está acima da altura que ela alcança, debaixo da terra, o
 *    morto e quem tem Traço imune.
 *  - CARREGA: quem pisa carrega o elemento dela para as Reações (`surfaceElementIdsUnder`).
 *  - REAGE: um golpe contra quem pisa transforma a superfície pela Tabela de reações (Fogo no óleo vira
 *    Chamas, Gelo apaga o fogo); duas que se tocam ao nascer reagem do mesmo jeito.
 *  - DURA: rodadas em combate (virada da rodada, `advanceSurfaces`), minutos de relógio fora
 *    (`updateWorldTime`). Antimagia desfaz a mágica; Desfazer uso apaga a do uso (`useId`).
 */
import {
  SYSTEM_ID, getActiveDamageElements, getActiveStatusConditions, getDamageElement, damageElementChain,
  actorTraits, actorToken, isSurfacesEnabled, isElevationEnabled, isMagicUse
} from "../core/config.js";
import { areaContains, normalizeArea, areaPolygon, tokenDocCenter, zoneDocumentData } from "../combat/area-geometry.js";
import { foundryGeneration, combatScenes, tokenElevation } from "../helpers/foundry-compat.js";
import { isDesignatedGm, runAsGm } from "../helpers/gm-relay.js";
import { refuse, relayFailureMessage } from "../helpers/gm-relay-rules.js";
import { reportError } from "../helpers/report.js";
import { escapeHtml } from "../helpers/html.js";
import { currentSkillUseId } from "../skills/skill-use-context.js";
import {
  leavesSurface, buildSurfaceFlag, surfaceChanceHits, surfaceEntered, surfaceReachesElevation, surfaceImmune, surfaceRoundStep,
  surfaceExpired, circlesTouch, findSameSurface, surfaceReaction, surfaceDispelled, polygonEdges, SURFACE_MAX_RADIUS
} from "./surface-rules.js";

const FLAG = "surface";

/* ------------------------------------------------------------------ leitura da cena */

/** Escala da cena (px por unidade) — cópia curta de area-effects.js (que importa meio sistema). */
function pxPerUnitOf(scene) {
  const size = Number(scene?.grid?.size) || 100;
  const distance = Number(scene?.grid?.distance) || 1;
  return size / distance;
}

/** Documentos de superfície de uma cena (Regions e, até a V13, templates marcados). */
export function surfacesOnScene(scene) {
  if (!scene) return [];
  const docs = [...(scene.regions ?? [])];
  if (foundryGeneration() < 14) docs.push(...(scene.templates ?? []));
  return docs.filter(doc => doc.getFlag(SYSTEM_ID, FLAG));
}

/** O flag de uma superfície (cópia só de leitura). */
export function surfaceFlagOf(doc) {
  return doc?.getFlag?.(SYSTEM_ID, FLAG) ?? null;
}

function surfaceArea(flag) {
  return normalizeArea(flag?.area);
}

/** O Token (documento) deste Ator: o do próprio Ator sintético, ou o escolhido/primeiro na cena aberta. */
function tokenDocOf(actor) {
  if (!actor) return null;
  if (actor.isToken) return actor.token ?? null;
  try {
    return actorToken(actor, [...(game.user?.targets ?? [])])?.document ?? null;
  } catch (err) {
    return null;
  }
}

/** O Token (na posição dada, ou onde está) toca esta superfície, na altura dele? */
function surfaceReaches(doc, flag, tokenDoc, position = null, elevation = null) {
  const scene = doc.parent;
  const area = surfaceArea(flag);
  if (!area || !scene) return false;
  const at = position ? { x: position.x, y: position.y, width: position.width ?? tokenDoc.width, height: position.height ?? tokenDoc.height } : tokenDoc;
  if (!areaContains(area, tokenDocCenter(at, scene.grid?.size))) return false;
  return surfaceReachesElevation({
    elevation: elevation ?? tokenElevation(tokenDoc),
    base: flag.elevation,
    height: flag.height,
    elevationOn: isElevationEnabled()
  });
}

/** As superfícies que este Token pisa agora, mais recente primeiro. */
export function surfacesAt(scene, tokenDoc, position = null, elevation = null) {
  return surfacesOnScene(scene)
    .map(doc => ({ doc, flag: surfaceFlagOf(doc) }))
    .filter(({ doc, flag }) => flag && surfaceReaches(doc, flag, tokenDoc, position, elevation))
    .sort((a, b) => (Number(b.flag.createdAt) || 0) - (Number(a.flag.createdAt) || 0));
}

/**
 * Os elementos das superfícies que o Ator pisa (para as Reações: quem pisa carrega o elemento dela).
 * Vazio com o bloco desligado ou sem Token na cena. Síncrono.
 * @returns {string[]}
 */
export function surfaceElementIdsUnder(actor) {
  if (!isSurfacesEnabled()) return [];
  const token = tokenDocOf(actor);
  if (!token?.parent) return [];
  return surfacesAt(token.parent, token).map(({ flag }) => flag.elementId);
}

/** A cena está num combate começado? (Em combate a superfície conta rodadas; fora, o relógio do mundo.) */
function sceneInStartedCombat(scene) {
  return [...(game.combats ?? [])].some(c => c.started && combatScenes(c).some(s => s.id === scene.id));
}

/* ------------------------------------------------------------------ criar */

/** Aplica o pedido de criação já validado: cria o documento. Devolve o id. */
async function createSurfaceDocument(scene, flag, element) {
  const color = /^#[0-9a-f]{6}$/i.test(element?.color ?? "") ? element.color : "#7fb3ff";
  const { documentName, data } = zoneDocumentData(flag.area, {
    generation: foundryGeneration(),
    pxPerUnit: pxPerUnitOf(scene),
    color,
    name: flag.label || "Superfície",
    visibility: CONST.REGION_VISIBILITY?.ALWAYS ?? 2,
    flags: { [SYSTEM_ID]: { [FLAG]: flag } }
  });
  const [doc] = await scene.createEmbeddedDocuments(documentName, [data]);
  return { doc, documentName };
}

/**
 * Lado do Mestre do pedido `createSurface`. Valida tudo (o cliente só manda o elemento, o ponto e, para
 * o efeito de Skill, um raio limitado): o elemento tem de deixar algo no chão, o raio é limitado, uma
 * igual no mesmo lugar só renova, e as que ela toca reagem (nova × existente, pela Tabela de reações).
 * @param {{sceneId:string, x:number, y:number, elementId:string, radiusMeters?:number, rounds?:number, originMagic?:boolean, useId?:string, noReact?:boolean}} payload
 * @returns {Promise<{ok:boolean, reason?:string, value?:object}>}
 */
export async function createSurfaceAsGm(payload) {
  if (!isSurfacesEnabled()) return refuse("o bloco Superfícies está desligado");
  const scene = typeof payload?.sceneId === "string" ? game.scenes.get(payload.sceneId) : null;
  if (!scene) return refuse("a cena não existe mais");
  const elements = getActiveDamageElements();
  const element = elements.find(e => e.id === payload?.elementId);
  if (!element || !leavesSurface(element.surface)) return refuse(`${element?.label ?? "esse elemento"} não deixa nada no chão`);
  const x = Number(payload.x);
  const y = Number(payload.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return refuse("o ponto da superfície ficou inválido");
  const def = element.surface;
  const radiusMeters = Math.min(Math.max(Number(payload.radiusMeters) || def.radius, 0.5), SURFACE_MAX_RADIUS);
  const radiusPx = radiusMeters * pxPerUnitOf(scene);
  const rounds = Number.isFinite(Number(payload.rounds)) && Number(payload.rounds) > 0 ? Math.min(Math.round(Number(payload.rounds)), 100) : null;
  const flag = buildSurfaceFlag({
    elementId: element.id,
    def,
    label: def.label || `${element.label} no chão`,
    x,
    y,
    radiusPx,
    radiusMeters,
    originMagic: Boolean(payload.originMagic),
    worldTime: game.time?.worldTime ?? 0,
    useId: payload.useId,
    rounds
  });

  const existing = surfacesOnScene(scene);
  // Uma igual praticamente no mesmo lugar só renova (Aplicar em todos de uma área não empilha dez poças).
  const sameIndex = findSameSurface(existing.map(surfaceFlagOf), { elementId: element.id, x, y, radiusPx });
  if (sameIndex >= 0) {
    const doc = existing[sameIndex];
    const old = surfaceFlagOf(doc);
    await doc.setFlag(SYSTEM_ID, FLAG, { ...old, roundsLeft: Math.max(Number(old.roundsLeft) || 0, flag.roundsLeft), expiresAt: flag.expiresAt === null || old.expiresAt === null ? null : Math.max(Number(old.expiresAt) || 0, flag.expiresAt) });
    return { ok: true, value: { sceneId: scene.id, docId: doc.id, refreshed: true } };
  }

  // Nova × existentes que ela toca: o elemento da nova faz o papel de "golpe" contra o da que já estava.
  const replaced = [];
  if (payload.noReact !== true) {
    const chain = damageElementChain(element.id);
    for (const doc of existing) {
      const old = surfaceFlagOf(doc);
      if (!old || old.elementId === element.id || !circlesTouch(flag.area, old.area)) continue;
      const outcome = surfaceReaction(chain, old.elementId, elements);
      if (outcome.action === "none") continue;
      const data = doc.toObject();
      replaced.push({ sceneId: scene.id, documentName: doc.documentName, data });
      await doc.delete();
      if (outcome.action === "replace") {
        const inherited = await createSurfaceAsGm({ sceneId: scene.id, x: old.area.x, y: old.area.y, elementId: outcome.leaveSurface, originMagic: old.magic, useId: payload.useId, noReact: true });
        if (inherited.ok && inherited.value?.docId) replaced[replaced.length - 1].becameDocId = inherited.value.docId;
      }
    }
  }

  const { doc, documentName } = await createSurfaceDocument(scene, flag, element);
  // Mágica nascida dentro de um campo de Antimagia some na hora.
  const dispelled = await enforceAntimagicOnSurfaces(scene, { only: doc?.id });
  return { ok: true, value: { sceneId: scene.id, docId: dispelled ? null : doc?.id ?? null, documentName, refreshed: false, replaced, dispelled } };
}

/**
 * Pede ao Mestre uma superfície. Devolve `{ok, value, reason}` (o relay com resposta) — nunca lança.
 * @param {object} payload - ver createSurfaceAsGm; `sourceUuid` (quem pede tem de ser dono dele) vai no relay
 */
export async function requestSurface(payload) {
  try {
    return await runAsGm("createSurface", payload, { reply: true, timeout: 8000 });
  } catch (err) {
    reportError("Superfícies: não deu para pedir ao Mestre.", err, { gmOnly: true });
    return { ok: false, reason: "erro" };
  }
}

async function removeDoc(doc) {
  try {
    await doc.delete();
  } catch (err) {
    reportError("Superfícies: não consegui apagar a superfície.", err, { gmOnly: true });
  }
}

/* ------------------------------------------------------------------ agir (dano e Condição) */

/** A Condição com o efeito padrão dela, por `rounds` rodadas (0 = a duração que a Condição já tem), em quem pisou. */
async function applySurfaceCondition(actor, flag, hitDamage) {
  const condition = getActiveStatusConditions().find(c => c.id === flag.conditionId);
  if (!condition) return;
  const { applyEffectsToActor } = await import("../skills/effects-apply.js");
  const entry = {
    target: "hp",
    amount: 0,
    durationRounds: Math.max(0, Number(flag.conditionRounds) || 0),
    conditionId: condition.id,
    damageElements: flag.elementId ? [flag.elementId] : [],
    hitDamage: Math.max(0, Number(hitDamage) || 0)
  };
  await applyEffectsToActor({ effects: [entry], level: 1, hasUpkeep: false, sourceLevel: 1, sourceMagic: Boolean(flag.magic) }, flag.label || "Superfície", null, actor);
}

/** O dano da superfície: rola, passa pelas defesas do alvo e posta o card com Aplicar (como o contato de Estrutura). */
async function dealSurfaceDamage(flag, tokenDocument) {
  const actor = tokenDocument.actor;
  let roll;
  try {
    roll = await new Roll(flag.damageFormula).evaluate();
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Superfície com fórmula inválida em ${flag.label}: ${flag.damageFormula}`, err);
    return 0;
  }
  const { applyDamageReductions, triggeredLabel, personalTraceTail } = await import("../combat/damage-roll.js");
  const { damageApplyFlags, withDamageTrace } = await import("../combat/damage-apply.js");
  const { cardReactions, reactionLabel } = await import("../combat/reactions.js");
  const mech = { damageElements: flag.elementId ? [flag.elementId] : [], isMagicDamage: Boolean(flag.magic), isAbsoluteDamage: false };
  const reduction = applyDamageReductions(roll.total, mech, actor, { attacker: null });
  const label = flag.label || "Superfície";
  await roll.toMessage({
    speaker: { alias: label },
    flavor: `${escapeHtml(label)} — ${escapeHtml(tokenDocument.name)}: ${reduction.finalDamage}${reactionLabel(reduction.reactions)}${triggeredLabel(reduction.triggeredConditions)}`,
    flags: withDamageTrace(
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
      [{ name: tokenDocument.name, rows: [{ label: "Rolagem (superfície)", value: String(roll.total) }, ...personalTraceTail(reduction, actor)] }]
    )
  });
  return reduction.finalDamage;
}

/**
 * Alguém pisou (ou começou o turno em cima de) uma superfície: dano e Condição. Só Personagem, só o
 * Mestre designado. Devolve o que aconteceu, para teste e depuração.
 * @param {TokenDocument} tokenDocument
 * @param {Document} surfaceDoc
 * @param {{position?:object, elevation?:number}} [at] - onde o Token está (o `moveToken` ainda tem o documento na posição ANTIGA)
 */
export async function triggerSurface(tokenDocument, surfaceDoc, at = {}) {
  if (!isDesignatedGm() || !isSurfacesEnabled() || !tokenDocument || !surfaceDoc) return "off";
  const flag = surfaceFlagOf(surfaceDoc);
  const actor = tokenDocument.actor;
  if (!flag || !actor || actor.type !== "character") return "notCharacter";
  const { isDead } = await import("../combat/incapacitation.js");
  if (isDead(actor)) return "dead";
  if (!surfaceReaches(surfaceDoc, flag, tokenDocument, at.position ?? null, at.elevation ?? null)) return "out";
  if (surfaceImmune(flag.immuneTraits, actorTraits(actor))) return "immune";
  let damage = 0;
  try {
    if (flag.damageFormula) damage = await dealSurfaceDamage(flag, tokenDocument);
    if (flag.conditionId) await applySurfaceCondition(actor, flag, damage);
  } catch (err) {
    reportError(`Superfície: falha ao agir em ${tokenDocument.name}.`, err, { gmOnly: true });
  }
  return "fired";
}

/** Começo do turno de quem está em cima de uma superfície: age de novo. Só o Mestre designado; o morto não. */
export async function tickSurfacesForCombatant(combatant) {
  if (!isDesignatedGm() || !isSurfacesEnabled()) return;
  const tokenDocument = combatant?.token;
  const scene = tokenDocument?.parent;
  if (!tokenDocument?.actor || !scene) return;
  for (const { doc } of surfacesAt(scene, tokenDocument)) await triggerSurface(tokenDocument, doc);
}

/* ------------------------------------------------------------------ duração e Antimagia */

/** Virada da rodada em combate: cada superfície da cena perde 1 rodada (0 = só o relógio) e some ao zerar. */
export async function advanceSurfaces(scene) {
  if (!isDesignatedGm() || !isSurfacesEnabled() || !scene) return;
  for (const doc of surfacesOnScene(scene)) {
    const flag = surfaceFlagOf(doc);
    if (!flag || !(Number(flag.roundsLeft) > 0)) continue;
    const step = surfaceRoundStep(flag.roundsLeft);
    if (step.remove) await removeDoc(doc);
    else await doc.setFlag(SYSTEM_ID, FLAG, { ...flag, roundsLeft: step.roundsLeft });
  }
  await enforceAntimagicOnSurfaces(scene);
}

/**
 * Antimagia: a superfície mágica que um campo fechado de Antimagia toca desaparece. Devolve se alguma
 * (ou a pedida em `only`) foi desfeita. Só o Mestre designado.
 */
export async function enforceAntimagicOnSurfaces(scene, { only = null } = {}) {
  if (!isDesignatedGm() || !isSurfacesEnabled() || !scene) return false;
  const magical = surfacesOnScene(scene).filter(doc => surfaceFlagOf(doc)?.magic && (!only || doc.id === only));
  if (!magical.length) return false;
  const { fieldLevelsTouching } = await import("../structures/structures.js");
  let any = false;
  for (const doc of magical) {
    const flag = surfaceFlagOf(doc);
    const area = surfaceArea(flag);
    if (!area) continue;
    const levels = fieldLevelsTouching(scene, polygonEdges(areaPolygon(area)));
    if (surfaceDispelled({ magic: flag.magic, fieldLevel: levels.magic })) {
      await removeDoc(doc);
      any = true;
    }
  }
  return any;
}

/**
 * Antimagia em Emissão: a área que toca uma superfície mágica a desfaz (matéria nunca). Lado do
 * Mestre; devolve as linhas do chat ("Chamas: desfeita").
 * @param {Scene} scene
 * @param {object} area - área normalizada
 * @param {Array<"magic"|"tech">} kinds
 */
export async function dispelSurfacesInArea(scene, area, kinds) {
  if (!isSurfacesEnabled() || !scene || !area) return [];
  const { areaTouchesStructure } = await import("../structures/structure-geometry.js");
  const lines = [];
  for (const doc of surfacesOnScene(scene)) {
    const flag = surfaceFlagOf(doc);
    const own = surfaceArea(flag);
    if (!flag || !own || !surfaceDispelled({ magic: flag.magic, emissionKinds: kinds })) continue;
    if (!areaTouchesStructure(area, polygonEdges(areaPolygon(own)), true)) continue;
    await removeDoc(doc);
    lines.push(`${flag.label || "Superfície"}: desfeita`);
  }
  return lines;
}

/* ------------------------------------------------------------------ o golpe e a superfície (Aplicar / Desfazer) */

function clientPointOf(tokenDoc) {
  const scene = tokenDoc.parent;
  return tokenDocCenter(tokenDoc, scene?.grid?.size);
}

/**
 * No Aplicar de um card de dano (lado do Mestre): o golpe mexe com o chão do alvo.
 *  1. Reação (8.1) cuja marca foi a SUPERFÍCIE em que ele pisa: pela Tabela, a superfície vira outra
 *     (`leaveSurface`) ou some (tira Condição). Reação de marca/corpo com `leaveSurface` cria a superfície
 *     no ponto do alvo.
 *  2. Elemento do golpe com "Deixa no chão" (só quando o card nasceu de um golpe de Skill/arma:
 *     `state.surface`): rola a chance e cria no ponto do alvo.
 * Devolve o que o Desfazer precisa para voltar.
 * @returns {Promise<{created:object[], removed:object[]}>}
 */
export async function applyHitSurfaces(actor, state) {
  const out = { created: [], removed: [] };
  if (!isSurfacesEnabled() || !actor || !state) return out;
  const token = tokenDocOf(actor);
  const scene = token?.parent;
  if (!scene) return out;
  const point = clientPointOf(token);
  const useId = state.surface?.useId ?? "";
  const originMagic = Boolean(state.surface?.magic);
  const elements = getActiveDamageElements();

  const create = async (elementId, at = point, magic = originMagic) => {
    const outcome = await requestSurface({ sceneId: scene.id, x: at.x, y: at.y, elementId, originMagic: magic, useId, sourceUuid: actor.uuid });
    if (outcome.ok && outcome.value) {
      if (outcome.value.docId && !outcome.value.refreshed) out.created.push({ sceneId: outcome.value.sceneId, docId: outcome.value.docId });
      for (const gone of outcome.value.replaced ?? []) out.removed.push(gone);
    }
    return outcome;
  };

  for (const record of state.reactions ?? []) {
    if (record.source === "surface") {
      const under = surfacesAt(scene, token).find(({ flag }) => flag.elementId === record.markElementId);
      if (!under) continue;
      const outcome = surfaceReaction(damageElementChain(record.hitElementId), under.flag.elementId, elements);
      if (outcome.action === "none") continue;
      out.removed.push({ sceneId: scene.id, documentName: under.doc.documentName, data: under.doc.toObject() });
      const at = under.flag.area ? { x: under.flag.area.x, y: under.flag.area.y } : point;
      await removeDoc(under.doc);
      if (outcome.action === "replace") await create(outcome.leaveSurface, at, under.flag.magic);
    } else if (record.leaveSurface) {
      await create(record.leaveSurface);
    }
  }

  if (state.surface) {
    const seen = new Set();
    for (const elementId of state.elementIds ?? []) {
      if (seen.has(elementId)) continue;
      seen.add(elementId);
      const def = getDamageElement(elementId)?.surface;
      if (!leavesSurface(def)) continue;
      const roll = Math.ceil(Math.random() * 100);
      if (surfaceChanceHits(def.chance, roll)) await create(elementId);
    }
  }
  return out;
}

/** No Desfazer do card: apaga o que o Aplicar criou e recria o que ele tirou. */
export async function undoHitSurfaces(applied) {
  const find = (sceneId, docId) => surfacesOnScene(game.scenes.get(sceneId)).find(d => d.id === docId) ?? null;
  for (const made of applied?.surfacesCreated ?? []) {
    const doc = find(made.sceneId, made.docId);
    if (doc) await removeDoc(doc);
  }
  for (const gone of applied?.surfacesRemoved ?? []) {
    const scene = game.scenes.get(gone.sceneId);
    if (!scene || !gone.data) continue;
    // A que ocupou o lugar da desfeita também sai.
    const became = gone.becameDocId ? find(gone.sceneId, gone.becameDocId) : null;
    if (became) await removeDoc(became);
    if (scene.getEmbeddedCollection(gone.documentName)?.has(gone.data._id)) continue;
    try {
      await scene.createEmbeddedDocuments(gone.documentName, [foundry.utils.deepClone(gone.data)], { keepId: true });
    } catch (err) {
      reportError("Superfícies: não consegui recriar a superfície ao desfazer.", err, { gmOnly: true });
    }
  }
}

/** Desfazer uso de Skill: apaga as superfícies que esse uso criou (`useId`). */
export async function removeSurfacesOfUse(useId) {
  if (!useId) return;
  for (const scene of game.scenes) {
    for (const doc of surfacesOnScene(scene)) {
      if (surfaceFlagOf(doc)?.useId === useId) await removeDoc(doc);
    }
  }
}

/* ------------------------------------------------------------------ efeito de Skill "Cria superfície" */

/** Os efeitos `createSurface` de uma mecânica. */
export function surfaceEffectsOf(mech) {
  return (mech?.effects ?? []).filter(e => e?.target === "createSurface" && e.elementId);
}

/**
 * Efeito de Skill "Cria superfície" (elemento + raio): no Token de cada alvo de um alvo único, ou uma vez
 * no centro da área numa Emissão. Quem usou pede ao Mestre (relay com resposta); o resultado entra no
 * mesmo card do uso. Sem o bloco ligado, só avisa.
 * @returns {Promise<{lines:string[], created:number}>}
 */
export async function runSkillSurfaces({ sourceActor, mech, targets = [], origin = null, area = false }) {
  const entries = surfaceEffectsOf(mech);
  const none = { lines: [], created: 0 };
  if (!entries.length) return none;
  if (!isSurfacesEnabled()) return { lines: ["Cria superfície: o bloco Superfícies está desligado"], created: 0 };
  const scene = canvas?.scene;
  if (!scene) return { lines: ["Cria superfície: sem cena aberta"], created: 0 };
  const originMagic = isMagicUse(mech, sourceActor);
  const useId = currentSkillUseId();
  const points = [];
  if (area && origin && Number.isFinite(Number(origin.x))) points.push({ x: Number(origin.x), y: Number(origin.y) });
  else {
    for (const target of targets) {
      const token = tokenDocOf(target);
      if (token?.parent?.id === scene.id) points.push(clientPointOf(token));
    }
  }
  if (!points.length) return { lines: ["Cria superfície: sem Token do alvo na cena"], created: 0 };
  const lines = [];
  let created = 0;
  for (const entry of entries) {
    const element = getDamageElement(entry.elementId);
    for (const at of points) {
      const outcome = await requestSurface({
        sceneId: scene.id,
        x: at.x,
        y: at.y,
        elementId: entry.elementId,
        radiusMeters: Number(entry.amount) || 0,
        rounds: Number(entry.durationRounds) || 0,
        originMagic,
        useId,
        sourceUuid: sourceActor.uuid
      });
      const failure = relayFailureMessage(outcome, `criar a superfície de ${element?.label ?? entry.elementId}`);
      if (failure) {
        lines.push(failure.replace(/\.$/, ""));
        continue;
      }
      if (outcome.value?.dispelled) lines.push(`${element?.surface?.label || element?.label}: desfeita na hora pela antimagia`);
      else {
        lines.push(`${outcome.value?.refreshed ? "Renova" : "Cria"} ${element?.surface?.label || `${element?.label} no chão`}`);
        created += 1;
      }
    }
  }
  return { lines, created };
}

/** O nome da superfície sobe do Token que entrou nela (depois da animação do movimento). Só quem vê o Token. */
function floatSurfaceName(tokenDoc, flag) {
  if (!canvas?.ready || tokenDoc.parent?.id !== canvas.scene?.id) return;
  const element = getDamageElement(flag.elementId);
  const fill = /^#[0-9a-f]{6}$/i.test(element?.color ?? "") ? element.color : "#7fb3ff";
  const text = flag.label || "Superfície";
  setTimeout(() => {
    const token = tokenDoc.object;
    if (!token || token.destroyed || !token.visible || tokenDoc.isSecret) return;
    canvas.interface.createScrollingText(token.center, text, {
      anchor: CONST.TEXT_ANCHOR_POINTS.TOP,
      direction: CONST.TEXT_ANCHOR_POINTS.TOP,
      distance: 2 * token.h,
      fontSize: 28,
      fill,
      stroke: 0x000000,
      strokeThickness: 5,
      jitter: 0.2
    });
  }, 700);
}

/* ------------------------------------------------------------------ registro */

export function registerSurfaces() {
  // Entrou numa superfície: o destino do movimento (no gancho o documento ainda está na posição ANTIGA).
  Hooks.on("moveToken", async (document, movement) => {
    if (!isSurfacesEnabled()) return;
    const scene = document.parent;
    const actor = document.actor;
    if (!scene || actor?.type !== "character") return;
    const surfaces = surfacesOnScene(scene);
    if (!surfaces.length) return;
    const origin = movement?.origin;
    const destination = movement?.destination;
    if (!origin || !destination) return;
    const where = p => ({ x: p.x, y: p.y, width: p.width ?? document.width, height: p.height ?? document.height });
    for (const doc of surfaces) {
      const flag = surfaceFlagOf(doc);
      if (!flag) continue;
      const before = surfaceReaches(doc, flag, document, where(origin), origin.elevation ?? tokenElevation(document));
      const after = surfaceReaches(doc, flag, document, where(destination), destination.elevation ?? tokenElevation(document));
      if (!surfaceEntered(before, after)) continue;
      // Mesa narrada por voz: o nome da superfície sobe do Token em todo cliente que o vê (cor do elemento).
      floatSurfaceName(document, flag);
      if (isDesignatedGm()) await triggerSurface(document, doc, { position: where(destination), elevation: destination.elevation ?? tokenElevation(document) });
    }
  });

  // Fora de combate a superfície acaba pelo relógio do mundo.
  Hooks.on("updateWorldTime", async worldTime => {
    if (!isDesignatedGm() || !isSurfacesEnabled()) return;
    for (const scene of game.scenes) {
      const docs = surfacesOnScene(scene);
      if (!docs.length) continue;
      const inCombat = sceneInStartedCombat(scene);
      for (const doc of docs) {
        const flag = surfaceFlagOf(doc);
        if (flag && surfaceExpired({ expiresAt: flag.expiresAt, worldTime, inCombat })) await removeDoc(doc);
      }
    }
  });
}
