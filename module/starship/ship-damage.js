/**
 * Dano em Nave/Veículo: cascata Escudo → Casco → Integridade, armas de Nave, munição e efeitos de Nave que agem na hora.
 * (Separado de skill-effects.js na reorganização de pastas — mesma lógica de antes.)
 */
import { SYSTEM_ID, getDamageElement, getShipTargetingConfig, moduleCategoryLabel, ammoFitsLauncher, actorElements, getElementAffinityMatrix, getAffinityConfig } from "../core/config.js";
import { damageApplyFlags, withDamageTrace } from "../combat/damage-apply.js";
import { applyStructuralDamage, applyTargetedStructuralDamage, damageCasco, repairModules, applyShipSystemEffect, addShipSystemEffect, clearShieldAdaptation } from "./starship-power.js";
import { applyAdvantageToFormula, applyRollModifiers, normalizeRollOptions } from "../core/roll-modifiers.js";
import { rollChance, resolveShipCascade, adaptShield, hitAffinityFactor } from "../combat/damage-rules.js";
import { attackTraceRows, applyDamageReductions, averageElementContext, damageScaleFor, situationalDamageFactor, applyTriggeredConditions, triggeredLabel, formatScale, modifiersFlavor, throughStructures } from "../combat/damage-roll.js";
import { grantResistanceXp, registerResistanceExposure } from "../combat/resistance.js";

/** Nave OU Veículo — os dois compartilham o mesmo `ShipSystemsDataModel` desde o overhaul de Porte. */
export function isShipLike(actor) {
  return ["starship", "vehicle"].includes(actor?.type);
}

/**
 * Bônus de arma de uma Nave/Veículo atacante (`combatBonuses`, dado por Skills de "Efeito
 * Temporário" com alvo shipWeaponDamage — ver EFFECT_TARGETS em config.js): Multiplicador
 * primeiro, Flat depois, igual a ordem de operações padrão. `rawTotal` sem mudança se quem
 * atacou não for Nave/Veículo.
 */
export function applyShipWeaponBonus(rawTotal, sourceActor) {
  if (!isShipLike(sourceActor)) return rawTotal;
  const bonuses = sourceActor.system.combatBonuses;
  return rawTotal * (bonuses?.weaponDamageMultiplier ?? 1) + (bonuses?.weaponDamageFlat ?? 0);
}

/**
 * Penetração (0-1) da arma de uma Nave/Veículo atacante: `base` vem do `penetration` (%) da
 * própria Módulo disparada (já escalado por throttle/fome de energia via `effectiveModuleStat`
 * — Fase 5), 0 se o dano veio de uma Skill genérica sem Módulo associado (Skills de
 * aprimoramento continuam empilhando por cima via `combatBonuses`, igual antes). `0` se quem
 * atacou não for Nave/Veículo.
 */
export function shipWeaponPenetration(sourceActor, weaponModule = null) {
  if (!isShipLike(sourceActor)) return 0;
  const bonuses = sourceActor.system.combatBonuses;
  const base = weaponModule ? sourceActor.system.effectiveModuleStat(weaponModule, "penetration") / 100 : 0;
  return Math.clamp(base * (bonuses?.weaponPenetrationMultiplier ?? 1) + (bonuses?.weaponPenetrationFlat ?? 0) / 100, 0, 1);
}

