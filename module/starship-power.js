import { MEU_SISTEMA } from "./config.js";

/**
 * Categorias sem throttle próprio (Bateria/Distribuidor não têm `powerAllocationPercent` na UI)
 * nunca sofrem dano por sobrecarga; Arma tem regra própria (sobrecarregar aumenta a Recarga em
 * vez de danificar o Módulo, ver Fase 5) — também fica de fora do tick de sobrecarga comum.
 */
const OVERLOAD_EXEMPT_CATEGORIES = ["battery", "distributor", "weapon"];

/** Limiar de `powerAllocationPercent` (%) a partir do qual a categoria sofre dano por sobrecarga. */
function overloadThreshold(category) {
  if (category === "reactor") return MEU_SISTEMA.OVERLOAD_THRESHOLD_REACTOR;
  if (category === "shield") return MEU_SISTEMA.OVERLOAD_THRESHOLD_SHIELD;
  return MEU_SISTEMA.OVERLOAD_THRESHOLD_DEFAULT;
}

/**
 * Calcula o patch de update de UM Módulo pro tick por rodada (Overhaul de Naves, Fase 3):
 * decrementa Carga de Salto FTL, aplica dano por sobrecarga (magnitude ainda 0 — ver
 * MEU_SISTEMA.OVERLOAD_DAMAGE_PERCENT_OF_MAX_PER_ROUND, pendente de balanceamento na Fase 8) e
 * desliga sozinho qualquer Módulo cuja Vida chegue a 0. `null` se nada mudou.
 */
function computeModuleTickPatch(module) {
  const sys = module.system;
  const patch = {};

  // Carga de Salto (sub-tipo FTL "jump") decrementa por rodada — mesmo padrão de
  // cooldownRemaining de Arma, até chegar a 0.
  if (sys.category === "ftl" && sys.ftlType === "jump" && sys.chargeRemaining > 0) {
    patch["system.chargeRemaining"] = Math.max(0, sys.chargeRemaining - 1);
  }

  // Recarga de Arma (Fase 5) decrementa por rodada — mesmo padrão da Carga de Salto acima.
  if (sys.category === "weapon" && sys.cooldownRemaining > 0) {
    patch["system.cooldownRemaining"] = Math.max(0, sys.cooldownRemaining - 1);
  }

  let hpValue = sys.hp.value;
  if (sys.status === "online" && !OVERLOAD_EXEMPT_CATEGORIES.includes(sys.category)) {
    const threshold = overloadThreshold(sys.category);
    const excess = sys.powerAllocationPercent - threshold;
    if (excess > 0) {
      const damage = Math.round((excess / 100) * sys.hp.max * MEU_SISTEMA.OVERLOAD_DAMAGE_PERCENT_OF_MAX_PER_ROUND);
      if (damage > 0) {
        hpValue = Math.max(0, hpValue - damage);
        patch["system.hp.value"] = hpValue;
      }
    }
  }

  // Vida zerada desliga o Módulo sozinho, seja lá qual for a causa (sobrecarga aqui, dano de
  // combate, ajuste manual do Mestre...) — só religa depois de reparado a 15%+ (ver
  // moduleCanRestart, checado no toggle manual em starship-sheet.js).
  if (hpValue <= 0 && sys.status === "online") {
    patch["system.status"] = "offline";
  }

  return Object.keys(patch).length ? patch : null;
}

/**
 * Regen/Recarga do Escudo por rodada (campos no Ator, não no Módulo): enquanto
 * `rechargeRemaining > 0` (setado pela cascata de dano quando o Escudo zera, ver
 * `applyStarshipDamageCascade` em skill-effects.js) só decrementa, sem regenerar — 0% de
 * proteção durante a Recarga. Ao chegar a 0, volta a regenerar `shields.regenRate` por rodada
 * até o máximo. Só tica se houver um Módulo de Escudo instalado E "online" — um Escudo
 * desligado (manual ou por Vida zerada) não regenera nem recarrega sozinho.
 */
function computeShieldTickPatch(actor) {
  const shieldModule = actor.system.shieldModule;
  if (!shieldModule || shieldModule.system.status !== "online") return null;

  const shields = actor.system.shields;
  const patch = {};
  if (shields.rechargeRemaining > 0) {
    patch["system.shields.rechargeRemaining"] = shields.rechargeRemaining - 1;
  } else if (shields.value < shields.max) {
    patch["system.shields.value"] = Math.min(shields.max, shields.value + shields.regenRate);
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * Tica uma Nave/Veículo por rodada: sobrecarga de Módulo, Carga de Salto FTL, desligamento por
 * Vida zerada e Regen/Recarga do Escudo. Chamado do mesmo hook `updateCombat` que já tica
 * Veneno/Habilidade Ativa de Personagem — GM-only, uma vez por turno do combatente dono do Ator.
 */
export async function tickStarshipPower(actor) {
  const itemUpdates = [];
  for (const module of actor.system.modules) {
    const patch = computeModuleTickPatch(module);
    if (patch) itemUpdates.push({ _id: module.id, ...patch });
  }
  if (itemUpdates.length) await actor.updateEmbeddedDocuments("Item", itemUpdates);

  const shieldPatch = computeShieldTickPatch(actor);
  if (shieldPatch) await actor.update(shieldPatch);
}

/** Um Módulo desligado por Vida zerada só pode ser religado a partir de MODULE_RESTART_HP_THRESHOLD_PERCENT de Vida Máxima. */
export function moduleCanRestart(module) {
  if (!module.system.hp.max) return true;
  const percent = (module.system.hp.value / module.system.hp.max) * 100;
  return percent >= MEU_SISTEMA.MODULE_RESTART_HP_THRESHOLD_PERCENT;
}
