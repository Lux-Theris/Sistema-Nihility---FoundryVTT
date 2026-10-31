/**
 * Escape de HTML — a única cópia do sistema. Todo texto que vem de um documento (nome de Ator, de
 * Skill, de Item, rótulo de catálogo) e entra numa string de HTML (card de chat, `innerHTML`,
 * `content` de diálogo) passa por aqui: um nome com `<` ou `&` quebrava o card, e quem pode
 * renomear a própria ficha conseguia injetar HTML no chat de todo mundo.
 *
 * Mesmo resultado que `foundry.utils.escapeHTML` (& < > " '), mas sem depender do Foundry, para
 * as funções puras que montam HTML continuarem testáveis em Node.
 */
const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ENTITIES[ch]);
}
