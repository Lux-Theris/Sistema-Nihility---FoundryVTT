import { getActiveTraits } from "../config.js";
import { createListConfigApp } from "./list-config-app-factory.js";

/**
 * Editor do catálogo de Traços (Dracônico, Voador, Orgânico…). Espécies dão Traços a quem as tem,
 * e a ficha pode acrescentar ou retirar. Elementos ("+20% contra Orgânico") e Modificadores
 * Condicionais ("Caçador de Dragões") olham os Traços do alvo.
 */
export const TraitsConfigApp = createListConfigApp({
  id: "nihility-traits-config",
  title: "Configurar Traços",
  settingsKey: "traitsData",
  width: 460,
  hint:
    "Traços são etiquetas de criatura (<code>draconic</code>, <code>flying</code>…). Cada Espécie escolhe os seus em " +
    "<strong>Espécies</strong>, e a ficha pode acrescentar ou retirar. Mudar o <strong>id</strong> de um Traço que já " +
    "está em uso desliga ele de quem o tinha.",
  fields: [
    { key: "id", label: "ID", type: "text", placeholder: "id (ex: draconic)" },
    { key: "label", label: "Nome", type: "text", placeholder: "Nome exibido" }
  ],
  getActiveList: getActiveTraits
});
