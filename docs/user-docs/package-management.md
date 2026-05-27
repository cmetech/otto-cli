# OTTO Package Management

OTTO packages are the standard way to add capabilities to the CLI without
changing OTTO core. A package can provide one or more resource types:
extensions, skills, prompt templates, and themes.

The package manager is intentionally centralized. Use terminal commands for
installing, removing, listing, and updating packages. Use `/otto extensions`
inside the TUI only to inspect, enable, disable, or validate extension packages.

## Command Model

| Command | Purpose |
|---------|---------|
| `otto install <source>` | Install a package source for the current user |
| `otto install <source> --local` | Install a package source for the current project |
| `otto remove <source>` | Remove a user package source |
| `otto remove <source> --local` | Remove a project package source |
| `otto list` | Show installed package sources from user and project settings |
| `otto package update` | Update all updatable package sources |
| `otto package update <source>` | Update one matching package source |

There is no `otto uninstall` alias. There is also no supported
`/otto extensions install`, `/otto extensions uninstall`, or
`/otto extensions update` flow. Package lifecycle operations happen from the
terminal so all installable resource types use one mental model.

## Install Scopes

OTTO supports two persistent install scopes.

| Scope | Command | Stored in | Intended use |
|-------|---------|-----------|--------------|
| User | `otto install <source>` | User OTTO settings | Personal extensions, skills, prompts, and themes available across projects |
| Project | `otto install <source> --local` | Project OTTO settings | Project-specific capabilities that should follow the repository |

Project packages win over user packages when the same package identity appears
in both scopes. This lets a repository pin or override a package without
requiring every developer to modify their user settings.

## Source Types

### Local Directory

Use a relative or absolute path when developing or testing a package locally.

```sh
otto install ./examples/packages/mixed
otto list
otto remove ./examples/packages/mixed
```

Local packages are not copied. OTTO records the package source and resolves the
resources from that path when it starts.

### npm Package

Use the `npm:` prefix for packages published to npm.

```sh
otto install npm:@acme/otto-tools
otto install npm:@acme/otto-tools@1.2.3
otto remove npm:@acme/otto-tools
```

Unpinned npm sources can be updated with `otto package update`. Version-pinned
npm sources are left alone unless the pinned version is missing locally.

### Git Repository

Use a supported git URL when a package is distributed from source.

```sh
otto install https://github.com/acme/otto-tools.git
otto install git@github.com:acme/otto-tools.git
otto install github:acme/otto-tools
otto package update https://github.com/acme/otto-tools.git
```

Unpinned git sources update by fetching the remote and resetting to the tracking
branch. Pinned git refs are not advanced by `otto package update`.

## Package Manifest

An OTTO package declares resources in `package.json` under the `otto` key.

```json
{
  "name": "@acme/otto-tools",
  "version": "1.0.0",
  "type": "module",
  "otto": {
    "extension": true,
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  },
  "peerDependencies": {
    "@otto/pi-coding-agent": "*"
  }
}
```

Resource arrays are resolved relative to the package root.

| Manifest field | Resource type | Accepted files |
|----------------|---------------|----------------|
| `otto.extensions` | Runtime extension modules | `.ts`, `.js` |
| `otto.skills` | Skills | `SKILL.md` and other `.md` skill files |
| `otto.prompts` | Prompt templates | `.md` |
| `otto.themes` | Themes | `.json` |

`otto.extension: true` is required for packages that provide extensions and are
validated with `/otto extensions validate`. Packages that only provide skills,
prompts, or themes do not need the extension marker.

OTTO host packages, such as `@otto/pi-coding-agent`, belong in
`peerDependencies`. Do not bundle OTTO host packages in `dependencies` or
`devDependencies`; the host provides them at runtime.

## Resource Discovery

When a package has an `otto` manifest, the manifest is authoritative. OTTO
loads only the resource paths declared there.

When a package does not have an `otto` manifest, OTTO can still discover
convention directories named `extensions`, `skills`, `prompts`, and `themes`.
The manifest form is preferred because it is explicit and publishable.

Resource paths may also use include/exclude patterns. Prefix a pattern with
`!`, `+`, or `-`, or use wildcards such as `*` and `?`, when a package needs to
select a subset of files.

## Scenarios

### Extension-Only Package

Use this when you want to add slash commands, tools, hooks, provider behavior,
or custom UI.

Manifest shape:

```json
{
  "name": "@acme/otto-extension-only",
  "version": "1.0.0",
  "type": "module",
  "otto": {
    "extension": true,
    "extensions": ["./extensions"]
  },
  "peerDependencies": {
    "@otto/pi-coding-agent": "*"
  }
}
```

Install and validate:

```sh
otto install ./examples/packages/extension-only
otto
```

Inside the TUI:

```text
/otto extensions list
/otto extensions validate ./examples/packages/extension-only
```

### Skill-Only Package

Use this when you want to add reusable agent instructions without runtime code.

Manifest shape:

```json
{
  "name": "@acme/otto-skill-only",
  "version": "1.0.0",
  "type": "module",
  "otto": {
    "skills": ["./skills"]
  }
}
```

Install:

```sh
otto install ./examples/packages/skill-only
otto list
```

### Prompt-Only Package

Use this when you want to distribute reusable markdown prompt templates.

Manifest shape:

