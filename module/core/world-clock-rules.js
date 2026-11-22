/**
 * Relógio do mundo (J9) — regras puras (sem Foundry), testadas em test/world-clock.test.mjs.
 *
 * O tempo é `game.time.worldTime` (segundos): o combate já soma a rodada nele, e o Mestre passa o
 * resto pela janela "Relógio do mundo". Um dia tem 24 h de 3600 s; o dia 1 começa em 0 s. Toda
 * regra recebe o ajuste (nascer/pôr do sol, escuridão da noite, limite de "escuro") como argumento.
 *
 * J9b: o instante pode ser a hora LOCAL de uma linha do tempo (calendar-rules.js) e o ajuste pode
 * trazer `dayLength` (segundos do dia do calendário): nascer e pôr do sol continuam em "horas de 24"
 * e valem proporcionalmente num dia mais curto ou mais longo.
 */

export const SECONDS_PER_HOUR = 3600;
export const SECONDS_PER_DAY = 86400;

/** Dia (1…), hora (0–23), minuto e a hora fracionada (0 ≤ h < 24) de um instante em segundos. */
export function clockParts(worldTime, dayLength = SECONDS_PER_DAY) {
  const t = Number.isFinite(Number(worldTime)) ? Math.floor(Number(worldTime)) : 0;
  const length = Number(dayLength) > 0 ? Math.floor(Number(dayLength)) : SECONDS_PER_DAY;
  const day = Math.floor(t / length);
  const inDay = ((t % length) + length) % length;
  const hour = Math.floor(inDay / SECONDS_PER_HOUR);
  const minute = Math.floor((inDay % SECONDS_PER_HOUR) / 60);
  // `hourFloat` é sempre na escala de 24 h (nascer/pôr do sol são horas de 0 a 24, mesmo num dia de outro tamanho).
  return { day: day + 1, hour, minute, hourFloat: (inDay / length) * 24 };
}

