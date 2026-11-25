import {
  SYSTEM_ID, NIHILITY, isPredationEnabled, getPredationAttrPercent, getPredationFormsPercent, getPredationLevelStep, getAttributeLabel, actorToken
} from "../core/config.js";
import { applyLuckToFormula, luckOf } from "../combat/luck-rules.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";
import { autoSnapshot } from "../world/auto-snapshot.js";
import { isDead, isIncapacitated, countsAsNpc } from "../combat/incapacitation.js";
import { grantSkillUseXp } from "./skill-xp.js";
import { attachFormTemplate, ensureFolder } from "./form-request.js";
import { buildSubSkillsFromSources } from "./skill-snapshot.js";
import {
  tierRank, predationCandidates, ownedIndex, predationWins, predationMilestone, predationCounterKey, predationAttrGain, addPoints, predationSkillData, hasFormMechanic, normalizeSkillName,
  predationFormsGain, predationTakesOf, withStoredForm
} from "./predation-rules.js";

/**
 * Predação (7b.2): Mecânica de Skill "Predar". Sobre um alvo derrotado (morto, Caído ou Inconsciente), quem
 * preda rola um d100 por Skill do alvo (chance pelo Tier) e o Mestre confirma num card: as Skills ganhas
 * entram inteiras (com as Sub-Skills) no nível 1, uma parte dos atributos do alvo vira pontos permanentes
 * (só na 1ª, 5ª, 10ª, 20ª… criatura da mesma Espécie), quem tem uma Skill de Forma pode ganhar a forma do
 * corpo, e o Token some. Regras puras em predation-rules.js.
 */

const FLAG = "predation";
const COUNTS_FLAG = "predationCounts";

const actorByUuid = uuid => {
  try {
    const doc = uuid ? fromUuidSync(uuid) : null;
    return doc?.documentName === "Actor" ? doc : null;
  } catch {
    return null;
  }
};

const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);
const ownerIds = actor => game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.id);

/* ------------------------------------------------------------------ Quem pode ser predado */

/**
 * Por que este alvo não pode ser predado agora: `{text, soft}` ou null. `soft` = o Mestre pode passar
 * por cima (alvo ainda de pé, ou corpo já predado); o resto é recusa firme.
 */
export function predationBlockReason(sourceActor, targetActor) {
  if (!isPredationEnabled()) return { text: "O bloco Predação está desligado nesta mesa.", soft: false };
  if (!targetActor) return { text: "Escolha um alvo para predar.", soft: false };
  if (sourceActor?.type !== "character") return { text: "Só um Personagem preda.", soft: false };
  if (targetActor.type !== "character") return { text: `${targetActor.name} não pode ser predado (só Personagens).`, soft: false };
  if (targetActor.uuid === sourceActor.uuid) return { text: "Ninguém preda a si mesmo.", soft: false };
  if (targetActor.getFlag?.(SYSTEM_ID, "predated")) return { text: `${targetActor.name} já foi predado: o corpo foi consumido.`, soft: true };
  if (!isDead(targetActor) && !isIncapacitated(targetActor)) return { text: `${targetActor.name} ainda não foi derrotado (só se preda quem está morto, Caído ou Inconsciente).`, soft: true };
  return null;
}

/* ------------------------------------------------------------------ Uso */

function skillSnapshot(skill) {
  const sys = skill.system;
  return {
    id: skill.id,
    name: skill.name,
    key: skill.getFlag?.(SYSTEM_ID, "speciesGrant")?.key ?? "",
    tier: sys.tier,
    level: Number(sys.level) || 1,
    isItemGranted: Boolean(sys.isItemGranted),
    coreSkill: sys.coreSkill ?? "",
    weaponMastery: sys.weaponMastery ?? "",
    effectType: sys.effectType,
    subSkills: (sys.subSkills ?? []).map(s => ({ effectType: s.effectType }))
  };
}

/** As Skills de Forma próprias de quem preda (não concedidas por Item), para escolher qual ganha a forma. */
function formSkillOptions(predator) {
  return predator.items
    .filter(i => i.type === "skill" && !i.system.isItemGranted && hasFormMechanic({ effectType: i.system.effectType, subSkills: i.system.subSkills }))
    .map(i => ({ skillId: i.id, name: i.name }));
}

function attrTotals(target) {
  return Object.fromEntries(NIHILITY.COMBAT_ATTRIBUTES.map(key => [key, Number(target.system?.attributes?.combat?.[key]?.total) || 0]));
}

