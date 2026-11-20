/**
 * Reações elementais (item 8.1): regras puras. Nada aqui toca Actor/Item/canvas — quem chama
 * (reactions.js e damage-roll.js) monta o que o alvo carrega e grava o resultado. Testado em
 * test/reactions.test.mjs. Sem imports, de propósito (é lido por catálogo, editor e validador).
 *
 * **O que é uma Reação.** Mora no cartão do elemento do GOLPE (`reactions: {<elemento carregado>: reação}`,
 * como o `affinity`): "um golpe deste elemento contra quem carrega aquele". O que o alvo carrega são
 * as **marcas** (Condições com "Elemento do corpo") e, com o bloco Superfícies (8.2), o chão em que
 * pisa. O **corpo** (Espécie, camadas de origem, efeito `bodyElement`) nunca dá multiplicador nem é
 * consumido — só **conduz** (espalha o que sai para fora) quando a reação tem `bodyConducts`.
 */

export const REACTION_AGAINST_KEYS = ["character", "ship", "structure"];

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const text = value => String(value ?? "").trim();

/**
 * Uma Reação limpa, ou `null` se não há nada (nem nome nem efeito). Pura.
 * `damagePercent`: 0 = nada, +50 = ×1,5, −50 = ×0,5 (nunca abaixo de −100).
 */
export function normalizeReaction(raw) {
  if (!raw || typeof raw !== "object") return null;
  const damagePercent = clamp(Math.round(num(raw.damagePercent)), -100, 1000);
  const radius = num(raw.spread?.radius);
  const spread = radius > 0 ? { radius: Math.round(radius * 10) / 10, sameElement: raw.spread?.sameElement !== false } : null;
  const conditionId = text(raw.applyCondition?.conditionId);
  const applyCondition = conditionId ? { conditionId, rounds: Math.max(0, Math.round(num(raw.applyCondition?.rounds))) } : null;
  const removeCondition = text(raw.removeCondition);
  const leaveSurface = text(raw.leaveSurface);
  const shieldDrain = Math.max(0, Math.round(num(raw.shieldDrain)));
  const label = text(raw.label);
  const empty = !damagePercent && !spread && !applyCondition && !removeCondition && !leaveSurface && !shieldDrain;
  if (empty && !label) return null;
  return {
    label: label || "Reação",
    damagePercent,
    spread,
    applyCondition,
    removeCondition,
    leaveSurface,
    shieldDrain,
    consume: raw.consume !== false,
    bodyConducts: Boolean(raw.bodyConducts),
    against: {
      character: raw.against?.character !== false,
      ship: raw.against?.ship === true,
      structure: raw.against?.structure === true
    }
  };
}

/** A tabela `{elementoCarregado: reação}` de um elemento, só com reações válidas. Pura. */
export function normalizeReactions(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [carriedId, value] of Object.entries(raw)) {
    const key = text(carriedId);
    const reaction = key ? normalizeReaction(value) : null;
    if (reaction) out[key] = reaction;
  }
  return out;
}

/** O fator de dano de uma reação: 1 + percentual (nunca negativo). Pura. */
export function reactionFactor(reaction) {
  return Math.max(0, 1 + num(reaction?.damagePercent) / 100);
}

/**
 * A reação do golpe contra um conjunto de ids carregados: o elemento do golpe primeiro e depois
 * os ancestrais dele (`chain`, do próprio para cima); em cada um, o carregado primeiro e depois os
 * ancestrais dele (`carriedIds`). Pura.
 * @param {Array<{id:string, reactions?:object}>} chain
 * @param {string[]} carriedIds
 */
export function findReaction(chain, carriedIds) {
  for (const element of chain ?? []) {
    const table = element?.reactions;
    if (!table) continue;
    for (const carriedId of carriedIds ?? []) {
      const reaction = table[carriedId];
      if (reaction) return { reaction, hitElementId: element.id, carriedId };
    }
  }
  return null;
}

/** Ids de um elemento e dos ancestrais dele (para casar com a tabela). Pura. */
export function idsWithAncestors(id, elements = []) {
  const byId = new Map((elements ?? []).filter(e => e?.id).map(e => [e.id, e]));
  const out = [id];
  const seen = new Set([id]);
  let current = byId.get(id)?.parent;
  while (current && !seen.has(current) && byId.has(current) && out.length < 9) {
    out.push(current);
    seen.add(current);
    current = byId.get(current)?.parent;
  }
  return out;
}

