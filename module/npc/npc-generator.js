/**
 * Gerador de NPC (canvas "Gerador de NPC", aprovado em 01/11): monta rascunhos a partir de um
 * arquétipo e cria as fichas. As regras de sorteio são puras (npc-generator-rules.js); aqui se lê
 * o catálogo e o mundo, e se grava.
 *
 * Nada é criado até `createNpcs`. A Espécie entra pelo caminho normal (`changeActorSpecies`, sem
 * prévia: a ficha acabou de nascer), igual à geração por IA.
 */
import {
  MEU_SISTEMA,
  getActiveNpcArchetypes,
  getActiveSpeciesPresets,
  getActiveDamageElements,
  getActiveStatusConditions,
  getVitalFormula,
  getAttributePointsStarting,
  getAttributePointsPerLevel,
  getNpcTierConfig
} from "../core/config.js";
import {
  attributeBudget,
  distributePoints,
  rollNpcLevel,
  skillLevelFor,
  pickSkills,
  pickItems,
  pickSpecies,
  randomName,
  nameCulture,
  npcTierHp,
  tierExtraSkills,
  rescaleHpValue,
  keepKnownIds,
  NPC_TIER_LABELS
} from "./npc-generator-rules.js";
import { reportError } from "../helpers/report.js";

const clone = value => foundry.utils.deepClone(value);

function pointsConfig() {
  try {
    return { starting: getAttributePointsStarting(), perLevel: getAttributePointsPerLevel() };
  } catch (err) {
    return { starting: 35, perLevel: 5 };
  }
}

/** Pontos de atributo de um NPC deste arquétipo no `level` (os de um PJ, vezes o % do arquétipo). */
export function archetypeBudget(archetype, level) {
  return attributeBudget(level, pointsConfig(), archetype?.pointsPercent ?? 100);
}

/** Espécies que podem nascer agora (catálogo, disponíveis na criação). */
function availableSpecies() {
  return Object.entries(getActiveSpeciesPresets())
    .filter(([, s]) => s.availableAtCreation !== false)
    .map(([id]) => id);
}

/** Vida/Mana máximas previstas pela fórmula (só os pontos; passivos da Espécie entram ao criar). */
function previewVitals(points, tier) {
  const f = getVitalFormula();
  const product = ([a, b]) => (points[a] ?? 0) * (points[b] ?? 0);
  const hpBase = Math.max(f.floor, Math.round(product(f.hp) * f.multiplier));
  const tiers = getNpcTierConfig();
  const hp = tiers.enabled ? npcTierHp(hpBase, tier, { elite: tiers.eliteHp, boss: tiers.bossHp }) : hpBase;
  const mp = f.energyEnabled ? Math.max(f.floor, Math.round(product(f.energy) * f.multiplier)) : 0;
  return { hp, mp };
}

/**
 * Um rascunho de NPC (o que o card da prévia mostra e o que `createNpcs` grava).
 * @param {object} archetype - normalizado (getActiveNpcArchetypes)
 * @param {{level:number, vary:boolean, species:string, tier:string, names:"random"|"numbered", index:number}} options
 */
export function draftNpc(archetype, options, rng = Math.random) {
  const level = rollNpcLevel(options.level, options.vary, rng);
  const catalog = getActiveSpeciesPresets();
  const species = options.species && catalog[options.species] ? options.species : pickSpecies(archetype.species, availableSpecies(), rng);
  const budget = attributeBudget(level, pointsConfig(), archetype.pointsPercent);
  const points = distributePoints(budget, archetype.weights, MEU_SISTEMA.COMBAT_ATTRIBUTES, { luck: archetype.luck, rng });
  const tiers = getNpcTierConfig();
  const tier = tiers.enabled ? options.tier || "normal" : "normal";
  const extra = tierExtraSkills(tier, { elite: tiers.eliteSkills, boss: tiers.bossSkills });
  const skills = pickSkills(archetype.skills, { min: archetype.skillsMin, max: archetype.skillsMax, extra }, rng);
  const items = pickItems(archetype.items, rng);
  const culture = nameCulture(archetype.group, catalog[species]?.group);
  const name =
    options.names === "numbered" ? `${archetype.label} ${options.index + 1}` : randomName(MEU_SISTEMA.NPC_NAME_TABLES[culture] ?? MEU_SISTEMA.NPC_NAME_TABLES.fantasia, rng);
  return {
    id: foundry.utils.randomID(),
    archetypeId: archetype.id,
    archetypeLabel: archetype.label,
    name,
    level,
    species,
    speciesLabel: catalog[species]?.label ?? species,
    tier,
    points,
    skillKeys: skills.map(s => s.key),
    itemKeys: items.map(i => i.key),
    skillLevel: skillLevelFor(level, archetype.skillLevel),
    vitals: previewVitals(points, tier),
    biography: "",
    personality: ""
  };
}

