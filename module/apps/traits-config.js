import { getActiveTraits } from "../core/config.js";
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
  width: 640,
  hint:
    "Traços são etiquetas de criatura (<code>draconic</code>, <code>flying</code>…). Cada Espécie escolhe os seus em " +
    "<strong>Espécies</strong>, e a ficha pode acrescentar ou retirar. Mudar o <strong>id</strong> de um Traço que já " +
    "está em uso desliga ele de quem o tinha. As três colunas de <strong>Sorte</strong> (% de inclinação nos dados, negativo = azar) valem para quem tem o Traço, quando o bloco Sorte e azar está ligado.",
  fields: [
    { key: "id", label: "ID", type: "text", placeholder: "id (ex: draconic)" },
    { key: "label", label: "Nome", type: "text", placeholder: "Nome exibido" },
    { key: "luckAttributes", label: "Sorte: atributos (%)", type: "number", default: 0 },
    { key: "luckDamage", label: "Sorte: dano (%)", type: "number", default: 0 },
    { key: "luckChances", label: "Sorte: chances (%)", type: "number", default: 0 }
  ],
  getActiveList: getActiveTraits
});