/**
 * As marcas que o alvo carrega: cada Condição ativa com "Elemento do corpo" vira uma marca por
 * elemento. A mais recente vem primeiro (`order` maior). Com Superfícies (8.2), o chão entra como
 * marca de `surface: true` (sem efeito para consumir). Pura.
 * @param {Array<{effectId:string, statuses?:string[], conditionId?:string, order?:number, disabled?:boolean}>} effects
 * @param {Array<{id:string, elements?:string[]}>} conditions - catálogo de Condições
 * @param {Array<{elements?:string[]}>} elements - catálogo de elementos (para os ancestrais)
 * @param {string[]} [surfaces] - ids de elemento do chão em que o alvo pisa
 * @returns {Array<{elementId:string, ids:string[], effectId:string, conditionId:string, order:number, surface:boolean}>}
 */
export function carriedMarks(effects, conditions, elements = [], surfaces = []) {
  const marks = [];
  (effects ?? []).forEach((effect, index) => {
    if (effect?.disabled) return;
    const ids = new Set([...(effect.statuses ?? []), ...(effect.conditionId ? [effect.conditionId] : [])]);
    for (const condition of conditions ?? []) {
      if (!ids.has(condition.id) || !Array.isArray(condition.elements)) continue;
      for (const elementId of condition.elements.filter(Boolean)) {
        marks.push({ elementId, ids: idsWithAncestors(elementId, elements), effectId: effect.effectId, conditionId: condition.id, order: num(effect.order, index), surface: false });
      }
    }
  });
  marks.sort((a, b) => b.order - a.order);
  const ground = (surfaces ?? []).filter(Boolean).map((elementId, i) => ({ elementId, ids: idsWithAncestors(elementId, elements), effectId: "", conditionId: "", order: Number.MAX_SAFE_INTEGER - i, surface: true }));
  return [...ground, ...marks];
}

/** Os elementos do corpo (Espécie etc.) com os ancestrais, só para conduzir. Pura. */
export function bodyCarried(bodyIds, elements = []) {
  return [...new Set(bodyIds ?? [])].filter(Boolean).map(elementId => ({ elementId, ids: idsWithAncestors(elementId, elements) }));
}

/**
 * Escolhe a reação de UMA parte do golpe. Uma reação por parte: a da marca mais recente que tem
 * reação para este elemento (e vale contra este tipo de alvo). Sem marca, o corpo só conta se a
 * reação marca "o corpo conduz" — e então só vai para fora, sem multiplicador nem consumo. Pura.
 * @param {{chain:Array, marks:Array, body?:Array, kind?:"character"|"ship"|"structure"}} input
 * @returns {{source:"mark"|"surface"|"body", reaction:object, hitElementId:string, carriedId:string, mark?:object, body?:object}|null}
 */
export function pickReaction({ chain, marks = [], body = [], kind = "character" }) {
  for (const mark of marks) {
    const found = findReaction(chain, mark.ids);
    if (found && found.reaction.against?.[kind]) return { source: mark.surface ? "surface" : "mark", ...found, mark };
  }
  for (const carried of body) {
    const found = findReaction(chain, carried.ids);
    if (found && found.reaction.bodyConducts && found.reaction.against?.[kind]) return { source: "body", ...found, body: carried };
  }
  return null;
}

/** Só a marca ou o chão multiplicam o dano; o corpo nunca. Pura. */
export function pickedFactor(picked) {
  return picked && picked.source !== "body" ? reactionFactor(picked.reaction) : 1;
}

/**
 * Elementos que o alvo conta para a vantagem da Tabela numa parte que REAGIU com uma marca: o
 * corpo e as OUTRAS marcas — a marca que reagiu não conta (senão Fogo em Gelo valia Derretimento
 * e Super efetivo juntos). Pura.
 */
export function affinityElementsExcluding(bodyIds, marks, reacting) {
  const out = new Set((bodyIds ?? []).filter(Boolean));
  for (const mark of marks ?? []) {
    if (mark.surface) continue;
    if (reacting && !reacting.surface && mark.effectId === reacting.effectId && mark.elementId === reacting.elementId) continue;
    out.add(mark.elementId);
  }
  return [...out];
}

