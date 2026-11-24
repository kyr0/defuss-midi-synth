# Build and verification scripts

`rebuild-wasm.sh` compiles `native/synth.c` with emcc, `check-wasm.mjs` fails when the module imports more than the engine provides or lacks an export the engine calls, and `integrity.mjs` records or checks the hashes of the native sources, the prebuilt module, the SoundFont and the bundled tool. `build.mjs` uses pkgroll for the package modules and esbuild for the worklet, writes each asset's licence beside it and assembles the static demo.

`pack-test.mjs` installs the generated tarball in an isolated consumer and validates declarations plus real rendering in Node and Bun. `e2e.mjs` runs Chromium against the built demo, drives each of its controls and the public API, and measures a real analyzer signal. `coverage.mjs` measures the shared modules exercised by the Node tests. `bench.mjs` reports the SoundFont's load time and warmed throughput with its workload and runtime.

`service.py` verifies a saved PID's command before sending a termination signal. `serve.mjs` confines paths to the chosen document root and binds to loopback. `vae.sh` extracts the pinned verification tool into ignored temporary storage, so the source archive stays unchanged.
