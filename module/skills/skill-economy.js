/**
 * Economia de Skills: Habilidades concedidas por Item/Módulo, Fusão, Evolução e Pontos de
 * Habilidade (quebra/fusão/pedido/aprovação via chat). Extraído de ai-helper.js (Fase 4 do
 * refactor) — nada aqui fala com IA diretamente, exceto `fuseSkills` no modo "auto" (Skill
 * Única/Ultimate), que delega pra `requestAISpecialSkill` em ai-generation.js.
 */
import { SYSTEM_ID, MEU_SISTEMA } from "../core/config.js";
import { ensureSystemCompendiums, getCompendiumForItemType, registerItemInCompendium } from "../core/compendium.js";
import { buildSubSkillsFromSources, buildGrantedSkillData } from "./skill-snapshot.js";
import { requestAISpecialSkill } from "../ai/ai-generation.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";
import { renderSystemTemplate } from "../helpers/foundry-compat.js";
import { escapeHtml } from "../helpers/html.js";
import { requestSkillSystem, isOpenRequest } from "../creation/creation-rules.js";

/* -------------------------------------------- */
/*  Habilidades concedidas por Item/Módulo       */
/* -------------------------------------------- */

/**
 * Cria uma Skill de verdade no Ator a partir de um `grantsSkill` (Item Geral,
 * Modificação de Parte do Corpo ou Módulo de Nave), marcada como concedida por
 * item — nunca entra em fusão, e é removida junto quando a fonte é revogada.
 * @param {Actor} actor
 * @param {object} grantsSkill - a Skill inteira guardada na fonte (ver `grantedSkillSchema`)
 * @param {string} sourceKey - identifica a fonte (ex: `${itemId}` ou `${itemId}:${modIndex}`)
 * @returns {Promise<Item|null>} a Skill criada, ou null se `grantsSkill.name` estiver vazio
 */
export async function createGrantedSkill(actor, grantsSkill, sourceKey) {
  const data = buildGrantedSkillData(grantsSkill, MEU_SISTEMA.ITEM_GRANTABLE_SKILL_TIERS);
  if (!data) return null;
  data.flags = { [SYSTEM_ID]: { grantedBySource: sourceKey } };

  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return created;
}

/**
 * Recria a Skill concedida por uma fonte depois que o molde dela foi editado — senão a Skill
 * na ficha continuaria com a mecânica antiga até alguém desequipar e equipar de novo. Só age se
 * a fonte estiver concedendo agora (existe uma Skill com essa `sourceKey` no Ator).
 * @returns {Promise<boolean>} true se havia uma Skill concedida e ela foi recriada
 */
export async function refreshGrantedSkill(actor, grantsSkill, sourceKey) {
  if (!actor) return false;
  const current = actor.items.some(i => i.type === "skill" && i.flags?.[SYSTEM_ID]?.grantedBySource === sourceKey);
  if (!current) return false;
  await removeGrantedSkill(actor, sourceKey);
  await createGrantedSkill(actor, grantsSkill, sourceKey);
  return true;
}

/**
 * Remove a(s) Skill(s) concedida(s) por uma fonte específica (ver `createGrantedSkill`).
 * @param {Actor} actor
 * @param {string} sourceKey
 */
export async function removeGrantedSkill(actor, sourceKey) {
  const toRemove = actor.items.filter(
    i => i.type === "skill" && i.flags?.[SYSTEM_ID]?.grantedBySource === sourceKey
  );
  if (toRemove.length) {
    await actor.deleteEmbeddedDocuments("Item", toRemove.map(i => i.id));
  }
}

/* -------------------------------------------- */
/*  Fusão de Skills                              */
/* -------------------------------------------- */

function fusionSignature(names) {
  return names.map(n => n.trim().toLowerCase()).sort().join("+");
}

async function findExistingFusion(pack, signature) {
  const index = await pack.getIndex({ fields: ["system.fusionSources"] });
  for (const entry of index) {
    const entrySources = entry.system?.fusionSources ?? [];
    if (!entrySources.length) continue;
    if (fusionSignature(entrySources) === signature) return pack.getDocument(entry._id);
  }
  return null;
}

