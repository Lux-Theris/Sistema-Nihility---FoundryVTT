/**
 * Configuração de cenas por pasta (H20) — a parte pura e testada. Quem lê Cenas, Pastas e flags é
 * `environment/scene-config.js`.
 *
 * Cada configuração de cena do sistema é lida por UMA regra: valor próprio da cena -> pasta da cena
 * -> pastas acima -> padrão. "Sem valor" é não definir (a chave não existe); `0`, `false`, `[]` e `""`
 * são valores de verdade. Cena e pasta guardam os valores na flag `sceneCfg` (só as chaves com valor).
 *
 * Campo novo (ex.: o "Entregas vão para" do G2 Lojas): uma linha em SCENE_FIELDS com o padrão e a
 * limpeza do valor; o resto (leitura, janela, resumo) segue sozinho.
 */
import { MAIN_LINE_ID } from "../core/calendar-rules.js";
import { normalizeHazard, normalizeDensity } from "./environment-rules.js";

export const SCENE_CFG_FLAG = "sceneCfg";
export const MAX_FOLDER_DEPTH = 40;

const text = value => (typeof value === "string" ? value.trim() : "");

/**
 * Os campos herdáveis. `clean(valor)` devolve o valor limpo, ou `undefined` quando não é um valor
 * válido (então o campo fica "sem valor"). `legacyEmpty` diz se um valor das flags antigas (`time`,
 * `environment`) é o "vazio" de antes — só o que não é vazio vale como valor próprio (a flag antiga
 * gravava tudo, sempre).
 */
export const SCENE_FIELDS = {
  lineId: {
    label: "Linha do tempo",
    def: MAIN_LINE_ID,
    clean: v => text(v) || undefined,
    legacyEmpty: v => !text(v) || text(v) === MAIN_LINE_ID
  },
  network: {
    label: "Tem rede",
    def: false,
    clean: v => (typeof v === "boolean" ? v : undefined),
    legacyEmpty: v => !v
  },
  clockDarkness: {
    label: "Escurece com o relógio",
    def: false,
    clean: v => (typeof v === "boolean" ? v : undefined),
    legacyEmpty: v => !v
  },
  manaDensity: {
    label: "Densidade de Mana",
    def: null,
    // null = "usa a do mundo": só é "valor" um número.
    clean: v => {
      const n = normalizeDensity(v);
      return n === null ? undefined : n;
    },
    legacyEmpty: v => normalizeDensity(v) === null
  },
  radiation: {
    label: "Radiação",
    def: 0,
    clean: v => {
      const n = Number(v);
      return Number.isFinite(n) && v !== "" && v !== null ? Math.max(0, n) : undefined;
    },
    legacyEmpty: v => !(Number(v) > 0)
  },
  depotId: {
    label: "Entregas vão para",
    // uuid do Ator-depósito (G2 Lojas); vazio = sem endereço de entrega.
    def: "",
    clean: v => text(v) || undefined,
    legacyEmpty: () => true
  },
  sensorInterference: {
    label: "Interferência de sensores",
    // Percentual (0-100) que corta o alcance de todos os sensores de nave da cena (F1). 100 = todos cegos.
    def: 0,
    clean: v => {
      const n = Number(v);
      return Number.isFinite(n) && v !== "" && v !== null ? Math.min(100, Math.max(0, n)) : undefined;
    },
    legacyEmpty: () => true
  },
  hazards: {
    label: "Perigos",
    def: [],
    clean: v => (Array.isArray(v) ? v.map(normalizeHazard).filter(Boolean) : undefined),
    legacyEmpty: v => !Array.isArray(v) || !v.some(normalizeHazard)
  }
};

export const SCENE_FIELD_KEYS = Object.keys(SCENE_FIELDS);

/** O padrão de um campo (cópia, para o chamador poder mexer). */
export function fieldDefault(key) {
  const def = SCENE_FIELDS[key]?.def;
  return Array.isArray(def) ? [] : def;
}

