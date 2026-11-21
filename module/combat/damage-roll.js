/**
 * Rolar dano de Skill/arma: escala, bônus, Shift, Estruturas no caminho, reduções do alvo por elemento e o card de dano.
 * (Separado de skill-effects.js na reorganização de pastas — mesma lógica de antes.)
 */
import { effectRoundsUpdate } from "../helpers/foundry-compat.js";
import { SYSTEM_ID, isMagicUse, isTechUse, damageElementChain, getActiveDamageElements, getActiveStatusConditions, getEnergyLabelForActor, getAttributeLabel, damageScalingMultiplier, skillLevelBonuses, getDamageElement, actorTraits, isScaleEnabled, getFeatureOption, actorScaleIndex, scaleIndexOf, actorElements, getElementAffinityMatrix, getAffinityConfig, isSurfacesEnabled } from "../core/config.js";
import { playSkillAnimation } from "../core/vfx.js";
import { damageApplyFlags, withDamageTrace } from "./damage-apply.js";
import { magazineState } from "../economy/consumable-rules.js";
import { blockIfIncapacitated } from "./incapacitation.js";
import { applyAdvantageToFormula, applyRollModifiers, describeRollOptions, normalizeRollOptions } from "../core/roll-modifiers.js";
import { applyLuckToFormula, luckOf } from "./luck-rules.js";
import { splitDamageParts, resolveDamageParts, describeDamageParts, scaleMultiplier, rollChance, elementVsDefender, chainedResistance, inheritedElementEffects } from "./damage-rules.js";
import { affinityElementsExcluding } from "./reaction-rules.js";
import { reactionState, reactionForPart, pickedFactor, reactionRecord, cardReactions, reactionLabel, conductReactions, conductionLabel } from "./reactions.js";
import { conditionalBonus } from "./conditional-context.js";
import { interceptingStructure, hitStructure } from "../structures/structures.js";
import { chargeAntimagic, fieldGate, creditManipulation } from "./antimagic.js";
import { checkFlatRange } from "./range.js";
import { applyEffectsToActor } from "../skills/effects-apply.js";
import { promptTargetBodyPart } from "../species/anatomy.js";
import { suppressionLevel, techSuppressionLevel } from "../skills/dispel.js";
import { itemIsTech, skillIsMagic } from "../core/magic-rules.js";
import { sourceSuppressed, suppressionState } from "../core/suppression.js";
import { onHitPicks } from "../skills/marks-rules.js";
import { magicDefenseReduction, resistanceSourceFor, grantResistanceXp, registerResistanceExposure } from "./resistance.js";
import { isShipLike, applyShipWeaponBonus, applyStarshipDamageCascade } from "../starship/ship-damage.js";
import { escapeHtml } from "../helpers/html.js";
import { currentSkillUseId } from "../skills/skill-use-context.js";
import { weaponMasteryHit, afterWeaponAttack, strikeMasteryBonus } from "./weapon-mastery.js";
import { masteryFactor, masteryTraceRow, formatMasteryPercent } from "./weapon-mastery-rules.js";

/**
 * Cascata de dano de 3 camadas pra Nave/Veículo (Overhaul de Naves, Fase 4): Escudo → Casco →
 * Estrutura, cada separação usando a MESMA Penetração% da arma atacante (`shipWeaponPenetration`)
 * — a parte não-penetrada tenta ser absorvida pela camada atual (capada no que resta dela), o
 * resto (parte penetrada + excedente que a camada não aguentou) vaza pra próxima. O Casco entra
 * com sua Redução% própria (`armorReductionPercent`, do Módulo "armor") ANTES de separar de
 * novo pela Penetração — MAS só enquanto `casco.value > 0`: placa furada (Casco a 0%) para de
 * oferecer proteção, tanto a Redução% quanto a própria absorção do estágio. A Estrutura recebe
 * o que sobrar, sem redução própria. Diferente do dano em Personagem (que fica manual por design
 * — o Mestre decide o que fazer com o número), os 3 estágios aqui aplicam automaticamente via
 * `targetActor.update()`: a cascata é complexa demais pra fazer de cabeça na mesa. Zerar o
 * Escudo dispara a Recarga dele (ver `shieldRechargeRounds` do Módulo, ticado em starship-power.js).
 * `weaponModule` (opcional): a Arma que disparou, se o dano veio de `fireStarshipWeapon` — dá a
 * Penetração base real (ver `shipWeaponPenetration`); `null` pra dano vindo de uma Skill
 * genérica (sem Módulo específico associado).
 * @returns {{toShield:number, toCasco:number, toHull:number, appliedReductions:string[]}}
 */
/**
 * Primeiras linhas do rastro de dano (só o Mestre vê): do número rolado até o que chega no alvo —
 * escala, condicional de quem ataca, Antimagia e Estrutura no caminho. As defesas do alvo vêm
 * depois (applyDamageReductions / applyStarshipDamageCascade).
 */
export function attackTraceRows({ rolled, boosted, scale = 1, situational = 1, beforeStructure = null, arriving, nulled = false, mastery = null }) {
  const rows = [{ label: "Rolagem", value: String(rolled) }];
  if (Math.round(boosted) !== rolled) rows.push({ label: "Com escala por atributo, nível, bônus de arma, Maestria e Shift", value: String(Math.round(boosted)) });
  // Maestria de arma (H6): quanto ela somou (só o Mestre vê o rastro).
  if (mastery) rows.push(masteryTraceRow(mastery.label, mastery.percent));
  if (scale !== 1) rows.push({ label: "Escala de tamanho", value: `×${formatScale(scale)}` });
  if (situational !== 1) rows.push({ label: "Quando → Então de quem ataca", value: `×${Math.round(situational * 100) / 100}` });
  if (nulled) {
    rows.push({ label: "Anulado por Antimagia", value: "0", kind: "total" });
    return rows;
  }
  if (beforeStructure != null && beforeStructure - arriving >= 0.5) rows.push({ label: "Estrutura no caminho segurou", value: `−${Math.round(beforeStructure - arriving)}` });
  rows.push({ label: "Chega no alvo", value: String(Math.round(arriving)), kind: "subtotal" });
  return rows;
}

/** Fim do rastro contra Personagem: as defesas por parte, o final e a nota do Escudo pessoal. */
export function personalTraceTail(reduction, targetActor) {
  const rows = [...(reduction.traceRows ?? []), { label: "Final", value: String(reduction.finalDamage), kind: "total" }];
  if ((targetActor.system?.attributes?.shield?.value ?? 0) > 0) rows.push({ label: "O Escudo pessoal absorve primeiro, ao clicar em Aplicar", value: "" });
  return rows;
}

