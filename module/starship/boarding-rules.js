/**
 * Abordagem de naves (F2) — as contas puras, sem Foundry (testado em `test/boarding.test.mjs`). A afinação entra por
 * parâmetro. Resumo (números aprovados pelo dono em 24/11):
 *  - Acoplar: dois Tokens de nave colados; só com Raio Trator segurando, Escudo do alvo em 0 ou o Mestre liberando
 *    (Veículo: só o Mestre). O par fica marcado até "Desacoplar".
 *  - Mover uma nave acoplada: teste resistido de propulsão. Diferença ≤ 4 arrasta a outra; ≥ 5 arranca pedaço de quem
 *    perdeu (Casco + Módulo do ponto de acoplamento) e desacopla.
 *  - Grupo de abordagem: quem está a bordo da outra nave. Sabotar = dano direto no Módulo (sem Escudo, Casco nem escala);
 *    Desligar e Hackear pedem aprovação do Mestre. Tomar a nave não existe.
 *  - Abordar por teleporte: precisa ver o alvo no sensor; Interdição e Âncora bloqueiam.
 */

/** Rodadas padrão do Desligar e do Hackear (o Mestre muda no card). */
export const DISABLE_ROUNDS = 3;
export const HACK_ROUNDS = 5;

/** Os tipos de pedido ao Mestre (Acoplar também pode virar pedido) e os rótulos. */
export const REQUEST_KINDS = Object.freeze({
  dock: "Acoplar",
  disable: "Desligar",
  hack: "Hackear"
});

/** As ações do grupo de abordagem. */
export const BOARDING_ACTIONS = Object.freeze({
  sabotage: "Sabotar",
  disable: "Desligar",
  hack: "Hackear"
});

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/* ------------------------------------------------------------------ Acoplar */

/** Dois Tokens de nave estão colados? `gapSquares` = distância borda a borda em quadrados; até meio quadrado conta. */
export function tokensTouching(gapSquares, tolerance = 0.5) {
  return num(gapSquares, Infinity) <= tolerance + 1e-9;
}

/**
 * Pode acoplar? Devolve `{ok, via, reason, canAsk}`: `via` é "tractor", "shield" ou "gm"; sem via, `reason` diz por que e
 * `canAsk` diz se faz sentido pedir ao Mestre.
 */
export function dockVerdict({ sameScene = true, touching = false, selfDocked = "", targetDocked = "", anyVehicle = false, tractor = false, targetShield = 0, isGm = false } = {}) {
  if (!sameScene) return { ok: false, via: "", reason: "as duas naves precisam estar na mesma cena", canAsk: false };
  if (selfDocked) return { ok: false, via: "", reason: `esta nave já está acoplada a ${selfDocked}`, canAsk: false };
  if (targetDocked) return { ok: false, via: "", reason: `o alvo já está acoplado a ${targetDocked}`, canAsk: false };
  if (!touching) return { ok: false, via: "", reason: "os Tokens das duas naves precisam estar colados", canAsk: false };
  if (isGm) return { ok: true, via: "gm", reason: "", canAsk: false };
  if (anyVehicle) return { ok: false, via: "", reason: "com um Veículo só o Mestre libera a acoplagem (não há Raio Trator)", canAsk: true };
  if (tractor) return { ok: true, via: "tractor", reason: "", canAsk: false };
  if (!(num(targetShield) > 0)) return { ok: true, via: "shield", reason: "", canAsk: false };
  return { ok: false, via: "", reason: "só acopla com o Raio Trator segurando, com o Escudo do alvo em 0 ou com o Mestre liberando", canAsk: true };
}

/** O rótulo de como a acoplagem foi permitida (aba Acoplagem). */
export function dockViaLabel(via) {
  return { tractor: "Raio Trator segurando", shield: "Escudo do alvo em 0", gm: "Mestre liberou" }[via] ?? "";
}

/* ------------------------------------------------------------------ Mover acoplada: teste resistido de propulsão */

/** O bônus de propulsão no teste: 1 a cada 20 de aceleração (um Motor padrão dá +2). */
export function propulsionBonus(acceleration) {
  return Math.floor(Math.max(0, num(acceleration)) / 20);
}

/**
 * O resultado do teste resistido (`mover` e `resister` já são os totais: d20 + bônus). Diferença até `margin` arrasta a
 * outra nave; maior arranca um pedaço de quem tirou menos e desacopla.
 * @returns {{diff:number, kind:"drag"|"tear", loser:"mover"|"resister"|null}}
 */
