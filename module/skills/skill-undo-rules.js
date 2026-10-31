/**
 * Desfazer o uso de uma Skill (backlog L12) — a parte pura, testada em test/rules.test.mjs.
 *
 * O uso é registrado por FOTOGRAFIA: antes e depois do uso, os mesmos campos de cada Ator
 * envolvido (quem usou e os alvos) são lidos; o registro guarda só o que mudou. Desfazer então:
 *  - números (Vida, Mana, Escudo, XP…) voltam pela DIFERENÇA, não pelo valor de antes — o que
 *    outra coisa mexeu no meio-tempo (uma reação, um tick) fica;
 *  - o resto (ligada/desligada, estado de parte, listas) volta ao valor de antes;
 *  - Active Effects: os criados saem, os mudados voltam como eram, os apagados voltam.
 */

/** Campos do Ator fotografados, por tipo (os de Nave são os gravados — Casco/Integridade são Módulos). */
export const UNDO_VITAL_PATHS = {
  character: ["system.attributes.hp.value", "system.attributes.energy.value", "system.attributes.shield.value"],
  ship: ["system.shields.value", "system.shields.rechargeRemaining", "system.powerGrid.capacitor.value"]
};

/** Campos de cada Item fotografados (Skill ligada, XP, Vida de parte/Módulo…). */
export const UNDO_ITEM_PATHS = ["system.active", "system.xp", "system.hp.value", "system.integrity", "system.lost", "system.status"];

/** Flags do sistema no Ator que um uso pode mexer e que voltam inteiras. */
export const UNDO_FLAG_KEYS = ["sustainedShields", "shipEffects"];

/**
 * Os diffs vão para um flag de mensagem, e o Foundry expande chave com ponto ("system.xp") em
 * objeto aninhado ao gravar. Por isso o registro guarda pares `[campo, [antes, depois]]`; estas
 * duas funções convertem na ida e na volta (aceitam os dois formatos).
 */
export function fieldPairs(fields) {
  return Array.isArray(fields) ? fields : Object.entries(fields ?? {});
}
export function asFields(fields) {
  return Array.isArray(fields) ? Object.fromEntries(fields) : fields ?? {};
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Os campos que mudaram entre duas fotos: `{campo: [antes, depois]}`. */
export function diffFields(before = {}, after = {}) {
  const out = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!same(before[key], after[key])) out[key] = [before[key] ?? null, after[key] ?? null];
  }
  return out;
}

/**
 * O que gravar para desfazer `changes` (saída de diffFields) sobre os valores `current` de agora.
 * Número → atual − (depois − antes), nunca abaixo de 0; o resto → o valor de antes.
 */
export function revertFields(current = {}, changes = {}) {
  const out = {};
  for (const [key, [before, after]] of fieldPairs(changes)) {
    if (typeof before === "number" && typeof after === "number") {
      const now = typeof current[key] === "number" ? current[key] : after;
      const value = now - (after - before);
      out[key] = Math.max(0, Number.isInteger(before) && Number.isInteger(after) ? Math.round(value) : value);
    } else {
      out[key] = before;
    }
  }
  return out;
}

const poolKey = p => `${p?.holderUuid ?? ""}|${p?.skillId ?? ""}|${p?.subSkillIndex ?? ""}`;

/**
 * Pools de Escudo pessoal depois de desfazer: cada pool que o uso aumentou perde o que ganhou
 * (some se zerar e não existia antes); um que o uso tirou ou apagou (Antimagia) recupera o que
 * perdeu. Pools que o uso não tocou ficam como estão agora.
 */
export function revertPools(current = [], before = [], after = []) {
  const beforeBy = new Map(before.map(p => [poolKey(p), p]));
  const afterBy = new Map(after.map(p => [poolKey(p), p]));
  const result = current.map(p => ({ ...p }));
  const find = key => result.find(p => poolKey(p) === key);
  for (const key of new Set([...beforeBy.keys(), ...afterBy.keys()])) {
    const delta = (afterBy.get(key)?.value ?? 0) - (beforeBy.get(key)?.value ?? 0);
    if (!delta) continue;
    const pool = find(key);
    if (pool) pool.value = Math.max(0, (pool.value ?? 0) - delta);
    else if (delta < 0) result.push({ ...beforeBy.get(key), value: -delta });
  }
  return result.filter(p => p.value > 0 || beforeBy.has(poolKey(p)));
}

/** Tira o que o Foundry muda sozinho (datas de modificação) antes de comparar. */
function comparable(effect) {
  const { _stats, ...rest } = effect ?? {};
  return rest;
}

/**
 * Active Effects de um Ator antes × depois (objetos `toObject()`):
 * `created` = ids que nasceram, `deleted`/`changed` = os objetos de ANTES, para recriar/restaurar.
 */
export function diffEffects(before = [], after = []) {
  const beforeBy = new Map(before.map(e => [e._id, e]));
  const afterBy = new Map(after.map(e => [e._id, e]));
  const created = after.filter(e => !beforeBy.has(e._id)).map(e => ({ id: e._id, name: e.name ?? "" }));
  const deleted = before.filter(e => !afterBy.has(e._id)).map(comparable);
  const changed = before.filter(e => afterBy.has(e._id) && !same(comparable(e), comparable(afterBy.get(e._id)))).map(comparable);
  return { created, deleted, changed };
}

