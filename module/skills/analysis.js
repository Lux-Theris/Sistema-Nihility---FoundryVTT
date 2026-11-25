import {
  SYSTEM_ID, NIHILITY, isVesselsEnabled, isShipSensorsEnabled, isAnalysisEnabled, isMagicUse, getAnalysisAttrStep, getActiveSpeciesPresets, getActiveHeritages, getActiveTraits, getActiveDamageElements,
  getDamageElement, damageElementChain, getElementAffinityMatrix, getAffinityConfig, actorElements, actorTraits, actorConcealment, getVisibleAttributes, getEnergyLabelForActor
} from "../core/config.js";
import { chainedResistance, elementVsDefender } from "../combat/damage-rules.js";
import { magicDefenseReduction, resistanceSourceFor } from "../combat/resistance.js";
import { netResistance } from "../species/species-rules.js";
import { escapeHtml } from "../helpers/html.js";
import { skillSummariesFor } from "./skill-summary-ui.js";
import { grantSkillUseXp } from "./skill-xp.js";
import { isShipLike } from "../starship/ship-damage.js";
import { actorHiddenBySensors, scanShipReading, scanReadingHtml, analysisShipResolution } from "../starship/sensors.js";
import { analysisMargin, analysisTier, analysisSections, analysisTierLabel, weaknessRows, resistanceRows, resistanceText } from "./analysis-rules.js";

/**
 * Análise (7b.1): Mecânica de Skill "Analisar". Quem analisa compara o nível da Skill com o do alvo (mais a
 * Ocultação dele), a Percepção com a Furtividade e, se a Análise é mágica, a Defesa Mágica do alvo; a margem
 * decide quanto da ficha do alvo o card mostra. O card é sussurrado a quem analisou e ao Mestre. Regras
 * puras em analysis-rules.js. Passa pelo fluxo normal de uso (custo, alcance, campos, Supressão).
 */

/** Por que este alvo não pode ser analisado, ou null. */
export function analysisBlockReason(targetActor) {
  if (!isAnalysisEnabled()) return "O bloco Análise está desligado nesta mesa.";
  if (!targetActor) return "Escolha um alvo para analisar.";
  if (isShipLike(targetActor)) {
    // F1: Nave/Veículo também podem ser analisados (a leitura em degraus do Escanear); precisa estar detectada.
    if (!isVesselsEnabled() || !isShipSensorsEnabled()) return `${targetActor.name} não pode ser analisado (o bloco Sensores de nave está desligado).`;
    if (actorHiddenBySensors(targetActor)) return `${targetActor.name} não está detectada pelos sensores.`;
    return null;
  }
  if (targetActor.type !== "character") return `${targetActor.name} não pode ser analisado (só Personagens, Naves e Veículos).`;
  return null;
}

/** O número `total` de um atributo de combate. */
const attrTotal = (actor, key) => Number(actor?.system?.attributes?.combat?.[key]?.total) || 0;

/** A margem desta Análise sobre este alvo, com as parcelas (para o card e para quem testa). */
export function computeAnalysis(sourceActor, mech, targetActor) {
  const magic = isMagicUse(mech, sourceActor);
  const reduction = magic ? magicDefenseReduction(targetActor) : 0;
  const concealment = actorConcealment(targetActor).level;
  const targetLevel = Number(targetActor.system?.attributes?.level) || 0;
  const perception = attrTotal(sourceActor, "perception");
  const stealth = attrTotal(targetActor, "stealth");
  const margin = analysisMargin({
    level: Number(mech.level) || 0,
    magic,
    magicDefenseReduction: reduction,
    targetLevel,
    concealment,
    perception,
    stealth,
    step: getAnalysisAttrStep()
  });
  return { margin, tier: analysisTier(margin), magic, reduction, concealment, targetLevel, perception, stealth };
}

/* ------------------------------------------------------------------ O que o card revela */

const labelOf = (list, id) => (list ?? []).find(entry => entry?.id === id)?.label ?? id;

function originLines(target) {
  const presets = getActiveSpeciesPresets();
  const speciesId = target.system?.species;
  const species = speciesId ? presets?.[speciesId] : null;
  const lineage = species && target.system?.lineage ? (species.lineages ?? []).find(l => l.id === target.system.lineage) : null;
  const heritages = (target.system?.heritages ?? []).map(h => labelOf(getActiveHeritages(), h.id));
  return { species: species?.label ?? speciesId ?? "", lineage: lineage?.label ?? "", heritages };
}

