/**
 * Estruturas: Skills que mexem no ambiente (Parede de Pedra, Bloco de Gelo, Barreira de Mana).
 *
 * Uma Estrutura vira **Paredes de verdade** do Foundry (bloqueiam movimento e, se a Estrutura
 * disser, visão — e o deslocamento limitado já respeita parede, então ela trava o token de
 * graça) mais um Desenho que mostra onde ela está. Quem cria é o Mestre designado (via relay):
 * jogador não pode criar Parede. O registro de cada Estrutura em pé mora num flag da Cena
 * (`structures`), e um cartão no chat mostra a Vida e dá ao Mestre os botões de dano e remover.
 *
 * Regras (decididas com o dono):
 *  - Vida > 0: cai quando zera. **Vida 0 = barreira de mana**: o dano sai da Mana de quem conjurou.
 *  - Duração > 0: cai ao fim das rodadas.
 *  - Duração 0 e Skill Ativa: dura até a Skill ser desligada.
 *  - Duração 0 e Skill normal: fica até o Mestre remover, ou até a Vida ou a Mana de quem conjurou
 *    chegar a 0. Barreira de mana cai sempre que a Mana de quem conjurou chega a 0.
 *  - Mesa sem mapa: a Skill só posta o cartão (ninguém tem onde pôr parede).
 *
 * A geometria (cortar a forma no tamanho máximo) é pura e testada: structure-geometry.js.
 */
import { SYSTEM_ID, getStructures, getEnergyLabelForActor } from "./config.js";
import { runAsGm, isDesignatedGm } from "./helpers/gm-relay.js";
import { structureSegments, capPolyline } from "./structure-geometry.js";

const FLAG = "structures";
const MAX_POINTS = 60;

/** A Estrutura do catálogo, ou `null`. */
export function getStructure(id) {
  return getStructures().find(s => s.id === id) ?? null;
}

/** Metros → pixels na cena. */
function metersToPx(scene, meters) {
  const distance = Number(scene?.grid?.distance) || 1;
  const size = Number(scene?.grid?.size) || 100;
  return (Number(meters) / distance) * size;
}

/** Ponto encaixado no grid (Shift segura = sem encaixe). */
function snap(point, free) {
  if (free || !canvas.grid?.getSnappedPoint) return point;
  const M = CONST.GRID_SNAPPING_MODES;
  return canvas.grid.getSnappedPoint(point, { mode: M.CENTER | M.VERTEX | M.EDGE_MIDPOINT });
}

/* ------------------------------------------------------------------ Posicionar */

/**
 * Deixa quem usa a Skill posicionar a Estrutura no mapa. Devolve `{sceneId, shape, points}` ou
 * `null` se cancelou.
 *  - Círculo/Quadrado: segue o mouse; clique confirma.
 *  - Linha: clique no início, clique no fim (cortada no tamanho máximo).
 *  - Forma livre: cada clique acrescenta um ponto; Enter termina; Backspace desfaz o último;
 *    termina sozinha quando o comprimento acaba.
 *  - Esc ou clique direito cancela. Shift desliga o encaixe no grid.
 */