function buildGenericFusionData(sources, tier) {
  return {
    name: `Fusão: ${sources.map(s => s.name).join(" + ")}`,
    type: "skill",
    system: {
      tier,
      level: Math.max(1, ...sources.map(s => s.system.level ?? 1)),
      cost: sources.reduce((sum, s) => sum + (s.system.cost ?? 0), 0),
      description: `<p>Habilidade resultante da fusão de: ${sources.map(s => escapeHtml(s.name)).join(", ")}.</p>`,
      subSkills: buildSubSkillsFromSources(sources),
      fusionSources: sources.map(s => s.name),
      isFused: true
    }
  };
}

function buildManualSpecialSkillData(sources, tier, manualData) {
  const tierLabel = MEU_SISTEMA.SKILL_TIER_LABELS[tier] ?? tier;
  return {
    name: manualData?.name || `Habilidade ${tierLabel} de ${sources[0]?.parent?.name ?? "?"}`,
    type: "skill",
    system: {
      tier,
      level: 1,
      cost: sources.reduce((sum, s) => sum + (s.system.cost ?? 0), 0),
      description: manualData?.effect ? `<p>${manualData.effect}</p>` : "",
      subSkills: buildSubSkillsFromSources(sources),
      fusionSources: sources.map(s => s.name),
      emotionTrigger: manualData?.emotion ?? "",
      isFused: true
    }
  };
}

/**
 * Verdadeiro se `sourceTier` puder ser consumido/fundido por uma skill de `targetTier`,
 * segundo a ordem de força em MEU_SISTEMA.SKILL_TIERS (uma skill só consome fontes do
 * seu próprio tier ou de tiers abaixo — nunca de um tier acima).
 */
function canConsumeTier(targetTier, sourceTier) {
  const order = MEU_SISTEMA.SKILL_TIERS;
  return order.indexOf(sourceTier) <= order.indexOf(targetTier);
}

/**
 * Funde 2+ skills da ficha de um Ator em uma nova skill (ou reutiliza uma já
 * existente no Compêndio, no caso de tiers extra/normal).
 *
 * Regras:
 *  - As skills originais são removidas do Ator, mas antes disso são garantidas
 *    no Compêndio (nunca são perdidas).
 *  - tier "extra"/"normal": verifica reutilização por assinatura de fusão antes
 *    de criar um item novo.
 *  - Regra geral de consumo: uma skill de tier T só pode consumir fontes de tier
 *    ≤ T na ordem de MEU_SISTEMA.SKILL_TIERS (ex: Única consome Única-e-abaixo;
 *    Ultimate consome tudo, inclusive outras Ultimates).
 *  - "ultimate" nunca é escolhido como resultado aqui — só surge por fusão quando
 *    as próprias fontes já somam poder suficiente (ver `mode` "auto"/"manual" abaixo).
 *
 * @param {Actor} actor
 * @param {string[]} sourceItemIds - ids dos Items (type "skill") a fundir
 * @param {object} [options]
 * @param {string} [options.tier="normal"] - um valor de MEU_SISTEMA.SKILL_TIERS
 * @param {"auto"|"manual"} [options.mode="manual"] - só relevante para tier "unique"/"ultimate"
 * @param {{name?:string, effect?:string, emotion?:string}} [options.manualData]
 * @param {string} [options.emotionPrompt] - prompt de emoção para o modo "auto" (IA)
 * @returns {Promise<Item>} o Item criado/reaproveitado na ficha do Ator
 */
