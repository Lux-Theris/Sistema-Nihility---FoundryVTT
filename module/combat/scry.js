/**
 * Ver pela Marca (1.123.0). Regras puras em `scry-rules.js`; aqui, o efeito (gravado em quem olha) e a visão no mapa.
 *
 * **A sonda (V14, build 370, lida no código do cliente do Foundry em `canvas/sources/point-vision-source.mjs`,
 * `canvas/placeables/token.mjs` e `canvas/groups/visibility.mjs`):**
 *  - Uma fonte de visão só deste cliente É possível, sem documento nenhum. `PointVisionSource` só aceita um **Token
 *    placeable** como `object` (o construtor lança erro com outra coisa), mas o próprio núcleo cria fontes extras por cima
 *    do mesmo Token: `Token#_createSharedFogVisionSource` faz `new CONFIG.Canvas.visionSourceClass({sourceId, object: token})`
 *    com um `sourceId` diferente do do Token. Fazemos igual: um `sourceId` nosso (`nihility.scry.<efeito>`) sobre o Token
 *    do Marcado, `initialize(dados)` com o raio, `add()` na coleção `canvas.effects.visionSources`, e um
 *    `canvas.perception.update({refreshVision, refreshLighting, initializeVisionModes})`. Nada é gravado no mapa nem no
 *    Token; a fonte morre com `remove()` + `destroy()`.
 *  - Paredes bloqueiam e lugar escuro continua escuro (é uma fonte de visão normal do `visibility`).
 *  - O `testVisibility` olha `visionSource.object.document.detectionModes` (o `basicSight` do Marcado). Um Marcado sem
 *    "visão básica" nos modos de detecção do Token pode não projetar visão: a fonte abre, mas `source.active` volta falso e
 *    o cliente avisa que a visão não abriu (o Mestre narra). É o risco a conferir na primeira sessão; o plano B (um Token
 *    "olho" invisível do jogador que segue o Marcado) NÃO foi construído.
 *  - O Mestre nunca abre fonte: sem fontes ativas o `testVisibility` já devolve verdadeiro para o Mestre, e uma fonte a mais
 *    o deixaria cego fora dela. Só os donos de quem olha (não-Mestres) abrem a fonte.
 *  - Sem teste no Foundry nesta sessão: o que vale é a leitura do código; a primeira sessão confirma.
 */
import { SYSTEM_ID, isSkillRangeEnabled, sameActor, debugLog } from "../core/config.js";
import { createActiveEffects } from "../helpers/foundry-compat.js";
import { makeAnchor } from "./effect-anchors.js";
import { markEffectOn } from "./range.js";
import { rememberAnchoredTarget } from "../skills/effects-apply.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";
import { CORE_SKILLS } from "../core/magic-rules.js";
import { escapeHtml } from "../helpers/html.js";
import { SCRY_FLAG, scryBlockReason, scryFlagFrom, scryGmLine, scryElsewhereLine, scryRadiusMeters, senseObserved, OBSERVED_NOTICE } from "./scry-rules.js";

const SOURCE_PREFIX = "nihility.scry.";

/** O nível de Detecção do Ator (a pré-feita `coreSkill: "manaDetection"`, a mais alta). */
function actorDetectionLevel(actor) {
  let best = 0;
  for (const item of actor?.items ?? []) {
    if (item.type === "skill" && item.system?.coreSkill === CORE_SKILLS.detection) best = Math.max(best, Number(item.system.level) || 0);
  }
  return best;
}

function gmIds() {
  return game.users.filter(u => u.isGM).map(u => u.id);
}

/** O alvo tem Marca de quem usa, e quem usa existe? Devolve a razão da recusa ou null. Usado antes de pagar. */
export function scryRefusal(caster, targetActor) {
  if (!caster) return "sem quem olhe";
  return scryBlockReason({ hasMark: Boolean(markEffectOn(targetActor, caster.uuid)), sameActor: sameActor(caster, targetActor), enabled: isSkillRangeEnabled() });
}

/**
 * O efeito de Skill "Ver pela Marca" aplicado: grava o efeito em QUEM OLHA (nunca no Marcado), avisa o Mestre e, se for o
 * caso, o Marcado que sente. Devolve a linha do resumo.
 */
