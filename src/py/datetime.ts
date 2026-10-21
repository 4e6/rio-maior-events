// Dates and times. Python counterparts: common.lisbon_time, datetime.fromisoformat,
// datetime.date.fromisoformat, email.utils.parsedate_to_datetime, collect.lisbon_today / default_end.
// Owned by T4. A point in time is epoch milliseconds (UTC); "aware" tells whether the input had an offset.

export interface Moment {
  /** Epoch milliseconds, UTC. A naive input is read as UTC here; callers decide what naive means via `aware`. */
  ms: number;
  aware: boolean;
}

/** A moment in mainland Portugal time (common.lisbon_time return value, with the strftime pieces precomputed). */
export interface LisbonTime {
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  time: string;
  hour: number;
  minute: number;
  /** local.isoformat(timespec="minutes"): "2026-10-24T21:00+01:00" or "...+00:00". */
  isoMinutes: string;
}

const DAY = 86_400_000;

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

function validDate(y: number, m: number, d: number): number | null {
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.getTime();
}

function ymd(ms: number): string {
  const t = new Date(ms);
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** common.lisbon_time (common.py:33-40): UTC+1 from the last Sunday of March 01:00 UTC to the last Sunday of October 01:00 UTC. */
export function lisbonTime(ms: number): LisbonTime {
  const year = new Date(ms).getUTCFullYear();
  const lastSunday = (month: number): number => {
    const day = new Date(0);
    day.setUTCFullYear(year, month - 1, 31);
    day.setUTCHours(1, 0, 0, 0);
    return day.getTime() - day.getUTCDay() * DAY; // Python (weekday() + 1) % 7 is getUTCDay()
  };
  const summer = lastSunday(3) <= ms && ms < lastSunday(10);
  const local = new Date(ms + (summer ? 3_600_000 : 0));
  const date = ymd(local.getTime());
  const hour = local.getUTCHours();
  const minute = local.getUTCMinutes();
  const time = `${pad(hour)}:${pad(minute)}`;
  return { date, time, hour, minute, isoMinutes: `${date}T${time}${summer ? "+01:00" : "+00:00"}` };
}

// Date part: extended or basic calendar date, or ISO week date (Python 3.11+).
const DATE_RE = /^(?:(\d{4})-(\d{2})-(\d{2})|(\d{4})(\d{2})(\d{2})|(\d{4})-?W(\d{2})(?:-?(\d))?)/;
const TIME_RE = /^(\d{2})(?::(\d{2})(?::(\d{2})(?:[.,](\d+))?)?|(\d{2})(?:(\d{2})(?:[.,](\d+))?)?)?/;
const OFFSET_RE = /^(?:Z|([+-])(\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d+))?)?)?)$/;

/** The day number (ms at 00:00 UTC) of a date prefix, and its length, or null. */
function dateFrom(s: string): { ms: number; len: number } | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  let ms: number | null;
  if (m[7] !== undefined) {
    const y = +m[7], w = +m[8]!, d = m[9] === undefined ? 1 : +m[9];
    if (w < 1 || w > 53 || d < 1 || d > 7) return null;
    const jan4 = validDate(y, 1, 4);
    if (jan4 === null) return null;
    const monday1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
    ms = monday1 + ((w - 1) * 7 + (d - 1)) * DAY;
    const longYear = (): boolean => {
      const dow = (y0: number) => new Date(validDate(y0, 1, 1)!).getUTCDay();
      const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      return dow(y) === 4 || (leap && dow(y) === 3);
    };
    if (w === 53 && !longYear()) return null;
  } else if (m[1] !== undefined) {
    ms = validDate(+m[1], +m[2]!, +m[3]!);
  } else {
    ms = validDate(+m[4]!, +m[5]!, +m[6]!);
  }
  return ms === null ? null : { ms, len: m[0].length };
}

