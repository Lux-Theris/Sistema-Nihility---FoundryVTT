/**
 * Calendário e linhas do tempo (J9b, 8b.1) — regras puras (sem Foundry), testadas em
 * test/calendar.test.mjs.
 *
 * A conta de datas é só nossa: inteiros, com piso e módulo corretos para negativos (o
 * `timeToComponents` do core erra o dia da semana com tempo negativo e não tem eras). O calendário do
 * core (`CONFIG.time.worldCalendarConfig`) não é tocado.
 *
 * Vocabulário:
 *  - **segundos locais** = segundos desde o início do `startYear` do calendário (dia 1, 00:00);
 *  - **trecho** `{base, worldAt, rate}` = valor(t) = base + (t − worldAt) × rate, em segundos locais,
 *    com t = `game.time.worldTime`. Só se regrava quando o trecho muda (troca de cena, o Mestre muda a
 *    data ou o ritmo): nada grava a cada tick do relógio;
 *  - **ritmo** = segundos que passam dentro por segundo fora (1 normal; 1 s por 10 anos ≈ 3×10⁻⁹).
 */

export const RATE_MIN = 1e-10;
export const RATE_MAX = 1e6;

/* ------------------------------------------------------------------ Inteiros */

export const floorDiv = (a, b) => Math.floor(a / b);
/** Módulo que nunca é negativo (o `%` do JS devolve negativo para dividendo negativo). */
export const floorMod = (a, b) => ((a % b) + b) % b;

const int = (value, fallback, min = -Infinity, max = Infinity) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/* ------------------------------------------------------------------ Modelos */

const MONTH_NAMES_GREGORIAN = [
  ["Janeiro", "Jan", 31, 0], ["Fevereiro", "Fev", 28, 1], ["Março", "Mar", 31, 0], ["Abril", "Abr", 30, 0],
  ["Maio", "Mai", 31, 0], ["Junho", "Jun", 30, 0], ["Julho", "Jul", 31, 0], ["Agosto", "Ago", 31, 0],
  ["Setembro", "Set", 30, 0], ["Outubro", "Out", 31, 0], ["Novembro", "Nov", 30, 0], ["Dezembro", "Dez", 31, 0]
];

const MONTH_NAMES_FANTASY = [
  "Geada", "Degelo", "Semeadura", "Florescer", "Verdejar", "Sol Alto",
  "Colheita", "Dourado", "Ocaso", "Bruma", "Sombra", "Longa Noite"
];

/** Os três modelos de fábrica. `buildCalendarModel` devolve cópia: nunca altere o que ele devolve de MODELS. */
export const CALENDAR_MODELS = {
  gregorian: {
    id: "gregorian",
    label: "Gregoriano",
    calendar: {
      name: "Gregoriano",
      format: "date",
      hoursPerDay: 24,
      minutesPerHour: 60,
      secondsPerMinute: 60,
      startYear: 1,
      weekdayStart: 0,
      months: MONTH_NAMES_GREGORIAN.map(([name, abbr, days, leapDays]) => ({ name, abbr, days, leapDays })),
      weekdays: ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"],
      leap: { every: 4, from: 0 },
      eras: [{ name: "Era Comum", abbr: "d.C.", start: 1 }],
      beforeAbbr: "a.C."
    }
  },
  fantasy: {
    id: "fantasy",
    label: "Fantasia",
    calendar: {
      name: "Fantasia",
      format: "date",
      hoursPerDay: 24,
      minutesPerHour: 60,
      secondsPerMinute: 60,
      startYear: 1,
      weekdayStart: 0,
      months: MONTH_NAMES_FANTASY.map((name, index) => ({ name, abbr: name.slice(0, 3), days: 30, leapDays: index === 11 ? 1 : 0 })),
      weekdays: ["Lua", "Pedra", "Forja", "Vento", "Brasa", "Sábio"],
      leap: { every: 4, from: 0 },
      eras: [{ name: "Era das Coroas", abbr: "E.C.", start: 1 }],
      beforeAbbr: "A.C."
    }
  },
  scifi: {
    id: "scifi",
    label: "Sci-Fi (data estelar)",
    calendar: {
      name: "Sci-Fi",
      format: "stellar",
      hoursPerDay: 24,
      minutesPerHour: 60,
      secondsPerMinute: 60,
      startYear: 2200,
      weekdayStart: 0,
      months: Array.from({ length: 12 }, (_, i) => ({ name: `Ciclo ${i + 1}`, abbr: `C${i + 1}`, days: 30, leapDays: i === 11 ? 1 : 0 })),
      weekdays: [],
      leap: { every: 4, from: 0 },
      eras: [{ name: "Era Estelar", abbr: "E.E.", start: 1 }],
      beforeAbbr: "a.E.E."
    }
  }
};

