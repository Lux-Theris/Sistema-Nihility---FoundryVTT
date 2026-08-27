/**
 * Gerencia todas as operações de fusão de habilidades no sistema Nihility.
 */
export class SkillFusionManager {
  /**
   * Realiza a fusão de múltiplas habilidades em uma nova habilidade.
   * @param {Actor} actor - O ator que está realizando a fusão
   * @param {string[]} sourceIds - IDs das habilidades a serem fundidas
   * @param {object} options - Opções para a fusão
   * @returns {Promise<Item>} A nova habilidade criada
   */
  static async fuseSkills(actor, sourceIds, options = {}) {
    const { tier = "normal", mode = "auto", manualData = null, emotionPrompt = "" } = options;

    // Validar entradas e fontes
    const sources = this._validateSources(actor, sourceIds);

    // Garantir que os compêndios do sistema existam
    await this._ensureCompendiums();

    // Gerar a nova habilidade através da IA
    let fusedSkillData;
    if (mode === "auto") {
      fusedSkillData = await this._generateFusedSkillFromAI(actor, sources, tier);
    } else {
      fusedSkillData = await this._createManualFusion(sources, tier, manualData);
    }

    // Executar a fusão e retornar o resultado
    return await this._executeFusion(actor, sources, fusedSkillData);
  }

  /**
   * Valida as habilidades fonte para fusão.
   * @private
   */
  static _validateSources(actor, sourceIds) {
    const sources = sourceIds.map(id => actor.items.get(id)).filter(Boolean);
    if (sources.length < 2) throw new Error("Selecione ao menos duas habilidades para fundir.");

    // Verificar se há habilidades concedidas por itens que não podem ser fundidas
    const grantedSource = sources.find(s => s.system.isItemGranted);
    if (grantedSource) {
      throw new Error(`"${grantedSource.name}" foi concedida por um item/módulo e não pode ser fundida.`);
    }

    return sources;
  }