/** datetime.datetime.fromisoformat (riomaior_calendar.py:40; nextjs.py:108, after "Z" -> "+00:00"); null when unreadable.
 *  Python 3.11+ grammar. Sub-millisecond digits are dropped. */
export function parseIsoDatetime(s: string): Moment | null {
  const d = dateFrom(s);
  if (!d) return null;
  let ms = d.ms;
  const rest = Array.from(s.slice(d.len));
  if (rest.length === 0) return { ms, aware: false };
  const tail = rest.slice(1).join(""); // any one character separates date and time
  const t = TIME_RE.exec(tail);
  if (!t) return null;
  const hh = +t[1]!;
  const mm = +(t[2] ?? t[5] ?? 0);
  const ss = +(t[3] ?? t[6] ?? 0);
  const frac = t[4] ?? t[7] ?? "";
  if (mm > 59 || ss > 59 || hh > 24) return null;
  const msFrac = frac ? Math.floor(+frac.slice(0, 6).padEnd(6, "0") / 1000) : 0;
  if (hh === 24 && (mm || ss || (frac && +frac !== 0))) return null;
  ms += ((hh * 60 + mm) * 60 + ss) * 1000 + msFrac;
  const off = tail.slice(t[0].length);
  if (off === "") return { ms, aware: false };
  const o = OFFSET_RE.exec(off);
  if (!o) return null;
  if (off === "Z") return { ms, aware: true };
  const oh = +o[2]!, om = +(o[3] ?? 0), os = +(o[4] ?? 0);
  if (oh > 23 || om > 59 || os > 59) return null;
  const secs = oh * 3600 + om * 60 + os;
  return { ms: ms - (o[1] === "-" ? -secs : secs) * 1000, aware: true };
}

