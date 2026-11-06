#!/usr/bin/env node
/**
 * Verificação única do sistema (backlog H19). Roda tudo que precisa passar antes de considerar
 * uma mudança pronta, sem dependências:
 *
 *   node scripts/check.mjs            # tudo
 *   node scripts/check.mjs --no-tests # pula a suíte (mais rápido, só as checagens estáticas)
 *
 * 1. Sintaxe de cada `module/**\/*.js` COMO MÓDULO ES (`node --input-type=module --check`): o
 *    `node --check` sem isso deixa passar erros só de módulo — em 1.37 um import duplicado
 *    derrubou o sistema inteiro e só aparecia como "as fichas sumiram".
 * 2. A suíte `node --test "test/*.test.mjs"`.
 * 3. `system.json`: JSON válido, versão no formato x.y.z, e todo arquivo que ele lista existe
 *    (esmodules, styles, languages).
 * 4. Todo template `.hbs` citado no código existe.
 * 5. Nenhuma folha de `styles/` fica fora do `system.json` (o Foundry só carrega as listadas).
 * 6. Texto com acentuação quebrada ("Ã§", "Ã£"…): aparece quando um script grava UTF-8 como
 *    Latin-1, e passa despercebido até alguém ler a tela.
 *
 * Sai com código 1 se algo falhar.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const args = new Set(process.argv.slice(2));
const failures = [];
const rel = path => relative(ROOT, path).split(sep).join("/");

function walk(dir, filter) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

function step(title) {
  process.stdout.write(`\n▸ ${title}\n`);
}

function fail(what, detail = "") {
  failures.push(what);
  console.log(`  ✗ ${what}${detail ? `\n${detail.replace(/^/gm, "      ")}` : ""}`);
}

/** Checa um arquivo como módulo ES, passando o conteúdo pela entrada padrão. */
function checkModule(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["--input-type=module", "--check"], { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", chunk => (err += chunk));
    child.on("close", code => resolve({ file, ok: code === 0, err }));
    child.stdin.end(readFileSync(file));
  });
}

async function checkSyntax() {
  step("Sintaxe dos módulos (modo módulo ES)");
  const files = walk(join(ROOT, "module"), f => f.endsWith(".js"));
  const queue = [...files];
  const results = [];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) results.push(await checkModule(queue.shift()));
  });
  await Promise.all(workers);
  const bad = results.filter(r => !r.ok);
  for (const r of bad) fail(`sintaxe: ${rel(r.file)}`, r.err.split("\n").filter(Boolean).slice(0, 6).join("\n"));
  if (!bad.length) console.log(`  ✓ ${files.length} arquivos`);
}

function runTests() {
  step("Testes (node --test)");
  const res = spawnSync(process.execPath, ["--test", "test/*.test.mjs"], { cwd: ROOT, encoding: "utf8" });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const pick = key => out.match(new RegExp(`ℹ ${key} (\\d+)`))?.[1];
  if (res.status !== 0) {
    const failed = out.split("\n").filter(line => /^\s*✖/.test(line)).slice(0, 15).join("\n");
    fail(`testes: ${pick("fail") ?? "?"} falharam de ${pick("tests") ?? "?"}`, failed);
  } else {
    console.log(`  ✓ ${pick("pass") ?? "?"} de ${pick("tests") ?? "?"}`);
  }
}

function checkManifest() {
  step("system.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, "system.json"), "utf8"));
  } catch (err) {
    fail("system.json não é JSON válido", String(err.message));
    return null;
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version ?? ""))) fail(`versão estranha: "${manifest.version}"`);
  const listed = [...(manifest.esmodules ?? []), ...(manifest.styles ?? []), ...(manifest.languages ?? []).map(l => l.path)];
  const missing = listed.filter(p => !existsSync(join(ROOT, p)));
  for (const p of missing) fail(`system.json lista um arquivo que não existe: ${p}`);
  if (!missing.length) console.log(`  ✓ versão ${manifest.version}, ${listed.length} arquivos listados existem`);
  return manifest;
}

function checkStylesListed(manifest) {
  step("Folhas de estilo");
  if (!manifest) return;
  const listed = new Set(manifest.styles ?? []);
  const onDisk = readdirSync(join(ROOT, "styles")).filter(f => f.endsWith(".css")).map(f => `styles/${f}`);
  const orphan = onDisk.filter(f => !listed.has(f));
  for (const f of orphan) fail(`folha fora do system.json (o Foundry não carrega): ${f}`);
  if (!orphan.length) console.log(`  ✓ ${onDisk.length} folhas, todas listadas`);
}

function checkTemplates() {
  step("Templates citados no código");
  const files = walk(join(ROOT, "module"), f => f.endsWith(".js"));
  const missing = new Map();
  let count = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/templates\/[\w./-]+\.hbs/g)) {
      count++;
      if (!existsSync(join(ROOT, match[0]))) missing.set(match[0], rel(file));
    }
  }
  for (const [tpl, file] of missing) fail(`template não existe: ${tpl} (citado em ${file})`);
  if (!missing.size) console.log(`  ✓ ${count} citações, todos os arquivos existem`);
}

function checkEncoding() {
  step("Acentuação quebrada (UTF-8 lido como Latin-1)");
  const roots = ["module", "templates", "styles", "lang", "test", "docs"].map(d => join(ROOT, d)).filter(existsSync);
  const exts = [".js", ".mjs", ".hbs", ".css", ".json", ".md", ".svg"];
  const files = [...roots.flatMap(dir => walk(dir, f => exts.some(e => f.endsWith(e)))), join(ROOT, "CLAUDE.md"), join(ROOT, "system.json")];
  // "Ã" seguido de um byte de continuação (0x80–0xBF) é o rastro de "ç", "ã", "é"… mal gravados.
  // "NÃO", "AÇÃO" em maiúsculas legítimas não casam: depois do "Ã" vem uma letra comum.
  const broken = /Ã[\u0080-¿]|Â[\u0080-¿]|â€/;
  let bad = 0;
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    const hit = lines.findIndex(line => broken.test(line));
    if (hit >= 0) {
      bad++;
      fail(`acentuação quebrada: ${rel(file)}:${hit + 1}`, lines[hit].trim().slice(0, 120));
    }
  }
  if (!bad) console.log(`  ✓ ${files.length} arquivos de texto`);
}

const started = Date.now();
await checkSyntax();
const manifest = checkManifest();
checkStylesListed(manifest);
checkTemplates();
checkEncoding();
if (!args.has("--no-tests")) runTests();

const secs = ((Date.now() - started) / 1000).toFixed(1);
if (failures.length) {
  console.log(`\n✗ ${failures.length} problema(s) em ${secs}s.`);
  process.exit(1);
}
console.log(`\n✓ Tudo certo em ${secs}s.`);
