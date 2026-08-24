/**
 * AI Helper: fusão de skills, verificação de reutilização no Compêndio,
 * geração de Unique/Ultimate Skills via IA externa (Ollama/LLM) ou JSON manual,
 * notificações privadas "Voz do Mundo" e criação/gestão automática dos
 * Compêndios de World. Exposto publicamente em `game.nihility.ai`.
 */
import { SYSTEM_ID, MEU_SISTEMA } from "./config.js";

const COMPENDIUM_TYPE_MAP = {
  skill: MEU_SISTEMA.COMPENDIUM.skills,
  body_part: MEU_SISTEMA.COMPENDIUM.bodyParts,
  title: MEU_SISTEMA.COMPENDIUM.titles,
  starship_module: MEU_SISTEMA.COMPENDIUM.starshipModules
};

/* -------------------------------------------- */
/*  Compêndios de World auto-geridos             */
/* -------------------------------------------- */

/**
 * Garante que todos os Compêndios de World do sistema existam.
 * Só o GM pode criá-los (permissão do Foundry); chamado no hook `ready`.
 */
export async function ensureSystemCompendiums() {
  if (!game.user.isGM) return;
  for (const def of Object.values(MEU_SISTEMA.COMPENDIUM)) {
    const collectionId = `world.${def.key}`;
    if (game.packs.get(collectionId)) continue;
    await CompendiumCollection.createCompendium({
      type: def.type,
      label: def.label,
      name: def.key,
      package: "world",
      system: SYSTEM_ID
    });
    console.log(`${SYSTEM_ID} | Compêndio criado automaticamente: ${def.label}`);
  }
}

function getCompendiumForItemType(itemType) {
  const def = COMPENDIUM_TYPE_MAP[itemType];
  if (!def) return null;
  return game.packs.get(`world.${def.key}`) ?? null;
}

/**
 * Registra (ou reaproveita) um Item no Compêndio global correspondente ao seu tipo.
 * Usado sempre que uma Skill, Parte do Corpo, Título ou Módulo é criado/fundido.
 * @param {object} itemData - dados no formato source (ex: item.toObject())
 * @returns {Promise<Item|null>}
 */
export async function registerItemInCompendium(itemData) {
  const pack = getCompendiumForItemType(itemData.type);
  if (!pack) return null;

  const index = await pack.getIndex();
  const existing = index.find(e => e.name === itemData.name);
  if (existing) return pack.getDocument(existing._id);

  const [doc] = await pack.documentClass.createDocuments([itemData], { pack: pack.collection });
  return doc;
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
      subSkills: sources.flatMap(s => s.system.subSkills ?? []),
      fusionSources: sources.map(s => s.name),
      isFused: true
    }
  };
}

function buildManualUniqueSkillData(sources, manualData) {
  return {
    name: manualData?.name || `Habilidade Única de ${sources[0]?.parent?.name ?? "?"}`,
    type: "skill",
    system: {
      tier: "unique",
      level: 1,
      cost: sources.reduce((sum, s) => sum + (s.system.cost ?? 0), 0),
      description: manualData?.effect ? `<p>${manualData.effect}</p>` : "",
      subSkills: [],
      fusionSources: sources.map(s => s.name),
      emotionTrigger: manualData?.emotion ?? "",
      isFused: true
    }
  };
}

/**
 * Funde 2+ skills da ficha de um Ator em uma nova skill (ou reutiliza uma já
 * existente no Compêndio, no caso de tiers common/extra).
 *
 * Regras:
 *  - As skills originais são removidas do Ator, mas antes disso são garantidas
 *    no Compêndio (nunca são perdidas).
 *  - tier "common"/"extra": verifica reutilização por assinatura de fusão antes
 *    de criar um item novo.
 *  - tier "unique": consome skills common/extra da ficha; NÃO pode consumir
 *    skills tier "ultimate" (regra de negócio explícita).
 *  - tier "ultimate": sem restrição de consumo (pode devorar outras Ultimates).
 *
 * @param {Actor} actor
 * @param {string[]} sourceItemIds - ids dos Items (type "skill") a fundir
 * @param {object} [options]
 * @param {"common"|"extra"|"unique"|"ultimate"} [options.tier="extra"]
 * @param {"auto"|"manual"} [options.mode="manual"] - só relevante para tier "unique"
 * @param {{name?:string, effect?:string, emotion?:string}} [options.manualData]
 * @param {string} [options.emotionPrompt] - prompt de emoção para o modo "auto" (IA)
 * @returns {Promise<Item>} o Item criado/reaproveitado na ficha do Ator
 */