/** Vários rascunhos de uma vez. */
export function draftNpcs(archetype, options) {
  const count = Math.min(30, Math.max(1, Math.round(Number(options.count) || 1)));
  return Array.from({ length: count }, (_, index) => draftNpc(archetype, { ...options, index }));
}

/** Dados do Item de Skill a partir da Skill do arquétipo (formato solto, como as Raciais). */
export function archetypeSkillItem(skill, level) {
  const { key, always, name, img, ...rest } = clone(skill);
  const known = new Set(getActiveDamageElements().map(e => e.id));
  const conditions = new Set(getActiveStatusConditions().map(c => c.id));
  const effects = (Array.isArray(rest.effects) ? rest.effects : []).map(e => ({
    ...e,
    damageElements: keepKnownIds(e.damageElements, known),
    conditionId: conditions.has(e.conditionId) ? e.conditionId : ""
  }));
  const tier = MEU_SISTEMA.SKILL_TIERS.includes(rest.tier) && rest.tier !== "racial" ? rest.tier : "normal";
  return {
    name: name || "Habilidade",
    type: "skill",
    ...(img ? { img } : {}),
    system: {
      ...rest,
      tier,
      level: Math.max(1, Number(level) || 1),
      xp: 0,
      active: false,
      effectType: MEU_SISTEMA.SKILL_EFFECT_TYPES.includes(rest.effectType) ? rest.effectType : "none",
      targetType: MEU_SISTEMA.SKILL_TARGET_TYPES.includes(rest.targetType) ? rest.targetType : "targeted",
      damageElements: keepKnownIds(rest.damageElements, known),
      effects,
      description: rest.description || ""
    }
  };
}

/** Dados do Item Geral a partir do equipamento do arquétipo. */
export function archetypeItemData(item) {
  const { key, chance, ...rest } = clone(item);
  const known = new Set(getActiveDamageElements().map(e => e.id));
  const system = rest.system ?? {};
  if (system.weapon) system.weapon.damageElements = keepKnownIds(system.weapon.damageElements, known);
  if (system.consumable) system.consumable.damageElements = keepKnownIds(system.consumable.damageElements, known);
  return { name: rest.name || "Item", type: "item", img: rest.img || "icons/svg/item-bag.svg", system };
}

/** A pasta de Atores com esse nome (criada se faltar). */
async function ensureFolder(name) {
  const label = String(name ?? "").trim();
  if (!label) return null;
  return game.folders.find(f => f.type === "Actor" && f.name === label) ?? (await Folder.create({ name: label, type: "Actor" }));
}

/**
 * Cria as fichas dos rascunhos. Devolve os Atores criados.
 * @param {object[]} drafts
 * @param {{folder?: string}} [options]
 */
