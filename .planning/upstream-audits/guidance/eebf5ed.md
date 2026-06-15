verdict: do-not-port

# eebf5ed — fix(issue): /gsd memory missing from autocomplete catalog

## Target file(s)
- none

## Divergence
Adds a single entry to `src/resources/extensions/gsd/commands/catalog.ts`. otto-cli has no gsd extension; its autocomplete catalog for built-in slash commands lives elsewhere (e.g., otto/skills surface) and does not include a `/gsd memory` command.

## Concrete edits
1. None.

## Verdict
GSD-extension command-catalog fix.