export async function fuseSkills(actor, sourceItemIds, options = {}) {
  const { tier = "extra", mode = "manual", manualData = null, emotionPrompt = "" } = options;

  const sources = sourceItemIds.map(id => actor.items.get(id)).filter(Boolean);
  if (sources.length < 2) {
    throw new Error("Selecione ao menos duas habilidades para fundir.");
  }

  if (tier === "unique" && sources.some(s => s.system.tier === "ultimate")) {
    ui.notifications?.error("Skills Únicas não podem consumir/devorar Skills Ultimate.");
    throw new Error("Regra violada: uma Skill Única não pode consumir uma Skill Ultimate.");
  }

  await ensureSystemCompendiums();
  const skillsPack = getCompendiumForItemType("skill");

  // Garante que os originais sobrevivem no Compêndio antes de qualquer remoção.
  for (const source of sources) {
    await registerItemInCompendium(source.toObject());
  }

  let fusedItemData = null;
  let reused = false;

  if (tier === "common" || tier === "extra") {
    const signature = fusionSignature(sources.map(s => s.name));
    const existing = skillsPack ? await findExistingFusion(skillsPack, signature) : null;
    if (existing) {
      fusedItemData = existing.toObject();
      reused = true;
    }
  }

  if (!fusedItemData) {
    if (tier === "unique") {
      fusedItemData =
        mode === "auto"
          ? await requestAIUniqueSkill(actor, sources, emotionPrompt)
          : buildManualUniqueSkillData(sources, manualData);
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
/*  Integração com IA externa (Ollama/LLM)       */
/* -------------------------------------------- */

const AI_SYSTEM_PROMPT =
  "Você é o motor de regras de um RPG de Foundry VTT. Responda SEMPRE com um único objeto JSON " +
  'estrito, sem markdown e sem texto fora do JSON, no formato: {"name": string, ' +
  '"description": string (HTML curto), "emotionTrigger": string, ' +
  '"subSkills": [{"name": string, "description": string}]}.';

function buildUniqueSkillPrompt({ consumedNames, emotionPrompt, personality }) {
  return [
    `Skills consumidas na fusão: ${consumedNames}`,
    `Gatilho emocional informado: ${emotionPrompt || "(nenhum informado)"}`,
    `Personalidade do personagem: traços="${personality?.traits ?? ""}", `,
    `desejos="${personality?.desires ?? ""}", estado emocional="${personality?.emotionalState ?? ""}"`
  ].join("\n");
}

function normalizeAISkillData(parsed, sources) {
  return {
    name: parsed?.name || "Habilidade Sem Nome",
    type: "skill",
    system: {
      tier: "unique",
      level: 1,
      cost: sources.reduce((sum, s) => sum + (s.system?.cost ?? 0), 0),
      description: parsed?.description || "",
      subSkills: Array.isArray(parsed?.subSkills)
        ? parsed.subSkills.map(s => ({ name: s?.name ?? "", description: s?.description ?? "" }))
        : [],
      fusionSources: sources.map(s => s.name),
      emotionTrigger: parsed?.emotionTrigger || "",
      isFused: sources.length > 0
    }
  };
}

/**
 * Chama o endpoint de IA configurado (qualquer provedor compatível com o formato
 * OpenAI Chat Completions, autenticado via chave de API/Bearer token) para gerar
 * o JSON de uma Unique Skill a partir da emoção/personalidade e das skills consumidas.
 * @returns {Promise<object>} dados de Item prontos para createEmbeddedDocuments
 */
export async function requestAIUniqueSkill(actor, sources, emotionPrompt = "") {
  const endpoint = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiEndpointUrl);
  const model = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiModel);
  const apiKey = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiApiKey);
  const consumedNames = sources.map(s => s.name).join(", ");
  const personality = actor.system?.personality ?? {};
  const userPrompt = buildUniqueSkillPrompt({ consumedNames, emotionPrompt, personality });

  if (!apiKey) {
    ui.notifications?.warn("Nenhuma chave de API de IA configurada (Configurações do Sistema). Use o modo manual.");
    throw new Error("Chave de API de IA ausente.");
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: AI_SYSTEM_PROMPT },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      })
    });
    if (!response.ok) throw new Error(`Endpoint de IA retornou HTTP ${response.status}`);

    const payload = await response.json();
    const raw = payload?.choices?.[0]?.message?.content ?? payload;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return normalizeAISkillData(parsed, sources);
  } catch (err) {
    console.error(`${SYSTEM_ID} | Falha ao gerar Unique Skill via IA.`, err);
    ui.notifications?.warn("Falha ao contatar o serviço de IA. Use o modo manual para esta Skill Única.");
    throw err;
  }
}

