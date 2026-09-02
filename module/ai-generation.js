/**
 * Geração de conteúdo via IA (Skills, NPCs, Montarias, Naves/Veículos, Notas, Itens, Perguntas
 * Livres) e edição de documento existente via IA. Extraído de ai-helper.js (Fase 4 do refactor)
 * — esse arquivo concentra tudo que realmente fala com o provedor de IA; fusão/evolução/Pontos
 * de Habilidade (que não têm nada de IA, salvo quando delegam pra `requestAISpecialSkill`
 * abaixo) ficaram em skill-economy.js.
 */
import { SYSTEM_ID, MEU_SISTEMA, isAnatomyEnabled, getActiveSpeciesPresets } from "./config.js";
import { callAIProvider } from "./ai/providers.js";
import { buildSubSkillsFromSources } from "./skill-snapshot.js";
import { ensureSystemCompendiums, registerItemInCompendium } from "./compendium.js";
import { announceVoiceOfTheWorld } from "./voice-of-the-world.js";

/* -------------------------------------------- */
/*  Núcleo genérico de geração via IA            */
/* -------------------------------------------- */

/** Lê as settings de IA atualmente configuradas. */
export function getAISettingsValues() {
  return {
    provider: game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiProvider),
    endpoint: game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiEndpointUrl),
    model: game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiModel),
    apiKey: game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiApiKey)
  };
}

/**
 * Chama a IA configurada (qualquer tarefa) esperando um único objeto JSON de volta.
 * Ponto único usado por todos os geradores abaixo (Skill, NPC, Montaria, Nave, Nota...).
 */
