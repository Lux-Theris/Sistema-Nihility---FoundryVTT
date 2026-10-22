/**
 * Ambiente da cena e das áreas (backlog B4) e densidade de mana (C5). Regras puras em
 * environment-rules.js; aqui se leem cenas, Regions e fichas. Bloco `FEATURES.environment`.
 *
 *  - Fontes: o ambiente da CENA (flag `environment` da cena: perigos, densidade, preset do
 *    FXMaster de cada perigo — editado em apps/environment-config.js) e as ÁREAS: Regions do
 *    Foundry com o comportamento "Ambiente (Nihility)" (`nihilityEnvironment`, registrado aqui).
 *  - Perigo = uma Condição do catálogo mantida em quem está no lugar, salvo Traço imune. Aplicada
 *    com o efeito padrão dela e marcada `environment: {sceneId}`, com âncora (dura enquanto estiver
 *    lá — o periódico mostra "até desativar") e sem prazo. Sai quando o Token deixa a área/cena,
 *    ganha o Traço imune ou o perigo é desligado. Uma Condição que já veio de outra fonte não é
 *    duplicada nem tirada.
 *  - Quem escreve: o Mestre designado, a partir dos hooks (Token criado/apagado, cena/Region/
 *    comportamento mudou, Token entrou/saiu da área, Traços mudaram, início do turno).
 *  - Densidade: `manaDensityFor(actor)` — a menor das áreas onde o Token está, senão a da cena,
 *    senão a do mundo (Regras da Mesa). Multiplica a potência das Skills mágicas (skill-effects.js)
 *    e a regeneração de Mana (regeneration.js); 0 = magia não funciona ali.
 */
import { SYSTEM_ID, MEU_SISTEMA, getActiveStatusConditions, getActiveTraits, actorTraits, isEnvironmentEnabled } from "../core/config.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { desiredEnvironmentConditions, environmentDiff, resolveManaDensity, normalizeHazard, normalizeDensity, wantedSceneFx, sceneFxPlan, fxPresetLabel } from "./environment-rules.js";

export const BEHAVIOR_TYPE = "nihilityEnvironment";
const FLAG = "environment";

/** O ambiente salvo numa cena (limpo). */
export function sceneEnvironment(scene) {
  const raw = scene?.getFlag?.(SYSTEM_ID, FLAG) ?? {};
  return {
    hazards: (raw.hazards ?? []).map(normalizeHazard).filter(Boolean),
    manaDensity: normalizeDensity(raw.manaDensity),
    // Nível de radiação da cena inteira (radiation.js); 0 = sem radiação.
    radiation: Math.max(0, Number(raw.radiation) || 0),
    fxPlaying: Array.isArray(raw.fxPlaying) ? raw.fxPlaying : []
  };
}

/** Os comportamentos "Ambiente (Nihility)" ligados das Regions onde o Token está. */
export function areaBehaviors(tokenDoc) {
  const out = [];
  for (const region of tokenDoc?.regions ?? []) {
    for (const behavior of region.behaviors ?? []) {
      if (behavior.type === BEHAVIOR_TYPE && !behavior.disabled) out.push(behavior);
    }
  }
  return out;
}

/** Fontes de perigo para um Token: a cena e cada área onde ele está. */
function sourcesFor(tokenDoc) {
  const sources = [{ hazards: sceneEnvironment(tokenDoc.parent).hazards }];
  for (const behavior of areaBehaviors(tokenDoc)) {
    const immuneTraits = [...(behavior.system.immuneTraits ?? [])];
    sources.push({ hazards: [...(behavior.system.conditions ?? [])].map(conditionId => ({ conditionId, immuneTraits })) });
  }
  return sources;
}

/** Token (documento) de um Ator para ler onde ele está. */
function tokenDocOf(actor, tokenDoc = null) {
  if (tokenDoc) return tokenDoc;
  if (actor?.isToken) return actor.token ?? null;
  return actor?.getActiveTokens?.(false, true)?.[0] ?? null;
}

/** Densidade de mana onde o Ator está (1 = normal). Bloco desligado: sempre 1. */
export function manaDensityFor(actor, tokenDoc = null) {
  if (!isEnvironmentEnabled()) return 1;
  let worldDefault = 1;
  try {
    worldDefault = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.manaDensityDefault));
  } catch (err) {
    /* setting ainda não registrada */
  }
  const token = tokenDocOf(actor, tokenDoc);
  const scene = token?.parent ?? canvas?.scene ?? null;
  return resolveManaDensity({
    worldDefault,
    scene: sceneEnvironment(scene).manaDensity,
    areas: token ? areaBehaviors(token).map(b => b.system.manaDensity) : []
  });
}

