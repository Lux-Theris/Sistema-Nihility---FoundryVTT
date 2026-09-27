/**
 * Catálogos de Nave editáveis no jogo: Categorias de Módulo, Classes de Nave, Classes de Veículo
 * e Postos de Tripulação. Todos em cartão/lista (factories), salvos como JSON nas settings.
 */
import { MEU_SISTEMA, getModuleCategories, getVesselClasses, getCrewRoles } from "../config.js";
import { createCardListConfigApp, escapeHtml, optionsHtml } from "./card-list-config-factory.js";
import { createListConfigApp } from "./list-config-app-factory.js";

/* ------------------------------------------------------------------ Categorias de Módulo */

const roleOptions = () => Object.entries(MEU_SISTEMA.MODULE_ROLES).map(([id, role]) => [id, role.label]);
const COMBINE_LABELS = { sum: "somam", independent: "cada uma por si", single: "só uma ativa", none: "sem mecânica" };

function renderCategory(values) {
  const role = values.role ?? "utility";
  return `
    <div class="card-config-row card-config-row-main">
      <input type="text" data-field="id" value="${escapeHtml(values.id)}" placeholder="id (ex: thrusters)"/>
      <input type="text" data-field="label" value="${escapeHtml(values.label)}" placeholder="Nome (ex: Manobradores)"/>
    </div>
    <div class="card-config-row">
      <label>Função <select data-field="role">${optionsHtml(roleOptions(), role)}</select></label>
      <label>Vagas por Nave <input type="number" data-field="slots" min="0" value="${values.slots ?? 1}"/></label>
      <span class="hint-inline role-combine">várias da mesma Função: ${COMBINE_LABELS[MEU_SISTEMA.MODULE_ROLES[role]?.combine] ?? ""}</span>
    </div>`;
}

function wireCategory(card) {
  const select = card.querySelector('[data-field="role"]');
  select.addEventListener("change", () => {
    card.querySelector(".role-combine").textContent = `várias da mesma Função: ${COMBINE_LABELS[MEU_SISTEMA.MODULE_ROLES[select.value]?.combine] ?? ""}`;
  });
}

function readCategory(card) {
  const get = f => card.querySelector(`[data-field="${f}"]`)?.value ?? "";
  const id = get("id").trim();
  if (!id) return null;
  return { id, label: get("label").trim() || id, role: get("role"), slots: Math.max(0, Math.round(Number(get("slots")) || 0)) };
}

export const ModuleCategoriesConfigApp = createCardListConfigApp({
  id: "nihility-module-categories-config",
  title: "Configurar Categorias de Módulo",
  settingsKey: "moduleCategoriesData",
  width: 640,
  addLabel: "+ Nova Categoria",
  hint:
    "A <strong>Função</strong> é o que o sistema entende; o nome é livre. Duas Categorias de Propulsão " +
    "(Motor de Impulso e Manobradores) <strong>somam</strong>; duas de FTL (Dobra e Transdobra) são " +
    "<strong>independentes</strong>; Distribuição tem sempre uma só ativa. <strong>Utilidade/Narrativo</strong> " +
    "não tem mecânica — serve para Comunicações, Defletor, Enfermaria… só se a campanha quiser. " +
    "<strong>Vagas</strong>: 0 = sem limite (Arma usa o espaço de Arma do Porte). A Classe da Nave pode mudar as vagas. " +
    "Mudar o id de uma Categoria em uso deixa os Módulos dela sem mecânica até voltar.",
  getActiveList: getModuleCategories,
  renderCard: renderCategory,
  readCard: readCategory,
  wireCard: wireCategory
});

/* ------------------------------------------------------------------ Classes */

function sizeOptions() {
  return [["", "— sem limite —"], ...MEU_SISTEMA.MODULE_SIZES.map(s => [s, MEU_SISTEMA.MODULE_SIZE_LABELS[s]])];
}

