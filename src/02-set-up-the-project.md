# Chapter 2: Set Up the Project

By the end of this chapter you'll have a folder that type-checks, runs
one real test, runs the program itself, and is committed to git. Nothing
in it pulls an image yet — but every chapter after this one adds code to
*this* folder, so it's worth getting right.

Everything here was run for real. Versions shown are the ones current
today (September 2026); if yours are newer, that's fine — the commands
are the same.

## What runs what

Three programs are involved, and it helps to keep them apart:

- **Node.js** runs JavaScript. It can't run TypeScript — *except* that
  recent versions (22.18 and newer) can run a `.ts` file by quietly
  deleting the type annotations first and running what's left. We'll
  use that for the day-to-day "run my program" loop. It's fast and it
  needs no build step.
- **`tsc`**, the TypeScript compiler, does the thing Node skips: it
  *checks* the types. It can also turn `.ts` into `.js` for shipping,
  which we'll do in Chapter 12. Until then we only ever ask it "is this
  program correct?" and never "build it."
- **Vitest** runs tests. Like Node, it strips types and runs the code;
  it does *not* check them. That surprises everyone once, so this
  chapter makes you see it happen on purpose.

Check your Node:

```
$ node --version
```

```
v22.20.0
```

Anything from 22.18 upward works (24 and 26 too). If you're older than
that, install a current one — `nvm install 22` if you use nvm.

## Create the project

Make the folder and turn it into an npm package. `npm` is Node's package
manager, the equivalent of `go mod` plus `pip` in one tool. It reads and
writes a file called `package.json`, which is the project's `go.mod`:
name, dependencies, and the short commands you'll run.

```
$ mkdir oci-pull && cd oci-pull
$ npm init -y
$ npm pkg set type=module
```

`npm init -y` writes a default `package.json`. The second command adds
one line to it, `"type": "module"`, which tells Node to use the modern
`import`/`export` style for every file in this project. (There's an
older style, `require()`, that you'll still meet in other people's code.
We won't use it.)

Now the three development tools:

```
$ npm install --save-dev typescript vitest @types/node@22
```

`--save-dev` means "needed to develop this, not to run it" — like a
build tool, not a library. `@types/node` is a package of type
definitions for Node's own built-in functions (`fs`, `crypto`,
`process`...), so that when you call them TypeScript knows what they
take and return. The `@22` pins it to the same major version as the
Node you're running, so the types describe the functions you actually
have.

npm prints a few lines while it works. Two are worth reading: `found 0
vulnerabilities` means it checked what it installed against its list of
known security problems, and `N packages are looking for funding` is
just a count of packages whose authors accept donations (`npm fund`
lists the links). Nothing to do about either.

You should now have this in `package.json` (versions may be newer):

```json
"devDependencies": {
  "@types/node": "^22.20.4",
  "typescript": "^7.0.2",
  "vitest": "^5.0.1"
}
```

Check the compiler answers:

```
$ npx tsc --version
```

```
Version 7.0.2
```

`npx` runs a command from the project's own installed packages, so
you're using *this* project's `tsc`, not some global one. TypeScript 7
is this year's rewrite of the compiler in Go — same language, much
faster. If you see 5.x or 6.x, everything in this book still works; a
couple of settings below were simply defaults you had to set by hand
before 7.

## The compiler settings that matter

TypeScript's behaviour is controlled by `tsconfig.json`. Running
`npx tsc --init` writes a long, commented one. We'll write a shorter one
by hand instead, so every line is a line you understand.

Create `tsconfig.json`:

```json
{
  // tsconfig.json is allowed to contain comments, unlike normal JSON.
  "compilerOptions": {
    // Where things are
    "rootDir": "./src",   // our source code lives here
    "outDir": "./dist",   // where built .js would go (Chapter 12)

    // What we run on
    "module": "nodenext", // resolve imports exactly the way Node does
    "target": "es2024",   // JavaScript features up to 2024 exist; don't rewrite them
    "lib": ["es2024"],    // ...and the built-in functions that come with them
    "types": ["node"],    // load @types/node: types for fs, crypto, process...

    // Strictness
    "strict": true,                     // every standard check on. Never off.
    "noUncheckedIndexedAccess": true,   // arr[0] might not exist: "T or undefined"
    "exactOptionalPropertyTypes": true, // optional field: leave it out, don't set undefined
    "noImplicitReturns": true,          // every path must return (Go does this for free)
    "noUnusedLocals": true,             // like Go's "declared and not used"
    "noUnusedParameters": true,

    // Keeping TypeScript honest (Node runs .ts by deleting the types)
    "verbatimModuleSyntax": true,            // type-only imports must say `type`
    "isolatedModules": true,                 // each file understandable on its own
    "erasableSyntaxOnly": true,              // forbid enum etc: can't be deleted away
    "rewriteRelativeImportExtensions": true, // allow "./x.ts"; build turns it into "./x.js"

    // Housekeeping
    "moduleDetection": "force", // every file is a module, never a script
    "skipLibCheck": true,       // don't re-check types inside node_modules
    "sourceMap": true           // crash reports point at .ts lines
  },
  "include": ["src"]            // only look in src/
}
```

