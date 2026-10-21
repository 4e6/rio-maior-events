---
type: Decision
title: No Viral Agenda
description: Viral Agenda would add about 22 events over two to three weeks but refuses the collector's HTTP client with a 403 whatever the User-Agent, so it is left out and not reached another way.
tags: [network, sources]
sources:
  - resource: sources.json
  - resource: references/sources.md
---

# Decision

Viral Agenda (nine municipality pages) is not a source. It refuses the
collector's HTTP client with a 403 whatever the User-Agent, an honest one
included, though curl and browsers are answered and its robots.txt allows
Claude-User with a 15 s crawl delay. The collector does not route around the
refusal ([the rule](0001-sources-must-answer-a-github-runner.md)).

# What it would have added

Nightlife and private venues (clubs, a bar, galleries, a theatre), guided walks
and municipal events past the first page of a town's own list: about 22 events
over two to three weeks on 2026-10-20.

# Alternatives considered

- **Impersonating a browser or falling back to `curl`.** Getting round a refusal
  is not this script's call.
- **Keeping it and honouring its 15 s crawl delay.** The site answers 403
  whatever the delay; the collector dropped it, and no source needs a long
  delay today.

The one request-rate rule that remains is the Entroncamento site's
`Crawl-delay: 3`. If the site stops refusing, the municipality pages are the
place to start; see [Not reachable](../architecture/rio-maior-events-sources.md#not-reachable).
