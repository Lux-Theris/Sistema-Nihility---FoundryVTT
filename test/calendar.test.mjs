import "./setup.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  floorDiv, floorMod, CALENDAR_MODELS, buildCalendarModel, normalizeCalendar, calendarProblems, secondsPerDay, isLeapYear,
  daysInYear, daysBeforeYear, eraOfYear, eraYearToYear, timeToDate, dateToTime, formatTimeOfDay, formatDate, formatDateShort,
  formatDateTimeShort, unitSeconds, rateFromUnits, validRate, clampRate, composeRate, formatCount, humanDuration, describeRate,
  outsideSeconds, formatElapsed, normalizeTrack, rewindSegment, trackValue, trackRebase, trackSetValue, trackAdd, normalizeTimelines,
  resolveLine, lineExists, removeLine, combatHoldsWorld, rewindDecision, yearLengths, rateInputs, deviceLocalNow, syncAge, deviceDrift, MAIN_LINE_ID,
  TIME_RATE_BEHAVIOR, normalizeChamber, chamberSummary, combatRateChoice, heldOutsideAdd, chamberResultText, ageYears
} from "../module/core/calendar-rules.js";

const greg = () => normalizeCalendar(buildCalendarModel("gregorian"));
const fantasy = () => normalizeCalendar(buildCalendarModel("fantasy"));
const scifi = () => normalizeCalendar(buildCalendarModel("scifi"));

test("piso e módulo com negativos", () => {
  assert.equal(floorDiv(-1, 7), -1);
  assert.equal(floorMod(-1, 7), 6);
  assert.equal(floorMod(-14, 7), 0);
  assert.equal(floorMod(8, 7), 1);
});

test("normalizeCalendar: vazio vira Gregoriano; meses e números saneados", () => {
  const c = normalizeCalendar(null);
  assert.equal(c.months.length, 12);
  assert.equal(secondsPerDay(c), 86400);
  const odd = normalizeCalendar({ months: [{ name: "Único", days: -5 }], hoursPerDay: 0, weekdays: ["  ", "Dia"], eras: [{ name: "B", start: 10 }, { name: "A", start: -3 }] });
  assert.equal(odd.months[0].days, 1);
  assert.equal(odd.hoursPerDay, 1);
  assert.deepEqual(odd.weekdays, ["Dia"]);
  assert.deepEqual(odd.eras.map(e => e.name), ["A", "B"]);
  assert.deepEqual(calendarProblems({ months: [] }).length, 1);
  assert.deepEqual(calendarProblems({ months: [{ name: "x", days: 3 }] }), []);
});

test("bissexto: a cada N anos desde X; nunca com 0; negativos", () => {
  const c = greg();
  assert.equal(isLeapYear(c, 2024), true);
  assert.equal(isLeapYear(c, 2023), false);
  assert.equal(isLeapYear(c, -4), true);
  assert.equal(isLeapYear(c, -3), false);
  assert.equal(daysInYear(c, 2024), 366);
  assert.equal(daysInYear(c, 2023), 365);
  const never = normalizeCalendar({ ...buildCalendarModel("gregorian"), leap: { every: 0, from: 0 } });
  assert.equal(isLeapYear(never, 2024), false);
  const from = normalizeCalendar({ ...buildCalendarModel("gregorian"), leap: { every: 5, from: 3 } });
  assert.equal(isLeapYear(from, 3), true);
  assert.equal(isLeapYear(from, 8), true);
  assert.equal(isLeapYear(from, -2), true);
  assert.equal(isLeapYear(from, 4), false);
});

test("tempo 0 é o dia 1 do ano inicial, 00:00", () => {
  const c = greg();
  const p = timeToDate(c, 0);
  assert.equal(p.year, 1);
  assert.equal(p.monthIndex, 0);
  assert.equal(p.day, 1);
  assert.equal(p.hour, 0);
  assert.equal(formatTimeOfDay(c, 14 * 3600 + 5 * 60), "14:05");
});

test("ida e volta: dateToTime ↔ timeToDate, inclusive anos negativos e bissextos", () => {
  for (const c of [greg(), fantasy(), scifi()]) {
    for (const year of [-1203, -5, -4, 0, 1, 3, 4, 5, 703, 1203, 2024, 99999]) {
      for (const [month, day] of [[1, 1], [2, 28], [5, 17], [12, 30]]) {
        const t = dateToTime(c, { year, month, day, hour: 13, minute: 7, second: 9 });
        const p = timeToDate(c, t);
        assert.equal(p.year, year, `${c.name} ${year}`);
        assert.equal(p.monthIndex + 1, month);
        assert.equal(p.day, day);
        assert.equal(p.hour, 13);
        assert.equal(p.minute, 7);
        assert.equal(p.second, 9);
      }
    }
  }
});