Line by line, in groups:

**Where things are.** `rootDir` is where our source lives; `outDir` is
where compiled `.js` would go (Chapter 12). `include` tells the compiler
to look only in `src`.

**What we're running on.** `module: "nodenext"` means "resolve imports
the way Node does." `target: "es2024"` and `lib: ["es2024"]` mean "the
JavaScript features of 2024 exist; don't rewrite them into older forms."
Node 22 supports all of them. `types: ["node"]` pulls in the `@types/node`
package we installed.

**Strictness.** `strict: true` turns on every type check TypeScript has.
Turning this off is how projects end up with types that lie. It stays
on. The four lines after it are checks that `strict` *doesn't* include
but should:
- `noUncheckedIndexedAccess` — `argv[0]` might not exist, so its type is
  "string *or* undefined" until you check. You'll meet this in a moment.
- `exactOptionalPropertyTypes` — a field marked optional can be left
  out, but can't be set to `undefined` on purpose. Two different things.
- `noImplicitReturns` — every path through a function that returns
  something must actually return something. Go does this for you; TS
  needs to be asked.
- `noUnusedLocals` / `noUnusedParameters` — like Go's "declared and not
  used." Same reason.

**Keeping TypeScript honest.** These four exist because of the thing
from the start of the chapter: Node and Vitest run `.ts` files by
*deleting* the types, not by compiling. So the code must be valid
JavaScript once the types are gone.
- `verbatimModuleSyntax` — an import that's only used as a type must be
  written `import type`, so the deleter knows to drop it.
- `isolatedModules` — every file must be understandable on its own.
- `erasableSyntaxOnly` — nearly everything TypeScript adds is a label
  next to a name (`n: number`), and Node runs a `.ts` file by turning
  each label into spaces: `const n: number = 1` becomes
  `const n         = 1`, which is plain JavaScript that does the same
  thing. A few features aren't labels, they're *things* — `enum` is
  the main one. Delete `enum Color { Red }` and the next line's
  `Color.Red` refers to nothing. This setting forbids those few
  features, so everything we write can be run by deletion alone. We
  won't miss them.
- `rewriteRelativeImportExtensions` — when Node runs `.ts` directly, an
  import must say `./main.ts` (it has no build step to guess the
  extension). This setting lets you write that, and when Chapter 12
  builds real `.js`, the compiler rewrites it to `./main.js`.

**Housekeeping.** `moduleDetection: "force"` — treat every file as a
module, never a script. `skipLibCheck` — don't re-check the types inside
`node_modules`, which saves time and avoids other people's mistakes
being your problem. `sourceMap` — when something crashes, point at the
`.ts` line, not the stripped `.js` line.

That's the whole file. You'll rarely touch it again. (If you're
wondering whether this is a made-up list: Node's own documentation on
running `.ts` files recommends the "keeping TypeScript honest" group
almost word for word.)

## The first source file

Create `src/main.ts`:

```ts
// `export` makes a name visible to other files (Go: a capital letter).
// `: string` after the () is the return type.
export function usage(): string {
  return "usage: oci-pull <image> <output-dir>"
}

// argv: string[] — a parameter named argv that is an array of strings.
// Returns a number (the exit code) instead of exiting: easy to test.
export function main(argv: string[]): number {
  if (argv.length !== 2) {       // !== is "not equal", no type conversion
    console.error(usage())      // write to stderr
    return 2
  }
  // Pull the first two array elements into two names.
  const [image, outputDir] = argv
  // Backtick string: ${...} inserts a value (Go: fmt.Sprintf, Python: f"").
  console.log(`would pull ${image} into ${outputDir}`)
  return 0
}
```

Almost readable as Go. The differences worth noticing:

- No semicolons at the ends of lines. JavaScript puts them in for you
  at each line break, the same way Go does, so this book leaves them
  out. (You'll see plenty of code that writes them; both styles are
  normal.) There's one catch, covered in Chapter 2.5.
- Types go *after* the name, with a colon: `argv: string[]`, and the
  return type after the parameter list: `: number`. Same order as Go,
  different punctuation.
- `export` in front of a name makes it visible to other files — the job
  a capital letter does in Go.
- `const [image, outputDir] = argv;` pulls the first two elements out of
  the array into two names. Handy, and note that because of
  `noUncheckedIndexedAccess` both are typed "string or undefined" —
  TypeScript can't prove the array has two elements even though we
  checked `length` the line before. Inside a template string that's
  fine; the moment we try to *use* one as a string, the compiler will
  make us check. Chapter 3 hits that for real.