/** A chave do contador desta criatura: a Espécie, ou o nome da ficha base sem Espécie. */
export function counterKeyFor(target) {
  const baseName = target.isToken ? target.baseActor?.name ?? target.name : target.name;
  return predationCounterKey(target.system?.species, baseName);
}

export const predationCountOf = (predator, key) => Math.max(0, Math.floor(Number((predator.getFlag(SYSTEM_ID, COUNTS_FLAG) ?? {})[key]) || 0));

function targetToken(target) {
  const preferred = [...(game.user.targets ?? []), ...(canvas?.tokens?.controlled ?? [])];
  return actorToken(target, preferred)?.document ?? target.token ?? null;
}

/**
 * Usa a Predação: rola um d100 por Skill elegível e posta o card ao Mestre (e ao dono de quem preda).
 * Nada é aplicado aqui. Devolve true (saiu) ou false (alvo recusado).
 * @param {object} [options]
 * @param {boolean} [options.bypass] - o Mestre passou por cima de "ainda de pé"
 * @param {number|null} [options.subSkillIndex] - a Sub-Skill de Predação usada (a Skill de "Só formas" com formas guardadas)
 */
export async function usePredation(sourceActor, skill, mech, label, targetActor, { bypass = false, subSkillIndex = null } = {}) {
  const block = predationBlockReason(sourceActor, targetActor);
  if (block && !(block.soft && bypass && game.user.isGM)) {
    ui.notifications?.warn(block.text);
    return false;
  }
  // "O que a Predação leva" (1.120.0): "Só formas" não rola Skills, guarda a forma na própria Skill e dá uma fração dos pontos.
  const formsOnly = predationTakesOf(mech) === "forms";
  const owned = ownedIndex(sourceActor.items.filter(i => i.type === "skill").map(i => ({ name: i.name, key: i.getFlag(SYSTEM_ID, "speciesGrant")?.key })));
  const predatorRank = tierRank(mech.tier ?? skill.system.tier);
  const { eligible, skipped } = formsOnly ? { eligible: [], skipped: [] } : predationCandidates(targetActor.items.filter(i => i.type === "skill").map(skillSnapshot), predatorRank, owned, {
    predatorLevel: Number(mech.level ?? skill.system.level) || 1,
    levelStep: getPredationLevelStep()
  });

  const results = [];
  for (const entry of eligible) {
    // Sorte (8d.1): quem preda se beneficia; sucesso = resultado baixo, então a sorte entra invertida no d100.
    const roll = await new Roll(applyLuckToFormula("1d100", -luckOf(sourceActor, "chances"))).evaluate();
    results.push({ skillId: entry.id, name: entry.name, tier: entry.tier, chance: entry.chance, roll: roll.total, won: predationWins(roll.total, entry.chance) });
  }

  const key = counterKeyFor(targetActor);
  const count = predationCountOf(sourceActor, key) + 1;
  const fullGain = predationAttrGain(attrTotals(targetActor), getPredationAttrPercent());
  const attrGain = formsOnly ? predationFormsGain(fullGain, getPredationFormsPercent()) : fullGain;
  const data = {
    predatorUuid: sourceActor.uuid,
    targetUuid: targetActor.uuid,
    targetName: targetActor.name,
    tokenUuid: targetToken(targetActor)?.uuid ?? "",
    counterKey: key,
    count,
    milestone: predationMilestone(count),
    attrGain,
    results,
    skipped: skipped.map(s => ({ name: s.name, reason: s.reason })),
    formOptions: formsOnly ? [] : formSkillOptions(sourceActor),
    takes: formsOnly ? "forms" : "all",
    skillId: skill.id,
    subSkillIndex: Number.isInteger(subSkillIndex) ? subSkillIndex : null,
    label,
    status: "pending"
  };
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    whisper: Array.from(new Set([...gmIds(), ...ownerIds(sourceActor)])),
    content: cardHtml(data, sourceActor, label),
    flags: { [SYSTEM_ID]: { [FLAG]: data } }
  });
  await grantSkillUseXp(skill, [{ flat: true }]);
  return true;
}

/**
 * O que gravar num card pendente da Predação quando um d100 foi refeito (Rerrolar, 8d.2): o HTML novo
 * e o flag com os resultados novos. Quem escreve é o Mestre (relay `rerollApply`).
 */
