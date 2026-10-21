# Change Control

## Before editing
- **Investigate read-only first.** For vague requests, inspect the relevant code, distinguish evidence from guesses, and ask a focused question if the intended fix is still unclear. Do not treat every discovered issue as in scope.
- **Present a plan and wait for explicit approval before changing files.** List proposed commits in dependency order. For each, give: message, purpose/evidence, **why it needs its own commit**, exact files and intended edits, and validation. State assumptions and out-of-scope findings.

## Commit boundaries
- **One complete, independently reviewable logical change per commit.** Include its implementation, tests, and necessary documentation/configuration together.
- Separate independent fixes, even within the same subsystem or file. Combine inseparable work; never split by file type or manufacture commits.
- Every commit must be necessary for the approved request and have a justified boundary. Do not bundle opportunistic refactors, cleanup, formatting, or unrelated fixes.

## Execution
- Before each approved commit, restate its intended changes. Edit only its approved scope, validate, inspect the diff, and report what changed.
- If an unforeseen edit, file, or commit becomes necessary, **stop, explain and justify it, and obtain approval of a revised plan before proceeding**.
- Preserve pre-existing user changes; never overwrite, stage, or commit them without permission.
- **Plan approval permits only the approved edits, not Git commits.** Create commits only with explicit commit authorization, in the approved order.
- Finish with the actual changes, validation results, deviations, and commit hashes (if committed).

**Principle: investigate broadly, change narrowly, and never surprise.**