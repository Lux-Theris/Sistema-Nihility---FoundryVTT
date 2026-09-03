/**
 * "Usar Habilidade": aplica a mecânica de uma Skill (system.effectType).
 *  - "damage": rola `damageFormula` (fórmula livre do Foundry) e posta no chat
 *    PÚBLICO (diferente da Voz do Mundo, que é só pra progressão/meta).
 *  - "temporary": aplica cada entrada de `effects` — atributos/HP/Mana viram
 *    Active Effects de verdade com duração (expiram sozinhos, nunca alteram o
 *    HP/Mana Máximo mesmo quando o alvo é um atributo); "shield" é somado
 *    direto, sem duração, gasto na mão pelo jogador conforme absorve dano.
 */
import { SYSTEM_ID, MEU_SISTEMA, getActiveDamageElements, getActiveStatusConditions, getEnergyLabelForActor } from "./config.js";
import { announceVoiceOfTheWorld } from "./voice-of-the-world.js";
import { playSkillAnimation } from "./vfx.js";

const EFFECT_TARGET_PATHS = {
  strength: "system.attributes.combat.strength.buffDelta",
  defense: "system.attributes.combat.defense.buffDelta",
  magic: "system.attributes.combat.magic.buffDelta",
  magicalDefense: "system.attributes.combat.magicalDefense.buffDelta",
  dexterity: "system.attributes.combat.dexterity.buffDelta",
  stealth: "system.attributes.combat.stealth.buffDelta",
  precision: "system.attributes.combat.precision.buffDelta",
  hp: "system.attributes.hp.buffDelta",
  energy: "system.attributes.energy.buffDelta"
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

/** Caminho de update pro flag `active` — top-level ou dentro de um Sub-Skill específico. */
function activeStatePath(subSkillIndex) {
  return subSkillIndex != null ? `system.subSkills.${subSkillIndex}.active` : "system.active";
}

/**
 * Caminho e valor atual do "pool" que Custo/Custo por Rodada de uma Skill gastam — Personagem/
 * Criatura usa Mana/Energia (`attributes.energy`); Nave e Veículo (mesmo Grid de Energia desde
 * o overhaul de Porte) usam o Reator (`powerGrid.reactorOutput`), NUNCA o Capacitor (decisão
 * deliberada: Habilidade Ativa de Nave/Veículo compete só com a geração do Reator, sem
 * interagir com o resto do Grid/surplus-deficit que `applyPowerGridTick` já cobre).
 */
function energyValuePath(actor) {
  return isShipLike(actor) ? "system.powerGrid.reactorOutput" : "system.attributes.energy.value";
}
function currentEnergyValue(actor) {
  return isShipLike(actor) ? (actor.system.powerGrid.reactorOutput ?? 0) : (actor.system.attributes.energy.value ?? 0);
}

/** Avisa só quem clicou (whisper individual) que a Energia (nome configurável) atual não cobre o Custo. */
async function warnInsufficientEnergy(sourceActor, label, cost) {
  const current = currentEnergyValue(sourceActor);
  const energyLabel = getEnergyLabelForActor(sourceActor);
  await ChatMessage.create({
    whisper: [game.user.id],
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p>${energyLabel} insuficiente pra usar <strong>${label}</strong> (precisa ${cost}, ${sourceActor.name} tem ${current}).</p>`
  });
}

/**
 * Desliga a "âncora" desta Skill/Sub-Skill "Ativa" em TODOS os Atores do mundo — chamado ao
 * desativar (clique manual ou falta de Energia, ver `useSkillEffect`/`tickActorUpkeepSkills`).
 * Precisa varrer `game.actors` (não só quem usou a Skill) porque um Efeito de Emissão em área
 * pode ter afetado vários Atores diferentes: a área só serviu pra ESCOLHER os alvos no momento
 * de usar — o efeito em si vive em cada Ator atingido, não no espaço, então continua neles
 * mesmo se saírem do lugar no canvas depois, até a Skill ser desativada aqui.
 *
 * Buff/debuff comum (`tiedToActive`): apaga o Active Effect direto — não tem ticks nem outras
 * fontes pra segurar ele vivo. Periódico (Veneno/cura, `activeAnchors`): só REMOVE esta fonte da
 * lista de âncoras — se ainda sobrar outra âncora (outra Skill Ativa também mantendo o mesmo
 * Veneno+elemento), o efeito continua vivo; só apaga de fato quando não sobra nenhuma âncora E
 * os ticks de fontes finitas já zeraram.
 * @param {Item} skill
 * @param {number|null} subSkillIndex
 */
async function removeUpkeepLinkedEffects(skill, subSkillIndex) {
  const isThisSource = flags => flags.sourceSkillId === skill.id && (flags.sourceSubSkillIndex ?? null) === subSkillIndex;

  for (const actor of game.actors) {
    for (const effect of actor.effects) {
      const flags = effect.flags?.[SYSTEM_ID];
      if (!flags) continue;

      if (flags.periodic) {
        const anchors = flags.activeAnchors ?? [];
        const remaining = anchors.filter(a => !(a.sourceSkillId === skill.id && (a.sourceSubSkillIndex ?? null) === subSkillIndex));
        if (remaining.length === anchors.length) continue; // esta Skill não era âncora deste efeito
        if (!remaining.length && (flags.ticksRemaining ?? 0) <= 0) {
          await effect.delete();
        } else {
          await effect.update({ [`flags.${SYSTEM_ID}.activeAnchors`]: remaining });
        }
      } else if (flags.tiedToActive && isThisSource(flags)) {
        await effect.delete();
      }
    }
  }
}

/**
 * Ponto de entrada único de "Usar Habilidade".
 *  - `targetType: "targeted"` (padrão): usa `options.targetActor` (1 Ator, escolhido via
 *    dropdown em actor-sheet.js) — comportamento de sempre.
 *  - `targetType: "emission"`: usa `options.targetActors` (lista já resolvida pela forma
 *    posicionada no canvas via module/area-effects.js) — sem alvo único envolvido.
 *  - `options.subSkillIndex`: quando a Skill tem Sub-Skills (só existe em Skills Fundidas —
 *    ver skill-economy.js#fuseSkills), a mecânica usada é a daquele componente específico
 *    (`system.subSkills[i]`, que carrega seu próprio effectType/damageFormula/effects/
 *    targetType/etc.) em vez da mecânica própria da Skill — igual as Skills Únicas do
 *    Tensura, que têm várias sub-habilidades nomeadas dentro de uma só Skill "guarda-chuva".
 *    `actor-sheet.js` já resolve qual índice antes de chamar isto (ver `_promptSubSkillChoice`).
 *
 * Custo de Energia (`mech.cost`) é cobrado UMA VEZ aqui, sempre — inclusive em Skills
 * "Descritiva" (effectType "none"), que agora também são "usáveis" (postam um anúncio simples
 * no chat em vez de só um toast). Skills "Ativas" (`mech.hasUpkeep`) alternam ligado/desligado a
 * cada clique: ligar cobra `cost` e passa a drenar `upkeepCost` por rodada (ver
 * `tickActorUpkeepSkills`, chamada do hook `updateCombat`); desligar (clique com `mech.active`
 * já true) nunca cobra de novo nem re-executa a mecânica — só para o dreno.
 * @param {Actor} sourceActor - dono da skill
 * @param {string} skillId
 * @param {{targetActor?: Actor, targetActors?: Actor[], subSkillIndex?: number}} [options]
 */
export async function useSkillEffect(sourceActor, skillId, options = {}) {
  const skill = sourceActor.items.get(skillId);
  if (!skill) return null;

  let mech = skill.system;
  let label = skill.name;
  if (options.subSkillIndex != null) {
    const sub = (skill.system.subSkills ?? [])[options.subSkillIndex];
    if (sub) {
      mech = sub;
      label = `${skill.name} — ${sub.name}`;
    }
  }

  if (mech.hasUpkeep && mech.active) {
    await skill.update({ [activeStatePath(options.subSkillIndex)]: false });
    await removeUpkeepLinkedEffects(skill, options.subSkillIndex ?? null);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
      content: `<p><strong>${sourceActor.name}</strong> desativou <strong>${label}</strong>.</p>`
    });
    return true;
  }

  const cost = Number(mech.cost) || 0;
  if (cost > 0) {
    const current = currentEnergyValue(sourceActor);
    if (current < cost) {
      await warnInsufficientEnergy(sourceActor, label, cost);
      return null;
    }
    await sourceActor.update({ [energyValuePath(sourceActor)]: current - cost });
  }
  if (mech.hasUpkeep) {
    await skill.update({ [activeStatePath(options.subSkillIndex)]: true });
  }

  // Dispara e esquece — nunca aguardado, a animação não deve atrasar a mecânica/chat.
  playSkillAnimation(sourceActor, mech, { targetActor: options.targetActor ?? options.targetActors?.[0] ?? null });

  const isEmission = mech.targetType === "emission";

  if (mech.effectType === "damage") {
    return isEmission
      ? rollSkillDamageArea(sourceActor, mech, label, options.targetActors ?? [])
      : rollSkillDamage(sourceActor, mech, label, options.targetActor ?? null);
  }
  if (mech.effectType === "temporary") {
    return isEmission
      ? applySkillEffectsArea(sourceActor, skill, mech, label, options.targetActors ?? [], options.subSkillIndex ?? null)
      : applySkillEffects(sourceActor, skill, mech, label, options.targetActor ?? sourceActor, options.subSkillIndex ?? null);
  }

  const upkeepNote = mech.hasUpkeep ? ` (ativada — drena ${mech.upkeepCost} de ${getEnergyLabelForActor(sourceActor)} por rodada)` : "";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p><strong>${sourceActor.name}</strong> usou <strong>${label}</strong>${upkeepNote}.</p>`
  });
  return true;
}

/**
 * Percentual (0-1) de redução aplicado sobre dano mágico/elemental, com base na Defesa
 * Mágica.Total do alvo. Ver MEU_SISTEMA.MAGIC_DEFENSE_REDUCTION_PER_POINT/_CAP em config.js.
 */
function magicDefenseReduction(targetActor) {
  const total = targetActor?.system?.attributes?.combat?.magicalDefense?.total ?? 0;
  const raw = total * MEU_SISTEMA.MAGIC_DEFENSE_REDUCTION_PER_POINT;
  return Math.clamp(raw, 0, MEU_SISTEMA.MAGIC_DEFENSE_REDUCTION_CAP);
}

/* -------------------------------------------- */
/*  Skills/Títulos de Resistência a Dano         */
/* -------------------------------------------- */

const GENERAL_RESISTANCE_MAX_LEVEL = 5; // 50% — nunca vira "Imunidade Geral" (seria OP demais)
const ELEMENT_RESISTANCE_MAX_LEVEL = 10; // 100% — Imunidade

/** Nível máximo que uma Skill de Resistência pode alcançar, conforme o alvo (Geral vs Elemento). */
export function resistanceMaxLevel(resistanceTarget) {
  return resistanceTarget === "general" ? GENERAL_RESISTANCE_MAX_LEVEL : ELEMENT_RESISTANCE_MAX_LEVEL;
}

/**
 * Nome derivado de uma Skill de Resistência a partir do alvo + nível atual. Resistência Geral
 * nunca "vira" Imunidade (capada no nível 5); Resistência a um Elemento vira Imunidade ao
 * cruzar o nível 10.
 */
export function computeResistanceName(resistanceTarget, level) {
  if (resistanceTarget === "general") return "Resistência Geral";
  const isImmune = level >= ELEMENT_RESISTANCE_MAX_LEVEL;
  const label = getActiveDamageElements().find(e => e.id === resistanceTarget)?.label ?? resistanceTarget;
  return `${isImmune ? "Imunidade" : "Resistência"}: ${label}`;
}

/** Percentual (0-1) de redução que uma Skill de Resistência dá no nível atual: 10%/nível, respeitando o teto de cada categoria. */
export function computeResistancePercent(resistanceTarget, level) {
  const cappedLevel = Math.min(Number(level) || 0, resistanceMaxLevel(resistanceTarget));
  return Math.max(0, cappedLevel) * 0.1;
}

/**
 * Maior percentual de Resistência (0-1) que `targetActor` tem pra `resistanceTarget`
 * ("general" ou um id de elemento), somando a melhor Skill de Resistência com a melhor
 * entrada de Título pra esse mesmo alvo (fontes diferentes somam; duplicadas da mesma
 * fonte não somam entre si, só a melhor conta).
 */
function actorResistanceFor(targetActor, resistanceTarget) {
  if (!targetActor) return 0;

  let bestSkill = 0;
  let bestTitle = 0;

  for (const item of targetActor.items) {
    if (item.type === "skill" && item.system.resistanceTarget === resistanceTarget) {
      bestSkill = Math.max(bestSkill, computeResistancePercent(resistanceTarget, item.system.level));
    } else if (item.type === "title") {
      for (const entry of item.system.resistances ?? []) {
        if (entry.target === resistanceTarget) bestTitle = Math.max(bestTitle, (Number(entry.amount) || 0) / 100);
      }
    }
  }

  return bestSkill + bestTitle;
}

/** Nave OU Veículo — os dois compartilham o mesmo `ShipSystemsDataModel` desde o overhaul de Porte. */
function isShipLike(actor) {
  return ["starship", "vehicle"].includes(actor?.type);
}

/**
 * Bônus de arma de uma Nave/Veículo atacante (`combatBonuses`, dado por Skills de "Efeito
 * Temporário" com alvo shipWeaponDamage — ver EFFECT_TARGETS em config.js): Multiplicador
 * primeiro, Flat depois, igual a ordem de operações padrão. `rawTotal` sem mudança se quem
 * atacou não for Nave/Veículo.
 */
function applyShipWeaponBonus(rawTotal, sourceActor) {
  if (!isShipLike(sourceActor)) return rawTotal;
  const bonuses = sourceActor.system.combatBonuses;
  return rawTotal * (bonuses?.weaponDamageMultiplier ?? 1) + (bonuses?.weaponDamageFlat ?? 0);
}

/**
 * Penetração (0-1) da arma de uma Nave/Veículo atacante — hoje só reflete o bônus de Skills de
 * aprimoramento (`combatBonuses.weaponPenetrationFlat`/Multiplier); a Arma ainda não tem seu
 * próprio campo `penetration` base (isso é a Fase 5 do overhaul de Naves — dano/penetração/
 * recarga na própria Módulo). Quando existir, a fórmula vira `base × multiplier + flat` sozinha,
 * sem precisar mudar mais nada aqui. `0` se quem atacou não for Nave/Veículo.
 */
function shipWeaponPenetration(sourceActor) {
  if (!isShipLike(sourceActor)) return 0;
  const bonuses = sourceActor.system.combatBonuses;
  const base = 0;
  return Math.clamp(base * (bonuses?.weaponPenetrationMultiplier ?? 1) + (bonuses?.weaponPenetrationFlat ?? 0) / 100, 0, 1);
}

/** Absorve `amount` num pool (capado no que resta) — retorna quanto foi absorvido e quanto vazou pro próximo estágio. */
function absorbIntoPool(amount, poolValue) {
  const absorbed = Math.min(poolValue, amount);
  return { absorbed, leaked: amount - absorbed };
}

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
 * @returns {{toShield:number, toCasco:number, toHull:number, appliedReductions:string[]}}
 */
async function applyStarshipDamageCascade(rawDamage, sourceActor, targetActor) {
  const penetration = shipWeaponPenetration(sourceActor);
  const cascoHasProtection = targetActor.system.casco.value > 0;
  const armorReduction = cascoHasProtection ? (targetActor.system.armorReductionPercent ?? 0) : 0;
  const appliedReductions = [];
  if (penetration > 0) appliedReductions.push(`Penetração ${Math.round(penetration * 100)}%`);
  if (armorReduction > 0) appliedReductions.push(`Redução de Casco ${Math.round(armorReduction * 100)}%`);

  const updates = {};

  // 1) Escudo — separado pela Penetração; o que não penetrou tenta ser absorvido pelo Escudo
  // (capado no que resta), o resto (penetrado + excedente) vaza pro Casco.
  const shieldTargeted = Math.floor(rawDamage * (1 - penetration));
  const shieldBypass = Math.floor(rawDamage) - shieldTargeted;
  const { absorbed: toShield, leaked: shieldOverflow } = absorbIntoPool(shieldTargeted, targetActor.system.shields.value);
  let remaining = shieldBypass + shieldOverflow;

  if (toShield > 0) {
    const newShieldValue = targetActor.system.shields.value - toShield;
    updates["system.shields.value"] = newShieldValue;
    if (newShieldValue <= 0) {
      updates["system.shields.rechargeRemaining"] = targetActor.system.shieldModule?.system.shieldRechargeRounds ?? 0;
    }
  }

  // 2) Casco — primeiro reduzido pela Redução% do Módulo, DEPOIS separado de novo pela mesma
  // Penetração; o que não penetrou tenta ser absorvido pelo Casco (capado no que resta), o
  // resto vaza pra Estrutura.
  let toCasco = 0;
  if (remaining > 0) {
    const afterReduction = Math.floor(remaining * (1 - armorReduction));
    const cascoTargeted = Math.floor(afterReduction * (1 - penetration));
    const cascoBypass = afterReduction - cascoTargeted;
    const { absorbed, leaked } = absorbIntoPool(cascoTargeted, targetActor.system.casco.value);
    toCasco = absorbed;
    remaining = cascoBypass + leaked;
    if (toCasco > 0) updates["system.casco.value"] = targetActor.system.casco.value - toCasco;
  }

  // 3) Estrutura — recebe o que sobrou, sem redução própria.
  const toHull = Math.max(0, remaining);
  if (toHull > 0) updates["system.hull.value"] = Math.max(0, targetActor.system.hull.value - toHull);

  if (Object.keys(updates).length) await targetActor.update(updates);

  return { toShield, toCasco, toHull, appliedReductions };
}

/**
 * Aplica Defesa Mágica + Resistência (Geral/Elemental) sobre um dano bruto já rolado, pra um
 * alvo específico. Compartilhado entre o caminho de alvo único, o de Emissão (área) e os ticks
 * periódicos (Veneno) — o roll/tick em si acontece uma vez só, mas cada alvo aplica sua própria
 * redução em cima do mesmo total. `mech` é `skill.system`, o snapshot de uma Sub-Skill, ou (pro
 * caso de tick) um objeto sintético `{ damageElements }` — mesmo formato de campos
 * (isMagicDamage/damageElements) nos três casos.
 * @param {{skipMagicDefense?: boolean, sourceActor?: Actor}} [options] - `skipMagicDefense: true`
 *   pula o passo de Defesa Mágica mesmo com `mech.isMagicDamage` true — usado pelos ticks
 *   periódicos, onde Veneno Mágico ignora Defesa Mágica de propósito (só Resistência reduz),
 *   diferente do dano "normal" de uma Skill. Nave/Veículo NÃO passa por aqui — usa a cascata de
 *   3 camadas própria (`applyStarshipDamageCascade`), chamada direto de `rollSkillDamage`/
 *   `rollSkillDamageArea` antes desta função entrar em jogo.
 */
function applyDamageReductions(rawTotal, mech, targetActor, options = {}) {
  let remaining = rawTotal;
  const appliedReductions = [];

  if (mech.isMagicDamage && targetActor && !options.skipMagicDefense) {
    const reduction = magicDefenseReduction(targetActor);
    if (reduction > 0) {
      remaining *= 1 - reduction;
      appliedReductions.push(`Defesa Mágica ${Math.round(reduction * 100)}%`);
    }
  }

  if (targetActor) {
    const generalReduction = actorResistanceFor(targetActor, "general");
    if (generalReduction > 0) {
      remaining *= 1 - generalReduction;
      appliedReductions.push(`Resistência Geral ${Math.round(generalReduction * 100)}%`);
    }

    for (const elementId of mech.damageElements ?? []) {
      const elementReduction = actorResistanceFor(targetActor, elementId);
      if (elementReduction > 0) {
        remaining *= 1 - elementReduction;
        const label = getActiveDamageElements().find(e => e.id === elementId)?.label ?? elementId;
        appliedReductions.push(`Resistência ${label} ${Math.round(elementReduction * 100)}%`);
      }
    }
  }

  return { finalDamage: Math.max(0, Math.floor(remaining)), appliedReductions };
}

/** `label` já vem pronto de `useSkillEffect` (nome da Skill, ou "Skill — Sub-Skill" quando aplicável). */
function damageFlavorPrefix(mech, label) {
  const elementLabels = (mech.damageElements ?? [])
    .map(id => getActiveDamageElements().find(e => e.id === id)?.label)
    .filter(Boolean);
  return elementLabels.length ? `${label} — Dano ${elementLabels.join("+")}` : `${label} — Dano`;
}

async function rollSkillDamage(actor, mech, label, targetActor = null) {
  const formula = mech.damageFormula?.trim();
  if (!formula) {
    ui.notifications?.warn("Essa skill não tem uma Fórmula de Dano configurada.");
    return null;
  }

  const roll = new Roll(formula);
  await roll.evaluate();

  const boostedTotal = applyShipWeaponBonus(roll.total, actor);
  let flavor = damageFlavorPrefix(mech, label);
  if (boostedTotal !== roll.total) flavor += ` — bônus de arma (${roll.total} → ${Math.floor(boostedTotal)})`;

  let finalDamage;
  if (isShipLike(targetActor)) {
    const { toShield, toCasco, toHull, appliedReductions } = await applyStarshipDamageCascade(boostedTotal, actor, targetActor);
    finalDamage = toShield + toCasco + toHull;
    let cascadeText = `Escudo -${toShield} · Casco -${toCasco} · Integridade Estrutural -${toHull}`;
    if (appliedReductions.length) cascadeText += ` (${appliedReductions.join(", ")})`;
    flavor += ` — ${cascadeText}`;
  } else {
    const reduced = applyDamageReductions(boostedTotal, mech, targetActor, { sourceActor: actor });
    finalDamage = reduced.finalDamage;
    if (reduced.appliedReductions.length) {
      flavor += ` — reduzido por ${reduced.appliedReductions.join(", ")} (${Math.floor(boostedTotal)} → ${finalDamage})`;
    }
  }

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor
  });
  return { roll, finalDamage };
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
async function rollSkillDamageArea(actor, mech, label, targetActors) {
  const formula = mech.damageFormula?.trim();
  if (!formula) {
    ui.notifications?.warn("Essa skill não tem uma Fórmula de Dano configurada.");
    return null;
  }
  if (!targetActors.length) {
    ui.notifications?.warn("Nenhum alvo encontrado na área.");
    return null;
  }

  const roll = new Roll(formula);
  await roll.evaluate();

  const boostedTotal = applyShipWeaponBonus(roll.total, actor);
  const title = `${damageFlavorPrefix(mech, label)} (Emissão)`;
  const rows = [];
  for (const targetActor of targetActors) {
    if (isShipLike(targetActor)) {
      const { toShield, toCasco, toHull, appliedReductions } = await applyStarshipDamageCascade(boostedTotal, actor, targetActor);
      const reductionText = appliedReductions.length ? ` <span class="hint-inline">(${appliedReductions.join(", ")})</span>` : "";
      rows.push(`<li><strong>${targetActor.name}</strong>: Escudo -${toShield} · Casco -${toCasco} · Integridade Estrutural -${toHull}${reductionText}</li>`);
    } else {
      const { finalDamage, appliedReductions } = applyDamageReductions(boostedTotal, mech, targetActor, { sourceActor: actor });
      const reductionText = appliedReductions.length ? ` <span class="hint-inline">(${appliedReductions.join(", ")})</span>` : "";
      rows.push(`<li><strong>${targetActor.name}</strong>: ${finalDamage}${reductionText}</li>`);
    }
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: [roll],
    flavor: title,
    content: `<p>${title} — rolagem bruta: <strong>${roll.total}</strong>${boostedTotal !== roll.total ? ` (bônus de arma: ${Math.floor(boostedTotal)})` : ""}</p><ul>${rows.join("")}</ul>`
  });

  return { roll };
}