/** O registro de um Ator tem alguma coisa a desfazer? */
export function actorEntryHasChanges(entry) {
  if (!entry) return false;
  const e = entry.effects ?? {};
  return Boolean(
    fieldPairs(entry.vitals).length ||
      entry.pools ||
      (e.created?.length ?? 0) + (e.deleted?.length ?? 0) + (e.changed?.length ?? 0) ||
      (entry.items ?? []).length ||
      fieldPairs(entry.flags).length
  );
}

/**
 * O botão "Desfazer uso" ainda vale? Em combate: enquanto o turno for o mesmo do uso (mesma
 * rodada, mesmo turno). Fora de combate: enquanto for o último uso daquele personagem.
 * @param {object} record
 * @param {{combat?: {id, round, turn}|null, newerUse?: boolean}} now
 */
export function undoWindowOpen(record, { combat = null, newerUse = false } = {}) {
  if (!record || record.undone) return false;
  if (record.combat) {
    return Boolean(combat) && combat.id === record.combat.id && combat.round === record.combat.round && combat.turn === record.combat.turn;
  }
  return !newerUse;
}

const fmt = n => `${n > 0 ? "+" : "−"}${Math.abs(n)}`;

const VITAL_LABELS = {
  "system.attributes.hp.value": "Vida",
  "system.attributes.shield.value": "Escudo",
  "system.shields.value": "Escudo",
  "system.shields.rechargeRemaining": "Recarga do Escudo"
};

/**
 * As linhas da confirmação ("+20 · Mana de volta para Kira"…), na ordem: energia/vitais, dano,
 * efeitos, Skills e Itens, Estrutura/Zona. `damage` = linhas dos cards de dano deste uso
 * (`{name, applied: {toHp, toShield}|null}`); `skillLabel` = nome da Skill usada.
 * Cada linha: `{tag, tone, text}` — tone: energy | heal | muted | effect | xp | off.
 */
export function undoPreviewRows(record, { damage = [], skillLabel = "" } = {}) {
  const rows = [];
  for (const actor of record?.actors ?? []) {
    for (const [path, [before, after]] of fieldPairs(actor.vitals)) {
      if (typeof before !== "number" || typeof after !== "number") continue;
      const back = before - after;
      if (!back) continue;
      const isEnergy = /energy\.value$|capacitor\.value$/.test(path);
      const label = isEnergy ? actor.energyLabel || "Mana" : VITAL_LABELS[path] ?? path;
      rows.push({
        tag: fmt(back),
        tone: isEnergy ? "energy" : "heal",
        text: back > 0 ? `${label} de volta para ${actor.name}` : `${label} que ${actor.name} ganhou sai`
      });
    }
  }
  for (const hit of damage) {
    if (hit.applied) {
      const total = (hit.applied.toHp ?? 0) + (hit.applied.toShield ?? 0);
      rows.push({ tag: fmt(total || 0), tone: "heal", text: `Vida${hit.applied.toShield ? " e Escudo" : ""} de volta para ${hit.name} (dano já aplicado)` });
    } else {
      rows.push({ tag: "—", tone: "muted", text: `${hit.name}: dano ainda não aplicado, nada a voltar` });
    }
  }
  for (const actor of record?.actors ?? []) {
    for (const e of actor.effects?.created ?? []) rows.push({ tag: "sai", tone: "effect", text: `${e.name || "Efeito"} em ${actor.name}` });
    for (const e of actor.effects?.changed ?? []) rows.push({ tag: "volta", tone: "effect", text: `${e.name || "Efeito"} em ${actor.name} volta como estava` });
    for (const e of actor.effects?.deleted ?? []) rows.push({ tag: "volta", tone: "effect", text: `${e.name || "Efeito"} em ${actor.name} (este uso tinha tirado)` });
  }
  for (const actor of record?.actors ?? []) {
    for (const item of actor.items ?? []) {
      const changes = asFields(item.changes);
      const xp = changes["system.xp"];
      if (xp && typeof xp[0] === "number" && typeof xp[1] === "number" && xp[1] !== xp[0]) {
        rows.push({ tag: `${fmt(xp[0] - xp[1])} XP`, tone: "xp", text: `XP de uso de ${item.name}` });
      }
      const active = changes["system.active"] ?? null;
      const subs = changes.subSkillsActive ?? null;
      if (active || subs) {
        const turnedOn = active ? active[1] === true : (subs[1] ?? []).some((on, i) => on && !(subs[0] ?? [])[i]);
        rows.push({ tag: turnedOn ? "desliga" : "liga", tone: "off", text: `${item.name} (Skill Ativa)${actor.isSource ? "" : ` de ${actor.name}`}` });
      }
      const rest = Object.keys(changes).filter(k => !["system.xp", "system.active", "subSkillsActive"].includes(k));
      if (rest.length) rows.push({ tag: "volta", tone: "effect", text: `${item.name} de ${actor.name} volta como estava` });
    }
    const flags = asFields(actor.flags);
    if (flags.sustainedShields) rows.push({ tag: "volta", tone: "effect", text: `Escudo mantido de ${actor.name}` });
    if (flags.shipEffects) rows.push({ tag: "volta", tone: "effect", text: `Efeitos de sistema de ${actor.name}` });
  }
  if (record?.placed?.structure) rows.push({ tag: "some", tone: "effect", text: `Estrutura erguida por ${skillLabel || "este uso"}` });
  if (record?.placed?.zone) rows.push({ tag: "some", tone: "effect", text: `Zona criada por ${skillLabel || "este uso"}` });
  return rows;
}