export async function applyStarshipDamageCascade(rawDamage, sourceActor, targetActor, weaponModule = null, extras = {}) {
  const sys = targetActor.system;
  const evasion = sys.evasion ?? 0;
  const layers = extras.layers ?? {};
  // "Mirar num sistema": quem ataca escolhe um Módulo do alvo (ou nenhum). Área não pergunta.
  const targetModuleId = extras.targetModuleId ?? (extras.askModule ? await promptTargetModule(targetActor) : null);
  const penetration = Math.min(1, shipWeaponPenetration(sourceActor, weaponModule) + (extras.penetration || 0));
  const cascoValue = sys.casco.value;
  const armorReduction = cascoValue > 0 ? sys.armorReductionPercent ?? 0 : 0;
  const damageReduction = sys.incomingDamageReduction ?? 0;
  // Escudo adaptativo: frequência das armas de quem atacou (muda com "Modular frequência").
  const frequency = Number(sourceActor?.getFlag?.(SYSTEM_ID, "weaponFrequency")) || 0;
  const elementIds = extras.elementIds ?? [];
  const adaptation = sys.shieldAdaptationAgainst?.(elementIds, frequency) ?? 0;
  // Vantagem entre elementos: contra o elemento dos Escudos ligados e contra o do corpo da Nave.
  const matrix = getElementAffinityMatrix();
  const affinityConfig = getAffinityConfig();
  const shieldAffinity = hitAffinityFactor(elementIds, sys.shieldElements ?? [], matrix, affinityConfig);
  const bodyAffinity = hitAffinityFactor(elementIds, actorElements(targetActor), matrix, affinityConfig);

  // A conta inteira é pura e testada (resolveShipCascade em damage-rules.js); aqui só se grava.
  const { toShield, toCasco, toHull, adapted } = resolveShipCascade({
    damage: rawDamage,
    evasion,
    damageReduction,
    absolute: Boolean(extras.absolute),
    bonus: extras.bonus,
    penetration,
    shield: {
      value: sys.shields.value,
      penResist: sys.shieldPenetrationResist ?? 0,
      adaptation,
      // O "Dano extra em Escudo" antigo (Táquion) entra como % de Escudo também.
      multiplier: Math.max(0, 1 + (layers.shield || 0) + (extras.shieldDrain || 0)) * shieldAffinity
    },
    casco: {
      value: cascoValue,
      reduction: armorReduction,
      penResist: sys.cascoPenetrationResist ?? 0,
      multiplier: Math.max(0, 1 + (layers.casco || 0)) * bodyAffinity
    },
    hullMultiplier: Math.max(0, 1 + (layers.hull || 0)) * bodyAffinity
  });

  const appliedReductions = [];
  if (evasion > 0) appliedReductions.push(`Evasão ${Math.round(evasion * 100)}%`);
  if (!extras.absolute) {
    if (damageReduction > 0) appliedReductions.push(`Preparar para impacto ${Math.round(damageReduction * 100)}%`);
    if (penetration > 0) appliedReductions.push(`Penetração ${Math.round(penetration * 100)}%`);
    if (armorReduction > 0) appliedReductions.push(`Redução de Casco ${Math.round(armorReduction * 100)}%`);
    if (adapted > 0) appliedReductions.push(`Escudo adaptado ${Math.round(adaptation * 100)}%`);
  }

  // Rastro só do Mestre (ver renderDamageTrace): a mesma ordem de resolveShipCascade.
  const pct = v => `${Math.round(v * 1000) / 10}%`;
  const traceRows = [];
  if (evasion > 0) traceRows.push({ label: "Evasão", value: `−${pct(Math.min(1, evasion))}` });
  if (extras.absolute) {
    traceRows.push({ label: "Dano Absoluto: direto na Integridade", value: "—" });
  } else {
    if (damageReduction > 0) traceRows.push({ label: "Preparar para impacto", value: `−${pct(Math.min(1, damageReduction))}` });
    if (extras.bonus > 0) traceRows.push({ label: "Bônus contra Traço da Nave", value: `+${pct(extras.bonus)}` });
    if (adapted > 0) traceRows.push({ label: "Escudo adaptativo", value: `−${adapted}` });
    if (penetration > 0) traceRows.push({ label: "Penetração da arma", value: pct(penetration) });
    if (sys.shieldPenetrationResist > 0) traceRows.push({ label: "Resistência à Penetração do Escudo", value: `−${pct(sys.shieldPenetrationResist)}` });
    if (shieldAffinity !== 1) traceRows.push({ label: "Vantagem contra o elemento do Escudo", value: `×${Math.round(shieldAffinity * 100) / 100}` });
    if (armorReduction > 0) traceRows.push({ label: "Redução do Casco", value: `−${pct(armorReduction)}` });
    if (sys.cascoPenetrationResist > 0 && cascoValue > 0) traceRows.push({ label: "Resistência à Penetração do Casco", value: `−${pct(sys.cascoPenetrationResist)}` });
    if (bodyAffinity !== 1) traceRows.push({ label: "Vantagem contra o elemento da Nave", value: `×${Math.round(bodyAffinity * 100) / 100}` });
    for (const [layer, label] of [["shield", "Escudo"], ["casco", "Casco"], ["hull", "Integridade"]]) {
      if (layers[layer]) traceRows.push({ label: `Dano por camada (${label})`, value: `${layers[layer] > 0 ? "+" : "−"}${pct(Math.abs(layers[layer]))}` });
    }
  }
  traceRows.push({ label: "Escudo", value: `−${toShield}` }, { label: "Casco", value: `−${toCasco}` }, { label: "Integridade Estrutural", value: `−${toHull}`, kind: "total" });

  // 1) Escudo
  if (toShield > 0) {
    const newShieldValue = Math.max(0, sys.shields.value - toShield);
    const updates = { "system.shields.value": newShieldValue };
    if (newShieldValue <= 0) {
      // Com vários Escudos, vale a Recarga mais longa entre eles.
      updates["system.shields.rechargeRemaining"] = Math.max(0, ...sys.modulesByRole("shield").map(m => m.system.shieldRechargeRounds ?? 0));
    }
    await targetActor.update(updates);
  }
  // Escudo adaptativo: caiu → perde toda a adaptação; de pé e atingido → aprende este golpe.
  if (!extras.absolute && sys.shields.value > 0) {
    if (sys.shields.value - toShield <= 0) await clearShieldAdaptation(targetActor);
    else await adaptShieldsToHit(targetActor, elementIds, frequency);
  }

  // 2) Casco — é a Vida dos Módulos de Blindagem (a mais danificada primeiro).
  if (toCasco > 0) await damageCasco(targetActor, toCasco);

  // 3) Integridade Estrutural — a Vida dos Módulos, espalhada; com um Módulo mirado, a maior
  // parte vai nele (ver applyTargetedStructuralDamage).
  let structuralHits = [];
  if (toHull > 0) {
    structuralHits = targetModuleId
      ? await applyTargetedStructuralDamage(targetActor, toHull, targetModuleId, getShipTargetingConfig().share)
      : await applyStructuralDamage(targetActor, toHull);
  }

  // Efeitos de sistema do elemento (derrubar Módulo, drenar energia, baixar resistência): só com
  // a parte do golpe que PASSOU do Escudo — Escudo de pé é a primeira defesa contra eles.
  const systemEffects = [];
  if ((toCasco + toHull) > 0) {
    for (const effect of extras.shipEffects ?? []) {
      const text = await applyShipSystemEffect(targetActor, effect, { targetModuleId, label: effect.elementLabel });
      if (text) systemEffects.push(text);
    }
  }
  // Condições do elemento (Queimadura de Plasma…) também só com o que passou do Escudo; numa Nave o
  // tick de "Vida" vira Integridade (ver applyEffectsToActor).
  if ((toCasco + toHull) > 0) {
    const triggered = (extras.conditions ?? [])
      .filter(c => rollChance(c.chance))
      .map(c => ({ conditionId: c.conditionId, hitDamage: toCasco + toHull }));
    if (triggered.length) {
      await applyTriggeredConditions(targetActor, triggered, { label: sourceActor?.name ?? "" });
      systemEffects.push(triggeredLabel(triggered).replace(/^ — /, ""));
    }
  }
  if (systemEffects.length) structuralHits.push(...systemEffects.map(text => ({ name: text, damage: null })));

  return { toShield, toCasco, toHull, structuralHits, appliedReductions, traceRows, targetModuleId };
}

