# Python and frontend comment cleanup

## Scope

Five Python and nineteen frontend source files changed. The Python patch removes
nine redundant comments; the frontend patch removes sixty standalone comments and
four associated blank lines. Imports, statements, strings, JSX, CSS declarations,
docstrings, directives, licenses, accessibility and motion/focus contracts remain.
The scope and exact new hashes are in
[comment-equivalence.json](comment-equivalence.json).

## Preservation evidence

The parent checked all five Python files without importing application modules:

- Python token streams were identical after excluding ordinary comment tokens
  and nonsemantic line separators; indentation and executable tokens were kept.
- Parsed ASTs, including docstrings and type comments, were identical.

All nineteen frontend files produced identical executable JavaScript or CSS from
the same installed esbuild transform with comments and source maps excluded. This
was a direct before/after transform, not bundling with changed dependencies.
No application, browser or network activity was needed for these comparisons.

Independent correctness and maintainability reviewers read all three cross-repo
patches and relevant context and found no issues. They reviewed the supplied
proof reports but did not independently execute or hash-verify them. The parent
verified frozen hashes before integration. The integrated frontend
`node frontend/scripts/check.mjs` run passed under a 1024 MiB, one-CPU Windows Job
with a 180-second limit. The normal inventory check passed; 384 of 419 live
inventory entries still lack acceptance evidence.

These checks establish bounded executable-representation equivalence. They do not
claim a new performance improvement, visual baseline, complete route acceptance,
full backend coverage or physical mobile validation.

## Retained design and audit limits

The Python worker inventoried 95 tracked files across bot, mail, APP and SPI;
inspection depth varied. The frontend worker mapped the changed UI/style owners
and existing checks. Neither report establishes exhaustive runtime coverage.
Legal outbox, quota/account semantics, authentication/session revocation and
independent async hook lifecycles were retained rather than merged for appearance.
Rate-limiter retention changes, async lifecycle bugs and graphics simplifications
remain outside this comment-only scope. Larger extractions are conditional on a
specific reduction in coupling and preservation tests, not a deletion quota.
