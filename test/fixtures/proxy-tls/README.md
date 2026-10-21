Test-only TLS fixtures for the proxy tests: a throwaway CA (`ca.pem`) and a server certificate for
`localhost` / `127.0.0.1` (`srv.pem`, `srv.key`), valid for 100 years. The CA's key was discarded. They protect nothing.
