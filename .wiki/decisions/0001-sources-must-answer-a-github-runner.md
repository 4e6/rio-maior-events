---
type: Decision
title: A source must answer a GitHub runner, and a refusal is not routed around
description: The daily build runs on GitHub-hosted runners, so a source that refuses them (Eventbrite, 405) is removed rather than reached another way, and a 403 is recorded as a failure, never worked around with curl.
tags: [network, ci]
sources:
  - resource: .github/workflows/daily.yml
  - resource: src/net.ts
  - resource: .github/workflows/probe.yml
  - resource: tools/probe_*.ts
---

# Decision

The page is built every morning by a GitHub Actions workflow on
`ubuntu-latest`. A source belongs on the list only if a plain request from that
runner is answered. A site that refuses is recorded as failed for the run, and
its requests are not retried another way. `.github/workflows/probe.yml`, run by
hand, asks each source whether it answers a runner.

# Which sources refuse, and what they cost

- **Eventbrite** refuses GitHub's runners (405) and was removed on 2026-10-21
  (33 sources to 32).
- **GoTrail and Running.life** refuse the script with a 403 while a
  browser gets the page. Portugal Running replaced them.
- **Viral Agenda** refuses the collector's client with a 403 whatever the User-Agent; see [Why](../architecture/rio-maior-events-sources.md#why).

# Alternatives considered

- **A fallback to `curl` when the script's client is refused.** It was built and
  removed: getting round a refusal is not this script's call.
- **Keeping Eventbrite and living with its failure each run.** A source that
  can never answer from the place the build runs adds a failed row and no
  events.

# See also

[Not reachable](../architecture/rio-maior-events-sources.md#not-reachable) lists
every site tried and left out; [where the collector is careful](../architecture/rio-maior-events.md#what-reaches-the-network-and-where-it-is-careful).