/**
 * Aplica Defesa Mágica + Resistência (Geral/Elemental) sobre um dano bruto já rolado, pra um
 * alvo específico. Compartilhado entre o caminho de alvo único, o de Emissão (área) e os ticks
 * periódicos (Veneno) — o roll/tick em si acontece uma vez só, mas cada alvo aplica sua própria
 * redução em cima do mesmo total. `mech` é `skill.system`, o snapshot de uma Sub-Skill, ou (pro
 * caso de tick) um objeto sintético `{ damageElements }` — mesmo formato de campos
 * (isMagicDamage/damageElements) nos três casos.
 * @param {{skipMagicDefense?: boolean}} [options] - `skipMagicDefense: true`
 *   pula o passo de Defesa Mágica mesmo com `mech.isMagicDamage` true — usado pelos ticks
 *   periódicos, onde Veneno Mágico ignora Defesa Mágica de propósito (só Resistência reduz),
 *   diferente do dano "normal" de uma Skill. Nave/Veículo NÃO passa por aqui — usa a cascata de
 *   3 camadas própria (`applyStarshipDamageCascade`), chamada direto de `rollSkillDamage`/
 *   `rollSkillDamageArea` antes desta função entrar em jogo.
 */
export function applyDamageReductions(rawTotal, mech, targetActor, options = {}) {
  const appliedReductions = [];
  // Vantagem entre elementos contra o elemento do CORPO do alvo (Espécie, Skill de transformação, Condição).
  const bodyElements = actorElements(targetActor);
  const matrix = bodyElements.length ? getElementAffinityMatrix() : {};
  const affinityConfig = getAffinityConfig();
  // Reações elementais (8.1): o que o alvo carrega (marcas) e o corpo. Dano Absoluto, tick periódico
  // e Simulador (triggerConditions: false) não reagem.
  const reacting = !mech.isAbsoluteDamage && !options.noReactions && options.triggerConditions !== false;
  const reactionCtx = reacting && targetActor ? reactionState(targetActor) : null;
  const parts = splitDamageParts(rawTotal, mech.damageElements).map(part => {
    const ctx = elementContext(part.elementId, targetActor);
    const picked = reactionCtx ? reactionForPart(part.elementId, reactionCtx) : null;
    // A vantagem da Tabela que viria da PRÓPRIA marca que reagiu não conta (senão Fogo em Gelo valia
    // Derretimento e Super efetivo juntos); a do corpo e a das outras marcas continuam.
    const defenderElements = picked?.source === "mark" || picked?.source === "surface" ? affinityElementsExcluding(reactionCtx.bodyIds, reactionCtx.marks, picked.mark) : bodyElements;
    const affinity = defenderElements.length ? elementVsDefender(part.elementId, defenderElements, matrix, affinityConfig) : 1;
    const factor = pickedFactor(picked);
    return { ...part, penetration: ctx.penetration, bonus: ctx.bonus, affinity, ctx, picked, reaction: picked && factor !== 1 ? { factor, label: picked.reaction.label } : null };
  });

  const magicDefense = mech.isMagicDamage && targetActor && !options.skipMagicDefense ? magicDefenseReduction(targetActor) : 0;
  const general = targetActor ? resistanceSourceFor(targetActor, "general") : { percent: 0, skill: null };
  // Resistência condicional de quem defende ("+20% contra Dracônicos"): o oponente é quem atacou.
  const situational = element =>
    targetActor ? conditionalBonus(targetActor, options.attacker ?? null, "resistancePercent", { elements: mech.damageElements, element }) / 100 : 0;
  const generalPercent = general.percent + situational("general");
  // Hierarquia de elementos: a parte passa pela Resistência do próprio elemento e pela de cada
  // ancestral (Cortante: Resistência a Cortante e Resistência Física), uma depois da outra.
  const elementSources = new Map();
  const resistanceFor = elementId => {
    if (!targetActor) return 0;
    if (!elementSources.has(elementId)) {
      const chain = damageElementChain(elementId).map(el => el.id);
      const ids = chain.length ? chain : [elementId];
      const layers = ids.map(id => ({ id, ...resistanceSourceFor(targetActor, id) }));
      // A Skill que aprende com o bloqueio: a do próprio elemento, senão a do ancestral mais próximo.
      const skill = layers.find(l => l.skill)?.skill ?? null;
      const percent = chainedResistance(layers.map(l => l.percent + situational(l.id)));
      elementSources.set(elementId, { percent, skill, names: layers.filter(l => l.skill).map(l => l.skill.name) });
    }
    return elementSources.get(elementId).percent;
  };

  const result = resolveDamageParts({ parts, magicDefense, general: generalPercent, resistanceFor, absolute: Boolean(mech.isAbsoluteDamage) });
  // Rastro só do Mestre (flags do card, ver renderDamageTrace): de onde veio cada redução.
  const traceRows = describeDamageParts(result.parts, {
    elementLabel: id => getDamageElement(id)?.label ?? id,
    generalLabel: `Resistência Geral${general.skill ? ` (${general.skill.name})` : ""}${situational("general") ? " + Quando → Então" : ""}`,
    elementSourceLabel: id => [...(elementSources.get(id)?.names ?? []), situational(id) ? "Quando → Então" : ""].filter(Boolean).join(" + ")
  });

  // Quem de fato abateu dano, e quanto — insumo do XP de Resistência (a Skill aprende apanhando).
  const defenders = [];
  const blockedGeneral = result.parts.reduce((sum, p) => sum + (p.blockedGeneral || 0), 0);
  if (general.skill && blockedGeneral > 0) defenders.push({ skill: general.skill, blocked: blockedGeneral });
  for (const part of result.parts) {
    const source = part.elementId ? elementSources.get(part.elementId) : null;
    if (source?.skill && part.blockedElement > 0) defenders.push({ skill: source.skill, blocked: part.blockedElement });
  }
  if (magicDefense > 0) appliedReductions.push(`Defesa Mágica ${Math.round(magicDefense * 100)}%`);

  // Efeitos de elemento: dreno de Escudo e Condições ao acertar. Ticks periódicos não disparam
  // Condição nova (senão uma Queimadura geraria outra Queimadura a cada rodada).
  let shieldExtra = 0;
  let sever = false;
  // Sorte (8d.1): quem se beneficia das chances de efeito ao acertar é quem atacou.
  const chancesLuck = luckOf(options.attacker, "chances");
  const triggeredConditions = [];
  // Nível e magia do golpe vão junto com o que ele dispara (prancha 8: Antimagia e bloqueio de cura).
  const hitLevel = Math.max(1, Number(mech.level) || 1);
  const hitMagic = Boolean(mech.isMagicDamage) || mech.magicTag === "magic";
  result.parts.forEach((part, index) => {
    const ctx = parts[index].ctx;
    if (part.immune || !(part.final > 0)) return;
    shieldExtra += part.final * ctx.shieldDrain;
    // Reação com "dano extra só no Escudo" (a marca ou o chão, nunca o corpo).
    const reactionPick = parts[index].picked;
    if (reactionPick && reactionPick.source !== "body") shieldExtra += (part.final * reactionPick.reaction.shieldDrain) / 100;
    if (options.triggerConditions === false) return;
    for (const effect of ctx.conditions) {
      if (rollChance(effect.chance, Math.random, chancesLuck)) triggeredConditions.push({ conditionId: effect.conditionId, elementId: part.elementId, hitDamage: part.final, level: hitLevel, magic: hitMagic, rounds: effect.rounds, appliedBy: options.attacker?.uuid ?? "" });
    }
    for (const chance of ctx.sever) if (rollChance(chance, Math.random, chancesLuck)) sever = true;
    for (const effect of ctx.blockRegen) {
      if (rollChance(effect.chance, Math.random, chancesLuck)) triggeredConditions.push({ conditionId: effect.conditionId || "regen-blocked", elementId: part.elementId, blockRegen: true, rounds: effect.rounds, level: hitLevel, magic: hitMagic });
    }
  });

  // "Ao acertar" (8c.1): as Skills de quem atacou com a Condição passiva. Só golpes de Skill/arma/consumível
  // de um Personagem (opção `onHit`); tick, contato de Estrutura, Armadilha e Nave não passam por aqui.
  if (options.onHit && options.attacker && options.triggerConditions !== false && result.final > 0) {
    triggeredConditions.push(...onHitConditionsFor(options.attacker, result.final));
  }

  // "Dano por camada" de Escudo contra o Escudo pessoal: média pesada pelo dano de cada parte.
  const weight = result.parts.reduce((sum, part) => sum + (part.final || 0), 0);
  const shieldMultiplier =
    weight > 0 && !mech.isAbsoluteDamage
      ? Math.max(0, result.parts.reduce((sum, part, index) => sum + (part.final || 0) * (1 + parts[index].ctx.layers.shield), 0) / weight)
      : 1;

  // Penetração contra o Escudo pessoal (age em cada pool, ver consumeShieldPools): a dos elementos,
  // pesada pelo dano de cada parte, mais a da arma (arma de Nave contra pessoa).
  const shieldPenetration = mech.isAbsoluteDamage
    ? 0
    : Math.min(
        1,
        (weight > 0 ? result.parts.reduce((sum, part, index) => sum + (part.final || 0) * parts[index].ctx.penetration, 0) / weight : 0) +
          (options.extraPenetration || 0)
      );

  return {
    finalDamage: result.final,
    // O que chega num Escudo pessoal (sem a vantagem contra o corpo; o Escudo tem a dele).
    shieldBase: result.shieldBase,
    elementIds: [...new Set((mech.damageElements ?? []).filter(Boolean))],
    appliedReductions,
    traceRows,
    defenders,
    parts: result.parts,
    shieldExtra: Math.floor(shieldExtra),
    shieldMultiplier,
    shieldPenetration,
    triggeredConditions,
    sever,
    // Reações que dispararam (JSON simples): nome, o que consumir e o que aplicar no Aplicar.
    reactions: result.parts
      .map((part, index) => (parts[index].picked && !part.immune ? reactionRecord(parts[index].picked, part) : null))
      .filter(Boolean)
  };
}