/**
 * Quem recebe o que a reação espalha: Personagens vivos, no raio, e — com `sameElement` — só os que
 * carregam o mesmo elemento (marca, chão ou corpo). Um salto só: quem foi alcançado não conduz de
 * novo (quem chama passa `hop` para isso). Pura.
 * @param {Array<{uuid:string, distance:number|null, dead?:boolean, carries?:string[]}>} candidates
 * @param {{radius:number, sameElement:boolean}} spread
 * @param {string} carriedId - o elemento carregado que conduz
 */
export function spreadTargets(candidates, spread, carriedId) {
  if (!spread || !(spread.radius > 0)) return [];
  return (candidates ?? []).filter(c => {
    if (c.dead || c.distance == null || c.distance > spread.radius + 1e-9) return false;
    return spread.sameElement ? (c.carries ?? []).includes(carriedId) : true;
  });
}

/**
 * O que acontece com quem recebeu o que foi espalhado: com `sameElement` ele leva o dano da parte
 * (antes do fator da reação, passando pelas defesas e pela reação dele); sem, só a Condição. Pura.
 */
export function spreadCarriesDamage(reaction) {
  return Boolean(reaction?.spread?.sameElement);
}

/** Rótulo curto da célula da Tabela de reações: "×1,5 · conduz". Vazio = nada. Pura. */
export function reactionTag(reaction) {
  if (!reaction) return "";
  const parts = [];
  const percent = num(reaction.damagePercent);
  if (percent) parts.push(`×${String(Math.round((1 + percent / 100) * 100) / 100).replace(".", ",")}`);
  if (reaction.bodyConducts) parts.push("conduz");
  if (!parts.length && (reaction.applyCondition || reaction.removeCondition)) parts.push(reaction.removeCondition && !reaction.applyCondition ? "tira" : "aplica");
  return parts.join(" · ");
}

/**
 * A frase "Na mesa" de uma reação (o que o jogador lê). `labels`: `{element(id), condition(id), against}`.
 * Pura.
 */
export function reactionSentence(hitId, carriedId, reaction, labels = {}) {
  const element = labels.element ?? (id => id);
  const condition = labels.condition ?? (id => id);
  if (!reaction) return "";
  const parts = [];
  const percent = num(reaction.damagePercent);
  if (percent > 0) parts.push(`o dano sobe ${percent}%`);
  else if (percent < 0) parts.push(`o dano cai ${Math.abs(percent)}%`);
  if (reaction.applyCondition) parts.push(`aplica ${condition(reaction.applyCondition.conditionId)}${reaction.applyCondition.rounds ? ` por ${reaction.applyCondition.rounds} rodada(s)` : ""}`);
  if (reaction.removeCondition) parts.push(`tira ${condition(reaction.removeCondition)}`);
  if (reaction.spread) parts.push(reaction.spread.sameElement ? `passa para quem carrega ${element(carriedId)} a até ${reaction.spread.radius} m` : `atinge quem está a até ${reaction.spread.radius} m`);
  if (reaction.shieldDrain) parts.push(`${reaction.shieldDrain}% de dano extra só no Escudo`);
  if (reaction.leaveSurface) parts.push(`deixa ${element(reaction.leaveSurface)} no chão`);
  const against = ["character", "ship", "structure"].filter(k => reaction.against?.[k]).map(k => ({ character: "pessoas", ship: "naves", structure: "estruturas" })[k]);
  const tail = [reaction.consume ? "a marca é consumida" : "a marca fica", reaction.bodyConducts ? "o corpo também conduz" : "", against.length ? `vale contra ${against.join(", ")}` : ""].filter(Boolean);
  const head = `${reaction.label || "Reação"}: ${element(hitId)} em quem carrega ${element(carriedId)}`;
  return `${head} — ${[...parts, ...tail].join("; ")}.`;
}

/**
 * Avisos de uma reação que consome a marca: quais Condições dão o elemento carregado e não têm
 * duração (ficam para sempre e somem no primeiro golpe que reagir). Pura.
 * @param {string} carriedId
 * @param {Array<{id:string, label?:string, elements?:string[], effect?:{durationRounds?:number}}>} conditions
 * @param {Set<string>} timedConditionIds - Condições que algum elemento aplica com `rounds` > 0
 * @returns {string[]} rótulos das Condições sem duração
 */
