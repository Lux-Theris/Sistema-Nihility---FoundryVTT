/**
 * Visual das Estruturas no mapa, desenhado por cada cliente a partir do registro da Cena
 * (flag `structures`, ver structures.js). Parede do Foundry é invisível pra jogador, então sem
 * isto a Estrutura existia (bloqueava) mas ninguém via onde.
 *
 * Por que não um Desenho (Drawing): a primeira versão criava um Desenho junto das Paredes, e a
 * criação dele falhava em mundo real — o erro interrompia tudo o que vinha depois (registro na
 * Cena, cartão), deixando Paredes órfãs que nem desligar a Skill removia. Além disso um Desenho é
 * documento: o Mestre podia arrastá-lo ou apagá-lo sem querer na camada de Desenhos, e ele não
 * acompanhava a Vida. Aqui não há documento nenhum: o visual nasce e morre com o registro.
 *
 * O que aparece: faixa grossa seguindo as Paredes (cor do catálogo; textura da imagem, se houver),
 * preenchimento nas formas fechadas, nome e barra de Vida (números só pro Mestre). A faixa fica
 * mais transparente conforme perde Vida; barreira de mana pulsa.
 *
 * **Queda com animação:** quando uma Estrutura sai do registro, as Paredes e a luz já sumiram (o
 * estado de jogo não espera), mas o desenho dela faz uma animação curta em todas as telas, a
 * partir da última forma que cada cliente conhecia. O motivo da queda vem do flag
 * `structureFalls` que `removeStructureInstance` grava junto: destruída racha e estilhaça,
 * barreira sem Mana pisca e se desfaz, o resto dissolve devagar.
 */
import { SYSTEM_ID, getStructures } from "./config.js";
import { structuresOnScene, removeOrphanStructureWalls, structureSegmentsOf, structureFallOf } from "./structures.js";

let container = null;
let fallLayer = null;
let pulse = null;
let drawToken = 0;
/** Última versão de cada Estrutura desenhada nesta Cena — é dela que sai a animação de queda. */
let lastInstances = new Map();
const textureCache = new Map();

/** Liga os hooks. Chamado no `init`. */
export function registerStructureRendering() {
  Hooks.on("canvasReady", () => {
    lastInstances = new Map();
    drawStructures();
    removeOrphanStructureWalls(canvas.scene);
  });
  Hooks.on("canvasTearDown", () => {
    clearStructures();
    clearFalls();
    lastInstances = new Map();
  });
  Hooks.on("updateScene", (scene, changes) => {
    if (scene.id !== canvas?.scene?.id) return;
    if (foundry.utils.hasProperty(changes, `flags.${SYSTEM_ID}`)) drawStructures();
  });
  // A barra de uma barreira de mana é a Mana de quem conjurou.
  Hooks.on("updateActor", (actor, changes) => {
    if (!foundry.utils.hasProperty(changes, "system.attributes.energy")) return;
    if (structuresOnScene(canvas?.scene).some(i => i.manaBarrier && i.sourceActorUuid === actor.uuid)) drawStructures();
  });
}

function clearStructures() {
  if (pulse) canvas?.app?.ticker?.remove(pulse);
  pulse = null;
  if (container && !container.destroyed) container.destroy({ children: true });
  container = null;
}

function clearFalls() {
  if (fallLayer && !fallLayer.destroyed) fallLayer.destroy({ children: true });
  fallLayer = null;
}

async function loadTextureSafe(path) {
  if (!path) return null;
  if (textureCache.has(path)) return textureCache.get(path);
  let texture = null;
  try {
    const load = foundry.canvas?.loadTexture ?? globalThis.loadTexture;
    texture = (await load?.(path)) ?? null;
  } catch (err) {
    texture = null;
  }
  textureCache.set(path, texture);
  return texture;
}

function colorNumber(value, fallback = 0x9aa1c2) {
  try {
    const color = foundry.utils.Color?.from?.(value);
    const n = Number(color);
    return Number.isFinite(n) ? n : fallback;
  } catch (err) {
    return fallback;
  }
}