/** Cópia profunda de um modelo (para o editor trocar o conteúdo sem mexer no original). */
export function buildCalendarModel(id) {
  const model = CALENDAR_MODELS[id] ?? CALENDAR_MODELS.gregorian;
  return JSON.parse(JSON.stringify(model.calendar));
}

/* ------------------------------------------------------------------ Normalização */

/**
 * Calendário limpo: números inteiros dentro de limites, meses sempre ≥ 1, eras ordenadas pelo ano em
 * que começam. Dado vazio ou inválido cai no Gregoriano.
 */
export function normalizeCalendar(raw) {
  const fallback = CALENDAR_MODELS.gregorian.calendar;
  const src = raw && typeof raw === "object" ? raw : {};
  const text = (v, d) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : d);

  let months = (Array.isArray(src.months) ? src.months : [])
    .filter(m => m && typeof m === "object")
    .map((m, i) => {
      const name = text(m.name, `Mês ${i + 1}`);
      return {
        name,
        abbr: text(m.abbr, name.slice(0, 3)),
        days: int(m.days, 30, 1, 1000),
        leapDays: int(m.leapDays, 0, 0, 1000)
      };
    })
    .slice(0, 60);
  if (!months.length) months = fallback.months.map(m => ({ ...m }));

  const weekdays = (Array.isArray(src.weekdays) ? src.weekdays : [])
    .map(w => (typeof w === "string" ? w.trim().slice(0, 40) : ""))
    .filter(Boolean)
    .slice(0, 60);

  const every = int(src.leap?.every, 0, 0, 100000);
  const eras = (Array.isArray(src.eras) ? src.eras : [])
    .filter(e => e && typeof e === "object")
    .map(e => {
      const name = text(e.name, "Era");
      return { name, abbr: text(e.abbr, name.slice(0, 4)), start: int(e.start, 1) };
    })
    .sort((a, b) => a.start - b.start)
    .slice(0, 30);

  return {
    name: text(src.name, fallback.name),
    format: src.format === "stellar" ? "stellar" : "date",
    hoursPerDay: int(src.hoursPerDay, 24, 1, 1000),
    minutesPerHour: int(src.minutesPerHour, 60, 1, 1000),
    secondsPerMinute: int(src.secondsPerMinute, 60, 1, 1000),
    startYear: int(src.startYear, fallback.startYear),
    weekdayStart: weekdays.length ? floorMod(int(src.weekdayStart, 0), weekdays.length) : 0,
    months,
    weekdays,
    leap: { every, from: int(src.leap?.from, 0) },
    eras,
    beforeAbbr: text(src.beforeAbbr, "")
  };
}

/** Problemas que o editor mostra antes de salvar (lista de frases; vazia = pode salvar). */
export function calendarProblems(raw) {
  const problems = [];
  const src = raw && typeof raw === "object" ? raw : {};
  if (!Array.isArray(src.months) || !src.months.length) problems.push("O calendário precisa de pelo menos um mês.");
  for (const m of src.months ?? []) {
    if (!(Number(m?.days) >= 1)) problems.push(`O mês "${m?.name ?? "?"}" precisa de pelo menos 1 dia.`);
  }
  return problems;
}

/* ------------------------------------------------------------------ Tamanhos */