export async function fuseSkills(actor, sourceItemIds, options = {}) {
  const { tier = "normal", mode = "manual", manualData = null, emotionPrompt = "" } = options;

  const sources = sourceItemIds.map(id => actor.items.get(id)).filter(Boolean);
  if (sources.length < 2) {
    throw new Error("Selecione ao menos duas habilidades para fundir.");
  }

  const grantedSource = sources.find(s => s.system.isItemGranted);
  if (grantedSource) {
    ui.notifications?.error(`"${grantedSource.name}" foi concedida por um item/módulo e não pode ser fundida.`);
    throw new Error("Regra violada: skill concedida por item não pode entrar em fusão.");
  }

  const invalidSource = sources.find(s => !canConsumeTier(tier, s.system.tier));
  if (invalidSource) {
    const tierLabel = MEU_SISTEMA.SKILL_TIER_LABELS[tier] ?? tier;
    ui.notifications?.error(`Uma Skill ${tierLabel} não pode consumir "${invalidSource.name}" (tier acima).`);
    throw new Error(`Regra violada: tier "${tier}" não pode consumir tier "${invalidSource.system.tier}".`);
  }

  await ensureSystemCompendiums();
  const skillsPack = getCompendiumForItemType("skill");

  // Garante que os originais sobrevivem no Compêndio antes de qualquer remoção.
  for (const source of sources) {
    await registerItemInCompendium(source.toObject());
  }

  let fusedItemData = null;
  let reused = false;

  if (tier === "extra" || tier === "normal") {
    const signature = fusionSignature(sources.map(s => s.name));
    const existing = skillsPack ? await findExistingFusion(skillsPack, signature) : null;
    if (existing) {
      fusedItemData = existing.toObject();
      reused = true;
    }
  }

  if (!fusedItemData) {
    if (tier === "unique" || tier === "ultimate") {
      fusedItemData =
        mode === "auto"
          ? await requestAISpecialSkill(actor, sources, tier, emotionPrompt)
          : buildManualSpecialSkillData(sources, tier, manualData);
    } else {
      fusedItemData = buildGenericFusionData(sources, tier);
    }
  }

  await actor.deleteEmbeddedDocuments("Item", sources.map(s => s.id));
  const [createdOnActor] = await actor.createEmbeddedDocuments("Item", [fusedItemData]);

  if (!reused) await registerItemInCompendium(createdOnActor.toObject());

  await announceVoiceOfTheWorld(actor, {
    kind: "fusion",
    title: `Fusão de Habilidade: ${createdOnActor.name}`,
    body: reused
      ? "A combinação já existia no Compêndio e foi reaproveitada."
      : `Nova habilidade forjada a partir de: ${sources.map(s => s.name).join(", ")}.`
  });

  return createdOnActor;
}

/* -------------------------------------------- */
/*  Evolução de Skill                            */
/* -------------------------------------------- */

/**
 * Evolução: 1 Skill vira uma Skill NOVA e diferente (definida do zero no editor único), sem
 * virar sub-componente de nada — diferente de Fusão (2+ fontes viram Sub-Skills usáveis dentro
 * do resultado), aqui a Skill antiga não sobrevive como efeito algum, só fica o registro
 * histórico `evolvedFrom`. A Skill antiga é preservada no Compêndio antes de ser removida do
 * Ator, igual `fuseSkills` já faz com as fontes de uma fusão.
 * @param {Actor} actor
 * @param {string} sourceItemId - id do Item (type "skill") que está evoluindo
 * @param {object} newSkillData - dados já coletados via `openSkillEditorDialog`
 * @returns {Promise<Item>} o Item criado na ficha do Ator
 */
