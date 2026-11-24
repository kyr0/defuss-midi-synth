# Synthesis modules

`types.ts` owns public event validation and the operation codes. `queue.ts` owns stable timestamp ordering. `session.ts` turns that ordering into render calls bounded by event frames and the 64-frame grid. `engine.ts` owns the module instance, the SoundFont, the file transport and the PCM copy. `midifile.ts` parses MIDI, RMI and MUS files into timed messages. `parser.ts` parses MIDI byte streams and recognizes the GM, GS and XG resets. `assets.ts` reads the module and the SoundFont from a URL or the file system. The browser and offline facades use these shared modules, so a PCM comparison between the environments is meaningful.

Only the browser facade imports DOM APIs. The worklet declares its host globals in `worklet-env.d.ts`. The offline facade reads `file:` URLs through `process.getBuiltinModule`, so a browser bundle of it carries no Node import.

Typed arrays are allocated before processing. `process()` handles block lengths other than 128 by splitting them. Preset names are decoded byte by byte, because an AudioWorkletGlobalScope has no TextDecoder. SoundFont and file parsing remain command operations. Errors propagate through the caller's promise or end the worklet with a fatal message.