export async function openScryFor(entry, { mech, label, originSkill, origin, targetActor, subSkillIndex, sourceLevel, sourceMagic, sourceTech, appliedBy, xp }) {
  const caster = originSkill?.parent ?? null;
  const refusal = scryRefusal(caster, targetActor);
  if (refusal) return `Ver pela Marca: ${refusal}`;
  const tiedToActive = Boolean(mech.hasUpkeep);
  const anchor = makeAnchor({ skillUuid: origin.uuid, skillId: origin.id, subSkillIndex });
  if (tiedToActive) await rememberAnchoredTarget(caster, anchor, caster.uuid);
  // Olhar de novo pela mesma Marca renova: a visão antiga desta Skill sai.
  const old = caster.effects.filter(e => e.flags?.[SYSTEM_ID]?.[SCRY_FLAG]?.markedUuid === targetActor.uuid && (e.flags[SYSTEM_ID].sourceSkillId ?? null) === (origin.id ?? null)).map(e => e.id);
  if (old.length) await caster.deleteEmbeddedDocuments("ActiveEffect", old);
  const rounds = Math.max(0, Math.floor(Number(entry.durationRounds) || 0));
  await createActiveEffects(caster, [
    {
      name: `Vendo pela Marca de ${targetActor.name}`,
      img: entry.icon || "icons/svg/eye.svg",
      origin: origin.uuid ?? undefined,
      statuses: [],
      duration: !tiedToActive && rounds > 0 ? { rounds } : {},
      flags: {
        [SYSTEM_ID]: {
          skillEffect: true,
          conditionId: "",
          tiedToActive,
          activeAnchors: tiedToActive ? [anchor] : [],
          sourceSkillId: origin.id,
          sourceSubSkillIndex: subSkillIndex,
          [SCRY_FLAG]: scryFlagFrom({ markedUuid: targetActor.uuid, radius: Number(entry.amount) || 0, level: sourceLevel, nature: { tech: sourceTech } }),
          sourceLevel,
          magic: sourceMagic,
          tech: sourceTech,
          appliedBy
        }
      }
    }
  ]);
  xp.push({ flat: true });
  await noticeScry(caster, targetActor, sourceLevel);
  return `Vendo pela Marca de ${targetActor.name}${tiedToActive ? " (até desativar)" : rounds > 0 ? ` (${rounds} ${rounds === 1 ? "rodada" : "rodadas"})` : ""}`;
}

/**
 * Os avisos do uso: o Mestre recebe "Kael vê e ouve pela Marca do batedor" (e, com o Marcado em outra cena, o card para narrar);
 * o Marcado com Detecção alta o bastante recebe, só para o dono dele e o Mestre, "Você sente que está sendo observado".
 */
async function noticeScry(caster, targetActor, level) {
  const here = canvas?.ready ? (canvas.tokens?.placeables ?? []).some(t => t.actor?.uuid === targetActor.uuid) : true;
  const line = here ? scryGmLine(caster.name, targetActor.name) : scryElsewhereLine(caster.name, targetActor.name, "outra cena");
  await ChatMessage.create({ whisper: gmIds(), speaker: ChatMessage.getSpeaker({ actor: caster }), content: `<p>${escapeHtml(line)}</p>` });
  if (senseObserved(actorDetectionLevel(targetActor), level)) {
    await announceVoiceOfTheWorld(targetActor, { kind: "info", title: "", body: OBSERVED_NOTICE, bannerMs: 8000 });
  }
}

/* ------------------------------------------------------------------ A visão no mapa (cliente) */

/** As fontes abertas neste cliente: efeito → { source, markedUuid }. */
const open = new Map();
let warnedOnce = false;
let queued = null;

/** Pixels por metro da cena aberta. */
function pixelsPerMeter() {
  const d = canvas?.dimensions;
  if (d?.distancePixels) return d.distancePixels;
  return canvas?.grid?.size && canvas?.grid?.distance ? canvas.grid.size / canvas.grid.distance : 1;
}