test("dia bissexto existe só em ano bissexto; o dia seguinte vira o mês", () => {
  const c = greg();
  const d29 = dateToTime(c, { year: 2024, month: 2, day: 29 });
  assert.equal(timeToDate(c, d29).day, 29);
  assert.equal(timeToDate(c, d29 + 86400).monthIndex, 2);
  const clamp = dateToTime(c, { year: 2023, month: 2, day: 29 });
  assert.equal(timeToDate(c, clamp).day, 28);
  assert.equal(daysBeforeYear(c, 2025) - daysBeforeYear(c, 2024), 366);
  assert.equal(daysBeforeYear(c, -3) - daysBeforeYear(c, -4), 366);
});

test("um segundo antes do tempo 0 é o último instante do ano anterior", () => {
  const c = greg();
  const p = timeToDate(c, -1);
  assert.equal(p.year, 0);
  assert.equal(p.monthIndex, 11);
  assert.equal(p.day, 31);
  assert.equal(p.hour, 23);
  assert.equal(p.second, 59);
});

test("dia da semana certo com tempo negativo (o do core erra)", () => {
  const c = greg();
  // dia 0 = Domingo (weekdayStart 0); -1 dia = Sábado.
  assert.equal(timeToDate(c, 0).weekday, 0);
  assert.equal(timeToDate(c, -1).weekday, 6);
  assert.equal(timeToDate(c, -86400 * 7).weekday, 0);
  assert.equal(timeToDate(c, -86400 * 8).weekday, 6);
  const f = fantasy();
  assert.equal(timeToDate(f, -86400).weekday, 5);
  assert.equal(timeToDate(scifi(), 100000).weekday, -1);
});

test("eras: dentro, antes da primeira (conta para trás) e sem eras", () => {
  const f = fantasy();
  assert.deepEqual({ ...eraOfYear(f, 1203), name: undefined }, { name: undefined, abbr: "E.C.", year: 1203, index: 0 });
  assert.equal(eraOfYear(f, 1).year, 1);
  const before = eraOfYear(f, 0);
  assert.equal(before.abbr, "A.C.");
  assert.equal(before.year, 1);
  assert.equal(eraOfYear(f, -119).year, 120);
  assert.equal(eraYearToYear(f, 0, 1203), 1203);
  assert.equal(eraYearToYear(f, -1, 120), -119);
  const two = normalizeCalendar({ ...buildCalendarModel("fantasy"), eras: [{ name: "Velha", abbr: "V", start: -500 }, { name: "Nova", abbr: "N", start: 100 }] });
  assert.equal(eraOfYear(two, 99).abbr, "V");
  assert.equal(eraOfYear(two, 99).year, 600);
  assert.equal(eraOfYear(two, 100).abbr, "N");
  assert.equal(eraYearToYear(two, 1, 3), 102);
  const none = normalizeCalendar({ ...buildCalendarModel("fantasy"), eras: [] });
  assert.equal(eraOfYear(none, -7).year, -7);
});

test("formatos: data, curto, estelar", () => {
  const f = fantasy();
  const t = dateToTime(f, { year: 1203, month: 4, day: 14, hour: 14, minute: 5 });
  assert.match(formatDate(f, t), /^[A-Za-zÁ-ú]+, 14 de Florescer de 1203 E\.C\.$/);
  assert.equal(formatDateShort(f, t), "14 Flo 1203 E.C.");
  assert.equal(formatDateTimeShort(f, t), "14 Flo 1203 E.C. · 14:05");
  const old = dateToTime(f, { year: -119, month: 1, day: 3 });
  assert.match(formatDate(f, old, { weekday: false }), /^3 de Geada de 120 A\.C\.$/);
  const s = scifi();
  const st = dateToTime(s, { year: 2203, month: 1, day: 1 });
  assert.equal(formatDate(s, st), "2203.000");
  const mid = dateToTime(s, { year: 2203, month: 7, day: 1 });
  assert.match(formatDate(s, mid), /^2203\.\d{3}$/);
  assert.ok(Number(formatDate(s, mid).split(".")[1]) > 400);
});