export const secondsPerDay = cal => cal.hoursPerDay * cal.minutesPerHour * cal.secondsPerMinute;
const baseYearDays = cal => cal.months.reduce((n, m) => n + m.days, 0);
const leapExtraDays = cal => cal.months.reduce((n, m) => n + m.leapDays, 0);

/** O ano é bissexto? ("a cada N anos, começando no ano X"; N = 0 nunca.) */
export function isLeapYear(cal, year) {
  const every = cal.leap?.every ?? 0;
  return every > 0 && floorMod(year - (cal.leap.from ?? 0), every) === 0;
}

export function daysInYear(cal, year) {
  return baseYearDays(cal) + (isLeapYear(cal, year) ? leapExtraDays(cal) : 0);
}

export function daysInMonth(cal, year, monthIndex) {
  const m = cal.months[monthIndex];
  return m ? m.days + (isLeapYear(cal, year) ? m.leapDays : 0) : 0;
}

/** Anos bissextos em [a, b). Antissimétrico: com b < a devolve o negativo da contagem em [b, a). */
function leapsInRange(cal, a, b) {
  const every = cal.leap?.every ?? 0;
  if (every <= 0) return 0;
  const from = cal.leap.from ?? 0;
  return floorDiv(b - 1 - from, every) - floorDiv(a - 1 - from, every);
}

/** Dias entre o início do `startYear` e o início do ano `year` (negativo para antes). */
export function daysBeforeYear(cal, year) {
  return (year - cal.startYear) * baseYearDays(cal) + leapExtraDays(cal) * leapsInRange(cal, cal.startYear, year);
}

function yearOfDay(cal, days) {
  const every = cal.leap?.every ?? 0;
  const average = baseYearDays(cal) + (every > 0 ? leapExtraDays(cal) / every : 0);
  let year = cal.startYear + Math.floor(days / (average || 1));
  let guard = 0;
  while (daysBeforeYear(cal, year) > days && guard++ < 1000) year -= 1;
  while (daysBeforeYear(cal, year + 1) <= days && guard++ < 2000) year += 1;
  return year;
}

/* ------------------------------------------------------------------ Eras */

/** A era de um ano: `{name, abbr, year, index}` (`index` −1 = antes da primeira era; sem eras, só o ano). */
export function eraOfYear(cal, year) {
  const eras = cal.eras ?? [];
  if (!eras.length) return { name: "", abbr: "", year, index: -2 };
  let index = -1;
  for (let i = 0; i < eras.length; i++) if (eras[i].start <= year) index = i;
  if (index >= 0) return { name: eras[index].name, abbr: eras[index].abbr, year: year - eras[index].start + 1, index };
  const first = eras[0];
  return {
    name: `Antes da ${first.name}`,
    abbr: cal.beforeAbbr || `a.${first.abbr}`,
    year: first.start - year,
    index: -1
  };
}

/** Ano do calendário a partir da era e do ano dentro dela (o inverso de `eraOfYear`). `eraIndex` −1 = antes da 1ª. */
export function eraYearToYear(cal, eraIndex, eraYear) {
  const eras = cal.eras ?? [];
  const y = int(eraYear, 1);
  if (!eras.length || eraIndex === -2) return y;
  if (eraIndex < 0) return eras[0].start - y;
  const era = eras[Math.min(eraIndex, eras.length - 1)];
  return era.start + y - 1;
}

/* ------------------------------------------------------------------ Segundos ⇄ data */

/**
 * Decompõe segundos locais: ano, mês (0…), dia (1…), dia da semana (índice, −1 sem semana), hora,
 * minuto, segundo, dia do ano (0…), fração do ano (0 ≤ f < 1), fração do dia e a era.
 */
