SHELL := /bin/bash
.DEFAULT_GOAL := help
-include .env
# Recipes run the Bun and Node pinned in mise.toml even when the shell has not activated mise.
# Make 3.81 looks a recipe's first word up in its startup PATH, so the tools are resolved here.
MISE_PATH := $(shell command -v mise >/dev/null && mise bin-paths 2>/dev/null | paste -sd: -)
ifneq ($(MISE_PATH),)
PATH := $(MISE_PATH):$(PATH)
endif
NODE := $(shell PATH='$(PATH)' command -v node || echo node)
BUN := $(shell PATH='$(PATH)' command -v bun || echo bun)
export
.PHONY: help setup build dev start stop restart status log metrics bench test coverage lint e2e verify wasm wasm-docker vae pack release-hashes
help: ## List supported commands
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "%-16s %s\n", $$1, $$2}' Makefile
setup: ## Install pinned JS tools and Chromium
	@if command -v mise >/dev/null; then mise install; fi
	$(BUN) install --frozen-lockfile
	$(BUN) x playwright install chromium
build: ## Build ESM, types, worklet and browser demo
	$(BUN) run build
lint: ## Check TypeScript and lint without warnings
	$(BUN) run lint
	$(NODE) scripts/integrity.mjs
test: build ## Run real WASM and scheduling tests
	$(BUN) run test
coverage: ## Measure shared engine and scheduler coverage
	$(NODE) scripts/coverage.mjs
e2e: build ## Test built package and real Chromium AudioWorklet
	$(NODE) scripts/pack-test.mjs
	$(BUN) run e2e
verify: lint test coverage e2e ## Run deterministic verification
bench: build ## Benchmark SoundFont load and rendering throughput
	$(BUN) run bench
metrics: ## Read saved benchmark evidence
	@cat output/benchmark.json
dev: build ## Serve the browser demo in the foreground
	$(BUN) run dev
start: build ## Start the demo server with logs and a PID
	python3 scripts/service.py start
stop: ## Stop this project's demo server
	python3 scripts/service.py stop
restart: stop start ## Restart the demo server
status: ## Check this project's demo server
	python3 scripts/service.py status
log: ## Show recent server logs (N=80 default)
	@tail -n $(or $(N),80) var/log/server.stdout var/log/server.stderr
wasm: ## Rebuild both engines from native/ with emcc on PATH and check the OPL3 block renderer
	bash scripts/rebuild-wasm.sh
wasm-docker: ## Rebuild both engines with the Emscripten 4.0.10 container
	docker run --rm -u "$$(id -u):$$(id -g)" -v "$(CURDIR):/src" -w /src emscripten/emsdk:4.0.10 bash scripts/rebuild-wasm.sh
vae: ## Run the pinned defuss-vae gate
	bash scripts/vae.sh gate --session defuss-midi-synth
pack: build ## Create the npm-compatible package tarball
	$(BUN) pm pack --destination output
release-hashes: build ## Hash every release file into RELEASE_SHA256.json
	$(NODE) scripts/integrity.mjs --release
