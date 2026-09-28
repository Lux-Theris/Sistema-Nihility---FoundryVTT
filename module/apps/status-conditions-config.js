import { MEU_SISTEMA, getActiveStatusConditions, getAttributeLabels } from "../config.js";
import { createCardListConfigApp, escapeHtml, optionsHtml } from "./card-list-config-factory.js";
import { registerStatusConditions } from "../conditions.js";

/**
 * Editor das Condições de Status (Cegueira, Veneno, Queimadura, Lentidão…). Cada Condição tem id,
 * nome, ícone e, opcionalmente, um **efeito padrão** — definido uma vez aqui e reaproveitado por
 * Elementos ("Fogo aplica Queimadura"), Skills (entrada de Efeito com a Condição e valor 0) e pela
 * marcação à mão no token. Sem efeito padrão, a Condição é só o ícone e o Mestre julga na mesa.
 *
 * Formas de valor do dano/cura por rodada: fixo, % do dano do golpe que aplicou (o padrão —
 * cresce com o golpe) ou % da Vida/Mana máxima do alvo. Ver resolveConditionEffect em
 * damage-rules.js.
 */

const KIND_OPTIONS = [["", "Só o ícone (sem efeito)"], ["tick", "Dano/cura por rodada"], ["modifier", "Aumenta/reduz atributo ou Deslocamento"]];
// "Vida" numa Nave vira Integridade Estrutural sozinho; Casco e Integridade são pra Condições só de Nave.
const TICK_TARGETS = [["hp", "Vida (na Nave: Integridade)"], ["energy", "Mana/Energia"], ["shipCasco", "Casco (Nave)"], ["shipHull", "Integridade (Nave)"]];
const TICK_SIGNS = [["damage", "Dano"], ["heal", "Cura"]];
const VALUE_MODES = [["hitPercent", "% do dano do golpe"], ["maxPercent", "% do máximo do alvo"], ["fixed", "Valor fixo"]];
const TICK_UNITS = [["combatRound", "Por rodada de combate"], ["manual", "Manual (botão na ficha)"]];
const MOD_MODES = [["percent", "%"], ["fixed", "Fixo"]];

function modTargetOptions() {
  const labels = getAttributeLabels();
  return [["movement", "Deslocamento (%)"], ...MEU_SISTEMA.COMBAT_ATTRIBUTES.map(key => [key, labels[key] ?? key])];
}

function renderCard(values) {
  const effect = values.effect ?? {};
  const kind = effect.kind ?? "";
  return `
    <div class="card-config-row card-config-row-main">
      <input type="text" data-field="id" value="${escapeHtml(values.id)}" placeholder="id (ex: burn)"/>
      <input type="text" data-field="label" value="${escapeHtml(values.label)}" placeholder="Nome exibido"/>
      <input type="text" data-field="icon" value="${escapeHtml(values.icon ?? "icons/svg/aura.svg")}" placeholder="Ícone"/>
      <a class="card-config-pick" data-action="pickIcon" data-field="icon" title="Escolher ícone"><i class="fas fa-image"></i></a>
    </div>
    <div class="card-config-row">
      <label>Efeito padrão <select data-field="kind">${optionsHtml(KIND_OPTIONS, kind)}</select></label>
      <label>Duração (rodadas) <input type="number" data-field="durationRounds" min="1" value="${effect.durationRounds ?? 2}"/></label>
      <label title="Selo antimagia: quem tem esta Condição paga Mana extra em toda magia (maior quanto maior o nível), ou ela é anulada. 0 = não é selo.">Antimagia (nível) <input type="number" data-field="antimagicLevel" min="0" value="${values.antimagicLevel ?? 0}"/></label>
    </div>
    <div class="card-config-row" data-kind="tick" ${kind === "tick" ? "" : "hidden"}>
      <label>Tipo <select data-field="tickSign">${optionsHtml(TICK_SIGNS, effect.tickSign ?? "damage")}</select></label>
      <label>Em <select data-field="tickTarget">${optionsHtml(TICK_TARGETS, effect.tickTarget ?? "hp")}</select></label>
      <label>Valor <input type="number" step="any" data-field="tickValue" value="${kind === "tick" ? effect.value ?? 10 : 10}"/></label>
      <label>Forma <select data-field="valueMode">${optionsHtml(VALUE_MODES, effect.valueMode ?? "hitPercent")}</select></label>
      <label>Tick <select data-field="tickUnit">${optionsHtml(TICK_UNITS, effect.tickUnit ?? "combatRound")}</select></label>
    </div>
    <div class="card-config-row" data-kind="modifier" ${kind === "modifier" ? "" : "hidden"}>
      <label>Alvo <select data-field="modTarget">${optionsHtml(modTargetOptions(), effect.modTarget ?? "movement")}</select></label>
      <label>Valor <input type="number" step="any" data-field="modValue" value="${kind === "modifier" ? effect.value ?? -50 : -50}"/></label>
      <label>Forma <select data-field="modMode">${optionsHtml(MOD_MODES, effect.modMode ?? "percent")}</select></label>
      <span class="hint-inline">Negativo reduz. Deslocamento é sempre em %.</span>
    </div>`;
}

function wireCard(card) {
  const kindSelect = card.querySelector('[data-field="kind"]');
  const sync = () => {
    card.querySelectorAll("[data-kind]").forEach(row => {
      row.hidden = row.dataset.kind !== kindSelect.value;
    });
  };
  kindSelect.addEventListener("change", sync);
  sync();
}

function readCard(card) {
  const get = field => card.querySelector(`[data-field="${field}"]`)?.value ?? "";
  const id = get("id").trim();
  if (!id) return null;
  const row = { id, label: get("label").trim() || id, icon: get("icon").trim() || "icons/svg/aura.svg" };
  const antimagicLevel = Math.max(0, Math.round(Number(get("antimagicLevel")) || 0));
  if (antimagicLevel) row.antimagicLevel = antimagicLevel;

  const kind = get("kind");
  const durationRounds = Math.max(1, Number(get("durationRounds")) || 1);
  if (kind === "tick") {
    row.effect = {
      kind,
      tickTarget: get("tickTarget"),
      tickSign: get("tickSign"),
      valueMode: get("valueMode"),
      value: Math.abs(Number(get("tickValue")) || 0),
      durationRounds,
      tickUnit: get("tickUnit")
    };
  } else if (kind === "modifier") {
    row.effect = { kind, modTarget: get("modTarget"), modMode: get("modMode"), value: Number(get("modValue")) || 0, durationRounds };
  }
  return row;
}

export const StatusConditionsConfigApp = createCardListConfigApp({
  id: "nihility-status-conditions-config",
  title: "Configurar Condições de Status",
  settingsKey: "statusConditionsData",
  width: 680,
  addLabel: "+ Nova Condição",
  hint:
    "O <strong>id</strong> é a chave interna (sem espaços, ex: <code>burn</code>). O <strong>efeito padrão</strong> " +
    "é usado quando um Elemento aplica a Condição, quando uma Skill usa a Condição com valor 0 e quando o Mestre " +
    "a marca no token. <strong>% do dano do golpe</strong> cresce com o golpe (5000 de dano com 10% = 500 por rodada). " +
    "Reaplicar a mesma Condição <strong>renova</strong> a duração e fica com o valor mais forte — não soma.",
  getActiveList: getActiveStatusConditions,
  renderCard,
  readCard,
  wireCard,
  // Republica o catálogo em `CONFIG.statusEffects` na hora (paleta do HUD do token).
  afterSave: registerStatusConditions
});