```json
{
  "name": "@acme/otto-prompt-only",
  "version": "1.0.0",
  "type": "module",
  "otto": {
    "prompts": ["./prompts"]
  }
}
```

Install:

```sh
otto install ./examples/packages/prompt-only
otto list
```

### Theme-Only Package

Use this when you want to ship one or more terminal UI themes.

Manifest shape:

```json
{
  "name": "@acme/otto-theme-only",
  "version": "1.0.0",
  "type": "module",
  "otto": {
    "themes": ["./themes"]
  }
}
```

Install:

```sh
otto install ./examples/packages/theme-only
otto list
```

### Mixed Package

Use this when one install should deliver a complete capability: extension code,
skills, prompts, and themes together.

Manifest shape:

```json
{
  "name": "@acme/otto-mixed-package",
  "version": "1.0.0",
  "type": "module",
  "otto": {
    "extension": true,
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  },
  "peerDependencies": {
    "@otto/pi-coding-agent": "*"
  }
}
```

Install:

```sh
otto install ./examples/packages/mixed
otto list
otto
```

## Project-Local Packages

Project-local packages are useful when a repository needs its own workflow
commands, codebase skills, or project prompts.

```sh
otto install ./tools/otto-package --local
otto list
```

The package is stored in project settings. Other developers can use the same
package when the repository includes the project settings and package files.

Use project-local installs for:

- Repository-specific skills.
- Repository-specific prompts.
- Workflow extensions that should not affect other projects.
- Packages that must be reviewed with the repository.

Use user installs for:

- Personal productivity skills.
- Personal themes.
- Private extensions used across many repositories.

## Update Behavior

`otto package update` checks installed package sources from both scopes.

| Source | Update behavior |
|--------|-----------------|
| Local path | No update action; OTTO reads the current files on startup |
| Unpinned npm package | Reinstall latest package version from npm |
| Pinned npm package | Skip unless the pinned version is missing |
| Unpinned git package | Fetch, reset to upstream, clean untracked files, reinstall dependencies if needed |
| Pinned git ref | Skip |

For one package:

```sh
otto package update npm:@acme/otto-tools
```

For everything:

```sh
otto package update
```

## Remove Behavior

`otto remove <source>` removes the package from settings and removes managed
npm or git installs. Local path packages are not deleted from disk; only the
settings entry is removed.

Use the same source identity you installed with:

```sh
otto remove ./examples/packages/mixed
otto remove npm:@acme/otto-tools
otto remove https://github.com/acme/otto-tools.git
```

For project-local packages, include `--local`:

```sh
otto remove ./tools/otto-package --local
```

## Validation

Extension packages can be validated from inside the TUI:

```text
/otto extensions validate ./examples/packages/extension-only
```

Validation checks:

- `package.json` exists and is valid JSON.
- Extension packages declare `otto.extension: true`.
- Extension packages declare at least one `otto.extensions` entry.
- Declared extension entries exist.
- OTTO host packages are not placed in `dependencies` or `devDependencies`.

Skill-only, prompt-only, and theme-only packages are loaded by package
resolution, but `/otto extensions validate` is specifically for extension
packages.

## Sample Packages

The repository includes local sample packages for the main scenarios:

| Sample | What it tests |
|--------|---------------|
| `extension-only` | A package that provides only extension code |
| `skill-only` | A package that provides only a skill |
| `prompt-only` | A package that provides only prompt templates |
| `theme-only` | A package that provides only a theme |
| `mixed` | A package that provides all resource types |

From the repository root:

```sh
otto install ./examples/packages/extension-only
otto install ./examples/packages/skill-only
otto install ./examples/packages/prompt-only
otto install ./examples/packages/theme-only
otto install ./examples/packages/mixed
otto list
otto remove ./examples/packages/mixed
```

## Troubleshooting

### The Package Does Not Appear in `otto list`

Check that you installed in the scope you are listing from. If you used
`--local`, run `otto list` from the same project directory.

### The Extension Does Not Appear in `/otto extensions list`

Restart OTTO after installing an extension package. Extension modules are loaded
at startup.

Also check that the package manifest contains:

```json
{
  "otto": {
    "extension": true,
    "extensions": ["./extensions"]
  }
}
```

### A Skill, Prompt, or Theme Does Not Load

Check that the manifest points to the correct resource directory and that files
use the expected extension:

- Skills: markdown files.
- Prompts: markdown files.
- Themes: JSON files.

### npm Install Fails

Use the `npm:` prefix and make sure the package exists:

```sh
otto install npm:@acme/otto-tools
```

For private packages, authenticate npm before running `otto install`.

### Git Install Fails

Confirm `git` is on PATH and the URL is accessible from the terminal. For
private repositories, configure SSH keys or token-based access before running
`otto install`.

### Offline or Air-Gapped Machines

Local packages work offline. npm and git packages require network access the
first time they are installed. Once installed, OTTO can resolve existing managed
packages without contacting the registry or remote.

## Publishing Checklist

Before publishing an OTTO package:

- Use the `otto` manifest key.
- Include only the resource arrays the package actually provides.
- Put OTTO host packages in `peerDependencies`.
- Keep runtime dependencies minimal and explicit.
- Validate extension packages with `/otto extensions validate`.
- Test local install with `otto install ./path-to-package`.
- Test removal with `otto remove ./path-to-package`.
- For npm packages, test `otto install npm:<package-name>` after publishing.