/** Cada Escudo adaptativo ligado aprende o golpe (elemento + frequência), até o teto dele. */
async function adaptShieldsToHit(ship, elementIds, frequency) {
  for (const module of ship.system.modulesByRole("shield")) {
    if (!module.system.adaptive || module.system.status !== "online") continue;
    const next = adaptShield(module.getFlag(SYSTEM_ID, "shieldAdaptation"), elementIds, frequency, module.system.adaptStep, module.system.adaptCap);
    await module.setFlag(SYSTEM_ID, "shieldAdaptation", next);
  }
}

/**
 * "Mirar num sistema?" — ao atacar uma Nave com alvo único. Devolve o id do Módulo escolhido ou
 * `null` (espalhar como sempre). Desligável em Regras da Mesa; cancelar = não mirar.
 */
async function promptTargetModule(targetActor) {
  if (!getShipTargetingConfig().ask) return null;
  const modules = (targetActor.system.modules ?? []).filter(m => (m.system.hp?.value ?? 0) > 0);
  if (!modules.length) return null;
  const { DialogV2 } = foundry.applications.api;
  const options = modules
    .map(m => `<option value="${m.id}">${foundry.utils.escapeHTML?.(m.name) ?? m.name} — ${moduleCategoryLabel(m.system.category)} (${m.system.hp.value}/${m.system.hp.max})</option>`)
    .join("");
  const chosen = await DialogV2.wait({
    window: { title: `Mirar num sistema — ${targetActor.name}` },
    classes: ["nihility-target-module-dialog"],
    content: `
      <div class="nihility-target-module">
        <p>Escolha um Módulo pra concentrar o dano que passar do Escudo e do Casco, ou deixe espalhar.</p>
        <select name="targetModule"><option value="">Nenhum (espalhar)</option>${options}</select>
      </div>`,
    buttons: [
      { action: "fire", label: "Confirmar", default: true, callback: (event, button, dialog) => dialog.element.querySelector('[name="targetModule"]').value || "" },
      { action: "cancel", label: "Sem mirar", callback: () => "" }
    ],
    rejectClose: false
  });
  return typeof chosen === "string" && chosen ? chosen : null;
}