/** datetime.date.fromisoformat (santarem_rss.py:20; collect.py:501-502; merge.py:96; render.py:85) -> "YYYY-MM-DD" or null. */
export function parseIsoDate(s: string): string | null {
  const d = dateFrom(s);
  return d && d.len === s.length ? ymd(d.ms) : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAYNAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const ZONES: Record<string, number> = { UT: 0, UTC: 0, GMT: 0, Z: 0, AST: -400, ADT: -300, EST: -500, EDT: -400,
  CST: -600, CDT: -500, MST: -700, MDT: -600, PST: -800, PDT: -700 };

/** Python int(str): optional whitespace and sign, digits with single underscores between; NaN otherwise. */
function pyInt(s: string): number {
  const t = s.trim();
  return /^[+-]?\d+(?:_\d+)*$/.test(t) ? Number(t.replace(/_/g, "")) : NaN;
}

/** email.utils.parsedate_to_datetime (municipal_rss.py:25): RFC 822; "-0000" or no zone gives aware=false; null when unreadable. */
export function parseRfc822(input: string): Moment | null {
  // email._parseaddr._parsedate_tz
  if (!input) return null;
  let data = input.split(/\s+/).filter((x) => x !== "");
  if (data.length === 0) return null;
  if (data[0]!.endsWith(",") || DAYNAMES.includes(data[0]!.toLowerCase())) data.shift();
  else {
    const i = data[0]!.lastIndexOf(",");
    if (i >= 0) data[0] = data[0]!.slice(i + 1);
  }
  if (data.length === 3) {
    const stuff = data[0]!.split("-");
    if (stuff.length === 3) data = [...stuff, ...data.slice(1)];
  }
  if (data.length === 4) {
    const s = data[3]!;
    let i = s.indexOf("+");
    if (i === -1) i = s.indexOf("-");
    if (i > 0) data.splice(3, 1, s.slice(0, i), s.slice(i));
    else data.push("");
  }
  if (data.length < 5) return null;
  let [dd, mm, yy, tm, tz] = data.slice(0, 5) as [string, string, string, string, string];
  if (!(dd && mm && yy)) return null;
  mm = mm.toLowerCase();
  if (!MONTHS.includes(mm)) {
    [dd, mm] = [mm, dd.toLowerCase()];
    if (!MONTHS.includes(mm)) return null;
  }
  let month = MONTHS.indexOf(mm) + 1;
  if (month > 12) month -= 12;
  if (dd.endsWith(",")) dd = dd.slice(0, -1);
  if (dd === "") return null; // Python: IndexError, caught by the caller
  if (yy.indexOf(":") > 0) [yy, tm] = [tm, yy];
  if (yy.endsWith(",")) {
    yy = yy.slice(0, -1);
    if (!yy) return null;
  }
  if (yy === "") return null;
  if (!/^\p{Nd}/u.test(yy)) [yy, tz] = [tz, yy];
  if (tm === "") return null;
  if (tm.endsWith(",")) tm = tm.slice(0, -1);
  let parts = tm.split(":");
  let thh: string, tmm: string, tss: string;
  if (parts.length === 2) { [thh, tmm] = parts as [string, string]; tss = "0"; }
  else if (parts.length === 3) { [thh, tmm, tss] = parts as [string, string, string]; }
  else if (parts.length === 1 && tm.includes(".")) {
    parts = tm.split(".");
    if (parts.length === 2) { [thh, tmm] = parts as [string, string]; tss = "0"; }
    else if (parts.length === 3) { [thh, tmm, tss] = parts as [string, string, string]; }
    else return null;
  } else return null;
  let year = pyInt(yy);
  const day = pyInt(dd), hour = pyInt(thh), minute = pyInt(tmm), second = pyInt(tss);
  if ([year, day, hour, minute, second].some(Number.isNaN)) return null;
  if (year < 100) year += year > 68 ? 1900 : 2000;
  let tzoffset: number | null = null;
  tz = tz.toUpperCase();
  if (Object.hasOwn(ZONES, tz)) tzoffset = ZONES[tz]!;
  else {
    const n = pyInt(tz);
    if (!Number.isNaN(n)) tzoffset = n;
    if (tzoffset === 0 && tz.startsWith("-")) tzoffset = null;
  }
  if (tzoffset) {
    const sign = tzoffset < 0 ? -1 : 1;
    const a = Math.abs(tzoffset);
    tzoffset = sign * (Math.floor(a / 100) * 3600 + (a % 100) * 60);
  }
  // datetime(...) validation (ValueError in Python)
  const dayMs = validDate(year, month, day);
  if (dayMs === null || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  if (tzoffset !== null && Math.abs(tzoffset) >= 86400) return null;
  const local = dayMs + ((hour * 60 + minute) * 60 + second) * 1000;
  if (tzoffset === null) return { ms: local, aware: false };
  return { ms: local - tzoffset * 1000, aware: true };
}

/** collect.lisbon_today (collect.py:524-531): "YYYY-MM-DD" in Europe/Lisbon (Intl, no tzdata shipped). */
export function lisbonToday(now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now);
    const get = (t: string): string => parts.find((p) => p.type === t)!.value;
    return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
  } catch (err) {
    console.error(`warning: no Europe/Lisbon time zone (${err}); using the machine's date`);
    return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
}

/** collect.default_end (collect.py:534-537): the first Sunday at least 28 days after start. */
export function defaultEnd(start: string): string {
  const day = parseIsoDate(start);
  if (day === null) throw new RangeError(`invalid ISO date: ${start}`);
  const ms = Date.parse(`${day}T00:00:00Z`) + 28 * DAY;
  const weekday = (new Date(ms).getUTCDay() + 6) % 7;
  return ymd(ms + ((6 - weekday + 7) % 7) * DAY);
}

/** datetime.now().astimezone().isoformat(timespec="seconds") (collect.py:560 collected_at; merge.py generated_at). */
export function localIsoNow(now: Date = new Date()): string {
  const off = -now.getTimezoneOffset();
  const a = Math.abs(off);
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:` +
    `${pad(now.getMinutes())}:${pad(now.getSeconds())}${off < 0 ? "-" : "+"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
