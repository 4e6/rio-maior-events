"""One module per kind of site; sources.json names the one a source uses.

An adapter module has these functions:

    requests(source, window) -> [Request(url, data=None)]   optional, default one GET of source["url"]
    parse(source, pages, window) -> dict(items, text, truncated, past, note, follow)
    details(source, pages, window) -> [dict]                optional, default common.default_details

`window` is (first day, last day) as ISO dates; `pages` is a Page for each
request, in order. parse is pure, with no network, and raises AdapterError when
the pages cannot be read. Its optional `follow` is a list of Request(url): event
pages worth fetching. The runner keeps those on the source's own host, at most
`source["follow"]` (default 0, none), fetches them, and passes the pages that
came back, with their final URLs, to details, which returns a dict per page
({url, title, start, end, venue, excerpt}); the source's result carries them as
`details`.
"""

from . import (cadaval_api, events_calendar, municipal_rss, nextjs, riomaior_calendar,
               santarem_rss, text)

ADAPTERS = {
    "text": text,
    "riomaior_calendar": riomaior_calendar,
    "events_calendar": events_calendar,
    "cadaval_api": cadaval_api,
    "nextjs": nextjs,
    "santarem_rss": santarem_rss,
    "municipal_rss": municipal_rss,
}
