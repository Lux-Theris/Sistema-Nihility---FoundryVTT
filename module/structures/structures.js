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
 *  - Vida > 0: cai quando zera. **A Vida é a Mana** (`manaPowered`): o dano sai da Mana de quem conjurou.
 *  - Material: física (segura tudo, até Dano Absoluto) ou etérea (o Dano Absoluto a desfaz).
 *  - Duração > 0: cai ao fim das rodadas.
 *  - Duração 0 e Skill Ativa: dura até a Skill ser desligada; a física então fica com Vida 1.
 *  - Duração 0 e Skill normal: fica até o Mestre remover. A física sobrevive a quem conjurou; a
 *    etérea cai se a Vida ou a Mana dele chegar a 0. Movida a Mana cai sempre que a Mana zera.
 *  - Mesa sem mapa: a Skill só posta o cartão (ninguém tem onde pôr parede).
 *
 * A geometria (cortar a forma no tamanho máximo) é pura e testada: structure-geometry.js.
 */
import { currentSkillUseId } from "../skills/skill-use-context.js";
import {
  SYSTEM_ID,
  getStructures,
  getEnergyLabelForActor,
  actorToken,
  getActiveDamageElements,
  actorSealLevel,
  isInterferenceEnabled,
  actorManipulation,
  getHealingRules,
  getElementAffinityMatrix,
  getAffinityConfig,
  getActiveStatusConditions
} from "../core/config.js";
import { fieldUseOutcome } from "../core/magic-rules.js";
import { runAsGm, isDesignatedGm } from "../helpers/gm-relay.js";
import { refuse, relayFailureMessage } from "../helpers/gm-relay-rules.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { deleteKeyUpdate, wallSenseTypes } from "../helpers/foundry-compat.js";
import {
  structureSegments,
  capPolyline,
  pointsAlongPolyline,
  firstStructureOnPath,
  splitStructureHit,
  segmentCrossing,
  pointInSegments,
  segmentsCross,
  touchesSegments,
  structureMaterial,
  structureManaPowered,
  structureLetsPass,
  structureRegenStep,
  antimagicStructureOutcome,
  areaTouchesStructure
} from "./structure-geometry.js";
import { normalizeArea, tokenDocCenter } from "../combat/area-geometry.js";
import { pointReach, viaMarkFrom } from "../combat/range.js";
import { outOfRangeMessage } from "../combat/range-rules.js";
import { hitAffinityFactor } from "../combat/damage-rules.js";
import { lightSourceData } from "../combat/lights.js";
import { grantSkillUseXp, vitalBase } from "../skills/skill-xp.js";
import { skillLevelBonuses, effectiveSkillCost, isEnergyPoolEnabled } from "../core/config.js";
import { energyValuePath, currentEnergyValue } from "../skills/skill-state.js";
import { isShipLike } from "../starship/ship-damage.js";

/** A Skill que ergueu a Estrutura (uuid), pra XP por uso. Null em registros sem Skill. */
function structureSkillUuid(instance) {
  return instance?.sourceActorUuid && instance.skillId ? `${instance.sourceActorUuid}.Item.${instance.skillId}` : null;
}

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
  antimagic: "foi desfeita pela antimagia",
  broken: "se desfez com o golpe absoluto"
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
 *  - `reach` (range.js, alcance H4): cada ponto clicado tem de estar no alcance de quem lança ou no
 *    alcance de uma Marca (aí a colocação é "pela Marca": `viaMark` no resultado, o mais caro dos
 *    pontos); fora disso o clique é recusado com aviso.
 */
