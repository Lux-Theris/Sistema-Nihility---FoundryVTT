/**
 * "Só se…" da Skill inteira (item 8c.1): conferido ANTES de pagar o Custo, depois de escolhido o alvo.
 * Desligar uma Ativa nunca passa por aqui. Sem alvo único (área, Estrutura, Zona) só valem as condições
 * sobre quem usa; as do alvo ficam de fora (não há de quem ler).
 */
import { buildModifierContext } from "../combat/conditional-context.js";
import { normalizeOnlyIf, onlyIfOutcome } from "./only-if-rules.js";
import { onlyIfLabelOf } from "./effects-apply.js";

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
