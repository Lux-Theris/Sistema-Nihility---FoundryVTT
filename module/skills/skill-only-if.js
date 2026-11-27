/**
 * "Só se…" da Skill inteira (item 8c.1): conferido ANTES de pagar o Custo, depois de escolhido o alvo.
 * Desligar uma Ativa nunca passa por aqui. Sem alvo único (área, Estrutura, Zona) só valem as condições
 * sobre quem usa; as do alvo ficam de fora (não há de quem ler).
 */
import { buildModifierContext } from "../combat/conditional-context.js";
import { normalizeOnlyIf, onlyIfOutcome } from "./only-if-rules.js";
import { onlyIfLabelOf } from "./effects-apply.js";
import { floatTextOnActor } from "../combat/floating-numbers.js";
import { escapeHtml } from "../helpers/html.js";

/**
 * A recusa do "Só se…" na tela de QUEM USOU (1.122.1): o aviso do canto pode passar batido numa mesa narrada por voz, então
 * além dele sobe um texto curto do Token de quem usou ("Só se… não vale") e, para o jogador, o motivo vai também ao chat
 * dele (sussurro para si). Nada foi gasto. Chamado pelos três caminhos (seletor, mapa e o disparo final).
 */
export function reportOnlyIfRefusal(actor, label, message) {
  const text = `${label}: ${message}.`;
  ui.notifications?.warn(text);
  try {
    floatTextOnActor(actor, "Só se… não vale", { fill: "#ffcc66", fontSize: 26 });
    if (!game.user.isGM) {
      ChatMessage.create({ content: `<p><strong>${escapeHtml(label)}</strong> não saiu: ${escapeHtml(message)}. Nada foi gasto.</p>`, whisper: [game.user.id], speaker: ChatMessage.getSpeaker({ actor }) });
    }
  } catch (err) {
    /* o aviso do canto já saiu */
  }
}

/**
 * @param {Actor} actor - quem usa
 * @param {object} mech - a mecânica (Skill ou Sub-Skill)
 * @param {Actor|null} targetActor
 * @returns {string|null} o aviso (sem prefixo de Skill) ou null se pode usar
 */
export function skillOnlyIfBlock(actor, mech, targetActor = null) {
  const clean = normalizeOnlyIf(mech?.onlyIf);
  if (!clean) return null;
  if (!targetActor && clean.kind.startsWith("other")) return null;
  const gate = onlyIfOutcome(clean, buildModifierContext(actor, targetActor ?? null), onlyIfLabelOf);
  if (gate.ok) return null;
  return gate.reason.replace(/^não aplicado: /, "");
}
