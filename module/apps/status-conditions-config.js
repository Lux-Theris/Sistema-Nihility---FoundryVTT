import { getActiveStatusConditions } from "../config.js";
import { createListConfigApp } from "./list-config-app-factory.js";

/**
 * Editor visual das Condições de Status (Cegueira, Veneno, Atordoamento...) usadas pelas
 * entradas de `effects[]` de uma Skill (ver skill-editor-dialog.js). Cada linha: id interno,
 * nome exibido, ícone (com FilePicker). Gerada por createListConfigApp — ver
 * list-config-app-factory.js.
 */
export const StatusConditionsConfigApp = createListConfigApp({
  id: "nihility-status-conditions-config",
  title: "Configurar Condições de Status",
  settingsKey: "statusConditionsData",
  width: 520,
  hint:
    "Configure as Condições de Status disponíveis nos Efeitos Temporários de Skills (Cegueira, " +
    "Veneno, Atordoamento...). O <strong>id</strong> é a chave interna (sem espaços, ex: " +
    "<code>poison</code>). Escolher uma Condição numa entrada de Efeito dá ícone reconhecível no " +
    "token do alvo — o Mestre decide na mesa o que a condição impede além do número configurado.",
  fields: [
    { key: "id", label: "ID", type: "text", placeholder: "id (ex: poison)" },
    { key: "label", label: "Nome", type: "text", placeholder: "Nome exibido" },
    { key: "icon", label: "Ícone", type: "icon", placeholder: "Caminho do ícone", default: "icons/svg/aura.svg" }
  ],
  getActiveList: getActiveStatusConditions
});
