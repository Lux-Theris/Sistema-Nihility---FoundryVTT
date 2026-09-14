/**
 * Geração de conteúdo via IA (Skills, NPCs, Montarias, Naves/Veículos, Notas, Itens, Perguntas
 * Livres) e edição de documento existente via IA. Extraído de ai-helper.js (Fase 4 do refactor)
 * — esse arquivo concentra tudo que realmente fala com o provedor de IA; fusão/evolução/Pontos
 * de Habilidade (que não têm nada de IA, salvo quando delegam pra `requestAISpecialSkill`
 * abaixo) ficaram em skill-economy.js.
 */
import {
  SYSTEM_ID,
  MEU_SISTEMA,
  isAnatomyEnabled,
  getActiveSpeciesPresets,
  getModuleSizePreset
} from "./config.js";
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
/*  Contexto de geração em lote                  */
/* -------------------------------------------- */

/** Texto puro a partir de HTML, cortado — descrição inteira encheria o prompt sem acrescentar nada. */
function plainSummary(html, limit = 160) {
  const text = String(html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    // Tag colada na pontuação (`<b>Ashcroft</b>.`) vira espaço e deixaria "Ashcroft ." no resumo.
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * Resume um documento recém-criado no MÍNIMO que a próxima geração precisa pra se apoiar nele:
 * nome, o que ele é, e as peças reaproveitáveis (Skills de um NPC, Módulos de uma Nave).
 *
 * Resumo, e não o JSON inteiro, por dois motivos: um lote de 10 encheria a janela de contexto do
 * modelo com campos que não ajudam a escrever o próximo (buffDelta, pendingPoints, ids), e cada
 * item extra no prompt é token pago em toda chamada seguinte da mesma leva.
 * @param {Actor|Item|JournalEntry} doc
 * @returns {string|null}
 */
export function summarizeCreatedDocument(doc) {
  if (!doc) return null;
  const parts = [doc.name];

  if (doc.documentName === "Actor") {
    const sys = doc.system ?? {};
    if (doc.type === "character") {
      if (sys.species) parts.push(`espécie ${sys.species}`);
      parts.push(`nível ${sys.attributes?.level ?? 1}`);
      const skills = doc.items.filter(i => i.type === "skill").map(i => i.name);
      if (skills.length) parts.push(`Skills: ${skills.join(", ")}`);
      const bio = plainSummary(sys.biography, 120);
      if (bio) parts.push(bio);
    } else {
      parts.push(`Porte ${sys.shipSize ?? "?"}`);
      const modules = doc.items.filter(i => i.type === "starship_module").map(i => i.name);
      if (modules.length) parts.push(`Módulos: ${modules.join(", ")}`);
      const bio = plainSummary(sys.biography, 120);
      if (bio) parts.push(bio);
    }
  } else if (doc.documentName === "Item") {
    if (doc.type === "skill") parts.push(`Skill tier ${doc.system?.tier ?? "?"}, custo ${doc.system?.cost ?? 0}`);
    const desc = plainSummary(doc.system?.description);
    if (desc) parts.push(desc);
  } else if (doc.documentName === "JournalEntry") {
    const text = plainSummary(doc.pages?.contents?.[0]?.text?.content);
    if (text) parts.push(text);
  }

  return parts.filter(Boolean).join(" — ");
}

/**
 * Monta o prompt de UM item de uma leva, dando à IA o que ela já criou nas voltas anteriores.
 *
 * Sem isso, cada item da leva era uma chamada isolada que só recebia "variação N, diferente das
 * anteriores" — a IA não tinha como saber o que eram "as anteriores", então repetia nomes e não
 * conseguia costurar nada entre si. Com os resumos no prompt, ela pode reaproveitar de propósito
 * (a facção do NPC 1 aparecendo no NPC 3, a Skill do 2 citada na descrição do 4) e evitar repetir
 * de fato, não só por instrução.
 * @param {string} prompt - o pedido original do Mestre
 * @param {string[]} previousSummaries - saída de `summarizeCreatedDocument` dos já criados
 * @param {number} index - posição base-0 do item atual
 * @param {number} total
 */
export function buildBatchPrompt(prompt, previousSummaries, index, total) {
  if (total <= 1) return prompt;

  const done = (previousSummaries ?? []).filter(Boolean);
  if (!done.length) {
    return `${prompt}\n\nEste é o item 1 de ${total} de uma leva. Os próximos verão o que você criar aqui, então estabeleça nomes, lugares e facções que valha a pena reaproveitar.`;
  }

  const lista = done.map((resumo, i) => `${i + 1}. ${resumo}`).join("\n");
  return [
    prompt,
    "",
    `--- JÁ CRIADOS NESTA MESMA LEVA (${done.length} de ${total}) ---`,
    lista,
    "--- FIM DA LISTA ---",
    "",
    `Crie agora o item ${index + 1} de ${total}. Ele deve ser CLARAMENTE DISTINTO dos acima (não repita nome, conceito nem função), mas pode e deve se apoiar neles quando fizer sentido: reaproveite lugares, facções, eventos e nomes já citados, cite ou responda ao que já existe, e mantenha o mesmo tom. Trate os anteriores como parte do mesmo mundo, não como rascunhos descartados.`
  ].join("\n");
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
  '"level": number, "cost": number, "description": string (HTML curto), "hasUpkeep": boolean, ' +
  '"upkeepCost": number}. "hasUpkeep" marca uma Habilidade Ativa (liga/desliga, drenando ' +
  '"upkeepCost" de Energia por rodada enquanto ativa, além do "cost" gasto uma vez ao ligar) — ' +
  'só use true se a descrição pedir claramente um efeito contínuo/sustentado; a maioria das ' +
  'Skills é de uso único ("hasUpkeep": false, "upkeepCost": 0). Essa Skill nunca tem ' +
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
  const hasUpkeep = Boolean(parsed?.hasUpkeep);
  const data = {
    name: parsed?.name || "Habilidade Sem Nome",
    type: "skill",
    system: {
      tier: ["extra", "normal"].includes(parsed?.tier) ? parsed.tier : "normal",
      level: Number(parsed?.level) || 1,
      cost: Number(parsed?.cost) || 0,
      description: parsed?.description || "",
      hasUpkeep,
      upkeepCost: hasUpkeep ? Number(parsed?.upkeepCost) || 0 : 0,
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

/**
 * HP e Mana NÃO são pedidos à IA: os dois são DERIVADOS dos atributos
 * (`Atributo × Atributo × multiplicador`, ver `deriveVitalStats`). Antes o prompt pedia
 * "hp"/"energy" e o resultado era descartado na preparação da ficha — como nada preenchia
 * `attributes.combat.*.points`, todo NPC gerado nascia com os 7 atributos zerados e HP no piso.
 * Agora a IA distribui PONTOS DE ATRIBUTO, que é o que o sistema realmente usa.
 */
const ATTRIBUTE_POINTS_FORMAT =
  '"attributes": {' +
  MEU_SISTEMA.COMBAT_ATTRIBUTES.map(a => `"${a}": number`).join(", ") +
  "}";

const NPC_SYSTEM_PROMPT =
  "Você é o motor de regras de um RPG de Foundry VTT. Responda SEMPRE com um único objeto JSON " +
  'estrito, sem markdown, no formato: {"name": string, "species": string, "level": number, ' +
  ATTRIBUTE_POINTS_FORMAT +
  ', "biography": string (HTML curto), "personalityTraits": string, ' +
  '"skills": [{"name": string, "tier": "extra"|"normal", "level": number, "cost": number, "description": string}]}. ' +
  "Em \"attributes\", distribua pontos de atributo coerentes com o conceito e o nível do NPC " +
  "(um humano comum de nível 1 fica na casa de 3-6 por atributo; um chefe de fim de campanha, " +
  "bem mais). Vida e Mana NÃO são informadas — o sistema as calcula a partir desses atributos. " +
  "Não inclua skills de tier racial ou superior — essas vêm automaticamente da Espécie.";

const MOUNT_SYSTEM_PROMPT =
  "Você é o motor de regras de um RPG de Foundry VTT. Gere uma Montaria (besta de carga ou de combate). " +
  'Responda SEMPRE com um único objeto JSON estrito, sem markdown, no formato: {"name": string, ' +
  '"species": string, "level": number, ' +
  ATTRIBUTE_POINTS_FORMAT +
  ', "biography": string (HTML curto, mencione velocidade e capacidade de carga), ' +
  '"skills": [{"name": string, "tier": "extra"|"normal", "level": number, "cost": number, "description": string}]}. ' +
  "Em \"attributes\", distribua pontos coerentes com a besta (uma montaria de carga tem Força e " +
  "Defesa altas e Magia baixa). Vida e Mana NÃO são informadas — o sistema as calcula a partir " +
  "desses atributos. Não inclua skills de tier racial ou superior — essas vêm automaticamente da Espécie.";

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

  // Pontos por atributo, saneados: a IA pode devolver texto, negativo ou chave inventada.
  const combat = {};
  for (const key of MEU_SISTEMA.COMBAT_ATTRIBUTES) {
    const points = Math.max(0, Math.round(Number(parsed?.attributes?.[key]) || 0));
    combat[key] = { points };
  }

  const created = await Actor.create({
    name: parsed?.name || (isMount ? "Montaria Sem Nome" : "NPC Sem Nome"),
    type: "character",
    folder: folder?.id ?? null,
    system: {
      species,
      isPlayerCharacter: false,
      attributes: {
        level: Number(parsed?.level) || 1,
        combat
      },
      biography: parsed?.biography || "",
      personality: { traits: parsed?.personalityTraits || "", desires: "", emotionalState: "" }
    }
  });

  // HP/Mana Máximos saem da fórmula (já recalculados na criação acima); começar o NPC com as
  // barras cheias é o único ajuste que faz sentido — senão ele nasce com 10/N de Vida.
  await created.update({
    "system.attributes.hp.value": created.system.attributes.hp.max,
    "system.attributes.energy.value": created.system.attributes.energy.max
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

/**
 * Prompt compartilhado pelas duas (Nave/Veículo compartilham o mesmo `ShipSystemsDataModel`
 * desde o Overhaul de Naves — Porte + Módulos de slot único + Grid de Energia + Armas). A IA só
 * escolhe Categoria/Porte/nome/descrição de cada Módulo — NUNCA os números de stat (Vida/
 * Consumo/Dano/etc.): esses vêm de `MEU_SISTEMA.MODULE_SIZE_PRESETS`/`getModuleSizePreset()`,
 * a mesma fonte usada pelo autopreenchimento do editor de Item, pra nunca ter dois lugares
 * "inventando" o mesmo número de forma inconsistente.
 */
function buildVesselSystemPrompt(sizeChoices) {
  return (
    "Você é o motor de regras de um RPG de Foundry VTT (Sci-Fi Arcano), gerando uma Nave/Veículo " +
    "para o sistema de Overhaul de Naves (Porte + Módulos de slot único + Grid de Energia). " +
    'Responda SEMPRE com um único objeto JSON estrito, sem markdown, no formato: {"name": string, ' +
    `"shipSize": ${sizeChoices.map(s => `"${s}"`).join("|")}, "biography": string (HTML curto), ` +
    '"modules": [{"name": string, "category": "reactor"|"battery"|"distributor"|"shield"|' +
    '"engine"|"armor"|"weapon"|"utility", "moduleSize": "compact"|"standard"|"reinforced"|' +
    '"industrial"|"colossal", "description": string (HTML curto)}]}. Inclua exatamente um ' +
    'Módulo de cada categoria de slot único (reactor/battery/distributor/shield/engine/armor) — ' +
    "nunca duas do mesmo tipo — coerente com o Porte da Nave: Naves maiores usam Módulos de " +
    'Porte maior (ex: "capital" pede Módulos "industrial"/"colossal", não "compact"). Pode ' +
    'incluir "weapon" (0 ou mais, sem limite de contagem aqui) e "utility" (0 ou mais) à ' +
    "vontade, coerentes com o tema da Nave. NÃO invente números de stat (Vida/Consumo/Dano/" +
    "Penetração/etc.) — o sistema preenche isso sozinho a partir da Categoria e do Porte."
  );
}

const STARSHIP_SYSTEM_PROMPT = buildVesselSystemPrompt(MEU_SISTEMA.SHIP_SIZES);
const VEHICLE_SYSTEM_PROMPT = buildVesselSystemPrompt(MEU_SISTEMA.VEHICLE_SIZES);

/**
 * Gera uma Nave Espacial ou Veículo Terrestre via IA — cria o Actor (Porte + biografia) e, em
 * seguida, os Módulos que a IA escolheu como Items embutidos, cada um já com o preset de stat
 * completo da sua Categoria×Porte (`getModuleSizePreset`) e registrado no Compêndio de Módulos
 * de Nave, mesmo padrão de `onItemCreate` em starship-sheet.js.
 * @param {string} prompt
 * @param {"starship"|"vehicle"} vesselType
 * @param {{folder?:Folder|null}} [options]
 * @returns {Promise<Actor>}
 */
export async function generateVesselFromAI(prompt, vesselType, options = {}) {
  const { folder = null } = options;
  const isStarship = vesselType === "starship";
  const sizeChoices = isStarship ? MEU_SISTEMA.SHIP_SIZES : MEU_SISTEMA.VEHICLE_SIZES;
  const parsed = await generateJSON(isStarship ? STARSHIP_SYSTEM_PROMPT : VEHICLE_SYSTEM_PROMPT, prompt);

  const shipSize = sizeChoices.includes(parsed?.shipSize) ? parsed.shipSize : sizeChoices[0];
  const created = await Actor.create({
    name: parsed?.name || (isStarship ? "Nave Sem Nome" : "Veículo Sem Nome"),
    type: vesselType,
    folder: folder?.id ?? null,
    system: { shipSize, biography: parsed?.biography || "" }
  });

  // A IA às vezes devolve dois Módulos da mesma categoria de slot único (dois Reatores, por
  // exemplo). O hook `preCreateItem` que normalmente barra isso não enxerga os irmãos do MESMO
  // `createEmbeddedDocuments`, então os dois passariam — a deduplicação tem que acontecer aqui,
  // antes de criar: vale o primeiro de cada categoria de slot único.
  const usedSingleSlots = new Set();
  const modulesData = Array.isArray(parsed?.modules)
    ? parsed.modules
        .filter(m => MEU_SISTEMA.STARSHIP_MODULE_CATEGORIES.includes(m?.category))
        .filter(m => {
          if (!MEU_SISTEMA.STARSHIP_SINGLE_SLOT_CATEGORIES.includes(m.category)) return true;
          if (usedSingleSlots.has(m.category)) return false;
          usedSingleSlots.add(m.category);
          return true;
        })
        .map(m => {
          const moduleSize = MEU_SISTEMA.MODULE_SIZES.includes(m.moduleSize) ? m.moduleSize : "standard";
          return {
            name: m.name || MEU_SISTEMA.STARSHIP_MODULE_CATEGORY_LABELS[m.category],
            type: "starship_module",
            "system.category": m.category,
            "system.description": m.description || "",
            ...getModuleSizePreset(m.category, moduleSize)
          };
        })
    : [];

  if (modulesData.length) {
    const createdModules = await created.createEmbeddedDocuments("Item", modulesData);
    for (const m of createdModules) await registerItemInCompendium(m.toObject());
  }

  return created;
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
