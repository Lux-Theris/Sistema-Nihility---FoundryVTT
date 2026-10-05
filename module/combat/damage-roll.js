/**
 * Rolar dano de Skill/arma: escala, bônus, Shift, Estruturas no caminho, reduções do alvo por elemento e o card de dano.
 * (Separado de skill-effects.js na reorganização de pastas — mesma lógica de antes.)
 */
import { SYSTEM_ID, isMagicUse, damageElementChain, getActiveDamageElements, getActiveStatusConditions, getEnergyLabelForActor, getAttributeLabel, damageScalingMultiplier, skillLevelBonuses, getDamageElement, actorTraits, isScaleEnabled, getFeatureOption, actorScaleIndex, scaleIndexOf, actorElements, getElementAffinityMatrix, getAffinityConfig } from "../core/config.js";
import { playSkillAnimation } from "../core/vfx.js";
import { damageApplyFlags, withDamageTrace } from "./damage-apply.js";
import { magazineState } from "../economy/consumable-rules.js";
import { applyAdvantageToFormula, applyRollModifiers, describeRollOptions, normalizeRollOptions } from "../core/roll-modifiers.js";
import { splitDamageParts, resolveDamageParts, describeDamageParts, scaleMultiplier, rollChance, elementVsDefender, chainedResistance, inheritedElementEffects } from "./damage-rules.js";
import { conditionalBonus } from "./conditional-context.js";
import { interceptingStructure, hitStructure } from "../structures/structures.js";
import { chargeAntimagic } from "./antimagic.js";
import { applyEffectsToActor } from "../skills/effects-apply.js";
import { promptTargetBodyPart } from "../species/anatomy.js";
import { suppressionLevel } from "../skills/dispel.js";
import { magicDefenseReduction, resistanceSourceFor, grantResistanceXp, registerResistanceExposure } from "./resistance.js";
import { isShipLike, applyShipWeaponBonus, applyStarshipDamageCascade } from "../starship/ship-damage.js";

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
export function attackTraceRows({ rolled, boosted, scale = 1, situational = 1, beforeStructure = null, arriving, nulled = false }) {
  const rows = [{ label: "Rolagem", value: String(rolled) }];
  if (Math.floor(boosted) !== rolled) rows.push({ label: "Com escala por atributo, nível, bônus de arma e Shift", value: String(Math.floor(boosted)) });
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
function personalTraceTail(reduction, targetActor) {
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
  const parts = splitDamageParts(rawTotal, mech.damageElements).map(part => {
    const ctx = elementContext(part.elementId, targetActor);
    const affinity = bodyElements.length ? elementVsDefender(part.elementId, bodyElements, matrix, affinityConfig) : 1;
    return { ...part, penetration: ctx.penetration, bonus: ctx.bonus, affinity, ctx };
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
  const triggeredConditions = [];
  // Nível e magia do golpe vão junto com o que ele dispara (prancha 8: Antimagia e bloqueio de cura).
  const hitLevel = Math.max(1, Number(mech.level) || 1);
  const hitMagic = Boolean(mech.isMagicDamage) || mech.magicTag === "magic";
  result.parts.forEach((part, index) => {
    const ctx = parts[index].ctx;
    if (part.immune || !(part.final > 0)) return;
    shieldExtra += part.final * ctx.shieldDrain;
    if (options.triggerConditions === false) return;
    for (const effect of ctx.conditions) {
      if (rollChance(effect.chance)) triggeredConditions.push({ conditionId: effect.conditionId, elementId: part.elementId, hitDamage: part.final, level: hitLevel, magic: hitMagic });
    }
    for (const chance of ctx.sever) if (rollChance(chance)) sever = true;
    for (const effect of ctx.blockRegen) {
      if (rollChance(effect.chance)) triggeredConditions.push({ conditionId: effect.conditionId || "regen-blocked", elementId: part.elementId, blockRegen: true, rounds: effect.rounds, level: hitLevel, magic: hitMagic });
    }
  });

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
    sever
  };
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
    else if (effect.type === "condition" && effect.conditionId) ctx.conditions.push({ conditionId: effect.conditionId, chance: Number(effect.chance) || 0 });
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
      durationRounds: 0,
      conditionId: hit.conditionId,
      damageElements: hit.elementId ? [hit.elementId] : [],
      hitDamage: Math.max(0, (Number(hit.hitDamage) || 0) * factor),
      // Condição com "Impede cura" na parte atingida: prende-se à parte que levou o golpe.
      healBlockPartId: partId || ""
    };
    summary.push(...(await applyEffectsToActor({ effects: [entry], level: 1, hasUpkeep: false, sourceLevel: hit.level ?? 1, sourceMagic: Boolean(hit.magic) }, label, null, targetActor)));
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
    await existing.update({ "duration.rounds": rounds > 0 ? Math.max(rounds, existing.duration?.remaining ?? 0) : null });
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
  return ` — causa ${names.join(", ")}`;
}

/** "100", "0.01" — escala sem casas decimais inúteis. */
export function formatScale(value) {
  return value >= 1 ? String(Math.round(value * 100) / 100) : String(Number(value.toPrecision(2)));
}

/** Trecho do flavor com os modificadores do shift+clique e o efeito deles ("— +5 (…) (40 → 45)"). */
export function modifiersFlavor(options, before, after) {
  const text = describeRollOptions(options);
  if (!text) return "";
  return Math.floor(after) !== Math.floor(before) ? ` — ${text} (${Math.floor(before)} → ${Math.floor(after)})` : ` — ${text}`;
}

/** `label` já vem pronto de `useSkillEffect` (nome da Skill, ou "Skill — Sub-Skill" quando aplicável). */
function damageFlavorPrefix(mech, label) {
  const elementLabels = (mech.damageElements ?? [])
    .map(id => getActiveDamageElements().find(e => e.id === id)?.label)
    .filter(Boolean);
  return elementLabels.length ? `${label} — Dano ${elementLabels.join("+")}` : `${label} — Dano`;
}

/**
 * Estrutura no caminho (parede, barreira): ela segura o golpe primeiro, até a própria Vida — ou a
 * Mana de quem conjurou, numa barreira de mana — e só o resto chega no alvo, ANTES das defesas
 * dele. Vale até pra Dano Absoluto: a parede não *resiste* ao golpe, ela está na frente dele.
 * @returns {Promise<{damage: number, note: string}>}
 */
export async function throughStructures(attacker, targetActor, damage, { origin = null, elementIds = [] } = {}) {
  const block = interceptingStructure(attacker, targetActor, { origin });
  if (!block) return { damage, note: "", impact: null };
  const { absorbed, passed, label, point } = await hitStructure(block, damage, elementIds, targetActor);
  return { damage: passed, note: absorbed ? ` — ${label} bloqueou ${absorbed}` : "", impact: point };
}

export async function rollSkillDamage(actor, mech, label, targetActor = null, rollOptions = null) {
  const formula = mech.damageFormula?.trim();
  if (!formula) {
    ui.notifications?.warn("Essa skill não tem uma Fórmula de Dano configurada.");
    return null;
  }

  const options = normalizeRollOptions(rollOptions);
  const roll = new Roll(applyAdvantageToFormula(formula, options.advantage));
  await roll.evaluate();

  // Escala por Atributo (ver damageScalingMultiplier em config.js) — 1 quando a Skill não tem
  // Atributo de Escala escolhido, que é o padrão e o estado de todo conteúdo anterior à regra.
  const scaling = damageScalingMultiplier(actor, mech.scalingAttribute);
  // Nível da Skill e Mana investida (Mana variável) multiplicam juntos.
  const levelPower = skillLevelBonuses(mech.level).power * (mech.investPower ?? 1);
  const scaledTotal = roll.total * scaling * levelPower;
  // Nave: bônus de arma em `combatBonuses`; arma pessoal: `weaponBonuses` (via useWeaponAttack).
  const personal = mech.weaponBonus ? scaledTotal * (mech.weaponBonus.multiplier ?? 1) + (mech.weaponBonus.flat ?? 0) : scaledTotal;
  const bonusTotal = applyShipWeaponBonus(personal, actor);
  // Modificadores do shift+clique: depois de toda escala e bônus automáticos, antes das
  // reduções do alvo (ver roll-modifiers.js).
  const boostedTotal = applyRollModifiers(bonusTotal, options);

  let flavor = damageFlavorPrefix(mech, label);
  if (scaling !== 1) {
    flavor += ` — ${getAttributeLabel(mech.scalingAttribute)} ×${scaling.toFixed(1)}`;
  }
  if (levelPower !== 1) flavor += ` — ${mech.investPower && mech.investPower !== 1 ? `nível e ${getEnergyLabelForActor(actor)} investida` : "nível"} ×${levelPower.toFixed(2)}`;
  if (scaledTotal !== roll.total) flavor += ` (${roll.total} → ${Math.floor(scaledTotal)})`;
  if (bonusTotal !== scaledTotal) flavor += ` — bônus de arma (${Math.floor(scaledTotal)} → ${Math.floor(bonusTotal)})`;
  flavor += modifiersFlavor(options, bonusTotal, boostedTotal);

  // Escala: pistola contra Nave, canhão contra pessoa (ver damageScaleFor).
  const scale = damageScaleFor(actor, mech, targetActor);
  const situational = situationalDamageFactor(actor, targetActor, mech);
  const rawDamage = boostedTotal * scale * situational;
  if (scale !== 1) flavor += ` — escala ×${formatScale(scale)}`;
  // Parede/barreira entre quem ataca e o alvo segura primeiro (ver throughStructures).
  // Antimagia: ataque mágico que cruza um campo (ou sob Selo) paga a energia extra ou é anulado.
  const antimagic = targetActor ? await chargeAntimagic(actor, mech, [targetActor]) : null;
  if (antimagic?.note) flavor += antimagic.note;
  if (antimagic?.nulled.has(targetActor.uuid)) {
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${flavor} — ${targetActor.name}: 0`,
      flags: withDamageTrace({}, [{ name: targetActor.name, rows: attackTraceRows({ rolled: roll.total, boosted: boostedTotal, scale, situational, nulled: true }) }])
    });
    return { roll, finalDamage: 0 };
  }
  // Alvo Suprimido (Antimagia): golpe mágico de alvo único, de nível ≤ a supressão, não tem efeito.
  // Em área continua acertando (rollSkillDamageArea não passa por aqui).
  const suppressedAt = targetActor?.type === "character" ? suppressionLevel(targetActor) : null;
  if (suppressedAt !== null && (isMagicUse(mech, actor) || mech.magicTag === "magic") && (Number(mech.level) || 1) <= suppressedAt) {
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${flavor} — ${targetActor.name}: sem efeito (Suprimido)` });
    return { roll, finalDamage: 0 };
  }
  const blocked = targetActor ? await throughStructures(actor, targetActor, rawDamage, { elementIds: mech.damageElements }) : { damage: rawDamage, note: "", impact: null };
  const scaledDamage = blocked.damage;
  const traceRows = attackTraceRows({ rolled: roll.total, boosted: boostedTotal, scale, situational, beforeStructure: rawDamage, arriving: scaledDamage });
  flavor += blocked.note;
  // A animação da Skill para no ponto de impacto se uma parede segurou, e só segue até o alvo se
  // sobrou dano (arma pessoal não tem animação, então nada acontece pra ela).
  playSkillAnimation(actor, mech, { targetActor, impact: blocked.impact, passesThrough: blocked.damage > 0 });

  let finalDamage;
  let reduction = null;
  let aimedPart = null;
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
    flavor += ` — Escudo -${toShield} · Casco -${toCasco} · Integridade Estrutural -${toHull}`;
    if (structuralHits?.length) flavor += ` (${structuralHits.map(h => (h.damage == null ? h.name : `${h.name} -${h.damage}`)).join(", ")})`;
  } else {
    // Nunca revela NO CHAT que/quanto de Resistência ou Defesa Mágica foi aplicada — só o
    // número final. A redução em si continua acontecendo (applyDamageReductions), só não
    // aparece na mensagem (nem a existência dela, mesmo quando reduz a 0).
    reduction = applyDamageReductions(scaledDamage, mech, targetActor, { attacker: actor });
    finalDamage = reduction.finalDamage;
    // Defender é o que faz uma Skill de Resistência evoluir — ela aprende apanhando. E levar
    // golpes de um tipo que ainda não se resiste é o que faz a Skill poder nascer.
    await grantResistanceXp(reduction.defenders, targetActor);
    await registerResistanceExposure(targetActor, mech.damageElements, finalDamage);
    // O `roll.toMessage()` abaixo mostra o total BRUTO da rolagem — sem esta linha o número
    // final (já reduzido) nunca chegava ao chat, e o Mestre acabava aplicando o bruto: na
    // prática, Resistência e Defesa Mágica não valiam nada contra alvo único. Mesmo formato
    // "Alvo: número" que a versão em área (`rollSkillDamageArea`) já usava.
    if (targetActor) flavor += ` — ${targetActor.name}: ${finalDamage}${triggeredLabel(reduction.triggeredConditions)}`;
    if (targetActor) traceRows.push(...personalTraceTail(reduction, targetActor));
    // Ferimentos por parte: quem ataca pode mirar numa parte (senão o Aplicar sorteia uma).
    if (targetActor && finalDamage > 0) aimedPart = await promptTargetBodyPart(targetActor);
    if (aimedPart) flavor += ` (mirando: ${aimedPart.name})`;
  }

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    // Dados dos botões de Aplicar/Desfazer (ver module/damage-apply.js). Ficam em `flags` e não
    // no conteúdo: quem abrir o chat depois vê o mesmo estado de quem estava online.
    flags: withDamageTrace(
      damageApplyFlags(targetActor, finalDamage, {
        shieldBase: reduction?.shieldBase,
        elementIds: reduction?.elementIds ?? [],
        absolute: Boolean(mech.isAbsoluteDamage),
        shieldExtra: reduction?.shieldExtra ?? 0,
        shieldMultiplier: reduction?.shieldMultiplier ?? 1,
        shieldPenetration: reduction?.shieldPenetration ?? 0,
        triggeredConditions: reduction?.triggeredConditions ?? [],
        sever: Boolean(reduction?.sever),
        bodyPart: aimedPart,
        label
      }),
      targetActor ? [{ name: targetActor.name, rows: traceRows }] : []
    )
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
  if (!weapon.damageFormula?.trim()) {
    ui.notifications?.warn(`${weaponItem.name} não tem uma Fórmula de Dano configurada.`);
    return null;
  }

  // Carregador (consumables.js): sem disparo, não ataca; a munição que está dentro troca a
  // fórmula/elementos e pode tornar o golpe Absoluto.
  const magazine = magazineState({ size: weapon.magazineSize, loaded: weapon.loaded });
  if (magazine.uses && magazine.empty) {
    ui.notifications?.warn(`${weaponItem.name} está sem munição — use Recarregar.`);
    return null;
  }
  const ammo = magazine.uses ? weapon.loadedAmmo ?? null : null;

  // Aprimoramento vindo de Skills (alvos "weapon*"): vale pra qualquer arma equipada do Ator.
  const bonuses = sourceActor.system.weaponBonuses ?? {};
  const override = bonuses.elementOverride && getDamageElement(bonuses.elementOverride) ? bonuses.elementOverride : "";
  const result = await rollSkillDamage(
    sourceActor,
    {
      damageFormula: ammo?.damageFormula?.trim() || weapon.damageFormula,
      scalingAttribute: weapon.scalingAttribute,
      isMagicDamage: weapon.isMagicDamage || (bonuses.forceMagic ?? 0) > 0,
      isAbsoluteDamage: weapon.isAbsoluteDamage || Boolean(ammo?.isAbsoluteDamage) || (bonuses.absolute ?? 0) > 0,
      damageScale: weapon.damageScale,
      damageElements: override ? [override] : ammo?.damageElements?.length ? ammo.damageElements : weapon.damageElements,
      weaponBonus: { flat: Number(bonuses.damageFlat) || 0, multiplier: bonuses.damageMultiplier ?? 1 },
      level: 1
    },
    ammo?.label ? `${weaponItem.name} (${ammo.label})` : weaponItem.name,
    targetActor,
    rollOptions
  );
  if (result && magazine.uses) await weaponItem.update({ "system.weapon.loaded": magazine.loaded - 1 });
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
  const roll = new Roll(applyAdvantageToFormula(formula, options.advantage));
  await roll.evaluate();

  // Mesma escala por Atributo do caminho de alvo único — aplicada UMA vez, sobre a rolagem que
  // todos os alvos compartilham (cada alvo ainda aplica as próprias reduções depois).
  const scaling = damageScalingMultiplier(actor, mech.scalingAttribute);
  const bonusTotal = applyShipWeaponBonus(roll.total * scaling * skillLevelBonuses(mech.level).power * (mech.investPower ?? 1), actor);
  const boostedTotal = applyRollModifiers(bonusTotal, options);
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
      rows.push(`<li><strong>${targetActor.name}</strong>: 0 (antimagia)</li>`);
      traces.push({ name: targetActor.name, rows: attackTraceRows({ rolled: roll.total, boosted: boostedTotal, scale, situational, nulled: true }) });
      continue;
    }
    const beforeStructure = targetDamage;
    const block = interceptingStructure(actor, targetActor, { origin });
    if (block) {
      if (!shielded.has(block.instance.id)) {
        const { absorbed, passed, label: wall } = await hitStructure(block, targetDamage, mech.damageElements, targetActor);
        shielded.set(block.instance.id, targetDamage > 0 ? passed / targetDamage : 1);
        if (absorbed) blockedNotes.push(`${wall} bloqueou ${absorbed}`);
      }
      targetDamage = Math.round(targetDamage * shielded.get(block.instance.id));
    }
    const traceRows = attackTraceRows({ rolled: roll.total, boosted: boostedTotal, scale, situational, beforeStructure, arriving: targetDamage });
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
      const detalhe = structuralHits?.length ? ` (${structuralHits.map(h => (h.damage == null ? h.name : `${h.name} -${h.damage}`)).join(", ")})` : "";
      rows.push(
        `<li><strong>${targetActor.name}</strong>: Escudo -${toShield} · Casco -${toCasco} · Integridade Estrutural -${toHull}${detalhe}</li>`
      );
    } else {
      const reduction = applyDamageReductions(targetDamage, mech, targetActor, { attacker: actor });
      await grantResistanceXp(reduction.defenders, targetActor);
      await registerResistanceExposure(targetActor, mech.damageElements, reduction.finalDamage);
      // Botões por alvo no card (Aplicar / em todos / aos selecionados — ver damage-apply.js): o
      // número de cada um já sai com as defesas dele, e as Condições disparadas só valem quando o
      // Mestre aplica, como no alvo único. Área não cai em parte do corpo (`noBodyPart`).
      const hit = damageApplyFlags(targetActor, reduction.finalDamage, {
        shieldBase: reduction.shieldBase,
        elementIds: reduction.elementIds ?? [],
        absolute: Boolean(mech.isAbsoluteDamage),
        shieldExtra: reduction.shieldExtra ?? 0,
        shieldMultiplier: reduction.shieldMultiplier ?? 1,
        shieldPenetration: reduction.shieldPenetration ?? 0,
        triggeredConditions: reduction.triggeredConditions ?? [],
        sever: Boolean(reduction.sever),
        noBodyPart: true,
        label
      })[SYSTEM_ID]?.damageApply;
      if (hit) applyEntries.push({ ...hit, name: targetActor.name });
      hits.push({ actor: targetActor, damage: reduction.finalDamage });
      rows.push(`<li><strong>${targetActor.name}</strong>: ${reduction.finalDamage}${triggeredLabel(reduction.triggeredConditions)}</li>`);
      traceRows.push(...personalTraceTail(reduction, targetActor));
    }
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: [roll],
    flavor: title,
    flags: withDamageTrace(applyEntries.length ? { [SYSTEM_ID]: { damageApplyMany: { entries: applyEntries } } } : {}, traces),
    content: `<p>${title} — rolagem bruta: <strong>${roll.total}</strong>${boostedTotal !== roll.total ? ` (bônus de arma: ${Math.floor(boostedTotal)})` : ""}</p>${blockedNotes.length ? `<p>${blockedNotes.join(" · ")}</p>` : ""}<ul>${rows.join("")}</ul>`
  });

  return { roll, hits };
}
