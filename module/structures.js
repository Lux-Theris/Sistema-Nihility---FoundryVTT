/**
 * Estruturas: Skills que mexem no ambiente (Parede de Pedra, Bloco de Gelo, Barreira de Mana).
 *
 * Uma Estrutura vira **Paredes de verdade** do Foundry (bloqueiam movimento e, se a Estrutura
 * disser, visão — e o deslocamento limitado já respeita parede, então ela trava o token de
 * graça). Parede é invisível pra jogador: o que aparece no mapa é desenhado por cada cliente a
 * partir do registro (structure-render.js), sem documento nenhum. Quem cria é o Mestre designado (via relay):
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
import {
  SYSTEM_ID,
  getStructures,
  getEnergyLabelForActor,
  actorToken,
  getActiveDamageElements,
  actorAntimagicLevel,
  antimagicSurcharge,
  getAntimagicConfig
} from "./config.js";
import { runAsGm, isDesignatedGm } from "./helpers/gm-relay.js";
import {
  structureSegments,
  capPolyline,
  pointsAlongPolyline,
  firstStructureOnPath,
  splitStructureHit,
  segmentCrossing,
  pointInSegments,
  segmentsCross
} from "./structure-geometry.js";
import { structureElementFactor } from "./damage-rules.js";
import { lightSourceData } from "./lights.js";

const FLAG = "structures";
/** Por que cada Estrutura caiu (id → {reason, label, time}): lido pela animação de queda e pelo cartão. */
const FALLS_FLAG = "structureFalls";
/** Quanto tempo um registro de queda fica guardado antes de ser limpo. */
const FALL_MEMORY_MS = 10 * 60 * 1000;

/** Texto do cartão pra cada motivo de queda. */
const FALL_TEXT = {
  destroyed: "foi destruída",
  manaDepleted: "se desfez: acabou a Mana de quem a mantinha",
  expired: "se desfez: o prazo acabou",
  dismissed: "foi desfeita",
  casterDown: "caiu junto com quem a ergueu",
  antimagic: "foi desfeita pela antimagia"
};
const MAX_POINTS = 60;

/** A Estrutura do catálogo, ou `null`. */
export function getStructure(id) {
  return getStructures().find(s => s.id === id) ?? null;
}

/** Força do investimento de Mana recebida de outro cliente, limitada a uma faixa sã. */
function structurePower(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(1000, Math.max(0.01, n)) : 1;
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
export async function requestStructure({ sourceActor, skillId, subSkillIndex = null, structureId, placement, untilDeactivated, label, power = 1 }) {
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
    power,
    label
  });
  return true;
}

/**
 * Lado do Mestre: valida o pedido (a Estrutura vem do catálogo, NUNCA do payload), cria as
 * Paredes, registra na Cena e posta o cartão. O payload vem de outro cliente.
 *
 * O registro vem LOGO depois das Paredes: é ele que permite derrubar a Estrutura (desligar a
 * Skill, dano, rodadas). Na 1.37 um Desenho era criado entre os dois, a criação dele falhava e as
 * Paredes ficavam órfãs — sem registro, nada as removia.
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
      // Estrutura que brilha não pode bloquear a própria luz (metade dela sumiria atrás da parede).
      light: structure.blocksSight && !structure.light ? S.NORMAL : S.NONE,
      sound: S.NONE,
      flags: { [SYSTEM_ID]: { structureInstance: id } }
    }))
  );
  const lights = structure.light ? await createStructureLights(scene, structure, segments, id) : [];

  const instance = {
    id,
    structureId: structure.id,
    label: structure.label,
    wallIds: walls.map(w => w.id),
    lightIds: lights.map(l => l.id),
    // O visual (structure-render.js) desenha a partir daqui em todo cliente.
    segments,
    shape: structure.shape,
    color: structure.color,
    img: structure.img || "",
    manaBarrier: structure.hp === 0,
    // Mana variável: a Vida da Estrutura segue a força do investimento (o payload vem de outro
    // cliente — fica limitado a uma faixa sã). Barreira de mana (Vida 0) não muda.
    hp: Math.round(structure.hp * structurePower(payload.power)),
    hpMax: Math.round(structure.hp * structurePower(payload.power)),
    roundsRemaining: structure.durationRounds > 0 ? structure.durationRounds : null,
    untilDeactivated: Boolean(payload.untilDeactivated) && structure.durationRounds === 0,
    // Do catálogo, copiados na criação (editar o catálogo depois não muda Estrutura em pé).
    blocksAttacks: structure.blocksAttacks,
    elements: structure.elements,
    magic: structure.magic,
    antimagicLevel: structure.antimagicLevel,
    contactDamage: structure.contactDamage,
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

/**
 * Luzes da Estrutura: forma fechada ganha uma luz no centro, cobrindo a forma; linha e forma
 * livre ganham várias ao longo do caminho, pra brilhar inteira. Raio 0 no catálogo = automático.
 * Uma luz que falhe não pode derrubar a Estrutura: as Paredes já existem e o registro vem logo
 * depois (foi exatamente assim que a 1.37 deixou Paredes órfãs).
 */