function conditionNames(target) {
  const names = [];
  for (const effect of target.effects ?? []) {
    if (effect.disabled) continue;
    if (effect.statuses?.size) names.push(effect.name);
  }
  return [...new Set(names.filter(Boolean))];
}

/** Resistências efetivas por elemento: só os que o alvo tem por fonte própria, com a cadeia (Físico › Cortante). */
function resistanceData(target) {
  const general = resistanceSourceFor(target, "general").percent;
  const rows = [];
  for (const element of getActiveDamageElements()) {
    if (!(resistanceSourceFor(target, element.id).percent > 0)) continue;
    const chain = damageElementChain(element.id).map(el => el.id);
    const percent = chainedResistance((chain.length ? chain : [element.id]).map(id => resistanceSourceFor(target, id).percent));
    rows.push({ id: element.id, percent });
  }
  return { general, elements: resistanceRows(rows) };
}

function weaknessData(target) {
  const body = actorElements(target);
  if (!body.length) return [];
  const matrix = getElementAffinityMatrix();
  const config = getAffinityConfig();
  return weaknessRows(getActiveDamageElements().map(el => ({ id: el.id, factor: elementVsDefender(el.id, body, matrix, config) })));
}

/** O que o degrau revela, já em texto simples (escapado só ao montar o HTML). */
export function gatherAnalysis(target, sections) {
  const out = [];
  const has = id => sections.includes(id);
  if (has("origin")) {
    const o = originLines(target);
    const text = [o.species, o.lineage, ...o.heritages].filter(Boolean).join(" · ");
    out.push({ title: "Origem", lines: [text || "Sem Espécie"] });
  }
  if (has("traits")) {
    const traits = actorTraits(target).map(id => labelOf(getActiveTraits(), id));
    out.push({ title: "Traços", lines: [traits.length ? traits.join(", ") : "Nenhum"] });
  }
  if (has("elements")) {
    const elements = actorElements(target).map(id => getDamageElement(id)?.label ?? id);
    out.push({ title: "Elementos do corpo", lines: [elements.length ? elements.join(", ") : "Nenhum"] });
  }
  if (has("vitals")) {
    const a = target.system.attributes;
    out.push({
      title: "Vida e energia",
      lines: [`Vida ${a.hp.value}/${a.hp.max}`, `${getEnergyLabelForActor(target)} ${a.energy.value}/${a.energy.max}`, ...(a.shield?.value > 0 ? [`Escudo ${a.shield.value}`] : [])]
    });
  }
  if (has("conditions")) {
    const names = conditionNames(target);
    out.push({ title: "Condições ativas", lines: [names.length ? names.join(", ") : "Nenhuma"] });
  }
  if (has("resistances")) {
    const r = resistanceData(target);
    const lines = [];
    if (r.general > 0) lines.push(`Geral: ${resistanceText(r.general)}`);
    for (const row of r.elements) lines.push(`${getDamageElement(row.id)?.label ?? row.id}: ${resistanceText(row.percent)}`);
    out.push({ title: "Resistências e Imunidades", lines: lines.length ? lines : ["Nenhuma"] });
  }
  if (has("weaknesses")) {
    const lines = weaknessData(target).map(row => `${getDamageElement(row.id)?.label ?? row.id} (×${Math.round(row.factor * 100) / 100})`);
    // Fraquezas da origem (valor negativo na Espécie/Linhagem/Herança), já descontadas das resistências.
    for (const el of getActiveDamageElements()) {
      const src = resistanceSourceFor(target, el.id);
      if (!(src.weakness > 0)) continue;
      const net = netResistance(src.percent, src.weakness);
      if (net < 0) lines.push(`${el.label} (leva +${Math.round(-net * 100)}%)`);
    }
    out.push({ title: "Fraquezas", lines: lines.length ? [lines.join(", ")] : ["Nenhuma"] });
  }
  if (has("skills")) {
    const sentences = has("skillSentences") ? skillSummariesFor(target) : {};
    const lines = target.items
      .filter(i => i.type === "skill")
      .map(skill => `${skill.name} (${NIHILITY.SKILL_TIER_LABELS[skill.system.tier] ?? skill.system.tier})${sentences[skill.id] ? ` — ${sentences[skill.id]}` : ""}`);
    out.push({ title: "Habilidades", lines: lines.length ? lines : ["Nenhuma"], list: true });
  }
  if (has("attributes")) {
    out.push({ title: "Atributos", lines: [getVisibleAttributes().map(a => `${a.label} ${attrTotal(target, a.key)}`).join(" · ")] });
  }
  return out;
}