/** Aplica a Condição com o efeito padrão dela (ou só a marca) e devolve os efeitos criados. */
async function applyCondition(actor, condition) {
  const before = new Set(actor.effects.map(e => e.id));
  if (condition.effect?.kind) {
    const { applyManualCondition } = await import("../skills/effects-apply.js");
    await applyManualCondition(actor, condition.id, {
      target: "hp", amount: 0, durationRounds: 0, periodic: false, tickUnit: "combatRound",
      damageElements: [], modifierType: "flat", icon: "", hitDamage: 0
    });
  } else {
    await actor.createEmbeddedDocuments(
      "ActiveEffect",
      [{ name: condition.label, img: condition.icon, statuses: [condition.id], flags: { [SYSTEM_ID]: { conditionId: condition.id } } }],
      { nihilityConfigured: true }
    );
  }
  return actor.effects.filter(e => !before.has(e.id));
}

/**
 * Deixa o Ator do Token com exatamente as Condições que o ambiente quer (ver environmentDiff).
 * Só o Mestre designado; Personagens só.
 */
export function syncTokenEnvironment(tokenDoc) {
  if (!isDesignatedGm() || !isEnvironmentEnabled() || !tokenDoc?.parent) return Promise.resolve();
  const actor = tokenDoc.actor;
  if (!actor || actor.type !== "character") return Promise.resolve();
  // Em fila por Ator: entrar na área e o início do turno chegam juntos, e duas sincronizações ao
  // mesmo tempo veriam a Condição como ausente e criariam duas.
  const key = actor.uuid;
  const next = (pending.get(key) ?? Promise.resolve())
    .then(() => syncNow(tokenDoc, actor))
    .catch(err => console.error(`${SYSTEM_ID} | Ambiente: falha ao sincronizar ${actor.name}.`, err));
  pending.set(key, next);
  next.finally(() => {
    if (pending.get(key) === next) pending.delete(key);
  });
  return next;
}

const pending = new Map();

async function syncNow(tokenDoc, actor) {
  if (!tokenDoc.parent) return;
  const sceneId = tokenDoc.parent.id;
  const desired = desiredEnvironmentConditions(sourcesFor(tokenDoc), actorTraits(actor));
  const mine = actor.effects.filter(e => e.getFlag(SYSTEM_ID, FLAG)?.sceneId === sceneId);
  const fromEnvironment = mine.map(e => ({ id: e.id, conditionId: e.getFlag(SYSTEM_ID, "conditionId") || [...(e.statuses ?? [])][0] }));
  const elsewhere = new Set(actor.effects.filter(e => !e.getFlag(SYSTEM_ID, FLAG)).flatMap(e => [...(e.statuses ?? [])]));
  const { add, remove } = environmentDiff(desired, fromEnvironment, elsewhere);

  if (remove.length) await actor.deleteEmbeddedDocuments("ActiveEffect", remove);
  const catalog = getActiveStatusConditions();
  for (const conditionId of add) {
    const condition = catalog.find(c => c.id === conditionId);
    if (!condition) continue;
    const created = await applyCondition(actor, condition);
    for (const effect of created) {
      // Enquanto estiver no lugar: sem prazo, e o periódico ancorado (não acaba sozinho).
      const update = { "duration.rounds": null, [`flags.${SYSTEM_ID}.${FLAG}`]: { sceneId } };
      if (effect.getFlag(SYSTEM_ID, "periodic")) {
        update[`flags.${SYSTEM_ID}.activeAnchors`] = [{ skillUuid: `environment:${sceneId}`, sourceSkillId: "environment", sourceSubSkillIndex: null }];
        update[`flags.${SYSTEM_ID}.ticksRemaining`] = 0;
      }
      await effect.update(update);
    }
  }
}

/** Todos os Tokens de uma cena (o ambiente dela mudou). */
export async function syncSceneEnvironment(scene) {
  if (!isDesignatedGm() || !scene) return;
  for (const token of scene.tokens) await syncTokenEnvironment(token);
}