function renderClass(values) {
  const slots = values.slots ?? {};
  const slotRows = getModuleCategories()
    .map(c => `<label title="Vazio = usa o padrão da Categoria (${c.slots || "sem limite"})">${escapeHtml(c.label)}
        <input type="number" min="0" data-slot="${escapeHtml(c.id)}" value="${slots[c.id] ?? ""}" placeholder="${c.slots || "∞"}"/></label>`)
    .join("");
  return `
    <div class="card-config-row card-config-row-main">
      <input type="text" data-field="id" value="${escapeHtml(values.id)}" placeholder="id (ex: battleship)"/>
      <input type="text" data-field="label" value="${escapeHtml(values.label)}" placeholder="Nome (ex: Encouraçado)"/>
    </div>
    <div class="card-config-row">
      <input type="text" data-field="description" value="${escapeHtml(values.description)}" placeholder="Descrição curta" style="flex:1 1 100%"/>
    </div>
    <div class="card-config-row">
      <label>Evasão × <input type="number" step="0.05" min="0" data-field="evasionMultiplier" value="${values.evasionMultiplier ?? 1}"/></label>
      <label>Movimento × <input type="number" step="0.05" min="0" data-field="movementMultiplier" value="${values.movementMultiplier ?? 1}"/></label>
      <label>Espaço de Arma × <input type="number" step="0.05" min="0" data-field="weaponBudgetMultiplier" value="${values.weaponBudgetMultiplier ?? 1}"/></label>
      <label>Arma até <select data-field="maxWeaponSize">${optionsHtml(sizeOptions(), values.maxWeaponSize ?? "")}</select></label>
    </div>
    <div class="card-config-row class-slots"><span class="hint-inline">Vagas por Categoria:</span>${slotRows}</div>`;
}

function readClass(card) {
  const get = f => card.querySelector(`[data-field="${f}"]`)?.value ?? "";
  const id = get("id").trim();
  if (!id) return null;
  const num = (f, fallback) => {
    const n = Number(get(f));
    return get(f).trim() !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const slots = {};
  card.querySelectorAll("[data-slot]").forEach(input => {
    if (input.value.trim() !== "") slots[input.dataset.slot] = Math.max(0, Math.round(Number(input.value) || 0));
  });
  return {
    id,
    label: get("label").trim() || id,
    description: get("description").trim(),
    evasionMultiplier: num("evasionMultiplier", 1),
    movementMultiplier: num("movementMultiplier", 1),
    weaponBudgetMultiplier: num("weaponBudgetMultiplier", 1),
    maxWeaponSize: get("maxWeaponSize"),
    slots
  };
}

const CLASS_HINT =
  "Porte é o tamanho; Classe é o papel. Os multiplicadores valem sobre o que o Porte dá. <strong>Parrudo</strong> " +
  "vem de mais vagas de Blindagem e Escudo (várias somam). Mudar a Classe de uma Nave nunca remove Módulos já " +
  "instalados — só impede instalar novos acima do limite.";

export const ShipClassesConfigApp = createCardListConfigApp({
  id: "nihility-ship-classes-config",
  title: "Configurar Classes de Nave",
  settingsKey: "shipClassesData",
  width: 720,
  addLabel: "+ Nova Classe",
  hint: CLASS_HINT,
  getActiveList: () => getVesselClasses("ship"),
  renderCard: renderClass,
  readCard: readClass
});

export const VehicleClassesConfigApp = createCardListConfigApp({
  id: "nihility-vehicle-classes-config",
  title: "Configurar Classes de Veículo",
  settingsKey: "vehicleClassesData",
  width: 720,
  addLabel: "+ Nova Classe",
  hint: `${CLASS_HINT} Um Tanque não é um Carro, mesmo no mesmo Porte.`,
  getActiveList: () => getVesselClasses("vehicle"),
  renderCard: renderClass,
  readCard: readClass
});

/* ------------------------------------------------------------------ Postos de Tripulação */

export const CrewRolesConfigApp = createListConfigApp({
  id: "nihility-crew-roles-config",
  title: "Configurar Postos de Tripulação",
  settingsKey: "crewRolesData",
  width: 440,
  hint:
    "Postos dizem <strong>quem está onde</strong> — não são permissão. Qualquer tripulante opera a Nave inteira " +
    "e troca o próprio posto na hora (o engenheiro assume o leme se o piloto cair).",
  fields: [
    { key: "id", label: "ID", type: "text", placeholder: "id (ex: pilot)" },
    { key: "label", label: "Nome", type: "text", placeholder: "Nome exibido" }
  ],
  getActiveList: getCrewRoles
});
