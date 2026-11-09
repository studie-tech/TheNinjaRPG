# Define bash as default shell
SHELL := bash

.DEFAULT_GOAL = help

# Extract arguments for relevant targets.
ARGS_TARGETS=makemigrations,bun,uncommit,squash
ifneq ($(findstring $(firstword $(MAKECMDGOALS)),$(ARGS_TARGETS)),)
  ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
  $(eval $(ARGS):;@:)
endif

# Define makefile colors, see: https://gist.github.com/rsperl/d2dfe88a520968fbc1f49db0a29345b9
ifneq (,$(findstring xterm,${TERM}))
	RED          := $(shell tput -Txterm setaf 1)
	GREEN        := $(shell tput -Txterm setaf 2)
	YELLOW       := $(shell tput -Txterm setaf 3)
	RESET        := $(shell tput -Txterm sgr0)
else
	RED 		 := ""
	GREEN		 := ""
	YELLOW       := ""
	RESET        := ""
endif

-include ./app/.env

PORT ?=
export PORT REQUEST USER_KEY ENDPOINT INPUT_FILE

SPACETIME_VERSION := $(shell node -p "require('./app/package.json').dependencies.spacetimedb")
SPACETIME_BIN ?= $(HOME)/.local/share/spacetime/bin/$(SPACETIME_VERSION)/spacetimedb-cli

## List of available commands:
---------------General------------------: # -------------------------------------------------------
.PHONY: help
help: # Print help.
	@sed -ne '/@sed/!s/## //p' $(MAKEFILE_LIST)
	@cat $(MAKEFILE_LIST) | grep -e "^[a-zA-Z_\-]*: *.*# *" | awk 'BEGIN {FS = ":.*?# "}; {printf "\033[36m%-40s\033[0m %s\n", $$1, $$2}'

.PHONY: cloc
cloc: # Count lines of code
	@echo "${YELLOW}Count lines of code${RESET}"
	cloc --exclude-dir=node_modules --exclude-ext=csv  --exclude-ext=json  --exclude-ext=svg .

-------------DockerSetup---------------: # -------------------------------------------------------
.PHONY: docker-build
docker-build: # Build/Rebuild the application.
	@echo "${YELLOW}Building/Rebuilding the application${RESET}"
	docker compose -p devcontainer -f $$PWD/.devcontainer/docker-compose.yml build --no-cache

.PHONY: docker-apply
docker-apply: # Recreate the shared service stack from the current docker-compose.yml
	@echo "${YELLOW}Applying docker-compose changes to the shared stack${RESET}"
	docker compose -p devcontainer -f $$PWD/.devcontainer/docker-compose.yml up -d --wait

.PHONY: docker-stop
docker-stop: # Stop all docker containers.
	@echo "${GREEN}docker-stop${RESET}"
	docker compose --progress plain -p devcontainer -f $$PWD/.devcontainer/docker-compose.yml stop

-----------LocalDevelopment-------------: # -------------------------------------------------------
.PHONY: setup
setup: ensure-services # Start required services and install bun locally
	@echo "${GREEN}Installing bun locally${RESET}"
	curl -fsSL https://bun.sh/install | bash

.PHONY: install
install: ensure-skills # Install application dependencies with bun locally
	@echo "${GREEN}install${RESET}"
	node scripts/dev-bun.mjs install --cwd ./app --frozen-lockfile

.PHONY: ensure-env
ensure-env: # Ensure app/.env exists in this worktree (links it from the main worktree if missing)
	@bash scripts/dev-ensure-env.sh >&2

.PHONY: ensure-services
ensure-services: # Ensure the shared local service stack is running (parallel-worktree safe)
	@bash scripts/dev-ensure-services.sh

.PHONY: ensure-skills
ensure-skills: # Link .agents/skills into .claude/skills so Claude Code can discover them
	@bash scripts/dev-ensure-skills.sh

.PHONY: clean
clean: # Clean all local application installation folders
	@echo "${YELLOW}Cleaning local installation folders${RESET}"
	rm -rf ./app/node_modules
	rm -rf ./app/.next

.PHONY: reset
reset: clean install # Clean and reinstall all dependencies

.PHONY: bun
bun: $(if $(filter install add remove update,$(firstword $(ARGS))),ensure-skills,install) ensure-env ensure-services ## Execute bun command in local development.
	@echo "${GREEN}bun${RESET}"
	cd app && node ../scripts/dev-bun.mjs $(ARGS)

.PHONY: start
start: # Run this worktree's server in the foreground (PORT optional)
	@node scripts/dev-server.mjs start

.PHONY: dev-prepare
dev-prepare: ensure-env # Prepare a worktree without starting a server
	@test -f app/.env || { echo 'dev: app/.env missing; copy app/.env.example and configure it.' >&2; exit 1; }
	@$(MAKE) install ensure-services

