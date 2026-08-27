/**
 * Sistema principal do Nihility RPG.
 * Centraliza todas as configurações e funcionalidades do sistema.
 */
export class NihilitySystem {
  /**
   * Inicializa o sistema Nihility.
   */
  static async init() {
    // Registrar tipos de documentos personalizados
    this._registerDocumentTypes();

    // Registrar sistemas de combate
    this._registerCombatSystems();

    // Registrar configurações do sistema
    this._registerSystemSettings();

    // Registrar atalhos e eventos
    this._registerEvents();
  }

  /**
   * Registra tipos de documentos personalizados.
   * @private
   */
  static _registerDocumentTypes() {
    // Registrar itens personalizados
    CONFIG.Item.typeLabels = {
      ...CONFIG.Item.typeLabels,
      skill: "Habilidade",
      item: "Item",
      title: "Título",
      body_part: "Parte do Corpo",
      starship_module: "Módulo de Nave",
      species: "Espécie"
    };

    // Registrar atores personalizados
    CONFIG.Actor.typeLabels = {
      ...CONFIG.Actor.typeLabels,
      character: "Personagem",
      npc: "NPC",
      starship: "Nave Espacial"
    };
  }

  /**
   * Registra sistemas de combate.
   * @private
   */
  static _registerCombatSystems() {
    // Configurações de atributos de combate
    CONFIG.Combatant = {
      ...CONFIG.Combatant,
      attributeLabels: {
        strength: "Força",
        agility: "Agilidade",
        intelligence: "Inteligência",
        charisma: "Carisma",
        magicalDefense: "Defesa Mágica"
      }
    };

    // Configurações de dano
    CONFIG.Damage = {
      ...CONFIG.Damage,
      elementalTypes: [
        { id: "fire", label: "Fogo" },
        { id: "ice", label: "Gelo" },
        { id: "lightning", label: "Raio" },
        { id: "poison", label: "Veneno" },
        { id: "arcane", label: "Arcano" }
      ]
    };
  }

  /**
   * Registra configurações do sistema.
   * @private
   */
  static _registerSystemSettings() {
    // Configurações do sistema
    game.settings.register("nihility", "enableSkillFusion", {
      name: "Habilitar Fusão de Habilidades",
      hint: "Ativa ou desativa o sistema de fusão de habilidades.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });

    game.settings.register("nihility", "enableMagicDefense", {
      name: "Habilitar Defesa Mágica",
      hint: "Ativa ou desativa o sistema de defesa mágica no dano.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });

    game.settings.register("nihility", "defaultFusionMode", {
      name: "Modo Padrão de Fusão",
      hint: "Define o modo padrão para fusões (Automático ou Manual).",
      scope: "world",
      config: true,
      type: String,
      choices: {
        auto: "Automático",
        manual: "Manual"
      },
      default: "auto"
    });
  }

  /**
   * Registra eventos e atalhos.
   * @private
   */
  static _registerEvents() {
    // Evento para quando um personagem é criado
    Hooks.on("createActor", (actor) => {
      if (actor.type === "character") {
        this._setupDefaultCharacter(actor);
      }
    });

    // Evento para quando uma habilidade é criada
    Hooks.on("createItem", (item) => {
      if (item.type === "skill") {
        this._setupSkillDefaults(item);
      }
    });
  }

  /**
   * Configura personagem padrão.
   * @private
   */
  static _setupDefaultCharacter(actor) {
    // Configurar valores padrão para novos personagens
    const updates = {
      "system.attributes.hp.max": 100,
      "system.attributes.energy.max": 100,
      "system.skillPoints": {
        normal: 5,
        advanced: 3,
        expert: 2,
        master: 1,
        ultimate: 1
      }
    };

    actor.update(updates);
  }

  /**
   * Configura habilidade padrão.
   * @private
   */
  static _setupSkillDefaults(item) {
    // Configurar valores padrão para novas habilidades
    const updates = {
      "system.cost": 1,
      "system.level": 1,
      "system.tier": "normal"
    };

    item.update(updates);
  }

  /**
   * Retorna as configurações do sistema.
   */
  static get systemConfig() {
    return {
      NAME: "Nihility RPG",
      VERSION: "1.3.2",
      SYSTEM_ID: "nihility",
      LANGUAGE_STYLE: "narrativa épica e profunda",
      SKILL_TIERS: ["normal", "advanced", "expert", "master", "ultimate"],
      SKILL_TIER_LABELS: {
        normal: "Normal",
        advanced: "Avançado",
        expert: "Especialista",
        master: "Mestre",
        ultimate: "Último"
      },
      COMBAT_ATTRIBUTES: ["strength", "agility", "intelligence", "charisma", "magicalDefense"],
      COMBAT_ATTRIBUTE_LABELS: {
        strength: "Força",
        agility: "Agilidade",
        intelligence: "Inteligência",
        charisma: "Carisma",
        magicalDefense: "Defesa Mágica"
      },
      SKILL_EFFECT_TYPES: ["none", "damage", "temporary"],
      SKILL_EFFECT_TYPE_LABELS: {
        none: "Nenhum",
        damage: "Dano",
        temporary: "Efeito Temporário"
      },
      EFFECT_TARGETS: ["hp", "energy", "shield", "strength", "agility", "intelligence", "charisma", "magicalDefense"],
      EFFECT_TARGET_LABELS: {
        hp: "HP",
        energy: "Mana/Energia",
        shield: "Escudo",
        strength: "Força",
        agility: "Agilidade",
        intelligence: "Inteligência",
        charisma: "Carisma",
        magicalDefense: "Defesa Mágica"
      },
      TITLE_BONUS_TARGETS: ["hp", "energy", "strength", "agility", "intelligence", "charisma", "magicalDefense"]
    };
  }
}