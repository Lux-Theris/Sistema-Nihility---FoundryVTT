/**
 * Modelos de Skill (backlog L7) — a parte pura: normalizar uma entrada do catálogo e transformar
 * um modelo nos dados de uma Skill nova, trocando o que o mundo não tem (elemento, Condição,
 * Estrutura) por algo que existe. Testado em test/skill-assist.test.mjs.
 */
import { archetypeSlug, archetypeStatus, missingDefaultArchetypes } from "../npc/npc-generator-rules.js";

export const TEMPLATE_GROUPS = ["dano", "ajuda", "controle"];

/** Entrada do catálogo com os campos certos. */
export function normalizeSkillTemplate(entry) {
  const e = entry ?? {};
  const skill = { ...(e.skill ?? {}) };
  delete skill.key;
  delete skill.always;
  const label = String(e.label || skill.name || "Modelo");
  return {
    id: archetypeSlug(e.id || label) || "modelo",
    label,
    hint: String(e.hint ?? ""),
    group: TEMPLATE_GROUPS.includes(e.group) ? e.group : "dano",
    skill
  };
}

/** Padrão / editado / do Mestre (mesma regra dos Arquétipos). */
export const templateStatus = archetypeStatus;
/** "Trazer do padrão…": os modelos de fábrica que faltam. */
export const missingDefaultTemplates = missingDefaultArchetypes;

/**
 * Dados de uma Skill nova a partir do modelo: o nome e o Tier de quem cria valem por cima; id
 * de elemento/Condição que o mundo não tem sai; Estrutura que não existe vira a primeira do
 * catálogo (ou nenhuma).
 * @param {object} template - normalizado
 * @param {{name?: string, tier?: string}} overrides
 * @param {{elements?: string[], conditions?: string[], structures?: string[]}} [catalogs]
 */
export function templateSkillData(template, overrides = {}, catalogs = {}) {
  const skill = structuredClone(template?.skill ?? {});
  const known = (list, id) => !Array.isArray(list) || list.includes(id);
  if (Array.isArray(skill.damageElements)) skill.damageElements = skill.damageElements.filter(id => known(catalogs.elements, id));
  if (Array.isArray(skill.effects)) {
    skill.effects = skill.effects.map(e => ({
      ...e,
      conditionId: e.conditionId && known(catalogs.conditions, e.conditionId) ? e.conditionId : "",
      damageElements: (e.damageElements ?? []).filter(id => known(catalogs.elements, id))
    }));
  }
  if (skill.effectType === "structure" && Array.isArray(catalogs.structures) && !catalogs.structures.includes(skill.structureId)) {
    skill.structureId = catalogs.structures[0] ?? "";
  }
  return {
    ...skill,
    name: overrides.name || skill.name || template?.label || "Nova Habilidade",
    tier: overrides.tier || skill.tier || "normal",
    level: 1
  };
}

/** Uma Skill pronta → entrada de modelo ("Salvar como modelo"). */
export function templateFromSkill(name, system, existingIds = []) {
  const { xp, active, investRatio, isItemGranted, fusionSources, evolvedFrom, subSkills, xpMax, xpReady, xpPercent, ...skill } = structuredClone(system ?? {});
  let id = archetypeSlug(name) || "modelo";
  for (let n = 2; existingIds.includes(id); n++) id = `${archetypeSlug(name) || "modelo"}_${n}`;
  return normalizeSkillTemplate({ id, label: name, hint: "", group: skill.effectType === "damage" ? "dano" : skill.effectType === "structure" ? "controle" : "ajuda", skill: { ...skill, level: 1 } });
}