export async function evolveSkill(actor, sourceItemId, newSkillData) {
  if (!game.user.isGM) {
    ui.notifications?.warn("Só o Mestre pode Evoluir uma Habilidade.");
    throw new Error("Regra violada: Evolução de Skill é ação exclusiva do Mestre.");
  }
  const source = actor.items.get(sourceItemId);
  if (!source) throw new Error("Skill de origem não encontrada.");
  if (source.system.isItemGranted) {
    ui.notifications?.error(`"${source.name}" foi concedida por um item/módulo e não pode Evoluir.`);
    throw new Error("Regra violada: skill concedida por item não pode Evoluir.");
  }

  await ensureSystemCompendiums();
  await registerItemInCompendium(source.toObject());

  const evolvedItemData = {
    name: newSkillData.name,
    type: "skill",
    system: {
      tier: newSkillData.tier,
      level: newSkillData.level,
      cost: newSkillData.cost,
      hasUpkeep: newSkillData.hasUpkeep,
      variableMana: Boolean(newSkillData.variableMana),
      magicTag: newSkillData.magicTag || "auto",
      upkeepCost: newSkillData.upkeepCost,
      animationPath: newSkillData.animationPath,
      description: newSkillData.description,
      resistanceTarget: newSkillData.resistanceTarget,
      effectType: newSkillData.effectType,
      damageFormula: newSkillData.damageFormula,
      scalingAttribute: newSkillData.scalingAttribute,
      isMagicDamage: newSkillData.isMagicDamage,
      isAbsoluteDamage: newSkillData.isAbsoluteDamage,
      damageScale: newSkillData.damageScale,
      damageElements: newSkillData.damageElements,
      effects: newSkillData.effects,
      targetType: newSkillData.targetType,
      structureId: newSkillData.structureId,
      areaShape: newSkillData.areaShape,
      areaDistance: newSkillData.areaDistance,
      areaAngle: newSkillData.areaAngle,
      zoneRounds: newSkillData.zoneRounds,
      evolvedFrom: source.name
    }
  };

  await actor.deleteEmbeddedDocuments("Item", [source.id]);
  const [createdOnActor] = await actor.createEmbeddedDocuments("Item", [evolvedItemData]);
  await registerItemInCompendium(createdOnActor.toObject());

  await announceVoiceOfTheWorld(actor, {
    kind: "skill-evolution",
    title: `Evolução de Habilidade: ${createdOnActor.name}`,
    body: `${source.name} evoluiu para ${createdOnActor.name}.`
  });

  return createdOnActor;
}

/* -------------------------------------------- */
/*  Pontos de Habilidade: conversão e criação    */
/* -------------------------------------------- */

/** Quebra 1 Ponto de Habilidade de `tier` em MEU_SISTEMA.SKILL_POINT_CONVERSION_RATE pontos do tier abaixo. */
export async function breakSkillPoints(actor, tier) {
  const order = MEU_SISTEMA.SKILL_POINT_TIERS; // ["extra", "normal", "unique"]
  const idx = order.indexOf(tier);
  if (idx <= 0) throw new Error("Não há tier abaixo para quebrar esse Ponto de Habilidade.");
  const lowerTier = order[idx - 1];

  const current = actor.system.skillPoints[tier] ?? 0;
  if (current < 1) {
    ui.notifications?.warn(`Sem Pontos ${MEU_SISTEMA.SKILL_TIER_LABELS[tier]} para quebrar.`);
    throw new Error("Pontos insuficientes.");
  }

  await actor.update({
    [`system.skillPoints.${tier}`]: current - 1,
    [`system.skillPoints.${lowerTier}`]:
      (actor.system.skillPoints[lowerTier] ?? 0) + MEU_SISTEMA.SKILL_POINT_CONVERSION_RATE
  });
}

/** Funde MEU_SISTEMA.SKILL_POINT_CONVERSION_RATE Pontos de Habilidade de `tier` em 1 ponto do tier acima. */
export async function mergeSkillPoints(actor, tier) {
  const order = MEU_SISTEMA.SKILL_POINT_TIERS;
  const idx = order.indexOf(tier);
  if (idx < 0 || idx >= order.length - 1) throw new Error("Não há tier acima para fundir esses Pontos de Habilidade.");
  const upperTier = order[idx + 1];

  const current = actor.system.skillPoints[tier] ?? 0;
  if (current < MEU_SISTEMA.SKILL_POINT_CONVERSION_RATE) {
    ui.notifications?.warn(`Precisa de ${MEU_SISTEMA.SKILL_POINT_CONVERSION_RATE} Pontos ${MEU_SISTEMA.SKILL_TIER_LABELS[tier]} para fundir.`);
    throw new Error("Pontos insuficientes.");
  }

  await actor.update({
    [`system.skillPoints.${tier}`]: current - MEU_SISTEMA.SKILL_POINT_CONVERSION_RATE,
    [`system.skillPoints.${upperTier}`]: (actor.system.skillPoints[upperTier] ?? 0) + 1
  });
}

