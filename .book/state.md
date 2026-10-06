# Book state: Building an Image Puller with TypeScript

Any agent picking this book up: read `AGENTS.md`, then this file, then
`concepts.md`. Update this file at every checkpoint (project-book skill,
references/book-state.md). If this file and the repo disagree, the repo
wins: fix this file.

## Book facts

- Title: Building an Image Puller with TypeScript
- Teaches: TypeScript/Node, by building `oci-pull` (pulls an image from a
  registry, unpacks it into a rootfs folder; final chapter runs it with real runc)
- User's code: `oci-pull/` (read only; the user writes it)
- Check command: `npm run check` (run inside `oci-pull/`)
- Build the book: `mdbook build` (book root)
- Decisions (asked one at a time, confirmed by the user, 2026-09-22):
  - Runtime: Node.js LTS (v22). Why: current LTS, runs .ts directly.
  - Tests: Vitest. Why: modern, TS-native.
  - Dependencies: only `zod` and `tar`; everything else hand-built. Why: the
    learning is in building it.
  - Scope: stop at pull, no push.
  - Testing style: NOT test-first; a few tests per chapter; faking
    (network, clock, disk) is the main lesson.
  - Audience: knows Go and Python well; no programming basics.
  - SOLID/DRY/clean code: named at the line where they apply, never lectured.

## Progress

| Ch | Title | Status |
|---|---|---|
| 1 | Why Build an Image Puller | done |
| 2 | Set Up the Project | done |
| 2.5 | TypeScript for Go and Python Programmers | done |
| 3 | Reading an Image Name | done |
| 4 | The First Call to the Registry | done |
| 5 | Getting Permission: Tokens | done |
| 6 | The Manifest: Trusting Nothing from the Server | done |
| 7 | The Whole Pull, Rough Version | written (awaiting user) |
| 8 | Downloading Many Layers at Once | planned |
| 9 | Unpacking Layers into a Folder | planned |
| 10 | The Command Line | planned |
| 11 | Running It for Real with runc | planned |
| 12 | Getting to Production | planned |

## Current work

