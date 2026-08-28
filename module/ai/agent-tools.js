/**
 * Tools que o Assistente de IA agente (module/apps/ai-assistant.js, via agent-runner.js) pode
 * chamar. Só leitura + "propor" — nenhuma tool aqui escreve no mundo de verdade: `propose_*`
 * só empilham em `proposals`, pra passar pela tela de revisão antes de qualquer coisa ser
 * criada/editada (ver Parte 3.5 do plano).
 */
import { MEU_SISTEMA, getActiveDamageElements } from "../config.js";
import { getCompendiumForItemType, sanitizeDocumentPatch } from "../ai-helper.js";

/**
 * Cria um novo conjunto de tools + o array de propostas que elas alimentam. Uma instância
 * nova por execução do assistente (não reaproveitar entre chamadas).
 * @returns {{tools: Array<object>, proposals: Array<{type:string, data:object}>}}
 */
export function createAgentTools() {
  const proposals = [];

  const tools = [
    {
      name: "list_skills",
      description:
        "Lista Skills já existentes no Compêndio do mundo (nome, tier, custo, resumo da descrição). " +
        "Use antes de propor Skills novas, pra não duplicar nomes/conceitos já usados.",
      parameters: {
        type: "object",
        properties: {
          tierFilter: { type: "string", description: "Filtra por tier (ex: \"normal\"). Opcional." },
          limit: { type: "number", description: "Máximo de resultados (padrão 30)." }
        }
      },
      handler: async ({ tierFilter, limit = 30 } = {}) => {
        const pack = getCompendiumForItemType("skill");
        if (!pack) return { skills: [] };
        const index = await pack.getIndex({ fields: ["system.tier", "system.cost", "system.description"] });
        const filtered = index.filter(e => !tierFilter || e.system?.tier === tierFilter).slice(0, limit);
        return {
          skills: filtered.map(e => ({
            name: e.name,
            tier: e.system?.tier,
            cost: e.system?.cost,
            summary: (e.system?.description ?? "").replace(/<[^>]+>/g, "").slice(0, 160)
          }))
        };
      }
    },
    {
      name: "list_actors",
      description: "Lista Atores já existentes no mundo (nome, tipo, nível). Use pra não duplicar nomes de NPCs.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "Máximo de resultados (padrão 30)." } }
      },
      handler: async ({ limit = 30 } = {}) => ({
        actors: game.actors
          .contents.slice(0, limit)
          .map(a => ({ name: a.name, type: a.type, level: a.system?.attributes?.level ?? null }))
      })
    },
    {
      name: "get_system_rules",
      description:
        "Devolve as regras/constantes do sistema (tiers de Skill, alvos de efeito, elementos de dano " +
        "disponíveis) — use pra gerar dados coerentes com o schema real antes de propor Skills/Personagens.",
      parameters: { type: "object", properties: {} },
      handler: async () => ({
        skillTiers: MEU_SISTEMA.SKILL_TIERS,
        skillTierLabels: MEU_SISTEMA.SKILL_TIER_LABELS,
        skillEffectTypes: MEU_SISTEMA.SKILL_EFFECT_TYPES,
        effectTargets: MEU_SISTEMA.EFFECT_TARGETS,
        combatAttributes: MEU_SISTEMA.COMBAT_ATTRIBUTES,
        damageElements: getActiveDamageElements().map(e => e.id)
      })
    },
    {
      name: "propose_skill",
      description:
        "Propõe a criação de uma nova Skill avulsa (não fica pronta até o Mestre revisar e aplicar). " +
        "Campos: name, tier, level, cost, description (HTML curto), effectType, damageFormula, " +
        "isMagicDamage, damageElements (array de ids), subSkills.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          tier: { type: "string" },
          level: { type: "number" },
          cost: { type: "number" },
          description: { type: "string" },
          effectType: { type: "string" },
          damageFormula: { type: "string" },
          isMagicDamage: { type: "boolean" },
          damageElements: { type: "array", items: { type: "string" } }
        },
        required: ["name"]
      },
      handler: async data => {
        const itemData = {
          name: data?.name || "Habilidade Sem Nome",
          type: "skill",
          system: {
            tier: MEU_SISTEMA.SKILL_TIERS.includes(data?.tier) ? data.tier : "normal",
            level: Number(data?.level) || 1,
            cost: Number(data?.cost) || 0,
            description: data?.description || "",
            effectType: MEU_SISTEMA.SKILL_EFFECT_TYPES.includes(data?.effectType) ? data.effectType : "none",
            damageFormula: data?.damageFormula || "",
            isMagicDamage: Boolean(data?.isMagicDamage),
            damageElements: Array.isArray(data?.damageElements) ? data.damageElements : [],
            subSkills: Array.isArray(data?.subSkills)
              ? data.subSkills.map(s => ({ name: s?.name ?? "", description: s?.description ?? "" }))
              : [],
            fusionSources: [],
            isFused: false
          }
        };
        proposals.push({ type: "skill", data: itemData });
        return { ok: true, proposed: itemData.name };
      }
    },
    {
      name: "propose_character",
      description:
        "Propõe a criação de um novo Personagem/NPC (não fica pronto até o Mestre revisar e aplicar). " +
        "Campos: name, species, level, hp, energy, biography (HTML curto), personalityTraits.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          species: { type: "string" },
          level: { type: "number" },
          hp: { type: "number" },
          energy: { type: "number" },
          biography: { type: "string" },
          personalityTraits: { type: "string" }
        },
        required: ["name"]
      },
      handler: async data => {
        const hp = Number(data?.hp) || 10;
        const energy = Number(data?.energy) || 0;
        const actorData = {
          name: data?.name || "NPC Sem Nome",
          type: "character",
          system: {
            species: data?.species || "humano",
            isPlayerCharacter: false,
            attributes: {
              level: Number(data?.level) || 1,
              hp: { value: hp, max: hp },
              energy: { value: energy, max: energy }
            },
            biography: data?.biography || "",
            personality: { traits: data?.personalityTraits || "", desires: "", emotionalState: "" }
          }
        };
        proposals.push({ type: "character", data: actorData });
        return { ok: true, proposed: actorData.name };
      }
    },
    {
      name: "propose_edit",
      description:
        "Propõe uma edição num Ator/Item já existente (não é aplicada até o Mestre revisar). " +
        "`patch` só pode conter name/img/system.* (mesma regra do modo 'Editar Existente').",
      parameters: {
        type: "object",
        properties: {
          uuid: { type: "string", description: "UUID do documento (Actor.xxx ou Item.xxx)." },
          patch: { type: "object", description: "Campos a mudar, ex: {\"system.attributes.level\": 5}." }
        },
        required: ["uuid", "patch"]
      },
      handler: async ({ uuid, patch }) => {
        const doc = await fromUuid(uuid);
        if (!doc) return { error: `Documento não encontrado: ${uuid}` };
        const clean = sanitizeDocumentPatch(patch);
        if (!Object.keys(clean).length) return { error: "Patch vazio ou só com campos não permitidos." };
        proposals.push({ type: "edit", data: { uuid, name: doc.name, patch: clean } });
        return { ok: true, proposed: doc.name };
      }
    }
  ];

  return { tools, proposals };
}