/**
 * As Condições que os golpes de `attacker` disparam pelo "ao acertar" das Skills dele (8c.1): uma entrada
 * por Skill que vale agora (ligada/desligada conforme `when`) e passou na chance, no formato de
 * `triggeredConditions` — aplicada no Aplicar do card, com `appliedBy` = quem atacou. Nave não ataca assim.
 */
export function onHitConditionsFor(attacker, hitDamage) {
  if (!attacker || attacker.type !== "character") return [];
  const suppression = suppressionState(attacker);
  const skills = [];
  for (const item of attacker.items ?? []) {
    if (item.type !== "skill" || !item.system.onHit?.conditionId) continue;
    if (sourceSuppressed(attacker, item, null, suppression)) continue;
    skills.push({ name: item.name, level: item.system.level, hasUpkeep: item.system.hasUpkeep, active: item.system.active, onHit: item.system.onHit, magic: skillIsMagic({ ...item.system, tier: item.system.tier }) });
  }
  const chancesLuck = luckOf(attacker, "chances");
  return onHitPicks(skills, chance => rollChance(chance, Math.random, chancesLuck)).map(pick => ({
    conditionId: pick.conditionId,
    elementId: "",
    hitDamage,
    level: pick.level,
    magic: pick.magic,
    rounds: pick.rounds,
    appliedBy: attacker.uuid
  }));
}

/**
 * O que um Elemento faz ao acertar este alvo: Penetração, bônus contra Traço, dreno de Escudo e
 * Condições (ver ELEMENT_EFFECT_TYPES em config.js). Tudo em fração (0.3 = 30%).
 */
function elementContext(elementId, targetActor) {
  const ctx = { penetration: 0, bonus: 0, shieldDrain: 0, layers: { shield: 0, casco: 0, hull: 0 }, conditions: [], shipEffects: [], sever: [], blockRegen: [] };
  const element = elementId ? getDamageElement(elementId) : null;
  if (!element) return ctx;
  const traits = targetActor ? actorTraits(targetActor) : [];
  // Subtipo herda os efeitos do pai que não tiver (Cortante herda os do Físico).
  for (const effect of inheritedElementEffects(damageElementChain(elementId))) {
    const percent = (Number(effect.percent) || 0) / 100;
    if (effect.type === "penetration") ctx.penetration += percent;
    else if (effect.type === "traitBonus" && traits.includes(effect.trait)) ctx.bonus += percent;
    else if (effect.type === "shieldDrain") ctx.shieldDrain += percent;
    // "Dano por camada": pode ser negativo (fraqueza) — ver resolveShipCascade/absorbLayer.
    else if (effect.type === "layer" && effect.layer in ctx.layers) ctx.layers[effect.layer] += percent;
    else if (effect.type === "condition" && effect.conditionId) ctx.conditions.push({ conditionId: effect.conditionId, chance: Number(effect.chance) || 0, rounds: Math.max(0, Math.round(Number(effect.rounds) || 0)) });
    // Ferimentos por parte: Decepar (a parte atingida que chega no 0 vira Perdida) e Impede
    // regeneração (Condição marcada "Impede regeneração"; 0 rodadas = até ser removida).
    else if (effect.type === "sever") ctx.sever.push(Number(effect.chance) || 0);
    else if (effect.type === "blockRegen") ctx.blockRegen.push({ chance: Number(effect.chance) || 0, rounds: Math.max(0, Math.round(Number(effect.rounds) || 0)), conditionId: effect.conditionId || "" });
    else if (["moduleDisable", "energyDrain", "resistanceDown"].includes(effect.type)) {
      ctx.shipEffects.push({
        type: effect.type,
        chance: Number(effect.chance) || 0,
        percent: Number(effect.percent) || 0,
        rounds: Math.max(1, Math.round(Number(effect.rounds) || 1)),
        elementLabel: element.label
      });
    }
  }
  return ctx;
}

/** Média de um número entre as partes de um golpe (Nave não tem resistência por elemento). */
export function averageElementContext(elementIds, targetActor) {
  const ids = [...new Set((elementIds ?? []).filter(Boolean))];
  const total = { penetration: 0, bonus: 0, shieldDrain: 0, layers: { shield: 0, casco: 0, hull: 0 }, shipEffects: [], conditions: [], elementIds: ids };
  if (!ids.length) return total;
  for (const id of ids) {
    const ctx = elementContext(id, targetActor);
    total.penetration += ctx.penetration / ids.length;
    total.bonus += ctx.bonus / ids.length;
    total.shieldDrain += ctx.shieldDrain / ids.length;
    for (const layer of Object.keys(total.layers)) total.layers[layer] += ctx.layers[layer] / ids.length;
    // Efeitos de sistema e Condições: cada elemento tenta os seus (chances independentes).
    total.shipEffects.push(...ctx.shipEffects);
    total.conditions.push(...ctx.conditions);
  }
  return total;
}