test("trocar o modelo substitui meses, dias e eras", () => {
  const f = fantasy();
  assert.equal(f.months.length, 12);
  assert.equal(f.months[0].days, 30);
  assert.equal(f.weekdays.length, 6);
  assert.equal(CALENDAR_MODELS.scifi.calendar.format, "stellar");
  const a = buildCalendarModel("fantasy");
  a.months[0].name = "X";
  assert.equal(buildCalendarModel("fantasy").months[0].name, "Geada");
});

test("horas por dia diferentes", () => {
  const c = normalizeCalendar({ ...buildCalendarModel("fantasy"), hoursPerDay: 20, minutesPerHour: 50, secondsPerMinute: 30 });
  assert.equal(secondsPerDay(c), 20 * 50 * 30);
  const t = dateToTime(c, { year: 5, month: 1, day: 2, hour: 19, minute: 49, second: 29 });
  const p = timeToDate(c, t);
  assert.deepEqual([p.day, p.hour, p.minute, p.second], [2, 19, 49, 29]);
  assert.equal(timeToDate(c, t + 1).day, 3);
});

test("ritmo: limites, composição, unidades e texto", () => {
  assert.equal(clampRate(0), 1);
  assert.equal(clampRate(-3), 1);
  assert.equal(clampRate("abc"), 1);
  assert.equal(clampRate(1e9), 1e6);
  assert.equal(clampRate(1e-20), 1e-10);
  assert.equal(validRate(1e-11), false);
  assert.equal(validRate(0.5), true);
  assert.equal(composeRate([]), 1);
  assert.equal(composeRate([0.5, 2, 0.5]), 0.5);
  assert.equal(composeRate([0.5, NaN, -4, undefined]), 0.5);
  assert.equal(composeRate([1e-8, 1e-8]), 1e-10);
  const c = greg();
  assert.equal(unitSeconds(c, "day"), 86400);
  assert.equal(unitSeconds(c, "year"), Math.round(86400 * 365.25));
  assert.equal(unitSeconds(c, "week"), 7 * 86400);
  const r = rateFromUnits(c, { value: 1, unit: "day" }, { value: 1, unit: "year" });
  assert.ok(Math.abs(r - 1 / 365.25) < 1e-6);
  assert.equal(rateFromUnits(c, { value: 0, unit: "day" }, { value: 1, unit: "year" }), 1);
  assert.equal(describeRate(c, 1), "Normal");
  assert.equal(describeRate(c, 1 / (unitSeconds(c, "year") * 10)), "1 s dentro = 10 anos fora");
  assert.match(describeRate(c, 3600), /^1 s fora = 1 hora dentro$/);
  assert.equal(formatCount(36000), "36 mil");
  assert.equal(formatCount(2.5), "2,5");
  assert.equal(humanDuration(c, 3600 * 2), "2 horas");
  assert.equal(outsideSeconds(0.1, 18), 180);
  assert.equal(outsideSeconds(1, 18), 18);
});

test("formatElapsed", () => {
  const c = greg();
  assert.equal(formatElapsed(c, 2 * 3600 + 15 * 60), "2 h 15 min");
  assert.equal(formatElapsed(c, 40 * 60), "40 min");
  assert.equal(formatElapsed(c, 3 * 86400 + 6 * 3600), "3 d 6 h");
  assert.equal(formatElapsed(c, 0), "agora");
});

test("trechos: valor, ritmo, rebase sem salto, ajustar, somar", () => {
  assert.equal(trackValue(null, 500), 500);
  const t = { base: 1000, worldAt: 100, rate: 2 };
  assert.equal(trackValue(t, 100), 1000);
  assert.equal(trackValue(t, 150), 1100);
  const re = trackRebase(t, 150, { rate: 0.5 });
  assert.deepEqual(re, { base: 1100, worldAt: 150, rate: 0.5 });
  assert.equal(trackValue(re, 150), 1100);
  assert.equal(trackValue(re, 250), 1150);
  const set = trackSetValue(re, 250, -5000);
  assert.equal(trackValue(set, 250), -5000);
  assert.equal(set.rate, 0.5);
  const add = trackAdd(re, 250, 60);
  assert.equal(trackValue(add, 250), 1150 + 60);
  assert.equal(trackValue(trackAdd(re, 250, -60), 250), 1150, "a rodada de combate nunca subtrai");
  const back = rewindSegment(re, 100, 250);
  assert.equal(trackValue(back, 250), 1050);
  assert.equal(trackValue(back, 350), 1100, "o ritmo continua depois de voltar");
  assert.equal(trackValue(rewindSegment(re, -5, 250), 250), 1150);
  assert.equal(normalizeTrack({ rate: 0 }).rate, 1);
  const slow = { base: 0, worldAt: 0, rate: 1 / (86400 * 365.25 * 10) };
  assert.equal(trackValue(slow, 1), 0);
  assert.equal(trackValue({ base: 5, worldAt: 0, rate: 1e-10 }, 1e9), 5);
});

