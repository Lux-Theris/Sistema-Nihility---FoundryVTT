/**
 * Skills de Emissão e Zona: em vez de pedir um Ator-alvo via dropdown, quem usa a Skill
 * posiciona uma forma (Círculo/Cone/Linha) no canvas e ela afeta quem estiver dentro.
 *
 * Até a 1.63.0 isto era montado sobre Measured Templates (a prévia era um template na camada
 * `canvas.templates`, e "quem está dentro" vinha do `shape` dele). A V14 removeu esse tipo de
 * documento e a camada — a opção de área sumia das fichas sem aviso e criar Zona falhava no
 * console. Agora:
 *  - a prévia é um desenho próprio em `canvas.controls` (o mesmo jeito da colocação de
 *    Estruturas), igual nas duas versões;
 *  - "quem está dentro" é geometria pura (`area-geometry.js`, testada), sobre a área guardada;
 *  - só o documento que a Zona deixa na cena muda por versão: Measured Template na V13, Region
 *    na V14 (`zoneDocumentData`).
 *
 * Único arquivo do sistema que toca canvas/Tokens para áreas — skill-effects.js e
 * actor-sheet.js só recebem a lista final de Atores já resolvida.
 */

import { currentSkillUseId } from "../skills/skill-use-context.js";
import { SYSTEM_ID, actorToken, isElevationEnabled } from "../core/config.js";
import { runAsGm, mayActFor, ownedDoc } from "../helpers/gm-relay.js";
import { RELAY_REASONS, refuse, relayFailureMessage } from "../helpers/gm-relay-rules.js";
import { foundryGeneration } from "../helpers/foundry-compat.js";
import { areaFromSkill, areaContains, areaContains3d, areaPolygon, normalizeArea, tokenDocCenter, areaFromTemplateData, areaAffectsTarget, zoneDocumentData } from "./area-geometry.js";
import { clampToRange, filterByReach, markCostFactor, pointDistance } from "./range-rules.js";
import { pointReach, viaMarkFrom, casterTokenOf } from "./range.js";
import { isDead } from "./incapacitation.js";
import { tokenElevation } from "./elevation.js";

/**
 * O ponto está dentro da área? Com o recurso Voo, altura e escavação ligado, a altura também conta
 * (círculo = esfera; cone e linha, a distância 3D ao vértice; debaixo da terra, ninguém de cima chega).
 */
function insideArea(area, point, elevation, pxPerUnit) {
  return isElevationEnabled() ? areaContains3d(area, point, elevation, pxPerUnit) : areaContains(area, point);
}

/** Elevação do Token do Ator de um uuid (a Marca usada), ou 0. */
function elevationOfActorUuid(uuid) {
  try {
    return tokenElevation(actorToken(fromUuidSync(uuid)));
  } catch (err) {
    return 0;
  }
}

/** Precisa só de uma cena aberta no canvas — nada específico de versão. */
export function areaEffectsSupported() {
  return typeof canvas !== "undefined" && !!canvas?.ready && !!canvas.scene && !!canvas.controls;
}

/** Escala da cena: pixels por unidade (metro) e tamanho da célula em pixels. */
export function sceneScale(scene) {
  const size = Number(scene?.grid?.size) || 100;
  const distance = Number(scene?.grid?.distance) || 1;
  return { pxPerUnit: size / distance, cellPx: size };
}

/** true = a forma tem uma direção ajustável (gira com a roda do mouse antes de confirmar). */
function needsDirection(areaShape) {
  return areaShape === "cone" || areaShape === "ray";
}

/** Ponto encaixado no centro da célula (Shift segura = sem encaixe). */
function snapToGrid(point, free) {
  if (free || !canvas.grid?.getSnappedPoint) return point;
  return canvas.grid.getSnappedPoint(point, { mode: CONST.GRID_SNAPPING_MODES.CENTER });
}

/** Cor do usuário como "#rrggbb" (na V12+ `user.color` é um `Color`). */
function userColorCss() {
  const color = game.user?.color;
  return color?.css ?? (typeof color === "string" ? color : "#ff0000");
}

function localPoint(event) {
  const source = typeof event.getLocalPosition === "function" ? event : event.data;
  return source.getLocalPosition(canvas.stage);
}