/** As visões que ESTE cliente tem de abrir: efeitos `scry` ligados nos Atores de que o usuário é dono (nunca o Mestre). */
function wantedScries() {
  if (!canvas?.ready || game.user.isGM || !canvas.scene?.tokenVision) return [];
  const out = [];
  const seen = new Set();
  const actors = [...(game.actors ?? []), ...(canvas.tokens?.placeables ?? []).map(t => t.actor)].filter(Boolean);
  for (const actor of actors) {
    if (!actor.isOwner || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    for (const effect of actor.effects) {
      const flag = effect.flags?.[SYSTEM_ID]?.[SCRY_FLAG];
      if (!effect.disabled && !effect.isSuppressed && flag?.markedUuid) out.push({ id: effect.uuid, viewer: actor, ...flag });
    }
  }
  return out;
}

function closeSource(entry) {
  try {
    entry.source.remove();
    entry.source.destroy();
  } catch (err) {
    debugLog("scry: falha ao fechar a fonte", err);
  }
}

/** Os dados da fonte: os do próprio Token do Marcado, com o raio do efeito e a visão em 360°. */
function sourceDataFor(token, radiusMeters) {
  const base = typeof token._getVisionSourceData === "function" ? token._getVisionSourceData() : {};
  const radius = radiusMeters * pixelsPerMeter();
  const origin = typeof token.document?.getVisionOrigin === "function" ? token.document.getVisionOrigin() : { x: token.center.x, y: token.center.y, elevation: token.document?.elevation ?? 0 };
  return { ...base, ...origin, radius, lightRadius: radius, externalRadius: 0, angle: 360, rotation: 0, visionMode: "basic", disabled: false, preview: false };
}

/** Abre ou atualiza as fontes de visão deste cliente para bater com os efeitos `scry` ligados. */
function syncScryVision() {
  if (!canvas?.ready) return;
  const wanted = wantedScries();
  const keep = new Set();
  let changed = false;
  for (const want of wanted) {
    const token = (canvas.tokens?.placeables ?? []).find(t => t.actor?.uuid === want.markedUuid && !t.document.hidden);
    if (!token) continue;
    keep.add(want.id);
    try {
      const radius = scryRadiusMeters(want.radius, (want.viewer.getActiveTokens?.()[0]?.sightRange ?? 0) / pixelsPerMeter());
      let entry = open.get(want.id);
      if (!entry) {
        const source = new CONFIG.Canvas.visionSourceClass({ sourceId: `${SOURCE_PREFIX}${want.id}`, object: token });
        entry = { source, markedUuid: want.markedUuid, radius };
        open.set(want.id, entry);
        source.initialize(sourceDataFor(token, radius));
        source.add();
        changed = true;
        if (!source.active && !warnedOnce) {
          warnedOnce = true;
          ui.notifications?.warn("A visão pela Marca não abriu neste cliente. O Mestre narra o que se vê.");
        }
      } else {
        entry.source.initialize(sourceDataFor(token, radius));
        changed = true;
      }
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Ver pela Marca: a fonte de visão falhou.`, err);
      if (!warnedOnce) {
        warnedOnce = true;
        ui.notifications?.warn("A visão pela Marca não abriu neste cliente. O Mestre narra o que se vê.");
      }
    }
  }
  for (const [id, entry] of [...open]) {
    if (keep.has(id)) continue;
    closeSource(entry);
    open.delete(id);
    changed = true;
  }
  if (changed) canvas.perception?.update({ initializeVisionModes: true, refreshVision: true, refreshLighting: true });
}

/** Agrupa pedidos de sincronização do mesmo instante (várias escritas de efeito seguidas) num só. */
function queueSync() {
  if (queued) return;
  queued = setTimeout(() => {
    queued = null;
    try {
      syncScryVision();
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Ver pela Marca: a sincronização falhou.`, err);
    }
  }, 50);
}

const isScryEffect = effect => Boolean(effect?.flags?.[SYSTEM_ID]?.[SCRY_FLAG]);

/** Liga a visão aos eventos (chamado no `init`). */
export function registerScry() {
  Hooks.on("canvasReady", () => {
    open.clear();
    queueSync();
  });
  Hooks.on("canvasTearDown", () => {
    for (const entry of open.values()) closeSource(entry);
    open.clear();
  });
  for (const name of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(name, effect => {
      if (isScryEffect(effect)) queueSync();
    });
  }
  // A fonte acompanha o Token do Marcado quando ele anda.
  Hooks.on("refreshToken", (token, flags) => {
    if (!open.size || !(flags?.refreshPosition || flags?.refreshElevation)) return;
    for (const entry of open.values()) {
      if (entry.markedUuid !== token.actor?.uuid) continue;
      try {
        entry.source.initialize(sourceDataFor(token, entry.radius));
        canvas.perception?.update({ refreshVision: true, refreshLighting: true });
      } catch (err) {
        debugLog("scry: falha ao seguir o Token", err);
      }
    }
  });
  Hooks.on("createToken", () => open.size && queueSync());
  Hooks.on("deleteToken", () => open.size && queueSync());
}

/**
 * As visões abertas de um Ator, para a linha do Mestre na Janela de Efeitos e no Painel do combate:
 * `[{viewer, markedName}]`. Lê só os efeitos (vale em qualquer cliente, inclusive o do Mestre).
 */
export function scryLinesFor(actor) {
  const lines = [];
  for (const effect of actor?.effects ?? []) {
    const flag = effect.flags?.[SYSTEM_ID]?.[SCRY_FLAG];
    if (effect.disabled || !flag?.markedUuid) continue;
    let name = "?";
    try {
      name = fromUuidSync(flag.markedUuid)?.name ?? "?";
    } catch {
      name = "?";
    }
    lines.push(scryGmLine(actor.name, name));
  }
  return lines;
}