export async function pickStructurePlacement(structure, reach = null) {
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
  let worstVia = null;

  const draw = () => {
    graphics.clear();
    if (reach && reach.rangePx > 0) {
      graphics.lineStyle(2, color, 0.35).beginFill(color, 0.04).drawCircle(reach.anchor.x, reach.anchor.y, reach.rangePx).endFill();
      for (const m of reach.centers) graphics.lineStyle(2, 0xffd36b, 0.35).beginFill(0xffd36b, 0.04).drawCircle(m.point.x, m.point.y, reach.rangePx).endFill();
    }
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
    const done = () => finish({ sceneId: scene.id, shape, points: points.slice(0, MAX_POINTS), viaMark: viaMarkFrom(worstVia, reach) });

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
      // Alcance (H4): o ponto tem de estar ao alcance de quem lança ou de uma Marca.
      const reached = pointReach(reach, { x: p.x, y: p.y });
      if (!reached) {
        ui.notifications.warn(`${structure.label}: ${outOfRangeMessage(Math.hypot(p.x - reach.anchor.x, p.y - reach.anchor.y) / (reach.rangePx / reach.range), reach.range)}.`);
        return;
      }
      if (reached.via && (!worstVia || reached.via.factor > worstVia.factor)) worstVia = reached.via;
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
      content: `<p><strong>${escapeHtml(sourceActor.name)}</strong> usou <strong>${escapeHtml(label)}</strong> e ergueu <strong>${escapeHtml(structure.label)}</strong>.</p>`
    });
    return true;
  }
  // Com resposta: o jogador espera VER a Estrutura; sem Mestre online, ou recusada, ele é avisado
  // (antes ela simplesmente não aparecia).
  const outcome = await runAsGm("createStructure", {
    sceneId: placement.sceneId,
    shape: placement.shape,
    points: placement.points,
    structureId,
    sourceActorUuid: sourceActor.uuid,
    skillId,
    subSkillIndex,
    untilDeactivated: Boolean(untilDeactivated),
    power,
    label,
    // Desfazer uso (skill-undo.js): o Mestre acha esta Estrutura pelo id do uso.
    useId: currentSkillUseId()
  }, { reply: true });
  const failure = relayFailureMessage(outcome, `erguer ${structure.label}`);
  if (failure) {
    ui.notifications.warn(failure);
    // Timeout: o Mestre pode ter erguido mesmo assim (só demorou) — conta como erguida para não
    // tirar a XP de quem usou; recusa ou falta de Mestre não ergueram nada.
    return outcome.reason === "timeout";
  }
  // O card nasce aqui (e não no Mestre): é uma mensagem de quem usou, então o Desfazer uso guarda
  // o registro nela. Os botões do Mestre leem só o flag `structureCard`.
  if (outcome.value?.instanceId) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
      content: `<p><strong>${escapeHtml(sourceActor.name)}</strong> usou <strong>${escapeHtml(label)}</strong> e ergueu <strong>${escapeHtml(structure.label)}</strong>.</p>`,
      flags: { [SYSTEM_ID]: { structureCard: { sceneId: outcome.value.sceneId, instanceId: outcome.value.instanceId } } }
    });
  }
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
  if (!scene) return refuse("a cena não existe mais");
  if (!structure) return refuse("essa Estrutura não está mais no catálogo");
  if (!source) return refuse("quem usou a Skill não existe mais");

  const points = (Array.isArray(payload.points) ? payload.points : [])
    .slice(0, MAX_POINTS)
    .map(p => [Number(p?.[0]), Number(p?.[1])])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const segments = structureSegments(structure.shape, points, metersToPx(scene, structure.size));
  if (!segments.length) return refuse("a forma desenhada ficou sem tamanho");

  const S = wallSenseTypes();
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

  // Nível da Skill (ou Sub-Skill) lido na ficha de quem usou, nunca do payload.
  const skillItem = source.items?.get(String(payload.skillId ?? ""));
  const subIndex = Number.isInteger(payload.subSkillIndex) ? payload.subSkillIndex : null;
  const level = Math.max(0, Math.round(Number(subIndex !== null ? skillItem?.system?.subSkills?.[subIndex]?.level : skillItem?.system?.level) || 0));
  // Disposição de quem ergueu: define quem a barreira etérea deixa passar (aliados).
  const casterDisposition = actorToken(source)?.document?.disposition ?? source.prototypeToken?.disposition;

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
    manaBarrier: Boolean(structure.manaPowered),
    material: structure.material,
    level,
    disposition: Number.isFinite(Number(casterDisposition)) ? Number(casterDisposition) : null,
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
    tech: structure.tech,
    antimagicLevel: structure.antimagicLevel,
    interferenceLevel: structure.interferenceLevel,
    contactDamage: structure.contactDamage,
    sourceActorUuid: source.uuid,
    skillId: String(payload.skillId ?? ""),
    subSkillIndex: Number.isInteger(payload.subSkillIndex) ? payload.subSkillIndex : null,
    useId: String(payload.useId ?? "").slice(0, 32)
  };
  await scene.setFlag(SYSTEM_ID, `${FLAG}.${id}`, instance);
  // Nasceu dentro (ou encostada) de um campo antimagia: já vale na hora, também fora de combate.
  await enforceAntimagicOnStructures(scene, { charge: false });

  // O card sai do cliente de quem pediu (requestStructure), com esta referência.
  return { ok: true, value: { sceneId: scene.id, instanceId: id } };
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
    reportError(`Falha ao criar a luz da Estrutura ${structure.label}.`, err, { gmOnly: true });
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
 * nada no caminho. Física segura todo mundo (até quem a ergueu); etérea deixa passar quem a
 * ergueu e os aliados dele (mesma disposição do Token).
 * @returns {{scene: Scene, instance: object, capacity: number, point: {x: number, y: number}, attackerUuid: string|null}|null}
 */
export function interceptingStructure(attacker, target, { origin = null } = {}) {
  const scene = canvas?.scene;
  if (!canvas?.ready || !scene || !target) return null;
  const targetToken = tokenOnCanvas(target, [...(game.user?.targets ?? [])]);
  const from = origin ?? tokenOnCanvas(attacker, canvas.tokens?.controlled ?? [])?.center;
  if (!targetToken || !from) return null;
  const attackerDisposition = tokenOnCanvas(attacker, canvas.tokens?.controlled ?? [])?.document?.disposition ?? attacker?.prototypeToken?.disposition;
  const instances = structuresOnScene(scene).filter(i => {
    const info = instanceInfo(i);
    if (!info.blocksAttacks) return false;
    return !structureLetsPass({ material: info.material, isCaster: i.sourceActorUuid === attacker?.uuid, attackerDisposition, casterDisposition: i.disposition });
  });
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
  return { scene, instance, capacity: structureCapacity(instance), point, attackerUuid: attacker?.uuid ?? null };
}

/**
 * Golpe que bate numa Estrutura: ela segura até a capacidade e o resto segue pro alvo. O dano
 * na Estrutura é gravado na hora pelo Mestre (é o ambiente, como a cascata de uma Nave); o do
 * alvo continua nos botões de Aplicar do chat.
 * @returns {{absorbed: number, passed: number, label: string, point: {x: number, y: number}, broken?: boolean}}
 */
