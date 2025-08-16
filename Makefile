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

include ./app/.env

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

.PHONY: loadEnv
loadEnv: # Load environment variables
	@echo "${YELLOW}Loading environment variables${RESET}"
	source ./app/.env

-------------DockerSetup---------------: # -------------------------------------------------------
.PHONY: docker-build
docker-build: # Build/Rebuild the application.
	@echo "${YELLOW}Building/Rebuilding the application${RESET}"
	docker-compose --file $$PWD/.devcontainer/docker-compose.yml build --no-cache

.PHONY: docker-stop
docker-stop: # Stop all docker containers.
	@echo "${GREEN}docker-stop${RESET}"
	docker compose --progress plain --file $$PWD/.devcontainer/docker-compose.yml stop

-----------LocalDevelopment-------------: # -------------------------------------------------------
.PHONY: setup
setup: # Start required services and install bun locally
	@echo "${GREEN}Installing bun locally${RESET}"
	docker compose -f .devcontainer/docker-compose.yml up -d --wait
	curl -fsSL https://bun.sh/install | bash

.PHONY: install
install: # Install application dependencies with bun locally
	@echo "${GREEN}install${RESET}"
	bun install --cwd ./app --save-text-lockfile

.PHONY: bun
bun: install ## Execute bun command in local development.
	@echo "${GREEN}bun${RESET}"
	docker compose -f .devcontainer/docker-compose.yml up -d --wait		
	@echo $(DATABASE_URL)
	cd app && bun $(ARGS)

.PHONY: start
start: loadEnv # Run Next.js server, access at http://127.0.0.1:3000
	@echo "${GREEN}start${RESET}"
	rm -rf app/.next
	@make bun -- OPENAI_API_KEY=$(OPENAI_API_KEY) dev

.PHONY: build
build: # Build Next.js app
	@echo "${GREEN}build${RESET}"
	cd app && bun run build

.PHONY: bundleanalysis
bundleanalysis: # Build Next.js app with bundle analysis
	@echo "${GREEN}bundleanalysis${RESET}"
	cd app && bun run build-stats

.PHONY: mcp-servers
mcp-servers: # Start MCP servers
	@echo "${GREEN}Starting MCP servers${RESET}"
	npx @agentdeskai/browser-tools-server@1.2.0

.PHONY: openhands
openhands: # Open OpenHands on http://127.0.0.1:3004
	@echo "${GREEN}Launch Open Hands${RESET}"
	$(eval WORKSPACE_BASE := $(shell pwd -P))
	$(eval SANDBOX_USER_ID := $(shell id -u))
	@docker run -it --rm --pull=always \
		-e SANDBOX_RUNTIME_CONTAINER_IMAGE=docker.all-hands.dev/all-hands-ai/runtime:0.19-nikolaik \
		-e SANDBOX_USER_ID=$(SANDBOX_USER_ID) \
		-e WORKSPACE_MOUNT_PATH=$(WORKSPACE_BASE) \
		-v $(WORKSPACE_BASE):/opt/workspace_base \
		-e LOG_ALL_EVENTS=true \
		-v /var/run/docker.sock:/var/run/docker.sock \
		-v ~/.openhands-state:/.openhands-state \
		-p 3004:3000 \
		--add-host host.docker.internal:host-gateway \
		--name openhands-app \
		docker.all-hands.dev/all-hands-ai/openhands:0.19

--------------AI-helpers----------------: # -------------------------------------------------------
.PHONY: browser-tools-server
browser-tools-server: # Run browser-tools MCP server, allowing AI to see browser
	@echo "${GREEN}browser-tools-server${RESET}"
	npx @agentdeskai/browser-tools-server

--------------Migrations----------------: # -------------------------------------------------------
.PHONY: dbpush
dbpush: # Push schema to db without creating migrations
	@echo "${YELLOW}Pushing database schema to database${RESET}"
	cd app && bun dbpush

.PHONY: seed
seed: # Seed database
	@echo "${YELLOW}Seed data into database ${RESET}"
	@echo $(DATABASE_URL)
	cd app && bun seed
	
.PHONY: makemigrations
makemigrations: # Create database migration file
	@echo "${YELLOW}Create database migrations file ${RESET}"
	cd app && bun makemigrations

.PHONY: emptymigration
emptymigration: # Create database migration file
	@echo "${YELLOW}Create empty migrations file ${RESET}"
	cd app && bun emptymigration
	
----------------Tests-------------------: # -------------------------------------------------------
.PHONY: test
test: # Push schema to db without creating migrations
	@echo "${YELLOW}Running unit tests ${RESET}"
	cd app && bun test

.PHONY: lint
lint: # Push schema to db without creating migrations
	@echo "${YELLOW}Running linting ${RESET}"
	cd app && bun lint


-------------DEPENDENCIES---------------: # -------------------------------------------------------
.PHONY: deps-upgrade
deps-upgrade: # Upgrade all dependencies to their latest version
	@echo "${YELLOW}Upgrading all dependencies ${RESET}"
	cd app && npx npm-check-updates -u

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
git-branch-uncommit: # Undo the last N commits (keeping changes staged), usage: make uncommit N
	@echo "${YELLOW}Uncommitting branch commits${RESET}"
	git diff --binary --ignore-space-at-eol origin/main...HEAD > branch.patch
	git reset --hard origin/main
	git apply --whitespace=nowarn branch.patch
	rm -f branch.patch
