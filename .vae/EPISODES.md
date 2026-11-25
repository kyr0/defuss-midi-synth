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
2026-11-24T02:32:16Z s=5ed957d1 DONE fp=1dcb559db911 cov=96.8% paths=AGENTS.md,ARCH.md,CHANGELOG.md,Makefile(+119)
2026-11-24T02:32:16Z s=5ed957d1 FINDING src/voices.ts:FmVoices.message learn=test: tests/fm.test.ts 'an FM reset returns every channel to bank 0, program 1': fails on the old code, passes now
2026-11-24T02:32:16Z s=5ed957d1 FINDING src/offline.ts:useEngine,loadSoundFont,loadMidi learn=test: tests/load-options.test.ts 'OfflineSynth clears scheduled events where the browser does': fails on the old code, passes now
2026-11-24T02:32:16Z s=5ed957d1 FINDING src/offline.ts:render learn=test: tests/load-options.test.ts renders 10,000,064 frames: fails on the old code, passes now
2026-11-24T02:32:16Z s=5ed957d1 FINDING src/parser.ts:MidiStream.events learn=test: tests/core.test.ts MidiStream test: a rejected call leaves no events and keeps running status; fails on the old code
2026-11-24T02:32:16Z s=5ed957d1 FINDING src/midifile.ts:parseMus delay learn=test: tests/core.test.ts parser test: a five-byte MUS delay is malformed; fails on the old code
2026-11-24T02:32:16Z s=5ed957d1 FINDING src/offline.ts:useEngine; src/synth.ts:useEngine learn=test: tests/load-options.test.ts: Promise.all of two useEngine('fm') resolves both; fails on the old code
2026-11-24T02:32:16Z s=5ed957d1 FINDING src/offline.ts:loadSoundFont; src/synth.ts:loadSoundFont; README.md:76 learn=test: tests/load-options.test.ts: rejects with no onProgress event; fails on the old code
2026-11-24T02:32:16Z s=5ed957d1 FINDING src/assets.ts:unpack learn=test: tests/load-options.test.ts: TimGM6mb.sf2.br at a 1 MiB limit rejects with RangeError; fails on the old code
2026-11-24T02:32:16Z s=5ed957d1 FINDING src/synth.ts:dispose learn=none: A regression test needs a failing AudioWorklet in Chromium; e2e has no failure injection, and a stubbed node would be a mock.
2026-11-24T02:32:16Z s=5ed957d1 FINDING src/engine.ts:voices doc learn=test: tests/fm.test.ts percussion test asserts the release tail and 0 voices after note off
2026-11-24T02:34:01Z s=5ed957d1 DONE fp=e8a2020d2713 cov=96.8% paths=ARCH.md,CHANGELOG.md,Makefile,README.md(+12)
2026-11-24T02:49:28Z s=5ed957d1 DONE fp=2abd95bbdbfd cov=96.8% paths=README.md,THIRD_PARTY.md,docs/ARCH.md,docs/app.js(+2)
2026-11-24T03:01:37Z s=5ed957d1 DONE fp=20face035a98 cov=96.8% paths=docs/ARCH.md,docs/synth/assets-DQy7EZWb.d.ts,docs/synth/gm-CtLpIGC8.js,docs/synth/index.d.ts(+4)
2026-11-24T03:01:37Z s=5ed957d1 FINDING .gitignore:docs/synth/ (live site https://midi-synth.defuss.org/) learn=verifier: .vae/VERIFY.py pages.synth-tracked rejects a .gitignore line that ignores docs/synth
2026-11-24T04:02:30Z s=5ed957d1 FAIL tests.e2e.1
2026-11-24T04:05:45Z s=5ed957d1 DONE fp=a62e3e10aa55 cov=96.8% paths=README.md,VALIDATION.md,docs/ARCH.md,docs/music/index.json(+5)
2026-11-25T00:11:47Z s=5ed957d1 DONE fp=b39b4648ff0e cov=96.8% paths=CHANGELOG.md,README.md,THIRD_PARTY.md,VALIDATION.md(+6)
