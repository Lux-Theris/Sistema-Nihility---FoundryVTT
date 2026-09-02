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
        isMagicDamage: source.system.isMagicDamage,
        damageElements: foundry.utils.deepClone(source.system.damageElements ?? []),
        effects: foundry.utils.deepClone(source.system.effects ?? []),
        targetType: source.system.targetType,
        areaShape: source.system.areaShape,
        areaDistance: source.system.areaDistance,
        areaAngle: source.system.areaAngle
      }
    ];
  });
}
