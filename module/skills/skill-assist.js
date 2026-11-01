/**
 * Editor de Skill assistido (canvas "Editor de Skill Assistido"): junta os avisos (L8,
 * skill-lint-rules.js), o custo sugerido (L9, skill-cost-rules.js) e os Modelos (L7,
 * skill-template-rules.js) com os catálogos do mundo, para a ficha da Skill e o editor rápido.
 * As regras são puras; aqui só se lê o mundo e se monta HTML.
 */
import {
  MEU_SISTEMA,
  isFeatureEnabled,
  getActiveStatusConditions,
  getActiveDamageElements,
  getStructures,
  getEffectTargetLabels,
  getAttributeLabel,
  getEnergyLabelForActor,
  getCharacterEnergyLabel,
  getSkillCostManaPerPoint,
  getActiveSkillTemplates
} from "../core/config.js";
import { lintSkill, lintIndex } from "./skill-lint-rules.js";
import { suggestSkillCost, costCloseEnough, holderLine } from "./skill-cost-rules.js";
import { templateSkillData } from "./skill-template-rules.js";
import { skillSummary } from "./skill-summary.js";
import { escapeHtml } from "../helpers/html.js";

/** "Nave" ou "Personagem" (ou null sem ficha). */
function actorKind(actor) {
  if (!actor) return null;
  return actor.type === "starship" || actor.type === "vehicle" ? "ship" : "character";
}

/** Mana máxima (Personagem) ou Bateria máxima (Nave) de quem tem a Skill. */
function energyMaxOf(actor) {
  if (!actor) return null;
  if (actorKind(actor) === "ship") return Number(actor.system?.powerGrid?.capacitor?.max) || null;
  const max = Number(actor.system?.attributes?.energy?.max);
  return Number.isFinite(max) && max > 0 ? max : null;
}

function validFormula(formula) {
  try {
    return Roll.validate(formula);
  } catch (err) {
    return false;
  }
}

/** Catálogos do mundo, no formato que as regras puras pedem. */
export function worldCatalogs() {
  return {
    conditions: getActiveStatusConditions().map(c => c.id),
    elements: getActiveDamageElements().map(e => e.id),
    structures: getStructures().map(s => s.id)
  };
}

/**
 * Tudo que a ficha/editor mostra de uma Skill: avisos (por aba e por card) e as sugestões de
 * custo. `enabled: false` com o bloco desligado.
 * @param {object} mech - `item.system` ou os dados do editor rápido
 * @param {{actor?: Actor|null}} [options]
 */
export function skillAssist(mech, { actor = null } = {}) {
  if (!isFeatureEnabled("skillAssist")) return { enabled: false, warnings: [], byTab: {}, byEffect: {} };
  const catalogs = worldCatalogs();
  const energyMax = energyMaxOf(actor);
  const energyLabel = actor ? getEnergyLabelForActor(actor) : getCharacterEnergyLabel();
  const warnings = lintSkill(mech, {
    conditions: catalogs.conditions,
    elements: catalogs.elements,
    structures: catalogs.structures,
    actorType: actorKind(actor),
    energyMax,
    validFormula,
    energyLabel
  });
  const { byTab, byEffect } = lintIndex(warnings);
  const conditions = getActiveStatusConditions();
  const structures = getStructures();
  const suggestion = suggestSkillCost(mech, {
    manaPerPoint: getSkillCostManaPerPoint(),
    structureHp: id => structures.find(s => s.id === id)?.hp ?? 0,
    conditionLabel: id => conditions.find(c => c.id === id)?.label ?? id,
    targetLabel: key => getEffectTargetLabels()[key] ?? key,
    attributeLabel: key => getAttributeLabel(key)
  });
  const holder = actor ? holderLine(mech?.cost, energyMax) : null;
  const cost =
    suggestion.cost > 0
      ? { suggested: suggestion.cost, close: costCloseEnough(mech?.cost, suggestion.cost), rows: suggestion.rows, holder, holderName: actor?.name ?? "", holderMax: energyMax, energyLabel }
      : null;
  const upkeep = mech?.hasUpkeep && suggestion.upkeep ? { suggested: suggestion.upkeep, close: costCloseEnough(mech?.upkeepCost, suggestion.upkeep) } : null;
  return { enabled: true, warnings, byTab, byEffect, cost, upkeep, energyLabel };
}