  /**
   * Gera uma nova habilidade a partir de fontes usando IA.
   * @private
   */
  static async _generateFusedSkillFromAI(actor, sources, targetTier) {
    // Criar prompt abrangente que analisa todos os aspectos das habilidades fonte
    const sourceDescriptions = sources.map(s => ({
      name: s.name,
      description: s.system.description,
      cost: s.system.cost,
      tier: s.system.tier,
      effectType: s.system.effectType,
      damageFormula: s.system.damageFormula,
      isElementalDamage: s.system.isElementalDamage,
      damageElement: s.system.damageElement,
      effects: s.system.effects,
      subSkills: s.system.subSkills
    }));

    const prompt = `
      Você é o motor de regras de um RPG de Foundry VTT. Analise cuidadosamente as seguintes habilidades e crie uma nova habilidade que combine seus poderes de forma coerente:

      Fontes para fusão:
      ${JSON.stringify(sourceDescriptions, null, 2)}

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

    const systemPrompt =
      "Você é o motor de regras de um RPG de Foundry VTT. Responda SEMPRE com um único objeto JSON " +
      'estrito, sem markdown e sem texto fora do JSON, no formato: ' +
      '{"name": string, "description": string (HTML curto), "emotionTrigger": string, ' +
      '"cost": number, "level": number, "effectType": "none"|"damage"|"temporary", ' +
      '"damageFormula": string, "isElementalDamage": boolean, "damageElement": string, ' +
      '"effects": [{"target": string, "amount": number, "durationRounds": number}], ' +
      '"subSkills": [{"name": string, "description": string}], "fusionSources": [string]}.';

    try {
      const result = await generateJSON(systemPrompt, prompt);
      return this._normalizeFusionResult(result, sources, targetTier);
    } catch (error) {
      console.error("Falha na geração de habilidade fusionada:", error);
      // Fallback para fusão básica se a IA falhar
      return this._fallbackFusion(sources, targetTier);
    }
  }

  /**
   * Normaliza o resultado da fusão para garantir estrutura consistente.
   * @private
   */
  static _normalizeFusionResult(result, sources, targetTier) {
    // Garantir que o resultado tenha estrutura adequada e padrões
    return {
      name: result.name || "Habilidade Fusionada",
      type: "skill",
      system: {
        tier: targetTier,
        level: Math.max(1, result.level || 1),
        cost: Math.max(0, result.cost || 0),
        description: result.description || "<p>Habilidade criada por combinação de poderes.</p>",
        emotionTrigger: result.emotionTrigger || "",
        effectType: result.effectType || "none",
        damageFormula: result.damageFormula || "",
        isElementalDamage: Boolean(result.isElementalDamage),
        damageElement: result.damageElement || "",
        effects: Array.isArray(result.effects) ? result.effects : [],
        subSkills: Array.isArray(result.subSkills) ? result.subSkills : [],
        fusionSources: sources.map(s => s.name),
        isFused: true
      }
    };
  }

  /**
   * Fallback para fusão básica quando a IA falha.
   * @private
   */
  static _fallbackFusion(sources, targetTier) {
    // Fusão básica quando IA falha
    const sourceNames = sources.map(s => s.name);
    return {
      name: `Fusão Avançada: ${sourceNames.join(" + ")}`,
      type: "skill",
      system: {
        tier: targetTier,
        level: Math.max(1, ...sources.map(s => s.system.level ?? 1)),
        cost: sources.reduce((sum, s) => sum + (s.system.cost ?? 0), 0),
        description: `<p>Habilidade resultante da fusão significativa de: ${sourceNames.join(", ")}. Esta habilidade combina os poderes das fontes originais em uma nova forma.</p>`,
        emotionTrigger: "",
        effectType: "none",
        damageFormula: "",
        isElementalDamage: false,
        damageElement: "",
        effects: [],
        subSkills: sources.flatMap(s => s.system.subSkills ?? []),
        fusionSources: sourceNames,
        isFused: true
      }
    };
  }

  /**
   * Cria uma fusão manualmente.
   * @private
   */
  static async _createManualFusion(sources, targetTier, manualData) {
    // Implementação para fusão manual
    return this._fallbackFusion(sources, targetTier);
  }

  /**
   * Executa a fusão real no ator.
   * @private
   */
  static async _executeFusion(actor, sources, fusedSkillData) {
    // Garantir que as fontes sobrevivam no compêndio antes de remoção
    for (const source of sources) {
      await registerItemInCompendium(source.toObject());
    }

    // Remover habilidades originais do ator
    await actor.deleteEmbeddedDocuments("Item", sources.map(s => s.id));

    // Criar nova habilidade no ator
    const [createdOnActor] = await actor.createEmbeddedDocuments("Item", [fusedSkillData]);

    // Registrar no compêndio se não foi reutilizada
    if (!createdOnActor.system.isFused) {
      await registerItemInCompendium(createdOnActor.toObject());
    }

    // Anunciar na Voz do Mundo
    await announceVoiceOfTheWorld(actor, {
      kind: "fusion",
      title: `Fusão de Habilidade: ${createdOnActor.name}`,
      body: `Nova habilidade forjada a partir de: ${sources.map(s => s.name).join(", ")}.`
    });

    return createdOnActor;
  }

  /**
   * Garante que todos os compêndios do sistema existam.
   * @private
   */
  static async _ensureCompendiums() {
    if (!game.user.isGM) return;
    for (const def of Object.values(MEU_SISTEMA.COMPENDIUM)) {
      const collectionId = `world.${def.key}`;
      if (game.packs.get(collectionId)) continue;
      await CompendiumCollection.createCompendium({
        type: def.type,
        label: def.label,
        name: def.key,
        package: "world",
        system: SYSTEM_ID
      });
      console.log(`${SYSTEM_ID} | Compêndio criado automaticamente: ${def.label}`);
    }
  }
}