export function dragOutcome({ mover = 0, resister = 0, margin = 4 } = {}) {
  const diff = Math.round(num(mover) - num(resister));
  if (Math.abs(diff) <= Math.max(0, num(margin, 4))) return { diff, kind: "drag", loser: null };
  return { diff, kind: "tear", loser: diff > 0 ? "resister" : "mover" };
}

/**
 * O dano de arrancar um pedaço: `percentPerPoint`% (1) do Casco máximo (sem Casco, da Integridade) por ponto de diferença,
 * e a mesma fração da Vida máxima do Módulo do ponto de acoplamento.
 * @returns {{casco:number, module:number}}
 */
export function dragDamage({ diff = 0, cascoMax = 0, hullMax = 0, moduleHpMax = 0, percentPerPoint = 1 } = {}) {
  const points = Math.abs(Math.round(num(diff)));
  const pct = Math.max(0, num(percentPerPoint, 1)) / 100;
  const base = num(cascoMax) > 0 ? num(cascoMax) : num(hullMax);
  return { casco: Math.round(base * pct * points), module: Math.round(Math.max(0, num(moduleHpMax)) * pct * points) };
}

/* ------------------------------------------------------------------ Grupo de abordagem */

/** Põe (ou atualiza) um personagem no grupo: um por personagem. */
export function addBoarder(list, entry) {
  const uuid = String(entry?.actorUuid ?? "");
  if (!uuid) return [...(list ?? [])];
  const clean = {
    actorUuid: uuid,
    fromUuid: String(entry.fromUuid ?? ""),
    moduleId: String(entry.moduleId ?? ""),
    source: ["dock", "teleport", "region"].includes(entry.source) ? entry.source : "dock",
    tokenUuid: String(entry.tokenUuid ?? ""),
    regionUuid: String(entry.regionUuid ?? "")
  };
  const out = (list ?? []).filter(b => b?.actorUuid !== uuid).map(b => ({ ...b }));
  out.push(clean);
  return out;
}

/** Tira um personagem do grupo. */
export function removeBoarder(list, actorUuid) {
  return (list ?? []).filter(b => b?.actorUuid !== actorUuid).map(b => ({ ...b }));
}

/** Muda a sala (Módulo) de um personagem do grupo ("" = corredor). */
export function moveBoarder(list, actorUuid, moduleId) {
  return (list ?? []).map(b => (b?.actorUuid === actorUuid ? { ...b, moduleId: String(moduleId ?? "") } : { ...b }));
}

/** O texto da sala: o nome do Módulo ou "Corredor". */
export function roomLabel(moduleId, moduleName = "") {
  return moduleId && moduleName ? moduleName : "Corredor";
}

/**
 * A ação é permitida aqui? `region` = os campos do comportamento "A bordo" onde o personagem está (ou `null`: sem
 * Região, tudo o que a regra permite). Hackear é proibível (sala sem terminal).
 * @returns {{ok:boolean, reason:string}}
 */
export function actionAllowed(action, region = null) {
  if (!BOARDING_ACTIONS[action]) return { ok: false, reason: "ação desconhecida" };
  if (!region) return { ok: true, reason: "" };
  const flag = { sabotage: region.allowSabotage, disable: region.allowDisable, hack: region.allowHack }[action];
  if (flag === false) return { ok: false, reason: action === "hack" ? "esta sala não tem um terminal para Hackear" : `${BOARDING_ACTIONS[action]} não é permitido nesta sala` };
  return { ok: true, reason: "" };
}

/**
 * O dano de um Sabotar: a rolagem da arma (ou do desarmado) vezes a escala por Atributo e o bônus de arma. **Sem escala
 * de Porte, sem Escudo e sem Casco**: está nos circuitos.
 */
export function sabotageDamage({ rolled = 0, scaling = 1, multiplier = 1, flat = 0 } = {}) {
  return Math.max(0, Math.round(num(rolled) * num(scaling, 1) * num(multiplier, 1) + num(flat)));
}

/** O texto do card de pedido ao Mestre. */
export function requestCardText({ kind, actorName = "", moduleName = "", shipName = "" }) {
  const who = actorName || "Alguém";
  if (kind === "dock") return `${who} pede para acoplar a ${shipName || "outra nave"}.`;
  const verb = kind === "hack" ? "Hackear" : "Desligar";
  return `${who} quer ${verb} o Módulo ${moduleName || "(sem nome)"} de ${shipName || "outra nave"}.`;
}

