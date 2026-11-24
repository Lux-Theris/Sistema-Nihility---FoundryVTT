/**
 * Interdição de Naves (8f.2): o Módulo tecnológico com `interdictRange` (Função Utilitário) que, online e com energia,
 * impede o salto FTL das Naves cujo Token está dentro do alcance dele. A conta é a de `interdictors` (space-rules.js, pura,
 * testada); aqui só se lê a cena. Só documentos (Tokens da cena e Módulos), nada de canvas além do pixel por unidade.
 *
 * No jogo é outra coisa que a Âncora (o dono, 22/11): é tecnologia. O PEM derruba o Módulo (o `moduleDisable` de sempre) e, com
 * ele, a interdição; o Módulo desligado, sem energia ou destruído não interdita. O sistema NÃO tem uma ação de salto FTL
 * (o FTL é só dado do Módulo); por isso a Interdição é mostrada na ficha da Nave (linha do FTL e aviso) e consultável por
 * `ftlBlockReason(ship)`, que qualquer ação de salto futura (Sensores/Abordagem, itens 9) deve perguntar antes de gastar.
 */
import { isShipLike } from "./ship-damage.js";
import { isSpaceManipulationEnabled } from "../core/config.js";
import { interdictors, interdictionText } from "../combat/space-rules.js";

/** O Módulo interdita agora? (online, com energia, com Vida e com alcance) */
export function moduleInterdicts(ship, module) {
  const range = Number(module?.system?.interdictRange) || 0;
  if (!(range > 0) || module.system.status !== "online") return false;
  if (ship?.system?.isPowerStarved?.(module)) return false;
  return (module.system.hp?.value ?? 1) > 0;
}

/** Os interditores da cena: `[{name, range, point}]` (Tokens de outras Naves/Veículos com um Módulo que interdita). */
export function interdictionSources(scene, exceptActor = null) {
  const out = [];
  const size = Number(scene?.grid?.size) || 100;
  for (const token of scene?.tokens ?? []) {
    const actor = token.actor;
    if (!actor || !isShipLike(actor) || (exceptActor && actor.uuid === exceptActor.uuid)) continue;
    const modules = actor.system?.modules ?? [];
    const range = Math.max(0, ...modules.filter(m => moduleInterdicts(actor, m)).map(m => Number(m.system.interdictRange) || 0));
    if (range > 0) out.push({ name: token.name || actor.name, range, point: { x: token.x + (token.width * size) / 2, y: token.y + (token.height * size) / 2 } });
  }
  return out;
}

/**
 * A Nave está Interditada? `{list, text}` com quem interdita (do mais perto) e a frase, ou `null` (fora de interdição, sem
 * Token na cena, bloco desligado ou ator que não é Nave). Interditor não se interdita.
 */
export function shipInterdiction(ship, scene = globalThis.canvas?.scene) {
  if (!isSpaceManipulationEnabled() || !ship || !isShipLike(ship) || !scene) return null;
  const token = ship.isToken ? ship.token : scene.tokens?.find(t => t.actor?.uuid === ship.uuid || t.actorId === ship.id);
  if (!token) return null;
  const size = Number(scene.grid?.size) || 100;
  const dist = Number(scene.grid?.distance) || 1;
  const point = { x: token.x + (token.width * size) / 2, y: token.y + (token.height * size) / 2 };
  const list = interdictors({ point, sources: interdictionSources(scene, ship), pxPerUnit: size / dist });
  return list.length ? { list, text: interdictionText(ship.name, list) } : null;
}

/** O motivo (texto) de o salto FTL estar bloqueado, ou "" (nada impede). */
export function ftlBlockReason(ship, scene = globalThis.canvas?.scene) {
  return shipInterdiction(ship, scene)?.text ?? "";
}