/**
 * Um efeito é "periódico" (veneno/cura contínua — bate um tick de `amount` em vez de aplicar
 * uma vez só) apenas quando o alvo é HP ou Energia — atributos de combate não têm um "tick"
 * que faça sentido (só buff/debuff de duração normal). Ver effectEntrySchema() em
 * data/item-models.js.
 */
function isPeriodicEntry(entry) {
  return Boolean(entry.periodic) && (entry.target === "hp" || entry.target === "energy");
}

/** Mesmo conjunto de elementos, independente da ordem — usado só pra separar stacks de Veneno por elemento. */
function sameElementSet(a, b) {
  const setA = new Set(a ?? []);
  const setB = new Set(b ?? []);
  if (setA.size !== setB.size) return false;
  for (const el of setA) if (!setB.has(el)) return false;
  return true;
}

/**
 * Efeito já ativo no alvo com a MESMA Condição nomeada (mesmo `conditionId`, não vazio, E
 * mesma natureza periódica/não-periódica) que este sistema criou — usado pra decidir "estender
 * duração" em vez de "criar um segundo efeito" quando a mesma Condição é reaplicada em quem já
 * está afetado por ela (ex: 2º ataque de Veneno em quem já está Envenenado soma a
 * duração/ticks, não duplica o efeito). Exige a mesma "natureza" pra nunca tentar somar
 * `ticksRemaining` num efeito que não tem motor de tick (ou vice-versa) — um GM que reusar o
 * mesmo id de Condição ora periódico ora não simplesmente ganha dois efeitos independentes.
 *
 * Pra Periódico (Veneno/cura), também exige o MESMO conjunto de `damageElements`: Veneno+Gelo e
 * Veneno+Fogo são efeitos independentes que coexistem (cada elemento reduzido pela Resistência
 * certa) — só duas aplicações com EXATAMENTE os mesmos elementos somam duração/ticks entre si.
 */
