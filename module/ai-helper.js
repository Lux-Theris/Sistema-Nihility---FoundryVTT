/**
 * AI Helper: fusão de skills, verificação de reutilização no Compêndio,
 * geração de conteúdo via IA (Skills, NPCs, Montarias, Naves/Veículos, Notas,
 * Perguntas Livres), notificações privadas "Voz do Mundo" e criação/gestão
 * automática dos Compêndios de World. Exposto publicamente em `game.nihility.ai`.
 */
import { SYSTEM_ID, MEU_SISTEMA, isAnatomyEnabled, getActiveSpeciesPresets } from "./config.js";
import { callAIProvider } from "./ai/providers.js";

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
/*  Núcleo genérico de geração via IA            */
/* -------------------------------------------- */

/** Lê as settings de IA atualmente configuradas. */
function getAISettingsValues() {
  return {
    provider: game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiProvider),
    endpoint: game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiEndpointUrl),
    model: game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiModel),
    apiKey: game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiApiKey),
    relayUrl: game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiRelayUrl),
    relayToken: game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiRelayToken)
  };
}

/** true se as credenciais necessárias para o provedor atual estão presentes. */
function hasRequiredAICredentials(settings) {
  return settings.provider === "relay" ? Boolean(settings.relayUrl) : Boolean(settings.apiKey);
}

/**
 * Chama a IA configurada (qualquer tarefa) esperando um único objeto JSON de volta.
 * Ponto único usado por todos os geradores abaixo (Skill, NPC, Montaria, Nave, Nota...).
 */
async function generateJSON(systemPrompt, userPrompt) {
  const settings = getAISettingsValues();
  if (!hasRequiredAICredentials(settings)) {
    ui.notifications?.warn("IA não configurada (Provedor/URL do Relay/Chave) nas Configurações do Sistema.");
    throw new Error("Credenciais de IA ausentes.");
  }

  try {
    const raw = await callAIProvider({ ...settings, systemPrompt, userPrompt, expectJSON: true });
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    console.error(`${SYSTEM_ID} | Falha ao gerar conteúdo via IA.`, err);
    ui.notifications?.warn("Falha ao contatar o serviço de IA. Confira Provedor/Modelo/Chave nas Configurações.");
    throw err;
  }
}

/** Pergunta livre: resposta em texto corrido, sem criar nenhum documento. */
export async function generateFreeform(prompt) {
  const settings = getAISettingsValues();
  if (!hasRequiredAICredentials(settings)) {
    ui.notifications?.warn("IA não configurada (Provedor/URL do Relay/Chave) nas Configurações do Sistema.");
    throw new Error("Credenciais de IA ausentes.");
  }
  try {
    return await callAIProvider({
      ...settings,
      systemPrompt: "Você é um assistente criativo para um Mestre de RPG de mesa. Responda em texto corrido, sem markdown.",
      userPrompt: prompt,
      expectJSON: false
    });
  } catch (err) {
    console.error(`${SYSTEM_ID} | Falha na pergunta livre via IA.`, err);
    ui.notifications?.warn("Falha ao contatar o serviço de IA.");
    throw err;
  }
}

/* -------------------------------------------- */
/*  Geração de Skills via IA                     */
/* -------------------------------------------- */

const UNIQUE_SKILL_SYSTEM_PROMPT =
  "Você é o motor de regras de um RPG de Foundry VTT. Responda SEMPRE com um único objeto JSON " +
  'estrito, sem markdown e sem texto fora do JSON, no formato: {"name": string, ' +
  '"description": string (HTML curto), "emotionTrigger": string, ' +
  '"subSkills": [{"name": string, "description": string}]}.';

const STANDALONE_SKILL_SYSTEM_PROMPT =
  "Você é o motor de regras de um RPG de Foundry VTT. Responda SEMPRE com um único objeto JSON " +
  'estrito, sem markdown, no formato: {"name": string, "tier": "common"|"extra"|"racial", ' +
  '"level": number, "cost": number, "description": string (HTML curto), ' +
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
 * Gera o JSON de uma Unique Skill a partir da emoção/personalidade e das
 * skills consumidas, usando o provedor de IA configurado.
 * @returns {Promise<object>} dados de Item prontos para createEmbeddedDocuments
 */
export async function requestAIUniqueSkill(actor, sources, emotionPrompt = "") {
  const consumedNames = sources.map(s => s.name).join(", ");
  const personality = actor.system?.personality ?? {};
  const userPrompt = buildUniqueSkillPrompt({ consumedNames, emotionPrompt, personality });
  const parsed = await generateJSON(UNIQUE_SKILL_SYSTEM_PROMPT, userPrompt);
  return normalizeAISkillData(parsed, sources);
}

