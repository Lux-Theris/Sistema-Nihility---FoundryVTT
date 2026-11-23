/**
 * Tipos de arma, Maestria e ataque desarmado (H6) — o lado Foundry. As contas estão em
 * `weapon-mastery-rules.js` (pura, testada); aqui só se lê o mundo (catálogo, fichas, Regras da Mesa),
 * se grava XP/contagem e se desenha o card de sugestão.
 *
 * Regras de ligação (docs/claude/armas-maestria.md):
 *  - `FEATURES.weaponMastery` desligada: some o tipo, o bônus, a XP e a sugestão. O ataque desarmado
 *    continua existindo, como `unarmed` puro e sem bônus. Nada salvo é apagado.
 *  - Este arquivo NÃO importa `damage-roll.js` de forma estática (é ele que nos chama): o fluxo de
 *    ataque o carrega sob demanda.
 */
import {
  SYSTEM_ID,
  NIHILITY,
  isFeatureEnabled,
  getFeatureOption,
  getActiveWeaponTypes,
  getDamageElement,
  getAttributeLabel
} from "../core/config.js";
import { itemIsTech } from "../core/magic-rules.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { runAsGm } from "../helpers/gm-relay.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";
import { grantMasteryXp, vitalBase } from "../skills/skill-xp.js";
import {
  UNARMED_TYPE_ID,
  weaponTypeLabel,
  weaponTypeOptions,
  resolveWeaponType,
  bestMastery,
  masteryFactor,
  masteryTraceRow,
  masterySentence,
  masteryEarnsXp,
  masteryPushMeters,
  practiceKey,
  bumpPractice,
  buildUnarmedWeapon,
  resolveUnarmedFormula,
  resolveUnarmedElement,
  attackRollFlat,
  attackRollFlavor,
  formatMasteryPercent,
  damageMeasures,
  resolveStrikeRequirement,
  strikeWeaponOk
} from "./weapon-mastery-rules.js";

/* ------------------------------------------------------------------ Configuração */

export function isWeaponMasteryEnabled() {
  return isFeatureEnabled("weaponMastery");
}

/** A configuração do bloco (lista detalhada, % por nível, teto…) lida dos Módulos do Sistema. */
export function masteryConfig() {
  const opt = key => getFeatureOption("weaponMastery", key);
  return {
    detailed: Boolean(opt("weaponTypesDetailed")),
    percentPerLevel: opt("masteryPercentPerLevel"),
    subtypeFactor: opt("masterySubtypeFactor"),
    maxLevel: opt("masteryMaxLevel"),
    evolvedPercent: opt("masteryEvolvedPercent")
  };
}

/** O rótulo de um tipo como o mundo o mostra (grupo na lista simples, caminho na detalhada). */
export function weaponTypeDisplay(id) {
  return weaponTypeLabel(id, getActiveWeaponTypes(), { detailed: masteryConfig().detailed });
}

/** Opções para um `<select>` de tipo (sem a opção vazia — quem chama põe o "— sem tipo —"). */
export function weaponTypeChoices(current = "") {
  return weaponTypeOptions(getActiveWeaponTypes(), { detailed: masteryConfig().detailed, current });
}

/* ------------------------------------------------------------------ Maestrias da ficha */

/** As Maestrias de arma de um Ator: `[{type, level, rank, skill}]`. Vazio com o bloco desligado. */
export function actorMasteries(actor) {
  if (!isWeaponMasteryEnabled() || !actor?.items) return [];
  return actor.items
    .filter(i => i.type === "skill" && i.system.weaponMastery)
    .map(skill => ({ type: skill.system.weaponMastery, level: Number(skill.system.level) || 1, rank: Number(skill.system.masteryRank) || 1, skill }));
}

/** A melhor Maestria que cobre um ataque do tipo `typeId`: `{mastery, percent, level}` ou null. */
export function masteryHitFor(actor, typeId) {
  if (!typeId || !isWeaponMasteryEnabled()) return null;
  return bestMastery(actorMasteries(actor), typeId, getActiveWeaponTypes(), masteryConfig());
}