/**
 * Dispara uma Arma NATIVA de Nave/Veículo (Overhaul de Naves, Fase 5) — dano/penetração/recarga
 * vivem na própria Módulo (`damageFormula`/`penetration`/`cooldownRounds`), independente de
 * qualquer Habilidade que ela conceda (`grantsSkill` continua servindo pra outras Habilidades
 * não-dano). Rola a fórmula, escala pelo throttle da Arma (`powerAllocationPercent`) E pela fome
 * de energia do momento (`powerRatioFor`), aplica o bônus de Skills de aprimoramento
 * (`combatBonuses.weaponDamageFlat/Multiplier`, já existente) e roda a cascata de dano da Fase 4
 * usando a Penetração da própria Arma. Recarga escala pelo MESMO throttle da Arma (arredondado
 * pra cima, mínimo 1 se `cooldownRounds > 0`) — sobrecarregar bate mais forte, mas demora mais
 * pra disparar de novo.
 */
export async function fireStarshipWeapon(sourceActor, weaponModule, targetActor = null, rollOptions = null) {
  const sys = weaponModule.system;
  if (sys.cooldownRemaining > 0) {
    ui.notifications?.warn(`${weaponModule.name} está em recarga (${sys.cooldownRemaining} rodada(s) restantes).`);
    return null;
  }
  // Lançador: escolhe a munição compatível no Porão; a fórmula, os elementos e o Absoluto vêm dela.
  let ammoItem = null;
  if (sys.usesAmmo) {
    ammoItem = await pickLauncherAmmo(sourceActor, weaponModule);
    if (!ammoItem) return null;
  }
  const ammo = ammoItem?.system.ammo ?? null;
  const formula = (ammo?.damageFormula || sys.damageFormula)?.trim();
  if (!formula) {
    ui.notifications?.warn(`${ammoItem?.name ?? weaponModule.name} não tem uma Fórmula de Dano configurada.`);
    return null;
  }

  const options = normalizeRollOptions(rollOptions);
  const roll = new Roll(applyAdvantageToFormula(formula, options.advantage));
  await roll.evaluate();
  // Gasta 1 da pilha (a pilha vazia fica no Porão, com 0, até alguém tirar).
  if (ammoItem) await ammoItem.update({ "system.quantity": Math.max(0, (Number(ammoItem.system.quantity) || 0) - 1) });

  const throttleRatio = (sys.powerAllocationPercent ?? 100) / 100;
  const powerRatio = sourceActor.system.powerRatioFor(weaponModule);
  const throttledTotal = roll.total * throttleRatio * powerRatio;
  const bonusTotal = applyShipWeaponBonus(throttledTotal, sourceActor);
  // Modificadores do shift+clique: depois de throttle e bônus, antes da cascata do alvo.
  const boostedTotal = applyRollModifiers(bonusTotal, options);

  let flavor = `${weaponModule.name}${ammoItem ? ` (${ammoItem.name})` : ""} — Dano`;
  if (Math.floor(bonusTotal) !== roll.total) flavor += ` — throttle/bônus (${roll.total} → ${Math.floor(bonusTotal)})`;
  flavor += modifiersFlavor(options, bonusTotal, boostedTotal);

  const shipBonuses = sourceActor.system.combatBonuses ?? {};
  const override = shipBonuses.weaponElementOverride && getDamageElement(shipBonuses.weaponElementOverride) ? shipBonuses.weaponElementOverride : "";
  const mech = {
    damageElements: override ? [override] : ammo?.damageElements?.length ? ammo.damageElements : sys.damageElements ?? [],
    isAbsoluteDamage: Boolean(sys.isAbsoluteDamage) || Boolean(ammo?.isAbsoluteDamage) || (shipBonuses.weaponAbsolute ?? 0) > 0,
    isMagicDamage: false
  };
  const ammoPenetration = (Number(ammo?.penetrationBonus) || 0) / 100;
  let finalDamage = null;
  let messageFlags = {};
  if (targetActor) {
    const scale = damageScaleFor(sourceActor, mech, targetActor);
    if (scale !== 1) flavor += ` — escala ×${formatScale(scale)}`;
    const situational = situationalDamageFactor(sourceActor, targetActor, mech);
    const beforeStructure = boostedTotal * scale * situational;
    const blocked = await throughStructures(sourceActor, targetActor, beforeStructure, { elementIds: mech.damageElements });
    const scaledTotal = blocked.damage;
    flavor += blocked.note;
    // Rastro só do Mestre (ver renderDamageTrace); "Rolagem" aqui já inclui throttle e bônus de arma.
    const traceRows = attackTraceRows({ rolled: roll.total, boosted: boostedTotal, scale, situational, beforeStructure, arriving: scaledTotal });

    if (isShipLike(targetActor)) {
      const ctx = averageElementContext(mech.damageElements, targetActor);
      const { toShield, toCasco, toHull, structuralHits, traceRows: cascadeRows } = await applyStarshipDamageCascade(scaledTotal, sourceActor, targetActor, weaponModule, {
        penetration: ctx.penetration + ammoPenetration,
        bonus: ctx.bonus,
        shieldDrain: ctx.shieldDrain,
        layers: ctx.layers,
        shipEffects: ctx.shipEffects,
        conditions: ctx.conditions,
        elementIds: ctx.elementIds,
        askModule: true,
        absolute: mech.isAbsoluteDamage
      });
      finalDamage = toShield + toCasco + toHull;
      traceRows.push(...(cascadeRows ?? []));
      flavor += ` — Escudo -${toShield} · Casco -${toCasco} · Integridade Estrutural -${toHull}`;
      if (structuralHits?.length) flavor += ` (${structuralHits.map(h => (h.damage == null ? h.name : `${h.name} -${h.damage}`)).join(", ")})`;
    } else {
      // Arma de Nave contra uma pessoa: mesmo caminho de dano de Personagem (a Escala é que faz
      // o tiro de canhão valer o que vale).
      const reduction = applyDamageReductions(scaledTotal, mech, targetActor, { attacker: sourceActor, extraPenetration: Math.min(1, shipWeaponPenetration(sourceActor, weaponModule) + ammoPenetration) });
      finalDamage = reduction.finalDamage;
      await grantResistanceXp(reduction.defenders, targetActor);
      await registerResistanceExposure(targetActor, mech.damageElements, finalDamage);
      flavor += ` — ${targetActor.name}: ${finalDamage}${triggeredLabel(reduction.triggeredConditions)}`;
      messageFlags = damageApplyFlags(targetActor, finalDamage, {
        shieldBase: reduction.shieldBase,
        elementIds: reduction.elementIds,
        absolute: mech.isAbsoluteDamage,
        shieldExtra: reduction.shieldExtra,
        shieldMultiplier: reduction.shieldMultiplier,
        shieldPenetration: reduction.shieldPenetration,
        triggeredConditions: reduction.triggeredConditions,
        sever: reduction.sever,
        label: weaponModule.name
      });
      traceRows.push(...personalTraceTail(reduction, targetActor));
    }
    messageFlags = withDamageTrace(messageFlags, [{ name: targetActor.name, rows: traceRows }]);
  }

  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: sourceActor }), flavor, flags: messageFlags });

  if (sys.cooldownRounds > 0) {
    const scaledCooldown = Math.max(1, Math.ceil(sys.cooldownRounds * throttleRatio));
    await weaponModule.update({ "system.cooldownRemaining": scaledCooldown });
  }

  return { roll, finalDamage };
}