/**
 * Multiplicador de Escala de um golpe contra um alvo (ver `scaleMultiplier` em damage-rules.js).
 * 1 com o bloco de Escala desligado. A escala do golpe é a do campo `damageScale` da Skill/arma,
 * ou a de quem ataca.
 */
export function damageScaleFor(sourceActor, mech, targetActor) {
  if (!isScaleEnabled() || !targetActor) return 1;
  const attack = scaleIndexOf(mech?.damageScale) ?? actorScaleIndex(sourceActor);
  return scaleMultiplier(attack, actorScaleIndex(targetActor), getFeatureOption("scale", "scaleFactor"));
}

/** Fator do bônus condicional de dano de quem ataca contra este alvo ("+25% contra Dracônico"). */
export function situationalDamageFactor(sourceActor, targetActor, mech) {
  if (!sourceActor || !targetActor) return 1;
  const percent = conditionalBonus(sourceActor, targetActor, "damagePercent", { elements: mech?.damageElements ?? [] });
  return Math.max(0, 1 + percent / 100);
}

/**
 * Aplica as Condições disparadas por elementos num alvo, usando o efeito padrão de cada uma com o
 * dano daquela parte do golpe. Chamado quando o dano de fato acerta (botão Aplicar do chat, ou
 * direto na cascata de Nave). Devolve os ids dos efeitos NOVOS (renovações não contam), pra o
 * Desfazer poder removê-los.
 */
export async function applyTriggeredConditions(targetActor, triggered, { label = "", factor = 1, partId = null } = {}) {
  if (!targetActor || !triggered?.length) return { summary: [], createdIds: [] };
  const before = new Set(targetActor.effects.map(e => e.id));
  const summary = [];
  for (const hit of triggered) {
    if (hit.blockRegen) {
      summary.push(...(await applyRegenBlock(targetActor, hit, label, partId)));
      continue;
    }
    const entry = {
      target: "hp",
      amount: 0,
      // Duração do efeito de elemento ("Molhado por 2 rodadas"); 0 = a que a própria Condição tem.
      durationRounds: Math.max(0, Math.round(Number(hit.rounds) || 0)),
      conditionId: hit.conditionId,
      damageElements: hit.elementId ? [hit.elementId] : [],
      hitDamage: Math.max(0, (Number(hit.hitDamage) || 0) * factor),
      // Condição com "Impede cura" na parte atingida: prende-se à parte que levou o golpe.
      healBlockPartId: partId || ""
    };
    summary.push(...(await applyEffectsToActor({ effects: [entry], level: 1, hasUpkeep: false, sourceLevel: hit.level ?? 1, sourceMagic: Boolean(hit.magic), appliedBy: hit.appliedBy ?? "" }, label, null, targetActor)));
  }
  const createdIds = targetActor.effects.filter(e => !before.has(e.id)).map(e => e.id);
  return { summary, createdIds };
}

/**
 * "Impede regeneração" vindo de um elemento: a Condição escolhida (padrão "Regeneração bloqueada"),
 * por `rounds` rodadas — 0 = até ser removida (Maldição). Catálogo salvo sem essa Condição: cria o
 * efeito do mesmo jeito, com a marca na flag (isRegenerationBlocked lê as duas).
 */
async function applyRegenBlock(targetActor, hit, label, partId = null) {
  const condition = getActiveStatusConditions().find(c => c.id === hit.conditionId);
  if (condition) {
    return applyEffectsToActor(
      { effects: [{ target: "hp", amount: 0, durationRounds: hit.rounds ?? 0, conditionId: condition.id, damageElements: [], healBlockPartId: partId || "" }], level: 1, hasUpkeep: false, sourceLevel: hit.level ?? 1, sourceMagic: Boolean(hit.magic) },
      label,
      null,
      targetActor
    );
  }
  const existing = targetActor.effects.find(e => e.getFlag(SYSTEM_ID, "regenBlocked"));
  const rounds = Number(hit.rounds) || 0;
  if (existing) {
    await existing.update(effectRoundsUpdate(rounds > 0 ? Math.max(rounds, existing.duration?.remaining ?? 0) : 0, { combat: game.combat }));
  } else {
    await targetActor.createEmbeddedDocuments("ActiveEffect", [
      {
        name: "Regeneração bloqueada",
        img: "icons/svg/acid.svg",
        duration: rounds > 0 ? { rounds } : {},
        flags: { [SYSTEM_ID]: { skillEffect: true, conditionId: "regen-blocked", regenBlocked: true, sourceLevel: hit.level ?? 1, magic: Boolean(hit.magic) } }
      }
    ]);
  }
  return [`Regeneração bloqueada${rounds > 0 ? ` (${rounds} rodada(s))` : " (até ser removida)"}`];
}

/** Nomes das Condições disparadas, pra mostrar no chat ("causa Queimadura"). */
export function triggeredLabel(triggered) {
  if (!triggered?.length) return "";
  const names = [...new Set(triggered.map(t => getActiveStatusConditions().find(c => c.id === t.conditionId)?.label ?? (t.blockRegen ? "Regeneração bloqueada" : t.conditionId)))];
  return ` — causa ${names.map(escapeHtml).join(", ")}`;
}

/**
 * A entrada de card (`damageApply`) de um alvo a partir do resultado de `applyDamageReductions`, ou
 * `null` se não há nada a aplicar. Compartilhada pelo alvo único, pela área e por quem a reação conduz.
 */
/**
 * De quem é a superfície que o golpe pode deixar no Aplicar (8.2): `{magic, useId}`, ou `null` com o bloco
 * desligado ou sem quem atacou. A natureza "da origem" olha se o golpe é mágico (`isMagicUse`).
 */
export function surfaceOrigin(mech, attacker) {
  if (!isSurfacesEnabled()) return null;
  return { magic: isMagicUse(mech, attacker), useId: currentSkillUseId() };
}

export function damageEntryFrom(actor, reduction, mech, label, extra = {}) {
  return (
    damageApplyFlags(actor, reduction.finalDamage, {
      shieldBase: reduction.shieldBase,
      elementIds: reduction.elementIds ?? [],
      absolute: Boolean(mech.isAbsoluteDamage),
      shieldExtra: reduction.shieldExtra ?? 0,
      shieldMultiplier: reduction.shieldMultiplier ?? 1,
      shieldPenetration: reduction.shieldPenetration ?? 0,
      triggeredConditions: reduction.triggeredConditions ?? [],
      sever: Boolean(reduction.sever),
      reactions: cardReactions(reduction.reactions),
      label,
      ...extra
    })[SYSTEM_ID]?.damageApply ?? null
  );
}

/** "100", "0.01" — escala sem casas decimais inúteis. */
export function formatScale(value) {
  return value >= 1 ? String(Math.round(value * 100) / 100) : String(Number(value.toPrecision(2)));
}

