// Dates and times. Python counterparts: common.lisbon_time, datetime.fromisoformat,
// datetime.date.fromisoformat, email.utils.parsedate_to_datetime, collect.lisbon_today / default_end.
// Owned by T4. A point in time is epoch milliseconds (UTC); "aware" tells whether the input had an offset.
const NYI = (): never => { throw new Error("not ported"); };

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

/** common.lisbon_time (common.py:33-40): UTC+1 from the last Sunday of March 01:00 UTC to the last Sunday of October 01:00 UTC. */
export function lisbonTime(_ms: number): LisbonTime { return NYI(); }

/** datetime.datetime.fromisoformat (riomaior_calendar.py:40; nextjs.py:108, after "Z" -> "+00:00"); null when unreadable. */
export function parseIsoDatetime(_s: string): Moment | null { return NYI(); }

/** datetime.date.fromisoformat (santarem_rss.py:20; collect.py:501-502; merge.py:96; render.py:85) -> "YYYY-MM-DD" or null. */
export function parseIsoDate(_s: string): string | null { return NYI(); }

/** email.utils.parsedate_to_datetime (municipal_rss.py:25): RFC 822; "-0000" or no zone gives aware=false; null when unreadable. */
export function parseRfc822(_s: string): Moment | null { return NYI(); }

/** collect.lisbon_today (collect.py:524-531): "YYYY-MM-DD" in Europe/Lisbon (Intl, no tzdata shipped). */
export function lisbonToday(_now?: Date): string { return NYI(); }

/** collect.default_end (collect.py:534-537): the first Sunday at least 28 days after start. */
export function defaultEnd(_start: string): string { return NYI(); }

/** datetime.now().astimezone().isoformat(timespec="seconds") (collect.py:560 collected_at; merge.py generated_at). */
export function localIsoNow(_now?: Date): string { return NYI(); }