/* -------------------------------------------- */
/*  Pedido de Skill com mecânica (J10, prancha 3) */
/* -------------------------------------------- */

const REQUEST_TEMPLATE = `systems/${SYSTEM_ID}/templates/chat/skill-request.hbs`;

/** Mecânica de um pedido. Pedido de antes da 1.84 só tinha texto e custo: vira Descritiva. */
function requestMechanics(req) {
  return req?.mechanics ?? { description: req?.description ?? "", cost: Number(req?.cost) || 0 };
}

/** O pedido é deste Ator? Pelo uuid (Token não vinculado); pedidos antigos só têm o id. */
function requestIsFor(req, actor) {
  return req?.actorUuid ? req.actorUuid === actor.uuid : req?.actorId === actor.id;
}

/**
 * Pedidos de Skill ainda abertos (aguardando o Mestre ou devolvidos para ajuste) deste Ator, do
 * mais novo para o mais velho. Vêm do chat: o pedido É a mensagem.
 * @param {Actor} actor
 * @returns {ChatMessage[]}
 */
export function openSkillRequests(actor) {
  if (!actor || !game.messages) return [];
  return game.messages.contents
    .filter(message => {
      const req = message.flags?.[SYSTEM_ID]?.skillRequest;
      return req && isOpenRequest(req.status) && requestIsFor(req, actor);
    })
    .reverse();
}

/** Pontos livres de um Tier: os da ficha menos os já reservados por pedidos abertos. */
export function freeSkillPoints(actor, tier, { exceptMessageId = null } = {}) {
  const reserved = openSkillRequests(actor).filter(m => m.id !== exceptMessageId && m.flags[SYSTEM_ID].skillRequest.tier === tier).length;
  return Math.max(0, (actor.system.skillPoints?.[tier] ?? 0) - reserved);
}

/**
 * O editor de Skill de sempre, no modo pedido (prancha 3 B): começa de um Modelo, de uma Skill do
 * Compêndio ou de "Só descrever"; Nível sempre 1; só os Tiers com ponto livre.
 * @param {Actor} actor
 * @param {{name?:string, tier?:string, mechanics?:object}|null} [current] - pedido sendo editado
 * @returns {Promise<object|null>} os dados do editor (com `tier`), ou null se cancelou
 */
export async function openSkillRequestEditor(actor, current = null, { messageId = null } = {}) {
  const tiers = MEU_SISTEMA.SKILL_POINT_TIERS.filter(t => t === current?.tier || freeSkillPoints(actor, t, { exceptMessageId: messageId }) > 0);
  if (!tiers.length) {
    ui.notifications?.warn("Sem Pontos de Habilidade livres para pedir uma Skill (os pedidos abertos já reservam os seus).");
    return null;
  }
  const { openSkillEditorDialog } = await import("../apps/skill-editor-dialog.js");
  const tierLabels = Object.fromEntries(
    tiers.map(t => [t, `${MEU_SISTEMA.SKILL_TIER_LABELS[t]} (${freeSkillPoints(actor, t, { exceptMessageId: messageId })} ponto(s) livre(s))`])
  );
  const initial = current ? { ...requestMechanics(current), name: current.name, tier: current.tier, level: 1 } : { tier: tiers.includes("normal") ? "normal" : tiers[0], level: 1 };
  const result = await openSkillEditorDialog(initial, {
    actor,
    tierChoices: tiers,
    tierLabels,
    levelReadonly: true,
    request: true,
    offerTemplates: !current,
    title: current ? `Editar pedido: ${current.name}` : "Pedir Skill ao Mestre",
    saveLabel: "Enviar pedido"
  });
  return result && typeof result === "object" ? result : null;
}

