/**
 * AI Helper: fusão de skills, verificação de reutilização no Compêndio,
 * geração de conteúdo via IA (Skills, NPCs, Montarias, Naves/Veículos, Notas,
 * Perguntas Livres), notificações privadas "Voz do Mundo" e criação/gestão
 * automática dos Compêndios de World. Exposto publicamente em `game.nihility.ai`.
 */
import {
  SYSTEM_ID,
  MEU_SISTEMA,
  isAnatomyEnabled,
  getActiveSpeciesPresets,
  getActiveCurrencies,
  convertCurrencyAmount
} from "./config.js";
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

export function getCompendiumForItemType(itemType) {
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
      subSkills: sources.flatMap(s => s.system.subSkills ?? []),
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
      subSkills: [],
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
  '"description": string (HTML curto), "emotionTrigger": string, ' +
  '"subSkills": [{"name": string, "description": string}]}.';

const STANDALONE_SKILL_SYSTEM_PROMPT =
  "Você é o motor de regras de um RPG de Foundry VTT. Responda SEMPRE com um único objeto JSON " +
  'estrito, sem markdown, no formato: {"name": string, "tier": "extra"|"normal", ' +
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

function normalizeAISkillData(parsed, sources, tier = "unique") {
  return {
    name: parsed?.name || "Habilidade Sem Nome",
    type: "skill",
    system: {
      tier,
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

/* -------------------------------------------- */
/*  Economia: conversão e transferência          */
/* -------------------------------------------- */

/**
 * Soma `rawAmount` (pode ser fracionário) na moeda `currencyId` dentro de `updates`.
 * Nunca deixa fração na moeda de destino: a parte inteira fica ali, e a fração
 * "cai" pra moeda de Valor-Base mais próxima abaixo (convertida pra unidades
 * dela), recursivamente, até sobrar zero ou não haver mais nenhuma moeda menor
 * (aí a fração residual é descartada — só acontece se essa já for a menor de todas).
 */
function applyWholeCurrencyAmount(actor, currencyId, rawAmount, updates) {
  const whole = Math.floor(rawAmount);
  const fraction = rawAmount - whole;

  const key = `system.currencies.${currencyId}`;
  const current = foundry.utils.getProperty(updates, key) ?? actor.system.currencies?.[currencyId] ?? 0;
  foundry.utils.setProperty(updates, key, current + whole);

  if (fraction <= 1e-9) return;

  const currencies = getActiveCurrencies();
  const currentCurrency = currencies.find(c => c.id === currencyId);
  const currentBaseValue = currentCurrency?.baseValue ?? 1;

  const nextLower = currencies
    .filter(c => c.id !== currencyId && (c.baseValue ?? 1) < currentBaseValue)
    .sort((a, b) => (b.baseValue ?? 1) - (a.baseValue ?? 1))[0];

  if (!nextLower) return; // já é a moeda de menor Valor-Base — não tem pra onde a fração cair

  const fractionInLowerUnits = (fraction * currentBaseValue) / (nextLower.baseValue ?? 1);
  applyWholeCurrencyAmount(actor, nextLower.id, fractionInLowerUnits, updates);
}

/**
 * Converte uma quantidade de uma moeda da ficha do Ator para outra, usando a
 * razão de Valor-Base das duas (funciona pra qualquer hierarquia de moedas
 * que o Mestre tiver configurado no editor visual). Nunca gera fração: se a
 * conversão não fechar num número inteiro na moeda de destino, o resto cai
 * automaticamente pra moeda de Valor-Base mais próxima abaixo (nunca 0,5 Ouro
 * solto — vira o correspondente em Prata, por exemplo).
 * @returns {Promise<number>} quantidade inteira creditada na moeda de destino
 */
export async function convertActorCurrency(actor, fromId, toId, amount) {
  const currentFrom = actor.system.currencies?.[fromId] ?? 0;
  if (amount <= 0 || currentFrom < amount) {
    ui.notifications?.warn("Saldo insuficiente para converter.");
    throw new Error("Saldo insuficiente.");
  }

  const rawConverted = convertCurrencyAmount(fromId, toId, amount);
  if (!rawConverted) {
    ui.notifications?.warn("Conversão inválida (confira o Valor-Base das moedas em Configurar Moedas).");
    throw new Error("Conversão inválida.");
  }

  const updates = {};
  applyWholeCurrencyAmount(actor, toId, rawConverted, updates);

  // A fração pode ter caído de volta na própria moeda de origem (ex: convertendo
  // Prata->Ouro, o resto de Ouro cai justamente em Prata) — soma sobre o que já
  // estiver em `updates`, nunca sobrescreve.
  const fromKey = `system.currencies.${fromId}`;
  const alreadyCredited = foundry.utils.getProperty(updates, fromKey) ?? actor.system.currencies?.[fromId] ?? 0;
  foundry.utils.setProperty(updates, fromKey, alreadyCredited - amount);

  await actor.update(updates);
  return Math.floor(rawConverted);
}

/**
 * Transfere uma quantidade de uma moeda da ficha de um Ator pra outro, e
 * publica um recibo privado (Voz do Mundo) pros dois donos + Mestre.
 */
export async function transferCurrency(fromActor, toActor, currencyId, amount) {
  const currentFrom = fromActor.system.currencies?.[currencyId] ?? 0;
  if (amount <= 0 || currentFrom < amount) {
    ui.notifications?.warn("Saldo insuficiente para enviar.");
    throw new Error("Saldo insuficiente.");
  }

  const currentTo = toActor.system.currencies?.[currencyId] ?? 0;
  await fromActor.update({ [`system.currencies.${currencyId}`]: currentFrom - amount });
  await toActor.update({ [`system.currencies.${currencyId}`]: currentTo + amount });

  const label = getActiveCurrencies().find(c => c.id === currencyId)?.label ?? currencyId;
  const receiptBody = `${fromActor.name} enviou ${amount} ${label} para ${toActor.name}.`;

  await announceVoiceOfTheWorld(fromActor, { kind: "transfer", title: "Transferência Enviada", body: receiptBody });
  await announceVoiceOfTheWorld(toActor, { kind: "transfer", title: "Transferência Recebida", body: receiptBody });
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
  createGrantedSkill,
  removeGrantedSkill,
  fuseSkills,
  requestAISpecialSkill,
  ingestExternalSkillJSON,
  editDocumentWithAI,
  announceVoiceOfTheWorld,
  announceLevelUp,
  generateFreeform,
  generateSkillFromAI,
  generateActorFromAI,
  generateVesselFromAI,
  generateNoteFromAI,
  getAIGeneratedFolder,
  breakSkillPoints,
  mergeSkillPoints,
  requestSkillCreation,
  approveSkillCreationRequest,
  rejectSkillCreationRequest,
  convertActorCurrency,
  transferCurrency
};