function cardHtml(sourceActor, target, label, result, blocks) {
  const head = `<strong>${escapeHtml(sourceActor.name)}</strong> analisa <strong>${escapeHtml(target.name)}</strong> (${escapeHtml(label)}).`;
  if (result.tier < 1) {
    return `<div class="nihility-analysis"><p>${head}</p><p><strong>${escapeHtml(target.name)}</strong> resistiu à análise: a margem foi ${result.margin}.</p></div>`;
  }
  const sections = blocks
    .map(block => {
      const body = block.list
        ? `<ul>${block.lines.map(l => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
        : block.lines.map(l => `<p>${escapeHtml(l)}</p>`).join("");
      return `<section><h4>${escapeHtml(block.title)}</h4>${body}</section>`;
    })
    .join("");
  return `<div class="nihility-analysis"><p>${head}</p><p class="hint-inline">Margem ${result.margin >= 0 ? "+" : ""}${result.margin} · ${escapeHtml(analysisTierLabel(result.tier))}</p>${sections}</div>`;
}

/**
 * Análise de uma Nave/Veículo (F1): a Resolução vem do nível da Skill mais a Percepção e a leitura sai em degraus
 * (`buildScanReading`), distorcida ou bloqueada pelo Escudo, pela blindagem e pelo Bloqueio de varredura do alvo.
 * Mesmo card sussurrado a quem analisou e ao Mestre. O XP fixo só sai quando a leitura passa do degrau 1.
 */
async function useShipAnalysis(sourceActor, skill, mech, label, targetActor) {
  const reading = scanShipReading(targetActor, { resolution: analysisShipResolution(sourceActor, mech), exact: false });
  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
  const ownerIds = game.users.filter(u => !u.isGM && sourceActor.testUserPermission(u, "OWNER")).map(u => u.id);
  // O Mestre vê os números reais no card dele? O card é um só: o do jogador (o Mestre abre a ficha da nave se quiser o real).
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    whisper: Array.from(new Set([...gmIds, ...ownerIds])),
    content: scanReadingHtml(reading, { observerName: sourceActor.name, targetName: targetActor.name, via: label }),
    flags: { [SYSTEM_ID]: { analysis: { targetUuid: targetActor.uuid, quality: reading.quality, margin: reading.margin } } }
  });
  if (reading.quality !== "blocked") await grantSkillUseXp(skill, [{ flat: true }]);
  return true;
}

/**
 * Usa a Análise: calcula, monta o card (sussurrado a quem analisou e aos Mestres) e credita o XP fixo.
 * Devolve true (saiu) ou false (alvo inválido).
 */
export async function useAnalysis(sourceActor, skill, mech, label, targetActor) {
  const reason = analysisBlockReason(targetActor);
  if (reason) {
    ui.notifications?.warn(reason);
    return false;
  }
  if (isShipLike(targetActor)) return useShipAnalysis(sourceActor, skill, mech, label, targetActor);
  const result = computeAnalysis(sourceActor, mech, targetActor);
  const blocks = result.tier >= 1 ? gatherAnalysis(targetActor, analysisSections(result.tier)) : [];
  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
  const ownerIds = game.users.filter(u => !u.isGM && sourceActor.testUserPermission(u, "OWNER")).map(u => u.id);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    whisper: Array.from(new Set([...gmIds, ...ownerIds])),
    content: cardHtml(sourceActor, targetActor, label, result, blocks),
    flags: { [SYSTEM_ID]: { analysis: { targetUuid: targetActor.uuid, margin: result.margin, tier: result.tier } } }
  });
  if (result.tier >= 1) await grantSkillUseXp(skill, [{ flat: true }]);
  return true;
}