/** Trecho do flavor com os modificadores do shift+clique e o efeito deles ("— +5 (…) (40 → 45)"). */
export function modifiersFlavor(options, before, after) {
  const text = describeRollOptions(options);
  if (!text) return "";
  // `text` traz o motivo digitado no Shift+clique: escapado, porque o flavor é HTML.
  const safe = escapeHtml(text);
  return Math.round(after) !== Math.round(before) ? ` — ${safe} (${Math.round(before)} → ${Math.round(after)})` : ` — ${safe}`;
}

/** `label` já vem pronto de `useSkillEffect` (nome da Skill, ou "Skill — Sub-Skill" quando aplicável). */
function damageFlavorPrefix(mech, label) {
  const elementLabels = (mech.damageElements ?? [])
    .map(id => getActiveDamageElements().find(e => e.id === id)?.label)
    .filter(Boolean);
  return elementLabels.length ? `${escapeHtml(label)} — Dano ${elementLabels.map(escapeHtml).join("+")}` : `${escapeHtml(label)} — Dano`;
}

/**
 * Estrutura no caminho (parede, barreira): ela segura o golpe primeiro, até a própria Vida — ou a
 * Mana de quem conjurou, numa barreira de mana — e só o resto chega no alvo, ANTES das defesas
 * dele. Vale até pra Dano Absoluto contra Estrutura FÍSICA (a parede não *resiste*, está na frente);
 * a ETÉREA o Dano Absoluto desfaz e o golpe passa inteiro.
 * @returns {Promise<{damage: number, note: string}>}
 */
export async function throughStructures(attacker, targetActor, damage, { origin = null, elementIds = [], absolute = false } = {}) {
  const block = interceptingStructure(attacker, targetActor, { origin });
  if (!block) return { damage, note: "", impact: null };
  const { absorbed, passed, label, point, broken, side } = await hitStructure(block, damage, elementIds, targetActor, { absolute });
  // Duas medidas diferentes (sessão 3, 21/11: "bloqueou 43" no card e "segurou 173" no rastro confundiam):
  // quanto do golpe ela segurou (na moeda do golpe) e quanto de Vida ela perdeu (com o % de fora/dentro e a vantagem).
  const held = Math.max(0, Math.round(damage - passed));
  const lost = Math.round(absorbed);
  const sideNote = side ? `, golpe de ${side.inside ? "dentro" : "fora"}: ${side.percent}%` : "";
  const blockedNote = held === lost && !side ? `bloqueou ${held}` : `segurou ${held} do golpe (perdeu ${lost} de Vida${sideNote})`;
  const note = broken ? ` — ${escapeHtml(label)} se desfez com o golpe` : absorbed ? ` — ${escapeHtml(label)} ${blockedNote}` : "";
  return { damage: passed, note, impact: point };
}