function findStackableEffect(targetActor, conditionId, periodic, damageElements = []) {
  if (!conditionId) return null;
  return (
    targetActor.effects.find(e => {
      const flags = e.flags?.[SYSTEM_ID];
      if (!flags || flags.conditionId !== conditionId || Boolean(flags.periodic) !== periodic) return false;
      if (periodic && !sameElementSet(flags.tickDamageElements, damageElements)) return false;
      return true;
    }) ?? null
  );
}

/**
 * Aplica cada entrada de `mech.effects` num único Ator e devolve o resumo textual (sem postar
 * chat) — compartilhado entre alvo único e Emissão. `originSkill` só empresta `img`/`uuid` pro
 * Active Effect criado (mesmo quando `mech` é o snapshot de uma Sub-Skill). Reaplicar a mesma
 * Condição nomeada em quem já a tem estende a duração/ticks restantes em vez de duplicar.
 *
 * Qualquer entrada de `mech.effects` (buff/debuff comum OU Periódico/Veneno/cura) tem dois
 * modos de duração, decididos pela Skill inteira via `mech.hasUpkeep` — nunca por
 * `entry.durationRounds` quando esse for o caso:
 *  - Sem Habilidade Ativa: dura `entry.durationRounds` rounds/ticks (buff sem duração vira pra
 *    sempre, se 0), igual sempre foi — custo pago uma vez, sem acompanhamento nenhum depois.
 *  - Com Habilidade Ativa: contribui SEMPRE 0 de duração (nunca infla `durationRounds`/ticks de
 *    outra fonte) e vira uma "âncora" que segura o efeito vivo até a Skill ser desativada
 *    (manual ou por falta de Energia, ver `removeUpkeepLinkedEffects`/`useSkillEffect`/
 *    `tickActorUpkeepSkills`). Buff/debuff comum: nasce sem duração própria (`tiedToActive`).
 *    Periódico (Veneno/cura): guarda a âncora em `activeAnchors` — os ticks de OUTRAS fontes
 *    (finitas) continuam decaindo normalmente; quando chegam a 0, se ainda sobrar alguma âncora
 *    o efeito continua tickando (só sustentado por ela) em vez de expirar. Isso evita que
 *    reaplicar uma Skill Ativa em cima de um Veneno já ativo fique "estendendo" a duração pra
 *    sempre — ela só marca presença, quem realmente decai são as fontes de duração fixa.
 *    Duas aplicações de Veneno com elementos DIFERENTES (ex: Veneno+Gelo vs Veneno+Fogo) nunca
 *    somam entre si — só contam como a mesma "pilha" quando os elementos são exatamente iguais
 *    (ver `findStackableEffect`). Um alvo pego numa área de Emissão fica com o efeito mesmo
 *    saindo do lugar no canvas depois — a área só serviu pra ESCOLHER quem foi afetado no
 *    momento de usar, o efeito em si vive no Ator, não no espaço.
 */
