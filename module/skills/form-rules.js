/**
 * Formas (H5) — regras puras (sem Foundry): o que a ficha temporária pega do molde e do personagem, o
 * que volta ao personagem e o dano que passa do 0 da forma. `skills/forms.js` lê e grava; aqui só
 * se decide. Só importa regras puras.
 */
import { originAttributeRows, originStatRows } from "../species/species-rules.js";

/** Flags de efeito que NÃO voltam ao personagem (nasceram do corpo da forma ou do próprio Vida 0). */
const NO_CARRY_FLAGS = ["incapacitation", "environment", "bodyInjury", "movementMode", "radiation", "preparing", "formSkill"];

/**
 * Do personagem (mente) para a cópia: nível, XP e Mana atual; o resto do `system` é do molde. Devolve
 * o `system` da cópia a partir dos dois `system` (objetos simples, já clonados).
 * @param {object} templateSystem
 * @param {object} originalSystem
 */
export function buildFormSystem(templateSystem = {}, originalSystem = {}) {
  const system = structuredClone(templateSystem ?? {});
  system.attributes ??= {};
  const from = originalSystem?.attributes ?? {};
  system.attributes.level = Math.max(1, Number(from.level) || 1);
  system.attributes.xp = Math.max(0, Number(from.xp) || 0);
  system.attributes.energy = { ...(system.attributes.energy ?? {}), value: Math.max(0, Number(from.energy?.value) || 0) };
  // Pontos de Skill são da mente, não do corpo (achado do teste de 20/11: a cópia mostrava os do molde).
  if (originalSystem?.skillPoints) system.skillPoints = structuredClone(originalSystem.skillPoints);
  system.isPlayerCharacter = originalSystem?.isPlayerCharacter ?? true;
  system.formTemplate = false;
  system.creation = { ...(system.creation ?? {}), active: false };
  // A forma sempre começa com a Vida cheia (a Vida máxima é derivada; o valor é cortado na preparação).
  system.attributes.hp = { ...(system.attributes.hp ?? {}), value: 1e9 };
  return system;
}

/**
 * Quais Itens do personagem vão para a cópia: os Títulos e as Skills que não são Raciais nem
 * concedidas por Item (essas somem sem o Item). Itens equipados, partes do corpo e moedas ficam.
 * @param {Array<{id:string,type:string,system?:object}>} items
 * @returns {Array<object>}
 */
export function itemsFromOriginal(items = []) {
  return items.filter(item => {
    if (item.type === "title") return true;
    if (item.type !== "skill") return false;
    const s = item.system ?? {};
    return s.tier !== "racial" && !s.isItemGranted;
  });
}

/** Skill do personagem na cópia: igual, só que desligada (a única Ativa na cópia é a Forma). */
export function copiedSkillState(skillData, { isFormSkill = false } = {}) {
  const copy = structuredClone(skillData);
  copy.system ??= {};
  if (!isFormSkill) {
    copy.system.active = false;
    if (Array.isArray(copy.system.subSkills)) copy.system.subSkills = copy.system.subSkills.map(s => ({ ...s, active: false }));
  }
  return copy;
}

/** Ids da cópia de um Item do personagem: `itemMap` é `{idOriginal: idCópia}`. */
export function mapCopiedId(itemMap = {}, originalId) {
  return itemMap?.[originalId] ?? null;
}

/**
 * O que volta ao personagem quando a forma acaba.
 * - XP do Ator: o personagem soma o que a cópia ganhou desde `startXp` (nunca negativo).
 * - Mana: o personagem fica com a Mana atual da cópia (o gasto não volta), limitada ao máximo dele.
 * - Skills copiadas: XP, nível, recarga e Sub-Skills voltam pelo mapa (a Skill da Forma sai desligada).
 * @param {{original:{xp:number,energy:number,energyMax:number},copy:{xp:number,energy:number},startXp:number,skills:Array<{originalId:string,copyId:string,xp:number,level:number,cooldownRemaining?:number,subSkills?:Array}>,formSkillId:string}} input
 */
export function mergeBackPlan({ original, copy, startXp = 0, skills = [], formSkillId = "" }) {
  const gained = Math.max(0, (Number(copy.xp) || 0) - (Number(startXp) || 0));
  const energyMax = Math.max(0, Number(original.energyMax) || 0);
  const energy = Math.min(Math.max(0, Math.round(Number(copy.energy) || 0)), energyMax || Math.max(0, Math.round(Number(copy.energy) || 0)));
  return {
    xp: Math.max(0, Math.round((Number(original.xp) || 0) + gained)),
    energy,
    skills: skills.map(s => ({
      id: s.originalId,
      xp: Math.max(0, Number(s.xp) || 0),
      level: Math.max(1, Number(s.level) || 1),
      cooldownRemaining: Math.max(0, Number(s.cooldownRemaining) || 0),
      subSkills: Array.isArray(s.subSkills) ? s.subSkills : null,
      active: false,
      isFormSkill: s.originalId === formSkillId
    }))
  };
}

/** Efeitos de Condição da cópia que voltam ao personagem (dados de efeito, sem `_id`). */
export function conditionsToCarry(effects = [], systemId = "nihility-rpg-system") {
  const out = [];
  for (const effect of effects) {
    const f = effect?.flags?.[systemId] ?? {};
    if (NO_CARRY_FLAGS.some(key => f[key] != null && f[key] !== false)) continue;
    const isCondition = Boolean(f.conditionId) || (Array.isArray(effect.statuses) ? effect.statuses.length > 0 : [...(effect.statuses ?? [])].length > 0);
    if (!isCondition) continue;
    const data = structuredClone(effect);
    delete data._id;
    out.push(data);
  }
  return out;
}