export async function rollSkillDamage(actor, mech, label, targetActor = null, rollOptions = null, { aim = false } = {}) {
  const formula = mech.damageFormula?.trim();
  if (!formula) {
    ui.notifications?.warn("Essa skill não tem uma Fórmula de Dano configurada.");
    return null;
  }

  const options = normalizeRollOptions(rollOptions);
  const roll = new Roll(applyAdvantageToFormula(applyLuckToFormula(formula, luckOf(actor, "damage")), options.advantage));
  await roll.evaluate();

  // Escala por Atributo (ver damageScalingMultiplier em config.js) — 1 quando a Skill não tem
  // Atributo de Escala escolhido, que é o padrão e o estado de todo conteúdo anterior à regra.
  const scaling = damageScalingMultiplier(actor, mech.scalingAttribute);
  // Nível da Skill e Mana investida (Mana variável) multiplicam juntos.
  const levelPower = skillLevelBonuses(mech.level).power * (mech.investPower ?? 1);
  const scaledTotal = roll.total * scaling * levelPower;
  // Nave: bônus de arma em `combatBonuses`; arma pessoal: `weaponBonuses` (via useWeaponAttack).
  const weaponBonused = mech.weaponBonus ? scaledTotal * (mech.weaponBonus.multiplier ?? 1) + (mech.weaponBonus.flat ?? 0) : scaledTotal;
  // Maestria de arma (H6): depois da escala e dos bônus de arma, antes dos modificadores do Shift e das defesas.
  const mastery = mech.masteryBonus ?? strikeMasteryBonus(actor, mech);
  const personal = mastery ? weaponBonused * masteryFactor(mastery.percent) : weaponBonused;
  const bonusTotal = applyShipWeaponBonus(personal, actor);
  // Modificadores do shift+clique: depois de toda escala e bônus automáticos, antes das
  // reduções do alvo (ver roll-modifiers.js).
  const boostedTotal = applyRollModifiers(bonusTotal, options);

  let flavor = damageFlavorPrefix(mech, label);
  if (scaling !== 1) {
    flavor += ` — ${getAttributeLabel(mech.scalingAttribute)} ×${scaling.toFixed(1)}`;
  }
  if (levelPower !== 1) flavor += ` — ${mech.investPower && mech.investPower !== 1 ? `nível e investimento de ${getEnergyLabelForActor(actor)}` : "nível"} ×${levelPower.toFixed(2)}`;
  if (scaledTotal !== roll.total) flavor += ` (${roll.total} → ${Math.round(scaledTotal)})`;
  if (bonusTotal !== scaledTotal) flavor += ` — bônus de arma (${Math.round(scaledTotal)} → ${Math.round(bonusTotal)})`;
  if (mastery) flavor += ` — Maestria ${escapeHtml(mastery.label)} +${formatMasteryPercent(mastery.percent)}%`;
  flavor += modifiersFlavor(options, bonusTotal, boostedTotal);

  // Escala: pistola contra Nave, canhão contra pessoa (ver damageScaleFor).
  const scale = damageScaleFor(actor, mech, targetActor);
  const situational = situationalDamageFactor(actor, targetActor, mech);
  const rawDamage = boostedTotal * scale * situational;
  if (scale !== 1) flavor += ` — escala ×${formatScale(scale)}`;
  // Parede/barreira entre quem ataca e o alvo segura primeiro (ver throughStructures).
  // Antimagia: ataque mágico que cruza um campo (ou sob Selo) paga a energia extra ou é anulado.
  // Pela Marca (H4), a linha parte do Marcado (`mech.viaMark.origin`).
  const viaOrigin = mech.viaMark?.origin ?? null;
  const antimagic = targetActor ? await chargeAntimagic(actor, mech, [targetActor], { origin: viaOrigin }) : null;
  if (antimagic?.note) flavor += antimagic.note;
  if (antimagic?.nulled.has(targetActor.uuid)) {
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${flavor} — ${escapeHtml(targetActor.name)}: 0`,
      flags: withDamageTrace({}, [{ name: targetActor.name, rows: attackTraceRows({ rolled: roll.total, boosted: boostedTotal, scale, situational, nulled: true, mastery }) }])
    });
    return { roll, finalDamage: 0 };
  }
  // Alvo Suprimido (Antimagia): golpe mágico de alvo único, de nível ≤ a supressão, não tem efeito.
  // Em área continua acertando (rollSkillDamageArea não passa por aqui).
  const suppressedAt = targetActor?.type === "character" ? suppressionLevel(targetActor) : null;
  const techSuppressedAt = targetActor?.type === "character" ? techSuppressionLevel(targetActor) : null;
  const hitLevelNow = Number(mech.level) || 1;
  const magicSuppressed = suppressedAt !== null && (isMagicUse(mech, actor) || mech.magicTag === "magic") && hitLevelNow <= suppressedAt;
  const techSuppressedHit = techSuppressedAt !== null && isTechUse(mech, actor) && !mech.weaponShot && hitLevelNow <= techSuppressedAt;
  if (magicSuppressed || techSuppressedHit) {
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${flavor} — ${escapeHtml(targetActor.name)}: sem efeito (Suprimido)` });
    return { roll, finalDamage: 0 };
  }
  const blocked = targetActor ? await throughStructures(actor, targetActor, rawDamage, { origin: viaOrigin, elementIds: mech.damageElements, absolute: Boolean(mech.isAbsoluteDamage) }) : { damage: rawDamage, note: "", impact: null };
  const scaledDamage = blocked.damage;
  const traceRows = attackTraceRows({ rolled: roll.total, boosted: boostedTotal, scale, situational, beforeStructure: rawDamage, arriving: scaledDamage, mastery });
  flavor += blocked.note;
  // A animação da Skill para no ponto de impacto se uma parede segurou, e só segue até o alvo se
  // sobrou dano (arma pessoal não tem animação, então nada acontece pra ela).
  playSkillAnimation(actor, mech, { targetActor, impact: blocked.impact, passesThrough: blocked.damage > 0 });

  let finalDamage;
  let reduction = null;
  let aimedPart = null;
  let conducted = { entries: [], trace: [], notes: [] };
  if (isShipLike(targetActor)) {
    const ctx = averageElementContext(mech.damageElements, targetActor);
    const cascade = await applyStarshipDamageCascade(scaledDamage, actor, targetActor, null, {
      penetration: ctx.penetration,
      bonus: ctx.bonus,
      shieldDrain: ctx.shieldDrain,
      layers: ctx.layers,
      shipEffects: ctx.shipEffects,
      conditions: ctx.conditions,
      elementIds: ctx.elementIds,
      askModule: true,
      absolute: Boolean(mech.isAbsoluteDamage)
    });
    const { toShield, toCasco, toHull, structuralHits } = cascade;
    traceRows.push(...cascade.traceRows);
    finalDamage = toShield + toCasco + toHull;
    flavor += ` — Escudo -${toShield} · Casco -${toCasco} · Integridade Estrutural -${toHull}${reactionLabel((cascade.reactionLabels ?? []).map(name => ({ label: name })))}`;
    if (structuralHits?.length) flavor += ` (${structuralHits.map(h => (h.damage == null ? escapeHtml(h.name) : `${escapeHtml(h.name)} -${h.damage}`)).join(", ")})`;
  } else {
    // Nunca revela NO CHAT que/quanto de Resistência ou Defesa Mágica foi aplicada — só o
    // número final. A redução em si continua acontecendo (applyDamageReductions), só não
    // aparece na mensagem (nem a existência dela, mesmo quando reduz a 0).
    reduction = applyDamageReductions(scaledDamage, mech, targetActor, { attacker: actor, onHit: true });
    finalDamage = reduction.finalDamage;
    // Defender é o que faz uma Skill de Resistência evoluir — ela aprende apanhando. E levar
    // golpes de um tipo que ainda não se resiste é o que faz a Skill poder nascer.
    await grantResistanceXp(reduction.defenders, targetActor);
    await registerResistanceExposure(targetActor, mech.damageElements, finalDamage);
    // O `roll.toMessage()` abaixo mostra o total BRUTO da rolagem — sem esta linha o número
    // final (já reduzido) nunca chegava ao chat, e o Mestre acabava aplicando o bruto: na
    // prática, Resistência e Defesa Mágica não valiam nada contra alvo único. Mesmo formato
    // "Alvo: número" que a versão em área (`rollSkillDamageArea`) já usava.
    if (targetActor) flavor += ` — ${escapeHtml(targetActor.name)}: ${finalDamage}${reactionLabel(reduction.reactions)}${triggeredLabel(reduction.triggeredConditions)}`;
    if (targetActor) traceRows.push(...personalTraceTail(reduction, targetActor));
    // O que a reação espalha (raio no molhado conduz para quem está perto): cada um vira uma linha do card.
    if (targetActor && reduction.reactions?.some(r => r.spread)) {
      conducted = await conductReactions(reduction.reactions, targetActor, mech, {
        attacker: actor,
        reduce: applyDamageReductions,
        makeEntry: (who, red, lbl) => damageEntryFrom(who, red, mech, lbl, { noBodyPart: true }),
        label
      });
      flavor += conductionLabel(conducted.notes);
    }
    // Ferimentos por parte: quem ataca pode mirar numa parte (senão o Aplicar sorteia uma).
    if (aim && targetActor && finalDamage > 0) aimedPart = await promptTargetBodyPart(targetActor, mech.weaponShot ? { used: "O ataque já foi feito" } : undefined);
    if (aimedPart) flavor += ` (mirando: ${escapeHtml(aimedPart.name)})`;
  }

  const baseFlags = damageApplyFlags(targetActor, finalDamage, {
    shieldBase: reduction?.shieldBase,
    elementIds: reduction?.elementIds ?? [],
    absolute: Boolean(mech.isAbsoluteDamage),
    shieldExtra: reduction?.shieldExtra ?? 0,
    shieldMultiplier: reduction?.shieldMultiplier ?? 1,
    shieldPenetration: reduction?.shieldPenetration ?? 0,
    triggeredConditions: reduction?.triggeredConditions ?? [],
    sever: Boolean(reduction?.sever),
    reactions: cardReactions(reduction?.reactions),
    surface: surfaceOrigin(mech, actor),
    bodyPart: aimedPart,
    label
  });
  // Com quem a reação conduziu: o card vira um card de vários alvos (o principal e os conduzidos).
  let applyFlags = baseFlags;
  if (conducted.entries.length) {
    const main = baseFlags[SYSTEM_ID]?.damageApply;
    applyFlags = { [SYSTEM_ID]: { damageApplyMany: { entries: [...(main ? [{ ...main, name: targetActor.name }] : []), ...conducted.entries] } } };
  }
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    // Dados dos botões de Aplicar/Desfazer (ver module/damage-apply.js). Ficam em `flags` e não
    // no conteúdo: quem abrir o chat depois vê o mesmo estado de quem estava online.
    flags: withDamageTrace(applyFlags, targetActor ? [{ name: targetActor.name, rows: traceRows }, ...conducted.trace] : [])
  });
  return { roll, finalDamage };
}

/**
 * Ataque com uma Arma (Item Geral com `system.weapon.enabled`). Reaproveita `rollSkillDamage`
 * inteiro — Escala por Atributo, Defesa Mágica, Resistências, cascata de Nave e botões de Aplicar
 * dano valem igual a uma Skill de dano — montando um `mech` sintético com os mesmos campos.
 * `level: 1` fica de fora do ciclo Poder/Desconto (arma não sobe de nível), e nenhum Custo de
 * Energia é cobrado. Só o alvo único é suportado: arma de área continua sendo uma Skill.
 * @param {Actor} sourceActor
 * @param {Item} weaponItem
 * @param {Actor|null} targetActor
 */
