# Concepts ledger

"First shown in full" = code shown directly. Every later use = explain →
"Your turn" → reveal. Grep the chapters when a row is missing.

| Concept | First shown in full | Later "Your turn" uses |
|---|---|---|
| Semicolon-free style, leading `;` hazard | Ch2.5 §0 | all code |
| Shape typing (a type is a shape) | Ch2.5 §1 | Ch4 `{ get }` as HttpClient, Ch5 `neverAuth` |
| `undefined`/`null`, `?.`, `??` | Ch2.5 §3, Ch3 | Ch5 `?? {}`, `?? ""`, `?? "(not sent)"` |
| `===` | Ch2.5 §3 | throughout |
| Union / tagged one-of type + `switch` with no default | Ch3 (`Reference`, `target`) | Ch4 `ApiCheck`, `describeApiCheck` |
| `interface`, `extends`, `readonly` | Ch3 | Ch5 `Challenge`, `RawManifest` |
| Own error class (`extends Error`, `name`) | Ch3 `InvalidReferenceError` | Ch4 `RegistryError`, Ch5 `AuthError` |
| Named constants instead of magic values | Ch3 (`DEFAULT_TAG` ...) | Ch4 `DOCKER_HUB_API_HOST`, Ch5 `MANIFEST_TYPES` |
| Vitest `describe`/`it`/`expect`, `toEqual`, `toThrow` | Ch2/Ch3 | every chapter |
| `it.each` with a table of rows | Ch3 | Ch4 registries, Ch5 parseChallenge |
| `export`, `import type`, inline `type` import | Ch2.5 §7, Ch4 | Ch5 imports |
| `async`/`await`, `Promise<T>` | Ch2.5 §6, Ch4 | Ch5 everything |
| `fetch`, `Response`, `headers.get` | Ch4 | Ch5 |
| Interface + class `implements` (depend on an interface) | Ch4 `HttpClient`/`FetchHttpClient` | Ch5 `Authenticator` |
| Dependency passed into constructor (D in SOLID) | Ch4 `RegistryClient(http, ...)` | Ch5 `auth` param |
| `vi.fn<T>` mock, `Mock<T>`, `toHaveBeenCalledWith` | Ch4 Step 7 | Ch5 `tokenGiving` |
| Generics `<...>` explained | Ch2.5 §9, Ch4 | Ch5 `Record<>`, `Map<>` |
| `await expect(p).rejects.toThrow` | Ch4 | Ch5 authenticator tests |
| `new Response(body, { status, headers })` | Ch4 | Ch5 `unauthorized()` |
| Top-level `await` in `cli.ts` | Ch4 | — |
| `Record<K, V>`, optional parameter `?`, default parameter value | Ch5 Step 1 | — |
| Regex literal, named groups, `matchAll` | Ch5 Step 2 | — |
| `Map` | Ch5 Step 2 | — |
| `unknown` + hand narrowing (`typeof`, `in`) | Ch2.5, code in Ch5 Step 3 | (Ch6 replaces with zod) |
| `URL` / `searchParams` | Ch5 Step 3 | — |
| Open/closed principle (O) | Ch5 Step 3 `Authenticator` | — |
| DRY: move shared helper to its own file | Ch5 Step 4 `fake-http.ts` | Ch5 `challengeOf` (explain → Your turn) |
| `Response.json(value)` | Ch5 Step 4 | Ch5 end-to-end test |
| Object spread `{ ...obj }` | Ch5 Step 5 | — |
| `Uint8Array` / `arrayBuffer()` | Ch5 Step 5 | — |
| Rest parameter `...args: T[]` | Ch5 Step 6 | — |
| `mockResolvedValueOnce` / fake answering in turn | Ch5 Step 6 | — |
| `toHaveBeenCalledTimes`, `toHaveBeenNthCalledWith`, `toHaveBeenLastCalledWith`, `expect.objectContaining` | Ch5 Step 6 | — |
| A fake that fails if called (`neverAuth`) | Ch5 Step 5 | — |
| `array.join("\n")` | Ch5 Step 7 | — |