export async function pickStructurePlacement(structure) {
  if (!canvas?.ready || !canvas.scene) return null;
  const scene = canvas.scene;
  const sizePx = metersToPx(scene, structure.size);
  const shape = structure.shape;
  const color = Number(foundry.utils.Color?.from?.(structure.color) ?? 0x9aa1c2);

  const graphics = new PIXI.Graphics();
  canvas.controls.addChild(graphics);
  const hints = {
    circle: "clique para posicionar",
    rect: "clique para posicionar",
    line: "clique no início e depois no fim",
    free: `clique ponto a ponto (até ${structure.size} m) · Enter termina · Backspace desfaz`
  };
  ui.notifications.info(`${structure.label}: ${hints[shape]} · Esc cancela.`);

  const points = [];
  let cursor = null;

  const draw = () => {
    graphics.clear();
    const preview = cursor ? [...points, cursor] : [...points];
    if (shape === "circle" || shape === "rect") {
      if (!cursor) return;
      graphics.lineStyle(6, color, 0.9).beginFill(color, 0.2);
      if (shape === "circle") graphics.drawCircle(cursor[0], cursor[1], sizePx);
      else graphics.drawRect(cursor[0] - sizePx / 2, cursor[1] - sizePx / 2, sizePx, sizePx);
      graphics.endFill();
      return;
    }
    const capped = capPolyline(shape === "line" ? preview.slice(0, 2) : preview, sizePx);
    if (capped.length < 2) return;
    graphics.lineStyle(8, color, 0.9);
    graphics.moveTo(capped[0][0], capped[0][1]);
    for (const [x, y] of capped.slice(1)) graphics.lineTo(x, y);
    // O que passa do comprimento aparece fraco, como o pontilhado da régua de movimento.
    const last = capped.at(-1);
    if (cursor && (last[0] !== cursor[0] || last[1] !== cursor[1])) {
      graphics.lineStyle(3, color, 0.3).moveTo(last[0], last[1]).lineTo(cursor[0], cursor[1]);
    }
  };

  const result = await new Promise(resolve => {
    const finish = value => {
      canvas.stage.off("mousemove", onMove);
      canvas.stage.off("mousedown", onDown);
      canvas.app.view.removeEventListener("contextmenu", onCancel);
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const done = () => finish({ sceneId: scene.id, shape, points: points.slice(0, MAX_POINTS) });

    const onMove = event => {
      const local = event.data.getLocalPosition(canvas.stage);
      const p = snap(local, event.data.originalEvent?.shiftKey);
      cursor = [p.x, p.y];
      draw();
    };
    const onDown = event => {
      if ((event.button ?? event.data?.button) !== 0) return;
      event.stopPropagation();
      const local = event.data.getLocalPosition(canvas.stage);
      const p = snap(local, event.data.originalEvent?.shiftKey);
      points.push([p.x, p.y]);
      if (shape === "circle" || shape === "rect") return done();
      if (shape === "line" && points.length >= 2) return done();
      // Forma livre acaba sozinha quando o comprimento acaba.
      if (shape === "free" && capPolyline(points, sizePx).length < points.length) return done();
      draw();
    };
    const onCancel = event => {
      event.preventDefault?.();
      finish(null);
    };
    const onKey = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      } else if (event.key === "Enter" && shape === "free" && points.length >= 2) {
        event.preventDefault();
        done();
      } else if (event.key === "Backspace" && shape === "free" && points.length) {
        event.preventDefault();
        points.pop();
        draw();
      }
    };

    canvas.stage.on("mousemove", onMove);
    canvas.stage.on("mousedown", onDown);
    canvas.app.view.addEventListener("contextmenu", onCancel);
    document.addEventListener("keydown", onKey, true);
  });

  canvas.controls.removeChild(graphics);
  graphics.destroy();
  return result;
}

/* ------------------------------------------------------------------ Criar (Mestre) */

/**
 * Pede ao Mestre pra erguer a Estrutura. Sem mapa (`placement` nulo), só posta o cartão.
 * @param {object} args
 */
export async function requestStructure({ sourceActor, skillId, subSkillIndex = null, structureId, placement, untilDeactivated, label }) {
  const structure = getStructure(structureId);
  if (!structure) {
    ui.notifications.warn("Esta Skill não tem uma Estrutura válida escolhida.");
    return null;
  }
  if (!placement) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
      content: `<p><strong>${sourceActor.name}</strong> usou <strong>${label}</strong> e ergueu <strong>${structure.label}</strong>.</p>`
    });
    return true;
  }
  await runAsGm("createStructure", {
    sceneId: placement.sceneId,
    shape: placement.shape,
    points: placement.points,
    structureId,
    sourceActorUuid: sourceActor.uuid,
    skillId,
    subSkillIndex,
    untilDeactivated: Boolean(untilDeactivated),
    label
  });
  return true;
}

/**
 * Lado do Mestre: valida o pedido (a Estrutura vem do catálogo, NUNCA do payload), cria Paredes e
 * Desenho, registra na Cena e posta o cartão. O payload vem de outro cliente.
 */
