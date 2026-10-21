---
type: Decision
title: A residential proxy for the sites that refuse GitHub's runners
description: "Sites that refuse GitHub's runners are read through a residential proxy, only after a direct refusal, only in CI, under a byte cap; the user's decision of 2026-10-21, replacing the rule that a refusal is not routed around."
tags: [network, proxy, cost]
sources:
  - resource: src/net.ts
  - resource: src/net-errors.ts
  - resource: src/collect.ts
  - resource: .github/workflows/build.yml
---

# Decision

Five municipal sites (cm-santarem, cm-torresnovas, cm-alcanena, cm-entroncamento,
cm-vnbarquinha) answer a person's browser and this script from a home address
but refuse GitHub's runners. The user bought a residential proxy (Portugal
exit) and asked for it as a fallback when a site cannot be opened. The earlier
decision, "a source must answer a GitHub runner, and a refusal is not routed
around", was withdrawn the same day.

The fallback is the secret `FALLBACK_PROXY_URL`. A host goes through the proxy
only after its direct request was refused (a timeout, a connection reset or
refusal, 403 or a 5xx), the refused request is retried once through it and the
host's remaining requests follow. It is off without the secret, so local runs
behave as before. The rules and the budget are in
[the architecture page](../architecture/rio-maior-events.md#how-the-collection-is-built).

# Alternatives considered

- **A self-hosted runner on the user's Mac.** The sites answer a home address.
  Rejected: the build would depend on a machine being on and awake.
- **Dropping the five sites.** The sources stay the reviewed list; losing five
  municipalities is the cost the proxy removes.
- **Proxy first.** Rejected: more proxy traffic and cost, and it would hide
  which sites still answer a runner directly.

# Consequences

- The gateway URL is `http`: the credentials reach the gateway in clear, while
  pages stay end-to-end TLS through CONNECT. Port 823 is the rotating gateway;
  a sticky-session port, if the provider offers one, would make one visitor per
  host per run (not checked).
- The byte budget is an estimate; the provider's traffic cap is the real limit.
- The proxy is never used for what a site's robots.txt disallows, and never to
  add a source on the grounds that it can now be read.
