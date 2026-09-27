/**
 * Snapshot de Skill(s) em Sub-Skill(s) — extraído de ai-helper.js (Fase 4 do refactor) porque é
 * usado tanto por skill-economy.js (Fusão manual) quanto por ai-generation.js (Skill Única/
 * Ultimate gerada por IA), e nenhum dos dois devia depender do outro só por causa desta função
 * pura (evita import circular entre eles).
 */

/**
 * Constrói a lista de Sub-Skills de uma nova Skill Fundida a partir das fontes consumidas —
 * sempre achatada (nunca aninhada): se uma fonte já era ela mesma uma Fusão (tinha suas
 * próprias Sub-Skills), entram só OS COMPONENTES DELA, não a fonte em si; senão, a própria
 * fonte vira um snapshot congelado do estado mecânico dela nesse momento (ver `subSkillSchema`
 * em data/item-models.js — mesmos campos, editar aqui depois não muda a Skill original).
 * @param {Item[]} sources
 * @returns {object[]}
 */
export function buildSubSkillsFromSources(sources) {
  return sources.flatMap(source => {
    if ((source.system.subSkills ?? []).length) {
      return source.system.subSkills.map(sub => foundry.utils.deepClone(sub));
    }
    return [
      {
        name: source.name,
        tier: source.system.tier,
        level: source.system.level,
        cost: source.system.cost,
        hasUpkeep: source.system.hasUpkeep,
        upkeepCost: source.system.upkeepCost,
        animationPath: source.system.animationPath,
        description: source.system.description,
        resistanceTarget: source.system.resistanceTarget,
        effectType: source.system.effectType,
        damageFormula: source.system.damageFormula,
        scalingAttribute: source.system.scalingAttribute,
        isMagicDamage: source.system.isMagicDamage,
        isAbsoluteDamage: source.system.isAbsoluteDamage,
        damageScale: source.system.damageScale,
        damageElements: foundry.utils.deepClone(source.system.damageElements ?? []),
        effects: foundry.utils.deepClone(source.system.effects ?? []),
        targetType: source.system.targetType,
        structureId: source.system.structureId,
        areaShape: source.system.areaShape,
        areaDistance: source.system.areaDistance,
        areaAngle: source.system.areaAngle,
        zoneRounds: source.system.zoneRounds
      }
    ];
  });
}

/** Campos mecânicos copiados de uma Habilidade Concedida pra Skill criada na ficha. */
const GRANTED_MECHANIC_FIELDS = [
  "level", "cost", "hasUpkeep", "upkeepCost", "animationPath", "description", "resistanceTarget",
  "effectType", "damageFormula", "scalingAttribute", "isMagicDamage", "isAbsoluteDamage", "damageScale", "damageElements", "effects",
  "targetType", "structureId", "areaShape", "areaDistance", "areaAngle", "zoneRounds", "subSkills"
];

/**
 * Dados da Skill que uma Habilidade Concedida (`grantsSkill` de Item Geral, Modificação ou
 * Módulo) cria no Ator: a mecânica inteira copiada, `active` sempre começando desligado e a
 * marca `isItemGranted`. Pura — `createGrantedSkill` em skill-economy.js só a grava.
 * @param {object} grantsSkill
 * @param {string[]} grantableTiers - MEU_SISTEMA.ITEM_GRANTABLE_SKILL_TIERS
 * @returns {object|null} `{name, type, system}`, ou null sem nome
 */
export function buildGrantedSkillData(grantsSkill, grantableTiers) {
  const name = grantsSkill?.name?.trim();
  if (!name) return null;

  const system = { tier: grantableTiers.includes(grantsSkill.tier) ? grantsSkill.tier : "normal" };
  for (const field of GRANTED_MECHANIC_FIELDS) {
    if (grantsSkill[field] !== undefined) system[field] = foundry.utils.deepClone(grantsSkill[field]);
  }
  system.level = Math.max(1, Number(system.level) || 1);
  system.cost = Number(system.cost) || 0;
  system.description = system.description || "";
  system.active = false;
  system.isItemGranted = true;
  // Sub-Skills nunca começam ligadas, mesmo que o molde tenha sido salvo com uma ativa.
  if (Array.isArray(system.subSkills)) system.subSkills = system.subSkills.map(sub => ({ ...sub, active: false }));

  return { name, type: "skill", system };
}