/**
 * Jogador pede uma Skill nova gastando 1 Ponto de Habilidade do Tier (Extra/Normal/Único — Racial
 * vem da Espécie, Ultimate só por fusão). Não cria nada: manda o pedido, com a mecânica montada no
 * editor, para o Mestre aprovar no chat. O ponto só sai na aprovação, mas o pedido aberto já o
 * reserva (dois pedidos não disputam o mesmo ponto).
 * @param {Actor} actor
 * @param {object} data - o que o editor devolveu: `tier`, `name` e a mecânica
 */
export async function requestSkillCreation(actor, data) {
  const { tier, name } = data ?? {};
  if (!MEU_SISTEMA.SKILL_POINT_TIERS.includes(tier)) {
    throw new Error("Tier inválido para criação via Pontos de Habilidade.");
  }
  if (!name?.trim()) throw new Error("Dê um nome para a habilidade.");
  if (freeSkillPoints(actor, tier) < 1) {
    ui.notifications?.warn(`Sem Pontos ${MEU_SISTEMA.SKILL_TIER_LABELS[tier]} livres.`);
    throw new Error("Pontos de Habilidade insuficientes.");
  }
  const mechanics = requestSkillSystem({ ...data, description: safeRequestDescription(data.description) }, tier);
  return createSkillRequestMessage(actor, { tier, name: name.trim(), mechanics, status: "pending" });
}

/**
 * A descrição do pedido é HTML escrito pelo jogador, e o card a mostra com `{{{ }}}` no chat do
 * Mestre: passa pela limpeza do próprio Foundry (tira script, onerror…). Sem ela, vira texto.
 */
function safeRequestDescription(description) {
  if (!description) return description;
  return foundry.utils.cleanHTML?.(String(description)) ?? escapeHtml(description);
}

/** O que o card mostra (prancha 3 C): a frase da Skill, custo pedido × sugerido e os avisos. */
async function requestCardContent(actor, req) {
  const { skillAssist, skillSentence } = await import("./skill-assist.js");
  const mech = requestMechanics(req);
  const assist = actor ? skillAssist(mech, { actor }) : { enabled: false, warnings: [] };
  const hard = (assist.warnings ?? []).filter(w => w.level === "hard").length;
  const owner = actor ? game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER")) : null;
  return renderSystemTemplate(REQUEST_TEMPLATE, {
    actorName: actor?.name ?? "?",
    ownerName: owner?.name ?? "",
    tierLabel: MEU_SISTEMA.SKILL_TIER_LABELS[req.tier],
    name: req.name,
    status: req.status,
    open: isOpenRequest(req.status),
    sentence: skillSentence(mech),
    description: safeRequestDescription(mech.description),
    cost: Number(mech.cost) || 0,
    assistEnabled: assist.enabled,
    suggested: assist.cost?.suggested ?? null,
    costClose: Boolean(assist.cost?.close),
    warnings: (assist.warnings ?? []).length,
    hardWarnings: hard,
    gmNote: req.gmNote ?? ""
  });
}

async function createSkillRequestMessage(actor, req) {
  const content = await requestCardContent(actor, req);
  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
  const ownerIds = game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.id);
  const whisper = Array.from(new Set([...gmIds, ...ownerIds]));

  return ChatMessage.create({
    content,
    whisper,
    speaker: ChatMessage.getSpeaker({ actor }),
    // `actorUuid` (e não só o id): pedido feito da ficha de um Token não vinculado é daquele Token.
    flags: { [SYSTEM_ID]: { skillRequest: { actorId: actor.id, actorUuid: actor.uuid, ...req } } }
  });
}

/** O Ator de um pedido de Skill: pelo uuid (Token não vinculado); pedidos antigos só têm o id. */
function requestActor(req) {
  return (req?.actorUuid ? fromUuidSync(req.actorUuid) : null) ?? game.actors.get(req?.actorId) ?? null;
}

/** Regrava o card com o pedido mudado (`patch` mescla no pedido salvo). */
async function updateSkillRequestMessage(message, status, patch = {}) {
  const req = { ...message.flags[SYSTEM_ID].skillRequest, ...patch, status };
  const content = await requestCardContent(requestActor(req), req);
  await message.update({ content, [`flags.${SYSTEM_ID}.skillRequest`]: req });
}

