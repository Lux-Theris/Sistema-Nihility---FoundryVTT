/**
 * Alcance e Marcas (backlog H4, 1.89.0) — o lado Foundry. As contas são puras, em `range-rules.js`
 * (testado). Aqui: medir a distância entre Tokens, achar as Marcas de quem lança, perguntar
 * "Usar pela Marca?" e montar o contexto de alcance que a colocação de formas e Estruturas usa.
 *
 * Regras que valem em tudo:
 *  - Distância é de CENTRO a CENTRO dos Tokens, em unidades da cena (uma função só — `measureActorDistance` —
 *    para o J4, voo e altura, somar a elevação depois).
 *  - Sem mapa, ou sem Token de um dos lados (teatro da mente, alvo fora da cena), nada é conferido.
 *  - Recurso desligado (`FEATURES.skillRange`): nada é conferido, e nenhuma Marca vale.
 *  - Uma Marca é um Active Effect com o flag `markedBy` (uuid de quem marcou); só quem marcou a usa.
 */
import { SYSTEM_ID, actorToken, isSkillRangeEnabled, getFeatureOption, getEnergyLabelForActor } from "../core/config.js";
import { escapeHtml } from "../helpers/html.js";
import {
  inRange,
  markedCost,
  marksReaching,
  placementVia,
  pointDistance,
  throwRange,
  outOfRangeMessage,
  meters,
  normalizeRange
} from "./range-rules.js";

/** Há cena aberta e o recurso está ligado? */
export function rangeChecksActive() {
  return isSkillRangeEnabled() && Boolean(typeof canvas !== "undefined" && canvas?.ready && canvas.scene);
}

/** Pixels por unidade (metro) da cena aberta. */
export function pxPerUnit(scene = canvas?.scene) {
  const size = Number(scene?.grid?.size) || 100;
  const distance = Number(scene?.grid?.distance) || 1;
  return size / distance;
}

/** O Token de quem lança (o selecionado, se houver). */
export function casterTokenOf(actor) {
  return actorToken(actor, canvas?.tokens?.controlled ?? []);
}

/** O Token do alvo (o marcado com T, se houver). */
export function targetTokenOf(actor) {
  return actorToken(actor, [...(game.user?.targets ?? [])]);
}

/** Distância entre dois pontos de pixel, em unidades da cena. */
export function measurePointDistance(a, b) {
  return pointDistance(a, b) / pxPerUnit();
}

/**
 * Distância de centro a centro entre dois Atores, em unidades da cena (metros), ou `null` quando não
 * dá para medir (sem cena, ou um dos dois sem Token nela). Único ponto de medida do sistema.
 */
export function measureActorDistance(a, b) {
  if (!canvas?.ready || !canvas.scene) return null;
  const from = casterTokenOf(a)?.center;
  const to = targetTokenOf(b)?.center;
  if (!from || !to) return null;
  return measurePointDistance(from, to);
}

/** O alcance de arremesso de quem lança: base + ⌊Força ÷ passo⌋ (passo = opção do recurso). */
export function throwRangeFor(actor, base) {
  const strength = Number(actor?.system?.attributes?.combat?.strength?.total) || 0;
  return throwRange(base, strength, getFeatureOption("skillRange", "throwPerStrength"));
}

/* ------------------------------------------------------------------ Marcas */

/** O Active Effect de Marca de `casterUuid` neste Ator (ainda ligado), ou null. */
export function markEffectOn(actor, casterUuid) {
  return actor?.effects?.find(e => !e.disabled && e.getFlag?.(SYSTEM_ID, "markedBy") === casterUuid) ?? null;
}

/**
 * As Marcas de `caster` com Token na cena aberta: `[{uuid, name, point: {x, y}}]` (ponto em pixels).
 * Quem lança nunca é Marca dele mesmo. Vazio com o recurso desligado ou sem mapa.
 */
export function marksOf(caster) {
  if (!rangeChecksActive() || !caster) return [];
  const out = [];
  const seen = new Set();
  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor;
    if (!actor || seen.has(actor.uuid) || actor.uuid === caster.uuid) continue;
    if (!markEffectOn(actor, caster.uuid)) continue;
    seen.add(actor.uuid);
    out.push({ uuid: actor.uuid, name: token.name || actor.name, point: { x: token.center.x, y: token.center.y } });
  }
  return out;
}

