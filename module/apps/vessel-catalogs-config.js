/**
 * Catálogos de Nave editáveis no jogo: Categorias de Módulo, Classes de Nave, Classes de Veículo
 * e Postos de Tripulação. Todos em cartão/lista (factories), salvos como JSON nas settings.
 */
import { MEU_SISTEMA, getModuleCategories, getVesselClasses, getVesselSizes, getCrewRoles, getAmmoTypes } from "../config.js";
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

function renderClass(values, kind) {
  const sizes = getVesselSizes(kind).map(s => [s.id, s.label]);
  const minOptions = [["", "— sem mínimo —"], ...sizes];
  const maxOptions = [["", "— sem máximo —"], ...sizes];
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
      <label title="Menor Porte que esta Classe aceita">Porte de <select data-field="minSize">${optionsHtml(minOptions, values.minSize ?? "")}</select></label>
      <label title="Maior Porte que esta Classe aceita">até <select data-field="maxSize">${optionsHtml(maxOptions, values.maxSize ?? "")}</select></label>
    </div>
    <div class="card-config-row">
      <label>Evasão × <input type="number" step="0.05" min="0" data-field="evasionMultiplier" value="${values.evasionMultiplier ?? 1}"/></label>
      <label>Movimento × <input type="number" step="0.05" min="0" data-field="movementMultiplier" value="${values.movementMultiplier ?? 1}"/></label>
      <label>Espaço de Arma × <input type="number" step="0.05" min="0" data-field="weaponBudgetMultiplier" value="${values.weaponBudgetMultiplier ?? 1}"/></label>
      <label>Arma até <select data-field="maxWeaponSize">${optionsHtml(sizeOptions(), values.maxWeaponSize ?? "")}</select></label>
    </div>
    <div class="card-config-row">
      <label title="Somada à Resistência à Penetração dos Escudos (pontos percentuais)">Resist. Penetração Escudo +% <input type="number" min="0" max="100" data-field="shieldPenResist" value="${values.shieldPenResist ?? 0}"/></label>
      <label title="Somada à Resistência à Penetração da Blindagem (pontos percentuais)">Resist. Penetração Casco +% <input type="number" min="0" max="100" data-field="cascoPenResist" value="${values.cascoPenResist ?? 0}"/></label>
      <label title="Somado ao Endurecimento de cada Módulo: menos chance de efeitos de sistema (derrubar, drenar energia, baixar resistência)">Endurecimento +% <input type="number" min="0" max="100" data-field="hardening" value="${values.hardening ?? 0}"/></label>
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
    minSize: get("minSize"),
    maxSize: get("maxSize"),
    shieldPenResist: num("shieldPenResist", 0),
    cascoPenResist: num("cascoPenResist", 0),
    hardening: num("hardening", 0),
    slots
  };
}

const CLASS_HINT =
  "Porte é o tamanho; Classe é o papel. Os multiplicadores valem sobre o que o Porte dá. <strong>Parrudo</strong> " +
  "vem de mais vagas de Blindagem e Escudo (várias somam). Mudar a Classe de uma Nave nunca remove Módulos já " +
  "instalados — só impede instalar novos acima do limite. A <strong>faixa de Porte</strong> limita quais Portes " +
  "a Classe aceita (Caça até Pequeno, Dreadnought a partir de Capital); uma Nave já fora da faixa não muda " +
  "sozinha — a ficha avisa o Mestre e só impede a próxima troca pra fora dela.";

export const ShipClassesConfigApp = createCardListConfigApp({
  id: "nihility-ship-classes-config",
  title: "Configurar Classes de Nave",
  settingsKey: "shipClassesData",
  width: 720,
  addLabel: "+ Nova Classe",
  hint: CLASS_HINT,
  getActiveList: () => getVesselClasses("ship"),
  renderCard: values => renderClass(values, "ship"),
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
  renderCard: values => renderClass(values, "vehicle"),
  readCard: readClass
});

/* ------------------------------------------------------------------ Portes */

