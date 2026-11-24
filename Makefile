SHELL := /bin/bash
.DEFAULT_GOAL := help
-include .env
export
.PHONY: help setup build dev start stop restart status log metrics bench test coverage lint e2e verify wasm wasm-docker vae pack release-hashes
help: ## List supported commands
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "%-16s %s\n", $$1, $$2}' Makefile
setup: ## Install pinned JS tools and Chromium
	@if command -v mise >/dev/null; then mise install; fi
	bun install --frozen-lockfile
	bunx playwright install chromium
build: ## Build ESM, types, worklet and browser demo
	bun run build
lint: ## Check TypeScript and lint without warnings
	bun run lint
	node scripts/integrity.mjs
test: build ## Run real WASM and scheduling tests
	bun run test
coverage: ## Measure shared engine and scheduler coverage
	node scripts/coverage.mjs
e2e: build ## Test built package and real Chromium AudioWorklet
	node scripts/pack-test.mjs
	bun run e2e
verify: lint test coverage e2e ## Run deterministic verification
bench: build ## Benchmark SoundFont load and rendering throughput
	bun run bench
metrics: ## Read saved benchmark evidence
	@cat output/benchmark.json
dev: build ## Serve the browser demo in the foreground
	bun run dev
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
	bun pm pack --destination output
release-hashes: build ## Hash every release file into RELEASE_SHA256.json
	node scripts/integrity.mjs --release
