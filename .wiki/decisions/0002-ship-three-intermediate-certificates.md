---
type: Decision
title: Ship three intermediate certificates, keep verification on
description: Three servers send an incomplete TLS chain that OpenSSL on Linux cannot complete, so certs/intermediates.pem adds their intermediates next to the system roots; no root of ours, never verification off.
tags: [network, tls]
sources:
  - resource: certs/**
  - resource: src/net.ts
---

# Decision

www.cm-riomaior.pt, www.cm-almeirim.pt and www.teatrovirginia.pt do not send
their whole certificate chain. Browsers and macOS fetch the missing
intermediate from the certificate's AIA URL; OpenSSL on Linux, which is what the
GitHub Actions collector runs on, does not, and fails with "unable to get local
issuer certificate". `certs/intermediates.pem` holds the three missing
certificates, loaded next to the system's trusted roots. Each chains to a root
the system already trusts, and a site that presents a different chain still
fails. The file's comments and `certs/README.md` say how to refresh them (the
AlphaSSL one expires first, 2027-05-21).

# Alternatives considered

- **Turning verification off.** Never: a site presenting any chain would pass.
- **Adding a root of our own.** No root of ours is added; every shipped
  certificate chains to a root the system already trusts.
- **Fetching the intermediate from the AIA URL at run time.** What browsers do,
  and what OpenSSL on Linux does not.

# Afterwards

The shipped certificates were later made not to act as trust anchors
(`VERIFY_X509_PARTIAL_CHAIN` cleared). Refresh the file when a source fails with a certificate error; do not
loosen verification to make it pass.