async function createStructureLights(scene, structure, segments, id) {
  const light = structure.light;
  const unit = Number(scene.grid?.distance) || 1;
  const closed = structure.shape === "circle" || structure.shape === "rect";
  const path = [[segments[0][0], segments[0][1]], ...segments.map(([, , x2, y2]) => [x2, y2])];
  let positions;
  let radius;
  if (closed) {
    const xs = path.map(p => p[0]);
    const ys = path.map(p => p[1]);
    positions = [[(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]];
    const reach = structure.shape === "circle" ? structure.size : structure.size * 0.75;
    radius = light.dim ? { dim: light.dim, bright: light.bright } : { dim: reach + unit, bright: reach / 2 };
  } else {
    radius = light.dim ? { dim: light.dim, bright: light.bright } : { dim: unit * 1.5, bright: unit * 0.5 };
    const spacingPx = metersToPx(scene, radius.dim * 1.5);
    const lengthPx = segments.reduce((sum, [x1, y1, x2, y2]) => sum + Math.hypot(x2 - x1, y2 - y1), 0);
    positions = pointsAlongPolyline(path, Math.min(12, Math.max(1, Math.ceil(lengthPx / spacingPx))));
  }
  try {
    return await scene.createEmbeddedDocuments(
      "AmbientLight",
      positions.map(([x, y]) => ({
        x,
        y,
        walls: true,
        vision: false,
        config: lightSourceData(light, radius),
        flags: { [SYSTEM_ID]: { structureInstance: id } }
      }))
    );
  } catch (err) {
    console.error(`${SYSTEM_ID} | Falha ao criar a luz da Estrutura ${structure.label}.`, err);
    return [];
  }
}

/* ------------------------------------------------------------------ Registro na Cena */

/** Estruturas em pé numa Cena. */
export function structuresOnScene(scene) {
  return Object.values(scene?.getFlag(SYSTEM_ID, FLAG) ?? {}).filter(Boolean);
}

/** Segmentos de uma Estrutura; registros antigos sem eles leem das próprias Paredes. */
export function structureSegmentsOf(scene, instance) {
  if (Array.isArray(instance?.segments) && instance.segments.length) return instance.segments;
  return (instance?.wallIds ?? []).map(id => scene?.walls?.get(id)?.c).filter(Array.isArray);
}

/* ------------------------------------------------------------------ Bloquear ataques */

/** Token do Ator na Cena aberta (ver actorToken em config.js). */
const tokenOnCanvas = actorToken;

/** Quanto a Estrutura ainda segura: a Vida dela, ou a Mana de quem conjurou (barreira de mana). */
function structureCapacity(instance) {
  if (instance.manaBarrier) return fromUuidSync(instance.sourceActorUuid)?.system?.attributes?.energy?.value ?? 0;
  return instance.hp ?? 0;
}

/**
 * A Estrutura entre quem ataca e o alvo, na Cena aberta — a primeira no caminho do centro de um
 * Token ao centro do outro (ou da origem da área, `origin`). `null` sem mapa, sem Token ou sem
 * nada no caminho. A Estrutura não bloqueia os ataques de quem a ergueu: quem conjura uma
 * barreira atira de dentro dela.
 * @returns {{scene: Scene, instance: object, capacity: number, point: {x: number, y: number}}|null}
 */
export function interceptingStructure(attacker, target, { origin = null } = {}) {
  const scene = canvas?.scene;
  if (!canvas?.ready || !scene || !target) return null;
  const targetToken = tokenOnCanvas(target, [...(game.user?.targets ?? [])]);
  const from = origin ?? tokenOnCanvas(attacker, canvas.tokens?.controlled ?? [])?.center;
  if (!targetToken || !from) return null;
  const instances = structuresOnScene(scene).filter(i => i.sourceActorUuid !== attacker?.uuid && instanceInfo(i).blocksAttacks);
  if (!instances.length) return null;
  const hit = firstStructureOnPath(
    [from.x, from.y],
    [targetToken.center.x, targetToken.center.y],
    instances.map(i => ({ id: i.id, segments: structureSegmentsOf(scene, i) }))
  );
  const instance = hit ? instances.find(i => i.id === hit.id) : null;
  if (!instance) return null;
  const to = targetToken.center;
  // Ponto de impacto na parede: é até ali que a animação da Skill vai (ver vfx.js).
  const point = { x: from.x + (to.x - from.x) * hit.t, y: from.y + (to.y - from.y) * hit.t };
  return { scene, instance, capacity: structureCapacity(instance), point };
}

/**
 * Golpe que bate numa Estrutura: ela segura até a capacidade e o resto segue pro alvo. O dano
 * na Estrutura é gravado na hora pelo Mestre (é o ambiente, como a cascata de uma Nave); o do
 * alvo continua nos botões de Aplicar do chat.
 * @returns {{absorbed: number, passed: number, label: string, point: {x: number, y: number}}}
 */
export async function hitStructure(block, amount, elementIds = []) {
  // Elementos: Fogo contra Parede de Gelo bate mais forte NELA (o que passa volta à escala do golpe).
  const factor = structureElementFactor(elementIds, instanceInfo(block.instance).elements, getActiveDamageElements());
  const { absorbed, passed } = splitStructureHit(amount * factor, block.capacity);
  if (absorbed > 0) await runAsGm("damageStructure", { sceneId: block.scene.id, instanceId: block.instance.id, amount: absorbed });
  return { absorbed, passed: factor > 0 ? Math.round(passed / factor) : passed, label: block.instance.label, point: block.point };
}

/**
 * Propriedades de uma Estrutura em pé: as copiadas na criação, ou (registros de antes delas) as do
 * catálogo de hoje.
 */
export function instanceInfo(instance) {
  const catalog = getStructure(instance?.structureId) ?? {};
  const pick = (key, fallback) => (instance?.[key] !== undefined ? instance[key] : catalog[key] ?? fallback);
  return {
    blocksAttacks: pick("blocksAttacks", true) !== false,
    elements: pick("elements", []) ?? [],
    magic: Boolean(pick("magic", false)),
    antimagicLevel: Number(pick("antimagicLevel", 0)) || 0,
    contactDamage: pick("contactDamage", "") ?? "",
    closed: instance?.shape === "circle" || instance?.shape === "rect"
  };
}

/* ------------------------------------------------------------------ Antimagia */

/** Campos antimagia da Cena, com os segmentos. */
function antimagicFields(scene) {
  return structuresOnScene(scene)
    .map(instance => ({ instance, info: instanceInfo(instance), segments: structureSegmentsOf(scene, instance) }))
    .filter(f => f.info.antimagicLevel > 0 && f.segments.length);
}

/** Nível do campo neste ponto (dentro de uma forma fechada). */
function fieldLevelAt(fields, point) {
  return fields.reduce((level, f) => (f.info.closed && pointInSegments(point, f.segments) ? Math.max(level, f.info.antimagicLevel) : level), 0);
}

/**
 * Nível de antimagia de um ataque de `attacker` em `target`: o Selo que o atacante carrega, e os
 * campos que a linha do ataque atravessa, de onde ele sai ou onde o alvo está. Sem mapa, só o Selo.
 */
export function antimagicLevelBetween(attacker, target, { origin = null } = {}) {
  let level = actorAntimagicLevel(attacker);
  const scene = canvas?.scene;
  if (!canvas?.ready || !scene) return level;
  const fields = antimagicFields(scene);
  if (!fields.length) return level;
  const from = origin ?? actorToken(attacker, canvas.tokens?.controlled ?? [])?.center;
  const to = target ? actorToken(target, [...(game.user?.targets ?? [])])?.center : null;
  if (from) level = Math.max(level, fieldLevelAt(fields, [from.x, from.y]));
  if (to) level = Math.max(level, fieldLevelAt(fields, [to.x, to.y]));
  if (from && to) {
    for (const f of fields) {
      if (f.segments.some(seg => segmentCrossing([from.x, from.y], [to.x, to.y], seg) !== null)) level = Math.max(level, f.info.antimagicLevel);
    }
  }
  return level;
}

/** Nível de antimagia onde o Ator está (Selo + campo em volta do Token dele) — pra efeito contínuo. */
export function antimagicLevelAt(actor) {
  let level = actorAntimagicLevel(actor);
  const scene = canvas?.scene;
  if (!canvas?.ready || !scene) return level;
  const token = actorToken(actor, []);
  if (!token) return level;
  return Math.max(level, fieldLevelAt(antimagicFields(scene), [token.center.x, token.center.y]));
}

/**
 * Estruturas mágicas dentro (ou cruzando) de um campo antimagia: quem conjurou paga o custo extra
 * por rodada, da Mana; sem Mana, a antimagia vence e a Estrutura se desfaz. Só o Mestre.
 */
async function enforceAntimagicOnStructures(scene) {
  const fields = antimagicFields(scene);
  if (!fields.length) return;
  for (const instance of structuresOnScene(scene)) {
    const info = instanceInfo(instance);
    if (!info.magic || info.antimagicLevel > 0) continue;
    const segments = structureSegmentsOf(scene, instance);
    const level = fields.reduce((max, f) => {
      const touches = segmentsCross(segments, f.segments) || (f.info.closed && segments.some(([x, y]) => pointInSegments([x, y], f.segments)));
      return touches ? Math.max(max, f.info.antimagicLevel) : max;
    }, 0);
    if (!level) continue;
    const caster = await fromUuid(instance.sourceActorUuid);
    const energy = caster?.system?.attributes?.energy;
    const cost = antimagicSurcharge(0, level, getAntimagicConfig());
    if (energy && energy.value >= cost) {
      await caster.update({ "system.attributes.energy.value": energy.value - cost });
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: caster }),
        whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id).concat(caster.isOwner ? [] : []),
        content: `<p><strong>${instance.label}</strong> resiste à antimagia (nível ${level}): −${cost} ${getEnergyLabelForActor(caster)} de ${caster.name}.</p>`
      });
    } else {
      await removeStructureInstance(scene, instance.id, "antimagic");
    }
  }
}