export function timeToDate(cal, seconds) {
  const t = Math.floor(Number.isFinite(Number(seconds)) ? Number(seconds) : 0);
  const spd = secondsPerDay(cal);
  const days = floorDiv(t, spd);
  const inDay = floorMod(t, spd);
  const year = yearOfDay(cal, days);
  const dayOfYear = days - daysBeforeYear(cal, year);
  let rest = dayOfYear;
  let monthIndex = 0;
  for (let i = 0; i < cal.months.length; i++) {
    const len = daysInMonth(cal, year, i);
    if (rest < len || i === cal.months.length - 1) {
      monthIndex = i;
      break;
    }
    rest -= len;
  }
  const secondsPerHour = cal.minutesPerHour * cal.secondsPerMinute;
  const weekday = cal.weekdays.length ? floorMod(days + cal.weekdayStart, cal.weekdays.length) : -1;
  return {
    year,
    monthIndex,
    day: rest + 1,
    weekday,
    hour: floorDiv(inDay, secondsPerHour),
    minute: floorDiv(floorMod(inDay, secondsPerHour), cal.secondsPerMinute),
    second: floorMod(inDay, cal.secondsPerMinute),
    dayOfYear,
    yearFraction: dayOfYear / daysInYear(cal, year),
    dayFraction: inDay / spd,
    era: eraOfYear(cal, year)
  };
}

/**
 * Segundos locais de uma data (mês de 1 a N, dia de 1…). Mês e dia fora do limite são encostados no
 * limite (o Mestre digitou 31 de um mês de 30 dias).
 */
export function dateToTime(cal, { year, month = 1, day = 1, hour = 0, minute = 0, second = 0 } = {}) {
  const y = int(year, cal.startYear);
  const monthIndex = int(month, 1, 1, cal.months.length) - 1;
  const d = int(day, 1, 1, Math.max(1, daysInMonth(cal, y, monthIndex)));
  let days = daysBeforeYear(cal, y);
  for (let i = 0; i < monthIndex; i++) days += daysInMonth(cal, y, i);
  days += d - 1;
  const h = int(hour, 0, 0, cal.hoursPerDay - 1);
  const m = int(minute, 0, 0, cal.minutesPerHour - 1);
  const s = int(second, 0, 0, cal.secondsPerMinute - 1);
  return days * secondsPerDay(cal) + (h * cal.minutesPerHour + m) * cal.secondsPerMinute + s;
}

/* ------------------------------------------------------------------ Texto */

const pad2 = n => String(n).padStart(2, "0");

/** "14:05" na hora do calendário. */
export function formatTimeOfDay(cal, seconds) {
  const p = timeToDate(cal, seconds);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

function stellarText(cal, p) {
  return `${p.year}.${String(Math.min(999, Math.floor(p.yearFraction * 1000))).padStart(3, "0")}`;
}

function eraSuffix(p) {
  return p.era.abbr ? ` ${p.era.abbr}` : "";
}

/** "Terça, 14 de Florescer de 1203 E.C." (ou "1203.371" no formato estelar). */
export function formatDate(cal, seconds, { weekday = true } = {}) {
  const p = timeToDate(cal, seconds);
  if (cal.format === "stellar") return stellarText(cal, p);
  const wd = weekday && p.weekday >= 0 ? `${cal.weekdays[p.weekday]}, ` : "";
  return `${wd}${p.day} de ${cal.months[p.monthIndex].name} de ${p.era.year}${eraSuffix(p)}`;
}

/** "14 Flo 1203 E.C." (curto, para listas). */
export function formatDateShort(cal, seconds) {
  const p = timeToDate(cal, seconds);
  if (cal.format === "stellar") return stellarText(cal, p);
  return `${p.day} ${cal.months[p.monthIndex].abbr} ${p.era.year}${eraSuffix(p)}`;
}

/** "14 Flo 1203 E.C. · 14:05". */
export function formatDateTimeShort(cal, seconds) {
  return `${formatDateShort(cal, seconds)} · ${formatTimeOfDay(cal, seconds)}`;
}

/* ------------------------------------------------------------------ Unidades e ritmo */

export const RATE_UNITS = [
  ["second", "segundo", "segundos"],
  ["minute", "minuto", "minutos"],
  ["hour", "hora", "horas"],
  ["day", "dia", "dias"],
  ["week", "semana", "semanas"],
  ["year", "ano", "anos"]
];

/** Segundos de uma unidade no calendário (semana = os dias da semana do calendário, ou 7; ano = a média). */
export function unitSeconds(cal, unit) {
  const spd = secondsPerDay(cal);
  switch (unit) {
    case "second": return 1;
    case "minute": return cal.secondsPerMinute;
    case "hour": return cal.minutesPerHour * cal.secondsPerMinute;
    case "day": return spd;
    case "week": return spd * (cal.weekdays.length || 7);
    case "year": {
      const every = cal.leap?.every ?? 0;
      return Math.round(spd * (baseYearDays(cal) + (every > 0 ? leapExtraDays(cal) / every : 0)));
    }
    default: return 1;
  }
}

/** Ritmo entre `{value, unit}` dentro e `{value, unit}` fora, já limitado (1 se algo for inválido). */
export function rateFromUnits(cal, inside, outside) {
  const a = Number(inside?.value) * unitSeconds(cal, inside?.unit);
  const b = Number(outside?.value) * unitSeconds(cal, outside?.unit);
  if (!(a > 0) || !(b > 0)) return 1;
  return clampRate(a / b);
}

export function validRate(rate) {
  const n = Number(rate);
  return Number.isFinite(n) && n >= RATE_MIN && n <= RATE_MAX;
}

/** Limita o ritmo a 10⁻¹⁰…10⁶; inválido (0, negativo, texto) vira 1. */
export function clampRate(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, n));
}

