/**
 * Ponte entre os Modificadores Condicionais (regra pura em conditional-modifiers.js) e os
 * documentos: junta as regras ativas de um Ator e monta o contexto do momento.
 *
 * Fontes ativas:
 *  - Título: sempre;
 *  - Item Geral: só equipado (mesma regra de bônus de atributo e Habilidade Concedida);
 *  - Skill: sempre; numa Habilidade Ativa cada regra vale ligada (o padrão), desligada ou sempre
 *    (`activeState`, item 8c.1).
 */
import { SYSTEM_ID, actorTraits, combatantIsActor, getActiveStatusConditions } from "../core/config.js";
import { sourceSuppressed, suppressionState } from "../core/suppression.js";
import { sumConditionalModifiers, ruleActiveStateAllows } from "./conditional-modifiers.js";
import { originConditionalSources } from "../species/species-rules.js";
import { conditionIdsPostedBy } from "../skills/marks-rules.js";
import { worldClockContext } from "../core/world-clock.js";

/** Todas as regras das fontes ativas do Ator. */
export function collectConditionalModifiers(actor) {
  return conditionalModifierSources(actor).flatMap(source => source.mods);
}

/** As mesmas regras, agrupadas pelo Item de onde vieram (a janela "De onde vem" mostra a fonte). */
export function conditionalModifierSources(actor) {
  const sources = [];
  const suppression = suppressionState(actor);
  for (const item of actor?.items ?? []) {
    const list = item.system?.conditionalModifiers;
    if (!list?.length) continue;
    if (item.type === "item" && !item.system.equipped) continue;
    if (!["title", "item", "skill"].includes(item.type)) continue;
    // Skill Ativa: cada regra vale ligada ("on", o padrão), desligada ("off") ou sempre (item 8c.1).
    // "A cada N níveis da Skill" (1.120.0) precisa do nível da fonte: a regra com N ganha uma cópia com `sourceLevel`.
    const mods = item.type === "skill"
      ? list
        .filter(mod => ruleActiveStateAllows(mod.activeState, { hasUpkeep: item.system.hasUpkeep, active: item.system.active }))
        .map(mod => (Number(mod.perLevels) > 0 ? { ...mod, sourceLevel: Number(item.system.level) || 1 } : mod))
      : list;
    if (!mods.length) continue;
    // Antimagia: Skill/Item mágico suprimido não conta.
    if (sourceSuppressed(actor, item, null, suppression)) continue;
    sources.push({ item, mods });
  }
  // "Quando → Então" da Espécie/Linhagem/Heranças (passivos ao vivo).
  sources.push(...originConditionalSources(actor?.system?.originLayers ?? []));
  return sources;
}

/** Ids das Condições (statuses + as do sistema) ativas num Ator. */
function conditionIds(actor) {
  const ids = new Set();
  for (const effect of actor?.effects ?? []) {
    if (effect.disabled) continue;
    for (const status of effect.statuses ?? []) ids.add(status);
    const id = effect.flags?.[SYSTEM_ID]?.conditionId;
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Ids das Condições de `actor` que foram postas por `byUuid` (flag `appliedBy` do efeito, item 8c.1):
 * a base do "o alvo tem a Condição posta por mim". Vazio sem `byUuid`.
 */
function conditionIdsBy(actor, byUuid) {
  return conditionIdsPostedBy(actor?.effects, byUuid, SYSTEM_ID);
}

/** Só os ids que o catálogo de Condições marca como "É uma marca" (`isMark`). */
function markIdsOf(ids) {
  const marks = new Set(getActiveStatusConditions().filter(c => c.isMark).map(c => c.id));
  return new Set([...ids].filter(id => marks.has(id)));
}

/** O Ator está num combate iniciado? */
export function isInCombat(actor) {
  if (!actor) return false;
  for (const combat of game.combats ?? []) {
    if (combat.started && combat.combatants.some(c => combatantIsActor(c, actor))) return true;
  }
  return false;
}

/**
 * Contexto de um momento: quem tem a regra (`self`), o outro lado (`other`) e os elementos do
 * golpe. `hpPercent` pode ser passado pronto (a preparação da ficha já tem o valor em mãos).
 */
export function buildModifierContext(self, other = null, { elements = [], hpPercent = null } = {}) {
  const hp = self?.system?.attributes?.hp;
  const selfHpPercent = hpPercent ?? (hp?.max > 0 ? (hp.value / hp.max) * 100 : NaN);
  const otherHp = other?.system?.attributes?.hp;
  return {
    selfHpPercent,
    otherHpPercent: otherHp?.max > 0 ? (otherHp.value / otherHp.max) * 100 : NaN,
    selfConditions: conditionIds(self),
    inCombat: isInCombat(self),
    ...worldClockContext(self),
    otherTraits: new Set(other ? actorTraits(other) : []),
    otherIsShip: ["starship", "vehicle"].includes(other?.type),
    otherConditions: conditionIds(other),
    otherConditionsMine: conditionIdsBy(other, self?.uuid),
    // Marcas (8c.1): Condições do catálogo marcadas "É uma marca" que o alvo tem (qualquer uma / postas por mim).
    otherMarks: markIdsOf(conditionIds(other)),
    otherMarksMine: markIdsOf(conditionIdsBy(other, self?.uuid)),
    elements: new Set(elements ?? [])
  };
}

/** Atalho: soma de um tipo de "Então" para `self` contra `other`. */
export function conditionalBonus(self, other, thenKind, { elements = [], attribute, element } = {}) {
  const mods = collectConditionalModifiers(self);
  if (!mods.length) return 0;
  return sumConditionalModifiers(mods, thenKind, buildModifierContext(self, other, { elements }), { attribute, element });
}

/**
 * "Estou em combate" é lido na preparação da ficha, mas começar ou encerrar um combate não
 * reprepara os Atores sozinho. Estes hooks repreparam quem está no combate e redesenham a ficha.
 * Chamado uma vez, no `init`.
 */
export function registerConditionalRefresh() {
  const refresh = combat => {
    for (const combatant of combat?.combatants ?? []) {
      const actor = combatant.actor;
      if (!actor) continue;
      // reset(), não prepareData(): este reaplicava os Active Effects por cima do já preparado e
      // cada buff que soma (Força +1) somava de novo a cada início/fim de combate.
      actor.reset();
      if (actor.sheet?.rendered) actor.sheet.render();
    }
  };
  // `combatStart` dispara ANTES de o combate ficar "iniciado"; a mudança de rodada (0 → 1) já
  // chega com ele iniciado.
  Hooks.on("updateCombat", (combat, changes) => {
    if ("round" in changes && combat.round <= 1) refresh(combat);
  });
  Hooks.on("deleteCombat", refresh);
  Hooks.on("createCombatant", combatant => refresh({ combatants: [combatant] }));
  Hooks.on("deleteCombatant", combatant => refresh({ combatants: [combatant] }));
}
