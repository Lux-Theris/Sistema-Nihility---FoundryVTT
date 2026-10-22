/**
 * Radiação do Ambiente — lê as fontes e aplica. Regras puras em radiation-rules.js; bloco
 * `FEATURES.radiation` (filho de `environment`).
 *
 *  - Fontes: `radiation` no ambiente da cena (janela Ambiente da Cena), `radiation` no comportamento
 *    "Ambiente (Nihility)" de uma Region, e Tokens com a flag `radiationSource: {level, radius}`
 *    (botão ☢ no HUD do Token, só o Mestre). Um Token não irradia a si mesmo.
 *  - A irradiação de cada Personagem vive num Active Effect "Irradiado (N)" (flag `radiation.level`,
 *    status `irradiated`, ícone no Token). Nível 0 = o efeito some. O Mestre apagar o efeito zera.
 *  - Em combate: no início do turno do Personagem (`updateCombat`), uma rodada de `radiationStep`
 *    e o dano do nível novo. Fora de combate: "Passar tempo" (Ambiente da Cena) faz N rodadas de uma
 *    vez para todos os Personagens da cena (`passRadiationTime`).
 *  - Dano: direto na Vida (como um tick, não passa pelo Escudo), reduzido por Resistência Geral e
 *    pela Resistência ao elemento "Radiação", se ele existir no catálogo de Tipos de Dano.
 *  - Só o Mestre designado escreve.
 */
import { SYSTEM_ID, isFeatureEnabled, getFeatureOption, getDamageElement, RADIATION_ELEMENT } from "../core/config.js";
import { isDesignatedGm } from "../helpers/gm-relay.js";
import { sceneScale } from "../combat/area-effects.js";
import { tokenDocCenter } from "../combat/area-geometry.js";
import { sceneEnvironment, areaBehaviors } from "./environment.js";
import { normalizeRadiationSource, totalExposure, radiationStep, radiationDamage, simulateRadiation } from "./radiation-rules.js";

const FLAG_SOURCE = "radiationSource";
const STATUS = "irradiated";
const ICON = "icons/svg/radiation.svg";

export function isRadiationEnabled() {
  return isFeatureEnabled("radiation");
}

export function radiationConfig() {
  return {
    gainPercent: getFeatureOption("radiation", "radiationGainPercent") ?? 20,
    decayPercent: getFeatureOption("radiation", "radiationDecayPercent") ?? 10,
    perLevel: getFeatureOption("radiation", "radiationDamagePerLevel") ?? 1
  };
}

/** A fonte que um Token emite, ou null. */
export function tokenRadiationSource(tokenDoc) {
  return normalizeRadiationSource(tokenDoc?.getFlag?.(SYSTEM_ID, FLAG_SOURCE));
}

/** Nível de radiação onde o Token está: cena + áreas + Tokens emissores (menos ele mesmo). */
export function exposureAt(tokenDoc) {
  const scene = tokenDoc?.parent;
  if (!scene) return 0;
  const { pxPerUnit } = sceneScale(scene);
  const gridSize = scene.grid?.size;
  const here = tokenDocCenter(tokenDoc, gridSize);
  const emitters = [];
  for (const other of scene.tokens) {
    if (other.id === tokenDoc.id) continue;
    const source = tokenRadiationSource(other);
    if (!source) continue;
    const there = tokenDocCenter(other, gridSize);
    const distance = Math.hypot(here.x - there.x, here.y - there.y) / (pxPerUnit || 1);
    emitters.push({ level: source.level, radius: source.radius, distance });
  }
  return totalExposure({
    scene: sceneEnvironment(scene).radiation ?? 0,
    areas: areaBehaviors(tokenDoc).map(b => Number(b.system?.radiation) || 0),
    emitters
  });
}

/** O efeito "Irradiado" do Ator, se houver. */
export function radiationEffect(actor) {
  return actor?.effects?.find(e => e.getFlag(SYSTEM_ID, "radiation")) ?? null;
}

export function radiationLevel(actor) {
  return Math.max(0, Number(radiationEffect(actor)?.getFlag(SYSTEM_ID, "radiation")?.level) || 0);
}

/** Grava a irradiação: cria, renomeia ou apaga o efeito "Irradiado (N)". */
async function setRadiationLevel(actor, level) {
  const effect = radiationEffect(actor);
  if (level <= 0) {
    if (effect) await effect.delete();
    return;
  }
  const name = `Irradiado (${level})`;
  if (effect) {
    await effect.update({ name, [`flags.${SYSTEM_ID}.radiation.level`]: level });
    return;
  }
  await actor.createEmbeddedDocuments(
    "ActiveEffect",
    [{ name, img: ICON, statuses: [STATUS], flags: { [SYSTEM_ID]: { radiation: { level } } } }],
    { nihilityConfigured: true }
  );
}

/**
 * Dano de radiação direto na Vida, com Resistência Geral e à Radiação (se o elemento existe).
 * Devolve o dano que entrou.
 */
