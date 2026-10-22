/**
 * Ambiente da cena e das áreas (backlog B4) e densidade de mana (C5) — a parte pura e testada.
 * Quem lê cenas, Regions e fichas é `environment/environment.js`.
 *
 * Um perigo de ambiente é uma Condição do catálogo que o lugar mantém aplicada em quem está nele
 * (vácuo, radiação, gravidade alta…); quem tem um Traço da lista de imunes escapa. A Condição faz o
 * resto sozinha (dano por rodada, Lentidão), inclusive a Resistência ao elemento dela.
 */

/**
 * Um perigo limpo: `{conditionId, immuneTraits[], fx, fxParticle, fxFilter, fxColor}`. O visual
 * (só na cena, via FXMaster) é um clima pronto (`fx`, preset) e/ou uma partícula + um filtro do
 * catálogo do FXMaster, com uma cor opcional (`fxColor`, "#rrggbb" ou "").
 */
export function normalizeHazard(hazard) {
  const conditionId = typeof hazard?.conditionId === "string" ? hazard.conditionId.trim() : "";
  if (!conditionId) return null;
  const immuneTraits = Array.isArray(hazard?.immuneTraits) ? [...new Set(hazard.immuneTraits.filter(t => typeof t === "string" && t))] : [];
  const text = value => (typeof value === "string" ? value.trim() : "");
  const color = text(hazard?.fxColor);
  return {
    conditionId,
    immuneTraits,
    fx: text(hazard?.fx),
    fxParticle: text(hazard?.fxParticle),
    fxFilter: text(hazard?.fxFilter),
    fxColor: /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : ""
  };
}

/**
 * O que os perigos de uma cena querem tocando: climas prontos (nomes, sem repetir) e combinações
 * partícula + filtro + cor (uma por `key`, sem repetir).
 */
export function wantedSceneFx(hazards = []) {
  const presets = [];
  const customs = [];
  for (const raw of hazards ?? []) {
    const h = normalizeHazard(raw);
    if (!h) continue;
    if (h.fx && !presets.includes(h.fx)) presets.push(h.fx);
    if (h.fxParticle || h.fxFilter) {
      const key = `${h.fxParticle}|${h.fxFilter}|${h.fxColor}`;
      if (!customs.some(c => c.key === key)) customs.push({ key, particle: h.fxParticle, filter: h.fxFilter, color: h.fxColor });
    }
  }
  return { presets, customs };
}

/**
 * O que ligar e desligar, comparando com o que ficou guardado como tocando (`fxPlaying`: nomes de
 * preset — formato antigo — ou `{preset}` / `{key, ids}`). O que continua querido não é tocado de novo.
 * @returns {{stopPresets: string[], playPresets: string[], stopCustoms: object[], playCustoms: object[], keep: object[]}}
 */
export function sceneFxPlan(previous = [], wanted = { presets: [], customs: [] }) {
  const prevPresets = [];
  const prevCustoms = [];
  for (const entry of previous ?? []) {
    if (typeof entry === "string" && entry) prevPresets.push(entry);
    else if (entry?.preset) prevPresets.push(entry.preset);
    else if (entry?.key) prevCustoms.push(entry);
  }
  return {
    stopPresets: prevPresets.filter(p => !wanted.presets.includes(p)),
    playPresets: wanted.presets.filter(p => !prevPresets.includes(p)),
    stopCustoms: prevCustoms.filter(c => !wanted.customs.some(w => w.key === c.key)),
    playCustoms: wanted.customs.filter(w => !prevCustoms.some(c => c.key === w.key)),
    keep: [
      ...prevPresets.filter(p => wanted.presets.includes(p)).map(preset => ({ preset })),
      ...prevCustoms.filter(c => wanted.customs.some(w => w.key === c.key))
    ]
  };
}

