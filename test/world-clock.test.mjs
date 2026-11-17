import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  clockParts, formatClock, formatHour, timeAt, normalizeClockConfig, isDayAt, darknessFor, isDarkLevel,
  darknessNeedsUpdate, adjustedDarkness, restHours, sleepUntil, shouldWake, groupSleepState, skipLabel, visibleHour
} from "../module/core/world-clock-rules.js";
import { matchesWhen, sumConditionalModifiers, WHEN_KINDS, SELF_WHEN_KINDS } from "../module/combat/conditional-modifiers.js";
import { MEU_SISTEMA, isWorldClockEnabled, isTrapsEnabled } from "../module/core/config.js";

const H = 3600;

test("clockParts e formatClock: dia 1 começa em 0 s", () => {
  assert.deepEqual({ ...clockParts(0), hourFloat: 0 }, { day: 1, hour: 0, minute: 0, hourFloat: 0 });
  const p = clockParts(86400 + 14 * H + 5 * 60);
  assert.equal(p.day, 2);
  assert.equal(p.hour, 14);
  assert.equal(p.minute, 5);
  assert.equal(formatClock(86400 + 14 * H + 5 * 60), "Dia 2 · 14:05");
  assert.equal(formatHour(9 * H), "09:00");
  assert.equal(formatHour(Number.NaN), "00:00");
});

test("timeAt é o inverso de clockParts", () => {
  const t = timeAt(3, 7, 30);
  const p = clockParts(t);
  assert.equal(p.day, 3);
  assert.equal(p.hour, 7);
  assert.equal(p.minute, 30);
});

test("normalizeClockConfig: padrões e limites", () => {
  const c = normalizeClockConfig({});
  assert.equal(c.sunrise, 6);
  assert.equal(c.sunset, 18);
  assert.equal(c.nightDarkness, 0.8);
  assert.equal(c.darkThreshold, 50);
  assert.equal(c.shortRestHours, 1);
  assert.equal(c.longRestHours, 8);
  const odd = normalizeClockConfig({ sunrise: 20, sunset: 4, nightDarkness: 5, darkThreshold: -3 });
  assert.equal(odd.sunrise, 4);
  assert.equal(odd.sunset, 20);
  assert.equal(odd.nightDarkness, 1);
  assert.equal(odd.darkThreshold, 0);
});

test("isDayAt: dia entre o nascer e o pôr do sol; o pôr do sol já é noite", () => {
  assert.equal(isDayAt(6 * H), true);
  assert.equal(isDayAt(12 * H), true);
  assert.equal(isDayAt(17.99 * H), true);
  assert.equal(isDayAt(18 * H), false);
  assert.equal(isDayAt(3 * H), false);
  assert.equal(isDayAt(86400 + 12 * H), true);
  assert.equal(isDayAt(10 * H, { sunrise: 11, sunset: 20 }), false);
});

test("darknessFor: 0 de dia, a da noite no escuro, rampa de 1 h no crepúsculo", () => {
  assert.equal(darknessFor(12 * H), 0);
  assert.equal(darknessFor(23 * H), 0.8);
  assert.equal(darknessFor(2 * H), 0.8);
  assert.equal(darknessFor(18.5 * H), 0.4);
  assert.equal(darknessFor(5.5 * H), 0.4);
  assert.equal(darknessFor(23 * H, { nightDarkness: 0.5 }), 0.5);
});

test("isDarkLevel e darknessNeedsUpdate", () => {
  assert.equal(isDarkLevel(0.5, 50), true);
  assert.equal(isDarkLevel(0.49, 50), false);
  assert.equal(isDarkLevel(0.3, 25), true);
  assert.equal(darknessNeedsUpdate(0.4, 0.41), false);
  assert.equal(darknessNeedsUpdate(0.4, 0.5), true);
});

