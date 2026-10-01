/**
 * Alvos de Efeito: para onde cada alvo (Força, Vida, Dano das armas, Escudo da Nave…) aponta no Ator, por tipo de Ator.
 * (Separado de skill-effects.js na reorganização de pastas — mesma lógica de antes.)
 */
import { getEffectTargetLabels } from "../core/config.js";
import { effectModes } from "../helpers/foundry-compat.js";
import { isShipLike, shipWeaponPenetration } from "../starship/ship-damage.js";

const EFFECT_TARGET_PATHS = {
  strength: "system.attributes.combat.strength.buffDelta",
  defense: "system.attributes.combat.defense.buffDelta",
  magic: "system.attributes.combat.magic.buffDelta",
  magicalDefense: "system.attributes.combat.magicalDefense.buffDelta",
  dexterity: "system.attributes.combat.dexterity.buffDelta",
  stealth: "system.attributes.combat.stealth.buffDelta",
  perception: "system.attributes.combat.perception.buffDelta",
  precision: "system.attributes.combat.precision.buffDelta",
  hp: "system.attributes.hp.buffDelta",
  energy: "system.attributes.energy.buffDelta",
  movement: "system.attributes.movementPercent"
};

/**
 * Os dois EFFECT_TARGETS "de Nave" (Dano/Penetração de arma) guardam Fixo e Multiplicador em
 * campos SEPARADOS (StarshipDataModel.combatBonuses) — o campo real depende de `modifierType`,
 * por isso não cabem no mapa simples de EFFECT_TARGET_PATHS acima.
 */
const SHIP_TARGET_PATHS = {
  shipWeaponDamage: { flat: "system.combatBonuses.weaponDamageFlat", multiplier: "system.combatBonuses.weaponDamageMultiplier" },
  shipWeaponPenetration: { flat: "system.combatBonuses.weaponPenetrationFlat", multiplier: "system.combatBonuses.weaponPenetrationMultiplier" }
};

/** Caminho real de update pra uma entrada de `effects[]`, considerando `modifierType` pros alvos "de Nave". */
function resolveEffectTargetPath(entry) {
  const shipPaths = SHIP_TARGET_PATHS[entry.target];
  if (shipPaths) return shipPaths[entry.modifierType === "multiplier" ? "multiplier" : "flat"];
  return EFFECT_TARGET_PATHS[entry.target];
}

/** Campos das melhorias de Nave em % somado (ver `combatBonuses` em starship-model.js). */
export const SHIP_PERCENT_PATHS = {
  shipShieldCapacity: "system.combatBonuses.shieldCapacityPercent",
  shipShieldRegen: "system.combatBonuses.shieldRegenPercent",
  shipReactorOutput: "system.combatBonuses.reactorOutputPercent",
  shipPropulsion: "system.combatBonuses.propulsionPercent"
};

/**
 * A mudança de Active Effect que uma entrada de Efeito faz NESTE alvo: campo, modo e valor.
 * O mesmo alvo pode cair em campos diferentes conforme o tipo de Ator ("Dano das Armas" é
 * `weaponBonuses` num Personagem e `combatBonuses` numa Nave). Devolve `null` quando o alvo não
 * faz sentido nesse tipo de Ator — quem chama avisa, em vez de gravar um efeito que não faz nada.
 * @returns {{key:string, mode:number, value:string, isMultiplier:boolean}|null}
 */
export function resolveEffectChange(entry, targetActor) {
  const M = effectModes();
  const ship = isShipLike(targetActor);
  const amount = Number(entry.amount) || 0;
  const multiplier = entry.modifierType === "multiplier";
  // MULTIPLY multiplica o valor ATUAL do campo — `amount` é percentual (20 = +20%), por isso vira
  // fator 1.20, não 20 cru (que zeraria o campo, cuja base é 1).
  const numeric = key =>
    multiplier ? { key, mode: M.MULTIPLY, value: String(1 + amount / 100), isMultiplier: true } : { key, mode: M.ADD, value: String(amount), isMultiplier: false };

  switch (entry.target) {
    case "weaponDamage":
      return ship
        ? numeric(multiplier ? "system.combatBonuses.weaponDamageMultiplier" : "system.combatBonuses.weaponDamageFlat")
        : numeric(multiplier ? "system.weaponBonuses.damageMultiplier" : "system.weaponBonuses.damageFlat");
    case "weaponElement":
      if (!entry.elementId) return null;
      return {
        key: ship ? "system.combatBonuses.weaponElementOverride" : "system.weaponBonuses.elementOverride",
        mode: M.OVERRIDE,
        value: entry.elementId,
        isMultiplier: false
      };
    case "weaponMagic":
      // Nave não tem Defesa Mágica envolvida nas próprias armas — só faz sentido em Personagem.
      return ship ? null : { key: "system.weaponBonuses.forceMagic", mode: M.ADD, value: "1", isMultiplier: false };
    case "weaponAbsolute":
      return { key: ship ? "system.combatBonuses.weaponAbsolute" : "system.weaponBonuses.absolute", mode: M.ADD, value: "1", isMultiplier: false };
    case "bodyElement":
      // Não mexe em campo: o efeito só carrega o flag `bodyElement`, lido por actorElements.
      return entry.elementId ? { key: null, bodyElement: entry.elementId, isMultiplier: false } : null;
  }

  if (SHIP_PERCENT_PATHS[entry.target]) {
    return ship ? { key: SHIP_PERCENT_PATHS[entry.target], mode: M.ADD, value: String(amount), isMultiplier: false } : null;
  }
  if (SHIP_TARGET_PATHS[entry.target]) {
    return ship ? numeric(resolveEffectTargetPath(entry)) : null;
  }
  const path = EFFECT_TARGET_PATHS[entry.target];
  // Atributos, Vida/Mana e Deslocamento só existem em Personagem/Criatura.
  return path && !ship ? { key: path, mode: M.ADD, value: String(amount), isMultiplier: false } : null;
}

/**
 * Nome, em palavras, do campo que uma mudança de Active Effect mexe ("Força", "Dano das armas",
 * "Escudo da Nave %"…), pra janela de Efeitos. Campo desconhecido volta como está.
 */
export function describeEffectChangeKey(key) {
  const labels = getEffectTargetLabels();
  for (const [target, path] of Object.entries(EFFECT_TARGET_PATHS)) if (path === key) return labels[target] ?? target;
  for (const [target, path] of Object.entries(SHIP_PERCENT_PATHS)) if (path === key) return labels[target] ?? target;
  for (const [target, paths] of Object.entries(SHIP_TARGET_PATHS)) if (Object.values(paths).includes(key)) return labels[target] ?? target;
  const weapon = {
    damageFlat: "Dano das armas",
    damageMultiplier: "Dano das armas",
    weaponDamageFlat: "Dano das armas",
    weaponDamageMultiplier: "Dano das armas",
    elementOverride: "Elemento das armas",
    weaponElementOverride: "Elemento das armas",
    forceMagic: "Armas causam dano Mágico",
    absolute: "Armas causam Dano Absoluto",
    weaponAbsolute: "Armas causam Dano Absoluto"
  };
  return weapon[String(key).split(".").pop()] ?? key;
}
