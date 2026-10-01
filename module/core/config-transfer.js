/**
 * Exportar/Importar TODA a configuração do sistema: catálogos (moedas, espécies, Traços, tipos de
 * dano, Condições, Categorias de Módulo, Classes, Postos, Estruturas, Escalas, atributos), os
 * interruptores de Módulos do Sistema com seus campos e as regras numéricas. É o que permite
 * configurar um mundo e levar pra outro.
 *
 * Fica de fora o que é por navegador (`scope: "client"`: chave e endpoint de IA, modo Debug —
 * a chave de IA nunca pode viajar num arquivo compartilhável) e o registro de migrações já
 * feitas (é do mundo, não da configuração).
 *
 * Parte pura (formato, compatibilidade com o arquivo antigo, diferença) testada em
 * test/rules.test.mjs; a parte que lê/grava settings e mostra diálogo fica nas funções abaixo.
 */

export const TRANSFER_FORMAT = 2;
const EXCLUDED_KEYS = new Set(["completedMigrations"]);

/** As 4 chaves do formato antigo (antes de exportar "tudo"), guardadas já parseadas. */
const LEGACY_KEYS = ["currenciesData", "speciesPresetsData", "damageElementsData", "statusConditionsData"];

/**
 * Normaliza um arquivo importado pro mapa `{chave: valorGuardado}`. Aceita o formato atual
 * (`settings`) e o antigo (4 listas soltas, parseadas). `null` se não for arquivo do sistema.
 * @param {object} bundle
 * @param {string} systemId
 * @returns {Record<string, *>|null}
 */
export function readTransferBundle(bundle, systemId) {
  if (!bundle || typeof bundle !== "object") return null;
  if (bundle._system && bundle._system !== systemId) return null;
  if (bundle.settings && typeof bundle.settings === "object") {
    return Object.fromEntries(Object.entries(bundle.settings).filter(([key]) => !EXCLUDED_KEYS.has(key)));
  }
  const legacy = LEGACY_KEYS.filter(key => key in bundle);
  if (!legacy.length) return null;
  // No formato antigo as listas vinham parseadas; a setting guarda texto JSON.
  return Object.fromEntries(legacy.map(key => [key, typeof bundle[key] === "string" ? bundle[key] : JSON.stringify(bundle[key], null, 2)]));
}

/** Monta o arquivo de exportação. */
export function buildTransferBundle(values, systemId, version) {
  return { _system: systemId, _format: TRANSFER_FORMAT, _version: version, _exportedAt: new Date().toISOString(), settings: values };
}

/** Compara dois valores de setting (texto JSON é comparado pelo conteúdo, não pela formatação). */
function sameValue(a, b) {
  const norm = v => {
    if (typeof v === "string") {
      try {
        return JSON.stringify(JSON.parse(v));
      } catch (err) {
        return v;
      }
    }
    return JSON.stringify(v);
  };
  return norm(a) === norm(b);
}

/**
 * O que muda ao importar: uma linha por chave do arquivo que existe no mundo, marcando se o
 * valor é diferente do atual. Chave desconhecida (de uma versão mais nova) é ignorada.
 * @returns {Array<{key:string, changed:boolean}>}
 */
export function diffTransfer(current, incoming) {
  return Object.keys(incoming)
    .filter(key => key in current)
    .map(key => ({ key, changed: !sameValue(current[key], incoming[key]) }));
}

/** Grupo de uma chave, pra organizar os diálogos. */
export function transferGroup(key, featureSettingKeys) {
  if (featureSettingKeys.has(key)) return "Módulos do Sistema";
  if (key.endsWith("Data")) return "Catálogos";
  return "Regras";
}