export async function createStructureAsGm(payload) {
  const scene = game.scenes.get(payload?.sceneId);
  const structure = getStructure(payload?.structureId);
  const source = payload?.sourceActorUuid ? await fromUuid(payload.sourceActorUuid) : null;
  if (!scene || !structure || !source) return;

  const points = (Array.isArray(payload.points) ? payload.points : [])
    .slice(0, MAX_POINTS)
    .map(p => [Number(p?.[0]), Number(p?.[1])])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const segments = structureSegments(structure.shape, points, metersToPx(scene, structure.size));
  if (!segments.length) return;

  const S = CONST.WALL_SENSE_TYPES;
  const M = CONST.WALL_MOVEMENT_TYPES;
  const id = foundry.utils.randomID();
  const walls = await scene.createEmbeddedDocuments(
    "Wall",
    segments.map(c => ({
      c,
      move: structure.blocksMove ? M.NORMAL : M.NONE,
      sight: structure.blocksSight ? S.NORMAL : S.NONE,
      light: structure.blocksSight ? S.NORMAL : S.NONE,
      sound: S.NONE,
      flags: { [SYSTEM_ID]: { structureInstance: id } }
    }))
  );
  const drawings = await scene.createEmbeddedDocuments("Drawing", [drawingData(structure, segments, id)]);

  const instance = {
    id,
    structureId: structure.id,
    label: structure.label,
    wallIds: walls.map(w => w.id),
    drawingIds: drawings.map(d => d.id),
    manaBarrier: structure.hp === 0,
    hp: structure.hp,
    hpMax: structure.hp,
    roundsRemaining: structure.durationRounds > 0 ? structure.durationRounds : null,
    untilDeactivated: Boolean(payload.untilDeactivated) && structure.durationRounds === 0,
    sourceActorUuid: source.uuid,
    skillId: String(payload.skillId ?? ""),
    subSkillIndex: Number.isInteger(payload.subSkillIndex) ? payload.subSkillIndex : null
  };
  await scene.setFlag(SYSTEM_ID, `${FLAG}.${id}`, instance);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: source }),
    content: `<p><strong>${source.name}</strong> usou <strong>${String(payload.label ?? "")}</strong> e ergueu <strong>${structure.label}</strong>.</p>`,
    flags: { [SYSTEM_ID]: { structureCard: { sceneId: scene.id, instanceId: id } } }
  });
}

