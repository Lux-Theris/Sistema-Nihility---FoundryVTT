/**
 * Utilitários de Ator: comparar por uuid, achar o Token, nome exibido, elementos/Traços/Escala/Selo do Ator.
 * (Parte de core/config.js, dividido em 1.68.0 sem mudar nenhuma função; importe de
 * `core/config.js`, que reexporta tudo.)
 */
import { getActiveSpeciesPresets, getActiveStatusConditions, getCharacterEnergyLabel, getScaleConfig, getStarshipEnergyLabel } from "./catalogs.js";
import { SYSTEM_ID } from "./constants.js";
import { originTraitIdsOf, resolveActorTraits } from "./rules.js";

/**
 * Elementos que um Ator É agora (pra vantagem entre elementos): os da Espécie, os dos efeitos
 * "Elemento do corpo" de Skill (flag `bodyElement`) e os das Condições ativas que têm elemento.
 */
export function actorElements(actor) {
  if (!actor) return [];
  const out = new Set();
  // Personagem: elementos de todas as camadas de origem (Espécie, Linhagem, Heranças).
  const layers = actor.type === "character" ? actor.system?.originLayers : null;
  if (layers) for (const layer of layers) for (const id of layer.elements ?? []) out.add(id);
  else {
    const preset = actor.type === "character" ? getActiveSpeciesPresets()?.[actor.system?.species] : null;
    for (const id of preset?.elements ?? []) out.add(id);
  }
  const conditions = getActiveStatusConditions().filter(c => Array.isArray(c.elements) && c.elements.length);
  for (const effect of actor.effects ?? []) {
    if (effect.disabled) continue;
    const flagged = effect.flags?.[SYSTEM_ID]?.bodyElement;
    if (flagged) out.add(flagged);
    for (const status of effect.statuses ?? []) {
      for (const id of conditions.find(c => c.id === status)?.elements ?? []) out.add(id);
    }
  }
  return [...out].filter(Boolean);
}

/** `resolveActorTraits` para um Ator de verdade. */
export function actorTraits(actor) {
  const layers = actor?.system?.originLayers;
  const traits = resolveActorTraits(actor?.system, getActiveSpeciesPresets(), layers ? originTraitIdsOf(layers) : null);
  // Ferimentos por parte: Função perdida pode tirar um Traço (asas destruídas → não é mais Voador).
  const injured = new Set(actor?.system?.bodyState?.removedTraits ?? []);
  return injured.size ? traits.filter(t => !injured.has(t)) : traits;
}

/**
 * Índice de Escala de um Ator: Personagem usa `system.scale` (vazio = a primeira, Pessoal);
 * Nave/Veículo seguem o Porte. Escala desconhecida cai no 0.
 */
export function actorScaleIndex(actor) {
  const config = getScaleConfig();
  let id = "";
  if (actor?.type === "starship") id = config.shipSizeMap[actor.system?.shipSize];
  else if (actor?.type === "vehicle") id = config.vehicleSizeMap[actor.system?.shipSize];
  // Personagem: a Escala escolhida na ficha, senão a da Espécie/Herança (ver effectiveScale).
  else id = actor?.system?.effectiveScale ?? actor?.system?.scale;
  const index = config.scales.findIndex(s => s.id === id);
  return index >= 0 ? index : 0;
}

/**
 * Rótulo de energia certo pro TIPO do Ator em questão — nunca hardcode "Energia"/"Mana" em
 * mensagens de chat/notificação; use isso (Personagem/Criatura usa `characterEnergyLabel`,
 * Nave usa `starshipEnergyLabel`, cada um configurável separadamente pelo Mestre).
 */
export function getEnergyLabelForActor(actor) {
  // Veículo compartilha o mesmo Grid de Energia de Nave desde o overhaul de Porte (Fase 1).
  return ["starship", "vehicle"].includes(actor?.type) ? getStarshipEnergyLabel() : getCharacterEnergyLabel();
}

/** "ship" (Nave) ou "vehicle" (Veículo) para um Ator, um tipo de Ator ou o próprio kind. */
export function vesselKind(actorOrType) {
  const type = typeof actorOrType === "string" ? actorOrType : actorOrType?.type;
  return type === "vehicle" ? "vehicle" : "ship";
}

/** Nível do "Selo antimagia" que o próprio Ator carrega (a maior Condição ativa com antimagia). */
export function actorAntimagicLevel(actor) {
  const sealed = getActiveStatusConditions().filter(c => Number(c.antimagicLevel) > 0);
  if (!sealed.length || !actor?.effects) return 0;
  let level = 0;
  for (const effect of actor.effects) {
    if (effect.disabled) continue;
    for (const status of effect.statuses ?? []) {
      const condition = sealed.find(c => c.id === status);
      if (condition) level = Math.max(level, Number(condition.antimagicLevel) || 0);
    }
  }
  return level;
}

/** Mesmo Ator? Por `uuid`: distingue Tokens não vinculados da mesma ficha. */
export function sameActor(a, b) {
  return Boolean(a && b) && (a === b || a.uuid === b.uuid);
}

/** Este Combatant é este Ator (o Token dele, no caso não vinculado)? */
export function combatantIsActor(combatant, actor) {
  return sameActor(combatant?.actor, actor);
}

/** Nome pra listas: o do Token quando não vinculado ("Drone (2)"), senão o da ficha. */
export function actorDisplayName(actor) {
  return (actor?.isToken ? actor.token?.name : null) || actor?.name || "?";
}

/**
 * O Token do Ator na Cena aberta. Não vinculado: o próprio Token. Vinculado com vários Tokens: o
 * de `preferred` que for dele (os selecionados, os marcados como alvo), senão o primeiro.
 */
export function actorToken(actor, preferred = []) {
  if (!actor) return null;
  const chosen = preferred.find(token => sameActor(token.actor, actor));
  if (chosen) return chosen;
  const own = actor.isToken ? actor.token?.object : null;
  if (own) return own.scene?.id === canvas?.scene?.id ? own : null;
  return actor.getActiveTokens?.()?.[0] ?? null;
}

/**
 * Atores candidatos a alvo/destinatário: só quem tem um Token na CENA atualmente aberta
 * (`canvas.scene`), não o Diretório de Atores do mundo inteiro — evita listar gente que nem
 * está na cena (ex: mandar dinheiro pra um Ator noutra sessão de jogo, ou mirar Habilidade
 * numa Nave que não está nem por perto). Vários Tokens VINCULADOS ao mesmo Ator contam uma vez só;
 * Tokens NÃO vinculados ("Drone (1)", "Drone (2)") são pessoas diferentes e aparecem cada um (a
 * chave é o `uuid`). `types` (opcional) filtra por `actor.type`; `exclude` tira um Ator (por
 * `uuid`); `permission` (padrão "OBSERVER") é o nível mínimo exigido.
 */
export function sceneActorCandidates({ types = null, exclude = null, permission = "OBSERVER" } = {}) {
  const scene = canvas?.scene;
  if (!scene) return [];
  const seen = new Set();
  const candidates = [];
  for (const token of scene.tokens) {
    const actor = token.actor;
    if (!actor || seen.has(actor.uuid)) continue;
    if (exclude && sameActor(actor, exclude)) continue;
    if (types && !types.includes(actor.type)) continue;
    if (!actor.testUserPermission(game.user, permission)) continue;
    seen.add(actor.uuid);
    candidates.push(actor);
  }
  return candidates;
}