/* ------------------------------------------------------------------ Dano ao contato */

/**
 * Token atravessou (ou terminou dentro de) uma Estrutura com dano de contato (Muralha de Fogo):
 * rola o dano dela contra quem passou. Só o Mestre designado, no `moveToken`.
 */
export function registerStructureContact() {
  Hooks.on("moveToken", async (document, movement) => {
    if (!isDesignatedGm()) return;
    const scene = document.parent;
    const burning = structuresOnScene(scene).filter(i => instanceInfo(i).contactDamage);
    if (!burning.length || !document.actor) return;
    const size = scene.grid?.size ?? 100;
    const center = p => [Number(p.x) + ((p.width ?? document.width) * size) / 2, Number(p.y) + ((p.height ?? document.height) * size) / 2];
    const origin = movement?.origin;
    if (!origin) return;
    const waypoints = Array.isArray(movement?.passed?.waypoints) && movement.passed.waypoints.length
      ? movement.passed.waypoints
      : [movement?.destination ?? { x: document.x, y: document.y }];
    const path = [center(origin), ...waypoints.map(center)];
    const pathSegments = path.slice(1).map((p, i) => [path[i][0], path[i][1], p[0], p[1]]);
    const end = path[path.length - 1];
    const { applyStructureContactAsGm } = await import("./skill-effects.js");
    for (const instance of burning) {
      const info = instanceInfo(instance);
      const segments = structureSegmentsOf(scene, instance);
      const crossed = segmentsCross(pathSegments, segments);
      const endsInside = info.closed && pointInSegments(end, segments);
      if (crossed || endsInside) await applyStructureContactAsGm(document, instance, info);
    }
  });
}

