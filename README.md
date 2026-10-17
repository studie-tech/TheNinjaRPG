# :tada: TheNinja-RPG - Core 4 :tada:

This is the official source code for the game [www.TheNinja-RPG.com](www.TheNinja-RPG.com).

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
- Go to `http://127.0.0.1:3001` to manage the database

For parallel Git worktrees, use `make dev-up` to allocate a port and start or reuse a
background server. `make dev-status` prints its URL and live log path; `make dev-down`
stops only that worktree's server. Startup installs dependencies and reuses shared Docker
services without recreating them or deleting `.next`. `make dev-doctor` shows the database
target and broker configuration without exposing credentials. Worktrees still share
the database in `app/.env`.

Application Make commands select a compatible Bun from PATH or `~/.bun/bin/bun` using
the minimum version in `app/package.json`. Installation uses the committed lockfile
with `--frozen-lockfile`; dependency changes go through `make bun add <package>`.

The [dev-server skill](.agents/skills/tnr-dev-server/SKILL.md) documents disposable users,
authenticated endpoint calls and Chrome coordination. Tabs, windows and different ports
share cookies: use supported isolated Chrome contexts, or acquire `make dev-browser`
for authenticated UI work and release it with `make dev-browser-release` when done.
Other chats can continue API and server checks while the lease is held.

In [Codex local environments](https://developers.openai.com/codex/app/local-environments/),
configure `make dev-prepare` as the worktree setup script and `make start` as the Run
action. Preparation does not start a server or run migrations/seeds.

# :books: Learning Guide

The following videos on youtube are recommended to get a quick introduction to the project and the components of the tech stack:

- The official TheNinja-RPG youtube, [TNR DevLog](https://www.youtube.com/watch?v=m29HidoaGqM&list=PLKGedXg3BVNJAW2nNioLEv1tcQjiwrOgA)
- Next.js, Clerk, tRPC, Planetscale, tailwind: [T3 Stack Tutorial ](https://www.youtube.com/watch?v=YkOSUVzOAA4)
- Drizzle ORM: [DrizzleORM Pitch](https://www.youtube.com/watch?v=_SLxGYzv6jo)

# :bookmark: Local Development Guide

Various `make` commands are available; type `make help` at the root directory for list of available commands. Most importantly:

- Use `make bun add [package]` if you need to add some package
- Use `make build` to build the project
- Use `make makemigrations` to create migrations file for new database changes

# :lock: Licensing

This source code is released with [no license](https://choosealicense.com/no-permission/), meaning that the work is under exclusive copyright. We do not wish for countless of online copies to be released and float around.