/** A Marca ainda existe (o Ator marcado ainda tem o efeito de quem lança)? E onde ele está agora. */
export function refreshMark(casterUuid, markUuid) {
  let actor = null;
  try {
    actor = fromUuidSync(markUuid);
  } catch {
    actor = null;
  }
  if (!actor || !markEffectOn(actor, casterUuid)) return null;
  const token = actor.isToken ? actor.token?.object : actor.getActiveTokens?.()?.[0];
  return { uuid: actor.uuid, name: token?.name || actor.name, point: token?.center ? { x: token.center.x, y: token.center.y } : null };
}

/* ------------------------------------------------------------------ Diálogos */

function askButtons(title, content, buttons) {
  return foundry.applications.api.DialogV2.wait({ window: { title }, content, buttons, rejectClose: false });
}

const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);

/** "20 → 80 (×4)" ou "sem custo". */
function costText(baseCost, factor) {
  const base = Math.max(0, Math.ceil(Number(baseCost) || 0));
  if (!base) return "sem custo";
  return `custo ${base} → ${markedCost(base, factor)} (×${String(factor).replace(".", ",")})`;
}

/**
 * Pergunta se lança pela Marca (várias podem servir: escolhe). Conteúdo num <div>, nunca <form>.
 * @param {object} args
 * @param {string} args.title
 * @param {string} args.intro  texto de cima ("Fora do alcance (40 m de 10 m).")
 * @param {Array<{uuid, name, factor}>} args.options
 * @param {number} args.baseCost  Custo normal (em Mana/energia), para mostrar o aumento
 * @param {boolean} [args.gmOverride]  oferece "Usar mesmo assim" (Mestre)
 * @returns {Promise<null|{kind: "mark", uuid: string}|{kind: "override"}>}
 */
async function askMark({ title, intro, options, baseCost, gmOverride = false }) {
  const rows = options
    .map((m, i) => `<option value="${escapeHtml(m.uuid)}" ${i === 0 ? "selected" : ""}>${escapeHtml(m.name)} — ${escapeHtml(costText(baseCost, m.factor))}</option>`)
    .join("");
  const body = options.length
    ? `<p>${escapeHtml(intro)}</p><div class="form-group"><label>Usar pela Marca em</label><select name="mark">${rows}</select></div>`
    : `<p>${escapeHtml(intro)}</p>`;
  const buttons = [];
  if (options.length) {
    buttons.push({ action: "mark", label: "Usar pela Marca", default: true, callback: (event, button, dialog) => ({ kind: "mark", uuid: dialog.element.querySelector("[name=mark]")?.value ?? options[0].uuid }) });
  }
  if (gmOverride) buttons.push({ action: "override", label: "Usar mesmo assim", default: !options.length, callback: () => ({ kind: "override" }) });
  buttons.push({ action: "cancel", label: "Cancelar", callback: () => false });
  const answer = await askButtons(title, `<div class="nihility-range-dialog">${body}</div>`, buttons);
  return answer && answer.kind ? answer : null;
}

/** Confirma o custo de uma colocação feita pela Marca (formas, Zona, Estrutura). true = segue. */
export async function confirmMarkCost({ title, via, baseCost, actor }) {
  const energy = actor ? getEnergyLabelForActor(actor) : "Mana";
  const answer = await askButtons(
    title,
    `<div class="nihility-range-dialog"><p>Usar pela Marca em <strong>${escapeHtml(via.name)}</strong> (${escapeHtml(meters(via.distance ?? 0))} de quem lança).</p><p>${escapeHtml(costText(baseCost, via.factor))}${Number(baseCost) > 0 ? ` de ${escapeHtml(energy)}` : ""}.</p></div>`,
    [
      { action: "ok", label: "Usar pela Marca", default: true, callback: () => true },
      { action: "cancel", label: "Cancelar", callback: () => false }
    ]
  );
  return answer === true;
}

/* ------------------------------------------------------------------ Alvo único */

/**
 * Alvo único de Skill: dentro do alcance (ou sem como medir) passa direto. Fora: com Marca servindo,
 * pergunta "Usar pela Marca?"; sem Marca, recusa ("fora do alcance: 40 m de 10 m"). O Mestre ainda
 * ganha "Usar mesmo assim" (ignora o alcance, custo normal).
 * @returns {Promise<{ok: boolean, viaMark: object|null}>}
 */