export async function hitStructure(block, amount, elementIds = [], protectedActor = null, { absolute = false } = {}) {
  // Dano Absoluto desfaz a Estrutura etérea e passa INTEIRO; a física segura como qualquer golpe.
  if (absolute && instanceInfo(block.instance).material === "ethereal") {
    await runAsGm("damageStructure", { sceneId: block.scene.id, instanceId: block.instance.id, amount: 0, broken: true, attackerUuid: block.attackerUuid });
    return { absorbed: 0, passed: amount, label: block.instance.label, point: block.point, broken: true };
  }
  // Vantagem entre elementos: Fogo contra Parede de Gelo bate mais forte NELA (o que passa volta à escala do golpe).
  const factor = hitAffinityFactor(elementIds, instanceInfo(block.instance).elements, getElementAffinityMatrix(), getAffinityConfig());
  const { absorbed, passed } = splitStructureHit(amount * factor, block.capacity);
  if (absorbed > 0) {
    await runAsGm("damageStructure", { sceneId: block.scene.id, instanceId: block.instance.id, amount: absorbed, attackerUuid: block.attackerUuid });
    // XP por uso da Skill que ergueu: só a Barreira MANTIDA (Skill Ativa ou Barreira de Mana, que
    // o conjurador paga a cada golpe) ganha pelo que segura — uma parte do dano sobre a Vida de
    // quem ela protegeu. A erguida uma vez ganhou o fixo ao subir.
    const skillUuid = structureSkillUuid(block.instance);
    const maintained = block.instance.untilDeactivated || block.instance.manaBarrier;
    if (skillUuid && protectedActor && maintained) await grantSkillUseXp(skillUuid, [{ value: absorbed, base: vitalBase(protectedActor), block: true }]);
  }
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
    tech: Boolean(pick("tech", false)),
    antimagicLevel: Number(pick("antimagicLevel", 0)) || 0,
    interferenceLevel: Number(pick("interferenceLevel", 0)) || 0,
    contactDamage: pick("contactDamage", "") ?? "",
    // Registro antigo sem material: Vida 0 = etérea.
    material: instance?.material ?? structureMaterial(undefined, instance?.manaBarrier ? 0 : instance?.hpMax),
    manaPowered: Boolean(instance?.manaBarrier),
    closed: instance?.shape === "circle" || instance?.shape === "rect"
  };
}

/* ------------------------------------------------------------------ Antimagia e Interferência */

/**
 * As duas "antimagias": a mágica (Campo/Selo Antimagia, `antimagicLevel`) e a tecnológica
 * (Campo/Selo de Interferência, `interferenceLevel`, o PEM). Cada uma só toca o que tem a natureza
 * dela (`magic`/`tech`); tecnomágico sofre as duas. Campos de um tipo nunca afetam campos.
 */
export const FIELD_KINDS = {
  magic: { levelKey: "antimagicLevel", natureKey: "magic", label: "antimagia" },
  tech: { levelKey: "interferenceLevel", natureKey: "tech", label: "interferência" }
};

/** Os tipos de campo ligados nesta mesa (o tecnológico depende do bloco PEM). */
function activeFieldKinds() {
  return isInterferenceEnabled() ? ["magic", "tech"] : ["magic"];
}

/** Uma Estrutura é um campo (de qualquer tipo)? Campos não sofrem campos. */
function isAnyField(info) {
  return info.antimagicLevel > 0 || info.interferenceLevel > 0;
}

/** Campos do tipo `kind` da Cena, com os segmentos. */
function antimagicFields(scene, kind = "magic") {
  const key = FIELD_KINDS[kind].levelKey;
  return structuresOnScene(scene)
    .map(instance => ({ instance, info: instanceInfo(instance), segments: structureSegmentsOf(scene, instance) }))
    .filter(f => f.info[key] > 0 && f.segments.length);
}

/** Nível do campo neste ponto (dentro de uma forma fechada). */
function fieldLevelAt(fields, point, kind = "magic") {
  const key = FIELD_KINDS[kind].levelKey;
  return fields.reduce((level, f) => (f.info.closed && pointInSegments(point, f.segments) ? Math.max(level, f.info[key]) : level), 0);
}

/**
 * Os Selos que `actor` carrega (Condição com antimagia/interferência), com a Skill que aplicou cada
 * um (`effect.origin`) — pra XP por uso de quem selou.
 */
function sealSources(actor, kind = "magic") {
  const field = FIELD_KINDS[kind].levelKey;
  const sealed = getActiveStatusConditions().filter(c => Number(c[field]) > 0);
  if (!sealed.length || !actor?.effects) return [];
  const out = [];
  for (const effect of actor.effects) {
    if (effect.disabled) continue;
    for (const status of effect.statuses ?? []) {
      const condition = sealed.find(c => c.id === status);
      if (condition) out.push({ level: Number(condition[field]) || 0, skillUuid: effect.origin ?? null });
    }
  }
  return out;
}

/**
 * Antimagia (ou Interferência, `kind: "tech"`) num ataque de `attacker` em `target`: o Selo que o
 * atacante carrega, e os campos que a linha do ataque atravessa, de onde ele sai ou onde o alvo
 * está. Sem mapa, só o Selo. Devolve o nível e as Skills responsáveis por ele (as fontes no nível
 * máximo), pra XP por uso.
 * @returns {{level: number, sources: string[]}}
 */
