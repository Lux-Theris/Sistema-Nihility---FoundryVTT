/**
 * Ponte entre os Modificadores Condicionais (regra pura em conditional-modifiers.js) e os
 * documentos: junta as regras ativas de um Ator e monta o contexto do momento.
 *
 * Fontes ativas:
 *  - Título: sempre;
 *  - Item Geral: só equipado (mesma regra de bônus de atributo e Habilidade Concedida);
 *  - Skill: sempre, a menos que seja Habilidade Ativa — aí só enquanto ligada.
 */
import { SYSTEM_ID, actorTraits, combatantIsActor } from "./config.js";
import { sumConditionalModifiers } from "./conditional-modifiers.js";

/** Todas as regras das fontes ativas do Ator. */
export function collectConditionalModifiers(actor) {
  const mods = [];
  for (const item of actor?.items ?? []) {
    const list = item.system?.conditionalModifiers;
    if (!list?.length) continue;
    if (item.type === "item" && !item.system.equipped) continue;
    if (item.type === "skill" && item.system.hasUpkeep && !item.system.active) continue;
    if (!["title", "item", "skill"].includes(item.type)) continue;
    mods.push(...list);
  }
  return mods;
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
  return {
    selfHpPercent,
    selfConditions: conditionIds(self),
    inCombat: isInCombat(self),
    otherTraits: new Set(other ? actorTraits(other) : []),
    otherIsShip: ["starship", "vehicle"].includes(other?.type),
    otherConditions: conditionIds(other),
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
      actor.prepareData();
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