.PHONY: dev-up dev-status dev-down
dev-up: # Start/reuse this worktree's server, wait for HTTP readiness, print JSON
	@node scripts/dev-server.mjs up
dev-status: # Show this worktree's server, log, and browser context prefix as JSON
	@node scripts/dev-server.mjs status
dev-down: # Stop only this worktree's managed server; leave shared Docker alone
	@node scripts/dev-server.mjs down

.PHONY: dev-user dev-call dev-doctor
dev-user: ensure-env # Provision REQUEST=<json file>, save private credentials
	@cd app && node ../scripts/dev-bun.mjs run scripts/dev-user.ts provision
dev-call: ensure-env # Call ENDPOINT as USER_KEY with optional INPUT_FILE
	@cd app && node ../scripts/dev-bun.mjs run scripts/dev-user.ts call
dev-doctor: ensure-env # Show env/broker/database configuration without secrets
	@cd app && node ../scripts/dev-bun.mjs run scripts/dev-user.ts doctor

.PHONY: build
build: ensure-env # Build Next.js app
	@echo "${GREEN}build${RESET}"
	cd app && node ../scripts/dev-bun.mjs run build

.PHONY: bundleanalysis
bundleanalysis: ensure-env # Build Next.js app with bundle analysis
	@echo "${GREEN}bundleanalysis${RESET}"
	cd app && node ../scripts/dev-bun.mjs run build-stats

--------------Migrations----------------: # -------------------------------------------------------
.PHONY: dbpush
dbpush: ensure-env ensure-services # Push schema to db without creating migrations
	@echo "${YELLOW}Pushing database schema to database${RESET}"
	cd app && node ../scripts/dev-bun.mjs dbpush

.PHONY: discord-register-metadata
discord-register-metadata: ensure-env # Register the Discord Linked Roles metadata schema
	@echo "${YELLOW}Register Discord Linked Roles metadata ${RESET}"
	cd app && node ../scripts/dev-bun.mjs run discord:register-metadata

.PHONY: seed
seed: ensure-env ensure-services # Seed database
	@echo "${YELLOW}Seed data into database ${RESET}"
	cd app && node ../scripts/dev-bun.mjs seed
	
.PHONY: makemigrations
makemigrations: ensure-env # Create database migration file
	@echo "${YELLOW}Create database migrations file ${RESET}"
	cd app && node ../scripts/dev-bun.mjs makemigrations

.PHONY: emptymigration
emptymigration: ensure-env # Create an empty custom migration file
	@echo "${YELLOW}Create empty migrations file ${RESET}"
	cd app && node ../scripts/dev-bun.mjs emptymigration
	
----------------Tests-------------------: # -------------------------------------------------------
.PHONY: test
test: export NODE_ENV = test
test: # Run tests in up to four isolated Bun shards (TEST_SHARDS=1..4)
	@echo "${YELLOW}Running unit tests ${RESET}"
	cd app && node ../scripts/dev-bun.mjs run test

.PHONY: test-serial
test-serial: export NODE_ENV = test
test-serial: # Run tests in one Bun process for debugging
	cd app && node ../scripts/dev-bun.mjs run test:serial

.PHONY: lint
lint: # Run linting of the project
	@echo "${YELLOW}Running linting ${RESET}"
	cd app && node ../scripts/dev-bun.mjs run lint

.PHONY: format
format: # Run biome formatter on the project
	@echo "${YELLOW}Running biome formatter${RESET}"
	cd app && node ../scripts/dev-bun.mjs run format:write

.PHONY: check
check: # Run Biome and TypeScript checks
	cd app && node ../scripts/dev-bun.mjs run check

.PHONY: typecheck
typecheck: # Run TypeScript type checking
	@echo "${YELLOW}Running TypeScript type checking${RESET}"
	cd app && node ../scripts/dev-bun.mjs run typecheck

-------------DEPENDENCIES---------------: # -------------------------------------------------------
.PHONY: deps-upgrade
deps-upgrade: install # Upgrade npm manifests and lockfiles across the app and mobile shells
	@echo "${YELLOW}Upgrading all dependencies ${RESET}"
	node scripts/deps-upgrade.mjs

---------------Mobile-----------------: # -------------------------------------------------------
.PHONY: mobile-install
mobile-install: # Install Capacitor dependencies for the native shells
	@echo "${GREEN}mobile-install${RESET}"
	cd mobile && bun install

.PHONY: mobile-sync
mobile-sync: # Copy web config and plugins into the native projects
	@echo "${GREEN}mobile-sync${RESET}"
	cd mobile && bun run sync

