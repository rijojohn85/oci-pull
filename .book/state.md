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
| 6 | The Manifest: Trusting Nothing from the Server | planned |
| 7 | Downloading One Layer | planned |
| 8 | Downloading Many Layers at Once | planned |
| 9 | Unpacking Layers into a Folder | planned |
| 10 | The Command Line | planned |
| 11 | Running It for Real with runc | planned |
| 12 | Getting to Production | planned |

## Current work

- Chapter: 5, Getting Permission: Tokens
- Phase: done (user committed "finished chapter 5"); Ch6 not started
- Done so far: all steps. Code verified in a scratch copy: 36 tests
  passing, `tsc` clean. Real runs against Docker Hub, mcr, ghcr, quay.
- Captures: `.book/captures/ch05/` holds the key captures (saved
  afterwards from the drafting session; the chapter text itself is the
  full record).
- Scratch: not present (the Ch5 scratch lived in the old agent's temp dir).
  Rebuild it in `.book/scratch/` if needed.
- Chapter 5's promise to Chapter 6: parse the manifest bytes with zod
  (`JSON.parse` gives `any`); tell an index (one per CPU) from a single image
  manifest by media type, and pick the entry for the user's CPU. Ch5 showed
  both `application/vnd.oci.image.index.v1+json` (Docker Hub) and
  `application/vnd.docker.distribution.manifest.list.v2+json` (mcr, ghcr).
- **Next:** start Ch6 at the chapter loop, step 1, when the user asks.

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

## Log

- 2026-09-22 Claude Code: book planned; decisions made; outline written.
- 2026-09-23 Claude Code: Ch1–3 done; Ch4 written.
- 2026-09-24 Claude Code: Ch4 done (user committed). Ch5 written and verified.
- 2026-09-24 Claude Code: moved book state into `.book/` so any agent can resume.
- 2026-10-05 Claude Code: added a fold-out answer to every recap question in Ch1-5 (61 in all); fixed Ch5 baseURL→baseUrl; fixed the 2.5 primer's claim that JSON.parse returns unknown (it's `any`).