export function permanentMarkSources(carriedId, conditions, timedConditionIds = new Set()) {
  return (conditions ?? [])
    .filter(c => Array.isArray(c.elements) && c.elements.includes(carriedId))
    .filter(c => !(Number(c.effect?.durationRounds) > 0) && !timedConditionIds.has(c.id))
    .map(c => c.label ?? c.id);
}

/** Ids de Condição que algum efeito de elemento aplica com duração (para `permanentMarkSources`). Pura. */
export function timedConditionIds(elements) {
  const out = new Set();
  for (const element of elements ?? []) {
    for (const effect of element?.effects ?? []) {
      if (effect?.type === "condition" && effect.conditionId && Number(effect.rounds) > 0) out.add(effect.conditionId);
    }
    for (const reaction of Object.values(element?.reactions ?? {})) {
      if (reaction?.applyCondition?.conditionId && Number(reaction.applyCondition.rounds) > 0) out.add(reaction.applyCondition.conditionId);
    }
  }
  return out;
}

/**
 * Nave: a reação contra o Escudo. Para cada elemento do golpe (partes iguais), a reação com o que o
 * Escudo carrega (`shieldElements` dos Módulos online, só com o Escudo de pé) ou com as marcas da
 * Nave; vale só onde `against.ship`. Devolve a média do fator e do dreno de Escudo — sem consumo. Pura.
 * @param {Array<Array>} chains - uma cadeia de elementos por elemento do golpe
 * @param {Array} marks - marcas da Nave (`carriedMarks`)
 * @param {Array} shieldCarried - `bodyCarried(shieldElements)` (só com Escudo > 0)
 * @returns {{factor:number, drain:number, labels:string[]}}
 */
export function shipReactionAverage(chains, marks, shieldCarried) {
  const list = chains ?? [];
  if (!list.length) return { factor: 1, drain: 0, labels: [] };
  let factor = 0;
  let drain = 0;
  const labels = [];
  for (const chain of list) {
    const carried = [...(shieldCarried ?? []).map(c => ({ ...c, surface: false })), ...(marks ?? [])];
    let picked = null;
    for (const entry of carried) {
      const found = findReaction(chain, entry.ids);
      if (found && found.reaction.against?.ship) {
        picked = found;
        break;
      }
    }
    if (!picked) {
      factor += 1;
      continue;
    }
    factor += reactionFactor(picked.reaction);
    drain += picked.reaction.shieldDrain / 100;
    labels.push(picked.reaction.label);
  }
  return { factor: factor / list.length, drain: drain / list.length, labels: [...new Set(labels)] };
}

/**
 * Migração `reactionsDefaults` (pura): a um catálogo salvo, só ACRESCENTA o que falta — os elementos
 * Água e Óleo, as Condições Molhado e Oleado, o "Elemento do corpo" de Queimadura (Fogo) e Lentidão
 * (Gelo) quando o campo não existe, e as reações de fábrica nos elementos que nunca tiveram o campo
 * `reactions`. Nada editado é sobrescrito.
 * @returns {{elements:Array, conditions:Array, elementsChanged:boolean, conditionsChanged:boolean}}
 */
export function mergeReactionDefaults(elementList, conditionList, { reactions = {}, elements: defaultElements = [], conditions: defaultConditions = [] } = {}) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const elements = Array.isArray(elementList) ? elementList.map(e => ({ ...e })) : [];
  const conditions = Array.isArray(conditionList) ? conditionList.map(c => ({ ...c })) : [];
  let elementsChanged = false;
  let conditionsChanged = false;
  for (const element of elements) {
    if (element?.id && element.reactions === undefined && reactions[element.id]) {
      element.reactions = clone(reactions[element.id]);
      elementsChanged = true;
    }
  }
  if (elements.length) {
    for (const def of defaultElements) {
      if (!elements.some(e => e?.id === def.id)) {
        elements.push(clone(def));
        elementsChanged = true;
      }
    }
  }
  for (const condition of conditions) {
    const def = defaultConditions.find(c => c.id === condition?.id);
    if (def && Array.isArray(def.elements) && condition.elements === undefined) {
      condition.elements = clone(def.elements);
      conditionsChanged = true;
    }
  }
  if (conditions.length) {
    for (const def of defaultConditions) {
      if (def.addIfMissing && !conditions.some(c => c?.id === def.id)) {
        const { addIfMissing, ...plain } = clone(def);
        conditions.push(plain);
        conditionsChanged = true;
      }
    }
  }
  return { elements, conditions, elementsChanged, conditionsChanged };
}