export function predationCardUpdate(message, data) {
  let predator = null;
  try {
    predator = data.predatorUuid ? fromUuidSync(data.predatorUuid) : null;
  } catch (err) {
    predator = null;
  }
  return {
    content: cardHtml(data, predator ?? { name: message.alias ?? "?" }, data.label || "Predação"),
    [`flags.${SYSTEM_ID}.${FLAG}`]: data
  };
}

/* ------------------------------------------------------------------ Card */

const STATUS_TEXT = { confirmed: "Confirmada pelo Mestre.", cancelled: "Cancelada pelo Mestre: nada mudou.", error: "Não foi possível aplicar." };

function attrLine(attrGain) {
  const parts = Object.entries(attrGain).map(([key, value]) => `${getAttributeLabel(key)} +${value}`);
  return parts.join(" · ");
}

function cardHtml(data, predator, label) {
  // "Só formas" (1.120.0): sem Skills do alvo; o card mostra a forma que fica guardada e os pontos.
  if (data.takes === "forms") {
    const points = Object.keys(data.attrGain ?? {}).length
      ? `<p>Pontos de atributo (metade): ${data.milestone ? `<strong>${escapeHtml(attrLine(data.attrGain))}</strong> (é a ${data.count}ª criatura desta Espécie)` : `nenhum desta vez (a ${data.count}ª criatura da Espécie; só a 1ª, 5ª, 10ª, 20ª, 40ª… dão pontos)`}.</p>`
      : "<p>Pontos de atributo: nenhum.</p>";
    return `<div class="nihility-predation">
    <p><strong>${escapeHtml(predator.name)}</strong> preda <strong>${escapeHtml(data.targetName)}</strong> (${escapeHtml(label)}) · <em>Só formas</em>.</p>
    <p>Forma guardada: <strong>${escapeHtml(data.targetName)}</strong>. Fica na Skill como uma Sub-Skill de Forma ("Forma: …"): Transformar liga, Voltar desliga.</p>
    ${points}
    <p class="hint-inline">Skills do alvo: não rola (Só formas).</p>
    <div class="predation-controls"></div>
  </div>`;
  }
  const rows = data.results
    .map(r => `<li><span class="pred-skill-name" data-won="${r.won ? 1 : 0}">${escapeHtml(r.name)}</span> <em>(${escapeHtml(NIHILITY.SKILL_TIER_LABELS[r.tier] ?? r.tier)})</em> — chance ${r.chance}% · d100 = ${r.roll} · <strong>${r.won ? "✓ absorvida" : "✗ não absorvida"}</strong></li>`)
    .join("");
  const skipped = data.skipped.length ? `<p class="hint-inline">Não entram: ${data.skipped.map(s => `${escapeHtml(s.name)} (${escapeHtml(s.reason)})`).join(", ")}.</p>` : "";
  const points = Object.keys(data.attrGain).length
    ? `<p>Pontos de atributo: ${data.milestone ? `<strong>${escapeHtml(attrLine(data.attrGain))}</strong> (é a ${data.count}ª criatura desta Espécie)` : `nenhum desta vez (a ${data.count}ª criatura da Espécie; só a 1ª, 5ª, 10ª, 20ª, 40ª… dão pontos)`}.</p>`
    : "";
  return `<div class="nihility-predation">
    <p><strong>${escapeHtml(predator.name)}</strong> preda <strong>${escapeHtml(data.targetName)}</strong> (${escapeHtml(label)}).</p>
    ${rows ? `<ul>${rows}</ul>` : "<p>Nenhuma Skill do alvo pode ser absorvida.</p>"}${skipped}${points}
    <div class="predation-controls"></div>
  </div>`;
}

