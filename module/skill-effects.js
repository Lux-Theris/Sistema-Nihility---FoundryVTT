/**
 * "Usar Habilidade": aplica a mecânica de uma Skill (system.effectType).
 *  - "damage": rola `damageFormula` (fórmula livre do Foundry) e posta no chat
 *    PÚBLICO (diferente da Voz do Mundo, que é só pra progressão/meta).
 *  - "temporary": aplica cada entrada de `effects` — atributos/HP/Mana viram
 *    Active Effects de verdade com duração (expiram sozinhos, nunca alteram o
 *    HP/Mana Máximo mesmo quando o alvo é um atributo); "shield" é somado
 *    direto, sem duração, gasto na mão pelo jogador conforme absorve dano.
 */
import { SYSTEM_ID, MEU_SISTEMA, getActiveDamageElements } from "./config.js";

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
 * @param {Actor} sourceActor - dono da skill
 * @param {string} skillId
 * @param {{targetActor?: Actor, targetActors?: Actor[]}} [options]
 */
export async function useSkillEffect(sourceActor, skillId, options = {}) {
  const skill = sourceActor.items.get(skillId);
  if (!skill) return null;

  const isEmission = skill.system.targetType === "emission";

  if (skill.system.effectType === "damage") {
    return isEmission
      ? rollSkillDamageArea(sourceActor, skill, options.targetActors ?? [])
      : rollSkillDamage(sourceActor, skill, options.targetActor ?? null);
  }
  if (skill.system.effectType === "temporary") {
    return isEmission
      ? applySkillEffectsArea(sourceActor, skill, options.targetActors ?? [])
      : applySkillEffects(sourceActor, skill, options.targetActor ?? sourceActor);
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
 */
function applyDamageReductions(rawTotal, skill, targetActor) {
  let remaining = rawTotal;
  const appliedReductions = [];

  if (skill.system.isMagicDamage && targetActor) {
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

    for (const elementId of skill.system.damageElements ?? []) {
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

function damageFlavorPrefix(skill) {
  const elementLabels = (skill.system.damageElements ?? [])
    .map(id => getActiveDamageElements().find(e => e.id === id)?.label)
    .filter(Boolean);
  return elementLabels.length ? `${skill.name} — Dano ${elementLabels.join("+")}` : `${skill.name} — Dano`;
}

async function rollSkillDamage(actor, skill, targetActor = null) {
  const formula = skill.system.damageFormula?.trim();
  if (!formula) {
    ui.notifications?.warn("Essa skill não tem uma Fórmula de Dano configurada.");
    return null;
  }

  const roll = new Roll(formula);
  await roll.evaluate();

  let flavor = damageFlavorPrefix(skill);
  const { finalDamage, appliedReductions } = applyDamageReductions(roll.total, skill, targetActor);
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
 * @param {Item} skill
 * @param {Actor[]} targetActors - Atores encontrados dentro da forma posicionada no canvas
 */
async function rollSkillDamageArea(actor, skill, targetActors) {
  const formula = skill.system.damageFormula?.trim();
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

  const title = `${damageFlavorPrefix(skill)} (Emissão)`;
  const rows = targetActors.map(targetActor => {
    const { finalDamage, appliedReductions } = applyDamageReductions(roll.total, skill, targetActor);
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

/** Aplica cada entrada de `effects` num único Ator e devolve o resumo textual (sem postar chat) — compartilhado entre alvo único e Emissão. */
async function applyEffectsToActor(skill, targetActor) {
  const entries = skill.system.effects ?? [];
  const summary = [];

  for (const entry of entries) {
    const label = MEU_SISTEMA.EFFECT_TARGET_LABELS[entry.target] ?? entry.target;
    const sign = entry.amount >= 0 ? "+" : "";

    if (entry.target === "shield") {
      const current = targetActor.system.attributes.shield.value ?? 0;
      await targetActor.update({
        "system.attributes.shield.value": Math.max(0, current + entry.amount)
      });
      summary.push(`Escudo ${sign}${entry.amount}`);
      continue;
    }

    const path = EFFECT_TARGET_PATHS[entry.target];
    if (!path) continue;

    await targetActor.createEmbeddedDocuments("ActiveEffect", [
      {
        name: `${skill.name}: ${label} ${sign}${entry.amount}`,
        img: skill.img,
        origin: skill.uuid,
        duration: entry.durationRounds > 0 ? { rounds: entry.durationRounds } : {},
        changes: [{ key: path, mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(entry.amount) }],
        flags: { [SYSTEM_ID]: { skillEffect: true } }
      }
    ]);
    summary.push(`${label} ${sign}${entry.amount}${entry.durationRounds > 0 ? ` (${entry.durationRounds} rounds)` : ""}`);
  }

  return summary;
}

async function applySkillEffects(sourceActor, skill, targetActor) {
  if (!(skill.system.effects ?? []).length) {
    ui.notifications?.warn("Essa skill não tem nenhum Efeito configurado.");
    return null;
  }

  const summary = await applyEffectsToActor(skill, targetActor);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p><strong>${sourceActor.name}</strong> usou <strong>${skill.name}</strong> em <strong>${targetActor.name}</strong>: ${summary.join(", ")}.</p>`
  });

  return true;
}

/**
 * Versão em Emissão (área) de `applySkillEffects`: aplica a mesma lista de `effects` em cada
 * Ator encontrado na área, numa única mensagem de chat consolidada.
 * @param {Actor} sourceActor
 * @param {Item} skill
 * @param {Actor[]} targetActors
 */
async function applySkillEffectsArea(sourceActor, skill, targetActors) {
  if (!(skill.system.effects ?? []).length) {
    ui.notifications?.warn("Essa skill não tem nenhum Efeito configurado.");
    return null;
  }
  if (!targetActors.length) {
    ui.notifications?.warn("Nenhum alvo encontrado na área.");
    return null;
  }

  const rows = [];
  for (const targetActor of targetActors) {
    const summary = await applyEffectsToActor(skill, targetActor);
    rows.push(`<li><strong>${targetActor.name}</strong>: ${summary.join(", ")}</li>`);
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `<p><strong>${sourceActor.name}</strong> usou <strong>${skill.name}</strong> (Emissão) em ${targetActors.length} alvo(s):</p><ul>${rows.join("")}</ul>`
  });

  return true;
}
