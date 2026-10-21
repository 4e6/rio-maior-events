"""Vectors for src/py/codecs.ts and src/py/datetime.ts, from the Python code the port replaces.
Run: python3.14 tools/gen_py_vectors.py  (writes test/vectors/py-datetime.json and py-codecs.json)."""
import datetime as dt, email.utils, json, os, sys, zoneinfo
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from adapters.common import lisbon_time
import collect

out = os.path.join(os.path.dirname(__file__), "..", "test", "vectors")
UTC = dt.timezone.utc
EPOCH = dt.datetime(1970, 1, 1, tzinfo=UTC)

def ms(m):
    return (m - EPOCH) // dt.timedelta(milliseconds=1)

def last_sunday(y, m):
    d = dt.datetime(y, m, 31, 1, tzinfo=UTC)
    return d - dt.timedelta(days=(d.weekday() + 1) % 7)

lisbon = []
for y in range(2025, 2031):
    for m in (3, 10):
        edge = last_sunday(y, m)
        for delta in (-3600, -1, 0, 1, 3600):
            lisbon.append(edge + dt.timedelta(seconds=delta))
lisbon += [dt.datetime(y, mo, d, h, mi, tzinfo=UTC) for y, mo, d, h, mi in
           [(2026, 7, 1, 23, 30), (2026, 12, 31, 23, 59), (2026, 1, 1, 0, 0), (2028, 2, 29, 12, 0), (2030, 6, 30, 22, 59)]]
lisbon_v = []
for m in lisbon:
    l = lisbon_time(m)
    lisbon_v.append({"ms": ms(m), "iso": l.isoformat(timespec="minutes"), "date": l.strftime("%Y-%m-%d"),
                     "time": l.strftime("%H:%M"), "hour": l.hour, "minute": l.minute})

def dtcase(s):
    try:
        m = dt.datetime.fromisoformat(s)
    except ValueError:
        return {"in": s, "out": None}
    aware = m.tzinfo is not None
    if not aware:
        m = m.replace(tzinfo=UTC)
    return {"in": s, "out": {"ms": ms(m), "aware": aware}}

DT = ["2026-10-24T21:00:00+00:00", "2026-10-24T21:00:00Z", "2026-10-24T21:00:00.123Z", "2026-10-24T21:00:00.1234567+01:00",
      "20261024T210000", "2026-10-24 21:00", "2026-10-24", "2026-W43-6", "2026-W43", "2026W436", "2026-10-24T21",
      "2026-10-24T21:00:00+0100", "2026-10-24T21:00:00+01", "2026-10-24T21:00:00-03:30", "2026-10-24T24:00",
      "2026-10-24T24:00:01", "2026-10-24T21:00z", "2026-10-24t21:00", "2026-10-24T21:00:00,5", "2026-10-24T2100",
      "20261024T21:00", "2026-10-24X21:00", "2026-10-24T21:00+24:00", "2026-10-24T21:00:60", "2026-02-30T10:00",
      "2025-02-29", "2028-02-29T10:00", "2026-W53-1", "2026-W43-8", "2026-10", "2026-10-24T", "2026-10-24T21:",
      "0000-01-01", "", "garbage", "2026-10-24T21:00:00.", "2026-10-24T21:00:00-00:00", "2026-10-24T21:00:00+01:00:30",
      "2026-10-24T25:00", "2026-10-24T21:60", "9999-12-31T23:59:59+00:00", "2026-3-4", "+2026-10-24", " 2026-10-24"]
D = ["2026-10-24", "20261024", "2026-W43-6", "2026-02-30", "2026-10-24 ", "2024-02-29", "2025-02-29", "", "2026-10-24T00:00",
     "0001-01-01", "9999-12-31", "2026-13-01", "2026-1-1", " 2026-10-24"]
date_v = []
for s in D:
    try:
        date_v.append({"in": s, "out": dt.date.fromisoformat(s).isoformat()})
    except ValueError:
        date_v.append({"in": s, "out": None})

def rfc(s):
    try:
        m = email.utils.parsedate_to_datetime(s)
    except (TypeError, ValueError, IndexError):
        return {"in": s, "out": None}
    aware = m.tzinfo is not None
    if not aware:
        m = m.replace(tzinfo=UTC)
    return {"in": s, "out": {"ms": ms(m), "aware": aware}}