/** "Dia 3 · 14:05". */
export function formatClock(worldTime) {
  const { day, hour, minute } = clockParts(worldTime);
  return `Dia ${day} · ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Só a hora: "14:05". */
export function formatHour(worldTime) {
  const { hour, minute } = clockParts(worldTime);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Instante (segundos) em que o dia `day` (1…) está na hora `hour` e minuto `minute`. */
export function timeAt(day, hour, minute = 0) {
  const d = Math.max(1, Math.floor(Number(day) || 1));
  const h = Math.min(23, Math.max(0, Math.floor(Number(hour) || 0)));
  const m = Math.min(59, Math.max(0, Math.floor(Number(minute) || 0)));
  return (d - 1) * SECONDS_PER_DAY + h * SECONDS_PER_HOUR + m * 60;
}

/** Normaliza o ajuste do relógio (horas 0–24, escuridão 0–1, limite em %). */
export function normalizeClockConfig(config = {}) {
  const hour = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(24, Math.max(0, n)) : fallback;
  };
  const sunrise = hour(config.sunrise, 6);
  const sunset = hour(config.sunset, 18);
  const night = Number(config.nightDarkness);
  const dark = Number(config.darkThreshold);
  const dayLength = Number(config.dayLength);
  return {
    dayLength: dayLength > 0 ? Math.floor(dayLength) : SECONDS_PER_DAY,
    sunrise: Math.min(sunrise, sunset),
    sunset: Math.max(sunrise, sunset),
    nightDarkness: Number.isFinite(night) ? Math.min(1, Math.max(0, night)) : 0.8,
    darkThreshold: Number.isFinite(dark) ? Math.min(100, Math.max(0, dark)) : 50,
    shortRestHours: Math.max(0, Number(config.shortRestHours) >= 0 ? Number(config.shortRestHours) : 1),
    longRestHours: Math.max(0, Number(config.longRestHours) >= 0 ? Number(config.longRestHours) : 8)
  };
}

/** É dia? (entre o nascer e o pôr do sol; o pôr do sol já é noite). */
export function isDayAt(worldTime, config = {}) {
  const { sunrise, sunset, dayLength } = normalizeClockConfig(config);
  const { hourFloat } = clockParts(worldTime, dayLength);
  return hourFloat >= sunrise && hourFloat < sunset;
}

/**
 * Escuridão que uma cena "Escurece com o relógio" deve ter. Dia = 0; noite = `nightDarkness`; o
 * crepúsculo (`twilightHours`, 1 h) sobe depois do pôr do sol e desce nas horas antes do nascer.
 */
export function darknessFor(worldTime, config = {}, twilightHours = 1) {
  const { sunrise, sunset, nightDarkness, dayLength } = normalizeClockConfig(config);
  const tw = Math.max(0.0001, Number(twilightHours) || 1);
  const h = clockParts(worldTime, dayLength).hourFloat;
  let level;
  if (h >= sunrise && h < sunset) level = 0;
  else if (h >= sunset) level = Math.min(1, (h - sunset) / tw);
  else level = Math.min(1, (sunrise - h) / tw);
  return Math.round(level * nightDarkness * 1000) / 1000;
}

/** "Está escuro": a escuridão (0–1) chega ao limite em %. */
export function isDarkLevel(darkness, thresholdPercent = 50) {
  return (Number(darkness) || 0) * 100 >= (Number(thresholdPercent) || 0) - 1e-9;
}

/** A escuridão posta e a desejada diferem o bastante para valer uma gravação? */
export function darknessNeedsUpdate(current, target, epsilon = 0.02) {
  return Math.abs((Number(current) || 0) - (Number(target) || 0)) >= epsilon;
}

/**
 * Escuridão de um Token dentro de Regiões de escuridão do core (`adjustDarknessLevel`): aplica cada
 * uma em ordem. Modos do core: 0 = substitui, 1 = clareia (`d × (1 − m)`), 2 = escurece
 * (`1 − (1 − d) × (1 − m)`).
 * @param {number} base - escuridão da cena
 * @param {Array<{mode:number, modifier:number}>} adjusts
 */
export function adjustedDarkness(base, adjusts = []) {
  let d = Math.min(1, Math.max(0, Number(base) || 0));
  for (const a of adjusts ?? []) {
    const m = Math.min(1, Math.max(0, Number(a?.modifier) || 0));
    if (Number(a?.mode) === 0) d = m;
    else if (Number(a?.mode) === 1) d = d * (1 - m);
    else if (Number(a?.mode) === 2) d = 1 - (1 - d) * (1 - m);
  }
  return d;
}

/* ------------------------------------------------------------------ Dormir */

/** Horas de um descanso (curto/completo) a partir do ajuste. */
export function restHours(kind, config = {}) {
  const c = normalizeClockConfig(config);
  return kind === "long" ? c.longRestHours : c.shortRestHours;
}

/** Instante em que quem começou a dormir em `now` acorda. */
export function sleepUntil(now, kind, config = {}) {
  return Math.floor(Number(now) || 0) + Math.round(restHours(kind, config) * SECONDS_PER_HOUR);
}

/** Acorda agora? (o relógio chegou em `until`). */
export function shouldWake(until, worldTime) {
  return Number.isFinite(Number(until)) && Number(worldTime) >= Number(until);
}

/**
 * Estado do grupo: `members` = `[{id, sleeping, until}]` (os PJs). Todos dormindo (e pelo menos um
 * PJ) → o Mestre pode pular o tempo; `skipSeconds` é o que falta para o último acordar e
 * `skipHours` arredonda para cima em horas inteiras (o que o botão mostra).
 */
export function groupSleepState(members = [], worldTime = 0) {
  const list = (members ?? []).filter(Boolean);
  const sleeping = list.filter(m => m.sleeping);
  const all = list.length > 0 && sleeping.length === list.length;
  // J9b: `until` está no tempo pessoal do membro (`now`, ritmo `rate`); o que falta vira tempo do mundo
  // (÷ ritmo). Sem `now`/`rate` o membro segue o tempo do mundo, como no J9. Se o tempo pessoal voltou,
  // falta mais (a pessoa só dorme mais): nada quebra por diferença grande.
  const remaining = sleeping.map(m => {
    const now = m.now === undefined ? Number(worldTime) || 0 : Number(m.now) || 0;
    const rate = Number(m.rate) > 0 ? Number(m.rate) : 1;
    return Math.max(0, ((Number(m.until) || 0) - now) / rate);
  });
  const skipSeconds = all ? Math.ceil(Math.max(0, ...remaining)) : 0;
  return { all, sleeping: sleeping.length, total: list.length, skipSeconds, skipHours: Math.ceil(skipSeconds / SECONDS_PER_HOUR) };
}

/**
 * Quanto tempo DO MUNDO o "Descanso do grupo" tem de passar (C15, sessão 4): o maior entre as horas do descanso e o que
 * falta (tempo pessoal ÷ ritmo) para cada PJ que dorme acordar. Uma linha lenta (ritmo 0,1) pede 10× mais. Pura.
 */
export function groupRestSeconds(members = [], baseSeconds = 0, worldTime = 0) {
  const sleepers = (members ?? []).filter(m => m?.sleeping);
  const { skipSeconds } = groupSleepState(sleepers, worldTime);
  return Math.max(Math.floor(Number(baseSeconds) || 0), skipSeconds);
}

/** Texto do botão do aviso: "Passar o tempo (8 h)". */
export function skipLabel(skipSeconds) {
  const hours = Math.ceil((Number(skipSeconds) || 0) / SECONDS_PER_HOUR);
  if ((Number(skipSeconds) || 0) >= SECONDS_PER_HOUR) return `Passar o tempo (${hours} h)`;
  const minutes = Math.max(1, Math.ceil((Number(skipSeconds) || 0) / 60));
  return `Passar o tempo (${minutes} min)`;
}

/**
 * O que a hora mostra a quem não é Mestre: o relógio, ou "--:--" se o aparelho é tecnológico e está
 * suprimido. O Mestre sempre vê.
 */
export function visibleHour(worldTime, { techSuppressed = false } = {}) {
  return techSuppressed ? "--:--" : formatHour(worldTime);
}