export async function resolveTargetReach(caster, target, mech, { label, baseCost = 0 } = {}) {
  const range = normalizeRange(mech?.range);
  if (!rangeChecksActive() || range <= 0 || mech?.targetType === "self") return { ok: true, viaMark: null };
  const from = casterTokenOf(caster)?.center;
  const to = targetTokenOf(target)?.center;
  if (!from || !to) return { ok: true, viaMark: null };

  const distance = measurePointDistance(from, to);
  if (inRange(distance, range)) return { ok: true, viaMark: null };

  const scale = pxPerUnit();
  const reaching = marksReaching(marksOf(caster), to, from, range * scale);
  const options = reaching.map(m => ({ ...m, distanceUnits: m.distance / scale }));
  const isGm = Boolean(game.user?.isGM);
  const intro = `${capitalize(outOfRangeMessage(distance, range))}.`;
  if (!options.length && !isGm) {
    ui.notifications.warn(`${label ? `${label}: ` : ""}${outOfRangeMessage(distance, range)}.`);
    return { ok: false, viaMark: null };
  }
  const choice = await askMark({ title: label ? `Alcance — ${label}` : "Alcance", intro, options, baseCost, gmOverride: isGm });
  if (!choice) return { ok: false, viaMark: null };
  if (choice.kind === "override") return { ok: true, viaMark: null };
  const picked = options.find(m => m.uuid === choice.uuid) ?? options[0];
  return {
    ok: true,
    viaMark: { markUuid: picked.uuid, name: picked.name, factor: picked.factor, distance: picked.distanceUnits, origin: { x: picked.point.x, y: picked.point.y } }
  };
}

/**
 * Alcance simples (arma, arremesso): sem Marca. Fora do alcance recusa; o Mestre pode "usar mesmo
 * assim". Sem como medir, passa. `range` em unidades da cena (metros).
 * @returns {Promise<boolean>}
 */
export async function checkFlatRange(caster, target, range, { label = "" } = {}) {
  const r = normalizeRange(range);
  if (!rangeChecksActive() || r <= 0) return true;
  const distance = measureActorDistance(caster, target);
  if (distance === null || inRange(distance, r)) return true;
  const text = `${label ? `${label}: ` : ""}${outOfRangeMessage(distance, r)}.`;
  if (!game.user?.isGM) {
    ui.notifications.warn(text);
    return false;
  }
  const choice = await askMark({ title: label ? `Alcance — ${label}` : "Alcance", intro: `${capitalize(outOfRangeMessage(distance, r))}.`, options: [], baseCost: 0, gmOverride: true });
  return choice?.kind === "override";
}

/* ------------------------------------------------------------------ Formas, Zonas e Estruturas */

/**
 * O contexto de alcance que `placeArea`/`pickStructurePlacement` usam, ou `null` quando nada vale
 * (recurso desligado, sem mapa, ou quem lança sem Token).
 *  - `anchor`: centro do Token de quem lança (pixels);
 *  - `rangePx`: alcance em pixels (0 = sem limite);
 *  - `centers`: as Marcas (`[{uuid, name, point}]`), vazio quando `marks` é falso ou sem alcance;
 *  - `free`: a forma pode ser posta onde quiser (dentro do alcance); falso = presa em quem lança.
 */
export function reachContext(caster, { range = 0, free = true, marks = true } = {}) {
  if (!rangeChecksActive() || !caster) return null;
  const token = casterTokenOf(caster);
  if (!token?.center) return null;
  const r = normalizeRange(range);
  const rangePx = r * pxPerUnit();
  return {
    caster,
    anchor: { x: token.center.x, y: token.center.y },
    range: r,
    rangePx,
    free: Boolean(free),
    centers: marks && rangePx > 0 ? marksOf(caster) : []
  };
}

/**
 * Onde um ponto cai: direto (dentro do alcance de quem lança), pela Marca mais barata, ou fora.
 * @returns {{via: null|object}|null}
 */
export function pointReach(reach, point) {
  if (!reach || reach.rangePx <= 0) return { via: null };
  return placementVia(point, reach.anchor, reach.centers, reach.rangePx);
}

/** Dá à Marca escolhida o formato que `useSkillEffect` leva em `options.viaMark`. */
export function viaMarkFrom(via, reach) {
  if (!via) return null;
  const scale = pxPerUnit();
  return { markUuid: via.uuid, name: via.name, factor: via.factor, distance: via.distance / scale, origin: { x: via.point.x, y: via.point.y }, reach: Boolean(reach) };
}