RFC = ["Sat, 24 Oct 2026 21:00:00 +0100", "Sat, 24 Oct 2026 21:00:00 GMT", "Sat, 24 Oct 2026 21:00:00 UT", "Sat, 24 Oct 2026 21:00:00 Z",
       "24 Oct 2026 21:00 +0000", "Sat, 24 Oct 2026 21:00:00", "Sat, 24 Oct 2026 21:00:00 -0000", "Sat, 24 Oct 26 21:00:00 +0000",
       "Sat, 24 Oct 69 21:00:00 +0000", "Sat, 24 Oct 68 21:00:00 +0000", "Sat,24 Oct 2026 21:00:00 +0100", "Sat, 24 October 2026 21:00:00 +0100",
       "Sat, 24 Oct 2026 21:00:00 EST", "Sat, 24 Oct 2026 21:00:00 PDT", "Sat, 24 Oct 2026 21:00:00 +0530", "Sat, 24 Oct 2026 21:00:00 -0330",
       "Sat, 24 Oct 2026 21:00:00+0100", "Sat, 24 Oct 2026 21:00:00-0100", "Sat, 24 Oct 2026 21:00 +0100", "Sat, 24 Oct 2026 21.00.00 +0100",
       "Sat, 24 Oct 2026 21:00:60 +0000", "Sat, 24 Oct 2026 24:00:00 +0000", "Sat, 31 Nov 2026 21:00:00 +0000", "Sat, 24 Foo 2026 21:00:00 +0000",
       "Oct 24 2026 21:00:00 +0000", "Saturday, 24-Oct-26 21:00:00 GMT", "24-Oct-2026 21:00:00 GMT", "Sat, 24 Oct 2026 21:00:00 +2500",
       "Sat, 24 Oct 2026 21:00:00 XYZ", "Sat, 24 Oct 2026 21:00:00 +01:00", "  Sat, 24 Oct 2026   21:00:00   +0100  ", "", "   ", "garbage",
       "Sat, 24 Oct", "24 Oct 2026", "Mon, 06 Jul 2026 00:00:00 +0100", "Thu, 01 Jan 1970 00:00:00 +0000", "Sat, 24 Oct 2026 21:00:00 +0100 (WEST)",
       "Sat, 24 Oct 2026 21:00:00 1_00", "Sat, 24 Oct 2026 21:00:00 +0160", "Sat, 24 Oct 2026 21:00:00 -2359", "Sat, 24 Oct 2026 21:00:00 -2400",
       "Sat, 24 Oct 2026 2:3:4 +0000", "Sat, , 24 Oct 2026 21:00:00 +0000", "sat, 24 oct 2026 21:00:00 gmt", "Sat, 24 Oct 2026, 21:00:00 +0100"]
rfc_v = [rfc(s) for s in RFC]

end_v = []
d0 = dt.date(2026, 1, 1)
for i in range(0, 800, 1):
    d = d0 + dt.timedelta(days=i)
    end_v.append({"in": d.isoformat(), "out": collect.default_end(d).isoformat()})

today_v = []
for m in lisbon + [dt.datetime(2026, 3, 28, 23, 30, tzinfo=UTC), dt.datetime(2026, 7, 1, 23, 30, tzinfo=UTC)]:
    today_v.append({"ms": ms(m), "out": collect.lisbon_today(m).isoformat()})

json.dump({"lisbon": lisbon_v, "datetime": [dtcase(s) for s in DT], "date": date_v, "rfc": rfc_v, "end": end_v, "today": today_v},
          open(os.path.join(out, "py-datetime.json"), "w"), indent=0, ensure_ascii=False)

# codecs: every byte, plus multi-byte samples, under each name the pipeline meets or Python aliases
NAMES = ["utf-8", "UTF-8", "utf8", "UTF_8", "latin-1", "latin1", "LATIN-1", "iso-8859-1", "ISO-8859-1", "iso8859-1", "l1", "cp1252",
         "windows-1252", "Windows-1252", "1252", "ascii", "us-ascii", "US-ASCII", "ansi_x3.4-1968", "utf-8-sig", "iso-8859-9", "iso-8859-15",
         "iso-8859-2", "koi8-r", "windows-1251", "x-user-defined", "unicode-1-1-utf-8", "bogus", "latin2", "cp-1252", "l2", "cyrillic", "greek", "hebrew", "arabic", "iso-8859-3", "iso-8859-4", "iso-8859-5", "iso-8859-6", "iso-8859-7", "iso-8859-8", "iso-8859-10", "iso-8859-13", "iso-8859-14", "iso-8859-16", "windows-1250", "cp1253", "cp1254", "cp1255", "cp1256", "cp1257", "cp1258"]
SAMPLES = [bytes([b]) for b in [0, 10, 65, 127] + list(range(128, 256))] + [
    b"", b"abc", "Olá São João €".encode(), b"\xef\xbb\xbf{}", b"\xef\xbb\xbfabc", "café".encode("latin-1"),
    b"\xe2\x80", b"\xc0\x80", b"\xed\xa0\x80", b"\xf4\x90\x80\x80", b"\xf0\x9f\x98\x80", b"a\x96b", b"\x80\x81\x9f", b"ab\xff\xfecd",
    bytes(range(256)),
]
codec_v = []
for name in NAMES:
    for raw in SAMPLES:
        try:
            r = {"text": [ord(c) for c in raw.decode(name)]}
        except UnicodeDecodeError:
            r = {"error": "UnicodeDecodeError"}
        except LookupError:
            r = {"error": "LookupError"}
        codec_v.append({"codec": name, "hex": raw.hex(), **r})
json.dump(codec_v, open(os.path.join(out, "py-codecs.json"), "w"), ensure_ascii=False)