/** Botões e caixas do Mestre; os outros só leem o estado. */
function renderPredationCard(message, html) {
  const data = message.flags?.[SYSTEM_ID]?.[FLAG];
  if (!data) return;
  const slot = html.querySelector(".predation-controls");
  if (!slot) return;
  // Quem não é Mestre não fica sabendo as Skills do alvo pela Predação (achado do teste de 20/11): vê só
  // o Tier; o nome de uma Skill ganha aparece depois que o Mestre confirma (ela entra na ficha).
  if (!game.user.isGM) {
    for (const el of html.querySelectorAll(".pred-skill-name")) {
      if (!(data.status === "confirmed" && el.dataset.won === "1")) el.textContent = "Habilidade";
    }
  }
  if (data.status !== "pending") {
    slot.textContent = STATUS_TEXT[data.status] ?? data.status;
    return;
  }
  if (!game.user.isGM) {
    slot.textContent = "Aguardando o Mestre confirmar: nada é seu ainda.";
    return;
  }
  const target = actorByUuid(data.targetUuid);
  const wrap = document.createElement("div");
  const checkbox = (name, text, checked) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    input.checked = checked;
    label.append(input, ` ${text}`);
    return { label, input };
  };
  let formSelect = null;
  let formBox = null;
  if (data.formOptions?.length) {
    formBox = checkbox("form", "Ganhar a forma", false);
    formSelect = document.createElement("select");
    for (const option of data.formOptions) {
      const opt = document.createElement("option");
      opt.value = option.skillId;
      opt.textContent = option.name;
      formSelect.append(opt);
    }
    const row = document.createElement("div");
    row.append(formBox.label, " ", formSelect);
    wrap.append(row);
  }
  const tokenBox = checkbox("token", "Remover o Token", Boolean(target && countsAsNpc(target)));
  if (data.tokenUuid) wrap.append(tokenBox.label);
  const make = (text, handler) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.addEventListener("click", async event => {
      event.preventDefault();
      for (const b of slot.querySelectorAll("button")) b.disabled = true;
      try {
        await handler();
      } catch (err) {
        reportError("Falha na Predação.", err);
      }
    });
    return button;
  };
  const row = document.createElement("div");
  row.append(
    make("Confirmar", () => confirmPredation(message, { form: Boolean(formBox?.input.checked), formSkillId: formSelect?.value ?? "", removeToken: data.tokenUuid ? tokenBox.input.checked : false })),
    make("Cancelar", () => message.setFlag(SYSTEM_ID, FLAG, { ...data, status: "cancelled" }))
  );
  wrap.append(row);
  slot.append(wrap);
}

/* ------------------------------------------------------------------ Confirmar (Mestre) */

/**
 * Guarda a forma na própria Skill de Predação ("Só formas", 1.120.0): a mecânica de Predação vira a Sub-Skill "Predar" na
 * primeira vez e cada forma é uma Sub-Skill de Forma Ativa (o motor de Forma de sempre: Transformar = ligar, Voltar = desligar).
 */
async function storeFormInPredation(predator, skillId, template) {
  const skill = predator.items.get(String(skillId ?? ""));
  if (!skill) return false;
  const current = foundry.utils.deepClone(skill._source.system.subSkills ?? []);
  const predateSub = current.length ? null : buildSubSkillsFromSources([skill])[0];
  const { subs, added } = withStoredForm(current, predateSub, { uuid: template.uuid, name: template.name });
  if (added) await skill.update({ "system.subSkills": subs });
  return true;
}

