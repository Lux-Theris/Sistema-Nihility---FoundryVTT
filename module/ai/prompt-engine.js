/**
 * Gerencia a engenharia de prompts para o sistema de IA.
 */
export class PromptEngine {
  /**
   * Cria um prompt para fusão de habilidades.
   * @param {Actor} actor - O ator que está realizando a fusão
   * @param {Item[]} sources - Habilidades fonte
   * @param {string} targetTier - Tier alvo da nova habilidade
   * @param {string} emotionPrompt - Prompt emocional para orientação
   * @returns {string} Prompt formatado para IA
   */
  static createFusionPrompt(actor, sources, targetTier, emotionPrompt = "") {
    const languageStyle = this._getSystemLanguageStyle();

    return `
      ${languageStyle}

      Você é o motor de regras de um RPG de Foundry VTT. Analise cuidadosamente as seguintes habilidades e crie uma nova habilidade que combine seus poderes de forma coerente:

      Fontes para fusão:
      ${JSON.stringify(sources.map(s => ({
        name: s.name,
        description: s.system.description,
        cost: s.system.cost,
        tier: s.system.tier,
        effectType: s.system.effectType
      })), null, 2)}

      Contexto do personagem:
      - Nome: ${actor.name}
      - Personalidade: ${actor.system?.personality?.traits || "não especificada"}
      - Desejos: ${actor.system?.personality?.desires || "não especificado"}
      - Estado emocional: ${actor.system?.personality?.emotionalState || "não especificado"}

      Requisitos da nova habilidade:
      1. O nome deve ser significativo e criar uma conexão narrativa entre as fontes
      2. A descrição deve explicar como os poderes se combinam para criar algo novo
      3. O custo deve refletir o poder combinado das habilidades originais
      4. Se for elemento mágico, mantenha a conexão com os elementos originais
      5. As habilidades sub-skill devem representar as origens da fusão
      6. A nova habilidade deve ter um gatilho emocional ou narrativo claro

      Considerações especiais:
      - Se houver conflitos entre habilidades, resolva com coerência narrativa
      - O custo total deve ser proporcional ao poder combinado
      - A nova habilidade deve ser original e não apenas uma cópia de alguma das fontes
      - Mantenha a linguagem e estilo do universo RPG

      ${emotionPrompt ? `Gatilho emocional: ${emotionPrompt}` : ''}

      Responda com um único objeto JSON estrito no formato:
      {
        "name": "Nome da nova habilidade",
        "description": "Descrição HTML detalhada",
        "emotionTrigger": "Gatilho emocional que conecta as fontes",
        "cost": número,
        "level": número,
        "effectType": "none"|"damage"|"temporary",
        "damageFormula": "Fórmula de dano se for damage",
        "isElementalDamage": booleano,
        "damageElement": "ID do elemento se for elemental",
        "effects": array de efeitos,
        "subSkills": array de habilidades sub-skill,
        "fusionSources": array de nomes das habilidades originais
      }
    `;
  }

  /**
   * Cria um prompt para geração de nova habilidade.
   * @param {string} promptText - Texto descritivo da habilidade desejada
   * @returns {string} Prompt formatado para IA
   */
  static createSkillGenerationPrompt(promptText) {
    // Para gerar habilidades completamente novas, não a partir de fusão
    const languageStyle = this._getSystemLanguageStyle();

    return `
      ${languageStyle}

      Gere uma habilidade nova e original com base na seguinte descrição:

      "${promptText}"

      A habilidade deve ser coerente com o universo do jogo e seguir as regras do sistema.

      Responda com um único objeto JSON estrito no formato:
      {
        "name": "Nome da habilidade",
        "description": "Descrição HTML detalhada",
        "emotionTrigger": "Gatilho emocional",
        "cost": número,
        "level": número,
        "effectType": "none"|"damage"|"temporary",
        "damageFormula": "Fórmula de dano se for damage",
        "isElementalDamage": booleano,
        "damageElement": "ID do elemento se for elemental",
        "effects": array de efeitos,
        "subSkills": array de habilidades sub-skill
      }
    `;
  }

  /**
   * Obtém o estilo linguístico do sistema.
   * @private
   */
  static _getSystemLanguageStyle() {
    // Retornar estilo de linguagem baseado no universo do sistema
    return `Você está no universo de ${MEU_SISTEMA.NAME}, um sistema RPG com estética épica e narrativa profunda.
            A linguagem deve ser rica em descrições, com foco em elementos mágicos e poderosos.
            Use termos que respeitem o tom do sistema: ${MEU_SISTEMA.LANGUAGE_STYLE || "narrativa épica"}.`;
  }

  /**
   * Cria prompt para geração de habilidades únicas.
   * @param {Actor} actor - Ator que deseja criar a habilidade
   * @param {Object} options - Opções adicionais
   * @returns {string} Prompt para IA
   */
  static createUniqueSkillPrompt(actor, options = {}) {
    const personality = actor.system?.personality || {};

    return `
      Você está no universo de ${MEU_SISTEMA.NAME}. Crie uma habilidade única e poderosa para um personagem com as seguintes características:

      - Nome: ${actor.name}
      - Personalidade: ${personality.traits || "não especificada"}
      - Desejos: ${personality.desires || "não especificado"}
      - Estado emocional: ${personality.emotionalState || "não especificado"}

      A habilidade deve:
      1. Ser original e única para esse personagem
      2. Refletir sua personalidade e desejos
      3. Ter um gatilho emocional claro
      4. Ser coerente com o poder do personagem

      Responda com um único objeto JSON estrito no formato:
      {
        "name": "Nome da habilidade",
        "description": "Descrição HTML detalhada",
        "emotionTrigger": "Gatilho emocional que conecta as fontes",
        "cost": número,
        "level": número,
        "effectType": "none"|"damage"|"temporary",
        "damageFormula": "Fórmula de dano se for damage",
        "isElementalDamage": booleano,
        "damageElement": "ID do elemento se for elemental",
        "effects": array de efeitos,
        "subSkills": array de habilidades sub-skill
      }
    `;
  }
}