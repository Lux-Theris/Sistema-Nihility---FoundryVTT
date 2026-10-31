import { isStructureMechanic } from "../core/config.js";

/**
 * Como um clique em "Usar" deve seguir, só pela mecânica escolhida (Skill ou Sub-Skill). Pura e
 * testada; quem pergunta ao usuário e chama `useSkillEffect` é `useSkillFlow` (skill-use-flow.js).
 *
 * - `deactivate`: Habilidade Ativa já ligada — o clique só desliga, sem alvo nem rolagem.
 * - `structure`: ergue uma Estrutura (posiciona no mapa, se houver).
 * - `plain`: Descritiva ou sem mecânica de alvo — só usa.
 * - `zone` / `emission`: área no mapa (só com o bloco de área ligado; Zona também precisa do mapa).
 * - `emissionNoCanvas`: Emissão com o bloco ligado mas sem mapa — avisa e não usa.
 * - `self`: age sobre quem usa, sem diálogo.
 * - `targeted`: pede um alvo (o padrão; uma Zona/Emissão com o bloco desligado cai aqui).
 *
 * @param {object} mech
 * @param {{areaEnabled?: boolean, areaSupported?: boolean}} [env]
 * @returns {"deactivate"|"structure"|"plain"|"zone"|"emission"|"emissionNoCanvas"|"self"|"targeted"}
 */
export function skillUseMode(mech, { areaEnabled = false, areaSupported = false } = {}) {
  if (!mech) return "plain";
  if (mech.hasUpkeep && mech.active) return "deactivate";
  if (isStructureMechanic(mech)) return "structure";
  if (mech.effectType !== "temporary" && mech.effectType !== "damage") return "plain";
  if (mech.targetType === "zone" && areaEnabled && areaSupported) return "zone";
  if (mech.targetType === "emission" && areaEnabled) return areaSupported ? "emission" : "emissionNoCanvas";
  if (mech.targetType === "self") return "self";
  return "targeted";
}