/**
 * Mestre aprova: desconta o ponto e cria a Skill pronta para usar, com a mecânica do pedido (ou a
 * que o Mestre ajustou, em `override`), na ficha e no Compêndio.
 * @param {ChatMessage} message
 * @param {{override?: object, silent?: boolean}} [options] - `override`: dados do editor do Mestre
 * @returns {Promise<Item|null>}
 */
export async function approveSkillCreationRequest(message, { override = null } = {}) {
  if (!game.user.isGM) {
    ui.notifications?.warn("Só o Mestre pode aprovar pedidos de Skill.");
    return null;
  }
  const req = message.flags?.[SYSTEM_ID]?.skillRequest;
  if (!req || !isOpenRequest(req.status)) return null;

  const actor = requestActor(req);
  if (!actor) return null;

  const available = actor.system.skillPoints[req.tier] ?? 0;
  if (available < 1) {
    ui.notifications?.warn(`${actor.name} não tem mais Pontos ${MEU_SISTEMA.SKILL_TIER_LABELS[req.tier]} suficientes.`);
    await updateSkillRequestMessage(message, "insufficient");
    return null;
  }

  await actor.update({ [`system.skillPoints.${req.tier}`]: available - 1 });

  const name = override?.name?.trim() || req.name;
  const system = requestSkillSystem(override ?? requestMechanics(req), req.tier);
  system.description = safeRequestDescription(system.description) || "";
  await ensureSystemCompendiums();
  const [created] = await actor.createEmbeddedDocuments("Item", [{ name, type: "skill", system }]);
  await registerItemInCompendium(created.toObject());

  await announceVoiceOfTheWorld(actor, {
    kind: "new-skill",
    title: `Habilidade Aprovada: ${created.name}`,
    body: `O Mestre aprovou "${created.name}" (custou 1 Ponto ${MEU_SISTEMA.SKILL_TIER_LABELS[req.tier]}).`
  });

  await updateSkillRequestMessage(message, "approved", override ? { name, mechanics: requestSkillSystem(override, req.tier) } : {});
  return created;
}

/** "Ajustar e aprovar…": o Mestre abre o pedido no mesmo editor, mexe e aprova o que salvou. */
export async function adjustAndApproveSkillRequest(message) {
  if (!game.user.isGM) return null;
  const req = message.flags?.[SYSTEM_ID]?.skillRequest;
  if (!req || !isOpenRequest(req.status)) return null;
  const actor = requestActor(req);
  const { openSkillEditorDialog } = await import("../apps/skill-editor-dialog.js");
  const edited = await openSkillEditorDialog(
    { ...requestMechanics(req), name: req.name, tier: req.tier, level: 1 },
    { actor, lockTier: req.tier, levelReadonly: true, request: true, offerTemplates: false, title: `Ajustar e aprovar: ${req.name}`, saveLabel: "Aprovar" }
  );
  if (!edited || typeof edited !== "object") return null;
  return approveSkillCreationRequest(message, { override: edited });
}