/**
 * Compõe fatores de ritmo (o ritmo da linha, e depois a Região e efeitos de tempo, 8b.2): o produto,
 * limitado. Fator inválido (não numérico, ≤ 0) conta como 1.
 */
export function composeRate(factors) {
  let product = 1;
  for (const f of factors ?? []) {
    const n = Number(f);
    if (Number.isFinite(n) && n > 0) product *= n;
  }
  return clampRate(product);
}

/** Um número legível: "36 mil", "2,5", "3,2 milhões". */
export function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  const a = Math.abs(n);
  const round = (v, digits) => String(Math.round(v * 10 ** digits) / 10 ** digits).replace(".", ",");
  if (a >= 1e9) return `${round(n / 1e9, 1)} bilhões`;
  if (a >= 1e6) return `${round(n / 1e6, 1)} milhões`;
  if (a >= 1e4) return `${round(n / 1e3, 1)} mil`;
  if (a >= 100) return round(n, 0);
  if (a >= 10) return round(n, 1);
  return round(n, 2);
}

/** Uma duração em segundos como "N unidade" na maior unidade em que passa de 1. */
export function humanDuration(cal, seconds) {
  const s = Math.abs(Number(seconds) || 0);
  let pick = RATE_UNITS[0];
  for (const entry of RATE_UNITS) if (s >= unitSeconds(cal, entry[0])) pick = entry;
  const value = s / unitSeconds(cal, pick[0]);
  const plural = Math.round(value * 100) / 100 === 1 ? pick[1] : pick[2];
  return `${formatCount(value)} ${plural}`;
}

/** "Normal", "1 s dentro = 10 anos fora" ou "1 s fora = 3 horas dentro". */
export function describeRate(cal, rate) {
  const r = clampRate(rate);
  if (Math.abs(r - 1) < 1e-12) return "Normal";
  if (r < 1) return `1 s dentro = ${humanDuration(cal, 1 / r)} fora`;
  return `1 s fora = ${humanDuration(cal, r)} dentro`;
}

/** Quanto tempo do mundo passa lá fora enquanto `localSeconds` passam dentro de uma linha de ritmo `rate`. */
export function outsideSeconds(rate, localSeconds) {
  return Math.round(Number(localSeconds) / clampRate(rate));
}

/** "2 h 15 min", "40 min", "3 d 6 h": tempo decorrido no calendário (só as duas maiores partes). */
export function formatElapsed(cal, seconds) {
  let s = Math.max(0, Math.floor(Number(seconds) || 0));
  const parts = [];
  const steps = [["a", unitSeconds(cal, "year")], ["d", unitSeconds(cal, "day")], ["h", unitSeconds(cal, "hour")], ["min", unitSeconds(cal, "minute")]];
  for (const [label, size] of steps) {
    if (s >= size) {
      parts.push(`${Math.floor(s / size)} ${label}`);
      s = s % size;
    }
    if (parts.length === 2) break;
  }
  return parts.length ? parts.join(" ") : "agora";
}

