import { getActiveCurrencies } from "../config.js";
import { createListConfigApp } from "./list-config-app-factory.js";

/**
 * Editor visual das Moedas Dinâmicas (substitui o campo de JSON cru). Cada linha é uma moeda:
 * id interno, nome exibido, ícone (com FilePicker), peso e Valor-Base (usado pra converter
 * automaticamente entre quaisquer duas moedas — ex: Cobre=1, Prata=10, Ouro=100 já dá conversão
 * correta em qualquer direção). Gerada por createListConfigApp — ver list-config-app-factory.js.
 */
export const CurrencyConfigApp = createListConfigApp({
  id: "nihility-currency-config",
  title: "Configurar Moedas",
  settingsKey: "currenciesData",
  width: 560,
  hint:
    "Configure as moedas usadas na aba Economia das fichas. O <strong>id</strong> é a chave interna " +
    "(sem espaços, ex: <code>gold</code>). O <strong>Valor-Base</strong> é o que permite converter " +
    "automaticamente entre quaisquer duas moedas — ex: Cobre=1, Prata=10, Ouro=100 já dá 1 Ouro = 10 " +
    "Prata = 100 Cobre em qualquer direção, mesmo com quantas moedas/hierarquias você quiser.",
  fields: [
    { key: "id", label: "ID", type: "text", placeholder: "id (ex: gold)" },
    { key: "label", label: "Nome", type: "text", placeholder: "Nome exibido" },
    {
      key: "icon",
      label: "Ícone",
      type: "icon",
      placeholder: "Caminho do ícone",
      default: "icons/commodities/currency/coins-plain-various.webp"
    },
    { key: "weight", label: "Peso", type: "number", step: 0.01, default: 0.02 },
    { key: "baseValue", label: "Valor-Base", type: "number", step: 0.01, default: 1 }
  ],
  getActiveList: getActiveCurrencies
});