/* ------------------------------------------------------------------ Abordar por teleporte */

/**
 * Pode abordar por teleporte? Precisa de contato no sensor (quando a nave que teleporta tem um sensor), alcance, e nada de
 * Interdição nem Âncora (nas duas pontas). O PEM já derruba o Módulo (ele não opera) e a Antimagia corta a Skill mágica.
 * @param {{operating?:boolean, distance?:number, range?:number, hasSensor?:boolean, seen?:boolean, interdicted?:string[], anchored?:string[], isTech?:boolean, suppressedTech?:boolean}} input
 */
export function teleportVerdict({ operating = true, distance = 0, range = 0, hasSensor = false, seen = false, interdicted = [], anchored = [] } = {}) {
  if (!operating) return { ok: false, reason: "o Teletransportador está desligado, sem energia ou sob PEM" };
  if (!(num(range) > 0)) return { ok: false, reason: "o Teletransportador não tem alcance" };
  if (num(distance, Infinity) > num(range)) return { ok: false, reason: "o alvo está fora do alcance do Teletransportador" };
  if (hasSensor && !seen) return { ok: false, reason: "o alvo não está detectado no sensor (abordar por teleporte exige ver o alvo)" };
  if (interdicted.length) return { ok: false, reason: `bloqueado pela Interdição de ${interdicted.join(", ")}` };
  if (anchored.length) return { ok: false, reason: `bloqueado pela Âncora de ${anchored.join(", ")}` };
  return { ok: true, reason: "" };
}

/* ------------------------------------------------------------------ Leitura estável dos Módulos */

/** Um gerador de números pseudoaleatório estável a partir de um texto (a mesma leitura não muda a cada redesenho). */
export function seededRng(seed) {
  let h = 1779033703 ^ String(seed ?? "").length;
  for (const ch of String(seed ?? "")) {
    h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Os Módulos inimigos como o Escanear mostrou: sem o degrau 3 o Módulo aparece "não lido"; distorcido, o estado
 * pode estar errado.
 * @param {Array<{id:string,name:string,state:string,hpPercent:number}>} modules - o estado real
 * @param {{quality:"clean"|"distorted"|"blocked", reachedStep3:boolean}} read
 * @returns {Array<{id:string,name:string,read:string,tag:"" | "pode estar errado" | "não lido"}>}
 */
export function moduleReadRows(modules, { quality = "blocked", reachedStep3 = false } = {}, rng = Math.random) {
  const labels = { online: "operante", offline: "desligado", damaged: "danificado", starved: "sem energia" };
  return (modules ?? []).map(m => {
    if (!reachedStep3 || quality === "blocked") return { id: m.id, name: m.name, read: "não lido", tag: "não lido" };
    if (quality === "distorted") {
      const wrong = rng() < 0.35;
      const keys = Object.keys(labels).filter(k => k !== m.state);
      const state = wrong ? keys[Math.min(keys.length - 1, Math.floor(rng() * keys.length))] : m.state;
      return { id: m.id, name: m.name, read: labels[state] ?? state, tag: "pode estar errado" };
    }
    const base = labels[m.state] ?? m.state;
    return { id: m.id, name: m.name, read: m.state === "damaged" ? `${base} (${Math.round(num(m.hpPercent))}%)` : base, tag: "" };
  });
}

/* ------------------------------------------------------------------ Validar Mundo */

/**
 * Problemas de um comportamento de Região "A bordo": a nave que sumiu, ou a sala que não é um Módulo dela.
 * @returns {Array<{where:string, message:string}>}
 */
export function aboardRegionIssues({ shipUuid = "", shipExists = true, roomName = "", roomFound = true } = {}) {
  const issues = [];
  if (!shipUuid) issues.push({ where: "Nave", message: "a Região \"A bordo\" não escolheu uma nave" });
  else if (!shipExists) issues.push({ where: "Nave", message: "a nave desta Região \"A bordo\" não existe mais" });
  else if (String(roomName).trim() && !roomFound) issues.push({ where: "Sala de Módulo", message: `a nave não tem um Módulo chamado "${String(roomName).trim()}" (a sala vira corredor)` });
  return issues;
}
