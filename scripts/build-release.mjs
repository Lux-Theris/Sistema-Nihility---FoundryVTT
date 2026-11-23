#!/usr/bin/env node
/**
 * Monta o pacote de Release do sistema em `dist/` (sem dependências; o zip é feito pelo workflow).
 *
 *   node scripts/build-release.mjs [dono/repositorio]
 *
 * Gera `dist/nihility-rpg-system/` (só os arquivos do sistema: system.json + tudo que ele cita,
 * mais module/, templates/, styles/ e lang/) e `dist/system.json` (arquivo solto da Release).
 * Nas duas cópias, `manifest` aponta para a última Release e `download` para o zip DAQUELA versão.
 * O `system.json` da raiz não é alterado.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_REPO = "Lux-Theris/Sistema-Nihility---FoundryVTT";
const ZIP_NAME = "nihility-rpg-system.zip";
const BASE_ENTRIES = ["module", "templates", "styles", "lang"];

/** Cópia do system.json com manifest/download da Release. Pura: não muda o objeto recebido. */
export function releaseManifest(systemJson, repo = DEFAULT_REPO) {
  return {
    ...systemJson,
    manifest: `https://github.com/${repo}/releases/latest/download/system.json`,
    download: `https://github.com/${repo}/releases/download/v${systemJson.version}/${ZIP_NAME}`
  };
}

/** Arquivos/pastas (relativos à raiz) que o system.json cita, além de system.json em si. */
export function referencedPaths(systemJson) {
  const out = new Set(BASE_ENTRIES);
  const add = p => { if (typeof p === "string" && p && !/^[a-z]+:\/\//i.test(p)) out.add(p.replace(/^\.?\//, "")); };
  for (const p of systemJson.esmodules ?? []) add(p);
  for (const p of systemJson.scripts ?? []) add(p);
  for (const p of systemJson.styles ?? []) add(p);
  for (const l of systemJson.languages ?? []) add(l?.path);
  for (const k of systemJson.packs ?? []) add(k?.path);
  add(systemJson.readme);
  return [...out];
}

/** Cópia recursiva à mão: o `fs.cpSync` derrubou o Node (saída 127) neste caminho com acentos no Windows. */
function copyRecursive(from, to) {
  if (statSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) copyRecursive(join(from, name), join(to, name));
  } else {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
}

function build(root, repo) {
  const systemJson = JSON.parse(readFileSync(join(root, "system.json"), "utf8"));
  const dist = join(root, "dist");
  const pkg = join(dist, "nihility-rpg-system");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(pkg, { recursive: true });

  for (const entry of referencedPaths(systemJson)) {
    const from = join(root, entry);
    if (!existsSync(from)) throw new Error(`system.json cita "${entry}", que não existe.`);
    const to = join(pkg, entry);
    copyRecursive(from, to);
  }

  const text = JSON.stringify(releaseManifest(systemJson, repo), null, 2) + "\n";
  writeFileSync(join(pkg, "system.json"), text);
  writeFileSync(join(dist, "system.json"), text);
  console.log(`Pacote v${systemJson.version} montado em ${dist}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const root = join(fileURLToPath(import.meta.url), "..", "..");
  build(root, process.argv[2] || process.env.GITHUB_REPOSITORY || DEFAULT_REPO);
}