/**
 * Recebe um JSON de skill já pronto (gerado externamente por qualquer IA/serviço)
 * e injeta o Item na ficha do Ator e no Compêndio correspondente.
 * @param {Actor} actor
 * @param {object} json - objeto com {name, description, emotionTrigger?, subSkills?}
 * @param {{tier?: "unique"|"ultimate"}} [options]
 */
export async function ingestExternalSkillJSON(actor, json, options = {}) {
  const { tier = "unique" } = options;
  const data = normalizeAISkillData(json, []);
  data.system.tier = tier;

  await ensureSystemCompendiums();
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  await registerItemInCompendium(created.toObject());

  await announceVoiceOfTheWorld(actor, {
    kind: "new-skill",
    title: `Nova Habilidade: ${created.name}`,
    body: `${actor.name} adquiriu uma nova habilidade via integração externa de IA.`
  });

  return created;
}

/* -------------------------------------------- */
/*  Voz do Mundo (privado: GMs + dono do Ator)   */
/* -------------------------------------------- */

/**
 * Publica um anúncio "Voz do Mundo" no chat, sempre em whisper para os
 * Mestres e para o(s) jogador(es) dono(s) do Ator. NUNCA é público.
 * @param {Actor|null} actor
 * @param {{kind?:string, title?:string, body?:string}} data
 */
export async function announceVoiceOfTheWorld(actor, data = {}) {
  const { kind = "info", title = "", body = "" } = data;

  const templateData = {
    kind,
    title,
    body,
    actorName: actor?.name ?? "",
    timestamp: new Date().toLocaleString()
  };

  const content = await renderTemplate(
    `systems/${SYSTEM_ID}/templates/chat/voice-of-the-world.hbs`,
    templateData
  );

  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
  const ownerIds = actor
    ? game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.id)
    : [];
  const whisper = Array.from(new Set([...gmIds, ...ownerIds]));

  return ChatMessage.create({
    content,
    whisper,
    speaker: ChatMessage.getSpeaker({ actor: actor ?? undefined }),
    flags: { [SYSTEM_ID]: { voiceOfTheWorld: true, kind } }
  });
}

/** Atalho para notificar ganho de nível. */
export async function announceLevelUp(actor, newLevel) {
  return announceVoiceOfTheWorld(actor, {
    kind: "level-up",
    title: "Evolução",
    body: `${actor.name} alcançou o nível ${newLevel}.`
  });
}

/* -------------------------------------------- */
/*  API pública: game.nihility.ai                */
/* -------------------------------------------- */

export const AIHelper = {
  ensureSystemCompendiums,
  registerItemInCompendium,
  fuseSkills,
  requestAIUniqueSkill,
  ingestExternalSkillJSON,
  announceVoiceOfTheWorld,
  announceLevelUp
};