/* ------------------------------------------------------------------ Ataque desarmado */

function readSetting(key, fallback) {
  try {
    const value = game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS[key]);
    return value === undefined || value === null || value === "" ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

/** Os itens equipados que "reforçam o desarmado", na ordem da ficha. */
function augmentingItems(actor) {
  return (actor?.items?.filter(i => i.type === "item" && i.system.equipped && i.system.weapon?.enabled && i.system.weapon.augmentsUnarmed) ?? []);
}

/** O item é uma arma que reforça o desarmado (não ganha botão Atacar)? */
export function augmentsUnarmed(item) {
  return Boolean(item?.system?.weapon?.enabled && item.system.weapon.augmentsUnarmed);
}

/**
 * A arma sintética do ataque desarmado de um Ator, no formato de Item que `useWeaponAttack` lê
 * (`name`, `system.weapon`, `update`). Precedência do tipo: efeito de Skill > item que reforça >
 * `unarmed`. Com o bloco desligado o tipo é sempre `unarmed` e nada vale como Maestria.
 */
export function unarmedWeaponItem(actor) {
  const masteryOn = isWeaponMasteryEnabled();
  const types = getActiveWeaponTypes();
  const known = id => (id && types.some(t => t.id === id) ? id : "");
  const augments = augmentingItems(actor).map(item => ({
    name: item.name,
    formula: item.system.weapon.damageFormula,
    elements: (item.system.weapon.damageElements ?? []).filter(id => getDamageElement(id)),
    weaponType: masteryOn ? known(item.system.weapon.weaponType) : "",
    magic: Boolean(item.system.weapon.isMagicDamage),
    absolute: Boolean(item.system.weapon.isAbsoluteDamage),
    tech: itemIsTech(item.system)
  }));
  const formula = resolveUnarmedFormula(readSetting("unarmedFormula", "1d4"), f => Roll.validate(f), "1d4");
  const attribute = readSetting("unarmedAttribute", "strength");
  const element = resolveUnarmedElement(readSetting("unarmedElement", "blunt"), id => Boolean(getDamageElement(id)), "physical");
  const override = masteryOn ? known(actor?.system?.weaponBonuses?.unarmedType) : "";
  const spec = buildUnarmedWeapon({ formula, attribute, element }, augments, override);
  return {
    name: spec.name,
    uuid: null,
    synthetic: true,
    parent: actor,
    system: {
      equipped: true,
      tech: spec.isTech,
      weapon: {
        enabled: true,
        mode: "damage",
        damageFormula: spec.damageFormula,
        scalingAttribute: spec.scalingAttribute,
        isMagicDamage: spec.isMagicDamage,
        isAbsoluteDamage: spec.isAbsoluteDamage,
        damageScale: "",
        damageElements: spec.damageElements,
        weaponType: spec.weaponType,
        range: 0,
        magazineSize: 0,
        loaded: 0,
        ammoTypes: [],
        loadedAmmo: null
      }
    },
    augmentedBy: spec.augmentedBy,
    async update() {}
  };
}

/** O tipo com que o ataque conta (para Maestria, XP e aprendizado). Vazio = sem tipo / bloco desligado. */
export function attackTypeOf(weaponItem) {
  if (!isWeaponMasteryEnabled()) return "";
  return weaponItem?.system?.weapon?.weaponType || "";
}

/**
 * A Maestria que vale para esta arma na mão deste Ator: `{percent, level, label, skill, typeId}` ou null.
 * `label` = o tipo como o mundo o mostra.
 */
export function weaponMasteryHit(actor, weaponItem) {
  const typeId = attackTypeOf(weaponItem);
  const hit = masteryHitFor(actor, typeId);
  if (!hit) return null;
  const detailed = masteryConfig().detailed;
  return {
    percent: hit.percent,
    level: hit.level,
    label: weaponTypeLabel(hit.mastery.type, getActiveWeaponTypes(), { detailed }),
    skill: hit.mastery.skill,
    typeId
  };
}

/* ------------------------------------------------------------------ Gravidade */

/** Metros de um empurrão de arma de gravidade com a Maestria do dono (mesmo % do dano). */
export function gravityWeaponMeters(actor, weaponItem, meters) {
  const hit = weaponMasteryHit(actor, weaponItem);
  return hit ? masteryPushMeters(meters, hit.percent) : meters;
}

/* ------------------------------------------------------------------ Depois do golpe: XP e prática */

/**
 * Chamado por `useWeaponAttack` depois de um ataque resolvido: credita XP à Maestria que valeu e,
 * sem Maestria que cubra o tipo, conta o ataque para a sugestão de aprender pela prática. Nunca lança.
 */
export async function afterWeaponAttack(actor, weaponItem, hit, result, targetActor) {
  await creditAttack(actor, attackTypeOf(weaponItem), hit, result, targetActor);
}

async function creditAttack(actor, typeId, hit, result, targetActor) {
  try {
    if (!isWeaponMasteryEnabled() || !result) return;
    if (hit) {
      const measures = damageMeasures(result, targetActor, vitalBase);
      if (measures.length && masteryEarnsXp(hit.skill.system, masteryConfig())) await grantMasteryXp(hit.skill, measures);
      return;
    }
    await registerWeaponPractice(actor, typeId);
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Falha ao registrar a Maestria do ataque.`, err);
  }
}

/**
 * Golpe de arma que exige arma compatível equipada (`strikeRequiresWeapon`): a mensagem (pt-BR) do
 * impedimento, ou null. Desarmado nunca exige; com o bloco desligado nada é conferido. Desligar uma Skill
 * Ativa nunca é bloqueado. Chamado antes de pedir alvo (`useSkillFlow`) e de novo em `runSkillEffect`.
 */
export function strikeBlockReason(actor, skill, subSkillIndex = null) {
  try {
    if (!isWeaponMasteryEnabled() || !skill || actor?.type !== "character") return null;
    const sub = subSkillIndex != null ? (skill.system.subSkills ?? [])[subSkillIndex] : null;
    const own = sub ?? skill.system;
    if (own?.hasUpkeep && own?.active) return null;
    const { type, requiresWeapon } = resolveStrikeRequirement(own, sub ? skill.system : null);
    if (!requiresWeapon) return null;
    const equippedTypes = (actor.items?.filter(i => i.type === "item" && i.system.equipped && i.system.weapon?.enabled) ?? [])
      .map(i => i.system.weapon.weaponType)
      .filter(Boolean);
    const types = getActiveWeaponTypes();
    const detailed = masteryConfig().detailed;
    if (strikeWeaponOk(type, equippedTypes, types, detailed)) return null;
    const label = weaponTypeLabel(type, types, { detailed });
    const name = sub ? `${skill.name} — ${sub.name}` : skill.name;
    return `${name} precisa de uma arma de ${label} equipada.`;
  } catch (err) {
    return null;
  }
}

/**
 * O bônus de Maestria de um golpe de arma de Skill (`mech.weaponStrike` já resolvido): `{percent, label}`
 * para `rollSkillDamage`, ou null. O tipo é o da Skill, sempre — itens e o efeito "Desarmado vira tipo" não o mudam.
 */
export function strikeMasteryBonus(actor, mech) {
  const typeId = mech?.weaponStrike;
  if (!typeId || !isWeaponMasteryEnabled()) return null;
  const hit = masteryHitFor(actor, typeId);
  if (!hit) return null;
  return { percent: hit.percent, label: weaponTypeLabel(hit.mastery.type, getActiveWeaponTypes(), { detailed: masteryConfig().detailed }) };
}

/**
 * Depois de usar uma Skill de dano com golpe de arma: a Maestria que cobriu ganha a fatia de XP (além da
 * XP por uso da própria Skill) ou, sem Maestria do tipo, a prática conta. Chamado por `runSkillEffect`.
 */
export async function afterSkillStrike(actor, mech, result, targetActor) {
  const typeId = mech?.weaponStrike;
  if (!typeId || !result || !isWeaponMasteryEnabled()) return;
  await creditAttack(actor, typeId, masteryHitFor(actor, typeId) ? { skill: masteryHitFor(actor, typeId).mastery.skill } : null, result, targetActor);
}

/**
 * Conta mais um ataque do tipo (grupo na lista simples, id exato na detalhada) e, ao chegar no limiar,
 * manda UMA sugestão ao Mestre. Só fichas de jogador contam, e só quem é dono grava (o atacante).
 * O sistema nunca concede a Maestria sozinho.
 */
export async function registerWeaponPractice(actor, typeId) {
  const threshold = Math.floor(Number(getFeatureOption("weaponMastery", "masteryLearnThreshold"))) || 0;
  if (!threshold || !typeId || !actor?.isOwner || actor.type !== "character" || !actor.hasPlayerOwner) return;
  const types = getActiveWeaponTypes();
  const key = practiceKey(typeId, types, masteryConfig().detailed);
  if (!key) return;
  const current = actor.getFlag(SYSTEM_ID, "weaponPractice") ?? {};
  const { state, suggest } = bumpPractice(current, key, threshold);
  await actor.setFlag(SYSTEM_ID, "weaponPractice", state);
  if (suggest) await postMasterySuggestion(actor, key, threshold);
}

async function postMasterySuggestion(actor, typeId, threshold) {
  const label = weaponTypeLabel(typeId, getActiveWeaponTypes(), { detailed: masteryConfig().detailed });
  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
  const content =
    `<div class="nihility-mastery-suggestion"><p><strong>${escapeHtml(actor.name)}</strong> já atacou ${threshold} vezes com <strong>${escapeHtml(label)}</strong> ` +
    `e ainda não tem Maestria desse tipo. O corpo aprendeu o bastante — o Mestre pode conceder.</p>` +
    `<div class="mastery-suggestion-actions"></div></div>`;
  await ChatMessage.create({
    content,
    whisper: gmIds,
    speaker: ChatMessage.getSpeaker({ actor }),
    flags: { [SYSTEM_ID]: { masterySuggestion: { actorUuid: actor.uuid, typeId, label, done: false } } }
  });
}

/** Desenha o botão "Dar Maestria de X" no card de sugestão (só o Mestre). Ligado ao `renderChatMessageHTML`. */
export function renderMasterySuggestion(message, html) {
  const data = message.getFlag?.(SYSTEM_ID, "masterySuggestion");
  if (!data) return;
  const holder = html.querySelector(".mastery-suggestion-actions");
  if (!holder) return;
  if (data.done) {
    holder.innerHTML = `<p class="hint-inline">Maestria concedida.</p>`;
    return;
  }
  if (!game.user.isGM) {
    holder.remove();
    return;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `Dar Maestria de ${data.label}`;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await giveMasteryFromSuggestion(message, data);
    } catch (err) {
      button.disabled = false;
      reportError("Falha ao conceder a Maestria.", err);
    }
  });
  holder.appendChild(button);
}

/** Cria a Skill de Maestria (Extra, nível 1, mundana) na ficha, avisa pela Voz do Mundo e marca o card. */
async function giveMasteryFromSuggestion(message, data) {
  if (!game.user.isGM) return;
  const actor = await fromUuid(data.actorUuid);
  if (!actor) {
    ui.notifications?.warn("A ficha desse personagem não existe mais.");
    return;
  }
  const types = getActiveWeaponTypes();
  if (masteryHitFor(actor, data.typeId)) {
    ui.notifications?.info(`${actor.name} já tem uma Maestria que cobre ${data.label}.`);
  } else {
    const label = weaponTypeLabel(data.typeId, types, { detailed: masteryConfig().detailed });
    await actor.createEmbeddedDocuments("Item", [masterySkillData(data.typeId, label)]);
    await announceVoiceOfTheWorld(actor, {
      kind: "mastery-granted",
      title: "Maestria de arma",
      body: `${actor.name} aprendeu pela prática: Maestria de ${label}.`
    });
  }
  await message.setFlag(SYSTEM_ID, "masterySuggestion", { ...data, done: true });
}

/** Os dados de uma Skill de Maestria nova (Extra, nível 1, mundana, descritiva). */
export function masterySkillData(typeId, label) {
  return {
    name: `Maestria: ${label}`,
    type: "skill",
    system: {
      tier: "extra",
      level: 1,
      cost: 0,
      effectType: "none",
      weaponMastery: typeId,
      masteryRank: 1,
      magicTag: "mundane",
      isMagic: false,
      isTech: false,
      description: `<p>Treino com armas do tipo <strong>${escapeHtml(label)}</strong>: dá dano extra com elas e rende XP a cada golpe.</p>`
    }
  };
}

/* ------------------------------------------------------------------ Fluxos (botão, 🎲, hotbar) */

/**
 * "Atacar" com uma arma da ficha ou com o desarmado (`weaponItem` nulo). Mesmas etapas de sempre:
 * Vida 0, carregador, opções do Shift, alvo, e o ataque. Público para a hotbar (`unarmedAttack`).
 */
export async function weaponAttackFlow(actor, weaponItem = null, event = null) {
  const [{ useWeaponAttack }, { blockIfIncapacitated }, { weaponCanFire }, { rollOptionsFromEvent }, { pickTargetActor }] = await Promise.all([
    import("./damage-roll.js"),
    import("./incapacitation.js"),
    import("../economy/consumables.js"),
    import("../apps/roll-options-dialog.js"),
    import("../helpers/target-picker.js")
  ]);
  const item = weaponItem ?? unarmedWeaponItem(actor);
  try {
    // Arma de gravidade (J1) não rola dano: não precisa de fórmula.
    if (item.system.weapon.mode !== "gravity" && !item.system.weapon.damageFormula?.trim()) {
      ui.notifications.warn(`${item.name} não tem uma Fórmula de Dano configurada.`);
      return;
    }
    if (blockIfIncapacitated(actor, "atacar")) return;
    // Carregador vazio: avisa antes de pedir alvo (o Recarregar fica na linha da arma).
    if (!item.synthetic && !weaponCanFire(item)) return;
    const { cancelled, options } = await rollOptionsFromEvent(event, `Atacar com ${item.name}`);
    if (cancelled) return;
    const targetActor = await pickTargetActor({ self: actor, title: `Atacar com ${item.name}`, confirmLabel: "Atacar", preferMap: true });
    if (!targetActor) return;
    await useWeaponAttack(actor, item, targetActor, options);
  } catch (err) {
    reportError("Falha ao atacar com arma.", err);
  }
}

/**
 * O 🎲 de ataque: rola o atributo de escala da arma (sem ele, Força) como qualquer 🎲 de atributo,
 * somando o bônus "por fora" do atributo e o nível da melhor Maestria que cobre a arma.
 */
export async function weaponAttackRoll(actor, weaponItem = null, event = null) {
  const [{ rollAttribute }, { rollOptionsFromEvent }] = await Promise.all([import("../core/dice.js"), import("../apps/roll-options-dialog.js")]);
  const item = weaponItem ?? unarmedWeaponItem(actor);
  const weapon = item.system.weapon;
  const key = weapon.scalingAttribute || "strength";
  const attr = actor.system?.attributes?.combat?.[key];
  if (!attr) {
    ui.notifications.warn(`${actor.name} não tem o atributo ${getAttributeLabel(key)}.`);
    return null;
  }
  const hit = weaponMasteryHit(actor, item);
  const { cancelled, options } = await rollOptionsFromEvent(event, `Ataque com ${item.name}`);
  if (cancelled) return null;
  const flat = attackRollFlat({ itemBonus: attr.itemBonus ?? 0, masteryLevel: hit?.level ?? 0 });
  return rollAttribute(actor, key, {
    extraFlat: flat,
    flavor: escapeHtml(attackRollFlavor(item.name, hit?.level ?? 0)),
    rollOptions: options
  });
}

/** Para a macro da hotbar: `game.nihility.unarmedAttack(actorUuid)`. Shift abre os modificadores. */
export async function unarmedAttackFromHotbar(actorUuid) {
  const actor = typeof actorUuid === "string" ? await fromUuid(actorUuid) : null;
  const target = actor?.actor ?? actor; // um Token do documento também serve
  if (!target || target.documentName !== "Actor") {
    ui.notifications.warn("Esta macro aponta para um personagem que não existe mais.");
    return;
  }
  if (!target.isOwner) {
    ui.notifications.warn(`Você não controla ${target.name}.`);
    return;
  }
  const event = { shiftKey: Boolean(game.keyboard?.isModifierActive?.("Shift")) };
  return weaponAttackFlow(target, null, event);
}

/* ------------------------------------------------------------------ Frases e rastro */

/** A frase da Skill de Maestria ("Maestria: Lâminas · +15% de dano"), ou "" se a Skill não for uma. */
export function masterySentenceFor(skillSystem) {
  if (!isWeaponMasteryEnabled() || !skillSystem?.weaponMastery) return "";
  const cfg = masteryConfig();
  const types = getActiveWeaponTypes();
  return masterySentence(
    { typeLabel: weaponTypeLabel(skillSystem.weaponMastery, types, { detailed: cfg.detailed }), level: skillSystem.level, rank: skillSystem.masteryRank, type: skillSystem.weaponMastery },
    types,
    cfg
  );
}

export { masteryFactor, masteryTraceRow, formatMasteryPercent, resolveWeaponType, UNARMED_TYPE_ID };

/* ------------------------------------------------------------------ Ganchos */

/**
 * Uma Skill de Maestria nasce mundana: Antimagia/PEM nunca a desligam. Vale ao criar e ao escolher
 * a Maestria numa Skill que já existe (só quando a escolha não trouxe a própria natureza).
 */
export function registerWeaponMastery() {
  Hooks.on("preCreateItem", (item, data) => {
    if (item.type !== "skill" || !(data?.system?.weaponMastery ?? item.system?.weaponMastery)) return;
    if (data?.system?.magicTag) return;
    item.updateSource({ "system.magicTag": "mundane", "system.isMagic": false });
  });
  Hooks.on("preUpdateItem", (item, changes) => {
    if (item.type !== "skill") return;
    const picked = foundry.utils.getProperty(changes, "system.weaponMastery");
    if (!picked || picked === item.system.weaponMastery) return;
    if (foundry.utils.getProperty(changes, "system.magicTag") !== undefined) return;
    foundry.utils.setProperty(changes, "system.magicTag", "mundane");
    foundry.utils.setProperty(changes, "system.isMagic", false);
  });
}

/** A linha do ataque desarmado na ficha: nome e "1d4 de Contundente · Força · Lâminas · Maestria +15%". */
export function unarmedSummary(actor) {
  const item = unarmedWeaponItem(actor);
  const weapon = item.system.weapon;
  const elements = (weapon.damageElements ?? []).map(id => getDamageElement(id)?.label ?? id);
  const parts = [`${weapon.damageFormula}${elements.length ? ` de ${elements.join(" + ")}` : ""}`];
  if (weapon.scalingAttribute) parts.push(getAttributeLabel(weapon.scalingAttribute));
  if (isWeaponMasteryEnabled() && weapon.weaponType) parts.push(weaponTypeDisplay(weapon.weaponType));
  const hit = weaponMasteryHit(actor, item);
  if (hit) parts.push(`Maestria +${formatMasteryPercent(hit.percent)}%`);
  return { name: item.name, summary: parts.join(" · ") };
}
