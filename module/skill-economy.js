/**
 * Economia de Skills: Habilidades concedidas por Item/Módulo, Fusão, Evolução e Pontos de
 * Habilidade (quebra/fusão/pedido/aprovação via chat). Extraído de ai-helper.js (Fase 4 do
 * refactor) — nada aqui fala com IA diretamente, exceto `fuseSkills` no modo "auto" (Skill
 * Única/Ultimate), que delega pra `requestAISpecialSkill` em ai-generation.js.
 */
import { SYSTEM_ID, MEU_SISTEMA } from "./config.js";
import { ensureSystemCompendiums, getCompendiumForItemType, registerItemInCompendium } from "./compendium.js";
import { buildSubSkillsFromSources } from "./skill-snapshot.js";
import { requestAISpecialSkill } from "./ai-generation.js";
import { announceVoiceOfTheWorld } from "./voice-of-the-world.js";

/* -------------------------------------------- */
/*  Habilidades concedidas por Item/Módulo       */
/* -------------------------------------------- */

/**
 * Cria uma Skill de verdade no Ator a partir de um `grantsSkill` (Item Geral,
 * Modificação de Parte do Corpo ou Módulo de Nave), marcada como concedida por
 * item — nunca entra em fusão, e é removida junto quando a fonte é revogada.
 * @param {Actor} actor
 * @param {{name:string, description?:string, cost?:number, tier?:string}} grantsSkill
 * @param {string} sourceKey - identifica a fonte (ex: `${itemId}` ou `${itemId}:${modIndex}`)
 * @returns {Promise<Item|null>} a Skill criada, ou null se `grantsSkill.name` estiver vazio
 */
export async function createGrantedSkill(actor, grantsSkill, sourceKey) {
  if (!grantsSkill?.name?.trim()) return null;

  const data = {
    name: grantsSkill.name.trim(),
    type: "skill",
    system: {
      tier: MEU_SISTEMA.ITEM_GRANTABLE_SKILL_TIERS.includes(grantsSkill.tier) ? grantsSkill.tier : "normal",
      level: 1,
      cost: Number(grantsSkill.cost) || 0,
      description: grantsSkill.description || "",
      isItemGranted: true
    },
    flags: { [SYSTEM_ID]: { grantedBySource: sourceKey } }
  };

  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return created;
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
      description: `<p>Habilidade resultante da fusão de: ${sources.map(s => s.name).join(", ")}.</p>`,
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
      description: newSkillData.description,
      resistanceTarget: newSkillData.resistanceTarget,
      effectType: newSkillData.effectType,
      damageFormula: newSkillData.damageFormula,
      isMagicDamage: newSkillData.isMagicDamage,
      damageElements: newSkillData.damageElements,
      effects: newSkillData.effects,
      targetType: newSkillData.targetType,
      areaShape: newSkillData.areaShape,
      areaDistance: newSkillData.areaDistance,
      areaAngle: newSkillData.areaAngle,
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

const SKILL_POINT_CONVERSION_RATE = 3;

/** Quebra 1 Ponto de Habilidade de `tier` em SKILL_POINT_CONVERSION_RATE pontos do tier abaixo. */
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
    [`system.skillPoints.${lowerTier}`]: (actor.system.skillPoints[lowerTier] ?? 0) + SKILL_POINT_CONVERSION_RATE
  });
}

/** Funde SKILL_POINT_CONVERSION_RATE Pontos de Habilidade de `tier` em 1 ponto do tier acima. */
export async function mergeSkillPoints(actor, tier) {
  const order = MEU_SISTEMA.SKILL_POINT_TIERS;
  const idx = order.indexOf(tier);
  if (idx < 0 || idx >= order.length - 1) throw new Error("Não há tier acima para fundir esses Pontos de Habilidade.");
  const upperTier = order[idx + 1];

  const current = actor.system.skillPoints[tier] ?? 0;
  if (current < SKILL_POINT_CONVERSION_RATE) {
    ui.notifications?.warn(`Precisa de ${SKILL_POINT_CONVERSION_RATE} Pontos ${MEU_SISTEMA.SKILL_TIER_LABELS[tier]} para fundir.`);
    throw new Error("Pontos insuficientes.");
  }

  await actor.update({
    [`system.skillPoints.${tier}`]: current - SKILL_POINT_CONVERSION_RATE,
    [`system.skillPoints.${upperTier}`]: (actor.system.skillPoints[upperTier] ?? 0) + 1
  });
}