/**
 * Efeito de Nave que age na hora: restaurar Escudo (até o máximo), dano (−) ou reparo (+) no Casco
 * ou na Integridade, ou "Preparar para impacto" (−X% de todo dano por N rodadas).
 * @returns {Promise<string>} linha do resumo
 */
export async function applyShipInstantEffect(ship, entry, label) {
  const amount = Math.round(Number(entry.amount) || 0);
  const sys = ship.system;
  if (entry.target === "shipShieldRestore") {
    const gain = Math.max(0, Math.min(amount, (sys.shields.max ?? 0) - (sys.shields.value ?? 0)));
    if (gain > 0) await ship.update({ "system.shields.value": sys.shields.value + gain });
    return `Escudo da Nave +${gain}`;
  }
  if (entry.target === "shipDamageReduction") {
    const rounds = Math.max(1, Math.round(Number(entry.durationRounds) || 1));
    await addShipSystemEffect(ship, { kind: "brace", percent: Math.max(0, Math.min(95, amount)), rounds, label });
    return `Preparar para impacto −${Math.max(0, Math.min(95, amount))}% (${rounds} rodada(s))`;
  }
  const role = entry.target === "shipCasco" ? "armor" : null;
  const layerLabel = entry.target === "shipCasco" ? "Casco" : "Integridade";
  if (amount >= 0) return `${layerLabel} +${await repairModules(ship, amount, role)} (reparo)`;
  if (role) return `${layerLabel} −${await damageCasco(ship, -amount)}`;
  const hits = await applyStructuralDamage(ship, -amount);
  return `${layerLabel} −${hits.reduce((sum, h) => sum + h.damage, 0)}`;
}

