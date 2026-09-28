/**
 * Ponto único de acesso às APIs do Foundry que o V13 moveu pra dentro de namespaces
 * (`foundry.applications.*`, `foundry.documents.collections.*`, `foundry.utils.*`).
 *
 * O sistema exige **Foundry V13+** (`system.json` → `compatibility.minimum`), então aqui não
 * existe fallback pros nomes globais antigos (`renderTemplate`, `FilePicker`, `TextEditor`,
 * `CompendiumCollection`, `Actors`/`Items`, `saveDataToFile`/`readTextFromFile`): todos eles
 * eram shims de depreciação que somem numa versão futura, e continuar chamando-os só adiava o
 * problema enquanto poluía o console de aviso.
 *
 * **Regra ao mexer no sistema:** nunca chame essas APIs direto — importe o helper equivalente
 * daqui. Quando o Foundry mover algo de lugar de novo, é este o único arquivo a mudar.
 */

/** Renderiza um template Handlebars. */
export function renderSystemTemplate(path, data) {
  return foundry.applications.handlebars.renderTemplate(path, data);
}

/**
 * Registra templates como partials do Handlebars, com nome curto: `{nome: caminho}` vira
 * `{{> nome}}` nos templates. Chamado no `init`.
 */
export function registerSystemPartials(partials) {
  return foundry.applications.handlebars.loadTemplates(partials);
}

/** Classe de FilePicker a instanciar. */
export function filePickerClass() {
  return foundry.applications.apps.FilePicker.implementation;
}

/**
 * Abre o seletor de arquivo de imagem e chama `onPick(caminho)` na escolha — usado por toda
 * ficha que deixa trocar o retrato/ícone clicando nele.
 */
export function pickImageFile(current, onPick) {
  const FilePickerClass = filePickerClass();
  new FilePickerClass({ type: "image", current, callback: onPick }).render(true);
}

/** Implementação de TextEditor. */
export function textEditor() {
  return foundry.applications.ux.TextEditor.implementation;
}

/**
 * Lê os dados de um evento de drag&drop (Item/Actor/JournalEntry arrastado da barra lateral).
 * Devolve `null` em vez de lançar quando o payload não é um documento do Foundry — quem chama
 * está sempre num handler de `drop`, onde qualquer coisa pode ser arrastada pra cima da janela.
 */
export function getDragEventData(event) {
  try {
    return textEditor().getDragEventData(event) ?? null;
  } catch (err) {
    return null;
  }
}

/** Classe CompendiumCollection (criação de Compêndios de World). */
export function compendiumCollectionClass() {
  return foundry.documents.collections.CompendiumCollection;
}

/** Coleção de Actors do mundo — usada só pra (des)registrar Sheets no `init`. */
export function actorsCollection() {
  return foundry.documents.collections.Actors;
}

/** Coleção de Items do mundo — usada só pra (des)registrar Sheets no `init`. */
export function itemsCollection() {
  return foundry.documents.collections.Items;
}

/** Classe base de ficha de Actor do core, pra desregistrar antes de registrar a do sistema. */
export function coreActorSheetClass() {
  return foundry.appv1.sheets.ActorSheet;
}

/** Classe base de ficha de Item do core, pra desregistrar antes de registrar a do sistema. */
export function coreItemSheetClass() {
  return foundry.appv1.sheets.ItemSheet;
}

/** Salva um texto como download no navegador. */
export function saveTextToFile(text, mimeType, fileName) {
  return foundry.utils.saveDataToFile(text, mimeType, fileName);
}

/** Lê um `File` escolhido pelo usuário como texto. */
export function readFileAsText(file) {
  return foundry.utils.readTextFromFile(file);
}

/* ------------------------------------------------------------------ Active Effect (V13 × V14) */

/**
 * A V14 moveu as mudanças do Active Effect de `changes` (com `mode` numérico) para
 * `system.changes` (com `type` em texto: add, multiply, override…); o formato antigo ainda
 * funciona, mas está depreciado. Todo o sistema fala em `{key, mode, value}` (os modos de
 * `CONST.ACTIVE_EFFECT_MODES`) e só este bloco traduz.
 */
const EFFECT_MODES_FALLBACK = Object.freeze({ CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 });
const CHANGE_TYPE_BY_MODE = { 0: "custom", 1: "multiply", 2: "add", 3: "downgrade", 4: "upgrade", 5: "override" };
const MODE_BY_CHANGE_TYPE = Object.fromEntries(Object.entries(CHANGE_TYPE_BY_MODE).map(([mode, type]) => [type, Number(mode)]));

/** Os modos numéricos (os do Foundry, ou os mesmos valores se a constante sumir numa versão futura). */
export function effectModes() {
  return globalThis.CONST?.ACTIVE_EFFECT_MODES ?? EFFECT_MODES_FALLBACK;
}

/** Geração do Foundry em uso (13, 14…). */
export function foundryGeneration() {
  return Number(globalThis.game?.release?.generation) || 13;
}

/**
 * Os dados de mudança de um Active Effect no formato da versão: `{changes}` na V13,
 * `{system: {changes}}` com `type` na V14. Pura (a geração é parâmetro).
 * @param {Array<{key: string, mode: number, value: *}>} changes
 */
export function buildEffectChanges(changes, generation = foundryGeneration()) {
  const list = (changes ?? []).map(c => ({ key: c.key, mode: Number(c.mode), value: String(c.value) }));
  if (generation >= 14) {
    return { system: { changes: list.map(c => ({ key: c.key, type: CHANGE_TYPE_BY_MODE[c.mode] ?? "add", value: c.value })) } };
  }
  return { changes: list };
}

/** As mudanças de um Active Effect (documento ou dados), nos dois formatos, como `{key, mode, value}`. Pura. */
export function readEffectChanges(effect) {
  const v14 = effect?.system?.changes;
  const source = Array.isArray(v14) && v14.length ? v14 : effect?.changes ?? [];
  return Array.from(source).map(c => ({
    key: c.key,
    mode: c.mode ?? MODE_BY_CHANGE_TYPE[c.type] ?? EFFECT_MODES_FALLBACK.ADD,
    value: c.value
  }));
}

/**
 * Cria Active Effects. Se a versão recusar o formato novo, tenta de novo no antigo (que a V14
 * ainda aceita) em vez de perder o efeito.
 */
export async function createActiveEffects(parent, dataList) {
  try {
    return await parent.createEmbeddedDocuments("ActiveEffect", dataList);
  } catch (err) {
    if (!dataList.some(d => d?.system?.changes)) throw err;
    console.warn("nihility-rpg-system | Formato novo de Active Effect recusado; usando o antigo.", err);
    return parent.createEmbeddedDocuments(
      "ActiveEffect",
      dataList.map(d => {
        const { system, ...rest } = d;
        return { ...rest, changes: readEffectChanges({ system }) };
      })
    );
  }
}