export async function useWeaponAttack(sourceActor, weaponItem, targetActor = null, rollOptions = null) {
  const weapon = weaponItem?.system?.weapon;
  if (!weapon?.enabled) return null;
  // Arma de gravidade (J1): empurra e puxa em vez de rolar dano.
  if (weapon.mode === "gravity") {
    const { useGravityWeapon } = await import("./forced-movement.js");
    return useGravityWeapon(sourceActor, weaponItem, targetActor);
  }
  if (!weapon.damageFormula?.trim()) {
    ui.notifications?.warn(`${weaponItem.name} não tem uma Fórmula de Dano configurada.`);
    return null;
  }

  if (blockIfIncapacitated(sourceActor, "atacar")) return null;
  // Carregador (consumables.js): sem disparo, não ataca; a munição que está dentro troca a
  // fórmula/elementos e pode tornar o golpe Absoluto.
  const magazine = magazineState({ size: weapon.magazineSize, loaded: weapon.loaded, capacity: weapon.loadedAmmo?.capacity });
  if (magazine.uses && magazine.empty) {
    ui.notifications?.warn(`${weaponItem.name} está sem munição — use Recarregar.`);
    return null;
  }
  const ammo = magazine.uses ? weapon.loadedAmmo ?? null : null;

  // Aprimoramento vindo de Skills (alvos "weapon*"): vale pra qualquer arma equipada do Ator.
  const bonuses = sourceActor.system.weaponBonuses ?? {};
  const override = bonuses.elementOverride && getDamageElement(bonuses.elementOverride) ? bonuses.elementOverride : "";
  // Maestria de arma (H6): a melhor que cobre o tipo desta arma (ou do desarmado, já resolvido pelo tipo).
  const masteryHit = weaponMasteryHit(sourceActor, weaponItem);
  const shotMech = {
      damageFormula: ammo?.damageFormula?.trim() || weapon.damageFormula,
      scalingAttribute: weapon.scalingAttribute,
      isMagicDamage: weapon.isMagicDamage || (bonuses.forceMagic ?? 0) > 0,
      isAbsoluteDamage: weapon.isAbsoluteDamage || Boolean(ammo?.isAbsoluteDamage) || (bonuses.absolute ?? 0) > 0,
      damageScale: weapon.damageScale,
      damageElements: override ? [override] : ammo?.damageElements?.length ? ammo.damageElements : weapon.damageElements,
      weaponBonus: { flat: Number(bonuses.damageFlat) || 0, multiplier: bonuses.damageMultiplier ?? 1 },
      masteryBonus: masteryHit ? { percent: masteryHit.percent, label: masteryHit.label } : null,
      // Arma tecnológica não dispara através de um campo de interferência (anulada, sem custo).
      isTech: itemIsTech(weaponItem.system),
      weaponShot: true,
      level: 1
  };
  // Dentro de um Campo de Interferência/Antimagia (ou sob Selo): nada acontece — não gasta o disparo.
  // (O tiro de fora para dentro gasta o disparo e some em chargeAntimagic.)
  const gate = fieldGate(sourceActor, shotMech);
  if (gate.blocked) {
    ui.notifications?.warn(gate.blocked);
    return null;
  }
  if (gate.resisted) await creditManipulation(gate.skill);
  // Alcance da arma (H4): sem Marca; o Mestre pode usar mesmo assim. Confere antes de gastar o disparo.
  if (!(await checkFlatRange(sourceActor, targetActor, weapon.range, { label: weaponItem.name }))) return null;
  const result = await rollSkillDamage(
    sourceActor,
    { ...shotMech, fieldGated: true },
    ammo?.label ? `${weaponItem.name} (${ammo.label})` : weaponItem.name,
    targetActor,
    rollOptions,
    { aim: true }
  );
  if (result && magazine.uses) await weaponItem.update({ "system.weapon.loaded": magazine.loaded - 1 });
  // XP da Maestria (ou a contagem para a sugestão de aprender pela prática): só depois do golpe resolvido.
  if (result) await afterWeaponAttack(sourceActor, weaponItem, masteryHit, result, targetActor);
  return result;
}

/**
 * Versão em Emissão (área) de `rollSkillDamage`: rola o dano UMA VEZ (mesmo resultado bruto
 * pra todo mundo pego na área), mas cada Ator aplica sua própria redução em cima desse mesmo
 * total — tudo numa única mensagem de chat consolidada, não uma por alvo.
 * @param {Actor} actor - quem usou a skill
 * @param {object} mech - `skill.system` ou o snapshot de uma Sub-Skill
 * @param {string} label
 * @param {Actor[]} targetActors - Atores encontrados dentro da forma posicionada no canvas
 */