/**
 * Deixa o usuário posicionar a forma da Skill no canvas — segue o mouse, roda do mouse gira
 * Cone/Linha (Shift = passo fino), clique esquerdo confirma, clique direito ou Esc cancela.
 * Devolve `{area, via}` (`area-geometry.js`; `via` = a Marca usada, ou null) ou null se cancelado.
 *
 * `reach` (range.js, opcional; sem ele a forma é livre como sempre foi):
 *  - forma PRESA (`reach.free` falso): sai do Token de quem lança e só gira com a roda; com Marcas, a
 *    tecla M troca a origem entre quem lança e cada Marca (a forma sai do Marcado);
 *  - forma LIVRE com alcance: o ponto de origem só vai até a borda do alcance de quem lança, a menos
 *    que caia dentro do círculo de alcance de uma Marca (então é "pela Marca"). Os círculos aparecem
 *    fracos no mapa.
 */
async function placeArea(mech, reach = null, { caster = null } = {}) {
  if (!areaEffectsSupported()) {
    throw new Error("Skills de área precisam de uma cena aberta no canvas.");
  }
  const scale = sceneScale(canvas.scene);
  const colorCss = userColorCss();
  const color = Number(foundry.utils.Color?.from?.(colorCss) ?? 0xff0000);

  let direction = 0;
  const held = Boolean(reach) && !reach.free;
  // Origens possíveis de uma forma presa: quem lança e, em seguida, cada Marca.
  const anchors = held
    ? [
        { point: reach.anchor, via: null },
        ...reach.centers.map(m => {
          const distance = pointDistance(reach.anchor, m.point);
          return { point: m.point, via: { ...m, distance, factor: markCostFactor(distance, reach.rangePx) } };
        })
      ]
    : [];
  let anchorIndex = 0;
  let via = null;
  let origin = held ? { ...anchors[0].point } : snapToGrid({ x: canvas.stage.pivot.x, y: canvas.stage.pivot.y });
  /** Aplica o alcance ao ponto sob o mouse (forma livre com alcance). */
  const constrain = point => {
    if (!reach || held || !(reach.rangePx > 0)) return point;
    const reached = pointReach(reach, point);
    if (reached) {
      via = reached.via;
      return point;
    }
    via = null;
    const clamped = clampToRange(point, reach.anchor, reach.rangePx);
    return { x: clamped.x, y: clamped.y };
  };
  if (reach && !held) origin = constrain(origin);
  // O centro da área fica na altura de quem lança (ou do Marcado, se a forma sai dele); sem Token, 0.
  const casterElevation = isElevationEnabled() && caster ? tokenElevation(actorToken(caster, canvas.tokens?.controlled ?? [])) : 0;
  const currentElevation = () => (!isElevationEnabled() ? 0 : via ? elevationOfActorUuid(via.uuid) : casterElevation);
  const current = () => areaFromSkill(mech, origin, { ...scale, direction, elevation: currentElevation() });

  const graphics = new PIXI.Graphics();
  canvas.controls.addChild(graphics);
  const draw = () => {
    const area = current();
    graphics.clear();
    // Círculos de alcance: o de quem lança e o de cada Marca (fracos).
    if (reach && reach.rangePx > 0) {
      graphics.lineStyle(2, color, 0.35).beginFill(color, 0.04).drawCircle(reach.anchor.x, reach.anchor.y, reach.rangePx).endFill();
      for (const m of reach.centers) graphics.lineStyle(2, 0xffd36b, 0.35).beginFill(0xffd36b, 0.04).drawCircle(m.point.x, m.point.y, reach.rangePx).endFill();
    }
    graphics.lineStyle(3, color, 0.9).beginFill(color, 0.2);
    if (area.shape === "circle") graphics.drawCircle(area.x, area.y, area.radius);
    else graphics.drawPolygon(areaPolygon(area));
    graphics.endFill();
  };
  draw();

  const turnHint = needsDirection(mech.areaShape) ? " · roda do mouse gira" : "";
  const heldHint = held ? ` · sai de quem lança${anchors.length > 1 ? " · M troca para uma Marca" : ""}` : "";
  ui.notifications.info(`Posicione a área: clique confirma${turnHint}${heldHint} · Esc ou clique direito cancela.`);

  const placement = await new Promise(resolve => {
    let moveTime = 0;

    const onMove = event => {
      const now = Date.now();
      if (now - moveTime <= 20) return;
      moveTime = now;
      if (held) return;
      origin = constrain(snapToGrid(localPoint(event), event.data?.originalEvent?.shiftKey ?? event.shiftKey));
      draw();
    };

    const onWheel = event => {
      if (!needsDirection(mech.areaShape)) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 5 : 15;
      direction = (direction + step * Math.sign(event.deltaY) + 360) % 360;
      draw();
    };

    const onConfirm = event => {
      if ((event.button ?? event.data?.button) !== 0) return;
      event.stopPropagation();
      finish({ area: current(), via });
    };

    const onCancel = event => {
      event.preventDefault?.();
      finish(null);
    };

    const onKeyDown = event => {
      if (held && anchors.length > 1 && (event.key === "m" || event.key === "M")) {
        event.preventDefault();
        anchorIndex = (anchorIndex + 1) % anchors.length;
        origin = { ...anchors[anchorIndex].point };
        via = anchors[anchorIndex].via;
        draw();
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish(null);
    };

    function finish(value) {
      canvas.stage.off("mousemove", onMove);
      canvas.stage.off("mousedown", onConfirm);
      canvas.app.view.removeEventListener("contextmenu", onCancel);
      canvas.app.view.removeEventListener("wheel", onWheel);
      document.removeEventListener("keydown", onKeyDown, true);
      resolve(value);
    }

    canvas.stage.on("mousemove", onMove);
    canvas.stage.on("mousedown", onConfirm);
    canvas.app.view.addEventListener("contextmenu", onCancel);
    canvas.app.view.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("keydown", onKeyDown, true);
  });

  canvas.controls.removeChild(graphics);
  graphics.destroy();
  return placement;
}

/**
 * Emissão instantânea: posiciona a forma e devolve os Atores dos Tokens dentro dela.
 * @param {{system: object}} skill - objeto com `.system` = `skill.system` ou snapshot de Sub-Skill
 * @returns {Promise<Actor[]>}
 */
export async function pickAreaTargets(skill, reach = null, { caster = null, target = null } = {}) {
  const placed = await placeArea(skill.system, reach, { caster });
  if (!placed?.area) return [];
  return resolveAreaTargets(skill.system, placed, reach, { caster, target });
}

/**
 * Quem a área já posicionada atinge (a mesma conta de `pickAreaTargets`, sem pedir clique). `placed` =
 * `{area, via}` de `placeArea`/`casterAreaPlacement`. `target` = o alvo escolhido da Skill ("Todos menos quem
 * usa e o alvo"). `reach` só importa para cone/linha livres e para a Marca.
 * @returns {Actor[]} com `.viaMark`, `.origin` e `.area` pendurados, como `pickAreaTargets`
 */
export function resolveAreaTargets(mech, placed, reach = null, { caster = null, target = null } = {}) {
  const area = placed?.area;
  if (!area) return [];

  // Cone/linha livres: quem está além do alcance (de quem lança, ou da Marca usada) não sofre.
  const { pxPerUnit } = sceneScale(canvas.scene);
  const inside = canvas.tokens.placeables.filter(token => insideArea(area, token.center, tokenElevation(token), pxPerUnit));
  const limited =
    reach && reach.free && reach.rangePx > 0 && (mech.areaShape === "cone" || mech.areaShape === "ray")
      ? filterByReach(inside, placed.via?.point ?? reach.anchor, reach.rangePx, token => token.center)
      : inside;
  // Quem a área atinge (todos / menos quem lançou / aliados / inimigos / menos quem lançou e o alvo) e nunca os mortos.
  const casterDisposition = caster ? casterTokenOf(caster)?.document?.disposition ?? null : null;
  const actors = limited
    .filter(token => token.actor && areaAffectsTarget({
      affects: mech.areaAffects,
      isCaster: Boolean(caster) && token.actor.uuid === caster.uuid,
      isTarget: Boolean(target) && token.actor.uuid === target.uuid,
      dead: isDead(token.actor),
      casterDisposition,
      disposition: token.document?.disposition ?? null
    }))
    .map(token => token.actor);
  // Qual Marca serviu (a confirmação do custo e o fator vão em useSkillEffect).
  actors.viaMark = viaMarkFrom(placed.via ?? null, reach);
  // A origem da área viaja junto (propriedade do array, então quem só lê a lista não muda): é
  // dela que se traça a linha até cada alvo pra ver se uma Estrutura está no caminho.
  actors.origin = { x: area.x, y: area.y };
  // A área inteira também (Antimagia em Emissão desfaz as Estruturas que ela toca).
  actors.area = area;
  return actors;
}

/** Posiciona a forma no mapa (com clique) e devolve `{area, via}`, ou null se cancelado. Para a Combinada, que põe uma vez. */
export async function pickAreaPlacement(mech, reach = null, { caster = null } = {}) {
  return placeArea(mech, reach, { caster });
}

/**
 * A mesma posição (origem e direção) aplicada à forma de OUTRA parte: cada parte tem o seu tamanho, forma
 * e "quem atinge", mas a Combinada põe a área uma vez só.
 */
export function reshapeAreaPlacement(mech, placed, { caster = null } = {}) {
  if (!placed?.area) return null;
  const scale = sceneScale(canvas.scene);
  const origin = { x: placed.area.x, y: placed.area.y };
  const elevation = Number(placed.area.elevation) || 0;
  return { area: areaFromSkill(mech, origin, { ...scale, direction: placed.area.direction ?? 0, elevation }), via: placed.via ?? null };
}

/**
 * Forma presa em quem lança, sem clique (círculo com o centro em quem usa): a Combinada usa nas partes de
 * área "sai de quem lança". Devolve `{area, via: null}` ou null sem cena/Token de quem lança.
 */
export function casterAreaPlacement(mech, caster) {
  const token = caster ? casterTokenOf(caster) : null;
  if (!areaEffectsSupported() || !token?.center) return null;
  const scale = sceneScale(canvas.scene);
  const elevation = isElevationEnabled() ? tokenElevation(token) : 0;
  return { area: areaFromSkill(mech, { x: token.center.x, y: token.center.y }, { ...scale, direction: 0, elevation }), via: null };
}

/* -------------------------------------------- */
/*  Zonas: área que fica na cena                 */
/* -------------------------------------------- */

/**
 * Posiciona uma Zona (mesma interação da Emissão) e devolve a área — pronta para `createZone` —
 * ou null se o usuário cancelou. Nada é criado aqui.
 */
export async function pickZonePlacement(skill, reach = null, { caster = null } = {}) {
  return zonePlacementFrom(await placeArea(skill.system, reach, { caster }), reach);
}

/** A colocação de Zona a partir de uma área já posicionada (a Combinada põe a área uma vez). */
export function zonePlacementFrom(placed, reach = null) {
  return placed?.area ? { area: placed.area, color: userColorCss(), viaMark: viaMarkFrom(placed.via ?? null, reach) } : null;
}

/**
 * Cria a Zona na cena (ao contrário da Emissão, que some ao confirmar), marcada com um flag que
 * diz quem a lançou, qual Skill, quantas rodadas restam e a área exata. A criação vai pelo
 * Mestre (`runAsGm`): jogador nem sempre pode escrever na Scene.
 *
 * @returns {Promise<boolean>} a Zona foi (ou pode ter sido) criada. Sem Mestre conectado ou com
 *   recusa, avisa quem usou e devolve false — o card "criou a zona" e a XP não saem. Timeout conta
 *   como criada (o Mestre pode só ter demorado), igual às Estruturas.
 */
export async function createZone(placement, { sourceActor, skillId, subSkillIndex, label, rounds, untilDeactivated = false }) {
  if (!canvas?.scene || !placement?.area) return false;
  const outcome = await runAsGm("createZone", {
    sceneId: canvas.scene.id,
    area: placement.area,
    color: placement.color,
    zone: {
      sourceUuid: sourceActor.uuid,
      skillId,
      subSkillIndex: subSkillIndex ?? null,
      label,
      // Skill Ativa: a Zona vive até a Skill ser desligada, sem contagem de rodadas.
      untilDeactivated: Boolean(untilDeactivated),
      roundsRemaining: Math.max(1, Number(rounds) || 1),
      // De que lado quem lançou estava ("Quem a área atinge": aliados/inimigos), caso o Token dele
      // saia da cena depois.
      casterDisposition: casterTokenOf(sourceActor)?.document?.disposition ?? null,
      // Desfazer uso (skill-undo.js): o Mestre acha esta Zona pelo id do uso.
      useId: currentSkillUseId()
    }
  }, { reply: true });
  const failure = relayFailureMessage(outcome, `criar a Zona ${label ?? ""}`.trim());
  if (failure) {
    ui.notifications.warn(failure);
    return outcome.reason === "timeout";
  }
  return true;
}

/** Apaga as Zonas que uma Skill Ativa mantinha (ao desativá-la). Vai pelo Mestre. */
export async function removeZonesFor(sourceActor, skillId, subSkillIndex) {
  await runAsGm("removeZones", { sourceUuid: sourceActor.uuid, skillId, subSkillIndex: subSkillIndex ?? null });
}

/**
 * Documentos de Zona (Regions e, até a V13, Measured Templates marcados) de uma cena. Na V14 a
 * coleção de templates não existe mais — nem é tocada, para não disparar aviso de depreciação.
 */
export function zonesOnScene(scene = canvas?.scene) {
  if (!scene) return [];
  const docs = [...(scene.regions ?? [])];
  if (foundryGeneration() < 14) docs.push(...(scene.templates ?? []));
  return docs.filter(doc => doc.getFlag(SYSTEM_ID, "zone"));
}

/** A área de uma Zona: a guardada no flag, ou (Zona da V13 de antes desta versão) a do template. */
export function zoneArea(zoneDoc) {
  const saved = normalizeArea(zoneDoc.getFlag(SYSTEM_ID, "zone")?.area);
  if (saved) return saved;
  if (zoneDoc.documentName !== "MeasuredTemplate") return null;
  return areaFromTemplateData(zoneDoc, sceneScale(zoneDoc.parent).pxPerUnit);
}

/**
 * O centro do Token está dentro da área da Zona? Só lê documentos (não precisa da cena estar
 * aberta no canvas de quem processa o turno).
 */
export function zoneContainsToken(zoneDoc, tokenDoc) {
  const area = zoneArea(zoneDoc);
  if (!area || !tokenDoc) return false;
  return insideArea(area, tokenDocCenter(tokenDoc, zoneDoc.parent?.grid?.size), tokenElevation(tokenDoc), sceneScale(zoneDoc.parent).pxPerUnit);
}


// ---------------------------------------------------------------------------
// Ações do relay do Mestre (ver helpers/gm-relay.js). Juntadas em core/relay-actions.js.
// Todas recebem `(payload, user)`; `user` é dito pelo servidor, nunca pelo payload.
// ---------------------------------------------------------------------------
export const RELAY_HANDLERS = {
  /** Apaga as Zonas que uma Skill Ativa mantinha (ao desligá-la). Quem pede: dono de quem lançou. */
  async removeZones({ sourceUuid, skillId, subSkillIndex }, user) {
    if (!(await mayActFor(user, sourceUuid))) return;
    for (const scene of game.scenes) {
      for (const doc of zonesOnScene(scene)) {
        const zone = doc.getFlag(SYSTEM_ID, "zone");
        if (zone?.sourceUuid === sourceUuid && zone.skillId === skillId && (zone.subSkillIndex ?? null) === (subSkillIndex ?? null)) {
          await doc.delete();
        }
      }
    }
  },

  /**
   * Cria a Zona na cena: Region na V14, Measured Template na V13 (`zoneDocumentData`). A área
   * vem do cliente de quem lançou, então passa por `normalizeArea` (formas e números limitados),
   * e quem pede tem de ser dono de quem lançou.
   */
  async createZone({ sceneId, area, color, zone }, user) {
    const scene = game.scenes.get(sceneId);
    const source = await ownedDoc(zone?.sourceUuid, user);
    const clean = normalizeArea(area);
    if (!scene) return refuse("a cena não existe mais");
    if (!source) return refuse(RELAY_REASONS.permission);
    if (!clean) return refuse("a área da Zona ficou inválida");

    const label = String(zone.label ?? "").trim() || "Zona"; // Region recusa nome vazio
    const { documentName, data } = zoneDocumentData(clean, {
      generation: foundryGeneration(),
      pxPerUnit: sceneScale(scene).pxPerUnit,
      color: /^#[0-9a-f]{6}$/i.test(color ?? "") ? color : "#ff0000",
      name: label,
      visibility: CONST.REGION_VISIBILITY?.ALWAYS ?? 2,
      flags: {
        [SYSTEM_ID]: {
          zone: {
            sourceUuid: source.uuid,
            skillId: String(zone.skillId ?? ""),
            subSkillIndex: Number.isInteger(zone.subSkillIndex) ? zone.subSkillIndex : null,
            label,
            untilDeactivated: Boolean(zone.untilDeactivated),
            roundsRemaining: Math.min(Math.max(Number(zone.roundsRemaining) || 1, 1), 100),
            area: clean,
            useId: String(zone.useId ?? "").slice(0, 32),
            casterDisposition: Number.isInteger(zone.casterDisposition) ? zone.casterDisposition : null
          }
        }
      }
    });
    await scene.createEmbeddedDocuments(documentName, [data]);
  }
};
