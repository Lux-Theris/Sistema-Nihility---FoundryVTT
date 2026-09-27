import { MEU_SISTEMA, getActiveDamageElements, getActiveStatusConditions, getActiveTraits } from "../config.js";
import { createCardListConfigApp, escapeHtml, optionsHtml } from "./card-list-config-factory.js";

/**
 * Editor dos Tipos de Dano. Cada elemento tem id, nome, cor, **Grupo** (organiza os seletores:
 * Físico, Fantasia, Energia, Exótico…) e uma lista opcional de **Efeitos ao acertar**, cada um de
 * um tipo fixo que o código entende (ELEMENT_EFFECT_TYPES em config.js):
 *  - Aplicar Condição (com chance) — usa o efeito padrão da Condição;
 *  - Dano extra contra Traço — ex.: Pólaron +20% contra Orgânico;
 *  - Dano extra em Escudo — ex.: Táquion drena Escudo;
 *  - Penetração — ex.: Transfásico ignora parte das defesas (nunca Imunidade).
 *
 * Um golpe com vários elementos é dividido em partes iguais; cada parte sofre só a Resistência
 * do seu elemento e dispara só os efeitos dele (ver damage-rules.js).
 */

function effectRowHtml(effect = {}) {
  const type = effect.type ?? "condition";
  const conditions = getActiveStatusConditions().map(c => [c.id, c.label]);
  const traits = getActiveTraits().map(t => [t.id, t.label]);
  const types = MEU_SISTEMA.ELEMENT_EFFECT_TYPES.map(t => [t, MEU_SISTEMA.ELEMENT_EFFECT_TYPE_LABELS[t]]);
  return `
    <div class="element-effect-row">
      <select data-effect-field="type">${optionsHtml(types, type)}</select>
      <select data-effect-field="conditionId" data-shows="condition">${optionsHtml(conditions, effect.conditionId)}</select>
      <select data-effect-field="trait" data-shows="traitBonus">${optionsHtml(traits, effect.trait)}</select>
      <label data-shows="condition">Chance % <input type="number" data-effect-field="chance" min="0" max="100" value="${effect.chance ?? 25}"/></label>
      <label data-shows="traitBonus shieldDrain penetration">% <input type="number" data-effect-field="percent" min="0" value="${effect.percent ?? 20}"/></label>
      <a class="element-effect-remove" title="Remover efeito"><i class="fas fa-times"></i></a>
    </div>`;
}

function renderCard(values) {
  const groups = [...new Set(getActiveDamageElements().map(el => el.group).concat(["Físico", "Fantasia", "Energia", "Exótico"]))];
  return `
    <div class="card-config-row card-config-row-main">
      <input type="text" data-field="id" value="${escapeHtml(values.id)}" placeholder="id (ex: fire)"/>
      <input type="text" data-field="label" value="${escapeHtml(values.label)}" placeholder="Nome exibido"/>
      <input type="color" data-field="color" value="${escapeHtml(values.color ?? "#c084fc")}"/>
      <input type="text" data-field="group" value="${escapeHtml(values.group ?? "")}" placeholder="Grupo" list="nihility-element-groups"/>
      <datalist id="nihility-element-groups">${groups.map(g => `<option value="${escapeHtml(g)}"></option>`).join("")}</datalist>
    </div>
    <div class="element-effect-list">${(values.effects ?? []).map(effectRowHtml).join("")}</div>
    <a class="element-effect-add">+ Efeito ao acertar</a>`;
}

function syncEffectRow(row) {
  const type = row.querySelector('[data-effect-field="type"]').value;
  row.querySelectorAll("[data-shows]").forEach(el => {
    el.hidden = !el.dataset.shows.split(" ").includes(type);
  });
}

function wireCard(card) {
  const list = card.querySelector(".element-effect-list");
  list.querySelectorAll(".element-effect-row").forEach(syncEffectRow);
  card.querySelector(".element-effect-add").addEventListener("click", () => {
    list.insertAdjacentHTML("beforeend", effectRowHtml());
    syncEffectRow(list.lastElementChild);
  });
  list.addEventListener("change", event => {
    if (event.target.matches('[data-effect-field="type"]')) syncEffectRow(event.target.closest(".element-effect-row"));
  });
  list.addEventListener("click", event => {
    if (event.target.closest(".element-effect-remove")) event.target.closest(".element-effect-row").remove();
  });
}

function readCard(card) {
  const get = field => card.querySelector(`[data-field="${field}"]`)?.value ?? "";
  const id = get("id").trim();
  if (!id) return null;
  const effects = Array.from(card.querySelectorAll(".element-effect-row")).map(row => {
    const read = field => row.querySelector(`[data-effect-field="${field}"]`)?.value ?? "";
    const type = read("type");
    if (type === "condition") return { type, conditionId: read("conditionId"), chance: Math.min(100, Math.max(0, Number(read("chance")) || 0)) };
    if (type === "traitBonus") return { type, trait: read("trait"), percent: Math.max(0, Number(read("percent")) || 0) };
    return { type, percent: Math.max(0, Number(read("percent")) || 0) };
  }).filter(e => (e.type !== "condition" || e.conditionId) && (e.type !== "traitBonus" || e.trait));
  return { id, label: get("label").trim() || id, color: get("color") || "#c084fc", group: get("group").trim() || "Outros", effects };
}

export const DamageElementsConfigApp = createCardListConfigApp({
  id: "nihility-damage-elements-config",
  title: "Configurar Tipos de Dano",
  settingsKey: "damageElementsData",
  width: 700,
  addLabel: "+ Novo Tipo de Dano",
  hint:
    "Um golpe com vários elementos é <strong>dividido em partes iguais</strong>: cada parte sofre só a Resistência " +
    "do próprio elemento, e Imunidade zera só a parte dela (Fogo+Gelo contra alguém imune a Fogo ainda causa a metade " +
    "de Gelo). Os <strong>Efeitos ao acertar</strong> valem só para a parte daquele elemento, e quem é imune a ele não " +
    "sofre o efeito. Penetração nunca atravessa Imunidade.",
  getActiveList: getActiveDamageElements,
  renderCard,
  readCard,
  wireCard
});