/* ------------------------------------------------------------------ Trechos */

/** Trecho limpo (inteiros; ritmo limitado). Sem trecho: identidade (valor = tempo do mundo). */
export function normalizeTrack(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return { base: Math.round(Number(src.base) || 0), worldAt: Math.round(Number(src.worldAt) || 0), rate: clampRate(src.rate ?? 1) };
}

/** Valor do trecho no instante `worldTime` (sem arredondar). */
export function trackExact(track, worldTime) {
  const t = normalizeTrack(track);
  return t.base + (Number(worldTime) - t.worldAt) * t.rate;
}

/** Valor do trecho no instante `worldTime`, em segundos inteiros. */
export function trackValue(track, worldTime) {
  return Math.floor(trackExact(track, worldTime) + 1e-9);
}

/** Novo trecho que parte do valor de agora com outro ritmo (`rate`); o valor não salta. */
export function trackRebase(track, worldTime, { rate } = {}) {
  const t = normalizeTrack(track);
  return { base: Math.round(trackExact(t, worldTime)), worldAt: Math.round(Number(worldTime) || 0), rate: rate === undefined ? t.rate : clampRate(rate) };
}

/** Novo trecho em que o valor de agora é `value` (o Mestre ajusta a data). */
export function trackSetValue(track, worldTime, value) {
  const t = normalizeTrack(track);
  return { base: Math.round(Number(value) || 0), worldAt: Math.round(Number(worldTime) || 0), rate: t.rate };
}

/** Soma `seconds` (≥ 0) ao valor: o tempo vivido (rodada de combate) só anda para a frente. */
export function trackAdd(track, worldTime, seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const rebased = trackRebase(track, worldTime);
  return { ...rebased, base: rebased.base + s };
}

/**
 * Volta o tempo pessoal: o trecho com o `base` diminuído de `seconds` (uma Skill de reverter, 8e).
 * É o ÚNICO caminho que faz o tempo pessoal recuar, e só por chamada explícita; `personalNow` nunca
 * é forçado a ser crescente. O tempo do mundo nunca volta.
 */
export function rewindSegment(track, seconds, worldTime) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const rebased = trackRebase(track, worldTime);
  return { ...rebased, base: rebased.base - s };
}

/* ------------------------------------------------------------------ Linhas do tempo */

export const MAIN_LINE_ID = "main";

export function defaultMainLine() {
  return { id: MAIN_LINE_ID, name: "Linha principal", base: 0, worldAt: 0, rate: 1, combatWorld: "stop" };
}

/**
 * Lista de linhas limpa: a principal sempre existe (ritmo 1, nunca apagada), ids únicos, nomes
 * preenchidos, `combatWorld` "stop" (padrão) ou "atEnd".
 */
export function normalizeTimelines(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim().slice(0, 40) : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const isMain = id === MAIN_LINE_ID;
    const track = normalizeTrack(entry);
    out.push({
      id,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim().slice(0, 60) : isMain ? "Linha principal" : "Linha do tempo",
      base: track.base,
      worldAt: track.worldAt,
      rate: isMain ? 1 : track.rate,
      combatWorld: entry.combatWorld === "atEnd" ? "atEnd" : "stop"
    });
  }
  if (!seen.has(MAIN_LINE_ID)) out.unshift(defaultMainLine());
  else out.sort((a, b) => (a.id === MAIN_LINE_ID ? -1 : b.id === MAIN_LINE_ID ? 1 : 0));
  return out;
}

/** A linha pelo id; um id desconhecido (linha apagada) cai na principal. */
export function resolveLine(lines, id) {
  const list = normalizeTimelines(lines);
  return list.find(line => line.id === id) ?? list[0];
}

/** O id existe na lista? (o Validar Mundo avisa de cena numa linha apagada.) */
export function lineExists(lines, id) {
  return normalizeTimelines(lines).some(line => line.id === id);
}