/** Os valores próprios gravados numa cena ou pasta (`sceneCfg`): só as chaves conhecidas e válidas. */
export function normalizeCfg(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of SCENE_FIELD_KEYS) {
    if (!(key in raw)) continue;
    const value = SCENE_FIELDS[key].clean(raw[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * O que as flags ANTIGAS da cena (`time` = `{lineId, network}`, `environment` = `{hazards,
 * manaDensity, radiation, clockDarkness}`) valem como valor próprio: só o que não é o vazio de antes.
 */
export function legacyOwn(timeFlag, environmentFlag) {
  const raw = { ...(timeFlag && typeof timeFlag === "object" ? timeFlag : {}), ...(environmentFlag && typeof environmentFlag === "object" ? environmentFlag : {}) };
  const out = {};
  for (const key of SCENE_FIELD_KEYS) {
    if (!(key in raw)) continue;
    const field = SCENE_FIELDS[key];
    if (field.legacyEmpty(raw[key])) continue;
    const value = field.clean(raw[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Os valores próprios de uma cena: o `sceneCfg` manda; as flags antigas completam o que ele não diz. */
export function sceneOwn(cfgFlag, timeFlag, environmentFlag) {
  return { ...legacyOwn(timeFlag, environmentFlag), ...normalizeCfg(cfgFlag) };
}

/**
 * A cadeia de pastas de baixo para cima, a partir de `startId`, com guarda contra ciclo e excesso.
 * @param {string|null} startId
 * @param {Map<string,{id:string,name?:string,parentId?:string|null}>|Object} folders por id
 * @returns {Array<{id:string,name:string}>}
 */
export function folderChain(startId, folders) {
  const get = id => (folders instanceof Map ? folders.get(id) : folders?.[id]);
  const out = [];
  const seen = new Set();
  let id = startId || null;
  while (id && !seen.has(id) && out.length < MAX_FOLDER_DEPTH) {
    const folder = get(id);
    if (!folder) break;
    seen.add(id);
    out.push({ id, name: folder.name ?? "", cfg: folder.cfg });
    id = folder.parentId || null;
  }
  return out;
}

/**
 * Um campo: valor próprio -> pastas (da mais próxima para cima) -> padrão.
 * @param {string} key
 * @param {{own?: object, chain?: Array<{id:string,name:string,cfg?:object}>}} source
 * @returns {{value: any, source: "own"|"folder"|"default", from: {id:string,name:string}|null}}
 */
export function resolveField(key, { own = {}, chain = [] } = {}) {
  if (key in own) return { value: own[key], source: "own", from: null };
  for (const folder of chain) {
    if (folder.cfg && key in folder.cfg) return { value: folder.cfg[key], source: "folder", from: { id: folder.id, name: folder.name } };
  }
  return { value: fieldDefault(key), source: "default", from: null };
}

/** Todos os campos de uma vez: `{chave: {value, source, from}}`. */
export function resolveAll(source = {}) {
  return Object.fromEntries(SCENE_FIELD_KEYS.map(key => [key, resolveField(key, source)]));
}

/** Só os valores (`{chave: valor}`), para quem não precisa de saber de onde veio. */
export function resolvedValues(source = {}) {
  return Object.fromEntries(Object.entries(resolveAll(source)).map(([key, r]) => [key, r.value]));
}

/** Os ids da pasta e de todas as subpastas dela. `list`: `[{id, parentId}]`. */
export function folderSubtreeIds(rootId, list = []) {
  const out = new Set(rootId ? [rootId] : []);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of list) {
      if (folder?.parentId && out.has(folder.parentId) && !out.has(folder.id)) {
        out.add(folder.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * Resumo da pasta: as cenas dela (e das subpastas) que têm valor próprio, com os campos.
 * @param {Array<{id:string,name:string,own:object}>} scenes
 * @returns {Array<{id:string,name:string,fields:string[]}>}
 */
export function scenesWithOwn(scenes = []) {
  return scenes
    .map(scene => ({ id: scene.id, name: scene.name, fields: SCENE_FIELD_KEYS.filter(key => key in (scene.own ?? {})) }))
    .filter(row => row.fields.length)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * O que mudou entre dois conjuntos de valores próprios: `{set, remove}` (para montar a gravação).
 * Igualdade por JSON (os valores são números, textos, booleanos e a lista de perigos).
 */
export function diffOwn(previous = {}, next = {}) {
  const set = {};
  const remove = [];
  for (const key of SCENE_FIELD_KEYS) {
    const had = key in previous;
    const has = key in next;
    if (has && (!had || JSON.stringify(previous[key]) !== JSON.stringify(next[key]))) set[key] = next[key];
    else if (!has && had) remove.push(key);
  }
  return { set, remove };
}

/** Texto curto de um valor, para o resumo ("Linha: Passado", "Mana ×2"). */
export function fieldValueText(key, value, { lineName = null, depotName = null } = {}) {
  switch (key) {
    case "lineId": return `linha ${lineName || value}`;
    case "network": return value ? "tem rede" : "sem rede";
    case "clockDarkness": return value ? "escurece com o relógio" : "não escurece com o relógio";
    case "manaDensity": return `Mana ×${value}`;
    case "radiation": return value > 0 ? `radiação ${value}` : "sem radiação";
    case "sensorInterference": return value > 0 ? `interferência de sensores ${value}%` : "sem interferência de sensores";
    case "depotId": return `entregas em ${depotName || "um depósito"}`;
    case "hazards": return value.length ? `${value.length} perigo(s)` : "sem perigos";
    default: return String(value);
  }
}

/** Frase da faixa da janela da cena: "N campos com valor próprio" (ou vazio). */
export function ownBannerText(count) {
  if (!count) return "";
  return count === 1 ? "1 campo com valor próprio" : `${count} campos com valor próprio`;
}

/**
 * Pastas que o Validar Mundo deve apontar: o valor da pasta cita uma linha do tempo que não existe mais.
 * @param {Array<{name:string, cfg:object}>} folders
 * @param {string[]} lineIds
 */
export function folderConfigIssues(folders = [], lineIds = []) {
  const known = new Set([...lineIds, MAIN_LINE_ID]);
  const issues = [];
  for (const folder of folders) {
    const id = folder?.cfg?.lineId;
    if (id && !known.has(id)) {
      issues.push({ where: `Pasta de cenas "${folder.name}"`, message: `define uma linha do tempo que foi apagada ("${id}"): as cenas dela contam como a linha principal` });
    }
  }
  return issues;
}
