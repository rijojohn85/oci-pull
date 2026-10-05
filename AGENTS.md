# Book writing rules — oci-pull

## Audience
- Knows Go and Python well. No programming basics.
- New to TypeScript and Node.js.

## Style
- Plain words, always. Describe what a thing does before naming it; name
  it once. No unexplained jargon, ever.
- One working piece of the tool per chapter. No theory-only chapters
  (2.5 primer is the single exception, and it is short).
- Design principles (SOLID, DRY) named at the exact line where they
  apply, in plain words. Never a lecture.
- Not test-first. A few tests per chapter where they earn it. Faking
  (network, clock, disk) is the main testing lesson.
- **First appearance of a concept: show the code in full.**
  **Every later appearance: explain what is needed, then a "Your turn"
  block telling the reader to write it, then reveal the code.** Never
  skip the reveal.
- Real captured output only. Never hand-typed terminal output.
- Every chapter ends with: `npm run check` green, one git commit, "what
  you should now be able to answer", one-paragraph preview of next.
- "What you should now be able to answer": numbered bold questions, each
  followed by its answer in a `<details><summary>Answer</summary>` block
  (blank lines inside so the markdown renders). Answers in plain words,
  2-5 sentences, matching what the chapter actually taught.
- Terminal blocks: commands start with `$ `. Output has no prefix. When
  in doubt, split into two blocks with "you should see:" between.
- Later chapters show edits, not full reprints; say which file and where.
- No semicolons at line ends (ASI); a statement starting with [ ( or `
  gets a leading ;. Check user code and book blocks for that hazard.
- Every function gets an explicit return type, even small test helpers
  (user prefers explicit). Long inline return shapes get a named interface.
- "Your turn" format: a blockquote `> **Your turn.** <what to write>`, then
  "Here it is:" and the code.
- Every code block carries plain-word inline comments explaining the
  syntax and intent of non-obvious lines, so the reader never has to
  flip back to the prose to read the code.

## Process
- One chapter at a time. Write it, stop, user tries it, then next.
- Check real interfaces before drafting (registry API, Node docs, zod,
  tar, vitest) — context7 first, then upstream source.

## State (any agent, any tool)
- Progress, decisions, and the exact next action live in `.book/state.md`.
  Read it first; update it at every checkpoint and before stopping.
- What's been shown in full vs "Your turn": `.book/concepts.md`.
- Real captured output: `.book/captures/chNN/`. Scratch copy of the user's
  code: `.book/scratch/` (gitignored). Never write in `oci-pull/`.
- Workflow: the project-book skill
  (https://github.com/rijojohn85/project-book-skill). If your agent can't
  load skills, read `skills/project-book/SKILL.md` from that repo.