export function antimagicBetween(attacker, target, { origin = null, kind = "magic" } = {}) {
  const key = FIELD_KINDS[kind].levelKey;
  const hits = [...sealSources(attacker, kind), { level: actorSealLevel(attacker, kind), skillUuid: null }];
  const scene = canvas?.scene;
  const fields = canvas?.ready && scene ? antimagicFields(scene, kind) : [];
  if (fields.length) {
    const from = origin ?? actorToken(attacker, canvas.tokens?.controlled ?? [])?.center;
    // O "alvo" pode ser um ponto do mapa ({point}): onde uma Estrutura ou Zona vai nascer.
    const to = target?.point ?? (target ? actorToken(target, [...(game.user?.targets ?? [])])?.center : null);
    for (const f of fields) {
      const inside = p => f.info.closed && pointInSegments([p.x, p.y], f.segments);
      const crosses = from && to && f.segments.some(seg => segmentCrossing([from.x, from.y], [to.x, to.y], seg) !== null);
      if ((from && inside(from)) || (to && inside(to)) || crosses) hits.push({ level: f.info[key], skillUuid: structureSkillUuid(f.instance) });
    }
  }
  const level = Math.max(0, ...hits.map(h => h.level));
  return { level, sources: [...new Set(hits.filter(h => level > 0 && h.level === level && h.skillUuid).map(h => h.skillUuid))] };
}

/** Só o nível de `antimagicBetween`. */
export function antimagicLevelBetween(attacker, target, { origin = null, kind = "magic" } = {}) {
  return antimagicBetween(attacker, target, { origin, kind }).level;
}

/** Nível de antimagia/interferência onde o Ator está (Selo + campo em volta do Token) — pra efeito contínuo. */
export function antimagicLevelAt(actor, kind = "magic") {
  const level = actorSealLevel(actor, kind);
  const scene = canvas?.scene;
  if (!canvas?.ready || !scene) return level;
  const token = actorToken(actor, []);
  if (!token) return level;
  return Math.max(level, fieldLevelAt(antimagicFields(scene, kind), [token.center.x, token.center.y], kind));
}

/** Campo em volta do Token (só por documentos, sem canvas): nível e Skills responsáveis. */
export function antimagicFieldLevelAtToken(tokenDoc, position = null, kind = "magic") {
  const scene = tokenDoc?.parent;
  if (!scene) return { level: 0, sources: [] };
  const key = FIELD_KINDS[kind].levelKey;
  // No gancho `moveToken` (V14) o documento ainda está na posição de ANTES; quem chama passa o destino.
  const at = position && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.y))
    ? { x: Number(position.x), y: Number(position.y), width: tokenDoc.width, height: tokenDoc.height }
    : tokenDoc;
  const center = tokenDocCenter(at, scene.grid?.size);
  const inside = antimagicFields(scene, kind).filter(f => f.info.closed && pointInSegments([center.x, center.y], f.segments));
  const level = Math.max(0, ...inside.map(f => f.info[key]));
  return { level, sources: [...new Set(inside.filter(f => f.info[key] === level).map(f => structureSkillUuid(f.instance)).filter(Boolean))] };
}

/** Natureza `{magic, tech}` de uma Estrutura que segura ataques (campos e muralhas de fogo não contam). */
function protectiveNature(info) {
  return { magic: info.magic, tech: info.tech };
}

/**
 * Estruturas que PROTEGEM o Token de um efeito do tipo oposto (ver protectedFromKind): as fechadas
 * que o envolvem. Só documentos, sem canvas (serve ao campo, que roda no movimento).
 * @returns {{magic:boolean, tech:boolean}[]}
 */
export function enclosingStructureKinds(tokenDoc, position = null) {
  const scene = tokenDoc?.parent;
  if (!scene) return [];
  const at = position && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.y))
    ? { x: Number(position.x), y: Number(position.y), width: tokenDoc.width, height: tokenDoc.height }
    : tokenDoc;
  const center = tokenDocCenter(at, scene.grid?.size);
  return structuresOnScene(scene)
    .map(instance => ({ info: instanceInfo(instance), segments: structureSegmentsOf(scene, instance) }))
    .filter(f => !isAnyField(f.info) && f.info.blocksAttacks && f.info.closed && f.segments.length && pointInSegments([center.x, center.y], f.segments))
    .map(f => protectiveNature(f.info));
}

/**
 * Estruturas que protegem `target` de um efeito de `attacker` (Antimagia/PEM em alvo único ou em
 * área): as que a linha do efeito atravessa e as fechadas que envolvem o alvo. Uma Estrutura de
 * quem usa não o protege de si mesmo. Sem mapa, nada. Quem decide se protege é protectedFromKind.
 * @returns {{magic:boolean, tech:boolean}[]}
 */
export function protectingStructureKinds(attacker, target, { origin = null } = {}) {
  const scene = canvas?.scene;
  if (!canvas?.ready || !scene || !target) return [];
  const from = origin ?? actorToken(attacker, canvas.tokens?.controlled ?? [])?.center;
  const to = actorToken(target, [...(game.user?.targets ?? [])])?.center;
  if (!to) return [];
  const out = [];
  for (const instance of structuresOnScene(scene)) {
    const info = instanceInfo(instance);
    if (isAnyField(info) || !info.blocksAttacks) continue;
    if (attacker?.uuid && instance.sourceActorUuid === attacker.uuid) continue;
    const segments = structureSegmentsOf(scene, instance);
    if (!segments.length) continue;
    const crosses = from && segments.some(seg => segmentCrossing([from.x, from.y], [to.x, to.y], seg) !== null);
    const encloses = info.closed && pointInSegments([to.x, to.y], segments);
    if (crosses || encloses) out.push(protectiveNature(info));
  }
  return out;
}

