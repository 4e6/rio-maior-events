"""One module per kind of site; sources.json names the one a source uses.

An adapter module has two functions:

    requests(source, window) -> [Request(url, data=None)]   optional, default one GET of source["url"]
    parse(source, pages, window) -> dict(items, text, truncated, past, note)

`window` is (first day, last day) as ISO dates; `pages` is a Page for each
request, in order. parse is pure, with no network, and raises AdapterError when
the pages cannot be read.
"""

from . import cadaval_api, events_calendar, nextjs, riomaior_calendar, text

ADAPTERS = {
    "text": text,
    "riomaior_calendar": riomaior_calendar,
    "events_calendar": events_calendar,
    "cadaval_api": cadaval_api,
    "nextjs": nextjs,
}