/* ------------------------------------------------------------------ Munição */

/**
 * Munição compatível com este lançador no Porão da Nave (tipo aceito, Porte mínimo, pilha > 0):
 * uma só é usada direto; várias perguntam qual. Nenhuma: avisa e não dispara.
 */
async function pickLauncherAmmo(ship, launcher) {
  const options = ship.items.filter(i => i.type === "item" && (Number(i.system.quantity) || 0) > 0 && ammoFitsLauncher(i.system.ammo, launcher.system));
  if (!options.length) {
    ui.notifications?.warn(`${launcher.name}: sem munição compatível no Porão.`);
    return null;
  }
  if (options.length === 1) return options[0];
  const { DialogV2 } = foundry.applications.api;
  const chosen = await DialogV2.wait({
    window: { title: `${launcher.name} — munição` },
    content: `<div class="nihility-ammo-pick"><select name="ammo">${options
      .map(i => `<option value="${i.id}">${foundry.utils.escapeHTML?.(i.name) ?? i.name} (×${i.system.quantity}) — ${i.system.ammo.damageFormula || "fórmula do lançador"}</option>`)
      .join("")}</select></div>`,
    buttons: [
      { action: "fire", label: "Disparar", default: true, callback: (event, button, dialog) => dialog.element.querySelector('[name="ammo"]').value },
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });
  return typeof chosen === "string" ? ship.items.get(chosen) ?? null : null;
}
