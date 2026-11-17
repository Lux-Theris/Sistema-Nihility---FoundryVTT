/**
 * Pasta de imagens de cada jogador (1.94.1) — a parte pura. Sem Foundry; testada em
 * test/player-uploads.test.mjs. O lado Foundry está em player-uploads.js.
 *
 * O servidor do Foundry (conferido no 14.368, dist/files/local.mjs e dist/files/files.mjs) deixa
 * quem tem "Enviar arquivos" enviar para qualquer pasta que JÁ EXISTA em Data, mas criar pasta e
 * listar exigem "Usar o navegador de arquivos". Então o Mestre cria a pasta e lista por ela (relay),
 * e o jogador envia direto. Apagar não existe no Foundry: sobrescrever uma imagem com outra de mesmo
 * nome é permitido, então "apagar" troca o arquivo por uma imagem de 1 pixel e o esconde da galeria.
 */

/** Pasta-mãe das pastas de jogador, dentro do mundo. */
export const PLAYERS_DIR = "nihility-jogadores";

/** Formatos que sabemos "apagar" (gerar um pixel em branco do mesmo tipo com um canvas). */
const BLANKABLE = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Extensões de imagem que a galeria mostra. */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|svg|bmp|tiff?)$/i;

/** A pasta do jogador `userId` no mundo `worldId`. */
export function playerFolder(worldId, userId) {
  return `worlds/${worldId}/${PLAYERS_DIR}/${userId}`;
}

/** As pastas a garantir, de fora para dentro (a mãe, depois a do jogador). */
export function folderChain(worldId, userId) {
  return [`worlds/${worldId}/${PLAYERS_DIR}`, playerFolder(worldId, userId)];
}

/** Extensão em minúsculas, sem o ponto ("" se não houver). */
export function fileExtension(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name ?? ""));
  return match ? match[1].toLowerCase() : "";
}

/**
 * Nome com que o arquivo é gravado: o nome original simplificado (sem acento, espaço nem símbolo)
 * mais um sufixo aleatório, para dois envios de "retrato.png" não se sobrescreverem.
 */
export function uploadFileName(originalName, randomId) {
  const ext = fileExtension(originalName) || "png";
  const base = String(originalName ?? "")
    .replace(/\.[^.]*$/, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "imagem";
  return `${base}-${randomId}.${ext}`;
}

/** Caminho limpo para comparar: sem `%xx`, sem barras repetidas nem no começo. */
export function normalizePath(path) {
  let text = String(path ?? "");
  try { text = decodeURIComponent(text); } catch { /* fica como veio */ }
  return text.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+/, "");
}

/** `path` é um arquivo direto dentro de `folder` (sem subir com `..` nem descer a subpastas)? */
export function pathInFolder(path, folder) {
  const p = normalizePath(path);
  const f = normalizePath(folder).replace(/\/+$/, "");
  if (!f || !p.startsWith(`${f}/`)) return false;
  const rest = p.slice(f.length + 1);
  return rest.length > 0 && !rest.includes("/") && rest !== "." && rest !== "..";
}

/** Nome mostrado na galeria: o original, sem o sufixo aleatório que o envio pôs. */
export function displayName(path) {
  const file = normalizePath(path).split("/").pop() ?? "";
  return file.replace(/\.[^.]*$/, "").replace(/-[a-z0-9]{16}$/i, "") || file;
}

/**
 * As imagens que a galeria mostra: só arquivos de imagem da pasta, menos os "apagados".
 * @param {string[]} files - caminhos que o Mestre listou
 * @param {string[]} removed - caminhos já apagados (flag do usuário)
 * @param {string} folder - a pasta do jogador (o resto é ignorado)
 */
export function galleryEntries(files, removed, folder) {
  const gone = new Set((removed ?? []).map(normalizePath));
  return (files ?? [])
    .map(normalizePath)
    .filter(p => IMAGE_EXT.test(p) && pathInFolder(p, folder) && !gone.has(p))
    .map(path => ({ path, name: displayName(path), canDelete: Boolean(blankMimeFor(path)) }));
}

/** O tipo de imagem em branco que sobrescreve `path`, ou null (formato que não sabemos gerar). */
export function blankMimeFor(path) {
  return BLANKABLE[fileExtension(path)] ?? null;
}

/**
 * Quem ainda usa a imagem: lista de nomes cujas imagens (`imgs`) são `path`.
 * @param {string} path
 * @param {{name: string, imgs: string[]}[]} docs
 */
export function imageUsage(path, docs) {
  const target = normalizePath(path);
  const names = [];
  for (const doc of docs ?? []) {
    if ((doc.imgs ?? []).some(img => img && normalizePath(img) === target)) names.push(doc.name);
  }
  return [...new Set(names)];
}

/** A lista de apagados com `path` (sem repetir), limitada aos 500 mais novos. */
export function addRemoved(removed, path) {
  const list = (removed ?? []).filter(p => p !== path);
  list.push(path);
  return list.slice(-500);
}