/**
 * Resultado do campo do tipo `kind` numa Estrutura. A mágica mantém a regra de sempre (movida a
 * Mana e Skill que a segura contam como mágicas); a tecnológica só pega o que está marcado
 * Tecnológico (e a Skill que o segura, se for essa a que ergueu).
 */
function fieldOutcome(kind, { nature, material, sustained, manaPowered, level, reach }) {
  return antimagicStructureOutcome(kind === "tech"
    ? { magic: nature, material, sustained: sustained && nature, manaPowered: false, level, reach }
    : { magic: nature, material, sustained, manaPowered, level, reach });
}

/**
 * Uma Estrutura mágica/tecnológica (ou mantida por Skill) que `mech` ergueria em `placement` seria
 * desfeita NA HORA por um campo que ela toca (nível do campo ≥ nível da Skill)? Devolve a
 * Estrutura do catálogo se sim, senão null — pra recusar antes de gastar Mana. Campo não conta.
 */
export function structureEndedAtOnce(mech, placement) {
  const structure = getStructure(mech?.structureId);
  const scene = game.scenes.get(placement?.sceneId);
  if (!structure || !scene || structure.antimagicLevel > 0 || structure.interferenceLevel > 0) return null;
  const points = (placement.points ?? []).map(p => [Number(p?.[0]), Number(p?.[1])]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const segments = structureSegments(structure.shape, points, metersToPx(scene, structure.size));
  if (!segments.length) return null;
  for (const kind of activeFieldKinds()) {
    const { levelKey, natureKey } = FIELD_KINDS[kind];
    const touching = antimagicFields(scene, kind).filter(f => segmentsCross(segments, f.segments) || (f.info.closed && segments.some(([x, y]) => pointInSegments([x, y], f.segments))));
    const reach = Math.max(0, ...touching.map(f => f.info[levelKey]));
    if (!reach) continue;
    const outcome = fieldOutcome(kind, {
      nature: Boolean(structure[natureKey]),
      material: structureMaterial(structure.material, structure.hp),
      manaPowered: structureManaPowered(structure.manaPowered, structure.hp, structure.blocksAttacks),
      sustained: Boolean(mech.hasUpkeep) && !(structure.durationRounds > 0),
      level: mech.level,
      reach
    });
    if (outcome !== "keep") return structure;
  }
  return null;
}

/** Tira o sustento da Estrutura: fica de pé com Vida 1, solta da Skill (dura até cair ou o Mestre tirar). */
export async function unsupportStructure(scene, instance) {
  await scene.update({
    [`flags.${SYSTEM_ID}.${FLAG}.${instance.id}.hp`]: 1,
    [`flags.${SYSTEM_ID}.${FLAG}.${instance.id}.untilDeactivated`]: false
  });
  refreshStructureCards(scene.id, instance.id);
}

/**
 * Aplica a Antimagia (alcance `reach`) a uma Estrutura: some, perde o sustento ou fica. Campo
 * antimagia nunca é afetado. Só o Mestre.
 * @returns {Promise<{outcome: "remove"|"unsupport"|"keep", line: string|null}>}
 */
async function endStructureByAntimagic(scene, instance, reach, kind = "magic") {
  const info = instanceInfo(instance);
  if (isAnyField(info)) return { outcome: "keep", line: null };
  const outcome = fieldOutcome(kind, {
    nature: Boolean(info[FIELD_KINDS[kind].natureKey]),
    material: info.material,
    manaPowered: info.manaPowered,
    sustained: Boolean(instance.untilDeactivated),
    level: instance.level,
    reach
  });
  if (outcome === "remove") {
    await removeStructureInstance(scene, instance.id, "antimagic");
    return { outcome, line: `${instance.label}: desfeita` };
  }
  if (outcome === "unsupport") {
    // Já sem sustento e com Vida 1 (de uma rodada anterior): nada a fazer.
    if ((instance.hp ?? 0) <= 1 && !instance.untilDeactivated) return { outcome, line: null };
    await unsupportStructure(scene, instance);
    return { outcome, line: `${instance.label}: sem sustento (Vida 1)` };
  }
  return { outcome, line: null };
}

/**
 * Estruturas mágicas/tecnológicas ou mantidas por Skill dentro (ou cruzando) de um campo
 * (antimagia e, com o bloco PEM, interferência): se o nível delas não passa do nível do campo,
 * acabam (etérea some; física perde o sustento). Acima do nível do campo, ficam — e quem
 * conjurou paga o custo extra por rodada, da energia (`charge`; sem energia, o campo vence e ela
 * some). Campos não afetam campos. Roda a cada rodada e logo que uma Estrutura nasce
 * (`charge: false`: a cobrança é só na virada da rodada). Só o Mestre.
 */
export async function enforceAntimagicOnStructures(scene, { charge = true } = {}) {
  for (const kind of activeFieldKinds()) await enforceFieldsOnStructures(scene, kind, { charge });
}

async function enforceFieldsOnStructures(scene, kind, { charge = true } = {}) {
  const fields = antimagicFields(scene, kind);
  if (!fields.length) return;
  const { levelKey, natureKey, label } = FIELD_KINDS[kind];
  const lines = [];
  const creditFields = async (touching, level) => {
    // XP por uso: o campo (ou campos) no nível que venceu desfez uma Estrutura.
    for (const f of touching.filter(t => t.info[levelKey] === level)) {
      const skillUuid = structureSkillUuid(f.instance);
      if (skillUuid) await grantSkillUseXp(skillUuid, [{ flat: true }]);
    }
  };
  for (const instance of structuresOnScene(scene)) {
    const info = instanceInfo(instance);
    if (isAnyField(info)) continue;
    const segments = structureSegmentsOf(scene, instance);
    const touching = fields.filter(f => segmentsCross(segments, f.segments) || (f.info.closed && segments.some(([x, y]) => pointInSegments([x, y], f.segments))));
    const level = Math.max(0, ...touching.map(f => f.info[levelKey]));
    if (!level) continue;

    const { outcome, line } = await endStructureByAntimagic(scene, instance, level, kind);
    if (outcome !== "keep") {
      if (!line) continue;
      lines.push(line);
      await creditFields(touching, level);
      continue;
    }
    if (!charge || !info[natureKey]) continue;
    const caster = await fromUuid(instance.sourceActorUuid);
    if (!caster) continue;
    // Manipulação de quem ergueu (só contra a Antimagia): a curva do bloqueio de cura decide se o campo
    // vence (a Estrutura some), se ela fica pagando um extra por rodada, ou se fica de graça. O custo-base
    // é o por rodada da Skill que a sustenta (0 se for uma Estrutura solta: então o extra é 0).
    const manipulation = kind === "magic" ? actorManipulation(caster) : { skill: null, level: 0 };
    const skillDoc = structureSkillUuid(instance) ? await fromUuid(structureSkillUuid(instance)).catch(() => null) : null;
    const mech = Number.isInteger(instance.subSkillIndex) ? skillDoc?.system?.subSkills?.[instance.subSkillIndex] : skillDoc?.system;
    const baseCost = mech?.hasUpkeep ? effectiveSkillCost(mech.upkeepCost, mech.level) : 0;
    const result = fieldUseOutcome({ inside: true, kind, manipulationLevel: manipulation.level, fieldLevel: level, baseCost, zeroMultiplier: getHealingRules().zeroMultiplier });
    const current = currentEnergyValue(caster);
    if (result.action !== "blocked" && current >= result.extra) {
      if (result.resisted) await grantSkillUseXp(manipulation.skill, [{ flat: true }]);
      if (result.extra > 0) {
        await caster.update({ [energyValuePath(caster)]: current - result.extra });
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: caster }),
          // Mestre e quem joga com o conjurador (é a energia dele que está indo embora).
          whisper: [...new Set([...ChatMessage.getWhisperRecipients("GM"), ...game.users.filter(u => !u.isGM && caster.testUserPermission(u, "OWNER"))].map(u => u.id))],
          content: `<p><strong>${escapeHtml(instance.label)}</strong> resiste à ${label} (nível ${level}) pela Manipulação: −${result.extra} ${escapeHtml(getEnergyLabelForActor(caster))} de ${escapeHtml(caster.name)}.</p>`
        });
      }
    } else {
      await removeStructureInstance(scene, instance.id, "antimagic");
      lines.push(`${instance.label}: desfeita`);
      await creditFields(touching, level);
    }
  }
  if (lines.length) {
    await ChatMessage.create({ content: `<p><strong>Campo de ${label}</strong>:</p><ul>${lines.map(l => `<li>${escapeHtml(l)}</li>`).join("")}</ul>` });
  }
}

