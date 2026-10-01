/**
 * Defesa Mágica e Resistência/Imunidade (de Skill e de Título), XP de Resistência e exposição a tipos de dano.
 * (Separado de skill-effects.js na reorganização de pastas — mesma lógica de antes.)
 */
import { SYSTEM_ID, MEU_SISTEMA, getActiveDamageElements, resistanceXpGain, getResistanceLearnThreshold } from "../core/config.js";
import { runAsGm } from "../helpers/gm-relay.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";

/**
 * Percentual (0-1) de redução aplicado sobre dano mágico/elemental, com base na Defesa
 * Mágica.Total do alvo. Ver MEU_SISTEMA.MAGIC_DEFENSE_REDUCTION_PER_POINT/_CAP em config.js.
 */
export function magicDefenseReduction(targetActor) {
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
  return resistanceSourceFor(targetActor, resistanceTarget).percent;
}

/**
 * Como `actorResistanceFor`, mas devolve também QUAL Skill entregou a parte de Skill — é ela que
 * ganha XP ao defender (ver `grantResistanceXp`). Título não entra: Título não tem nível, então
 * não tem o que evoluir. Quando duas Skills cobrem o mesmo alvo só a melhor conta, e portanto só
 * a melhor aprende.
 * @returns {{percent:number, skill:Item|null}}
 */
export function resistanceSourceFor(targetActor, resistanceTarget) {
  if (!targetActor) return { percent: 0, skill: null };

  let bestSkill = 0;
  let bestSkillItem = null;
  let bestTitle = 0;

  for (const item of targetActor.items) {
    if (item.type === "skill" && item.system.resistanceTarget === resistanceTarget) {
      const percent = computeResistancePercent(resistanceTarget, item.system.level);
      if (percent > bestSkill) {
        bestSkill = percent;
        bestSkillItem = item;
      }
    } else if (item.type === "title") {
      for (const entry of item.system.resistances ?? []) {
        if (entry.target === resistanceTarget) bestTitle = Math.max(bestTitle, (Number(entry.amount) || 0) / 100);
      }
    }
  }

  return { percent: bestSkill + bestTitle, skill: bestSkillItem };
}

/**
 * Credita XP nas Skills de Resistência que acabaram de reduzir dano — "aprender apanhando".
 *
 * **Só o Mestre executa.** Quem rola o ataque costuma não ter permissão de escrita na ficha do
 * alvo (um jogador atacando um NPC, por exemplo), então deixar qualquer cliente tentar gravaria
 * um erro de permissão no console e nada mais. O caso que importa — o Mestre atacando um
 * personagem — é justamente o que passa por aqui.
 *
 * O XP para no teto do nível atual (ver `xp` em item-models.js): a Skill acumula até encher e
 * então para, porque subir de nível continua sendo clique do Mestre.
 * @param {Array<{skill: Item, blocked: number}>} defenders - saída de `applyDamageReductions`
 * @param {Actor} targetActor
 */
export async function grantResistanceXp(defenders, targetActor) {
  if (!defenders?.length || !targetActor) return;

  const maxHp = targetActor.system?.attributes?.hp?.max ?? 0;
  const grants = defenders
    .filter(({ skill }) => !skill.system?.isItemGranted)
    .map(({ skill, blocked }) => ({ skillId: skill.id, gain: resistanceXpGain(blocked, maxHp) }))
    .filter(g => g.gain > 0);
  if (!grants.length) return;

  // Vai pelo relay (helpers/gm-relay.js): quem rolou o ataque quase nunca tem permissão de
  // escrita na ficha do alvo — jogador atacando jogador, ou atacando NPC. Sem isso o XP só
  // existia quando o próprio Mestre rolava.
  await runAsGm("resistanceXp", { actorUuid: targetActor.uuid, grants });
}

/**
 * Contabiliza que `targetActor` levou um golpe de cada tipo em `elements` — é o que, depois de
 * `getResistanceLearnThreshold()` golpes, faz o sistema SUGERIR ao Mestre conceder a Resistência
 * àquele tipo.
 *
 * Resistência é a única Skill do sistema que pode nascer assim, e mesmo ela **não é criada
 * sozinha**: o aviso é uma sugestão pela Voz do Mundo, e conceder continua sendo ato do Mestre —
 * conseguir a Skill pela primeira vez é deliberadamente mais difícil do que subi-la de nível
 * depois.
 *
 * Só conta dano ELEMENTAL: "Geral" não é um tipo que se leva golpe de, é a resistência
 * guarda-chuva — e ela ser automática tornaria trivial obter a redução mais forte do sistema.
 */
export async function registerResistanceExposure(targetActor, elements, finalDamage) {
  if (!targetActor || !(finalDamage > 0)) return; // golpe que não machucou não ensina nada
  if (!getResistanceLearnThreshold()) return;

  const relevant = (elements ?? []).filter(Boolean);
  if (!relevant.length) return;

  await runAsGm("resistanceExposure", { actorUuid: targetActor.uuid, elements: relevant });
}

/**
 * Lado-Mestre de `registerResistanceExposure`: incrementa o contador por tipo de dano guardado
 * nas flags do Ator e, ao cruzar o limiar, avisa uma única vez pela Voz do Mundo.
 *
 * Exportada porque quem chama é o relay (helpers/gm-relay.js), nunca outro ponto do sistema.
 * @param {Actor} actor
 * @param {string[]} elements
 */
export async function applyResistanceExposure(actor, elements) {
  const threshold = getResistanceLearnThreshold();
  if (!threshold || !Array.isArray(elements)) return;

  const exposure = { ...(actor.getFlag(SYSTEM_ID, "resistanceExposure") ?? {}) };
  const notified = new Set(actor.getFlag(SYSTEM_ID, "resistanceNotified") ?? []);
  const catalog = getActiveDamageElements();
  const announcements = [];
  let changed = false;

  for (const elementId of elements) {
    // Já tem a Skill? Então não há o que sugerir — o contador nem importa mais.
    const alreadyHas = actor.items.some(i => i.type === "skill" && i.system.resistanceTarget === elementId);
    if (alreadyHas || notified.has(elementId)) continue;

    exposure[elementId] = (Number(exposure[elementId]) || 0) + 1;
    changed = true;

    if (exposure[elementId] >= threshold) {
      notified.add(elementId);
      announcements.push(catalog.find(e => e.id === elementId)?.label ?? elementId);
    }
  }

  if (!changed) return;

  await actor.update({
    [`flags.${SYSTEM_ID}.resistanceExposure`]: exposure,
    [`flags.${SYSTEM_ID}.resistanceNotified`]: [...notified]
  });

  for (const label of announcements) {
    await announceVoiceOfTheWorld(actor, {
      kind: "resistance-available",
      title: "Resistência ao alcance",
      body:
        `${actor.name} já suportou ${threshold} golpes de ${label}. O corpo aprendeu o bastante — ` +
        `o Mestre pode conceder a Skill de Resistência a ${label}.`
    });
  }
}