- Chapter: 6, The Manifest: Trusting Nothing from the Server
- Phase: done (user committed 2f6a9e8; their check: 53 passed).
- Code verified in `.book/scratch/oci-pull` (= book's Ch6 code): `npm run
  check` 53 passed, 6 files. In-between counts captured: Step 3/4 = 36,
  Step 5 = 43, Step 6 = 50, Step 7 = 53, Step 8 TS6133 RawManifest (5,30)
  then 53. Captures in `.book/captures/ch06/` (00a/00b by-hand curl, 01-14).
  mdbook build OK. Design checklist OK.
- Promises made by Ch6 (later chapters must keep):
  - Ch7: compute sha256 while streaming layers AND check the manifest's own
    digest; content store named by checksum.
  - Ch8: our own generic function (could fold parseManifest's two safeParse
    branches); download all layers at once.
  - Ch10: tidy the growing `instanceof` list in main's catch; `--platform`
    option (resolveImage already takes `want`).
  - Ch9: stack layers into one folder.
- Done: Ch3-6 retrofitted (map + why + "By the end"); outline has "The
  stages"; Ch6 Next-chapter paragraph updated; src/07 renamed
  07-the-whole-pull.md. Skill repo updated (uncommitted): prose-style,
  AGENTS/chapter templates, starting-a-book, SKILL.md.
- Ch7 drafting. Code final in .book/scratch/oci-pull: 62 tests. New files:
  store.ts (ContentStore pathFor/has/put, StoreError; pipeline + async
  generator hashing; .partial + rename), store.test.ts (4, real temp dir),
  temp-folder.ts (useTempFolder), test-blobs.ts (HELLO, chunksOf),
  pull.ts (BlobSource, downloadLayer → "downloaded"|"cached"), pull.test.ts
  (2, FakeSource {source, fetchBlob}), digest.ts (sha256Digest), unpack.ts
  (unpackWithSystemTar via promisify(execFile)). Changed: registry.ts
  fetchBlob (+2 tests, textOf helper), resolve.ts checkDigest (by-digest
  fetches), resolve.test.ts (outer-index test rebuilt, swapped-bytes test),
  test-manifests.ts (full real ALPINE_AMD64, bytesOf with null, 2 →
  byte-exact real digest), main.ts (describeImage w/o layers, store in
  ~/.cache/oci-pull, loop downloads, unpack, StoreError in catch).
  Counts: Step2 55, Step3 59, on-purpose no-cleanup fail, Step4 61, Step5
  2 failed|59 passed (61) → 1 failed|60 → 62, Step6 62, Step7 62.
  Captures .book/captures/ch07/00-14. Runs use /tmp/oci-demo and
  /tmp/oci-node; rootless `runc spec --rootless` + `runc run demo` works
  (no sudo). Capture runs used HOME=scratch/demo/home* so the user's real
  ~/.cache stays empty.
- Ch7 written: src/07-the-whole-pull.md. mdbook OK. Every ts line checked
  against scratch. Claim "fetch drops authorization on cross-origin
  redirect" verified (captures/ch07/15-fetch-redirect-auth.mjs). /tmp demo
  folders deleted afterwards; user's ~/.cache/oci-pull untouched.
- Promises made by Ch7: Ch8 = all layers at once with a limit, our first
  generic function (also fold Ch6's two safeParse branches), retry a
  half-failed download, fake the clock. Ch9 = replace system tar (whiteouts,
  zstd), real temp-folder tests. Ch10 = tidy errors (incl. tar failure stack
  trace), --platform. Ch11 = what's in config.json; image config's command.
- **Next:** wait for the user to type Ch7 and say it works; check their code
  (read only); mark done.

## User's code vs the book's

- The user spells `checkAPI` (book: `checkApi`) and `useage()` (book:
  `usage()`). That's fine, just different. In the scratch copy, rename to
  the book's spelling.
- The user's `main.ts` prints `registry ` with one space, and prints
  "would pull into" before the api line (the book does it after).
  Cosmetic only.

- The user's `RegistryClient` field is `baseURL`; the book's is `baseUrl`
  (Ch4). Ch5 had copied `baseURL` by mistake, fixed 2026-10-05.

## Open questions

- (none)

## Decisions after planning
- 2026-10-06: from Ch8 on, "write it whole, then split it" (see AGENTS.md). Ch7 stays as written; Ch8 can open by splitting pullImage() out of main.ts.

- 2026-10-05: keeping the "why" visible. User picked: map at the top of
  every chapter, open on the gap (real output), why paragraph + "By the end
  of this chapter you can:", end on the next gap, retrofit Ch3-6 (text
  only), AND a walking skeleton: Ch7 now pulls and runs alpine end to end
  (layers one at a time, system `tar` to unpack; Ch8/Ch9 replace those).
  Why: "with this build from bottom up approach I kinda lose why we're
  doing it". Rules in AGENTS.md. Researched: Jeffery's Distributed Services
  with Go, user's CSI + runc books, Crafting Interpreters (map chapter),
  GOOS (walking skeleton), Ausubel (overview before details).

## Log

- 2026-09-22 Claude Code: book planned; decisions made; outline written.
- 2026-09-23 Claude Code: Ch1–3 done; Ch4 written.
- 2026-09-24 Claude Code: Ch4 done (user committed). Ch5 written and verified.
- 2026-09-24 Claude Code: moved book state into `.book/` so any agent can resume.
- 2026-10-05 Claude Code: added a fold-out answer to every recap question in Ch1-5 (61 in all); fixed Ch5 baseURL→baseUrl; fixed the 2.5 primer's claim that JSON.parse returns unknown (it's `any`).
- 2026-10-05 Claude Code: picked up Ch6; user's code checked green (37 tests).
- 2026-10-05 Claude Code: Ch6 written and verified (53 tests); awaiting user.
- 2026-10-05 Claude Code: Ch6 marked done. Researched how other books keep the 'why'; awaiting user's pick before Ch7.
- 2026-10-05 Claude Code: user picked 1-5 + walking skeleton; AGENTS.md, outline updated.
- 2026-10-05 Claude Code: retrofitted Ch3-6 with the map; skill updated for future books.
- 2026-10-05 Claude Code: Ch7 (walking skeleton) written and verified, 62 tests; alpine + node:22-alpine run in rootless runc.