/**
 * Lado do Mestre do pedido `antimagicStructures`: uma Skill de Antimagia usada em Emissão desfaz as
 * Estruturas que a área toca. Nada vem confiável do cliente: o alcance sai do nível da Skill na
 * ficha, e a área precisa caber no que a Skill permite.
 * @param {object} payload - {sceneId, area, subSkillIndex}
 * @param {Item} skill - a Skill (já conferida como de quem pediu)
 */
export async function antimagicStructuresAsGm(payload, skill) {
  const scene = game.scenes.get(payload?.sceneId);
  const area = normalizeArea(payload?.area);
  if (!scene || !area || skill?.type !== "skill") return refuse("o pedido chegou incompleto ou inválido");
  const index = Number.isInteger(payload.subSkillIndex) ? payload.subSkillIndex : null;
  const mech = index !== null ? skill.system.subSkills?.[index] : skill.system;
  const kinds = [];
  if ((mech?.effects ?? []).some(e => e.target === "antimagic")) kinds.push("magic");
  if (isInterferenceEnabled() && (mech?.effects ?? []).some(e => e.target === "emp")) kinds.push("tech");
  if (!mech || mech.targetType !== "emission" || !kinds.length) return refuse("isso não é uma Antimagia ou um PEM em área");
  const pxPerUnit = (Number(scene.grid?.size) || 100) / (Number(scene.grid?.distance) || 1);
  if (area.shape !== mech.areaShape || area.radius > (Number(mech.areaDistance) || 0) * pxPerUnit * 1.05 + 1) return refuse("a área não é a da Skill");
  const { antimagicReachLevel } = await import("../skills/dispel.js");
  const reach = antimagicReachLevel(mech.level);
  const lines = [];
  for (const instance of structuresOnScene(scene)) {
    if (!areaTouchesStructure(area, structureSegmentsOf(scene, instance), instanceInfo(instance).closed)) continue;
    for (const kind of kinds) {
      const { line } = await endStructureByAntimagic(scene, instance, reach, kind);
      if (line) lines.push(line);
    }
  }
  return { ok: true, value: { lines } };
}