- Backtick strings with `${...}` inside are TypeScript's `fmt.Sprintf`
  / f-strings.
- `main` returns an exit code instead of calling `process.exit()`
  itself. That's deliberate, and it's the first design choice in the
  book worth naming: **a function that returns a value is easy to
  test; a function that ends the process is not.** We'll keep that rule
  everywhere.

Now a second file, `src/cli.ts`, which is the *only* file that does
something when it runs:

```ts
// The only file that DOES something when run. Everything else just defines things.
import { main } from "./main.ts"

// process.argv is Go's os.Args: [node, script, ...your args].
// .slice(2) drops the first two. Setting exitCode lets Node exit cleanly with it.
process.exitCode = main(process.argv.slice(2))
```

`process.argv` is `os.Args`: the first two entries are `node` and the
script, so `.slice(2)` drops them. Setting `process.exitCode` lets Node
finish normally and then exit with that number.

A note on `"./main.ts"`, since Go programmers will find it odd: Node
imports between your own files are *relative* — `./` for this folder,
`../` for the parent — and that's what nearly every Node project does.
Absolute-style imports (`#src/main`) are possible, but need a mapping
in `package.json` that Node, `tsc`, and Vitest must each be told about
and that has to switch between `.ts` in development and `.js` after a
build. Four config knobs for one convenience. This project keeps a
flat `src/` where every import is `./something.ts`, so relative costs
nothing.

Why two files? Because in a moment a test is going to `import` from
`main.ts`, and importing a file must never *run the program*. If
`main.ts` ended with `main(process.argv...)`, every test that imported
it would try to pull an image. So: `main.ts` defines things and does
nothing on its own; `cli.ts` is the two lines that kick it off. One
file, one job. This is the single-responsibility idea in its plainest
form, and it shows up again in Chapter 10 when `cli.ts` becomes the one
place where all the pieces get wired together.

Run it, straight from Node, no build:

```
$ node src/cli.ts
```

```
usage: oci-pull <image> <output-dir>
```

```
$ node src/cli.ts alpine:3.20 ./rootfs
```

```
would pull alpine:3.20 into ./rootfs
```

## The first test

Vitest looks for files ending in `.test.ts`. We'll keep each test file
next to the file it tests. Create `src/main.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { usage } from "./main.ts"

// describe(name, fn) groups tests. `() => { ... }` is a nameless function.
describe("usage", () => {
  // it(name, fn) is one test, named as a sentence.
  it("names the program and both arguments", () => {
    // expect(value).toContain(piece): the string must include that piece.
    expect(usage()).toContain("oci-pull")
    expect(usage()).toContain("<image>")
    expect(usage()).toContain("<output-dir>")
  })
})
```

Reading it: `describe` groups tests under a name; `it` is one test,
named as a sentence; `expect(x).toContain(y)` is the assertion. The
`() => { ... }` is how you write a function without a name — Go's
`func() { ... }`, Python's `lambda` but allowed to have a body.