/**
 * Derruba uma Estrutura: apaga as Paredes e a luz (e o Desenho de registros antigos), tira o
 * registro e guarda POR QUE caiu (`reason`: destroyed, manaDepleted, expired, dismissed,
 * casterDown) — é o que escolhe a animação de queda em cada tela e o texto do cartão. Só o Mestre.
 */
export async function removeStructureInstance(scene, instanceId, reason = "dismissed") {
  const instance = scene?.getFlag(SYSTEM_ID, FLAG)?.[instanceId];
  if (!instance) return;
  const wallIds = (instance.wallIds ?? []).filter(id => scene.walls.has(id));
  // Luz é APAGADA junto com a Estrutura (não desligada/escondida).
  const lightIds = (instance.lightIds ?? []).filter(id => scene.lights.has(id));
  if (lightIds.length) await scene.deleteEmbeddedDocuments("AmbientLight", lightIds);
  const drawingIds = (instance.drawingIds ?? []).filter(id => scene.drawings.has(id));
  if (wallIds.length) await scene.deleteEmbeddedDocuments("Wall", wallIds);
  if (drawingIds.length) await scene.deleteEmbeddedDocuments("Drawing", drawingIds);
  // Uma escrita só: sai do registro e entra a queda (a animação precisa dos dois juntos). Quedas
  // antigas são limpas no mesmo passo, pro flag não crescer pra sempre.
  const now = Date.now();
  const update = {
    [`flags.${SYSTEM_ID}.${FLAG}.-=${instanceId}`]: null,
    [`flags.${SYSTEM_ID}.${FALLS_FLAG}.${instanceId}`]: { reason, label: instance.label, time: now }
  };
  for (const [id, fall] of Object.entries(scene.getFlag(SYSTEM_ID, FALLS_FLAG) ?? {})) {
    if (!fall || now - (fall.time ?? 0) > FALL_MEMORY_MS) update[`flags.${SYSTEM_ID}.${FALLS_FLAG}.-=${id}`] = null;
  }
  await scene.update(update);
  refreshStructureCards(scene.id, instanceId);
}