const SIZE_FIELDS = [
  ["weaponBudget", "Espaço de Arma", "Cada Arma ocupa (Porte dela + 1): Compacta 1, Standard 2…"],
  ["distributorBaseline", "Distribuidor (Fator 1)", "Teto de energia por rodada com um Distribuidor de Fator 1"],
  ["conduitCapacitor", "Reserva sem Bateria", "Carga dos conduítes do casco. Uma Bateria substitui este valor: mantenha abaixo de 125 (a menor Bateria) pra instalar nunca piorar"],
  ["move", "Casas por rodada", "Com o Motor do tamanho esperado a 100% (Movimento e Evasão de naves)"],
  ["evasion", "Evasão %", "Com o Motor do tamanho esperado a 100% (Movimento e Evasão de naves)"],
  ["massReference", "Carga que pesa (kg)", "Carga no porão que corta o desempenho do Motor pela metade"]
];

function renderSize(values) {
  const rankOptions = MEU_SISTEMA.MODULE_SIZES.map((s, i) => [String(i), MEU_SISTEMA.MODULE_SIZE_LABELS[s]]);
  const numbers = SIZE_FIELDS
    .map(([field, label, hint]) => `<label title="${escapeHtml(hint)}">${label} <input type="number" min="0" data-field="${field}" value="${values[field] ?? 0}"/></label>`)
    .join("");
  return `
    <div class="card-config-row card-config-row-main">
      <input type="text" data-field="id" value="${escapeHtml(values.id)}" placeholder="id (ex: medio)"/>
      <input type="text" data-field="label" value="${escapeHtml(values.label)}" placeholder="Nome (ex: Médio)"/>
    </div>
    <div class="card-config-row">
      <label title="Maior Porte de Módulo instalável; também é o Motor de referência e a régua do Raio Trator">Módulos até <select data-field="rank">${optionsHtml(rankOptions, String(values.rank ?? 0))}</select></label>
    </div>
    <div class="card-config-row">${numbers}</div>`;
}

function readSize(card) {
  const get = f => card.querySelector(`[data-field="${f}"]`)?.value ?? "";
  const id = get("id").trim();
  if (!id) return null;
  const entry = { id, label: get("label").trim() || id, rank: Math.round(Number(get("rank")) || 0) };
  for (const [field] of SIZE_FIELDS) entry[field] = Math.max(0, Number(get(field)) || 0);
  return entry;
}

const SIZE_HINT =
  "Porte é o <strong>tamanho</strong>; a Classe é o tipo. A lista vai do menor pro maior — é essa ordem que a " +
  "faixa de Porte das Classes usa. Cada Porte guarda os próprios números. A Escala de cada Porte fica em " +
  "Configurações Gerais › Escalas. Mudar o id de um Porte em uso faz as Naves dele voltarem aos números padrão " +
  "até você escolher outro Porte na ficha; nada é apagado.";

export const ShipSizesConfigApp = createCardListConfigApp({
  id: "nihility-ship-sizes-config",
  title: "Configurar Portes de Nave",
  settingsKey: "shipSizesData",
  width: 760,
  addLabel: "+ Novo Porte",
  hint: SIZE_HINT,
  getActiveList: () => getVesselSizes("ship"),
  renderCard: renderSize,
  readCard: readSize
});

export const VehicleSizesConfigApp = createCardListConfigApp({
  id: "nihility-vehicle-sizes-config",
  title: "Configurar Portes de Veículo",
  settingsKey: "vehicleSizesData",
  width: 760,
  addLabel: "+ Novo Porte",
  hint: `${SIZE_HINT} Veículo tem a lista própria: um tanque grande não é uma nave pequena.`,
  getActiveList: () => getVesselSizes("vehicle"),
  renderCard: renderSize,
  readCard: readSize
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

/* ------------------------------------------------------------------ Tipos de Munição */

export const AmmoTypesConfigApp = createListConfigApp({
  id: "nihility-ammo-types-config",
  title: "Configurar Tipos de Munição",
  settingsKey: "ammoTypesData",
  width: 440,
  hint:
    "Compatibilidade é pelo <strong>tipo</strong>: o lançador marca quais tipos aceita (\"Torpedo, Mina\") e a munição " +
    "tem um tipo. Mudar o id de um tipo em uso tira aquela munição dos lançadores até voltar.",
  fields: [
    { key: "id", label: "ID", type: "text", placeholder: "id (ex: torpedo)" },
    { key: "label", label: "Nome", type: "text", placeholder: "Nome exibido" }
  ],
  getActiveList: getAmmoTypes
});