/** "Pedir mudança…": devolve o pedido com um recado; o jogador vê na ficha e na tela. */
export async function requestSkillChanges(message) {
  if (!game.user.isGM) return;
  const req = message.flags?.[SYSTEM_ID]?.skillRequest;
  if (!req || !isOpenRequest(req.status)) return;
  const note = await foundry.applications.api.DialogV2.wait({
    window: { title: `Pedir mudança: ${req.name}` },
    content: `<div class="nihility-creation-dialog"><p>O que deve mudar em <b>${escapeHtml(req.name)}</b>?</p><textarea name="note" rows="3">${escapeHtml(req.gmNote ?? "")}</textarea></div>`,
    buttons: [
      { action: "send", label: "Enviar", default: true, callback: (event, button, dialog) => dialog.element.querySelector("[name=note]").value.trim() },
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });
  if (typeof note !== "string" || !note) return;
  await updateSkillRequestMessage(message, "changes", { gmNote: note });
  const actor = requestActor(req);
  if (actor) {
    await announceVoiceOfTheWorld(actor, {
      kind: "skill-request-changes",
      title: `Ajustar o pedido: ${req.name}`,
      body: `O Mestre pediu: "${note}". Edite o pedido na lista de Habilidades.`
    });
  }
}

/** Mestre rejeita: nenhum ponto é gasto (só sairia na aprovação). */
export async function rejectSkillCreationRequest(message) {
  if (!game.user.isGM) {
    ui.notifications?.warn("Só o Mestre pode rejeitar pedidos de Skill.");
    return;
  }
  const req = message.flags?.[SYSTEM_ID]?.skillRequest;
  if (!req || !isOpenRequest(req.status)) return;
  await updateSkillRequestMessage(message, "rejected");
}

/**
 * Jogador edita o próprio pedido (a linha tracejada na ficha, prancha 3 A): o mesmo editor, e o
 * pedido volta a "aguardando". Quem pode: quem mandou a mensagem (o Foundry só deixa o autor
 * regravar a própria mensagem) ou o Mestre.
 */
export async function editSkillRequest(message) {
  const req = message?.flags?.[SYSTEM_ID]?.skillRequest;
  if (!req || !isOpenRequest(req.status)) return;
  if (!message.isOwner) {
    ui.notifications?.warn("Só quem fez o pedido (ou o Mestre) pode editá-lo.");
    return;
  }
  const actor = requestActor(req);
  if (!actor) return;
  const edited = await openSkillRequestEditor(actor, req, { messageId: message.id });
  if (!edited) return;
  const tier = MEU_SISTEMA.SKILL_POINT_TIERS.includes(edited.tier) ? edited.tier : req.tier;
  if (tier !== req.tier && freeSkillPoints(actor, tier, { exceptMessageId: message.id }) < 1) {
    ui.notifications?.warn(`Sem Pontos ${MEU_SISTEMA.SKILL_TIER_LABELS[tier]} livres.`);
    return;
  }
  const mechanics = requestSkillSystem({ ...edited, description: safeRequestDescription(edited.description) }, tier);
  await updateSkillRequestMessage(message, "pending", { name: edited.name?.trim() || req.name, tier, mechanics, gmNote: "" });
  ui.notifications?.info("Pedido atualizado: o Mestre vê a versão nova no chat.");
}

/** Clicar no nome no card: a Skill completa, só para ler (uma ficha de Item que não grava nada). */
export async function viewSkillRequest(message) {
  const req = message?.flags?.[SYSTEM_ID]?.skillRequest;
  if (!req) return;
  const item = new Item.implementation({
    _id: foundry.utils.randomID(),
    name: req.name,
    type: "skill",
    system: requestSkillSystem(requestMechanics(req), req.tier)
  });
  // Ninguém tem permissão acima de Dono: a ficha abre travada e nunca tenta gravar o Item temporário.
  const SheetClass = item.sheet?.constructor;
  if (SheetClass) new SheetClass({ document: item, editPermission: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER + 1 }).render(true);
}

/**
 * Botões do card de pedido (chamado em `renderChatMessageHTML`). Os do Mestre somem para o
 * jogador; "Editar pedido" só aparece para quem fez o pedido enquanto ele está aberto.
 */
export function renderSkillRequestControls(message, html) {
  const req = message.flags?.[SYSTEM_ID]?.skillRequest;
  if (!req) return;
  if (!game.user.isGM) html.querySelectorAll(".sr-gm-actions").forEach(el => el.remove());
  if (game.user.isGM || !message.isOwner) html.querySelectorAll(".sr-owner-actions").forEach(el => el.remove());
  const handlers = {
    approve: () => approveSkillCreationRequest(message),
    adjust: () => adjustAndApproveSkillRequest(message),
    changes: () => requestSkillChanges(message),
    reject: () => rejectSkillCreationRequest(message),
    edit: () => editSkillRequest(message),
    view: () => viewSkillRequest(message)
  };
  html.querySelectorAll("[data-sr]").forEach(el => {
    el.addEventListener("click", event => {
      event.preventDefault();
      handlers[el.dataset.sr]?.();
    });
  });
}