/** Redesenha tudo da Cena atual (poucas Estruturas por cena — refazer é mais simples que diferenciar). */
export async function drawStructures() {
  const token = ++drawToken;
  const scene = canvas?.scene;
  if (!canvas?.ready || !scene || !canvas.interface) return;
  const instances = structuresOnScene(scene);

  // Texturas antes de apagar o desenho atual, pra não piscar vazio enquanto carregam.
  const catalog = new Map(getStructures().map(s => [s.id, s]));
  for (const instance of instances) {
    const img = instance.img ?? catalog.get(instance.structureId)?.img;
    if (img) await loadTextureSafe(img);
  }
  if (token !== drawToken) return; // outro redesenho começou enquanto carregava

  // Quem sumiu do registro desde o último desenho: anima a queda a partir da forma conhecida.
  const current = new Set(instances.map(i => i.id));
  for (const [id, previous] of lastInstances) {
    if (!current.has(id)) playFall(scene, previous, structureFallOf(scene, id)?.reason ?? "dismissed", catalog);
  }
  lastInstances = new Map(
    instances.map(i => [i.id, { ...foundry.utils.deepClone(i), segments: structureSegmentsOf(scene, i) }])
  );

  clearStructures();
  if (!instances.length) return;
  container = new PIXI.Container();
  container.eventMode = "none";
  canvas.interface.addChildAt(container, 0);

  const barriers = [];
  for (const instance of instances) {
    const group = buildStructureGroup(scene, instance, catalog);
    if (!group) continue;
    container.addChild(group);
    if (instance.manaBarrier) barriers.push(group);
  }

  // Barreira de mana pulsa (só alpha — barato, e some junto com o container).
  if (barriers.length) {
    let t = 0;
    pulse = ticker => {
      t += (ticker?.deltaTime ?? ticker ?? 1) * 0.05;
      const a = 0.75 + 0.25 * Math.sin(t);
      for (const g of barriers) if (!g.destroyed) g.alpha = a;
    };
    canvas.app.ticker.add(pulse);
  }
}

/** Desenho de uma Estrutura (faixa, preenchimento, borda, nome e barra), ou `null` sem forma. */
function buildStructureGroup(scene, instance, catalog, { withLabel = true } = {}) {
  const def = catalog.get(instance.structureId) ?? {};
  const segments = instance.segments?.length ? instance.segments : structureSegmentsOf(scene, instance);
  if (!segments.length) return null;
  const gridSize = Number(scene.grid?.size) || 100;
  const thickness = Math.max(8, Math.round(gridSize * 0.16));
  const color = colorNumber(instance.color ?? def.color);
  const img = instance.img ?? def.img;
  const texture = img ? textureCache.get(img) ?? null : null;
  const shape = instance.shape ?? def.shape;
  const closed = shape === "circle" || shape === "rect";
  const fraction = instance.manaBarrier || !instance.hpMax ? 1 : Math.max(0, Math.min(1, instance.hp / instance.hpMax));
  // Barreira de mana não tem Vida: a barra é a Mana de quem conjurou (é ela que segura a barreira).
  let barFraction = fraction;
  if (instance.manaBarrier) {
    const energy = fromUuidSync(instance.sourceActorUuid)?.system?.attributes?.energy;
    barFraction = energy?.max ? Math.max(0, Math.min(1, energy.value / energy.max)) : 1;
  }
  const alpha = 0.45 + 0.55 * fraction;

  const group = new PIXI.Container();
  const graphics = new PIXI.Graphics();
  const path = [segments[0][0], segments[0][1], ...segments.flatMap(([, , x2, y2]) => [x2, y2])];

  // Brilho largo e fraco por baixo: separa a Estrutura do chão de qualquer mapa.
  graphics.lineStyle({ width: thickness * 2.2, color, alpha: 0.18, join: "round", cap: "round" });
  drawPath(graphics, path, closed);
  if (closed) {
    if (texture) graphics.beginTextureFill({ texture, alpha: 0.55 * alpha });
    else graphics.beginFill(color, 0.22 * alpha);
    graphics.lineStyle(0);
    graphics.drawPolygon(path);
    graphics.endFill();
  }
  if (texture) graphics.lineTextureStyle({ width: thickness, texture, color: 0xffffff, alpha, join: "round", cap: "round" });
  else graphics.lineStyle({ width: thickness, color, alpha, join: "round", cap: "round" });
  drawPath(graphics, path, closed);
  // Borda fina clara: legível sobre fundo escuro ou claro.
  graphics.lineStyle({ width: 2, color: 0xffffff, alpha: 0.35 * alpha, join: "round", cap: "round" });
  drawPath(graphics, path, closed);
  group.addChild(graphics);

  if (withLabel) group.addChild(buildLabel(instance, segments, gridSize, color, barFraction));
  group.structureCenter = centerOf(segments);
  group.structureColor = color;
  group.structureThickness = thickness;
  return group;
}

function centerOf(segments) {
  const mids = segments.map(([x1, y1, x2, y2]) => [(x1 + x2) / 2, (y1 + y2) / 2]);
  return {
    x: mids.reduce((sum, [x]) => sum + x, 0) / mids.length,
    y: mids.reduce((sum, [, y]) => sum + y, 0) / mids.length
  };
}

function drawPath(graphics, path, closed) {
  graphics.moveTo(path[0], path[1]);
  for (let i = 2; i < path.length; i += 2) graphics.lineTo(path[i], path[i + 1]);
  if (closed) graphics.closePath();
}

