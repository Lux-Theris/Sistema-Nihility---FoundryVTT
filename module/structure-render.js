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
 */
import { SYSTEM_ID, getStructures } from "./config.js";
import { structuresOnScene, removeOrphanStructureWalls, structureSegmentsOf } from "./structures.js";

let container = null;
let pulse = null;
let drawToken = 0;

/** Liga os hooks. Chamado no `init`. */
export function registerStructureRendering() {
  Hooks.on("canvasReady", () => {
    drawStructures();
    removeOrphanStructureWalls(canvas.scene);
  });
  Hooks.on("canvasTearDown", () => clearStructures());
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

async function loadTextureSafe(path) {
  if (!path) return null;
  try {
    const load = foundry.canvas?.loadTexture ?? globalThis.loadTexture;
    return (await load?.(path)) ?? null;
  } catch (err) {
    return null;
  }
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
  const textures = new Map();
  for (const instance of instances) {
    const img = instance.img ?? catalog.get(instance.structureId)?.img;
    if (img && !textures.has(img)) textures.set(img, await loadTextureSafe(img));
  }
  if (token !== drawToken) return; // outro redesenho começou enquanto carregava

  clearStructures();
  if (!instances.length) return;
  container = new PIXI.Container();
  container.eventMode = "none";
  canvas.interface.addChildAt(container, 0);

  const gridSize = Number(scene.grid?.size) || 100;
  const thickness = Math.max(8, Math.round(gridSize * 0.16));
  const barriers = [];

  for (const instance of instances) {
    const def = catalog.get(instance.structureId) ?? {};
    const segments = structureSegmentsOf(scene, instance);
    if (!segments.length) continue;
    const color = colorNumber(instance.color ?? def.color);
    const img = instance.img ?? def.img;
    const texture = img ? textures.get(img) : null;
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

    group.addChild(buildLabel(instance, segments, gridSize, color, barFraction));
    container.addChild(group);
    if (instance.manaBarrier) barriers.push(group);
  }

  // Barreira de mana pulsa (só alpha — barato, e some junto com o container).
  if (barriers.length) {
    let t = 0;
    pulse = delta => {
      t += (delta ?? 1) * 0.05;
      const a = 0.75 + 0.25 * Math.sin(t);
      for (const g of barriers) if (!g.destroyed) g.alpha = a;
    };
    canvas.app.ticker.add(pulse);
  }
}

function drawPath(graphics, path, closed) {
  graphics.moveTo(path[0], path[1]);
  for (let i = 2; i < path.length; i += 2) graphics.lineTo(path[i], path[i + 1]);
  if (closed) graphics.closePath();
}

/** Nome + barra de Vida no meio da Estrutura. Números só pro Mestre; jogador vê só a barra. */
function buildLabel(instance, segments, gridSize, color, fraction) {
  const mids = segments.map(([x1, y1, x2, y2]) => [(x1 + x2) / 2, (y1 + y2) / 2]);
  const cx = mids.reduce((sum, [x]) => sum + x, 0) / mids.length;
  const cy = mids.reduce((sum, [, y]) => sum + y, 0) / mids.length;

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