/* ------------------------------------------------------------------ HTML (editor rápido) */

/** Quadro de avisos (mesmo visual da ficha). Vazio = string vazia. */
export function warningsBoxHtml(warnings) {
  if (!warnings?.length) return "";
  const rows = warnings
    .map(w => `<li class="sa-warn ${w.level}"><span class="sa-sev">${w.level === "hard" ? "!" : "?"}</span><span>${escapeHtml(w.text)}</span></li>`)
    .join("");
  return `<div class="sa-box"><div class="sa-box-head"><i class="fas fa-triangle-exclamation"></i> ${warnings.length} aviso${warnings.length === 1 ? "" : "s"}<span class="sa-sp"></span><span class="sa-note">dá para salvar assim mesmo</span></div><ul>${rows}</ul></div>`;
}

/** Selo "sugerido N" com a conta escondida num <details>. `field`: o name do campo que "usar" preenche. */
export function costChipHtml(info, field) {
  if (!info) return "";
  const rows = (info.rows ?? []).map(r => `<div class="sa-pr"><span>${escapeHtml(r.label)}</span><b>${escapeHtml(r.value)}</b></div>`).join("");
  const holder = info.holder
    ? `<div class="sa-pr holder"><span>Na ficha de ${escapeHtml(info.holderName)} (${info.holderMax} de ${escapeHtml(info.energyLabel)})</span><b>${info.holder.percent}% · usa ${info.holder.uses}×</b></div>`
    : "";
  const breakdown = rows
    ? `<div class="sa-pop">${rows}<div class="sa-pr total"><span>Sugerido</span><b>${info.suggested}</b></div>${holder}<p class="sa-foot">Custo do nível 1: o desconto dos níveis acontece sozinho. Verde = até 30% de diferença. A ${escapeHtml(info.energyLabel)} do dono não muda a sugestão.</p></div>`
    : "";
  return `<details class="sa-cost ${info.close ? "ok" : "far"}"><summary>sugerido ${info.suggested}${info.close ? " ✓" : ""}</summary>${breakdown}</details>${info.close ? "" : `<a class="sa-use" data-sa-use="${escapeHtml(field)}" data-value="${info.suggested}">usar</a>`}`;
}

/* ------------------------------------------------------------------ Modelos (L7) */

/** Modelos agrupados para a janela de criação: [{label, templates: [{id, label, hint}]}]. */
export function templateGroups() {
  const labels = MEU_SISTEMA.SKILL_TEMPLATE_GROUP_LABELS;
  const groups = Object.entries(labels).map(([id, label]) => ({ id, label, templates: [] }));
  for (const t of getActiveSkillTemplates()) {
    // Modelo do Mestre sem frase própria: os dois primeiros pedaços da "Skill numa frase".
    const hint = t.hint || skillSentence(t.skill).split(" · ").slice(0, 2).join(" · ");
    (groups.find(g => g.id === t.group) ?? groups[0]).templates.push({ id: t.id, label: t.label, hint });
  }
  return groups.filter(g => g.templates.length);
}

/** "A Skill numa frase" (a mesma da ficha) para dados soltos de Skill. */
export function skillSentence(skill) {
  if (!skill) return "";
  const byId = list => Object.fromEntries(list.map(e => [e.id, e.label]));
  return skillSummary(skill, {
    elements: byId(getActiveDamageElements()),
    conditions: byId(getActiveStatusConditions()),
    targets: getEffectTargetLabels(),
    structures: byId(getStructures()),
    energyLabel: getCharacterEnergyLabel(),
    cost: skill.cost,
    upkeep: skill.upkeepCost
  });
}

/** Frase do que o modelo preenche (o "Vem preenchido:" da prancha 2). */
export function templateFillSentence(id) {
  return skillSentence(getActiveSkillTemplates().find(t => t.id === id)?.skill);
}

/** Dados de uma Skill nova a partir de um modelo (com nome/Tier de quem cria). Sem modelo: null. */
export function skillFromTemplate(id, overrides = {}) {
  const template = getActiveSkillTemplates().find(t => t.id === id);
  return template ? templateSkillData(template, overrides, worldCatalogs()) : null;
}