async function applyEffectsToActor(mech, label, originSkill, targetActor, subSkillIndex = null) {
  const entries = mech.effects ?? [];
  const summary = [];

  for (const entry of entries) {
    const targetLabel = MEU_SISTEMA.EFFECT_TARGET_LABELS[entry.target] ?? entry.target;
    const sign = entry.amount >= 0 ? "+" : "";
    const condition = entry.conditionId ? getActiveStatusConditions().find(c => c.id === entry.conditionId) : null;

    if (entry.target === "shield") {
      // Escudo ignora Condição/Periódico/Duração — é sempre somado direto, gasto na mão.
      const current = targetActor.system.attributes.shield.value ?? 0;
      await targetActor.update({
        "system.attributes.shield.value": Math.max(0, current + entry.amount)
      });
      summary.push(`Escudo ${sign}${entry.amount}`);
      continue;
    }

    const path = resolveEffectTargetPath(entry);
    if (!path) continue;
    const isMultiplier = entry.modifierType === "multiplier" && Boolean(SHIP_TARGET_PATHS[entry.target]);

    const periodic = isPeriodicEntry(entry);
    const tiedToActive = Boolean(mech.hasUpkeep);
    const anchor = { sourceSkillId: originSkill.id, sourceSubSkillIndex: subSkillIndex };
    const existing = findStackableEffect(targetActor, entry.conditionId, periodic, entry.damageElements);

    if (existing) {
      const existingFlags = existing.flags[SYSTEM_ID];

      if (periodic) {
        // Uma aplicação "Ativa" nunca soma ticks (contribui 0 de duração) — só registra sua
        // própria fonte como uma "âncora" que segura o efeito vivo. Os ticks de outras fontes
        // (finitas) continuam contando normalmente; quando chegarem em 0, se ainda sobrar
        // alguma âncora, o efeito continua tickando (agora só sustentado por ela) em vez de
        // expirar — é assim que "até desativar" nunca fica refém de reaplicações infinitas.
        if (tiedToActive) {
          const anchors = existingFlags.activeAnchors ?? [];
          const alreadyAnchored = anchors.some(
            a => a.sourceSkillId === anchor.sourceSkillId && (a.sourceSubSkillIndex ?? null) === (anchor.sourceSubSkillIndex ?? null)
          );
          if (!alreadyAnchored) {
            await existing.update({ [`flags.${SYSTEM_ID}.activeAnchors`]: [...anchors, anchor] });
          }
          summary.push(`${condition?.label ?? targetLabel}: mantido ativo (até desativar)`);
        } else {
          const currentTicks = existingFlags.ticksRemaining ?? 0;
          const newTicks = currentTicks + Math.max(1, entry.durationRounds);
          await existing.update({ [`flags.${SYSTEM_ID}.ticksRemaining`]: newTicks });
          summary.push(`${condition?.label ?? targetLabel}: duração estendida (+${entry.durationRounds} tick(s), total ${newTicks})`);
        }
      } else if (existingFlags.tiedToActive) {
        // Buff/debuff comum já indefinido — não há duração pra estender.
        summary.push(`${condition?.label ?? targetLabel}: já ativo (até desativar)`);
      } else {
        const currentRounds = existing.duration?.rounds ?? 0;
        await existing.update({ "duration.rounds": currentRounds + entry.durationRounds });
        summary.push(`${condition?.label ?? targetLabel}: duração estendida (+${entry.durationRounds} rounds)`);
      }
      continue;
    }

    if (periodic) {
      await targetActor.createEmbeddedDocuments("ActiveEffect", [
        {
          name: condition?.label ?? `${label}: ${targetLabel}`,
          img: condition?.icon ?? originSkill.img,
          origin: originSkill.uuid,
          statuses: entry.conditionId ? [entry.conditionId] : [],
          flags: {
            [SYSTEM_ID]: {
              skillEffect: true,
              periodic: true,
              conditionId: entry.conditionId || "",
              tickTarget: entry.target,
              tickAmount: entry.amount,
              tickUnit: entry.tickUnit || "combatRound",
              // Uma aplicação "Ativa" começa com 0 de duração própria (nunca infla o contador) —
              // só existe indefinidamente porque `activeAnchors` não está vazio (ver
              // tickPeriodicEffect: só expira quando ticksRemaining chega a 0 E não sobra âncora).
              ticksRemaining: tiedToActive ? 0 : Math.max(1, entry.durationRounds),
              activeAnchors: tiedToActive ? [anchor] : [],
              // Snapshot no momento da aplicação (mesma filosofia de Sub-Skill) — só usado
              // quando o tick é dano (amount negativo); cura periódica nunca é reduzida.
              tickDamageElements: Array.isArray(entry.damageElements) ? entry.damageElements : []
            }
          }
        }
      ]);
      const unitLabel = entry.tickUnit === "manual" ? "manual" : "por rodada de combate";
      const durationLabel = tiedToActive ? "até desativar" : `${Math.max(1, entry.durationRounds)} tick(s)`;
      summary.push(`${condition?.label ?? targetLabel} ${sign}${entry.amount}/tick (${durationLabel}, ${unitLabel})`);
      continue;
    }

    await targetActor.createEmbeddedDocuments("ActiveEffect", [
      {
        name: condition?.label ?? `${label}: ${targetLabel} ${sign}${entry.amount}`,
        img: condition?.icon ?? originSkill.img,
        origin: originSkill.uuid,
        statuses: entry.conditionId ? [entry.conditionId] : [],
        duration: !tiedToActive && entry.durationRounds > 0 ? { rounds: entry.durationRounds } : {},
        changes: [
          {
            key: path,
            mode: isMultiplier ? CONST.ACTIVE_EFFECT_MODES.MULTIPLY : CONST.ACTIVE_EFFECT_MODES.ADD,
            // MULTIPLY multiplica o valor ATUAL do campo — `amount` é percentual (20 = +20%),
            // por isso vira fator 1.20, não 20 cru (que zeraria o campo, cuja base é 1).
            value: String(isMultiplier ? 1 + entry.amount / 100 : entry.amount)
          }
        ],
        flags: {
          [SYSTEM_ID]: {
            skillEffect: true,
            conditionId: entry.conditionId || "",
            tiedToActive,
            sourceSkillId: originSkill.id,
            sourceSubSkillIndex: subSkillIndex
          }
        }
      }
    ]);
    summary.push(
      tiedToActive
        ? `${targetLabel} ${isMultiplier ? `×${(1 + entry.amount / 100).toFixed(2)}` : `${sign}${entry.amount}`} (até desativar)`
        : `${targetLabel} ${isMultiplier ? `×${(1 + entry.amount / 100).toFixed(2)}` : `${sign}${entry.amount}`}${entry.durationRounds > 0 ? ` (${entry.durationRounds} rounds)` : ""}`
    );
  }

  return summary;
}