/** Como uma Estrutura caiu (`{reason, label, time}`), se caiu há pouco. */
export function structureFallOf(scene, instanceId) {
  return scene?.getFlag(SYSTEM_ID, FALLS_FLAG)?.[instanceId] ?? null;
}

/**
 * Paredes marcadas como parte de uma Estrutura que não está mais no registro da Cena: sobras da
 * 1.37, quando a criação parava no meio (Paredes criadas, registro não). Sem registro nada as
 * derrubaria nunca. Só o Mestre designado, ao abrir a Cena.
 */
export async function removeOrphanStructureWalls(scene) {
  if (!scene || !isDesignatedGm()) return;
  const known = new Set(structuresOnScene(scene).map(i => i.id));
  const isOrphan = doc => {
    const instanceId = doc.getFlag(SYSTEM_ID, "structureInstance");
    return instanceId && !known.has(instanceId);
  };
  const walls = scene.walls.filter(isOrphan);
  const lights = scene.lights.filter(isOrphan);
  if (walls.length) await scene.deleteEmbeddedDocuments("Wall", walls.map(w => w.id));
  if (lights.length) await scene.deleteEmbeddedDocuments("AmbientLight", lights.map(l => l.id));
  if (walls.length || lights.length) {
    console.log(`${SYSTEM_ID} | ${walls.length} Parede(s) e ${lights.length} luz(es) de Estrutura sem registro removida(s) da Cena ${scene.name}.`);
  }
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
  if (hp <= 0) return removeStructureInstance(scene, instanceId, "destroyed");
  await scene.setFlag(SYSTEM_ID, `${FLAG}.${instanceId}.hp`, hp);
  refreshStructureCards(scene.id, instanceId);
}

/** Nova rodada: Estruturas com prazo perdem uma rodada e caem ao zerar. Só o Mestre. */
export async function advanceStructures(scene) {
  await enforceAntimagicOnStructures(scene);
  for (const instance of structuresOnScene(scene)) {
    if (instance.roundsRemaining === null || instance.roundsRemaining === undefined) continue;
    const left = instance.roundsRemaining - 1;
    if (left <= 0) await removeStructureInstance(scene, instance.id, "expired");
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
        await removeStructureInstance(scene, instance.id, "dismissed");
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
        await removeStructureInstance(scene, instance.id, energyZero ? "manaDepleted" : "casterDown");
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
    const fall = structureFallOf(scene, card.instanceId);
    box.innerHTML = `<span class="structure-state">${fall ? `${fall.label ?? "A Estrutura"} ${FALL_TEXT[fall.reason] ?? FALL_TEXT.dismissed}.` : "Estrutura derrubada."}</span>`;
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
  box.querySelector(".structure-remove").addEventListener("click", () => removeStructureInstance(scene, card.instanceId, "destroyed"));
}