/**
 * Lado de quem usa: pede ao Mestre para a Antimagia desfazer as Estruturas na área. Devolve as
 * linhas pro chat ([] se nada aconteceu); o XP (um fixo por linha) fica com quem chama.
 */
export async function dispelStructuresInArea(skill, subSkillIndex, area) {
  if (!canvas?.scene || !area) return [];
  const outcome = await runAsGm(
    "antimagicStructures",
    { sceneId: canvas.scene.id, area, skillUuid: skill.uuid, subSkillIndex: subSkillIndex ?? null },
    { reply: true, timeout: 15000 }
  );
  const failure = relayFailureMessage(outcome, "desfazer Estruturas com a Antimagia");
  if (failure) {
    ui.notifications?.warn(failure);
    return [];
  }
  return Array.isArray(outcome.value?.lines) ? outcome.value.lines.map(String) : [];
}

/* ------------------------------------------------------------------ Dano ao contato */

/** Estruturas da cena que queimam por contato. */
function burningStructures(scene) {
  return structuresOnScene(scene).filter(i => instanceInfo(i).contactDamage);
}

/**
 * O corpo do Token (centro em `center`, em pixels) está encostando na Estrutura ou dentro dela
 * (forma fechada)? Encostar = a distância do centro à parede é no máximo meia largura do Token,
 * com uma folga de 5% do quadrado.
 */
function tokenTouchesStructure(scene, tokenDocument, center, instance, info) {
  const size = scene.grid?.size ?? 100;
  const segments = structureSegmentsOf(scene, instance);
  if (info.closed && pointInSegments(center, segments)) return true;
  return touchesSegments(center, (Number(tokenDocument.width) || 1) * size / 2, segments, size * 0.05);
}

/**
 * Token atravessou, terminou dentro de ou terminou ENCOSTADO numa Estrutura com dano de contato
 * (Muralha de Fogo): rola o dano dela contra quem passou. Uma vez por Estrutura por movimento.
 * Só o Mestre designado, no `moveToken`.
 */
export function registerStructureContact() {
  Hooks.on("moveToken", async (document, movement) => {
    if (!isDesignatedGm()) return;
    const scene = document.parent;
    const burning = burningStructures(scene);
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
    const { applyStructureContactAsGm } = await import("./structure-contact.js");
    for (const instance of burning) {
      const info = instanceInfo(instance);
      const crossed = segmentsCross(pathSegments, structureSegmentsOf(scene, instance));
      if (crossed || tokenTouchesStructure(scene, document, end, instance, info)) await applyStructureContactAsGm(document, instance, info);
    }
  });
}

/**
 * Início do turno de quem continua encostado (ou dentro) de uma Estrutura que queima: queima de
 * novo. Só o Mestre designado.
 */
export async function tickStructureContact(combatant) {
  if (!isDesignatedGm()) return;
  const tokenDocument = combatant?.token;
  const scene = tokenDocument?.parent;
  if (!tokenDocument?.actor || !scene) return;
  const burning = burningStructures(scene);
  if (!burning.length) return;
  const size = scene.grid?.size ?? 100;
  const center = [Number(tokenDocument.x) + ((tokenDocument.width ?? 1) * size) / 2, Number(tokenDocument.y) + ((tokenDocument.height ?? 1) * size) / 2];
  const { applyStructureContactAsGm } = await import("./structure-contact.js");
  for (const instance of burning) {
    const info = instanceInfo(instance);
    if (tokenTouchesStructure(scene, tokenDocument, center, instance, info)) await applyStructureContactAsGm(tokenDocument, instance, info);
  }
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
    ...deleteKeyUpdate(`flags.${SYSTEM_ID}.${FLAG}.${instanceId}`),
    [`flags.${SYSTEM_ID}.${FALLS_FLAG}.${instanceId}`]: { reason, label: instance.label, time: now }
  };
  for (const [id, fall] of Object.entries(scene.getFlag(SYSTEM_ID, FALLS_FLAG) ?? {})) {
    if (!fall || now - (fall.time ?? 0) > FALL_MEMORY_MS) Object.assign(update, deleteKeyUpdate(`flags.${SYSTEM_ID}.${FALLS_FLAG}.${id}`));
  }
  await scene.update(update);
  refreshStructureCards(scene.id, instanceId);
  // Caiu um campo antimagia: quem estava suprimido por ele e já não está em campo nenhum se solta.
  if (isAnyField(instanceInfo(instance))) {
    const { endMagicInsideFields } = await import("../combat/antimagic.js");
    for (const token of scene.tokens) await endMagicInsideFields(token);
  }
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
export async function damageStructure(scene, instanceId, amount, { broken = false } = {}) {
  const instance = scene?.getFlag(SYSTEM_ID, FLAG)?.[instanceId];
  const value = Math.max(0, Math.round(Number(amount) || 0));
  if (!instance) return;
  // Dano Absoluto contra a etérea: ela se desfaz (só vale se for mesmo etérea).
  if (broken) {
    if (instanceInfo(instance).material === "ethereal") await removeStructureInstance(scene, instanceId, "broken");
    return;
  }
  if (!value) return;

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
        // A física que a Skill sustentava fica de pé com Vida 1, solta da Skill (dura até cair ou o
        // Mestre tirar); a etérea e a movida a Mana somem. Quem já era solta (prazo, ou de um uso
        // anterior) não é tocada.
        const info = instanceInfo(instance);
        if (info.material === "physical" && !instance.manaBarrier) {
          if (!instance.untilDeactivated) continue;
          await unsupportStructure(scene, instance);
        } else {
          await removeStructureInstance(scene, instance.id, "dismissed");
        }
      }
    }
  }
}