/**
 * Bate um único tick de um Active Effect periódico (veneno/cura contínua): aplica
 * `flags.tickAmount` direto em HP/Energia atual (clamped, sem passar pelo Máximo — igual um
 * dano/cura de verdade, não um buffDelta), decrementa `ticksRemaining` e apaga o efeito ao
 * chegar a 0. Compartilhado entre o hook automático de combate e o botão manual da ficha.
 *
 * Tick de DANO (`tickAmount` negativo) é reduzido por Resistência Geral + Elemental do próprio
 * Ator (`skipMagicDefense: true` — Defesa Mágica NUNCA reduz um tick, nem quando o Veneno é
 * mágico; decisão de balanceamento deliberada, diferente do dano "normal" de `rollSkillDamage`).
 * Tick de CURA (`tickAmount` positivo) sempre aplica o valor cheio, sem redução nenhuma — não
 * existe conceito de "resistir à própria cura" neste sistema.
 * @param {Actor} actor
 * @param {ActiveEffect} effect
 */
export async function tickPeriodicEffect(actor, effect) {
  const flags = effect.flags?.[SYSTEM_ID];
  if (!flags?.periodic) return null;

  const attrKey = flags.tickTarget === "energy" ? "energy" : "hp";
  const attr = actor.system.attributes[attrKey];

  let delta = flags.tickAmount;
  let appliedReductions = [];
  if (delta < 0) {
    const mech = { damageElements: flags.tickDamageElements ?? [] };
    const { finalDamage, appliedReductions: reductions } = applyDamageReductions(-delta, mech, actor, { skipMagicDefense: true });
    delta = -finalDamage;
    appliedReductions = reductions;
  }

  const newValue = Math.clamp(attr.value + delta, 0, attr.max);
  await actor.update({ [`system.attributes.${attrKey}.value`]: newValue });

  // `activeAnchors` não-vazio = pelo menos uma Skill "Ativa" está segurando este efeito vivo
  // (reaplicações Ativas contribuem 0 de duração — só registram a âncora, ver
  // applyEffectsToActor). Os ticks de fontes finitas continuam decaindo normalmente; ao chegar
  // em 0, só expira de verdade se NENHUMA âncora sobrar — senão fica tickando no piso até
  // `removeUpkeepLinkedEffects` remover a(s) âncora(s) restante(s).
  const anchored = (flags.activeAnchors ?? []).length > 0;
  const ticksRemaining = Math.max(0, (flags.ticksRemaining ?? 1) - 1);
  const expired = ticksRemaining <= 0 && !anchored;

  if (expired) await effect.delete();
  else await effect.update({ [`flags.${SYSTEM_ID}.ticksRemaining`]: ticksRemaining });

  // Pro chamador (chat/UI), "até desativar" só faz sentido reportar quando os ticks já
  // zeraram e só a âncora está segurando — enquanto ainda há ticks finitos contando, mostra o
  // número normal mesmo que exista uma âncora em paralelo.
  const displayTicks = anchored && ticksRemaining <= 0 ? null : ticksRemaining;

  return { attrKey, delta, newValue, ticksRemaining: displayTicks, expired, effectName: effect.name, appliedReductions };
}

