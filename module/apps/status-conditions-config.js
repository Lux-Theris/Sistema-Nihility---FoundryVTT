import { MEU_SISTEMA, getActiveStatusConditions, getAttributeLabels } from "../core/config.js";
import { CURSE_UNPAID, CURSE_UNPAID_LABELS, normalizeCurse } from "../core/curse-rules.js";
import { createCardListConfigApp, escapeHtml, optionsHtml } from "./card-list-config-factory.js";
import { registerStatusConditions } from "../combat/conditions.js";
import { pickerFieldHtml, readPickerField, wireElementPickerField } from "./checklist-picker.js";

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
const HEAL_KINDS = MEU_SISTEMA.HEAL_KINDS.map(k => [k, MEU_SISTEMA.HEAL_KIND_LABELS[k]]);
const HEAL_BLOCK_KINDS = [["", "Não"], ["regen", "Só Regeneração"], ["all", "Toda cura"]];
const HEAL_BLOCK_SCOPES = [["body", "Corpo todo"], ["part", "Parte atingida"]];

/** O bloqueio salvo (a antiga caixa "Impede regeneração" = só Regeneração). */
function healBlockKinds(values) {
  if (values.healBlock?.kinds) return values.healBlock.kinds;
  return values.blocksRegeneration ? "regen" : "";
}

function modTargetOptions() {
  const labels = getAttributeLabels();
  return [["movement", "Deslocamento (%)"], ...MEU_SISTEMA.COMBAT_ATTRIBUTES.map(key => [key, labels[key] ?? key])];
}

/** Uma linha de efeito da Maldição: atributo/Deslocamento, ou dano/cura por rodada. */
function curseEffectRowHtml(fx = {}) {
  const kind = fx.kind === "tick" ? "tick" : "modifier";
  return `
    <div class="curse-effect-row">
      <select data-curse-field="kind">${optionsHtml([["modifier", "Atributo/Deslocamento"], ["tick", "Por rodada"]], kind)}</select>
      <select data-curse-field="modTarget" data-curse-shows="modifier">${optionsHtml(modTargetOptions(), fx.modTarget ?? "strength")}</select>
      <select data-curse-field="modMode" data-curse-shows="modifier">${optionsHtml(MOD_MODES, fx.modMode ?? "percent")}</select>
      <select data-curse-field="tickSign" data-curse-shows="tick">${optionsHtml(TICK_SIGNS, fx.tickSign ?? "damage")}</select>
      <select data-curse-field="tickTarget" data-curse-shows="tick">${optionsHtml([["hp", "Vida"], ["energy", "Mana/Energia"]], fx.tickTarget ?? "hp")}</select>
      <select data-curse-field="valueMode" data-curse-shows="tick">${optionsHtml([["maxPercent", "% do máximo"], ["fixed", "Valor fixo"]], fx.valueMode ?? "maxPercent")}</select>
      <input type="number" step="any" data-curse-field="value" value="${fx.value ?? (kind === "tick" ? 2 : -20)}" title="Negativo reduz (atributo/Deslocamento)."/>
      <a class="curse-effect-remove" title="Remover efeito"><i class="fas fa-times"></i></a>
    </div>`;
}

