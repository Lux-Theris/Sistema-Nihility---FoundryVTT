/**
 * Distâncias entre Tokens para o saque, as pilhas, o depósito, a máquina e a troca (Lojas, lote B).
 * Lê Tokens da cena pela fonte (`_source`: o documento vivo carrega quadros de animação e fica
 * desatualizado numa janela em segundo plano). A conta é pura (`loot-rules.js`).
 */
import { rectGapDistance, nearestGap } from "./loot-rules.js";

/** Tamanho, distância e unidade da grade da cena. */
export function gridOf(scene) {
  return { size: Number(scene?.grid?.size) || 100, distance: Number(scene?.grid?.distance) || 1, units: scene?.grid?.units || "m" };
}

/** O retângulo do Token em pixels da cena. */
export function rectOf(tokenDoc) {
  const src = tokenDoc?._source ?? tokenDoc ?? {};
  const grid = gridOf(tokenDoc?.parent);
  return { x: Number(src.x) || 0, y: Number(src.y) || 0, w: (Number(src.width) || 1) * grid.size, h: (Number(src.height) || 1) * grid.size };
}

/** Os Tokens de um Ator (por uuid) na cena. */
export function actorTokens(scene, actor) {
  if (!scene || !actor) return [];
  return scene.tokens.filter(t => t.actorId === actor.id && (t.actorLink || t.actor?.uuid === actor.uuid) && !t.hidden);
}

/** A menor distância (borda a borda) do Ator a um Token ou ponto, ou `null` se ele não tem Token na cena. */
export function distanceToRect(scene, actor, target) {
  const grid = gridOf(scene);
  return nearestGap(actorTokens(scene, actor).map(rectOf), target, grid.size, grid.distance);
}

/** O mesmo, até um Token. */
export function distanceToToken(actor, tokenDoc) {
  return distanceToRect(tokenDoc?.parent, actor, rectOf(tokenDoc));
}

/** Distância entre dois Atores na cena (menor par de Tokens), ou `null`. */
export function distanceBetweenActors(scene, a, b) {
  const grid = gridOf(scene);
  const bRects = actorTokens(scene, b).map(rectOf);
  let best = null;
  for (const rect of bRects) {
    const d = distanceToRect(scene, a, rect);
    if (d !== null && (best === null || d < best)) best = d;
  }
  return best;
}

export { rectGapDistance };
