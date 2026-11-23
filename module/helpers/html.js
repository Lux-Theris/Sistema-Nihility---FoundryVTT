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

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_COLOR = /^(?:rgba?|hsla?)\([0-9\s,.%/]*\)$/i;
const NAMED_COLOR = /^[a-z]+$/i;

/**
 * Cor vinda de catálogo, validada para entrar num atributo `style`. O escape de HTML não impede
 * CSS extra (`red;background:url(...)`), então só passa hexadecimal (#rgb, #rgba, #rrggbb,
 * #rrggbbaa), rgb/rgba/hsl/hsla simples ou um nome só de letras. Qualquer outra coisa (inclusive
 * vazio, `null` e `undefined`) vira `fallback`.
 * @param {unknown} value
 * @param {string} [fallback=""]
 * @returns {string}
 */
export function cssColor(value, fallback = "") {
  const text = String(value ?? "").trim();
  return HEX_COLOR.test(text) || FUNC_COLOR.test(text) || NAMED_COLOR.test(text) ? text : fallback;
}
