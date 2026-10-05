/**
 * Moedas e Escalas de fábrica.
 * Dados puros, referenciados por MEU_SISTEMA (core/config/constants.js); importe de
 * `core/config.js`. Separado em 1.68.0 sem mudar nenhum valor.
 */

/**
 * Conjunto padrão de moedas, sobrescrito pela setting `currenciesData` (JSON).
 * `baseValue`: quantas "unidades-base" 1 unidade dessa moeda vale — permite
 * converter automaticamente entre quaisquer duas moedas da lista, mesmo com
 * hierarquias arbitrárias definidas pelo Mestre (ex: Moeda/Fita/Barra por metal).
 */
export const DEFAULT_CURRENCIES = [
  { id: "gold", label: "Ouro", icon: "icons/commodities/currency/coins-plain-gold.webp", weight: 0.02, baseValue: 100 },
  { id: "silver", label: "Prata", icon: "icons/commodities/currency/coin-embossed-crown-silver.webp", weight: 0.02, baseValue: 10 },
  { id: "copper", label: "Cobre", icon: "icons/commodities/currency/coins-copper-various.webp", weight: 0.02, baseValue: 1 }
];

/**
 * Escala (Pessoal → Veículo → Nave → Capital): dano entre escalas diferentes é multiplicado ou
 * dividido pelo fator a cada degrau (ver `scaleMultiplier` em damage-rules.js). A ordem da
 * lista É a ordem dos degraus. Porte de Nave/Veículo aponta pra uma escala.
 */
export const DEFAULT_SCALES = {
  scales: [
    { id: "personal", label: "Pessoal" },
    { id: "vehicle", label: "Veículo" },
    { id: "ship", label: "Nave" },
    { id: "capital", label: "Capital" }
  ],
  shipSizeMap: { mini: "vehicle", pequeno: "vehicle", medio: "ship", grande: "ship", capital: "capital" },
  vehicleSizeMap: { mini: "vehicle", pequeno: "vehicle", medio: "vehicle", grande: "vehicle", colossal: "vehicle" }
};