.PHONY: mobile-configure
mobile-configure: # Apply capabilities and the widget target to the generated Xcode project
	@echo "${GREEN}mobile-configure${RESET}"
	cd mobile && bun run configure:ios

.PHONY: mobile-beta
mobile-beta: # Upload builds to TestFlight and the Play internal track
	@echo "${GREEN}mobile-beta${RESET}"
	cd mobile && bun run beta:ios && bun run beta:android

.PHONY: mobile-ios
mobile-ios: # Build and run the iOS shell in the simulator
	@echo "${GREEN}mobile-ios${RESET}"
	cd mobile && bun run run:ios

.PHONY: mobile-android
mobile-android: # Build and run the Android shell in an emulator
	@echo "${GREEN}mobile-android${RESET}"
	cd mobile && bun run run:android

-------------SpacetimeDB---------------: # -------------------------------------------------------
.PHONY: spacetime-install
spacetime-install: # Install SpacetimeDB CLI
	@echo "${YELLOW}Installing SpacetimeDB CLI${RESET}"
	curl -sSf https://install.spacetimedb.com | bash -s -- --yes
	~/.local/bin/spacetime version install $(SPACETIME_VERSION) --yes

.PHONY: spacetime-start
spacetime-start: # Start local SpacetimeDB server on port 3001
	@echo "${GREEN}Starting local SpacetimeDB server on port 3001${RESET}"
	$(SPACETIME_BIN) start --listen-addr 127.0.0.1:3001

.PHONY: spacetime-build
spacetime-build: # Build SpacetimeDB Rust module
	@echo "${GREEN}Building SpacetimeDB module (Rust)${RESET}"
	export PATH="$$HOME/.cargo/bin:$$PATH" && cd app/spacetimedb && $(SPACETIME_BIN) build

.PHONY: spacetime-publish-local
spacetime-publish-local: # Build, publish, and generate TypeScript bindings
	@echo "${GREEN}Publishing SpacetimeDB module to local server${RESET}"
	export PATH="$$HOME/.cargo/bin:$$PATH" && cd app/spacetimedb && $(SPACETIME_BIN) build && echo "y" | $(SPACETIME_BIN) publish --server local3001 --delete-data towerdefense
	$(MAKE) spacetime-generate
	@echo "${GREEN}Done! Module published and bindings generated${RESET}"

.PHONY: spacetime-generate
spacetime-generate: install # Generate TypeScript bindings with the CLI matching the app SDK
	export PATH="$$HOME/.cargo/bin:$$PATH" && $(SPACETIME_BIN) generate --lang typescript --module-path app/spacetimedb --out-dir app/src/libs/spacetimedb/bindings --yes
	cd app && ./node_modules/.bin/biome check --write --no-errors-on-unmatched src/libs/spacetimedb/bindings

.PHONY: spacetime-publish-prod
spacetime-publish-prod: spacetime-build # Publish SpacetimeDB module to production (SaaS)
	@echo "${GREEN}Publishing SpacetimeDB module to production SaaS${RESET}"
	export PATH="$$HOME/.cargo/bin:$$PATH" && cd app/spacetimedb && $(SPACETIME_BIN) publish --delete-data $(or $(NEXT_PUBLIC_SPACETIMEDB_MODULE), towerdefense)

.PHONY: spacetime-logs
spacetime-logs: # View SpacetimeDB module logs
	@echo "${GREEN}Viewing SpacetimeDB logs${RESET}"
	$(SPACETIME_BIN) logs --server local3001 towerdefense

.PHONY: spacetime-logs-follow
spacetime-logs-follow: # Follow SpacetimeDB module logs in real-time
	@echo "${GREEN}Following SpacetimeDB logs${RESET}"
	$(SPACETIME_BIN) logs --server local3001 -f towerdefense

---------------Git--------------------: # -------------------------------------------------------
.PHONY: uncommit
uncommit: # Undo the last N commits (keeping changes staged), usage: make uncommit N
	@echo "${YELLOW}Uncommitting last $(ARGS) commits${RESET}"
	git reset --soft HEAD~$(ARGS)
	
.PHONY: squash
squash: # Squash the last N commits into one, usage: make squash N
	@echo "${YELLOW}Squashing last $(ARGS) commits${RESET}"
	git reset --soft HEAD~$(ARGS) && git commit --edit -m"$(shell git log --format=%B --reverse HEAD..HEAD@{1})"

.PHONY: git-branch-uncommit
git-branch-uncommit: # Reset to origin/main and reapply this branch's changes as unstaged edits
	@echo "${YELLOW}Uncommitting branch commits${RESET}"
	git diff --binary --ignore-space-at-eol origin/main...HEAD > branch.patch
	git reset --hard origin/main
	git apply --reject --whitespace=fix branch.patch
	rm -f branch.patch