/** Nome legível de um clima pronto do FXMaster ("acid-rain" → "Chuva ácida"). */
const PRESET_LABELS = {
  "acid-rain": "Chuva ácida", "autumn-leaves": "Folhas de outono", blizzard: "Nevasca", "blood-rain": "Chuva de sangue",
  cloudy: "Nublado", drizzle: "Garoa", fog: "Neblina", hail: "Granizo", "heat-wave": "Onda de calor", hurricane: "Furacão",
  "ice-storm": "Tempestade de gelo", mist: "Bruma", monsoon: "Monção", nullfront: "Frente nula", overcast: "Encoberto",
  "partly-cloudy": "Parcialmente nublado", rain: "Chuva", "rolling-fog": "Neblina rolante", sleet: "Chuva com neve",
  snow: "Neve", sunshower: "Sol com chuva", thunderstorm: "Tempestade", storm: "Tempestade", sandstorm: "Tempestade de areia",
  duststorm: "Tempestade de poeira", embers: "Brasas", ash: "Cinzas", ashfall: "Chuva de cinzas", "light-rain": "Chuva fraca",
  "heavy-rain": "Chuva forte", "light-snow": "Neve fraca", "heavy-snow": "Neve forte", underwater: "Embaixo d'água",
  wildfire: "Incêndio", aurora: "Aurora", starfield: "Campo de estrelas", windy: "Ventania", gloom: "Penumbra"
};

export function fxPresetLabel(name) {
  const id = String(name ?? "");
  if (PRESET_LABELS[id]) return PRESET_LABELS[id];
  const words = id.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : id;
}

/** Densidade limpa: número ≥ 0, ou null (= "não muda nada aqui"). */
export function normalizeDensity(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * As Condições que o ambiente quer neste Ator: as de todos os perigos das fontes (cena e áreas),
 * menos as dos perigos cujo Traço imune o Ator tem.
 * @param {Array<{hazards: Array<object>}>} sources
 * @param {string[]} traits - Traços efetivos do Ator
 * @returns {Set<string>}
 */
export function desiredEnvironmentConditions(sources, traits = []) {
  const has = new Set(traits ?? []);
  const out = new Set();
  for (const source of sources ?? []) {
    for (const raw of source?.hazards ?? []) {
      const hazard = normalizeHazard(raw);
      if (!hazard || hazard.immuneTraits.some(t => has.has(t))) continue;
      out.add(hazard.conditionId);
    }
  }
  return out;
}

/**
 * O que mudar no Ator: criar as Condições que o ambiente quer e ele não tem (de fonte nenhuma —
 * uma Condição que já veio de Skill/Elemento fica como está), e tirar as que o AMBIENTE pôs e
 * não são mais queridas (saiu da área, ganhou o Traço imune, o Mestre desligou o perigo).
 * @param {Set<string>} desired
 * @param {Array<{id: string, conditionId: string}>} fromEnvironment - efeitos marcados "do ambiente"
 * @param {Set<string>} fromElsewhere - Condições que o Ator tem por outra fonte
 */
export function environmentDiff(desired, fromEnvironment = [], fromElsewhere = new Set()) {
  const owned = new Set(fromEnvironment.map(e => e.conditionId));
  return {
    add: [...desired].filter(id => !owned.has(id) && !fromElsewhere.has(id)),
    remove: fromEnvironment.filter(e => !desired.has(e.conditionId)).map(e => e.id)
  };
}

/**
 * Densidade de mana num ponto: as áreas mandam (havendo várias, a MENOR — uma zona morta dentro de
 * um nexo continua morta); sem área, a da cena; sem nada, a do mundo.
 */
export function resolveManaDensity({ worldDefault = 1, scene = null, areas = [] } = {}) {
  const areaValues = (areas ?? []).map(normalizeDensity).filter(v => v !== null);
  if (areaValues.length) return Math.min(...areaValues);
  const sceneValue = normalizeDensity(scene);
  if (sceneValue !== null) return sceneValue;
  return normalizeDensity(worldDefault) ?? 1;
}