/**
 * Jogador pede pra criar uma nova Skill gastando 1 Ponto de Habilidade do tier
 * escolhido (Extra/Normal/Único — Racial vem da Espécie, Ultimate só por fusão).
 * NÃO cria a skill direto: manda um pedido pro Mestre aprovar via chat privado.
 * O ponto só é descontado quando o Mestre aprova.
 * @param {Actor} actor
 * @param {{tier:"extra"|"normal"|"unique", name:string, description?:string, cost?:number}} data
 */
export async function requestSkillCreation(actor, data) {
  const { tier, name, description = "", cost = 0 } = data;
  if (!MEU_SISTEMA.SKILL_POINT_TIERS.includes(tier)) {
    throw new Error("Tier inválido para criação via Pontos de Habilidade.");
  }
  if (!name?.trim()) throw new Error("Dê um nome para a habilidade.");

  const available = actor.system.skillPoints[tier] ?? 0;
  if (available < 1) {
    ui.notifications?.warn(`Sem Pontos ${MEU_SISTEMA.SKILL_TIER_LABELS[tier]} suficientes.`);
    throw new Error("Pontos de Habilidade insuficientes.");
  }

  return createSkillRequestMessage(actor, { tier, name: name.trim(), description, cost, status: "pending" });
}

async function createSkillRequestMessage(actor, req) {
  const content = await renderTemplate(`systems/${SYSTEM_ID}/templates/chat/skill-request.hbs`, {
    actorName: actor.name,
    tierLabel: MEU_SISTEMA.SKILL_TIER_LABELS[req.tier],
    ...req
  });

  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
  const ownerIds = game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.id);
  const whisper = Array.from(new Set([...gmIds, ...ownerIds]));

  return ChatMessage.create({
    content,
    whisper,
    speaker: ChatMessage.getSpeaker({ actor }),
    flags: { [SYSTEM_ID]: { skillRequest: { actorId: actor.id, ...req } } }
  });
}

async function updateSkillRequestMessage(message, status) {
  const req = { ...message.flags[SYSTEM_ID].skillRequest, status };
  const content = await renderTemplate(`systems/${SYSTEM_ID}/templates/chat/skill-request.hbs`, {
    actorName: game.actors.get(req.actorId)?.name ?? "?",
    tierLabel: MEU_SISTEMA.SKILL_TIER_LABELS[req.tier],
    ...req
  });
  await message.update({ content, [`flags.${SYSTEM_ID}.skillRequest.status`]: status });
}

/**
 * Chamado pelo listener de clique no chat quando o Mestre aprova um pedido de
 * criação de Skill: desconta o ponto, cria a Skill na ficha e no Compêndio.
 * @param {ChatMessage} message
 */
export async function approveSkillCreationRequest(message) {
  if (!game.user.isGM) {
    ui.notifications?.warn("Só o Mestre pode aprovar pedidos de Skill.");
    return;
  }
  const req = message.flags?.[SYSTEM_ID]?.skillRequest;
  if (!req || req.status !== "pending") return;

  const actor = game.actors.get(req.actorId);
  if (!actor) return;

  const available = actor.system.skillPoints[req.tier] ?? 0;
  if (available < 1) {
    ui.notifications?.warn(`${actor.name} não tem mais Pontos ${MEU_SISTEMA.SKILL_TIER_LABELS[req.tier]} suficientes.`);
    return updateSkillRequestMessage(message, "insufficient");
  }

  await actor.update({ [`system.skillPoints.${req.tier}`]: available - 1 });

  const skillData = {
    name: req.name,
    type: "skill",
    system: { tier: req.tier, level: 1, cost: Number(req.cost) || 0, description: req.description || "" }
  };
  await ensureSystemCompendiums();
  const [created] = await actor.createEmbeddedDocuments("Item", [skillData]);
  await registerItemInCompendium(created.toObject());

  await announceVoiceOfTheWorld(actor, {
    kind: "new-skill",
    title: `Habilidade Aprovada: ${created.name}`,
    body: `O Mestre aprovou "${created.name}" (custou 1 Ponto ${MEU_SISTEMA.SKILL_TIER_LABELS[req.tier]}).`
  });

  await updateSkillRequestMessage(message, "approved");
}

/**
 * Chamado pelo listener de clique no chat quando o Mestre rejeita um pedido
 * de criação de Skill. Nenhum ponto é gasto (só era descontado na aprovação).
 * @param {ChatMessage} message
 */
export async function rejectSkillCreationRequest(message) {
  if (!game.user.isGM) {
    ui.notifications?.warn("Só o Mestre pode rejeitar pedidos de Skill.");
    return;
  }
  const req = message.flags?.[SYSTEM_ID]?.skillRequest;
  if (!req || req.status !== "pending") return;
  await updateSkillRequestMessage(message, "rejected");
}