test("linhas do tempo: principal sempre existe, ritmo 1, apagar devolve", () => {
  assert.deepEqual(normalizeTimelines(undefined).map(l => l.id), [MAIN_LINE_ID]);
  const lines = normalizeTimelines([
    { id: "arden", name: "Passado de Arden", base: -5, worldAt: 10, rate: 0.5, combatWorld: "atEnd" },
    { id: "main", name: "", rate: 99 },
    { id: "arden" },
    { name: "sem id" }
  ]);
  assert.deepEqual(lines.map(l => l.id), ["main", "arden"]);
  assert.equal(lines[0].rate, 1);
  assert.equal(lines[0].name, "Linha principal");
  assert.equal(lines[1].combatWorld, "atEnd");
  assert.equal(resolveLine(lines, "arden").rate, 0.5);
  assert.equal(resolveLine(lines, "sumiu").id, MAIN_LINE_ID);
  assert.equal(lineExists(lines, "sumiu"), false);
  assert.deepEqual(removeLine(lines, "arden").map(l => l.id), ["main"]);
  assert.deepEqual(removeLine(lines, "main").map(l => l.id), ["main", "arden"]);
  assert.equal(normalizeTimelines([{ id: "x", combatWorld: "qualquer" }])[1].combatWorld, "stop");
});

test("combate e guarda de retrocesso", () => {
  assert.equal(combatHoldsWorld(1), false);
  assert.equal(combatHoldsWorld(0.5), true);
  assert.equal(combatHoldsWorld(2), true);
  assert.equal(rewindDecision({ dt: 10 }), "ignore");
  assert.equal(rewindDecision({ dt: -10800 }), "warn");
  assert.equal(rewindDecision({ dt: -10800, marked: true }), "ignore");
  assert.equal(rewindDecision({ dt: -6, inCombat: true, roundTime: 6, combatants: 3 }), "ignore");
  assert.equal(rewindDecision({ dt: -18, inCombat: true, roundTime: 6, combatants: 3 }), "ignore");
  assert.equal(rewindDecision({ dt: -19, inCombat: true, roundTime: 6, combatants: 3 }), "warn");
  assert.equal(rewindDecision({ dt: -6, inCombat: false }), "warn");
});

test("aparelho: sincronização + tempo pessoal", () => {
  assert.equal(deviceLocalNow(null, 500, 9000), 9000);
  assert.equal(deviceLocalNow({ local: 1000, personalAt: 200 }, 200, 99999), 1000);
  assert.equal(deviceLocalNow({ local: 1000, personalAt: 200 }, 8300, 99999), 9100);
  assert.equal(deviceLocalNow({ local: 1000, personalAt: 200 }, 100, 99999), 900, "se o tempo pessoal voltar, o aparelho volta junto");
  assert.equal(syncAge({ local: 0, personalAt: 200 }, 8300), 8100);
  assert.equal(syncAge(null, 5), 0);
  assert.equal(syncAge({ local: 0, personalAt: 200 }, 100), -100);
  assert.equal(deviceDrift(100, 100), 0);
  assert.equal(deviceDrift(100, 4000), -3900);
});

test("yearLengths e rateInputs (ida e volta com rateFromUnits)", () => {
  assert.deepEqual(yearLengths(fantasy()), { common: 360, leap: 361 });
  assert.deepEqual(yearLengths(normalizeCalendar({ ...buildCalendarModel("fantasy"), leap: { every: 0, from: 0 } })), { common: 360, leap: null });
  const c = greg();
  for (const rate of [1, 1 / 365.25 / 86400, 0.25, 3600, 1e-9]) {
    const { inside, outside } = rateInputs(c, rate);
    const back = rateFromUnits(c, inside, outside);
    assert.ok(Math.abs(back / rate - 1) < 0.01, `${rate} → ${back}`);
  }
  assert.deepEqual(rateInputs(c, 1).inside, { value: 1, unit: "day" });
});

