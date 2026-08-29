import { getActiveDamageElements } from "../config.js";
import { createListConfigApp } from "./list-config-app-factory.js";

/**
 * Editor visual dos Tipos de Dano Elemental (substitui o campo de JSON cru). Cada linha: id
 * interno, nome exibido, cor (usada como flavor no chat). Gerada por createListConfigApp — ver
 * list-config-app-factory.js.
 */
export const DamageElementsConfigApp = createListConfigApp({
  id: "nihility-damage-elements-config",
  title: "Configurar Tipos de Dano",
  settingsKey: "damageElementsData",
  width: 480,
  fields: [
    { key: "id", label: "ID", type: "text", placeholder: "id (ex: fire)" },
    { key: "label", label: "Nome", type: "text", placeholder: "Nome exibido" },
    { key: "color", label: "Cor", type: "color", default: "#c084fc" }
  ],
  getActiveList: getActiveDamageElements
});
