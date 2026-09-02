/**
 * Skills de Emissão: em vez de pedir um Ator-alvo via dropdown, quem usa a Skill posiciona
 * uma forma (Círculo/Cone/Linha) no canvas e ela afeta quem estiver dentro. Implementado em
 * cima de Measured Templates — o recurso padrão do próprio Foundry pra exatamente esse caso
 * de uso (o mesmo que sistemas como dnd5e usam pra "templates de magia"), disponível desde
 * muito antes do V12 e não específico de nenhuma versão. Uma tentativa anterior usava a API
 * de Scene Regions do V14 (`canvas.regions.placeRegion`), mas essa API nunca foi confirmada
 * contra um Foundry real e não existe em V12/13 — provavelmente a causa de "clicar em Usar
 * não faz nada" pra Skills de Emissão. O template aqui é 100% client-side (nunca é salvo na
 * Scene) e some assim que o usuário confirma ou cancela.
 *
 * Único arquivo do sistema que toca canvas/Tokens — skill-effects.js e actor-sheet.js só
 * recebem a lista final de Atores já resolvida, sem saber nada de geometria.
 */

/** Measured Templates existem em qualquer Foundry suportado por este sistema (mínimo V12) — sem necessidade de feature-detection de versão. */
export function areaEffectsSupported() {
  return typeof canvas !== "undefined" && !!canvas?.templates && !!CONFIG.MeasuredTemplate?.documentClass;
}

/** true = a forma tem uma direção ajustável (gira com a roda do mouse antes de confirmar). Círculo não precisa. */
function needsDirection(areaShape) {
  return areaShape === "cone" || areaShape === "ray";
}

/** Traduz Formato de Área/Distância/Ângulo da Skill pros dados de um MeasuredTemplateDocument. */
function buildTemplateData(skillSystem, origin) {
  const distance = Number(skillSystem.areaDistance) || 0;
  const base = {
    x: origin.x,
    y: origin.y,
    direction: 0,
    fillColor: game.user?.color ?? "#ff0000",
    author: game.user?.id
  };

  switch (skillSystem.areaShape) {
    case "circle":
      return { ...base, t: "circle", distance };
    case "cone":
      return { ...base, t: "cone", distance, angle: Number(skillSystem.areaAngle) || 53 };
    case "ray":
      return { ...base, t: "ray", distance, width: canvas.dimensions?.distance || 1 };
    default:
      throw new Error(`Formato de Área inválido: "${skillSystem.areaShape}".`);
  }
}

/** `getSnappedPoint` é a API atual (V12+); mantém um fallback só por segurança. */
function snapToGrid(point) {
  if (canvas.grid?.getSnappedPoint) {
    return canvas.grid.getSnappedPoint(point, { mode: CONST.GRID_SNAPPING_MODES.CENTER });
  }
  return canvas.grid?.getSnappedPosition?.(point.x, point.y) ?? point;
}

/**
 * Deixa o usuário posicionar a forma da Skill no canvas — segue o mouse, roda do mouse gira
 * Cone/Linha, clique esquerdo confirma, clique direito ou Esc cancela — e devolve os Atores
 * dos Tokens encontrados dentro dela.
 * @param {{system: object}} skill - objeto com `.system` = `skill.system` ou snapshot de Sub-Skill
 * @returns {Promise<Actor[]>}
 */
export async function pickAreaTargets(skill) {
  if (!areaEffectsSupported()) {
    throw new Error("Skills de Emissão precisam do sistema de Measured Templates do Foundry (canvas indisponível).");
  }

  const layer = canvas.templates;
  const initialLayer = canvas.activeLayer;
  const startPoint = snapToGrid({ x: canvas.stage.pivot.x, y: canvas.stage.pivot.y });

  const templateDoc = new CONFIG.MeasuredTemplate.documentClass(buildTemplateData(skill.system, startPoint), {
    parent: canvas.scene
  });
  const preview = new CONFIG.MeasuredTemplate.objectClass(templateDoc);

  layer.activate();
  await preview.draw();
  layer.preview.addChild(preview);

  const placement = await new Promise(resolve => {
    let moveTime = 0;

    const onMove = event => {
      event.stopPropagation();
      const now = Date.now();
      if (now - moveTime <= 20) return;
      const local = event.data.getLocalPosition(layer);
      const snapped = snapToGrid(local);
      preview.document.updateSource({ x: snapped.x, y: snapped.y });
      preview.refresh();
      moveTime = now;
    };

    const onWheel = event => {
      if (!needsDirection(skill.system.areaShape)) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 5 : 15;
      preview.document.updateSource({ direction: preview.document.direction + step * Math.sign(event.deltaY) });
      preview.refresh();
    };

    const onConfirm = event => {
      if (event.button !== 0) return;
      finish();
      resolve({ shape: preview.shape, x: preview.document.x, y: preview.document.y });
    };

    const onCancel = event => {
      event.preventDefault?.();
      finish();
      resolve(null);
    };

    const onKeyDown = event => {
      if (event.key === "Escape") onCancel(event);
    };

    function finish() {
      canvas.stage.off("mousemove", onMove);
      canvas.stage.off("mousedown", onConfirm);
      canvas.app.view.removeEventListener("contextmenu", onCancel);
      canvas.app.view.removeEventListener("wheel", onWheel);
      document.removeEventListener("keydown", onKeyDown);
    }

    canvas.stage.on("mousemove", onMove);
    canvas.stage.on("mousedown", onConfirm);
    canvas.app.view.addEventListener("contextmenu", onCancel);
    canvas.app.view.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("keydown", onKeyDown);
  });

  layer.preview.removeChild(preview);
  preview.destroy();
  initialLayer?.activate();

  if (!placement) return [];

  return canvas.tokens.placeables
    .filter(token => placement.shape.contains(token.center.x - placement.x, token.center.y - placement.y))
    .map(token => token.actor)
    .filter(Boolean);
}
