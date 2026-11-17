import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SNAPSHOTS, snapshotsToPrune, snapshotsForActor, embeddedPlan, actorRestoreUpdate, snapshotLabel, snapshotSummary
} from "../module/world/actor-snapshot-rules.js";

const point = (id, when, actorUuid = "Actor.a") => ({ id, when, actorUuid });

test("snapshotsToPrune: guarda os 10 mais novos e manda apagar o resto", () => {
  const list = Array.from({ length: 13 }, (_, i) => point(`p${i}`, `2026-11-${String(i + 1).padStart(2, "0")}T10:00:00Z`));
  const drop = snapshotsToPrune(list);
  assert.equal(MAX_SNAPSHOTS, 10);
  assert.deepEqual(drop.sort(), ["p0", "p1", "p2"]);
  assert.deepEqual(snapshotsToPrune(list.slice(0, 10)), []);
  assert.deepEqual(snapshotsToPrune([]), []);
  assert.deepEqual(snapshotsToPrune(list, 12), ["p0"]);
});

test("snapshotsForActor: filtra a ficha e ordena do mais novo", () => {
  const list = [point("a", "2026-11-01T00:00:00Z"), point("b", "2026-11-03T00:00:00Z"), point("c", "2026-11-02T00:00:00Z", "Actor.outra")];
  assert.deepEqual(snapshotsForActor(list, "Actor.a").map(e => e.id), ["b", "a"]);
});

test("embeddedPlan: remove o que sobrou, recria o que faltava, reescreve o que existe — mesmos ids", () => {
  const saved = [{ _id: "i1", name: "Espada" }, { _id: "i2", name: "Escudo" }, { _id: "i3", name: "Poção" }];
  const plan = embeddedPlan(["i2", "i3", "i9"], saved);
  assert.deepEqual(plan.remove, ["i9"]);
  assert.deepEqual(plan.create.map(d => d._id), ["i1"]);
  assert.deepEqual(plan.update.map(d => d._id), ["i2", "i3"]);
  const same = embeddedPlan(["i1"], [{ _id: "i1" }]);
  assert.deepEqual(same, { remove: [], create: [], update: [{ _id: "i1" }] });
  assert.deepEqual(embeddedPlan([], []), { remove: [], create: [], update: [] });
});

test("actorRestoreUpdate: nome, imagem, sistema e flags do sistema; chave a mais sai", () => {
  const saved = {
    _id: "x", name: "Kael", img: "a.png", type: "character", sort: 5, folder: "f", ownership: { default: 0 }, _stats: {},
    items: [{ _id: "i" }], effects: [], prototypeToken: { name: "t" },
    system: { attributes: { level: 4 } },
    flags: { nihility: { keep: 1, both: 2 }, outro: { z: 1 } }
  };
  const current = { name: "Kael II", flags: { nihility: { both: 9, extra: true } } };
  const { update, removeFlagKeys } = actorRestoreUpdate(saved, current, "nihility");
  assert.equal(update.name, "Kael");
  assert.equal(update.img, "a.png");
  assert.deepEqual(update.system, { attributes: { level: 4 } });
  assert.deepEqual(update.flags, { nihility: { keep: 1, both: 2 } });
  assert.deepEqual(removeFlagKeys, ["extra"]);
  for (const out of ["_id", "_stats", "folder", "sort", "ownership", "items", "effects", "prototypeToken", "type"]) assert.ok(!(out in update), `${out} não é reescrito`);
});

test("actorRestoreUpdate: ponto sem flags do sistema só marca o que apagar", () => {
  const { update, removeFlagKeys } = actorRestoreUpdate({ name: "A", system: {} }, { flags: { nihility: { a: 1, b: 2 } } }, "nihility");
  assert.ok(!("flags" in update));
  assert.deepEqual(removeFlagKeys.sort(), ["a", "b"]);
});

test("snapshotLabel e snapshotSummary", () => {
  const label = snapshotLabel({ when: new Date(2026, 10, 16, 14, 5).toISOString(), reason: "Antes de evoluir Bola de Fogo" });
  assert.equal(label, "16/11 14:05 · Antes de evoluir Bola de Fogo");
  assert.equal(snapshotLabel({}), "— · Estado salvo");
  assert.equal(snapshotSummary({ items: [1, 2], effects: [1], system: { attributes: { level: 4 } } }), "2 item(ns) · 1 efeito(s) · nível 4");
  assert.equal(snapshotSummary({}), "0 item(ns) · 0 efeito(s)");
});