/**
 * Vida ou Mana de quem conjurou chegou a 0: caem as Estruturas etéreas sem prazo que não dependem
 * de Skill Ativa (as físicas ficam), e toda barreira de mana dele quando é a Mana que zerou.
 */
export async function collapseStructuresOfCaster(actor, { hpZero, energyZero }) {
  if (!isDesignatedGm()) return;
  for (const scene of game.scenes) {
    for (const instance of structuresOnScene(scene)) {
      if (instance.sourceActorUuid !== actor.uuid) continue;
      const untimed = (instance.roundsRemaining === null || instance.roundsRemaining === undefined) && !instance.untilDeactivated;
      // Pedra de verdade (física, não movida a Mana) sobrevive a quem a ergueu.
      const solid = instanceInfo(instance).material === "physical" && !instance.manaBarrier;
      if ((untimed && !solid && (hpZero || energyZero)) || (instance.manaBarrier && energyZero)) {
        await removeStructureInstance(scene, instance.id, energyZero ? "manaDepleted" : "casterDown");
      }
    }
  }
}

/**
 * Início do turno de quem mantém uma Skill Ativa de Estrutura (depois da manutenção): a Estrutura
 * ferida, ainda presa à Skill ligada e com Vida própria, paga o custo (com o desconto do nível e a
 * Mana investida) e recupera Vida, sem passar do teto. Cheia não paga; sem Mana não regenera.
 * Não dá XP. Só o Mestre designado.
 * @returns {Promise<string[]>} linhas pro chat
 */
export async function regenerateSustainedStructures(holder) {
  if (!holder || !isDesignatedGm()) return [];
  const rows = [];
  for (const scene of game.scenes) {
    for (const instance of structuresOnScene(scene)) {
      if (instance.sourceActorUuid !== holder.uuid || !instance.untilDeactivated || instance.manaBarrier) continue;
      if (!((instance.hp ?? 0) < (instance.hpMax ?? 0))) continue;
      const skill = holder.items.get(instance.skillId);
      const sub = instance.subSkillIndex ?? null;
      const mech = sub !== null ? skill?.system?.subSkills?.[sub] : skill?.system;
      if (!mech?.active || !(Number(mech.structureRegen) > 0)) continue;
      const level = mech.level ?? 1;
      const ratio = (mech.variableMana ? mech.investRatio ?? 1 : 1) * (mech.markFactor ?? 1);
      const cost = isEnergyPoolEnabled() || isShipLike(holder) ? Math.ceil(effectiveSkillCost(Number(mech.structureRegenCost) || 0, level) * ratio) : 0;
      const step = structureRegenStep({
        hp: instance.hp,
        hpMax: instance.hpMax,
        regen: Math.round(Number(mech.structureRegen) * skillLevelBonuses(level).power),
        cost,
        energy: currentEnergyValue(holder)
      });
      if (step.hp === instance.hp) continue;
      if (step.paid > 0) await holder.update({ [energyValuePath(holder)]: currentEnergyValue(holder) - step.paid });
      await scene.setFlag(SYSTEM_ID, `${FLAG}.${instance.id}.hp`, step.hp);
      refreshStructureCards(scene.id, instance.id);
      rows.push(`${escapeHtml(instance.label)}: Vida +${step.hp - instance.hp} (${step.hp}/${instance.hpMax})${step.paid ? `, −${step.paid} ${escapeHtml(getEnergyLabelForActor(holder))}` : ""}`);
    }
  }
  if (rows.length) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: holder }),
      content: `<p><strong>${escapeHtml(holder.name)}</strong> — Estruturas mantidas regeneram:</p><ul>${rows.map(r => `<li>${r}</li>`).join("")}</ul>`
    });
  }
  return rows;
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
    box.innerHTML = `<span class="structure-state">${fall ? `${escapeHtml(fall.label ?? "A Estrutura")} ${FALL_TEXT[fall.reason] ?? FALL_TEXT.dismissed}.` : "Estrutura derrubada."}</span>`;
    html.appendChild(box);
    return;
  }

  let state;
  if (instance.manaBarrier) {
    const caster = fromUuidSync(instance.sourceActorUuid);
    const energy = caster?.system?.attributes?.energy;
    state = `Barreira de mana — dano sai da ${escapeHtml(caster ? getEnergyLabelForActor(caster) : "Mana")} de ${escapeHtml(caster?.name ?? "?")} (${energy?.value ?? 0}/${energy?.max ?? 0})`;
  } else {
    state = `Vida ${instance.hp}/${instance.hpMax}`;
  }
  if (instance.roundsRemaining) state += ` · ${instance.roundsRemaining} rodada(s)`;
  else if (instance.untilDeactivated) state += " · até desligar a Skill";
  state += instanceInfo(instance).material === "ethereal" ? " · etérea" : " · física";

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