export async function createNpcs(drafts, { folder = "NPCs gerados" } = {}) {
  const archetypes = getActiveNpcArchetypes();
  const folderDoc = await ensureFolder(folder);
  const created = [];
  for (const draft of drafts) {
    const archetype = archetypes.find(a => a.id === draft.archetypeId);
    if (!archetype) continue;
    try {
      const combat = Object.fromEntries(MEU_SISTEMA.COMBAT_ATTRIBUTES.map(key => [key, { points: draft.points[key] ?? 0 }]));
      const actor = await Actor.create({
        name: draft.name,
        type: "character",
        img: archetype.img,
        folder: folderDoc?.id ?? null,
        // Sem `prototypeToken` aqui: o preCreateActor do sistema só põe as barras de Vida/Mana
        // quando a criação não traz o seu.
        system: {
          isPlayerCharacter: false,
          npcTier: draft.tier || "normal",
          npcArchetype: archetype.id,
          attributes: { level: draft.level, combat },
          biography: draft.biography || "",
          personality: { traits: draft.personality || "", desires: "", emotionalState: "" }
        }
      });
      // Partes do Corpo e Skills Raciais pelo caminho de sempre (sem prévia: a ficha é nova).
      if (draft.species && getActiveSpeciesPresets()[draft.species]) {
        const { changeActorSpecies } = await import("../species/species.js");
        await changeActorSpecies(actor, { species: draft.species }, { interactive: false });
      }
      const skills = archetype.skills.filter(s => draft.skillKeys.includes(s.key)).map(s => archetypeSkillItem(s, draft.skillLevel));
      const items = archetype.items.filter(i => draft.itemKeys.includes(i.key)).map(archetypeItemData);
      if (skills.length || items.length) await actor.createEmbeddedDocuments("Item", [...skills, ...items]);
      // Vida e Mana cheias (o máximo só existe depois da preparação com tudo dentro).
      await actor.update({
        "system.attributes.hp.value": actor.system.attributes.hp.max,
        "system.attributes.energy.value": actor.system.attributes.energy.max
      });
      created.push(actor);
    } catch (err) {
      reportError(`Não deu para criar ${draft.name}.`, err);
    }
  }
  return created;
}

/**
 * Põe os Tokens no mapa ao redor de um ponto, em grade (um por casa, a partir do centro).
 * @param {Actor[]} actors
 * @param {{x:number, y:number}} point - em pixels da cena
 */
export async function placeNpcTokens(actors, point) {
  const scene = canvas?.scene;
  if (!scene || !actors.length) return;
  const size = scene.grid.size || 100;
  const perRow = Math.ceil(Math.sqrt(actors.length));
  const data = [];
  for (const [i, actor] of actors.entries()) {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = point.x + (col - (perRow - 1) / 2) * size - size / 2;
    const y = point.y + row * size - size / 2;
    const snapped = canvas.grid?.getSnappedPoint ? canvas.grid.getSnappedPoint({ x, y }, { mode: CONST.GRID_SNAPPING_MODES?.TOP_LEFT_CORNER ?? 2 }) : { x, y };
    const token = await actor.getTokenDocument({ x: snapped.x, y: snapped.y });
    data.push(token.toObject());
  }
  await scene.createEmbeddedDocuments("Token", data);
}

/** Espera um clique no mapa (Esc / botão direito cancela). Devolve o ponto ou `null`. */
export function pickCanvasPoint(message = "Clique no mapa onde os NPCs vão ficar (Esc cancela).") {
  if (!canvas?.ready || !canvas.scene) return Promise.resolve(null);
  ui.notifications.info(message);
  return new Promise(resolve => {
    const stage = canvas.stage;
    const finish = point => {
      stage.off("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      resolve(point);
    };
    const onDown = event => {
      if (event.button === 2) return finish(null);
      if (event.button !== 0) return;
      const p = event.getLocalPosition ? event.getLocalPosition(stage) : canvas.mousePosition;
      finish({ x: p.x, y: p.y });
    };
    const onKey = event => {
      if (event.key === "Escape") finish(null);
    };
    stage.on("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
  });
}

/** Vida atual ao trocar o Nível de NPC: mantém a mesma fração (Elite com 50% → continua 50%). */
export function registerNpcTierHooks() {
  Hooks.on("preUpdateActor", (actor, changes) => {
    if (actor.type !== "character") return;
    const next = foundry.utils.getProperty(changes, "system.npcTier");
    const pc = foundry.utils.getProperty(changes, "system.isPlayerCharacter") ?? actor.system.isPlayerCharacter;
    if (next === undefined || next === actor.system.npcTier) return;
    if (foundry.utils.getProperty(changes, "system.attributes.hp.value") !== undefined) return;
    const hp = actor.system.attributes.hp;
    const tiers = getNpcTierConfig();
    const base = hp.hpMaxBeforeTier ?? hp.max;
    const newMax = pc || !tiers.enabled ? base : npcTierHp(base, next, { elite: tiers.eliteHp, boss: tiers.bossHp });
    foundry.utils.setProperty(changes, "system.attributes.hp.value", rescaleHpValue(hp.value, hp.max, newMax));
  });
}

/** Texto curto do nível (card e anúncio). */
export function tierLabel(tier) {
  return NPC_TIER_LABELS[tier] ?? NPC_TIER_LABELS.normal;
}