test("adjustedDarkness segue os modos das Regiões de escuridão do core", () => {
  assert.equal(adjustedDarkness(0.2, []), 0.2);
  assert.equal(adjustedDarkness(0.2, [{ mode: 0, modifier: 0.9 }]), 0.9);
  assert.equal(adjustedDarkness(0.8, [{ mode: 1, modifier: 0.5 }]), 0.4);
  assert.equal(Math.round(adjustedDarkness(0.5, [{ mode: 2, modifier: 0.5 }]) * 1000) / 1000, 0.75);
  assert.equal(adjustedDarkness(0.4, [{ mode: 0, modifier: 1 }, { mode: 1, modifier: 0.5 }]), 0.5);
});

test("descanso: horas, hora de acordar e quando acorda", () => {
  assert.equal(restHours("short"), 1);
  assert.equal(restHours("long"), 8);
  assert.equal(restHours("long", { longRestHours: 6 }), 6);
  assert.equal(sleepUntil(100 * H, "long"), 108 * H);
  assert.equal(shouldWake(108 * H, 107 * H), false);
  assert.equal(shouldWake(108 * H, 108 * H), true);
  assert.equal(shouldWake(undefined, 5), false);
});

test("groupSleepState: só avisa quando TODOS dormem, e quanto falta", () => {
  const now = 100 * H;
  const some = groupSleepState([{ sleeping: true, until: now + 8 * H }, { sleeping: false }], now);
  assert.equal(some.all, false);
  assert.equal(some.skipSeconds, 0);
  const all = groupSleepState([{ sleeping: true, until: now + 8 * H }, { sleeping: true, until: now + 1 * H }], now);
  assert.equal(all.all, true);
  assert.equal(all.skipHours, 8);
  assert.equal(groupSleepState([], now).all, false);
  assert.equal(skipLabel(8 * H), "Passar o tempo (8 h)");
  assert.equal(skipLabel(2.2 * H), "Passar o tempo (3 h)");
  assert.equal(skipLabel(20 * 60), "Passar o tempo (20 min)");
});

test("visibleHour: o aparelho tecnológico suprimido mostra --:--", () => {
  assert.equal(visibleHour(14 * H), "14:00");
  assert.equal(visibleHour(14 * H, { techSuppressed: true }), "--:--");
});

test("Quando → Então: selfDark, isDay e isNight leem o contexto e são condições de si", () => {
  assert.ok(WHEN_KINDS.includes("selfDark") && WHEN_KINDS.includes("isDay") && WHEN_KINDS.includes("isNight"));
  for (const kind of ["selfDark", "isDay", "isNight"]) assert.ok(SELF_WHEN_KINDS.includes(kind), `${kind} é condição de si`);
  assert.equal(matchesWhen({ kind: "isDay" }, { isDay: true }), true);
  assert.equal(matchesWhen({ kind: "isDay" }, { isDay: false }), false);
  assert.equal(matchesWhen({ kind: "isNight" }, { isNight: true }), true);
  assert.equal(matchesWhen({ kind: "selfDark" }, { isDark: true }), true);
  assert.equal(matchesWhen({ kind: "selfDark" }, {}), false);
  const mods = [{ when: { kind: "isNight" }, then: { kind: "attributeFlat", target: "any", value: 3 } }];
  assert.equal(sumConditionalModifiers(mods, "attributeFlat", { isNight: true }, { attribute: "strength" }), 3);
  assert.equal(sumConditionalModifiers(mods, "attributeFlat", { isNight: false }, { attribute: "strength" }), 0);
});

test("blocos novos: Relógio e Armadilhas existem, no grupo Mundo, ligados e leves", () => {
  for (const key of ["worldClock", "traps"]) {
    const feature = MEU_SISTEMA.FEATURES[key];
    assert.ok(feature, key);
    assert.equal(feature.group, "world");
    assert.equal(feature.default, true);
    assert.equal(feature.heavy, false);
    assert.ok(feature.short.length <= 90);
  }
  assert.equal(isWorldClockEnabled(), true);
  assert.equal(isTrapsEnabled(), true);
});

test("a Condição Dormindo existe de fábrica e incapacita", () => {
  const sleeping = MEU_SISTEMA.DEFAULT_STATUS_CONDITIONS.find(c => c.id === "sleeping");
  assert.ok(sleeping);
  assert.equal(sleeping.incapacitates, true);
});
