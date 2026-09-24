Chapter 5 was drafted before `.book/captures/` existed. The captures
quoted in `src/05-getting-permission-tokens.md` are real (taken on
2026-09-24 against a scratch copy and the live registries). The key
reproducible ones are listed below, so an agent can re-run them if
needed. From Chapter 6 on, save each capture here as it's taken.

- curl -sS -o /dev/null -D - https://registry-1.docker.io/v2/library/alpine/manifests/latest
  → 401, www-authenticate with scope="repository:library/alpine:pull"
- token: https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/alpine:pull
  → JSON {token, access_token, expires_in: 300, issued_at}
- ghcr token → {"token": ...} only
- `npm start --silent -- alpine ./rootfs` → index, digest sha256:294b683c...,
  9218 bytes (digest changes whenever alpine:latest is rebuilt)
- mid-Step-5 typecheck: 6× TS2554 + 4 unused-name errors (see chapter)
- final: 4 test files, 36 tests passing