async function applyRadiationDamage(actor, rawDamage) {
  if (rawDamage <= 0) return 0;
  const hp = actor.system?.attributes?.hp;
  if (!hp) return 0;
  const { applyDamageReductions } = await import("../combat/damage-roll.js");
  const elements = getDamageElement(RADIATION_ELEMENT.id) ? [RADIATION_ELEMENT.id] : [];
  const reduction = applyDamageReductions(rawDamage, { damageElements: elements }, actor, { skipMagicDefense: true, triggerConditions: false });
  const damage = Math.max(0, Math.floor(reduction.finalDamage));
  if (!damage) return 0;
  try {
    const { grantResistanceXp } = await import("../combat/resistance.js");
    await grantResistanceXp(reduction.defenders, actor);
  } catch (err) {
    /* XP de Resistência é bônus; nunca derruba o tick */
  }
  await actor.update({ "system.attributes.hp.value": Math.max(0, hp.value - damage) });
  return damage;
}

/**
 * Uma rodada de radiação para o Ator do Token (início do turno dele em combate).
 */
export async function tickRadiation(tokenDoc) {
  if (!isDesignatedGm() || !isRadiationEnabled() || !tokenDoc?.parent) return;
  const actor = tokenDoc.actor;
  if (!actor || actor.type !== "character") return;
  const current = radiationLevel(actor);
  const exposure = exposureAt(tokenDoc);
  if (!current && !exposure) return;
  const config = radiationConfig();
  const next = radiationStep(current, exposure, config);
  await setRadiationLevel(actor, next);
  await applyRadiationDamage(actor, radiationDamage(next, config.perLevel));
}

/**
 * "Passar tempo" fora de combate: N rodadas de uma vez para cada Personagem com Token na cena
 * (um Ator com vários Tokens conta uma vez, no primeiro). Cartão só para o Mestre com o resumo.
 */
export async function passRadiationTime(scene, rounds) {
  if (!game.user.isGM || !isRadiationEnabled() || !scene) return [];
  const n = Math.max(0, Math.floor(Number(rounds) || 0));
  if (!n) return [];
  const config = radiationConfig();
  const seen = new Set();
  const rows = [];
  for (const token of scene.tokens) {
    const actor = token.actor;
    if (!actor || actor.type !== "character" || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    const before = radiationLevel(actor);
    const exposure = exposureAt(token);
    if (!before && !exposure) continue;
    const { level, damage } = simulateRadiation(before, exposure, n, config);
    await setRadiationLevel(actor, level);
    const dealt = await applyRadiationDamage(actor, damage);
    rows.push({ name: token.name || actor.name, before, after: level, exposure, damage: dealt });
  }
  const esc = foundry.utils.escapeHTML;
  const body = rows.length
    ? `<ul>${rows.map(r => `<li><strong>${esc(r.name)}</strong>: irradiação ${r.before} → ${r.after} (lugar ${r.exposure}) · −${r.damage} Vida</li>`).join("")}</ul>`
    : "<p>Ninguém nesta cena está exposto nem irradiado.</p>";
  await ChatMessage.create({
    content: `<div class="nihility-radiation-card"><p><i class="fas fa-radiation"></i> <strong>Passaram ${n} rodada(s)</strong> em ${esc(scene.name)}.</p>${body}</div>`,
    whisper: game.users.filter(u => u.isGM).map(u => u.id)
  });
  return rows;
}

/* ------------------------------------------------------------------ Token emissor (HUD) */

async function editTokenSource(tokenDoc) {
  const current = tokenRadiationSource(tokenDoc) ?? { level: 0, radius: 0 };
  const units = tokenDoc.parent?.grid?.units || "m";
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `Radiação — ${tokenDoc.name}`, icon: "fa-solid fa-radiation" },
    classes: ["nihility-condition-dialog"],
    content: `<div class="nihility-radiation-source">
      <p class="hint">Quem chega perto vai sendo irradiado. Colado no Token = nível cheio; na borda do raio = nada. Nível 0 = não emite.</p>
      <div class="form-group"><label>Nível</label><input type="number" name="level" min="0" step="1" value="${current.level}"/></div>
      <div class="form-group"><label>Raio (${units})</label><input type="number" name="radius" min="0" step="0.5" value="${current.radius}"/></div>
    </div>`,
    buttons: [
      {
        action: "save",
        label: "Salvar",
        default: true,
        callback: (event, button, dialog) => ({
          level: Number(dialog.element.querySelector("[name=level]").value) || 0,
          radius: Number(dialog.element.querySelector("[name=radius]").value) || 0
        })
      },
      { action: "cancel", label: "Cancelar" }
    ],
    rejectClose: false
  });
  if (!result || typeof result !== "object") return;
  const source = normalizeRadiationSource(result);
  if (source) await tokenDoc.setFlag(SYSTEM_ID, FLAG_SOURCE, source);
  else await tokenDoc.unsetFlag(SYSTEM_ID, FLAG_SOURCE);
}

/** Botão ☢ no HUD do Token (coluna da esquerda), só para o Mestre com o bloco ligado. */
function addHudButton(hud, html) {
  if (!game.user.isGM || !isRadiationEnabled()) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const column = root?.querySelector(".col.left");
  const tokenDoc = hud.object?.document;
  if (!column || !tokenDoc || column.querySelector(".nihility-radiation-hud")) return;
  const source = tokenRadiationSource(tokenDoc);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `control-icon nihility-radiation-hud${source ? " active" : ""}`;
  button.dataset.tooltip = source ? `Emite radiação ${source.level} (raio ${source.radius})` : "Emitir radiação";
  button.innerHTML = '<i class="fa-solid fa-radiation"></i>';
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    editTokenSource(tokenDoc);
  });
  column.appendChild(button);
}

export function registerRadiation() {
  Hooks.on("renderTokenHUD", addHudButton);
}