/**
 * Tica todos os Efeitos Periódicos de `tickUnit: "combatRound"` de um Ator e posta um resumo
 * único no chat — chamado pelo hook `updateCombat` (nihility-rpg-system.js) sempre que chega a
 * vez desse Ator no combate. Efeitos `tickUnit: "manual"` nunca são tocados aqui (ver o botão
 * "Aplicar Tick" da ficha, actor-sheet.js).
 * @param {Actor} actor
 */
export async function tickCombatRoundEffects(actor) {
  const effects = actor.effects.filter(e => e.flags?.[SYSTEM_ID]?.periodic && e.flags[SYSTEM_ID].tickUnit !== "manual");
  const results = [];
  for (const effect of effects) {
    const result = await tickPeriodicEffect(actor, effect);
    if (result) results.push(result);
  }

  if (results.length) {
    const rows = results.map(r => {
      const attrLabel = r.attrKey === "hp" ? "HP" : MEU_SISTEMA.EFFECT_TARGET_LABELS.energy;
      const statusText = r.expired ? "encerrou" : r.ticksRemaining === null ? "até desativar" : `${r.ticksRemaining} tick(s) restante(s)`;
      const reductionText = r.appliedReductions?.length ? ` <span class="hint-inline">(reduzido por ${r.appliedReductions.join(", ")})</span>` : "";
      return `<li><strong>${r.effectName}</strong>: ${r.delta >= 0 ? "+" : ""}${r.delta} ${attrLabel} (${statusText})${reductionText}</li>`;
    });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${actor.name}</strong> — início de turno, Condições ativas:</p><ul>${rows.join("")}</ul>`
    });
  }

  return results;
}

/** Toda Skill "Ativa" ligada no momento — top-level e cada Sub-Skill (fusões podem ter mais de uma ligada ao mesmo tempo). */
function collectActiveUpkeepSources(actor) {
  const sources = [];
  for (const skill of actor.items) {
    if (skill.type !== "skill") continue;
    if (skill.system.hasUpkeep && skill.system.active) {
      sources.push({ skill, subSkillIndex: null, label: skill.name, upkeepCost: Number(skill.system.upkeepCost) || 0 });
    }
    (skill.system.subSkills ?? []).forEach((sub, i) => {
      if (sub.hasUpkeep && sub.active) {
        sources.push({ skill, subSkillIndex: i, label: `${skill.name} — ${sub.name}`, upkeepCost: Number(sub.upkeepCost) || 0 });
      }
    });
  }
  return sources;
}

/**
 * Drena a Energia de toda Skill "Ativa" (hasUpkeep + active) do Ator a cada rodada — chamada do
 * mesmo hook `updateCombat` (nihility-rpg-system.js) que já tica Veneno/cura contínua (ver
 * `tickCombatRoundEffects` acima), sempre que chega a vez desse Ator. Processa uma fonte de
 * cada vez (não tudo de uma vez) porque várias Skills Ativas competem pela MESMA Energia — a
 * ordem importa quando não sobra pra todas. Energia nunca fica negativa: se não sobrar o
 * suficiente pro Custo por Rodada inteiro, drena só o que tem (até 0) e desativa a Skill
 * sozinha, avisando o dono do Ator + o Mestre pela Voz do Mundo (nunca público — é
 * meta-informação de recurso, não algo pra narrar na mesa).
 * @param {Actor} actor
 */
export async function tickActorUpkeepSkills(actor) {
  const sources = collectActiveUpkeepSources(actor);
  if (!sources.length) return [];

  const results = [];
  for (const source of sources) {
    const currentEnergy = currentEnergyValue(actor);
    if (currentEnergy <= 0) {
      await source.skill.update({ [activeStatePath(source.subSkillIndex)]: false });
      await removeUpkeepLinkedEffects(source.skill, source.subSkillIndex);
      results.push({ label: source.label, drained: 0, deactivated: true });
      continue;
    }

    const drain = Math.min(source.upkeepCost, currentEnergy);
    await actor.update({ [energyValuePath(actor)]: currentEnergy - drain });

    const insufficient = drain < source.upkeepCost;
    if (insufficient) {
      await source.skill.update({ [activeStatePath(source.subSkillIndex)]: false });
      await removeUpkeepLinkedEffects(source.skill, source.subSkillIndex);
    }
    results.push({ label: source.label, drained: drain, deactivated: insufficient });
  }

  const energyLabel = getEnergyLabelForActor(actor);
  const rows = results.map(
    r => `<li><strong>${r.label}</strong>: -${r.drained} ${energyLabel}${r.deactivated ? ` (desativada — ${energyLabel} insuficiente)` : ""}</li>`
  );
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${actor.name}</strong> — início de turno, Habilidades Ativas:</p><ul>${rows.join("")}</ul>`
  });

  for (const r of results.filter(r => r.deactivated)) {
    await announceVoiceOfTheWorld(actor, {
      kind: "skill-deactivated",
      title: "Habilidade Desativada",
      body: `${r.label} foi desativada automaticamente — ${actor.name} ficou sem ${energyLabel} suficiente pra mantê-la.`
    });
  }

  return results;
}

