# :tada: TheNinja-RPG - Core 4 :tada:

This is the official source code for the game [www.TheNinja-RPG.com](https://www.theninja-rpg.com).

# :computer: Setting up locally

The codebase relies on a variety of external services for e.g. auth, websockets, database, etc. Some of these are next to impossible to replicate locally, but provide free (or very cheap) tiers. To get up and running, it is therefore required to sign up for free accounts on the following services:

- https://clerk.com/ - for auth (required)
- https://uploadthing.com/ - for file uploads (optional)
- https://replicate.com/ - for AI inference (optional)

To get started, copy `app/.env.example` to `app/.env` and fill in all variables related to services (`*CLERK*`, `REPLICATE*`, `UPLOADTHING*`).

```bash
make setup # Install bun locally
make install # Run bun install
make dbpush # Setup database tables
make seed # Seed database tables
make start PORT=3000 # Start development server in the foreground
```

- Go to `http://localhost:3000` to view the site (use `localhost`, not `127.0.0.1`, or Next.js chunks 403)
- Go to `http://127.0.0.1:3005` to manage the database

For parallel Git worktrees, use `make dev-up` to allocate a port and start or reuse a
background server. `make dev-status` prints its URL and live log path; `make dev-down`
stops only that worktree's server. Startup installs dependencies and reuses shared Docker
services without recreating them or deleting `.next`. `make dev-doctor` shows the database
target and broker configuration without exposing credentials. Worktrees still share
the database in `app/.env`.

Run `make test` for the Bun suite. The [testing guide](app/tests/README.md) covers
feature locations, shared fixtures, focused runs and disposable SQL/Redis setup.

Application Make commands select a compatible Bun from PATH or `~/.bun/bin/bun` using
the minimum version in `app/package.json`. Installation uses the committed lockfile
with `--frozen-lockfile`; dependency changes go through `make bun add <package>`.

`make deps-upgrade` uses the pinned `npm-check-updates` to query the registry's
`latest` releases for both npm manifests, including overrides and resolutions,
then refreshes their Bun lockfiles. `node scripts/deps-upgrade.mjs --check` checks
the manifests without changing files. Review upstream migration guides and rebase
versioned patches before running `make check` and `make test`. Native dependencies
also require `make mobile-sync` and the checks documented in `mobile/README.md`.

The [dev-server skill](.agents/skills/tnr-dev-server/SKILL.md) documents disposable users,
authenticated endpoint calls, Chrome coordination and Codex local environments.

## Game and welcome layouts

Visitors and players choose Classic, Pixel, Eclipse Observatory, Obsidian Council or Sakura
Courtyard from one layout selector in Settings → Display. Selection is saved on the
device and applies to both the welcome page and the game. Public page headers also
provide the shared sound and display settings in the upper-right corner; `/layouts`
shows all five designs. Their identifiers are `default`, `pixel`,
`20-eclipse-observatory`, `17-obsidian-council` and `3-sakura-courtyard`.
`app/src/libs/gameLayouts.ts` defines their names, appearance, frame selection and
responsive behavior; every game frame uses the same controller and layout preference.

`NEXT_PUBLIC_WELCOME_LAYOUT` sets the welcome design for visitors without a saved choice;
unset or unrecognized values use `default`, and changes need a dev server restart or a
rebuild. A visitor's explicit choice takes precedence. Search crawlers receive the default
public shell. Signing out returns to the public welcome page with the selected layout.

# :books: Learning Guide

The following videos on youtube are recommended to get a quick introduction to the project and the components of the tech stack:

- The official TheNinja-RPG youtube, [TNR DevLog](https://www.youtube.com/watch?v=m29HidoaGqM&list=PLKGedXg3BVNJAW2nNioLEv1tcQjiwrOgA)
- Next.js, Clerk, tRPC, Planetscale, tailwind: [T3 Stack Tutorial ](https://www.youtube.com/watch?v=YkOSUVzOAA4)
- Drizzle ORM: [DrizzleORM Pitch](https://www.youtube.com/watch?v=_SLxGYzv6jo)

# :bookmark: Local Development Guide

Type `make help` at the root directory for the list of available commands, and read [CONTRIBUTING.md](CONTRIBUTING.md) for the code conventions.

# :lock: Licensing

This source code is released with [no license](https://choosealicense.com/no-permission/), meaning that the work is under exclusive copyright. We do not wish for countless of online copies to be released and float around.