/** Desenho que marca a Estrutura no mapa (as Paredes em si quase não aparecem pra jogador). */
function drawingData(structure, segments, id) {
  const xs = segments.flatMap(([x1, , x2]) => [x1, x2]);
  const ys = segments.flatMap(([, y1, , y2]) => [y1, y2]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(1, Math.max(...xs) - minX);
  const height = Math.max(1, Math.max(...ys) - minY);
  const closed = structure.shape === "circle" || structure.shape === "rect";
  const fill = CONST.DRAWING_FILL_TYPES;
  const points = [segments[0][0] - minX, segments[0][1] - minY, ...segments.flatMap(([, , x2, y2]) => [x2 - minX, y2 - minY])];
  return {
    x: minX,
    y: minY,
    shape: { type: CONST.DRAWING_TYPES.POLYGON, width, height, points },
    strokeWidth: 10,
    strokeColor: structure.color,
    strokeAlpha: 0.9,
    fillType: closed ? (structure.img ? fill.PATTERN : fill.SOLID) : fill.NONE,
    fillColor: structure.color,
    fillAlpha: 0.25,
    texture: closed && structure.img ? structure.img : null,
    text: structure.label,
    fontSize: 20,
    textColor: "#ffffff",
    flags: { [SYSTEM_ID]: { structureInstance: id } }
  };
}

/* ------------------------------------------------------------------ Registro na Cena */

/** Estruturas em pé numa Cena. */
export function structuresOnScene(scene) {
  return Object.values(scene?.getFlag(SYSTEM_ID, FLAG) ?? {}).filter(Boolean);
}

/** Derruba uma Estrutura: apaga Paredes e Desenho e tira o registro. Só o Mestre chama. */
export async function removeStructureInstance(scene, instanceId) {
  const instance = scene?.getFlag(SYSTEM_ID, FLAG)?.[instanceId];
  if (!instance) return;
  const wallIds = (instance.wallIds ?? []).filter(id => scene.walls.has(id));
  const drawingIds = (instance.drawingIds ?? []).filter(id => scene.drawings.has(id));
  if (wallIds.length) await scene.deleteEmbeddedDocuments("Wall", wallIds);
  if (drawingIds.length) await scene.deleteEmbeddedDocuments("Drawing", drawingIds);
  await scene.unsetFlag(SYSTEM_ID, `${FLAG}.${instanceId}`);
  refreshStructureCards(scene.id, instanceId);
}

/** Redesenha os cartões de uma Estrutura (Vida/estado mudaram). */
function refreshStructureCards(sceneId, instanceId) {
  for (const message of game.messages) {
    const card = message.getFlag(SYSTEM_ID, "structureCard");
    if (card?.sceneId === sceneId && card.instanceId === instanceId) ui.chat?.updateMessage?.(message);
  }
}

/**
 * Dano numa Estrutura. Vida > 0: tira da Vida e derruba ao zerar. Barreira de mana: tira da Mana
 * de quem conjurou (Mana em 0 derruba a barreira pelo hook de Mana).
 */
export async function damageStructure(scene, instanceId, amount) {
  const instance = scene?.getFlag(SYSTEM_ID, FLAG)?.[instanceId];
  const value = Math.max(0, Math.round(Number(amount) || 0));
  if (!instance || !value) return;

  if (instance.manaBarrier) {
    const caster = await fromUuid(instance.sourceActorUuid);
    const energy = caster?.system?.attributes?.energy;
    if (!energy) return;
    await caster.update({ "system.attributes.energy.value": Math.max(0, energy.value - value) });
    refreshStructureCards(scene.id, instanceId);
    return;
  }

  const hp = Math.max(0, instance.hp - value);
  if (hp <= 0) return removeStructureInstance(scene, instanceId);
  await scene.setFlag(SYSTEM_ID, `${FLAG}.${instanceId}.hp`, hp);
  refreshStructureCards(scene.id, instanceId);
}

/** Nova rodada: Estruturas com prazo perdem uma rodada e caem ao zerar. Só o Mestre. */
export async function advanceStructures(scene) {
  for (const instance of structuresOnScene(scene)) {
    if (instance.roundsRemaining === null || instance.roundsRemaining === undefined) continue;
    const left = instance.roundsRemaining - 1;
    if (left <= 0) await removeStructureInstance(scene, instance.id);
    else await scene.setFlag(SYSTEM_ID, `${FLAG}.${instance.id}.roundsRemaining`, left);
  }
}

/** Remove, em todas as Cenas, as Estruturas que uma Skill Ativa mantinha. Vai pelo Mestre. */
export async function removeStructuresFor(sourceActor, skillId, subSkillIndex) {
  if (!sourceActor) return;
  await runAsGm("removeStructures", { sourceUuid: sourceActor.uuid, skillId, subSkillIndex: subSkillIndex ?? null });
}

/** Lado do Mestre de `removeStructuresFor`. */
export async function removeStructuresForAsGm({ sourceUuid, skillId, subSkillIndex }) {
  for (const scene of game.scenes) {
    for (const instance of structuresOnScene(scene)) {
      if (instance.sourceActorUuid === sourceUuid && instance.skillId === skillId && (instance.subSkillIndex ?? null) === (subSkillIndex ?? null)) {
        await removeStructureInstance(scene, instance.id);
      }
    }
  }
}

/**
 * Vida ou Mana de quem conjurou chegou a 0: caem as Estruturas sem prazo que não dependem de
 * Skill Ativa, e toda barreira de mana dele quando é a Mana que zerou.
 */
export async function collapseStructuresOfCaster(actor, { hpZero, energyZero }) {
  if (!isDesignatedGm()) return;
  for (const scene of game.scenes) {
    for (const instance of structuresOnScene(scene)) {
      if (instance.sourceActorUuid !== actor.uuid) continue;
      const untimed = (instance.roundsRemaining === null || instance.roundsRemaining === undefined) && !instance.untilDeactivated;
      if ((untimed && (hpZero || energyZero)) || (instance.manaBarrier && energyZero)) {
        await removeStructureInstance(scene, instance.id);
      }
    }
  }
}

/* ------------------------------------------------------------------ Cartão no chat */

/** Botões do cartão da Estrutura (só o Mestre vê): Vida/estado, aplicar dano, remover. */
export function renderStructureControls(message, html) {
  const card = message.getFlag(SYSTEM_ID, "structureCard");
  if (!card || !game.user.isGM) return;
  const scene = game.scenes.get(card.sceneId);
  const instance = scene?.getFlag(SYSTEM_ID, FLAG)?.[card.instanceId];

  const box = document.createElement("div");
  box.className = "nihility-structure-controls";
  if (!instance) {
    box.innerHTML = `<span class="structure-state">Estrutura derrubada.</span>`;
    html.appendChild(box);
    return;
  }

  let state;
  if (instance.manaBarrier) {
    const caster = fromUuidSync(instance.sourceActorUuid);
    const energy = caster?.system?.attributes?.energy;
    state = `Barreira de mana — dano sai da ${caster ? getEnergyLabelForActor(caster) : "Mana"} de ${caster?.name ?? "?"} (${energy?.value ?? 0}/${energy?.max ?? 0})`;
  } else {
    state = `Vida ${instance.hp}/${instance.hpMax}`;
  }
  if (instance.roundsRemaining) state += ` · ${instance.roundsRemaining} rodada(s)`;
  else if (instance.untilDeactivated) state += " · até desligar a Skill";

  box.innerHTML = `
    <span class="structure-state">${state}</span>
    <input type="number" class="structure-damage-input" min="0" placeholder="Dano"/>
    <button type="button" class="structure-damage">Dano</button>
    <button type="button" class="structure-remove">Derrubar</button>`;
  html.appendChild(box);

  box.querySelector(".structure-damage").addEventListener("click", () =>
    damageStructure(scene, card.instanceId, box.querySelector(".structure-damage-input").value)
  );
  box.querySelector(".structure-remove").addEventListener("click", () => removeStructureInstance(scene, card.instanceId));
}
