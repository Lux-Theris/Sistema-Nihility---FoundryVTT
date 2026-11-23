import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { releaseManifest, referencedPaths } from "../scripts/build-release.mjs";

const base = {
  id: "x", version: "1.2.3", title: "T",
  esmodules: ["module/a.js"], styles: ["styles/a.css"],
  languages: [{ lang: "en", path: "lang/en.json" }],
  manifest: "https://raw.example/main/system.json",
  download: "https://example/main.zip"
};

test("releaseManifest: download fixo na versão e manifest em latest", () => {
  const out = releaseManifest(base, "dono/repo");
  assert.equal(out.download, "https://github.com/dono/repo/releases/download/v1.2.3/nihility-rpg-system.zip");
  assert.equal(out.manifest, "https://github.com/dono/repo/releases/latest/download/system.json");
});

test("releaseManifest: o resto fica igual e o original não é mutado", () => {
  const copy = structuredClone(base);
  const out = releaseManifest(base, "dono/repo");
  assert.deepEqual(base, copy);
  const { manifest: _m, download: _d, ...restOut } = out;
  const { manifest: _m2, download: _d2, ...restBase } = base;
  assert.deepEqual(restOut, restBase);
});

test("referencedPaths: pastas base mais o que o system.json cita", () => {
  const paths = referencedPaths({ ...base, readme: "README.md" });
  for (const p of ["module", "templates", "styles", "lang", "README.md", "lang/en.json"]) assert.ok(paths.includes(p), p);
});