/** Nome + barra de Vida no meio da Estrutura. Números só pro Mestre; jogador vê só a barra. */
function buildLabel(instance, segments, gridSize, color, fraction) {
  const { x: cx, y: cy } = centerOf(segments);
  const box = new PIXI.Container();
  const fontSize = Math.max(13, Math.round(gridSize * 0.18));
  let text = instance.label ?? "";
  if (game.user.isGM) {
    if (instance.manaBarrier) text += " · barreira de mana";
    else if (instance.hpMax) text += ` · ${instance.hp}/${instance.hpMax}`;
    if (instance.roundsRemaining) text += ` · ${instance.roundsRemaining} rod.`;
  }
  const label = new PIXI.Text(text, {
    fontFamily: "Signika",
    fontSize,
    fontWeight: "600",
    fill: 0xffffff,
    stroke: 0x10121a,
    strokeThickness: Math.max(3, Math.round(fontSize / 4)),
    align: "center"
  });
  label.anchor.set(0.5, 1);
  box.addChild(label);

  const barWidth = Math.max(60, Math.min(gridSize * 1.6, label.width));
  const bar = new PIXI.Graphics();
  bar.beginFill(0x10121a, 0.85).drawRoundedRect(-barWidth / 2 - 2, 2, barWidth + 4, 8, 4).endFill();
  bar.beginFill(instance.manaBarrier ? 0xc084fc : color, 0.95).drawRoundedRect(-barWidth / 2, 4, barWidth * fraction, 4, 2).endFill();
  box.addChild(bar);

  box.position.set(cx, cy);
  return box;
}

/* ------------------------------------------------------------------ Queda */

/** Duração de cada animação de queda, em milissegundos. */
const FALL_DURATION = { destroyed: 1300, manaDepleted: 1100, antimagic: 1100, expired: 1600, dismissed: 1600, casterDown: 1600 };

/**
 * Anima a queda de uma Estrutura que acabou de sair do registro. Só visual e só neste cliente —
 * as Paredes e a luz já foram apagadas pelo Mestre.
 */
function playFall(scene, instance, reason, catalog) {
  if (!canvas?.ready || !canvas.interface) return;
  const group = buildStructureGroup(scene, instance, catalog, { withLabel: false });
  if (!group) return;
  if (!fallLayer || fallLayer.destroyed) {
    fallLayer = new PIXI.Container();
    fallLayer.eventMode = "none";
    canvas.interface.addChildAt(fallLayer, 0);
  }
  const center = group.structureCenter;
  // Pivô no centro, pra tremer/encolher em volta da própria Estrutura.
  group.pivot.set(center.x, center.y);
  group.position.set(center.x, center.y);
  fallLayer.addChild(group);

  const shards = reason === "destroyed" ? spawnShards(instance, group) : [];
  const duration = FALL_DURATION[reason] ?? 1500;
  const start = performance.now();
  const step = () => {
    if (group.destroyed) return canvas?.app?.ticker?.remove(step);
    const t = Math.min(1, (performance.now() - start) / duration);
    if (reason === "destroyed") {
      // Treme forte no começo, depois apaga e incha um pouco (desmanchando).
      const shake = t < 0.3 ? (1 - t / 0.3) * group.structureThickness * 0.6 : 0;
      group.position.set(center.x + (Math.random() - 0.5) * shake, center.y + (Math.random() - 0.5) * shake);
      group.alpha = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7;
      group.scale.set(1 + 0.06 * t);
      for (const shard of shards) {
        shard.x += shard.vx;
        shard.y += shard.vy;
        shard.vy += 0.35;
        shard.rotation += shard.spin;
        shard.alpha = 1 - t;
      }
    } else if (reason === "manaDepleted" || reason === "antimagic") {
      // Pisca cada vez mais fraco até sumir.
      group.alpha = Math.random() < 1 - t ? 0.4 + 0.6 * Math.random() * (1 - t) : 0.05;
    } else {
      // Dissolve devagar, encolhendo um pouco.
      group.alpha = 1 - t;
      group.scale.set(1 - 0.08 * t);
    }
    if (t >= 1) {
      canvas?.app?.ticker?.remove(step);
      for (const shard of shards) if (!shard.destroyed) shard.destroy();
      if (!group.destroyed) group.destroy({ children: true });
    }
  };
  canvas.app.ticker.add(step);
}

/** Estilhaços da Estrutura destruída: pedaços da cor dela voando do meio de cada trecho. */
function spawnShards(instance, group) {
  const segments = instance.segments ?? [];
  const shards = [];
  const size = Math.max(4, group.structureThickness * 0.5);
  for (const [x1, y1, x2, y2] of segments.slice(0, 24)) {
    for (let k = 0; k < 2; k++) {
      const f = Math.random();
      const shard = new PIXI.Graphics();
      shard.beginFill(group.structureColor, 0.95).drawPolygon([0, 0, size, size * 0.3, size * 0.4, size]).endFill();
      shard.position.set(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f);
      shard.vx = (Math.random() - 0.5) * 8;
      shard.vy = -Math.random() * 6;
      shard.spin = (Math.random() - 0.5) * 0.3;
      fallLayer.addChild(shard);
      shards.push(shard);
    }
  }
  return shards;
}
