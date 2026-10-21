# certs

`intermediates.pem` holds three intermediate CA certificates that the collector
loads next to the system's trusted roots (see `src/net.ts`).

## Why

Some sources' servers do not send their whole certificate chain:

| Host | Missing certificate | Chains to |
|---|---|---|
| www.cm-riomaior.pt | GlobalSign GCC R3 DV TLS CA 2020 | GlobalSign Root CA - R3 |
| www.cm-almeirim.pt | GlobalSign GCC R6 AlphaSSL CA 2025 | GlobalSign Root CA - R6 |
| www.teatrovirginia.pt | Root YR (cross-signed by ISRG Root X1) | ISRG Root X1 |

Browsers and macOS fetch a missing intermediate from the "Authority
Information Access" (AIA) URL in the server's certificate. OpenSSL on Linux
(the collector in GitHub Actions on Ubuntu) does not, so verification fails there
with "unable to get local issuer certificate". Giving OpenSSL the intermediate
fixes it.

These are intermediates and one cross-sign, and every one chains to a root that
the system already trusts. No root of our own is added and verification is
never turned off: a site that presents a different chain still fails.

## Refresh

Each certificate has its subject, issuer, expiry, host and AIA URL in the
comment above it in `intermediates.pem`. Before an expiry (the AlphaSSL one
goes first, 2027-05-21), or when a source fails with a certificate error:

1. Download from the AIA URL (`curl -O <url>`; the files are DER).
2. Convert: `openssl x509 -inform DER -in file.crt -out file.pem`.
3. Check with `openssl x509 -noout -subject -issuer -enddate -in file.pem`
   that the subject and issuer are the expected ones.
4. Replace the block in `intermediates.pem` and update its comment.
5. To find a host's current intermediate: `openssl s_client -connect HOST:443
   -showcerts` and read the leaf's "CA Issuers" line with
   `openssl x509 -noout -ext authorityInfoAccess`.
