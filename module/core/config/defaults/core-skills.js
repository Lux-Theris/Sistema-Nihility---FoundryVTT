/**
 * Skills pré-feitas do sistema: outras regras dependem delas (Antimagia, e depois o Sistema de Magia).
 * Dados puros (importa nada). Achadas pela chave `system.coreSkill`, nunca pelo nome — o nome usa o
 * rótulo da energia do mundo (`{E}`) e muda se o Mestre renomear a Mana.
 * `core/compendium.js` cria no Compêndio de Skills as que faltarem.
 */
export const CORE_SKILL_DEFS = {
  manaManipulation: {
    name: "Manipulação de {E}",
    description:
      "<p>A base de toda magia: sentir e mexer na {E} que há em você e ao redor. Esta Skill <strong>resiste à Antimagia</strong>: " +
      "sem ela, a magia de quem usa some quando passa por um campo de Antimagia (ou sob Selo); com ela, quanto maior o nível " +
      "diante do campo, menos o campo atrapalha — primeiro a magia passa pagando {E} a mais, depois passa de graça. " +
      "Usar a Skill contra a Antimagia a faz evoluir.</p>"
  },
  manaDetection: {
    name: "Detecção de {E}",
    description:
      "<p>Sentir e enxergar a {E} ao redor: de onde ela vem, quanta há, o que está carregado dela. " +
      "Por enquanto é descritiva — o Mestre narra o que se percebe.</p>"
  }
};
