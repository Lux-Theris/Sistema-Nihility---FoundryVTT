/**
 * "Usar Habilidade": aplica a mecânica de uma Skill (system.effectType).
 *  - "damage": rola `damageFormula` (fórmula livre do Foundry) e posta no chat
 *    PÚBLICO (diferente da Voz do Mundo, que é só pra progressão/meta).
 *  - "temporary": aplica cada entrada de `effects` — atributos/HP/Mana viram
 *    Active Effects de verdade com duração (expiram sozinhos, nunca alteram o
 *    HP/Mana Máximo mesmo quando o alvo é um atributo); "shield" é somado
 *    direto, sem duração, gasto na mão pelo jogador conforme absorve dano.
 */
import { SYSTEM_ID, MEU_SISTEMA, getActiveDamageElements, getActiveStatusConditions } from "./config.js";

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
 * Ponto de entrada único de "Usar Habilidade".
 *  - `targetType: "targeted"` (padrão): usa `options.targetActor` (1 Ator, escolhido via
 *    dropdown em actor-sheet.js) — comportamento de sempre.
 *  - `targetType: "emission"`: usa `options.targetActors` (lista já resolvida pela forma
 *    posicionada no canvas via module/area-effects.js) — sem alvo único envolvido.
 *  - `options.subSkillIndex`: quando a Skill tem Sub-Skills (só existe em Skills Fundidas —
 *    ver ai-helper.js#fuseSkills), a mecânica usada é a daquele componente específico
 *    (`system.subSkills[i]`, que carrega seu próprio effectType/damageFormula/effects/
 *    targetType/etc.) em vez da mecânica própria da Skill — igual as Skills Únicas do
 *    Tensura, que têm várias sub-habilidades nomeadas dentro de uma só Skill "guarda-chuva".
 *    `actor-sheet.js` já resolve qual índice antes de chamar isto (ver `_promptSubSkillChoice`).
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

  const isEmission = mech.targetType === "emission";

  if (mech.effectType === "damage") {
    return isEmission
      ? rollSkillDamageArea(sourceActor, mech, label, options.targetActors ?? [])
      : rollSkillDamage(sourceActor, mech, label, options.targetActor ?? null);
  }
  if (mech.effectType === "temporary") {
    return isEmission
      ? applySkillEffectsArea(sourceActor, skill, mech, label, options.targetActors ?? [])
      : applySkillEffects(sourceActor, skill, mech, label, options.targetActor ?? sourceActor);
  }

  ui.notifications?.info("Essa skill é só descritiva — sem mecânica pra ativar.");
  return null;
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

/**
 * Aplica Defesa Mágica + Resistência (Geral/Elemental) sobre um dano bruto já rolado, pra um
 * alvo específico. Compartilhado entre o caminho de alvo único e o de Emissão (área) — o roll
 * em si acontece uma vez só, mas cada alvo aplica sua própria redução em cima do mesmo total.
 * `mech` é `skill.system` OU o snapshot de uma Sub-Skill (`skill.system.subSkills[i]`) — mesmo
 * formato de campos (isMagicDamage/damageElements) nos dois casos.
 */
function applyDamageReductions(rawTotal, mech, targetActor) {
  let remaining = rawTotal;
  const appliedReductions = [];

  if (mech.isMagicDamage && targetActor) {
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

  let flavor = damageFlavorPrefix(mech, label);
  const { finalDamage, appliedReductions } = applyDamageReductions(roll.total, mech, targetActor);
  if (appliedReductions.length) {
    flavor += ` — reduzido por ${appliedReductions.join(", ")} (${roll.total} → ${finalDamage})`;
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

  const title = `${damageFlavorPrefix(mech, label)} (Emissão)`;
  const rows = targetActors.map(targetActor => {
    const { finalDamage, appliedReductions } = applyDamageReductions(roll.total, mech, targetActor);
    const reductionText = appliedReductions.length ? ` <span class="hint-inline">(${appliedReductions.join(", ")})</span>` : "";
    return `<li><strong>${targetActor.name}</strong>: ${finalDamage}${reductionText}</li>`;
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: [roll],
    flavor: title,
    content: `<p>${title} — rolagem bruta: <strong>${roll.total}</strong></p><ul>${rows.join("")}</ul>`
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

/**
 * Efeito já ativo no alvo com a MESMA Condição nomeada (mesmo `conditionId`, não vazio, E
 * mesma natureza periódica/não-periódica) que este sistema criou — usado pra decidir "estender
 * duração" em vez de "criar um segundo efeito" quando a mesma Condição é reaplicada em quem já
 * está afetado por ela (ex: 2º ataque de Veneno em quem já está Envenenado soma a
 * duração/ticks, não duplica o efeito). Exige a mesma "natureza" pra nunca tentar somar
 * `ticksRemaining` num efeito que não tem motor de tick (ou vice-versa) — um GM que reusar o
 * mesmo id de Condição ora periódico ora não simplesmente ganha dois efeitos independentes.
 */
function findStackableEffect(targetActor, conditionId, periodic) {
  if (!conditionId) return null;
  return targetActor.effects.find(e => e.flags?.[SYSTEM_ID]?.conditionId === conditionId && Boolean(e.flags[SYSTEM_ID].periodic) === periodic) ?? null;
}

/**
 * Aplica cada entrada de `mech.effects` num único Ator e devolve o resumo textual (sem postar
 * chat) — compartilhado entre alvo único e Emissão. `originSkill` só empresta `img`/`uuid` pro
 * Active Effect criado (mesmo quando `mech` é o snapshot de uma Sub-Skill). Reaplicar a mesma
 * Condição nomeada em quem já a tem estende a duração/ticks restantes em vez de duplicar.
 */
async function applyEffectsToActor(mech, label, originSkill, targetActor) {
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

    const path = EFFECT_TARGET_PATHS[entry.target];
    if (!path) continue;

    const periodic = isPeriodicEntry(entry);
    const existing = findStackableEffect(targetActor, entry.conditionId, periodic);

    if (existing) {
      if (periodic) {
        const currentTicks = existing.flags?.[SYSTEM_ID]?.ticksRemaining ?? 0;
        const newTicks = currentTicks + Math.max(1, entry.durationRounds);
        await existing.update({ [`flags.${SYSTEM_ID}.ticksRemaining`]: newTicks });
        summary.push(`${condition?.label ?? targetLabel}: duração estendida (+${entry.durationRounds} tick(s), total ${newTicks})`);
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
              ticksRemaining: Math.max(1, entry.durationRounds)
            }
          }
        }
      ]);
      const unitLabel = entry.tickUnit === "manual" ? "manual" : "por rodada de combate";
      summary.push(`${condition?.label ?? targetLabel} ${sign}${entry.amount}/tick (${Math.max(1, entry.durationRounds)} tick(s), ${unitLabel})`);
      continue;
    }

    await targetActor.createEmbeddedDocuments("ActiveEffect", [
      {
        name: condition?.label ?? `${label}: ${targetLabel} ${sign}${entry.amount}`,
        img: condition?.icon ?? originSkill.img,
        origin: originSkill.uuid,
        statuses: entry.conditionId ? [entry.conditionId] : [],
        duration: entry.durationRounds > 0 ? { rounds: entry.durationRounds } : {},
        changes: [{ key: path, mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(entry.amount) }],
        flags: { [SYSTEM_ID]: { skillEffect: true, conditionId: entry.conditionId || "" } }
      }
    ]);
    summary.push(`${targetLabel} ${sign}${entry.amount}${entry.durationRounds > 0 ? ` (${entry.durationRounds} rounds)` : ""}`);
  }

  return summary;
}

/**
 * Bate um único tick de um Active Effect periódico (veneno/cura contínua): aplica
 * `flags.tickAmount` direto em HP/Energia atual (clamped, sem passar pelo Máximo — igual um
 * dano/cura de verdade, não um buffDelta), decrementa `ticksRemaining` e apaga o efeito ao
 * chegar a 0. Compartilhado entre o hook automático de combate e o botão manual da ficha.
 * @param {Actor} actor
 * @param {ActiveEffect} effect
 */
export async function tickPeriodicEffect(actor, effect) {
  const flags = effect.flags?.[SYSTEM_ID];
  if (!flags?.periodic) return null;

  const attrKey = flags.tickTarget === "energy" ? "energy" : "hp";
  const attr = actor.system.attributes[attrKey];
  const newValue = Math.clamp(attr.value + flags.tickAmount, 0, attr.max);
  await actor.update({ [`system.attributes.${attrKey}.value`]: newValue });

  const ticksRemaining = (flags.ticksRemaining ?? 1) - 1;
  const expired = ticksRemaining <= 0;
  if (expired) await effect.delete();
  else await effect.update({ [`flags.${SYSTEM_ID}.ticksRemaining`]: ticksRemaining });

  return { attrKey, delta: flags.tickAmount, newValue, ticksRemaining, expired, effectName: effect.name };
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
      const statusText = r.expired ? "encerrou" : `${r.ticksRemaining} tick(s) restante(s)`;
      return `<li><strong>${r.effectName}</strong>: ${r.delta >= 0 ? "+" : ""}${r.delta} ${attrLabel} (${statusText})</li>`;
    });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${actor.name}</strong> — início de turno, Condições ativas:</p><ul>${rows.join("")}</ul>`
    });
  }

  return results;
}

async function applySkillEffects(sourceActor, skill, mech, label, targetActor) {
  if (!(mech.effects ?? []).length) {
    ui.notifications?.warn("Essa skill não tem nenhum Efeito configurado.");
    return null;
  }

  const summary = await applyEffectsToActor(mech, label, skill, targetActor);

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
async function applySkillEffectsArea(sourceActor, skill, mech, label, targetActors) {
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
    const summary = await applyEffectsToActor(mech, label, skill, targetActor);
    rows.push(`<li><strong>${targetActor.name}</strong>: ${summary.join(", ")}</li>`);
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p><strong>${sourceActor.name}</strong> usou <strong>${label}</strong> (Emissão) em ${targetActors.length} alvo(s):</p><ul>${rows.join("")}</ul>`
  });

  return true;
}