async function generateJSON(systemPrompt, userPrompt) {
  const settings = getAISettingsValues();
  if (!settings.apiKey) {
    ui.notifications?.warn("Nenhuma chave de API de IA configurada (Configurações do Sistema).");
    throw new Error("Chave de API de IA ausente.");
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
  if (!settings.apiKey) {
    ui.notifications?.warn("Nenhuma chave de API de IA configurada (Configurações do Sistema).");
    throw new Error("Chave de API de IA ausente.");
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
  '"description": string (HTML curto), "emotionTrigger": string}. Não invente Sub-Skills — ' +
  "elas são preenchidas automaticamente a partir das Skills consumidas na fusão, não pela IA.";

const STANDALONE_SKILL_SYSTEM_PROMPT =
  "Você é o motor de regras de um RPG de Foundry VTT. Responda SEMPRE com um único objeto JSON " +
  'estrito, sem markdown, no formato: {"name": string, "tier": "extra"|"normal", ' +
  '"level": number, "cost": number, "description": string (HTML curto)}. Essa Skill nunca tem ' +
  "Sub-Skills — elas só existem em Skills Fundidas.";

function buildUniqueSkillPrompt({ consumedNames, emotionPrompt, personality }) {
  return [
    `Skills consumidas na fusão: ${consumedNames}`,
    `Gatilho emocional informado: ${emotionPrompt || "(nenhum informado)"}`,
    `Personalidade do personagem: traços="${personality?.traits ?? ""}", `,
    `desejos="${personality?.desires ?? ""}", estado emocional="${personality?.emotionalState ?? ""}"`
  ].join("\n");
}

function normalizeAISkillData(parsed, sources, tier = "unique") {
  return {
    name: parsed?.name || "Habilidade Sem Nome",
    type: "skill",
    system: {
      tier,
      level: 1,
      cost: sources.reduce((sum, s) => sum + (s.system?.cost ?? 0), 0),
      description: parsed?.description || "",
      subSkills: buildSubSkillsFromSources(sources),
      fusionSources: sources.map(s => s.name),
      emotionTrigger: parsed?.emotionTrigger || "",
      isFused: sources.length > 0
    }
  };
}

/**
 * Gera o JSON de uma Skill Única ou Ultimate a partir da emoção/personalidade e
 * das skills consumidas, usando o provedor de IA configurado.
 * @param {"unique"|"ultimate"} tier
 * @returns {Promise<object>} dados de Item prontos para createEmbeddedDocuments
 */
export async function requestAISpecialSkill(actor, sources, tier, emotionPrompt = "") {
  const consumedNames = sources.map(s => s.name).join(", ");
  const personality = actor.system?.personality ?? {};
  const userPrompt = buildUniqueSkillPrompt({ consumedNames, emotionPrompt, personality });
  const parsed = await generateJSON(UNIQUE_SKILL_SYSTEM_PROMPT, userPrompt);
  return normalizeAISkillData(parsed, sources, tier);
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
      tier: ["extra", "normal"].includes(parsed?.tier) ? parsed.tier : "normal",
      level: Number(parsed?.level) || 1,
      cost: Number(parsed?.cost) || 0,
      description: parsed?.description || "",
      isFused: false
    }
  };
  await ensureSystemCompendiums();
  return registerItemInCompendium(data);
}

/* -------------------------------------------- */
/*  Edição de documento existente via IA         */
/* -------------------------------------------- */

const EDIT_DOCUMENT_SYSTEM_PROMPT =
  "Você é o motor de regras de um RPG de Foundry VTT, editando um documento JÁ EXISTENTE " +
  "(nunca crie um novo). Você recebe o estado ATUAL do documento em JSON e uma instrução em " +
  "linguagem natural do Mestre. Responda SEMPRE com um único objeto JSON estrito, sem markdown, " +
  'contendo APENAS os campos que devem mudar, no mesmo formato aceito por Document#update() do ' +
  'Foundry VTT: {"name"?: string, "img"?: string, "system.<caminho>"?: valor, ...}. Use chaves ' +
  'com ponto pra caminhos aninhados dentro de "system" (ex: "system.attributes.level", ' +
  '"system.attributes.combat.strength.points"). NUNCA inclua _id, ownership, permission ou ' +
  "qualquer campo fora de name/img/system. Não repita campos que não mudam.";

/** Remove qualquer chave fora de name/img/system.* — nunca deixa a IA tocar em _id/ownership/etc. */
export function sanitizeDocumentPatch(patch) {
  const clean = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key === "name" || key === "img" || key === "system" || key.startsWith("system.")) {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Edita um Actor ou Item JÁ EXISTENTE via IA: envia o estado atual + uma instrução em
 * texto livre, e aplica só os campos que a IA devolver como alterados (nunca cria um
 * documento novo). Usado pelo Assistente de IA no modo "Editar Existente".
 * @param {Actor|Item} doc
 * @param {string} instruction
 * @returns {Promise<{doc: Actor|Item, patch: object}>}
 */
export async function editDocumentWithAI(doc, instruction) {
  if (!["Actor", "Item"].includes(doc.documentName)) {
    throw new Error("Só é possível editar Atores ou Itens via IA.");
  }

  const snapshot = { name: doc.name, type: doc.type, system: doc.toObject().system };
  const userPrompt = [
    `Documento atual (${doc.documentName}, tipo "${doc.type}"):`,
    JSON.stringify(snapshot, null, 2),
    "",
    `Instrução do Mestre: ${instruction}`
  ].join("\n");

  const parsed = await generateJSON(EDIT_DOCUMENT_SYSTEM_PROMPT, userPrompt);
  const patch = sanitizeDocumentPatch(parsed);
  if (!Object.keys(patch).length) {
    ui.notifications?.warn("A IA não retornou nenhuma alteração válida.");
    throw new Error("Patch vazio.");
  }

  await doc.update(patch);
  return { doc, patch };
}

/* -------------------------------------------- */
/*  Geração de NPCs e Montarias via IA           */
/* -------------------------------------------- */

const NPC_SYSTEM_PROMPT =
  "Você é o motor de regras de um RPG de Foundry VTT. Responda SEMPRE com um único objeto JSON " +
  'estrito, sem markdown, no formato: {"name": string, "species": string, "level": number, ' +
  '"hp": number, "energy": number, "biography": string (HTML curto), "personalityTraits": string, ' +
  '"skills": [{"name": string, "tier": "extra"|"normal", "level": number, "cost": number, "description": string}]}. ' +
  "Não inclua skills de tier racial ou superior — essas vêm automaticamente da Espécie.";

const MOUNT_SYSTEM_PROMPT =
  "Você é o motor de regras de um RPG de Foundry VTT. Gere uma Montaria (besta de carga ou de combate). " +
  'Responda SEMPRE com um único objeto JSON estrito, sem markdown, no formato: {"name": string, ' +
  '"species": string, "level": number, "hp": number, "energy": number, ' +
  '"biography": string (HTML curto, mencione velocidade e capacidade de carga), ' +
  '"skills": [{"name": string, "tier": "extra"|"normal", "level": number, "cost": number, "description": string}]}. ' +
  "Não inclua skills de tier racial ou superior — essas vêm automaticamente da Espécie.";

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

  const preset = getActiveSpeciesPresets()[species];

  if (isAnatomyEnabled() && preset) {
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

  // Skills Raciais concedidas automaticamente pela Espécie (nunca compradas/geradas via IA).
  if (preset?.skills?.length) {
    const racialSkillsData = preset.skills.map(s => ({
      name: s.name,
      type: "skill",
      system: {
        tier: "racial",
        level: Number(s.level) || 1,
        cost: Number(s.cost) || 0,
        description: s.description || ""
      }
    }));
    const createdRacial = await created.createEmbeddedDocuments("Item", racialSkillsData);
    for (const s of createdRacial) await registerItemInCompendium(s.toObject());
  }

  const skillsData = Array.isArray(parsed?.skills)
    ? parsed.skills.map(s => ({
        name: s?.name || "Habilidade",
        type: "skill",
        system: {
          tier: ["extra", "normal"].includes(s?.tier) ? s.tier : "normal",
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
        hull: { value: Number(parsed?.integrity) || 30, max: Number(parsed?.integrity) || 30 },
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
/*  Geração de Itens Genéricos via IA            */
/* -------------------------------------------- */

const ITEM_SYSTEM_PROMPT =
  "Você é o motor de regras de um RPG de Foundry VTT. Gere um Item genérico (equipamento, " +
  'consumível, tesouro...). Responda SEMPRE com um único objeto JSON estrito, sem markdown, ' +
  'no formato: {"name": string, "description": string (HTML curto), "quantity": number, ' +
  '"weight": number, "valueAmount": number, "valueCurrency": string}.';

/**
 * Gera um Item genérico avulso via IA (não ligado a nenhum Ator) e cria o documento no
 * mundo. Só preenche os campos "de criação" de GenericItemDataModel (descrição/quantidade/
 * peso/valor) — Habilidade Concedida, modificador de HP/Mana e bônus de Atributo ficam pra
 * edição manual depois, mesmo espírito de `generateSkillFromAI`.
 * @param {string} prompt
 * @param {{folder?:Folder|null}} [options]
 * @returns {Promise<Item>}
 */
export async function generateItemFromAI(prompt, options = {}) {
  const { folder = null } = options;
  const parsed = await generateJSON(ITEM_SYSTEM_PROMPT, prompt);

  return Item.create({
    name: parsed?.name || "Item Sem Nome",
    type: "item",
    folder: folder?.id ?? null,
    system: {
      description: parsed?.description || "",
      quantity: Number(parsed?.quantity) || 1,
      weight: Number(parsed?.weight) || 0,
      value: {
        amount: Number(parsed?.valueAmount) || 0,
        currency: parsed?.valueCurrency || "gold"
      }
    }
  });
}

/* -------------------------------------------- */
/*  Pastas auto-geridas para conteúdo gerado     */
/* -------------------------------------------- */

/**
 * Encontra (ou cria) a pasta "IA — Gerado" do tipo de documento pedido,
 * usada para manter Atores/Notas/Itens gerados pelo Assistente de IA organizados.
 * @param {"Actor"|"JournalEntry"|"Item"} documentType
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
