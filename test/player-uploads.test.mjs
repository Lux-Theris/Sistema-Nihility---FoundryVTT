import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  playerFolder, folderChain, fileExtension, uploadFileName, normalizePath, pathInFolder, displayName,
  galleryEntries, blankMimeFor, imageUsage, addRemoved
} from "../module/helpers/player-uploads-rules.js";

const FOLDER = "worlds/dharmein/nihility-jogadores/u1";

test("pasta do jogador e a cadeia a garantir", () => {
  assert.equal(playerFolder("dharmein", "u1"), FOLDER);
  assert.deepEqual(folderChain("dharmein", "u1"), ["worlds/dharmein/nihility-jogadores", FOLDER]);
});

test("nome gravado: simplificado, com sufixo, mantém a extensão", () => {
  assert.equal(uploadFileName("Retrato do Kaitô.PNG", "abcdefghijklmnop"), "retrato-do-kaito-abcdefghijklmnop.png");
  assert.equal(uploadFileName("###.webp", "x1"), "imagem-x1.webp");
  assert.equal(uploadFileName("sem-extensao", "x1"), "sem-extensao-x1.png");
  assert.equal(fileExtension("a.JPEG"), "jpeg");
});

test("caminho dentro da pasta: só arquivo direto, sem subir nem descer", () => {
  assert.ok(pathInFolder(`${FOLDER}/a.png`, FOLDER));
  assert.ok(pathInFolder(`/${FOLDER}/a%20b.png`, FOLDER));
  assert.ok(!pathInFolder(`${FOLDER}/../u2/a.png`, FOLDER));
  assert.ok(!pathInFolder(`${FOLDER}/sub/a.png`, FOLDER));
  assert.ok(!pathInFolder(`${FOLDER}2/a.png`, FOLDER));
  assert.ok(!pathInFolder(FOLDER, FOLDER));
  assert.equal(normalizePath("\\worlds//x/a%20b.png"), "worlds/x/a b.png");
});

test("galeria: só imagens da pasta e sem as apagadas", () => {
  const files = [`${FOLDER}/lobo-abcdefghijklmnop.png`, `${FOLDER}/nota.txt`, `${FOLDER}/anim.gif`, "worlds/dharmein/outra/x.png"];
  const list = galleryEntries(files, [`${FOLDER}/anim.gif`], FOLDER);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "lobo");
  assert.equal(list[0].canDelete, true);
  assert.equal(galleryEntries([`${FOLDER}/a.gif`], [], FOLDER)[0].canDelete, false);
  assert.equal(displayName(`${FOLDER}/sem-sufixo.png`), "sem-sufixo");
});

test("apagar: formatos que viram um pixel em branco", () => {
  assert.equal(blankMimeFor("a.jpg"), "image/jpeg");
  assert.equal(blankMimeFor("a.webp"), "image/webp");
  assert.equal(blankMimeFor("a.svg"), null);
});

test("quem usa a imagem e a lista de apagados", () => {
  const docs = [{ name: "Kaito", imgs: [`${FOLDER}/a.png`, "icons/x.svg"] }, { name: "Token de Kaito", imgs: [`/${FOLDER}/a.png`] }, { name: "Outro", imgs: [""] }];
  assert.deepEqual(imageUsage(`${FOLDER}/a.png`, docs), ["Kaito", "Token de Kaito"]);
  assert.deepEqual(addRemoved(["a", "b"], "a"), ["b", "a"]);
  assert.equal(addRemoved(Array.from({ length: 600 }, (_, i) => `p${i}`), "x").length, 500);
});
