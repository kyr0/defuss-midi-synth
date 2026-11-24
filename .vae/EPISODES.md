# Episodes

<!-- Newest last. The gate appends FAIL|DONE|FINDING; past 100 entries it trims only its own oldest DONE|FAIL|learned
FINDING (git keeps them). Leads (LESSON, FINDING learn=none) stay until wrap settles them; doctor fails above 30.
Agents append `<UTC ISO> s=<session> LESSON <VAE-DIALECT>` only for a falsified HYPOTHESIS, a dead end, or a root cause.
Session start injects the 3 newest open entries: LESSON, FINDING learn=none, FAIL without a later DONE.
Wrap: EVERY lead becomes a test | .vae/VERIFY.py rule | one MEMORY line with BC, then delete; OR delete BC evidence. -->

2026-11-16T22:06:33Z s=defuss-m FAIL package
2026-11-16T22:10:03Z s=defuss-m DONE fp=2947d342c278 cov=100.0% paths=AGENTS.md,ARCH.md,CHANGELOG.md,Makefile(+36)
2026-11-16T22:10:03Z s=defuss-m FINDING scripts/patch-fast.py:reference core adapter learn=test: Compare matching upstream cores before attributing output differences to the optimized DSP.
2026-11-16T22:10:03Z s=defuss-m FINDING docs/app.js:file onchange learn=test: UI transport state must match the native loader after rejection.
2026-11-16T22:10:03Z s=defuss-m FINDING README.md:panic API row learn=none: This is a documentation scope correction supported by the command dispatch; no implementation change.
2026-11-23T16:40:00Z s=defuss-m FINDING src/worklet.ts:process learn=none: Chrome once passed a currentFrame below the session's frame (1 of 9 runs; a counter saw none in 3); the worklet clamps to the session's frame. HYPOTHESIS until a repeat with the counter.
2026-11-23T16:40:00Z s=defuss-m FINDING src/session.ts:RENDER_GRID learn=test: TinySoundFont steps envelopes per <=64-frame block from each call's start; renders split at the 64-frame grid keep PCM block-size invariant.
2026-11-23T16:40:00Z s=defuss-m FINDING tests/core.test.ts:file messages learn=test: measure pitch before a file's end; SF2's default ~1 ms release cuts the tone at the end-of-file note off.
2026-11-24T01:36:25Z s=5ed957d1 FAIL prose,tests.unit,coverage
2026-11-24T01:37:17Z s=5ed957d1 FAIL tests.e2e.1,coverage