async function applySkillEffects(sourceActor, skill, mech, label, targetActor, subSkillIndex = null) {
  if (!(mech.effects ?? []).length) {
    ui.notifications?.warn("Essa skill não tem nenhum Efeito configurado.");
    return null;
  }

  const summary = await applyEffectsToActor(mech, label, skill, targetActor, subSkillIndex);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p><strong>${sourceActor.name}</strong> usou <strong>${label}</strong> em <strong>${targetActor.name}</strong>: ${summary.join(", ")}.</p>`
  });

  return true;
}

/**
 * Versão em Emissão (área) de `applySkillEffects`: aplica a mesma lista de `effects` em cada
 * Ator encontrado na área, numa única mensagem de chat consolidada.
 * @param {Actor} sourceActor
 * @param {Item} skill
 * @param {object} mech
 * @param {string} label
 * @param {Actor[]} targetActors
 */
async function applySkillEffectsArea(sourceActor, skill, mech, label, targetActors, subSkillIndex = null) {
  if (!(mech.effects ?? []).length) {
    ui.notifications?.warn("Essa skill não tem nenhum Efeito configurado.");
    return null;
  }
  if (!targetActors.length) {
    ui.notifications?.warn("Nenhum alvo encontrado na área.");
    return null;
  }

  const rows = [];
  for (const targetActor of targetActors) {
    const summary = await applyEffectsToActor(mech, label, skill, targetActor, subSkillIndex);
    rows.push(`<li><strong>${targetActor.name}</strong>: ${summary.join(", ")}</li>`);
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p><strong>${sourceActor.name}</strong> usou <strong>${label}</strong> (Emissão) em ${targetActors.length} alvo(s):</p><ul>${rows.join("")}</ul>`
  });

  return true;
}