/** Cria a ficha-molde a partir do alvo e a liga à Skill de Forma escolhida. Devolve o molde ou null. */
async function createFormTemplate(predator, target, tokenDoc) {
  const data = target.toObject();
  delete data._id;
  delete data.sort;
  delete data._stats;
  data.folder = await ensureFolder("Formas");
  data.effects = [];
  data.flags = {};
  data.ownership = { default: 0 };
  for (const id of ownerIds(predator)) data.ownership[id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  data.system = { ...(data.system ?? {}), formTemplate: true, isPlayerCharacter: false };
  data.prototypeToken = { ...(data.prototypeToken ?? {}), actorLink: false };
  const texture = tokenDoc?.texture?.src;
  if (texture) data.prototypeToken.texture = { ...(data.prototypeToken.texture ?? {}), src: texture };
  const created = await Actor.create(data);
  if (!created) return null;
  await created.update({ "system.attributes.hp.value": created.system.attributes.hp.max });
  return created;
}

async function removeTokenAndCombatants(tokenDoc) {
  if (!tokenDoc) return;
  for (const combat of game.combats) {
    const ids = combat.combatants.filter(c => c.tokenId === tokenDoc.id && (!c.sceneId || c.sceneId === tokenDoc.parent?.id)).map(c => c.id);
    if (ids.length) await combat.deleteEmbeddedDocuments("Combatant", ids);
  }
  await tokenDoc.delete();
}

/**
 * Aplica a Predação confirmada pelo Mestre. Marca o card ANTES de mexer em qualquer ficha: dois cliques
 * (ou dois Mestres) nunca aplicam duas vezes.
 * @param {ChatMessage} message
 * @param {{form: boolean, formSkillId: string, removeToken: boolean}} choice
 */
export async function confirmPredation(message, choice) {
  if (!game.user.isGM) return;
  const data = message.flags?.[SYSTEM_ID]?.[FLAG];
  if (!data || data.status !== "pending") return;
  await message.setFlag(SYSTEM_ID, FLAG, { ...data, status: "confirmed" });
  const predator = actorByUuid(data.predatorUuid);
  const target = actorByUuid(data.targetUuid);
  if (!predator || !target) {
    await message.setFlag(SYSTEM_ID, FLAG, { ...data, status: "error" });
    ui.notifications.warn("Quem preda ou o alvo não existe mais: nada foi aplicado.");
    return;
  }
  await autoSnapshot(predator, `Antes de predar ${data.targetName}`);

  const lines = [];
  const tokenDoc = data.tokenUuid ? await fromUuid(data.tokenUuid).catch(() => null) : null;

  // Skills ganhas: inteiras (com Sub-Skills), nível 1; as que ele já tem agora (outro uso no meio) ficam de fora.
  const owned = ownedIndex(predator.items.filter(i => i.type === "skill").map(i => ({ name: i.name, key: i.getFlag(SYSTEM_ID, "speciesGrant")?.key })));
  const toCreate = [];
  for (const result of data.results.filter(r => r.won)) {
    const source = target.items.get(result.skillId);
    if (!source) continue;
    if (owned.names.has(normalizeSkillName(source.name))) continue;
    toCreate.push(predationSkillData(source.toObject(), { systemId: SYSTEM_ID, from: data.targetName }));
  }
  if (toCreate.length) {
    await predator.createEmbeddedDocuments("Item", toCreate);
    lines.push(`Skills: ${toCreate.map(s => s.name).join(", ")} (nível 1)`);
  }

  // Contador por Espécie e pontos de atributo (só nos marcos).
  const count = predationCountOf(predator, data.counterKey) + 1;
  await predator.setFlag(SYSTEM_ID, COUNTS_FLAG, { ...(predator.getFlag(SYSTEM_ID, COUNTS_FLAG) ?? {}), [data.counterKey]: count });
  if (predationMilestone(count) && Object.keys(data.attrGain ?? {}).length) {
    const current = Object.fromEntries(Object.keys(data.attrGain).map(key => [key, Number(predator._source.system.attributes.combat[key]?.predationPoints) || 0]));
    const next = addPoints(current, data.attrGain);
    const update = {};
    for (const [key, value] of Object.entries(next)) update[`system.attributes.combat.${key}.predationPoints`] = value;
    await predator.update(update);
    lines.push(`Atributos: ${attrLine(data.attrGain)}`);
  }

  // "Só formas" (1.120.0): a forma é guardada na própria Skill de Predação (uma Sub-Skill de Forma), sem escolher Skill de Forma.
  if (data.takes === "forms") {
    const template = await createFormTemplate(predator, target, tokenDoc);
    if (template) {
      const stored = await storeFormInPredation(predator, data.skillId, template);
      lines.push(stored ? `Forma guardada na Skill: ${template.name}` : `Forma criada (${template.name}), mas a Skill de Predação não foi achada`);
    }
  } else if (choice.form && choice.formSkillId) {
    const template = await createFormTemplate(predator, target, tokenDoc);
    if (template) {
      const linked = await attachFormTemplate(predator, choice.formSkillId, template);
      lines.push(linked ? `Forma: ${template.name}` : `Forma criada (${template.name}), sem Skill ligada`);
    }
  }

  await target.setFlag(SYSTEM_ID, "predated", true).catch(() => {});
  if (choice.removeToken && tokenDoc) {
    await removeTokenAndCombatants(tokenDoc);
    lines.push("O corpo foi consumido");
  }

  await announceVoiceOfTheWorld(predator, {
    kind: "predation",
    title: `Predação: ${data.targetName}`,
    body: lines.length ? `${predator.name} preda ${data.targetName}. ${lines.join(". ")}.` : `${predator.name} preda ${data.targetName}, mas não leva nada desta vez.`
  });
}

/** Chamado uma vez, no `init`: o card da Predação (botões do Mestre). */
export function registerPredation() {
  Hooks.on("renderChatMessageHTML", renderPredationCard);
}
