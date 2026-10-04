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

import { SYSTEM_ID } from "../core/config.js";
import { runAsGm } from "../helpers/gm-relay.js";
import { foundryGeneration } from "../helpers/foundry-compat.js";
import { areaFromSkill, areaContains, areaPolygon, normalizeArea, tokenDocCenter, areaFromTemplateData } from "./area-geometry.js";

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
 * Devolve a área (`area-geometry.js`) ou null se cancelado.
 */
async function placeArea(mech) {
  if (!areaEffectsSupported()) {
    throw new Error("Skills de área precisam de uma cena aberta no canvas.");
  }
  const scale = sceneScale(canvas.scene);
  const colorCss = userColorCss();
  const color = Number(foundry.utils.Color?.from?.(colorCss) ?? 0xff0000);

  let direction = 0;
  let origin = snapToGrid({ x: canvas.stage.pivot.x, y: canvas.stage.pivot.y });
  const current = () => areaFromSkill(mech, origin, { ...scale, direction });

  const graphics = new PIXI.Graphics();
  canvas.controls.addChild(graphics);
  const draw = () => {
    const area = current();
    graphics.clear();
    graphics.lineStyle(3, color, 0.9).beginFill(color, 0.2);
    if (area.shape === "circle") graphics.drawCircle(area.x, area.y, area.radius);
    else graphics.drawPolygon(areaPolygon(area));
    graphics.endFill();
  };
  draw();

  const turnHint = needsDirection(mech.areaShape) ? " · roda do mouse gira" : "";
  ui.notifications.info(`Posicione a área: clique confirma${turnHint} · Esc ou clique direito cancela.`);

  const placement = await new Promise(resolve => {
    let moveTime = 0;

    const onMove = event => {
      const now = Date.now();
      if (now - moveTime <= 20) return;
      moveTime = now;
      origin = snapToGrid(localPoint(event), event.data?.originalEvent?.shiftKey ?? event.shiftKey);
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
      finish(current());
    };

    const onCancel = event => {
      event.preventDefault?.();
      finish(null);
    };

    const onKeyDown = event => {
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
export async function pickAreaTargets(skill) {
  const area = await placeArea(skill.system);
  if (!area) return [];

  const actors = canvas.tokens.placeables
    .filter(token => areaContains(area, token.center))
    .map(token => token.actor)
    .filter(Boolean);
  // A origem da área viaja junto (propriedade do array, então quem só lê a lista não muda): é
  // dela que se traça a linha até cada alvo pra ver se uma Estrutura está no caminho.
  actors.origin = { x: area.x, y: area.y };
  return actors;
}

/* -------------------------------------------- */
/*  Zonas: área que fica na cena                 */
/* -------------------------------------------- */

/**
 * Posiciona uma Zona (mesma interação da Emissão) e devolve a área — pronta para `createZone` —
 * ou null se o usuário cancelou. Nada é criado aqui.
 */
export async function pickZonePlacement(skill) {
  const area = await placeArea(skill.system);
  return area ? { area, color: userColorCss() } : null;
}

/**
 * Cria a Zona na cena (ao contrário da Emissão, que some ao confirmar), marcada com um flag que
 * diz quem a lançou, qual Skill, quantas rodadas restam e a área exata. A criação vai pelo
 * Mestre (`runAsGm`): jogador nem sempre pode escrever na Scene.
 */
export async function createZone(placement, { sourceActor, skillId, subSkillIndex, label, rounds, untilDeactivated = false }) {
  if (!canvas?.scene || !placement?.area) return;
  await runAsGm("createZone", {
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
      roundsRemaining: Math.max(1, Number(rounds) || 1)
    }
  });
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
  return areaContains(area, tokenDocCenter(tokenDoc, zoneDoc.parent?.grid?.size));
}
