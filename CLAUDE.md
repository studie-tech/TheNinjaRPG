# CLAUDE.md

@AGENTS.md

## Claude Code specific

- Claude Code repo config lives in `.claude/` (settings, launch configs, worktrees).
- Shared agent skills are symlinked into `.claude/skills/` by `make ensure-skills` (runs automatically via `make bun`); edit the originals in `.agents/skills/`, never the symlinked copies.