/** Linhas sem a que foi apagada (a principal nunca sai). */
export function removeLine(lines, id) {
  if (id === MAIN_LINE_ID) return normalizeTimelines(lines);
  return normalizeTimelines((lines ?? []).filter(line => line?.id !== id));
}

/* ------------------------------------------------------------------ Combate e guarda de retrocesso */

/**
 * O combate numa linha de ritmo ≠ 1 não deixa o core somar a rodada ao tempo do mundo (delta 0)?
 * Em ritmo 1 o core segue como sempre.
 */
export function combatHoldsWorld(rate) {
  return Math.abs(clampRate(rate) - 1) > 1e-12;
}

/**
 * O tempo do mundo voltou: avisa o Mestre? Voltar o turno no combate o core também faz (e é marcado
 * `rewind`); sem a marca, um recuo pequeno com combate iniciado é tratado como voltar turno.
 * @returns {"ignore"|"warn"}
 */
export function rewindDecision({ dt, marked = false, inCombat = false, roundTime = 6, combatants = 1 } = {}) {
  if (!(Number(dt) < 0)) return "ignore";
  if (marked) return "ignore";
  if (inCombat && -Number(dt) <= Math.max(1, Number(roundTime) || 6) * Math.max(1, Number(combatants) || 1)) return "ignore";
  return "warn";
}

/* ------------------------------------------------------------------ Sincronização do aparelho */

/**
 * O que um aparelho (PAD, relógio) acha que é agora: a data da última sincronização + o tempo
 * pessoal que passou desde ela. `sync` = `{local, personalAt}`; sem `sync`, o aparelho nasceu
 * sincronizado com `localNow`.
 */
export function deviceLocalNow(sync, personalNow, localNow) {
  if (!sync || !Number.isFinite(Number(sync.local))) return Math.floor(Number(localNow) || 0);
  // Sem clamp: se o tempo pessoal voltar (rewindSegment), o aparelho volta junto.
  return Math.floor(Number(sync.local) + (Number(personalNow) - Number(sync.personalAt || 0)));
}

/** Há quanto tempo (pessoal) o aparelho foi acertado; 0 sem sincronização (negativo se o tempo pessoal voltou). */
export function syncAge(sync, personalNow) {
  if (!sync) return 0;
  return Math.floor(Number(personalNow) - Number(sync.personalAt || 0));
}

/** A diferença entre o que o aparelho acha e a data da cena (segundos; 0 = bate). */
export function deviceDrift(deviceNow, localNow) {
  return Math.floor(Number(deviceNow) - Number(localNow));
}

/* ------------------------------------------------------------------ Para os editores */

/** Dias do ano comum e do bissexto (o "360 dias no ano (361 no bissexto)" do editor). */
export function yearLengths(cal) {
  const common = baseYearDays(cal);
  const extra = leapExtraDays(cal);
  return { common, leap: (cal.leap?.every ?? 0) > 0 && extra > 0 ? common + extra : null };
}

const round3 = v => Math.round(v * 1000) / 1000;

/**
 * Ritmo em campos de "N unidade dentro = M unidade fora" (o inverso de `rateFromUnits`). Normal:
 * 1 dia = 1 dia; lento: 1 segundo dentro e a duração de fora na maior unidade; rápido: o contrário.
 */
export function rateInputs(cal, rate) {
  const r = clampRate(rate);
  if (Math.abs(r - 1) < 1e-12) return { inside: { value: 1, unit: "day" }, outside: { value: 1, unit: "day" } };
  const pick = seconds => {
    let chosen = RATE_UNITS[0][0];
    for (const [unit] of RATE_UNITS) if (seconds >= unitSeconds(cal, unit)) chosen = unit;
    return { value: round3(seconds / unitSeconds(cal, chosen)), unit: chosen };
  };
  return r < 1
    ? { inside: { value: 1, unit: "second" }, outside: pick(1 / r) }
    : { inside: pick(r), outside: { value: 1, unit: "second" } };
}