/**
 * Gera uma Skill avulsa (não ligada a nenhuma fusão) e registra direto no
 * Compêndio de Habilidades — útil para o GM montar um acervo de skills prontas.
 * @param {string} prompt
 * @returns {Promise<Item>} o Item criado no Compêndio
 */
export async function generateSkillFromAI(prompt) {
  const parsed = await generateJSON(STANDALONE_SKILL_SYSTEM_PROMPT, prompt);
  const data = {
    name: parsed?.name || "Habilidade Sem Nome",
    type: "skill",
    system: {
      tier: MEU_SISTEMA.SKILL_TIERS.includes(parsed?.tier) ? parsed.tier : "common",
      level: Number(parsed?.level) || 1,
      cost: Number(parsed?.cost) || 0,
      description: parsed?.description || "",
      subSkills: Array.isArray(parsed?.subSkills)
        ? parsed.subSkills.map(s => ({ name: s?.name ?? "", description: s?.description ?? "" }))
        : [],
      fusionSources: [],
      isFused: false
    }
  };
  await ensureSystemCompendiums();
  return registerItemInCompendium(data);
}

/* -------------------------------------------- */
/*  Geração de NPCs e Montarias via IA           */
/* -------------------------------------------- */

const NPC_SYSTEM_PROMPT =
  "Você é o motor de regras de um RPG de Foundry VTT. Responda SEMPRE com um único objeto JSON " +
  'estrito, sem markdown, no formato: {"name": string, "species": string, "level": number, ' +
  '"hp": number, "energy": number, "biography": string (HTML curto), "personalityTraits": string, ' +
  '"skills": [{"name": string, "tier": "common"|"extra"|"racial", "level": number, "cost": number, "description": string}]}.';

const MOUNT_SYSTEM_PROMPT =
  "Você é o motor de regras de um RPG de Foundry VTT. Gere uma Montaria (besta de carga ou de combate). " +
  'Responda SEMPRE com um único objeto JSON estrito, sem markdown, no formato: {"name": string, ' +
  '"species": string, "level": number, "hp": number, "energy": number, ' +
  '"biography": string (HTML curto, mencione velocidade e capacidade de carga), ' +
  '"skills": [{"name": string, "tier": "common"|"racial", "level": number, "cost": number, "description": string}]}.';

/**
 * Gera um NPC/Criatura (ou Montaria) completo via IA: cria o Actor, aplica o
 * preset de anatomia da espécie (se existir) e cria as skills geradas.
 * @param {string} prompt
 * @param {{isMount?:boolean, folder?:Folder|null}} [options]
 * @returns {Promise<Actor>}
 */
export async function generateActorFromAI(prompt, options = {}) {
  const { isMount = false, folder = null } = options;
  const parsed = await generateJSON(isMount ? MOUNT_SYSTEM_PROMPT : NPC_SYSTEM_PROMPT, prompt);

  const species = parsed?.species || "humano";
  const hp = Number(parsed?.hp) || 10;
  const energy = Number(parsed?.energy) || 0;

  const created = await Actor.create({
    name: parsed?.name || (isMount ? "Montaria Sem Nome" : "NPC Sem Nome"),
    type: "character",
    folder: folder?.id ?? null,
    system: {
      species,
      isPlayerCharacter: false,
      attributes: {
        level: Number(parsed?.level) || 1,
        hp: { value: hp, max: hp },
        energy: { value: energy, max: energy }
      },
      biography: parsed?.biography || "",
      personality: { traits: parsed?.personalityTraits || "", desires: "", emotionalState: "" }
    }
  });

  if (isAnatomyEnabled()) {
    const preset = getActiveSpeciesPresets()[species];
    if (preset) {
      const partsData = preset.parts.map(part => ({
        name: part.label,
        type: "body_part",
        system: {
          slot: part.slot,
          speciesOrigin: species,
          hp: { value: part.hpMax, max: part.hpMax },
          status: "intact",
          isProsthetic: false,
          installedMods: []
        }
      }));
      const createdParts = await created.createEmbeddedDocuments("Item", partsData);
      for (const p of createdParts) await registerItemInCompendium(p.toObject());
      await created.update({ "system.lastAppliedSpeciesPreset": species });
    }
  }

  const skillsData = Array.isArray(parsed?.skills)
    ? parsed.skills.map(s => ({
        name: s?.name || "Habilidade",
        type: "skill",
        system: {
          tier: MEU_SISTEMA.SKILL_TIERS.includes(s?.tier) ? s.tier : "common",
          level: Number(s?.level) || 1,
          cost: Number(s?.cost) || 0,
          description: s?.description || ""
        }
      }))
    : [];
  if (skillsData.length) {
    const createdSkills = await created.createEmbeddedDocuments("Item", skillsData);
    for (const s of createdSkills) await registerItemInCompendium(s.toObject());
  }

  return created;
}

/* -------------------------------------------- */
/*  Geração de Naves/Veículos via IA             */
/* -------------------------------------------- */