test("câmara: dados saneados e resumo de várias Regiões", () => {
  assert.equal(TIME_RATE_BEHAVIOR, "nihilityTimeRate");
  assert.deepEqual(normalizeChamber({ rate: 0, combatWorld: "x", network: 1 }), { rate: 1, combatWorld: "stop", network: true });
  assert.equal(normalizeChamber({ rate: 1e-20 }).rate, 1e-10);
  assert.equal(normalizeChamber({ rate: 5e9 }).rate, 1e6);
  assert.deepEqual(chamberSummary([]), { rate: 1, combatWorld: "", network: false, count: 0 });
  const two = chamberSummary([{ rate: 0.5, combatWorld: "atEnd" }, { rate: 4, combatWorld: "atEnd", network: true }]);
  assert.equal(two.rate, 2);
  assert.equal(two.combatWorld, "atEnd");
  assert.equal(two.network, true);
  assert.equal(chamberSummary([{ rate: 0.5, combatWorld: "atEnd" }, { rate: 2, combatWorld: "stop" }]).combatWorld, "stop");
  // Região de ritmo 1 só dá rede: não decide o combate.
  assert.equal(chamberSummary([{ rate: 1, combatWorld: "stop", network: true }]).combatWorld, "");
});

test("combate com ritmos diferentes: vale a maioria; empate fica com a cena", () => {
  const scene = { rate: 1, combatWorld: "stop" };
  assert.deepEqual(combatRateChoice([], scene), scene);
  const slow = { rate: 0.001, combatWorld: "atEnd" };
  assert.deepEqual(combatRateChoice([slow, slow, { rate: 1, combatWorld: "stop" }], scene), { rate: 0.001, combatWorld: "atEnd" });
  assert.equal(combatRateChoice([slow, { rate: 1, combatWorld: "stop" }], scene).rate, 1, "empate: o ritmo da cena");
  assert.equal(combatRateChoice([slow, { rate: 5, combatWorld: "stop" }], scene).rate, 0.001, "empate sem o da cena: o primeiro");
  assert.equal(combatRateChoice([slow, { rate: 0.001, combatWorld: "stop" }, slow], scene).combatWorld, "stop", "no grupo, parar vence");
  assert.ok(Math.abs(combatRateChoice([{ rate: 0.1 + 0.2 }, { rate: 0.3 }, { rate: 5 }], scene).rate - 0.3) < 1e-9, "ritmos iguais por arredondamento são o mesmo grupo");
});

test("anda no fim: soma sem arredondar a cada rodada", () => {
  let held = 0;
  for (let i = 0; i < 4; i += 1) held = heldOutsideAdd(held, 1e6, 6);
  assert.ok(Math.abs(held - 24e-6) < 1e-12);
  assert.equal(Math.round(heldOutsideAdd(0, 0.001, 6)), 6000);
  assert.equal(heldOutsideAdd(5, 2, 0), 5);
  assert.equal(heldOutsideAdd(undefined, 2, -3), 0);
});

test("frase do editor da Região", () => {
  const c = greg();
  assert.match(chamberResultText(c, 1), /normal/i);
  assert.match(chamberResultText(c, rateFromUnits(c, { value: 1, unit: "second" }, { value: 10, unit: "year" })), /1 hora aqui volta e lá fora passaram .*anos/);
  assert.match(chamberResultText(c, 3600 * 24), /menos de 1 segundo/);
  assert.match(chamberResultText(c, 2), /30 minutos/);
});

test("idade pelo tempo pessoal", () => {
  const c = greg();
  const year = unitSeconds(c, "year");
  assert.equal(ageYears(c, { start: null, at: 0 }, 5), null);
  assert.equal(ageYears(c, { start: "", at: 0 }, 5), null);
  assert.equal(ageYears(c, { start: 22, at: 1000 }, 1000), 22);
  assert.equal(ageYears(c, { start: 22, at: 1000 }, 1000 + year - 1), 22);
  assert.equal(ageYears(c, { start: 22, at: 1000 }, 1000 + year), 23);
  assert.equal(ageYears(c, { start: 22, at: 1000 }, 1000 + year * 10.5), 32);
  assert.equal(ageYears(c, { start: 22, at: 1000 }, 1000 - year), 21, "o tempo pessoal voltou: a idade cai junto");
  assert.equal(ageYears(c, { start: 1, at: 0 }, -year * 5), 0, "nunca abaixo de 0");
  assert.equal(ageYears(c, { start: 30 }, 12345), 30, "sem o carimbo, vale a idade ao começar");
});
