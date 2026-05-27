# OTTO Package Examples

These packages exercise the greenfield OTTO install contract. Install them from
the repository root with:

```sh
otto install ./examples/packages/extension-only
otto install ./examples/packages/skill-only
otto install ./examples/packages/prompt-only
otto install ./examples/packages/theme-only
otto install ./examples/packages/mixed
otto list
otto remove ./examples/packages/mixed
```

Use `-l` or `--local` to install a package into the current project's
`.otto/settings.json` instead of the user-level OTTO settings.

See `docs/user-docs/package-management.md` for the full package manifest,
source, update, removal, and publishing guide.