const STARSHIP_SYSTEM_PROMPT =
  "Você é o motor de regras de um RPG de Foundry VTT (Sci-Fi Arcano). Gere uma Nave Espacial. " +
  'Responda SEMPRE com um único objeto JSON estrito, sem markdown, no formato: {"name": string, ' +
  '"hull": number, "shields": number, "maneuverability": number, "reactorOutput": number, ' +
  '"capacitorMax": number, "biography": string (HTML curto)}.';

const VEHICLE_SYSTEM_PROMPT =
  "Você é o motor de regras de um RPG de Foundry VTT. Gere um Veículo terrestre. " +
  'Responda SEMPRE com um único objeto JSON estrito, sem markdown, no formato: {"name": string, ' +
  '"integrity": number, "speed": number, "fuelType": "fuel"|"battery", "fuelMax": number, ' +
  '"biography": string (HTML curto)}.';

/**
 * Gera uma Nave Espacial ou Veículo Terrestre via IA e cria o Actor correspondente.
 * @param {string} prompt
 * @param {"starship"|"vehicle"} vesselType
 * @param {{folder?:Folder|null}} [options]
 * @returns {Promise<Actor>}
 */
export async function generateVesselFromAI(prompt, vesselType, options = {}) {
  const { folder = null } = options;
  const isStarship = vesselType === "starship";
  const parsed = await generateJSON(isStarship ? STARSHIP_SYSTEM_PROMPT : VEHICLE_SYSTEM_PROMPT, prompt);

  const system = isStarship
    ? {
        hull: { value: Number(parsed?.hull) || 50, max: Number(parsed?.hull) || 50 },
        shields: {
          value: Number(parsed?.shields) || 20,
          max: Number(parsed?.shields) || 20,
          regenRate: 5
        },
        maneuverability: Number(parsed?.maneuverability) || 0,
        powerGrid: {
          reactorOutput: Number(parsed?.reactorOutput) || 50,
          capacitor: {
            value: Number(parsed?.capacitorMax) || 25,
            max: Number(parsed?.capacitorMax) || 25
          }
        },
        biography: parsed?.biography || ""
      }
    : {
        integrity: { value: Number(parsed?.integrity) || 30, max: Number(parsed?.integrity) || 30 },
        speed: Number(parsed?.speed) || 0,
        fuel: {
          value: Number(parsed?.fuelMax) || 50,
          max: Number(parsed?.fuelMax) || 50,
          type: parsed?.fuelType === "battery" ? "battery" : "fuel"
        },
        biography: parsed?.biography || ""
      };

  return Actor.create({
    name: parsed?.name || (isStarship ? "Nave Sem Nome" : "Veículo Sem Nome"),
    type: vesselType,
    folder: folder?.id ?? null,
    system
  });
}

/* -------------------------------------------- */
/*  Geração de Notas (Journal) via IA            */
/* -------------------------------------------- */

const NOTE_SYSTEM_PROMPT =
  "Você é um assistente narrativo para um Mestre de RPG de mesa. Responda SEMPRE com um único " +
  'objeto JSON estrito, sem markdown, no formato: {"title": string, "content": string (HTML)}.';

/**
 * Gera uma nota narrativa via IA e cria uma JournalEntry com uma página de texto.
 * @param {string} prompt
 * @param {{folder?:Folder|null}} [options]
 * @returns {Promise<JournalEntry>}
 */
export async function generateNoteFromAI(prompt, options = {}) {
  const { folder = null } = options;
  const parsed = await generateJSON(NOTE_SYSTEM_PROMPT, prompt);
  const title = parsed?.title || "Nota Sem Título";

  return JournalEntry.create({
    name: title,
    folder: folder?.id ?? null,
    pages: [{ name: title, type: "text", text: { content: parsed?.content || "", format: 1 } }]
  });
}

/* -------------------------------------------- */
/*  Pastas auto-geridas para conteúdo gerado     */
/* -------------------------------------------- */

/**
 * Encontra (ou cria) a pasta "IA — Gerado" do tipo de documento pedido,
 * usada para manter Atores/Notas gerados pelo Assistente de IA organizados.
 * @param {"Actor"|"JournalEntry"} documentType
 * @returns {Promise<Folder>}
 */
export async function getAIGeneratedFolder(documentType) {
  const name = MEU_SISTEMA.AI_GENERATED_FOLDER_NAME;
  let folder = game.folders.find(f => f.name === name && f.type === documentType);
  if (!folder) folder = await Folder.create({ name, type: documentType, color: "#c084fc" });
  return folder;
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
  announceLevelUp,
  generateFreeform,
  generateSkillFromAI,
  generateActorFromAI,
  generateVesselFromAI,
  generateNoteFromAI,
  getAIGeneratedFolder
};
