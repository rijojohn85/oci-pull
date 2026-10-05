# Concepts ledger

"First shown in full" = code shown directly. Every later use = explain →
"Your turn" → reveal. Grep the chapters when a row is missing.

| Concept | First shown in full | Later "Your turn" uses |
|---|---|---|
| Semicolon-free style, leading `;` hazard | Ch2.5 §0 | all code |
| Shape typing (a type is a shape) | Ch2.5 §1 | Ch4 `{ get }` as HttpClient, Ch5 `neverAuth` |
| `undefined`/`null`, `?.`, `??` | Ch2.5 §3, Ch3 | Ch5 `?? {}`, `?? ""`, `?? "(not sent)"` |
| `===` | Ch2.5 §3 | throughout |
| Union / tagged one-of type + `switch` with no default | Ch3 (`Reference`, `target`) | Ch4 `ApiCheck`, `describeApiCheck`, Ch6 `Manifest` |
| `interface`, `extends`, `readonly` | Ch3 | Ch5 `Challenge`, `RawManifest` |
| Own error class (`extends Error`, `name`) | Ch3 `InvalidReferenceError` | Ch4 `RegistryError`, Ch5 `AuthError`, Ch6 `ManifestError`, Ch7 `StoreError` (shown in full with the class) |
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
| `unknown` + hand narrowing (`typeof`, `in`) | Ch2.5, code in Ch5 Step 3 | Ch6 `parseJson(): unknown` (then zod) |
| `URL` / `searchParams` | Ch5 Step 3 | — |
| Open/closed principle (O) | Ch5 Step 3 `Authenticator` | — |
| DRY: move shared helper to its own file | Ch5 Step 4 `fake-http.ts` | Ch5 `challengeOf`; Ch6 `test-manifests.ts` (shown, fixtures), `DIGEST_PATTERN` export, `MANIFEST_TYPES` from lists |
| `Response.json(value)` | Ch5 Step 4 | Ch5 end-to-end test |
| Object spread `{ ...obj }` | Ch5 Step 5 | — |
| `Uint8Array` / `arrayBuffer()` | Ch5 Step 5 | — |
| Rest parameter `...args: T[]` | Ch5 Step 6 | — |
| `mockResolvedValueOnce` / fake answering in turn | Ch5 Step 6 | Ch6 resolve test 2 (chained on vi.fn) |
| `toHaveBeenCalledTimes`, `toHaveBeenNthCalledWith`, `toHaveBeenLastCalledWith`, `expect.objectContaining` | Ch5 Step 6 | — |
| A fake that fails if called (`neverAuth`) | Ch5 Step 5 | — |
| `array.join("\n")` | Ch5 Step 7 | — |
| `TextEncoder` / `TextDecoder` | Ch6 Step 1 | — |
| zod: `import * as z`, `z.object/string/number/array`, `safeParse`, `prettifyError` | Ch6 Step 2 (try-zod) | Ch6 Step 3 schemas |
| zod: `.regex(p, msg)`, `.int().nonnegative()`, `.optional()`, `.extend()`, `z.literal` | Ch6 Step 3 | `ImageManifestSchema` Your turn |
| `z.infer<typeof Schema>` (type from schema), unknown keys stripped | Ch6 Step 3 / Step 5 | — |
| `catch {` with no variable | Ch6 Step 4 `parseJson` | — |
| `readonly string[]` + `includes` | Ch6 Step 4 | — |
| Array spread `[...a, ...b]` | Ch6 Step 4 `MANIFEST_TYPES` | Ch6 `[...new Set()]`, `...layerLines` |
| safeParse branch (check success → data) | Ch6 Step 4 index branch | image branch Your turn |
| Object spread to build broken test data `{ ...good, field }` | Ch6 Step 5 | — |
| Regex in `toThrow(/.../)` | Ch6 Step 5 | — |
| Arrow functions + `find` / `map` / `filter` (filter narrows undefined away) | Ch6 Step 6 | Ch6 `layers.map((layer, i) => ...)` |
| `Set` | Ch6 Step 6 | — |
| Default parameter used to inject the environment (`arch = process.arch`) | Ch6 Step 6 `hostPlatform` | — |
| Interface segregation (I in SOLID): narrow `ManifestSource` | Ch6 Step 7 | Ch7 `BlobSource` (Your turn) |
| `toHaveLength` | Ch6 Step 7 | — |
| Destructuring an object `const { a, b } = obj` | Ch6 Step 8 (comment) | — |
| Numeric separator `1_000_000`, `toFixed` | Ch6 Step 8 | — |
| Where-we-are map / walking skeleton (book structure) | Ch7 (retrofitted Ch3-6) | every chapter |
| Streams; `AsyncIterable<Uint8Array>`; `for await` | Ch7 Step 1 | — |
| `response.body`; fetch follows redirects and drops auth cross-origin | Ch7 Step 1 | — |
| `TextDecoder` `{ stream: true }` | Ch7 Step 1 `textOf` | — |
| `node:` modules: `crypto` createHash (incremental update/digest), `fs` createWriteStream, `fs/promises` access/mkdir/rename/rm/readdir/readFile/mkdtemp, `path` join, `os` tmpdir/homedir | Ch7 Step 2 | — |
| `pipeline` (stream/promises) + `async function*` generator step, `yield`, `AsyncGenerator<T>` | Ch7 Step 2 | Ch7 `chunksOf` |
| Closure (inner function changes outer variables) | Ch7 Step 2 (named) | — |
| `.partial` + `rename` (all-or-nothing), cleanup in `catch` then rethrow | Ch7 Step 2 | — |
| Single responsibility (S in SOLID) named: `ContentStore` | Ch7 Step 2 | — |
| `beforeEach`/`afterEach`, real temp folder (`useTempFolder` returns a getter) | Ch7 Step 2 | — |
| Failure shown on purpose (remove cleanup line) | Ch7 Step 2 | — |
| String-literal one-of type (`"downloaded" \| "cached"`) | Ch7 Step 3 (Your turn, explained) | — |
| `FakeX { x, method: Mock<...> }` fake shape | Ch5 `FakeHttp` | Ch7 `FakeSource` |
| Fixture must be real bytes: `JSON.stringify(v, null, 2)` reproduces Docker Hub's | Ch7 Step 4 | — |
| `execFile` + `promisify` (callback → Promise) | Ch7 Step 5 | — |
| `array.entries()` + `[i, x]` destructuring in `for...of` | Ch7 Step 6 | — |
| `runc spec --rootless`, `runc run` | Ch7 Try it | Ch11 |
