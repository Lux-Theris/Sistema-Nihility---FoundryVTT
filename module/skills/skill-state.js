/**
 * Estado de uma Skill em uso: caminhos de ligado/investido e de onde sai o Custo (Mana do Personagem, Bateria da Nave).
 * (Separado de skill-effects.js na reorganização de pastas — mesma lógica de antes.)
 */
import { getEnergyLabelForActor } from "../core/config.js";
import { isShipLike } from "../starship/ship-damage.js";

/** Caminho de update pro flag `active` — top-level ou dentro de um Sub-Skill específico. */
export function activeStatePath(subSkillIndex) {
  return subSkillIndex != null ? `system.subSkills.${subSkillIndex}.active` : "system.active";
}

/** Caminho da razão de Mana investida (Mana variável) da Skill ou Sub-Skill. */
export function investRatioPath(subSkillIndex) {
  return subSkillIndex != null ? `system.subSkills.${subSkillIndex}.investRatio` : "system.investRatio";
}

/**
 * Caminho e valor atual do pool de onde sai o Custo ÚNICO de uma Skill (pago uma vez ao usar/
 * ligar): Personagem/Criatura gasta Mana/Energia (`attributes.energy`); Nave e Veículo (mesmo
 * Grid de Energia desde o overhaul de Porte) gastam a reserva do Capacitor
 * (`powerGrid.capacitor.value`).
 *
 * Precisa ser um campo PERSISTIDO — antes isso apontava pra `powerGrid.reactorOutput`, que é
 * recalculado do Módulo de Reator a cada `prepareDerivedData()`: o desconto era sobrescrito na
 * preparação seguinte (Skill de Nave saía de graça) e, sem Módulo de Reator, o valor lido era
 * sempre 0 (nenhuma Skill com custo jamais podia ser usada).
 *
 * O Custo POR RODADA (upkeep) não passa por aqui: ele é descontado direto da geração do Reator,
 * de forma derivada, por `ShipSystemsDataModel.activeUpkeepDrain` — quem controla esse desconto
 * é o próprio estado `active` da Skill, então desligar devolve a energia sem precisar de
 * nenhuma escrita de compensação.
 */
export function energyValuePath(actor) {
  return isShipLike(actor) ? "system.powerGrid.capacitor.value" : "system.attributes.energy.value";
}

export function currentEnergyValue(actor) {
  return isShipLike(actor) ? (actor.system.powerGrid.capacitor.value ?? 0) : (actor.system.attributes.energy.value ?? 0);
}

/** Avisa só quem clicou (whisper individual) que a Energia (nome configurável) atual não cobre o Custo. */
export async function warnInsufficientEnergy(sourceActor, label, cost) {
  const current = currentEnergyValue(sourceActor);
  const energyLabel = getEnergyLabelForActor(sourceActor);
  await ChatMessage.create({
    whisper: [game.user.id],
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p>${energyLabel} insuficiente pra usar <strong>${label}</strong> (precisa ${cost}, ${sourceActor.name} tem ${current}).</p>`
  });
}