function renderCard(values) {
  const effect = values.effect ?? {};
  const kind = effect.kind ?? "";
  const curse = normalizeCurse(values.curse);
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
      <span class="hint-inline" title="Quem tem esta Condição passa a SER deste elemento (Encharcado = Água): a vantagem entre elementos vale contra ele.">Elemento:</span>
      ${pickerFieldHtml(values.elements ?? [], "condition-elements")}
      <label title="Selo antimagia: quem tem esta Condição paga Mana extra em toda magia (maior quanto maior o nível), ou ela é anulada. 0 = não é selo.">Antimagia (nível) <input type="number" data-field="antimagicLevel" min="0" value="${values.antimagicLevel ?? 0}"/></label>
    </div>
    <div class="card-config-row">
      <label title="Enquanto esta Condição estiver no alvo, a cura é bloqueada — totalmente até o nível de quem aplicou + 1/3, depois cada vez menos (Regras da Mesa). Ex.: Fogo/Ácido cauterizando, uma Maldição.">Impede cura <select data-field="healBlockKinds">${optionsHtml(HEAL_BLOCK_KINDS, healBlockKinds(values))}</select></label>
      <label title="Corpo todo, ou só a parte do corpo que o golpe atingiu (ou a escolhida ao usar a Skill).">Onde <select data-field="healBlockScope">${optionsHtml(HEAL_BLOCK_SCOPES, values.healBlock?.scope ?? "body")}</select></label>
      <label title="Antimagia: quem tem esta Condição não sente passivos, Resistências, itens e implantes mágicos, nem Skills mágicas usadas nele, de nível até o da Condição."><input type="checkbox" data-field="suppressesMagic" ${values.suppressesMagic ? "checked" : ""}/> Suprime magia (Antimagia)</label>
    </div>
    <div class="card-config-row">
      <label title="Maldição: vários efeitos num só, sem prazo (sai com Antimagia de nível que alcance, ou pelo Mestre), com custo por rodada pago pela Mana da vítima. O nível é o da Skill que lançou."><input type="checkbox" data-field="curseEnabled" ${curse.enabled ? "checked" : ""}/> Maldição</label>
    </div>
    <div class="curse-config" ${curse.enabled ? "" : "hidden"}>
      <div class="card-config-row">
        <label>Custo por rodada (% da Mana máx. da vítima) <input type="number" min="0" step="any" data-field="curseCost" value="${curse.costPercent}"/></label>
        <label>Sem Mana para pagar <select data-field="curseUnpaid">${optionsHtml(CURSE_UNPAID.map(k => [k, CURSE_UNPAID_LABELS[k]]), curse.onUnpaid)}</select></label>
        <label title="Só no Piora: quanto os efeitos sobem por rodada sem pagar, e até quanto.">Piora +% <input type="number" min="0" data-field="curseWorsenStep" value="${curse.worsenStep}"/></label>
        <label>até × <input type="number" min="1" step="0.5" data-field="curseWorsenCap" value="${curse.worsenCap}"/></label>
      </div>
      <div class="curse-effect-list">${curse.effects.map(curseEffectRowHtml).join("")}</div>
      <a class="curse-effect-add">+ Efeito da maldição</a>
    </div>
    <div class="card-config-row" data-kind="tick" ${kind === "tick" ? "" : "hidden"}>
      <label>Tipo <select data-field="tickSign">${optionsHtml(TICK_SIGNS, effect.tickSign ?? "damage")}</select></label>
      <label>Em <select data-field="tickTarget">${optionsHtml(TICK_TARGETS, effect.tickTarget ?? "hp")}</select></label>
      <label>Valor <input type="number" step="any" data-field="tickValue" value="${kind === "tick" ? effect.value ?? 10 : 10}"/></label>
      <label>Forma <select data-field="valueMode">${optionsHtml(VALUE_MODES, effect.valueMode ?? "hitPercent")}</select></label>
      <label>Tick <select data-field="tickUnit">${optionsHtml(TICK_UNITS, effect.tickUnit ?? "combatRound")}</select></label>
      <label title="Só numa cura, com Ferimentos por parte: Cura fecha feridas; Regeneração também refaz partes perdidas; Reparo conserta próteses.">Se for cura <select data-field="healKind">${optionsHtml(HEAL_KINDS, effect.healKind ?? "cura")}</select></label>
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
  wireElementPickerField(card.querySelector(".condition-elements"));

  // Maldição: mostra/esconde o bloco e as linhas de efeito.
  const curseBox = card.querySelector(".curse-config");
  card.querySelector('[data-field="curseEnabled"]')?.addEventListener("change", event => {
    curseBox.hidden = !event.target.checked;
  });
  const list = card.querySelector(".curse-effect-list");
  const syncRow = row => {
    const k = row.querySelector('[data-curse-field="kind"]').value;
    row.querySelectorAll("[data-curse-shows]").forEach(el => (el.hidden = el.dataset.curseShows !== k));
  };
  list.querySelectorAll(".curse-effect-row").forEach(syncRow);
  card.querySelector(".curse-effect-add").addEventListener("click", () => {
    list.insertAdjacentHTML("beforeend", curseEffectRowHtml());
    syncRow(list.lastElementChild);
  });
  list.addEventListener("change", event => {
    if (event.target.matches('[data-curse-field="kind"]')) syncRow(event.target.closest(".curse-effect-row"));
  });
  list.addEventListener("click", event => {
    if (event.target.closest(".curse-effect-remove")) event.target.closest(".curse-effect-row").remove();
  });
}

/** Lê o bloco da Maldição do cartão (null quando desligado). */
function readCurse(card, get) {
  if (!card.querySelector('[data-field="curseEnabled"]')?.checked) return null;
  const effects = Array.from(card.querySelectorAll(".curse-effect-row")).map(row => {
    const read = field => row.querySelector(`[data-curse-field="${field}"]`)?.value ?? "";
    const kind = read("kind") === "tick" ? "tick" : "modifier";
    const value = Number(read("value")) || 0;
    if (kind === "tick") return { kind, tickSign: read("tickSign"), tickTarget: read("tickTarget"), valueMode: read("valueMode"), value: Math.abs(value) };
    return { kind, modTarget: read("modTarget"), modMode: read("modMode"), value };
  }).filter(fx => fx.value);
  return normalizeCurse({
    enabled: true,
    effects,
    costPercent: get("curseCost"),
    onUnpaid: get("curseUnpaid"),
    worsenStep: get("curseWorsenStep"),
    worsenCap: get("curseWorsenCap")
  });
}

function readCard(card) {
  const get = field => card.querySelector(`[data-field="${field}"]`)?.value ?? "";
  const id = get("id").trim();
  if (!id) return null;
  const row = { id, label: get("label").trim() || id, icon: get("icon").trim() || "icons/svg/aura.svg" };
  const antimagicLevel = Math.max(0, Math.round(Number(get("antimagicLevel")) || 0));
  if (antimagicLevel) row.antimagicLevel = antimagicLevel;
  const elements = readPickerField(card.querySelector(".condition-elements"));
  if (elements.length) row.elements = elements;
  if (get("healBlockKinds")) row.healBlock = { kinds: get("healBlockKinds"), scope: get("healBlockScope") === "part" ? "part" : "body" };
  if (card.querySelector('[data-field="suppressesMagic"]')?.checked) row.suppressesMagic = true;
  const curse = readCurse(card, get);
  if (curse) row.curse = curse;

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
    if (row.effect.tickSign === "heal" && get("healKind") && get("healKind") !== "cura") row.effect.healKind = get("healKind");
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
