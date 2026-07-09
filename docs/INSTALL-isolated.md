# Isolated install (run the advisor fork alongside official opencode)

This fork shares a binary name and state directories with official
[opencode](https://opencode.ai), so installing it normally would clash with an
existing install. These instructions use [bubblewrap](https://github.com/containers/bubblewrap)
(`bwrap`) to run the fork with its **own** config, data, cache, and auth — the
official install is never read or modified, and vice versa.

## Why they conflict

Both builds use the same binary name (`opencode`) and the same XDG state
directories (see `packages/core/src/global.ts`):

| Path | Holds |
| --- | --- |
| `~/.config/opencode` | user config |
| `~/.local/share/opencode` | `auth.json`, session storage, logs |
| `~/.cache/opencode` | model catalog cache, downloaded bins |
| `~/.local/state/opencode` | locks / runtime state |
| `~/.opencode/bin` | the installed binary |

Sharing `auth.json` and session storage is the real hazard. Bubblewrap
bind-mounts fork-private directories over those paths, so the fork sees only its
own state while your projects, `git`, and `ssh` stay accessible.

## Prerequisites

- **Linux** with `bwrap` — `apt install bubblewrap` / `dnf install bubblewrap` / `pacman -S bubblewrap`
- [`bun`](https://bun.sh) and `git`

> Bubblewrap is Linux-only. On macOS, use the [environment-variable
> variant](#no-bwrap-alternative-any-os) below.

## 1. Build the fork binary (in a separate location)

```bash
git clone https://github.com/ArgonautGit/opencode-advisor
cd opencode-advisor
git checkout claude/opencode-advisor-feature-l4axfz
bun install
cd packages/opencode && bun run script/build.ts --single   # -> dist/opencode-<os>-<arch>/bin/opencode

# stage it OUTSIDE ~/.opencode so it never touches the official install
mkdir -p ~/.local/share/opencode-advisor/bin
cp dist/*/bin/opencode ~/.local/share/opencode-advisor/bin/opencode
```

> Prefer not to build? Skip this step and run from source instead — replace
> `"$FORK_BIN"` in the wrapper below with
> `bun run /abs/path/to/opencode-advisor/packages/opencode/src/index.ts`.

## 2. Install the bubblewrap wrapper

The wrapper is named `opencode-advisor` so it never shadows the official
`opencode` on your `PATH`.

```bash
mkdir -p ~/.local/bin
cat > ~/.local/bin/opencode-advisor <<'EOF'
#!/usr/bin/env bash
# Run the opencode "advisor" fork isolated from any official opencode install.
set -euo pipefail

FORK_BIN="${OPENCODE_ADVISOR_BIN:-$HOME/.local/share/opencode-advisor/bin/opencode}"
PRIV="${OPENCODE_ADVISOR_STATE:-$HOME/.local/share/opencode-advisor/xdg}"
mkdir -p "$PRIV"/{config,data,cache,state}

exec bwrap \
  --bind / / \
  --dev-bind /dev /dev \
  --proc /proc \
  --tmpfs "$HOME/.opencode" \
  --bind "$PRIV/config" "$HOME/.config/opencode" \
  --bind "$PRIV/data"   "$HOME/.local/share/opencode" \
  --bind "$PRIV/cache"  "$HOME/.cache/opencode" \
  --bind "$PRIV/state"  "$HOME/.local/state/opencode" \
  --chdir "$PWD" \
  "$FORK_BIN" "$@"
EOF
chmod +x ~/.local/bin/opencode-advisor

# ensure ~/.local/bin is on PATH (most distros already do this)
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc ;; esac
```

What each part does:

- `--bind / /` — keep the whole system available (projects, `git`, `ssh`, LSP
  servers, formatters).
- `--proc /proc` / `--dev-bind /dev /dev` — clean virtual mounts.
- the four `--bind "$PRIV/…"` lines — redirect the fork's config/data/cache/state
  into `~/.local/share/opencode-advisor/xdg/`, shadowing the official dirs.
- `--tmpfs "$HOME/.opencode"` — hide the official install directory.
- Network is **shared** (not unshared), so model providers still work.

## 3. Use it

```bash
opencode-advisor providers login          # separate auth.json — won't touch your official login
opencode-advisor                          # TUI, fully isolated

# advisor feature:
echo '{ "advisor_model": "anthropic/claude-opus-4-8" }' > opencode.json
opencode-advisor run "consult the advisor before continuing: <task>"
```

Verify the isolation held:

```bash
ls ~/.local/share/opencode-advisor/xdg/data/   # the fork's auth.json + storage live here
# your official ~/.local/share/opencode/auth.json is never modified
```

## No-bwrap alternative (any OS)

The same isolation, minus the kernel-level enforcement bubblewrap adds. opencode
honors the XDG environment variables (via `xdg-basedir`), so pointing them at
fork-private directories keeps config/data/auth separate:

```bash
#!/usr/bin/env bash
set -euo pipefail
FORK_BIN="${OPENCODE_ADVISOR_BIN:-$HOME/.local/share/opencode-advisor/bin/opencode}"
PRIV="${OPENCODE_ADVISOR_STATE:-$HOME/.local/share/opencode-advisor/xdg}"
mkdir -p "$PRIV"/{config,data,cache,state}
export XDG_CONFIG_HOME="$PRIV/config"
export XDG_DATA_HOME="$PRIV/data"
export XDG_CACHE_HOME="$PRIV/cache"
export XDG_STATE_HOME="$PRIV/state"
exec "$FORK_BIN" "$@"
```

## The advisor feature

Once isolated, this fork adds an **advisor** tool: the main model can consult a
stronger `advisor_model` at hard decision points (before committing to an
approach, when an error keeps recurring, or before declaring a task done). It is
enabled per config:

```jsonc
// opencode.json
{
  "model": "anthropic/claude-sonnet-5",
  "advisor_model": "anthropic/claude-opus-4-8"
}
```

You can also set it for one session with `--advisor provider/model`, change it
mid-session with the `/advisor` command, or disable the tool entirely with
`OPENCODE_DISABLE_ADVISOR=1`.
