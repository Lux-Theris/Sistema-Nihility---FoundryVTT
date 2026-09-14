/**
 * Iniciativa pelo pool de dados do sistema.
 *
 * A fórmula do core do Foundry (`CONFIG.Combat.initiative.formula`) é uma string GLOBAL: ela não
 * sabe de quem está rolando, então não dá pra usá-la com um pool que depende do Atributo de cada
 * Ator. O caminho por documento é este — trocar a classe de Combatente e sobrescrever o cálculo
 * da fórmula, que é chamado uma vez por combatente ao rolar.
 *
 * O resultado é o MESMO `Nd20 + fixo` de qualquer rolagem de Atributo (ver dice.js), incluindo o
 * bônus de Item somado por fora — antes disso, iniciativa era um `1d20` pelado, que não conversava
 * com atributo nenhum do sistema.
 */
import { SYSTEM_ID, MEU_SISTEMA, getAttributeLabel } from "./config.js";
import { buildAttributeRollFormula } from "./dice.js";

/** Atributo que rege a iniciativa (setting; cai em Destreza se a setting sumir ou virar inválida). */
export function getInitiativeAttribute() {
  try {
    const key = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.initiativeAttribute);
    if (MEU_SISTEMA.COMBAT_ATTRIBUTES.includes(key)) return key;
  } catch (err) {
    /* setting ainda não registrada */
  }
  return "dexterity";
}

/** Rótulo atual do Atributo de iniciativa — pro botão da ficha dizer o que vai rolar. */
export function getInitiativeLabel() {
  return getAttributeLabel(getInitiativeAttribute());
}

/**
 * Troca a classe de Combatente por uma que calcula a iniciativa pelo pool do Ator. Chamado no
 * hook `init`. Estende `CONFIG.Combatant.documentClass` (e não a classe global diretamente) pra
 * continuar funcionando se outro módulo já tiver trocado a classe antes — o sistema entra na
 * cadeia em vez de atropelá-la.
 */
export function registerInitiative() {
  const BaseCombatant = CONFIG.Combatant.documentClass;

  CONFIG.Combatant.documentClass = class NihilityCombatant extends BaseCombatant {
    /** @override */
    _getInitiativeFormula() {
      const attributeKey = getInitiativeAttribute();
      const attribute = this.actor?.system?.attributes?.combat?.[attributeKey];
      // Nave/Veículo não tem Atributos de Combate — cai na fórmula padrão do core em vez de
      // inventar um pool que aquele tipo de Ator não tem.
      if (!attribute) return super._getInitiativeFormula();

      // Bônus de Item entra como número fixo, nunca como dado a mais — a mesma regra de
      // `rollAttribute` em dice.js ("soma por fora, na hora da rolagem").
      return buildAttributeRollFormula(attribute.bonus, attribute.itemBonus ?? 0);
    }
  };
}

/**
 * Rola a iniciativa deste Ator e joga o resultado no rastreador de combate.
 *
 * Adicionar um Ator ao combate é ação de Mestre no Foundry, então um jogador cujo personagem
 * ainda não está no combate recebe um aviso pra pedir ao Mestre, em vez de um erro de permissão
 * no console. Uma vez dentro, ele rola a própria iniciativa normalmente.
 * @param {Actor} actor
 */
export async function rollInitiativeForActor(actor) {
  const combat = game.combat;
  if (!combat) {
    ui.notifications.warn("Nenhum combate ativo — crie um encontro antes de rolar iniciativa.");
    return null;
  }

  let combatant = combat.combatants.find(c => c.actorId === actor.id);

  if (!combatant) {
    if (!game.user.isGM) {
      ui.notifications.warn(`${actor.name} ainda não está no combate — peça ao Mestre para adicionar.`);
      return null;
    }

    const token = actor.getActiveTokens()[0];
    if (!token) {
      ui.notifications.warn(`${actor.name} precisa de um Token na cena atual para entrar no combate.`);
      return null;
    }

    const [created] = await combat.createEmbeddedDocuments("Combatant", [
      { actorId: actor.id, tokenId: token.id, sceneId: canvas.scene.id }
    ]);
    combatant = created;
  }

  await combat.rollInitiative([combatant.id]);
  return combatant;
}