Tell npm how to run things. Add a `scripts` section to `package.json`
(npm has a command for it, so you don't have to edit JSON by hand):

```
$ npm pkg set scripts.start="node src/cli.ts" \
    scripts.typecheck="tsc --noEmit" \
    scripts.test="vitest run" \
    scripts.check="npm run typecheck && npm run test"
```

`tsc --noEmit` means "check the types, don't write any `.js`."
`vitest run` runs the tests once and exits (plain `vitest` stays open
and re-runs on every save, which is nice while working). `check` is the
one you'll run at the end of every chapter.

```
$ npm run check
```

```
> typecheck
> tsc --noEmit

> test
> vitest run

 RUN  v5.0.1 /home/you/oci-pull

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  14:14:34
   Duration  352ms
```

(Trimmed slightly; yours will show a few more lines.)

## Why `check` runs two things

Here's the surprise promised at the top of the chapter. Add a second
test file, `src/oops.test.ts`, with a deliberate type error in it:

```ts
import { expect, it } from "vitest"
import { usage } from "./main.ts"

it("types vanish at run time", () => {
  // WRONG on purpose: usage() returns a string, we claim it's a number.
  const n: number = usage()
  // Vitest deletes `: number` and runs the rest — which works fine.
  expect(n).toContain("oci-pull")
})
```

`usage()` returns a string. We've declared `n` as a number. That's
wrong. Run only the tests:

```
$ npm test
```

```
 Test Files  2 passed (2)
      Tests  2 passed (2)
```

**Both pass.** Vitest deleted the `: number`, ran what was left — which
is perfectly good JavaScript — and the string did contain `oci-pull`.
The type was a lie and nothing noticed.

Now the compiler:

```
$ npm run typecheck
```

```
src/oops.test.ts(5,9): error TS2322: Type 'string' is not assignable to type 'number'.
```

*That's* where types get checked, and *only* there. This is the most
important fact about TypeScript and it's worth saying plainly: **types
exist while you write and check the code; they are gone when it runs.**
A green test run tells you the code does what the tests ask. Only `tsc`
tells you the types are true. So `check` runs both, and neither one
alone is enough. Chapter 6 will make this concrete in a nastier way:
JSON that arrives from a server has *no* types at all, no matter what
you declared.

Delete `src/oops.test.ts` — it did its job.

One more thing `tsc` will refuse, so you've seen it once: an `enum`.

```
$ printf 'enum Color { Red }\nexport const c = Color.Red;\n' > src/e.ts
$ npm run typecheck
```

```
src/e.ts(1,6): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.
```

That's `erasableSyntaxOnly` doing what we asked. Delete `src/e.ts`.
When we need "one of a fixed set of values" later, we'll use a union of
strings (`"amd64" | "arm64"`), which is both erasable and nicer.

## Commit

```
$ printf 'node_modules/\ndist/\n' > .gitignore
$ git init
$ git add -A
$ git commit -m "Set up the project"
```

`node_modules/` is where npm puts installed packages — large, and
rebuilt with a single `npm install`, so it's never committed. `dist/`
is where Chapter 12's build output will go.

`package-lock.json`, on the other hand, *is* committed. `package.json`
says what you asked for — `"typescript": "^7.0.2"`, where `^` means
"7.0.2 or any newer 7.x." The lock file says what you actually got: the
exact version, download address, and checksum of every one of the 41
packages that landed in `node_modules` (your three, plus everything
they depend on). With it, anyone who runs `npm install` next week gets
the same 41 packages you have today, not whatever is newest. It's
`go.sum` to `package.json`'s `go.mod`. Never edit it by hand; npm
updates it whenever you add or upgrade something.

Your tree should be:

```
oci-pull/
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
└── src/
    ├── cli.ts
    ├── main.ts
    └── main.test.ts
```

## What you should now be able to answer

Try to answer each one in your own words first. Then open the answer to check.

**1. Which of Node, `tsc`, and Vitest checks types? Which ones run code?**

<details>
<summary>Answer</summary>

Only `tsc` checks types. Node and Vitest *run* code, and they do it by deleting the type labels first. They never check them. (`tsc` can also build `.js` files, which Chapter 12 uses.)

</details>

**2. Why does `npm run check` have to run two commands?**

<details>
<summary>Answer</summary>

Because neither one is enough alone. The tests (Vitest) prove the code *does* the right thing but ignore types: the `oops.test.ts` with a wrong type still passed. The type check (`tsc`) proves the types are true but runs nothing. `check` runs both.

</details>

**3. What does `"type": "module"` in `package.json` change?**

<details>
<summary>Answer</summary>

It tells Node to treat every file in the project as a modern module, using `import`/`export` instead of the older `require()`. (It's also what allows `await` at the top level of a file, used in Chapter 4.)

</details>

**4. Why do imports in this project end in `.ts`, and what setting allows that?**

<details>
<summary>Answer</summary>

Node runs the `.ts` files directly, with no build step, so an import must name the real file, `./main.ts`. The `rewriteRelativeImportExtensions` setting allows writing `.ts` there. When Chapter 12 builds real `.js`, it rewrites the imports to `./main.js`.

</details>

**5. Why is `cli.ts` a separate file from `main.ts`?**

<details>
<summary>Answer</summary>

Importing a file must never *run the program*. Tests import `main.ts`. If it called `main(...)` itself, every test would start a pull. So `main.ts` only defines things, and `cli.ts` is the one file that kicks the program off. One file, one job (single responsibility).

</details>

**6. Why does `main` return a number instead of calling `process.exit`?**

<details>
<summary>Answer</summary>

A function that returns a value is easy to test: call it and check the number. A function that ends the process would end the test run too. `cli.ts` puts the returned number into `process.exitCode`, and Node exits with it after finishing normally.

</details>

**7. What does `--save-dev` mean, and why pin `@types/node` to `22`?**

<details>
<summary>Answer</summary>

`--save-dev` marks a package as needed to *develop* the project (compiler, test runner, type definitions), not to run it. It goes under `devDependencies`. `@types/node@22` describes Node's built-in functions. Pinning it to the same major version as the Node you run means the types describe the functions you actually have.

</details>

## Next chapter

Chapter 2.5 is a short primer, slower on purpose, for readers coming
from Go and Python: how TypeScript's idea of a type differs from both
(a type is a *shape*, not a name), what `unknown` is for and why `any`
is a trap, how "one of these" types replace enums and Go's interface
tricks, what `null` and `undefined` each mean, and how `async`/`await`
lines up against goroutines and `asyncio`. No new code in the project;
just the ideas Chapter 3 assumes.