/** Ator vinculado saiu da cena (Token apagado): tira o que o ambiente daquela cena tinha posto. */
async function leaveScene(tokenDoc) {
  if (!isDesignatedGm() || !tokenDoc.actorLink) return;
  const actor = game.actors.get(tokenDoc.actorId);
  if (!actor) return;
  const sceneId = tokenDoc.parent?.id;
  // Outro Token do mesmo Ator ainda na cena: ele continua lá.
  if (tokenDoc.parent?.tokens.some(t => t.id !== tokenDoc.id && t.actorId === actor.id && t.actorLink)) return;
  const ids = actor.effects.filter(e => e.getFlag(SYSTEM_ID, FLAG)?.sceneId === sceneId).map(e => e.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

/* ------------------------------------------------------------------ FXMaster (opcional) */

function fxApi() {
  return globalThis.FXMASTER?.api ?? null;
}

/** Climas prontos do FXMaster (para o editor): `[{id, label}]`, ou [] sem o módulo. */
export function availableFxPresets() {
  try {
    const presets = fxApi()?.presets;
    const list = presets?.listValid?.() ?? presets?.list?.() ?? [];
    return (Array.isArray(list) ? list : Object.keys(list ?? {}))
      .map(p => (typeof p === "string" ? p : p?.name ?? p?.id))
      .filter(Boolean)
      .map(id => ({ id, label: fxPresetLabel(id) }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  } catch (err) {
    return [];
  }
}

/** Catálogo de partículas ou filtros do FXMaster (inclui os do FXMaster+, se ativo): `[{id, label}]`. */
function fxCatalog(kind) {
  const registry = CONFIG.fxmaster?.[kind === "filter" ? "filterEffects" : "particleEffects"] ?? {};
  return Object.entries(registry)
    .map(([id, cls]) => {
      const key = cls?.label;
      const label = typeof key === "string" && game.i18n?.has?.(key) ? game.i18n.localize(key) : fxPresetLabel(id);
      return { id, label };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export const availableFxParticles = () => fxCatalog("particle");
export const availableFxFilters = () => fxCatalog("filter");

/**
 * Uma entrada da API de efeitos do FXMaster, com as opções padrão do tipo e a cor no primeiro
 * parâmetro de cor que ele tiver (partícula: `tint`; filtro de Cor: `color`).
 */
function fxEffectEntry(kind, type, color) {
  const cls = CONFIG.fxmaster?.[kind === "filter" ? "filterEffects" : "particleEffects"]?.[type];
  if (!cls) return null;
  let options = {};
  try {
    options = foundry.utils.deepClone(cls.default ?? {});
  } catch (err) {
    options = {};
  }
  if (color) {
    const param = Object.entries(cls.parameters ?? {}).find(([, def]) => def?.type === "color")?.[0];
    if (param) options[param] = { value: color, apply: true };
  }
  return { kind, type, options };
}

/**
 * Liga o visual dos perigos desta cena e desliga o que saiu. Devolve o que ficou tocando (guardado
 * na cena como `fxPlaying`, para saber o que desligar depois). Sem FXMaster, não faz nada.
 */
export async function syncSceneFx(scene, hazards, previous = []) {
  const api = fxApi();
  if (!api) return previous;
  const plan = sceneFxPlan(previous, wantedSceneFx(hazards));
  const warn = (what, err) => console.warn(`${SYSTEM_ID} | FXMaster: falha ao ${what}.`, err);

  for (const name of plan.stopPresets) {
    try { await api.presets?.stop(name, { scene }); } catch (err) { warn(`parar "${name}"`, err); }
  }
  for (const entry of plan.stopCustoms) {
    try { await api.effects?.stop({ particles: entry.ids?.particles ?? [], filters: entry.ids?.filters ?? [], scene }); } catch (err) { warn("parar um efeito", err); }
  }
  const playing = [...plan.keep];
  for (const name of plan.playPresets) {
    try {
      await api.presets?.play(name, { scene });
      playing.push({ preset: name });
    } catch (err) {
      warn(`tocar "${name}"`, err);
    }
  }
  for (const custom of plan.playCustoms) {
    const effects = [
      custom.filter ? fxEffectEntry("filter", custom.filter, custom.color) : null,
      custom.particle ? fxEffectEntry("particle", custom.particle, custom.color) : null
    ].filter(Boolean);
    if (!effects.length || !api.effects?.play) continue;
    try {
      const ids = await api.effects.play({ effects, scene });
      playing.push({ key: custom.key, ids: { particles: ids?.particles ?? [], filters: ids?.filters ?? [] } });
    } catch (err) {
      warn("tocar um efeito", err);
    }
  }
  return playing;
}

/* ------------------------------------------------------------------ Comportamento de Region */

/**
 * "Ambiente (Nihility)": Condições mantidas em quem está na área, Traços que imunizam e a densidade
 * de mana do lugar. A janela de configuração é a do próprio Foundry, montada destes campos.
 */
function defineBehaviorType() {
  const { fields } = foundry.data;
  const Base = foundry.data.regionBehaviors.RegionBehaviorType;
  const E = CONST.REGION_EVENTS;
  const onToken = async function (event) {
    const token = event.data?.token;
    if (token) await syncTokenEnvironment(token);
  };
  return class EnvironmentRegionBehavior extends Base {
    static defineSchema() {
      return {
        conditions: new fields.SetField(
          new fields.StringField({ choices: () => Object.fromEntries(getActiveStatusConditions().map(c => [c.id, c.label])) }),
          { label: "Perigos (Condições)", hint: "Mantidas em todo Personagem dentro da área, com o efeito padrão de cada uma. Saem quando ele sai." }
        ),
        immuneTraits: new fields.SetField(
          new fields.StringField({ choices: () => Object.fromEntries(getActiveTraits().map(t => [t.id, t.label])) }),
          { label: "Imune com (Traços)", hint: "Quem tem algum destes Traços não recebe os perigos desta área." }
        ),
        manaDensity: new fields.NumberField({
          nullable: true, initial: null, min: 0,
          label: "Densidade de mana", hint: "Vazio = não muda. 0 = magia não funciona aqui; 2 = nexo arcano. Várias áreas: vale a menor."
        }),
        radiation: new fields.NumberField({
          nullable: false, initial: 0, min: 0,
          label: "Radiação (nível)", hint: "0 = sem radiação. Quem fica aqui vai sendo irradiado até este nível e leva dano por rodada; fora da área a irradiação cai. Soma com a da cena e a de Tokens que emitem."
        })
      };
    }

    static events = {
      [E.TOKEN_ENTER]: onToken,
      [E.TOKEN_EXIT]: onToken
    };
  };
}

/* ------------------------------------------------------------------ Registro */

export function registerEnvironment() {
  if (foundry.data?.regionBehaviors?.RegionBehaviorType && CONFIG.RegionBehavior) {
    CONFIG.RegionBehavior.dataModels[BEHAVIOR_TYPE] = defineBehaviorType();
    CONFIG.RegionBehavior.typeIcons ??= {};
    CONFIG.RegionBehavior.typeIcons[BEHAVIOR_TYPE] = "fa-solid fa-smog";
  }

  Hooks.on("createToken", token => syncTokenEnvironment(token));
  // Ganhou/perdeu um Traço imune (ou trocou de Espécie): revê o que o lugar mantém nele.
  Hooks.on("updateActor", (actor, changed) => {
    const system = changed?.system ?? {};
    if (!("traits" in system || "traitsRemoved" in system || "species" in system || "lineage" in system || "heritages" in system)) return;
    for (const token of actor.isToken ? [actor.token] : actor.getActiveTokens(false, true)) syncTokenEnvironment(token);
  });
  Hooks.on("deleteToken", token => leaveScene(token));
  Hooks.on("updateScene", (scene, changed) => {
    if (foundry.utils.hasProperty(changed, `flags.${SYSTEM_ID}.${FLAG}`)) syncSceneEnvironment(scene);
  });
  const behaviorChanged = behavior => {
    if (behavior.type === BEHAVIOR_TYPE) syncSceneEnvironment(behavior.parent?.parent);
  };
  Hooks.on("createRegionBehavior", behaviorChanged);
  Hooks.on("updateRegionBehavior", behaviorChanged);
  Hooks.on("deleteRegionBehavior", behaviorChanged);
  Hooks.on("updateRegion", region => {
    if (region.behaviors?.some(b => b.type === BEHAVIOR_TYPE)) syncSceneEnvironment(region.parent);
  });
  Hooks.on("deleteRegion", region => {
    if (region.behaviors?.some(b => b.type === BEHAVIOR_TYPE)) syncSceneEnvironment(region.parent);
  });
}