export async function rollSkillDamageArea(actor, mech, label, targetActors, rollOptions = null) {
  const formula = mech.damageFormula?.trim();
  if (!formula) {
    ui.notifications?.warn("Essa skill não tem uma Fórmula de Dano configurada.");
    return null;
  }
  if (!targetActors.length) {
    ui.notifications?.warn("Nenhum alvo encontrado na área.");
    return null;
  }

  const options = normalizeRollOptions(rollOptions);
  const roll = new Roll(applyAdvantageToFormula(applyLuckToFormula(formula, luckOf(actor, "damage")), options.advantage));
  await roll.evaluate();

  // Mesma escala por Atributo do caminho de alvo único — aplicada UMA vez, sobre a rolagem que
  // todos os alvos compartilham (cada alvo ainda aplica as próprias reduções depois).
  const scaling = damageScalingMultiplier(actor, mech.scalingAttribute);
  const levelPower = skillLevelBonuses(mech.level).power * (mech.investPower ?? 1);
  const scaledTotal = roll.total * scaling * levelPower;
  // Golpe de arma de Skill (H6): a Maestria que cobre o tipo multiplica, como no alvo único.
  const mastery = strikeMasteryBonus(actor, mech);
  const bonusTotal = applyShipWeaponBonus(mastery ? scaledTotal * masteryFactor(mastery.percent) : scaledTotal, actor);
  const boostedTotal = applyRollModifiers(bonusTotal, options);
  // O que mudou a rolagem, com o mesmo nome que o card de alvo único usa (não "bônus de arma"
  // para tudo: quase sempre é a Escala por Atributo ou o nível).
  const boostParts = [];
  if (scaling !== 1) boostParts.push(`${getAttributeLabel(mech.scalingAttribute)} ×${scaling.toFixed(1)}`);
  if (levelPower !== 1) boostParts.push(`${mech.investPower && mech.investPower !== 1 ? `nível e investimento de ${getEnergyLabelForActor(actor)}` : "nível"} ×${levelPower.toFixed(2)}`);
  if (mastery) boostParts.push(`Maestria ${mastery.label} +${formatMasteryPercent(mastery.percent)}%`);
  else if (bonusTotal !== scaledTotal) boostParts.push("bônus de arma");
  if (boostedTotal !== bonusTotal) boostParts.push("modificadores");
  const title = `${damageFlavorPrefix(mech, label)} (Emissão)${modifiersFlavor(options, bonusTotal, boostedTotal)}`;
  const rows = [];
  // Estrutura entre a origem da área e um alvo: ela leva o golpe UMA vez e protege todos atrás
  // dela na mesma proporção (a parede não apanha de novo pra cada um que está escondido).
  const origin = targetActors.origin ?? null;
  const shielded = new Map(); // id da Estrutura → fração que passa
  const blockedNotes = [];
  // Antimagia: cobra UMA vez (pelo maior nível entre os alvos); sem pagar, quem estava atrás ou
  // dentro de um campo não leva nada.
  const antimagic = await chargeAntimagic(actor, mech, targetActors, { origin });
  if (antimagic.note) blockedNotes.push(antimagic.note.replace(/^ — /, ""));
  // Nunca revela NO CHAT que/quanto de Resistência, Defesa Mágica, Penetração ou Redução de
  // Casco foi aplicada — só o número final por alvo (a redução em si continua acontecendo).
  // Rastro por alvo, só do Mestre (ver renderDamageTrace).
  const traces = [];
  const applyEntries = [];
  // O dano final de cada alvo, pra XP por uso da Skill (damageXpMeasures em skill-effects.js).
  const hits = [];
  for (const targetActor of targetActors) {
    // Escala por alvo: a mesma rolagem vale diferente contra uma pessoa e contra uma Nave.
    const scale = damageScaleFor(actor, mech, targetActor);
    const situational = situationalDamageFactor(actor, targetActor, mech);
    let targetDamage = boostedTotal * scale * situational;
    if (antimagic.nulled.has(targetActor.uuid)) {
      rows.push(`<li><strong>${escapeHtml(targetActor.name)}</strong>: 0 (anulado pelo campo)</li>`);
      traces.push({ name: targetActor.name, rows: attackTraceRows({ rolled: roll.total, boosted: boostedTotal, scale, situational, nulled: true, mastery }) });
      continue;
    }
    const beforeStructure = targetDamage;
    const block = interceptingStructure(actor, targetActor, { origin });
    if (block) {
      if (!shielded.has(block.instance.id)) {
        const { absorbed, passed, label: wall, broken, side } = await hitStructure(block, targetDamage, mech.damageElements, targetActor, { absolute: Boolean(mech.isAbsoluteDamage) });
        shielded.set(block.instance.id, targetDamage > 0 ? passed / targetDamage : 1);
        const held = Math.max(0, Math.round(targetDamage - passed));
        const lost = Math.round(absorbed);
        const sideNote = side ? `, golpe de ${side.inside ? "dentro" : "fora"}: ${side.percent}%` : "";
        if (broken) blockedNotes.push(`${escapeHtml(wall)} se desfez com o golpe`);
        else if (absorbed) blockedNotes.push(held === lost && !side ? `${escapeHtml(wall)} bloqueou ${held}` : `${escapeHtml(wall)} segurou ${held} do golpe (perdeu ${lost} de Vida${sideNote})`);
      }
      targetDamage = Math.round(targetDamage * shielded.get(block.instance.id));
    }
    const traceRows = attackTraceRows({ rolled: roll.total, boosted: boostedTotal, scale, situational, beforeStructure, arriving: targetDamage, mastery });
    traces.push({ name: targetActor.name, rows: traceRows });
    if (isShipLike(targetActor)) {
      const ctx = averageElementContext(mech.damageElements, targetActor);
      const { toShield, toCasco, toHull, structuralHits, traceRows: cascadeRows } = await applyStarshipDamageCascade(targetDamage, actor, targetActor, null, {
        penetration: ctx.penetration,
        bonus: ctx.bonus,
        shieldDrain: ctx.shieldDrain,
        layers: ctx.layers,
        shipEffects: ctx.shipEffects,
        conditions: ctx.conditions,
        elementIds: ctx.elementIds,
        askModule: false,
        absolute: Boolean(mech.isAbsoluteDamage)
      });
      traceRows.push(...(cascadeRows ?? []));
      hits.push({ actor: targetActor, damage: toShield + toCasco + toHull });
      const detalhe = structuralHits?.length ? ` (${structuralHits.map(h => (h.damage == null ? escapeHtml(h.name) : `${escapeHtml(h.name)} -${h.damage}`)).join(", ")})` : "";
      rows.push(
        `<li><strong>${escapeHtml(targetActor.name)}</strong>: Escudo -${toShield} · Casco -${toCasco} · Integridade Estrutural -${toHull}${detalhe}</li>`
      );
    } else {
      const reduction = applyDamageReductions(targetDamage, mech, targetActor, { attacker: actor, onHit: true });
      await grantResistanceXp(reduction.defenders, targetActor);
      await registerResistanceExposure(targetActor, mech.damageElements, reduction.finalDamage);
      // Botões por alvo no card (Aplicar / em todos / aos selecionados — ver damage-apply.js): o
      // número de cada um já sai com as defesas dele, e as Condições disparadas só valem quando o
      // Mestre aplica, como no alvo único. Área não cai em parte do corpo (`noBodyPart`).
      const hit = damageEntryFrom(targetActor, reduction, mech, label, { noBodyPart: true, surface: surfaceOrigin(mech, actor) });
      if (hit) applyEntries.push({ ...hit, name: targetActor.name });
      hits.push({ actor: targetActor, damage: reduction.finalDamage });
      rows.push(`<li><strong>${escapeHtml(targetActor.name)}</strong>: ${reduction.finalDamage}${reactionLabel(reduction.reactions)}${triggeredLabel(reduction.triggeredConditions)}</li>`);
      // Reação que espalha: quem está perto e carrega o mesmo elemento (fora quem já é alvo da área).
      if (reduction.reactions?.some(r => r.spread)) {
        const conducted = await conductReactions(reduction.reactions, targetActor, mech, {
          attacker: actor,
          reduce: applyDamageReductions,
          makeEntry: (who, red, lbl) => damageEntryFrom(who, red, mech, lbl, { noBodyPart: true }),
          label,
          exclude: targetActors.map(t => t.uuid)
        });
        applyEntries.push(...conducted.entries);
        traces.push(...conducted.trace);
        if (conducted.notes.length) rows.push(`<li>↳ conduzido: ${conducted.notes.map(escapeHtml).join(", ")}</li>`);
      }
      traceRows.push(...personalTraceTail(reduction, targetActor));
    }
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: [roll],
    flavor: title,
    flags: withDamageTrace(applyEntries.length ? { [SYSTEM_ID]: { damageApplyMany: { entries: applyEntries } } } : {}, traces),
    content: `<p>${title} — rolagem bruta: <strong>${roll.total}</strong>${boostedTotal !== roll.total ? ` (${escapeHtml(boostParts.join(" · ") || "ajustada")} → ${Math.round(boostedTotal)})` : ""}</p>${blockedNotes.length ? `<p>${blockedNotes.join(" · ")}</p>` : ""}<ul>${rows.join("")}</ul>`
  });

  return { roll, hits };
}
