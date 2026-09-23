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
- Terminal blocks: commands start with `$ `. Output has no prefix. When
  in doubt, split into two blocks with "you should see:" between.
- Later chapters show edits, not full reprints; say which file and where.
- No semicolons at line ends (ASI); a statement starting with [ ( or `
  gets a leading ;. Check user code and book blocks for that hazard.
- Every code block carries plain-word inline comments explaining the
  syntax and intent of non-obvious lines, so the reader never has to
  flip back to the prose to read the code.

## Process
- One chapter at a time. Write it, stop, user tries it, then next.
- Check real interfaces before drafting (registry API, Node docs, zod,
  tar, vitest) — context7 first, then upstream source.
