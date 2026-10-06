# Building an Image Puller with TypeScript
### A project-based guide, one working piece at a time

## How this book works

This book teaches TypeScript by building one real tool from the ground up:
`oci-pull`. You give it an image name, it talks to the same servers
`docker pull` talks to, downloads everything that makes up the image,
checks nothing was corrupted on the way, and unpacks it all into a plain
folder on disk. The last chapter hands that folder to the real `runc` and
starts a shell inside it — the same thing Docker does, minus Docker.

You already know Go and Python, so this book does not start from "what
is a variable." It starts from "here is what TypeScript does differently
from what you know," and then every chapter adds one working piece of the
tool. No chapter is theory-only. Each new TypeScript idea shows up at the
exact moment the tool needs it, not in a separate lesson up front. Design
principles (single responsibility, open/closed, depending on interfaces
instead of concrete things — the ones usually filed under "SOLID") are
pointed out at the line of code where they apply, in plain words, and
never as a lecture.

This is not a test-first book. Tests appear where they earn their place:
the first one in Chapter 2 to prove the setup works, then a few per
chapter for the parts that are easy to get wrong. The tests that matter
most are the ones that *fake* something — the network, the clock, the
disk — so the suite runs in a second with no internet. Faking is taught
properly, once, in Chapter 4, and then used throughout.

Plain words, always. Every technical term is described by what it does
before it is named, and named once. If a term appears without an
explanation next to it, that's a bug in the book.

Worth naming honestly up front: later chapters mostly show *edits* to
files an earlier chapter already built — "replace this function with
that," "add this below" — rather than reprinting whole files. After
applying a chapter's edits, run

```bash
npm run check
```

(set up in Chapter 2: type-check and test in one go; a lint step joins it in
Chapter 12) before moving
on. Every chapter holds itself to that bar before its code is considered
finished. If it complains, something from that chapter didn't get applied
the way it was written, and it's much easier to find on a chapter boundary
than three chapters later.

## What the finished tool does

```
$ oci-pull alpine:3.20 ./rootfs
resolving  docker.io/library/alpine:3.20
manifest   sha256:beefdead...  (linux/amd64)
layer 1/1  sha256:4abcf200...  3.4 MB  ok
unpacked   ./rootfs
$ sudo runc run --bundle . demo
/ # cat /etc/alpine-release
3.20.3
```

## The stages

Pulling an image takes six stages. Every chapter opens with this list,
marked to show where it fits:

1. Read the image name (Chapter 3)
2. Ask the registry, get a token (Chapters 4–5)
3. Read the manifest, pick the platform (Chapter 6)
4. Download the layers, check them (Chapter 7; faster in Chapter 8)
5. Unpack them into a folder (Chapter 7 roughly; properly in Chapter 9)
6. Run it with runc (Chapter 7; more in Chapter 11)

Chapter 7 is where it all first works end to end, with two honest
shortcuts. Each later chapter replaces one shortcut with the real thing.

## Table of contents

1. **Why Build an Image Puller** — what actually happens during
   `docker pull`, the four steps we'll build, what "an image" really is
   (a list of compressed folders stacked in order)
2. **Set Up the Project** — Node.js, `npm`, the compiler settings that
   matter (and why "strict" is not optional), Vitest, the first test,
   `npm run check`, first commit
2.5. **TypeScript for Go and Python Programmers** — a short primer, slower
   on purpose: types disappear when the program runs (the single most
   important fact in the book), "shape" typing vs Go's named types,
   `unknown` vs `any`, one-of types, `null` and `undefined`, how
   `async`/`await` compares to goroutines and `asyncio`
3. **Reading an Image Name** — `alpine` really means
   `docker.io/library/alpine:latest`; a pure function that fills in the
   blanks, our own error type, the first real tests. *Single
   responsibility, at the point it applies.*
4. **The First Call to the Registry** — `fetch`, `async`/`await` for
   real, and the first fake: a pretend HTTP client so tests never touch
   the internet. *Depend on an interface, not on `fetch` directly — the
   reason we can fake it at all.*
5. **Getting Permission: Tokens** — Docker Hub says "no" first, then
   tells you where to ask for a token; reading that answer, fetching the
   token, retrying. Faking a *sequence* of replies in a test. *Open for
   extension: adding password login later must not touch this code.*
6. **The Manifest: Trusting Nothing from the Server** — the server sends
   JSON; TypeScript has no idea what's in it and neither should you.
   `zod` turns "some JSON" into "a value with a known shape, or a clear
   error." One server reply can be one of two shapes (a manifest, or a
   list of manifests for different CPUs); picking the right one.
7. **The Whole Pull, Rough Version** — the first time the tool pulls an
   image end to end and you run it with `runc`. Streams (read a little,
   write a little, never hold 200 MB in memory), computing the checksum
   *while* the bytes go by, refusing anything whose checksum doesn't
   match. A content store: files named after their own checksum. *One
   class, one job.* Two honest shortcuts, each replaced later: layers
   download one at a time, and the system's `tar` command unpacks them.
8. **Downloading Many Layers at Once** — replaces the one-at-a-time loop.
   `Promise.all`, why "all at once" needs a limit, writing a small limiter
   ourselves (first generic function, explained plainly), retry with
   backoff, and faking the *clock* so retry tests take milliseconds.
   Built whole first, then split into helpers with the tests unchanged
9. **Unpacking Layers into a Folder** — replaces the system `tar` shortcut.
   Layers apply in order, later ones win, a file named `.wh.foo` means
   "delete `foo`" (which the system `tar` got wrong); the `tar` package;
   tests against a real temporary folder, not a fake
10. **The Command Line** — arguments, progress output, exit codes, the
    one file where every piece is finally wired together (and why it's
    the only file allowed to know about all of them), `npm link` so
    `oci-pull` works from anywhere
11. **Running It for Real with runc** — Chapter 7 ran `alpine` roughly;
    now a bigger image with several layers and a deleted file, to prove
    Chapters 8 and 9, and what `runc spec`'s config actually controls
12. **Getting to Production** — turning `.ts` into shippable `.js`, what
    `package.json` needs so others can install it, structured errors
    with exit codes, cancelling downloads still running after one fails
    (`AbortController`), retrying only errors worth retrying, a lint
    step, and the honest list of what this tool still doesn't do

Each chapter ends with a working, commit-able state, a short "what you
should now be able to answer," and a one-paragraph preview of the next
chapter.

## What is deliberately left out

- **Pushing images.** Uploading is the mirror image of downloading and
  would double the server-side chapters while teaching mostly the same
  TypeScript ideas again.
- **Writing our own tar reader.** A byte-by-byte tar parser is a whole
  chapter that teaches almost no TypeScript. We use the `tar` package and
  spend the pages on the parts that are actually about this language.
- **A web or browser front end.** TypeScript is often met through React.
  That's a different book; this one is about the language and about
  building a real command-line tool with it.

Three real dependencies for the tool itself: `zod` (checking shapes),
`tar` (unpacking), and nothing else beyond what Node.js ships with.
Everything else — the HTTP client, the token logic, the content store,
the limiter — we build, because that's where the learning is.

---