/** O dano que passou do 0 da forma (já reduzido pelas defesas dela): vai direto à Vida do personagem. */
export function carryDamage(currentHp, hpDamage) {
  return Math.max(0, Math.round((Number(hpDamage) || 0) - Math.max(0, Number(currentHp) || 0)));
}

/** Vida do personagem depois de receber o `carry` (nunca abaixo de 0). */
export function hpAfterCarry(originalHp, carry) {
  return Math.max(0, Math.round((Number(originalHp) || 0) - Math.max(0, Number(carry) || 0)));
}

/** Soma o `carry` novo ao já guardado (vários golpes antes de a reversão rodar). */
export function accumulateCarry(stored, add) {
  return Math.max(0, Math.round((Number(stored) || 0) + (Number(add) || 0)));
}

/**
 * A forma deve voltar? Skill de Forma desligada, ou Vida 0.
 * @param {{formSkillActive:boolean, hp:number}} state
 */
export function shouldRevert({ formSkillActive, hp }) {
  return !formSkillActive || (Number(hp) || 0) <= 0;
}

/** Nome da cópia temporária: "Kaito (Lobo)". */
export function formActorName(originalName, templateName) {
  return `${originalName} (${templateName})`;
}

/**
 * Guarda do Token original antes de trocar para a cópia (para voltar igual).
 * @param {{actorId?:string,actorLink?:boolean,delta?:object,texture?:{src?:string},width?:number,height?:number}} token
 */
export function tokenOriginalSnapshot(token) {
  return {
    actorId: token.actorId ?? null,
    actorLink: Boolean(token.actorLink),
    delta: token.delta ? structuredClone(token.delta) : null,
    textureSrc: token.texture?.src ?? "",
    width: Number(token.width) || 1,
    height: Number(token.height) || 1
  };
}

/** Dados de Token para a forma: vinculado, com a imagem e o tamanho do Token do molde. */
export function formTokenUpdate(copyId, templateToken = {}) {
  const update = { actorId: copyId, actorLink: true };
  if (templateToken.textureSrc) update["texture.src"] = templateToken.textureSrc;
  if (Number(templateToken.width) > 0) update.width = Number(templateToken.width);
  if (Number(templateToken.height) > 0) update.height = Number(templateToken.height);
  return update;
}

/** Dados de Token para voltar ao original. */
export function tokenRestoreUpdate(snapshot) {
  const update = { actorId: snapshot.actorId, actorLink: snapshot.actorLink, "texture.src": snapshot.textureSrc, width: snapshot.width, height: snapshot.height };
  if (!snapshot.actorLink && snapshot.delta) update.delta = snapshot.delta;
  return update;
}

/**
 * Sanea um pedido de forma de jogador do lado do Mestre: nome, Espécie, imagem e atributos. A soma
 * dos pontos nunca passa do total do personagem. Devolve `null` se o pedido é inválido.
 * @param {{name?:string,speciesId?:string,img?:string,points?:Record<string,number>}} request
 * @param {{total:number, attributeKeys:string[], speciesIds:string[]}} limits
 */
export function normalizeFormRequest(request, { total = 0, attributeKeys = [], speciesIds = [] } = {}) {
  const name = String(request?.name ?? "").trim().slice(0, 80);
  if (!name) return null;
  const speciesId = String(request?.speciesId ?? "");
  if (speciesIds.length && speciesId && !speciesIds.includes(speciesId)) return null;
  const points = {};
  let sum = 0;
  for (const key of attributeKeys) {
    const value = Math.max(0, Math.floor(Number(request?.points?.[key]) || 0));
    points[key] = value;
    sum += value;
  }
  if (sum > Math.max(0, Number(total) || 0)) return null;
  return { name, speciesId, img: String(request?.img ?? "").slice(0, 400), points, spent: sum };
}

/** Extensões de imagem aceitas no envio do jogador. */
export function isImageFile(file) {
  const type = String(file?.type ?? "");
  if (type) return type.startsWith("image/");
  return /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(String(file?.name ?? ""));
}

/**
 * O mapa `{idOriginal: idCópia}` a partir do que `createEmbeddedDocuments` devolveu: cada Item copiado leva o
 * carimbo `formSourceId` (id do original). Nunca pelo índice: o Foundry devolve na ordem do `sort`, não na de envio.
 * @param {Array<{id: string, stamp: ?string}>} created
 */
export function itemMapFromStamps(created = []) {
  const map = {};
  for (const doc of created) if (doc?.stamp && doc.id) map[doc.stamp] = doc.id;
  return map;
}

/**
 * Vida da forma como o molde vai nascer (C7, sessão 4): a prévia do editor só somava os pontos dos atributos e dizia 950,
 * enquanto a ficha criada, com os bônus da Espécie nos atributos e na Vida, nascia com 1000. Agora a prévia e a criação
 * fazem a mesma conta de `deriveVitalStats`: (atributo A + bônus) × (atributo B + bônus) × multiplicador, com o piso,
 * mais o bônus de Vida da Espécie. `layers` são as camadas de origem da Espécie (`originLayers`). Pura.
 */
export function formVitalMax({ points = {}, layers = [], formula = {} } = {}) {
  const total = key => (Number(points[key]) || 0) + originAttributeRows(layers, key).reduce((s, r) => s + r.value, 0);
  const [a, b] = formula.hp ?? [];
  const base = Math.max(Number(formula.floor) || 0, Math.round(total(a) * total(b) * (Number(formula.multiplier) || 0)));
  return Math.max(1, base + originStatRows(layers, "hp").reduce((s, r) => s + r.value, 0));
}
