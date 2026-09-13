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
