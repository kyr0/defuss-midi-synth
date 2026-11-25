// src/gm.ts
var GM_PROGRAMS = [
  "Acoustic Grand Piano",
  "Bright Acoustic Piano",
  "Electric Grand Piano",
  "Honky-tonk Piano",
  "Electric Piano 1",
  "Electric Piano 2",
  "Harpsichord",
  "Clavi",
  "Celesta",
  "Glockenspiel",
  "Music Box",
  "Vibraphone",
  "Marimba",
  "Xylophone",
  "Tubular Bells",
  "Dulcimer",
  "Drawbar Organ",
  "Percussive Organ",
  "Rock Organ",
  "Church Organ",
  "Reed Organ",
  "Accordion",
  "Harmonica",
  "Tango Accordion",
  "Acoustic Guitar (nylon)",
  "Acoustic Guitar (steel)",
  "Electric Guitar (jazz)",
  "Electric Guitar (clean)",
  "Electric Guitar (muted)",
  "Overdriven Guitar",
  "Distortion Guitar",
  "Guitar Harmonics",
  "Acoustic Bass",
  "Electric Bass (finger)",
  "Electric Bass (pick)",
  "Fretless Bass",
  "Slap Bass 1",
  "Slap Bass 2",
  "Synth Bass 1",
  "Synth Bass 2",
  "Violin",
  "Viola",
  "Cello",
  "Contrabass",
  "Tremolo Strings",
  "Pizzicato Strings",
  "Orchestral Harp",
  "Timpani",
  "String Ensemble 1",
  "String Ensemble 2",
  "SynthStrings 1",
  "SynthStrings 2",
  "Choir Aahs",
  "Voice Oohs",
  "Synth Voice",
  "Orchestra Hit",
  "Trumpet",
  "Trombone",
  "Tuba",
  "Muted Trumpet",
  "French Horn",
  "Brass Section",
  "SynthBrass 1",
  "SynthBrass 2",
  "Soprano Sax",
  "Alto Sax",
  "Tenor Sax",
  "Baritone Sax",
  "Oboe",
  "English Horn",
  "Bassoon",
  "Clarinet",
  "Piccolo",
  "Flute",
  "Recorder",
  "Pan Flute",
  "Blown Bottle",
  "Shakuhachi",
  "Whistle",
  "Ocarina",
  "Lead 1 (square)",
  "Lead 2 (sawtooth)",
  "Lead 3 (calliope)",
  "Lead 4 (chiff)",
  "Lead 5 (charang)",
  "Lead 6 (voice)",
  "Lead 7 (fifths)",
  "Lead 8 (bass + lead)",
  "Pad 1 (new age)",
  "Pad 2 (warm)",
  "Pad 3 (polysynth)",
  "Pad 4 (choir)",
  "Pad 5 (bowed)",
  "Pad 6 (metallic)",
  "Pad 7 (halo)",
  "Pad 8 (sweep)",
  "FX 1 (rain)",
  "FX 2 (soundtrack)",
  "FX 3 (crystal)",
  "FX 4 (atmosphere)",
  "FX 5 (brightness)",
  "FX 6 (goblins)",
  "FX 7 (echoes)",
  "FX 8 (sci-fi)",
  "Sitar",
  "Banjo",
  "Shamisen",
  "Koto",
  "Kalimba",
  "Bag pipe",
  "Fiddle",
  "Shanai",
  "Tinkle Bell",
  "Agogo",
  "Steel Drums",
  "Woodblock",
  "Taiko Drum",
  "Melodic Tom",
  "Synth Drum",
  "Reverse Cymbal",
  "Guitar Fret Noise",
  "Breath Noise",
  "Seashore",
  "Bird Tweet",
  "Telephone Ring",
  "Helicopter",
  "Applause",
  "Gunshot"
];

// src/profile-clock.ts
var NativeClock = class {
  constructor(nativeRate, outputRate) {
    this.nativeRate = nativeRate;
    this.outputRate = outputRate;
    if (!Number.isSafeInteger(nativeRate) || nativeRate < 8e3 || nativeRate > 192e3 || !Number.isSafeInteger(outputRate) || outputRate < 8e3 || outputRate > 192e3) throw new RangeError("Invalid PCM clock");
  }
  phase = 0;
  pl = 0;
  pr = 0;
  cl = 0;
  cr = 0;
  l = new Float32Array(128);
  r = new Float32Array(128);
  render(left, right, offset, frames, pull) {
    if (!Number.isInteger(frames) || frames < 0 || frames > 128 || !Number.isInteger(offset) || offset < 0 || offset + frames > Math.min(left.length, right.length)) throw new RangeError("Invalid render range");
    let remaining = Math.floor((this.phase + frames * this.nativeRate) / this.outputRate);
    let at = 0, count = 0;
    for (let i = 0; i < frames; i++) {
      this.phase += this.nativeRate;
      while (this.phase >= this.outputRate) {
        this.phase -= this.outputRate;
        if (at === count) {
          count = Math.min(128, remaining);
          pull(this.l, this.r, count);
          remaining -= count;
          at = 0;
        }
        this.pl = this.cl;
        this.pr = this.cr;
        this.cl = this.l[at];
        this.cr = this.r[at++];
      }
      const f = this.phase / this.outputRate;
      left[offset + i] = this.pl + (this.cl - this.pl) * f;
      right[offset + i] = this.pr + (this.cr - this.pr) * f;
    }
  }
  reset() {
    this.phase = 0;
    this.pl = this.pr = this.cl = this.cr = 0;
  }
};

// src/profile-presets.ts
var SC55 = [
  [0, -1, ["Piano 1", "Piano 2", "Piano 3", "Honky-tonk", "E.Piano 1", "E.Piano 2", "Harpsichord", "Clav.", "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular-bell", "Santur", "Organ 1", "Organ 2", "Organ 3", "Church Org.1", "Reed Organ", "Accordion Fr", "Harmonica", "Bandneon", "Nylon-str.Gt", "Steel-str.Gt", "Jazz Gt.", "Clean Gt.", "Muted Gt.", "Overdrive Gt", "DistortionGt", "Gt.Harmonics", "Acoustic Bs.", "Fingered Bs.", "Picked Bs.", "Fretless Bs.", "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2", "Violin", "Viola", "Cello", "Contrabass", "Tremolo Str", "PizzicatoStr", "Harp", "Timpani", "Strings", "Slow Strings", "Syn.Strings1", "Syn.Strings2", "Choir Aahs", "Voice Oohs", "SynVox", "OrchestraHit", "Trumpet", "Trombone", "Tuba", "MutedTrumpet", "French Horn", "Brass 1", "Synth Brass1", "Synth Brass2", "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet", "Piccolo", "Flute", "Recorder", "Pan Flute", "Bottle Blow", "Shakuhachi", "Whistle", "Ocarina", "Square Wave", "Saw Wave", "Syn.Calliope", "Chiffer Lead", "Charang", "Solo Vox", "5th Saw Wave", "Bass & Lead", "Fantasia", "Warm Pad", "Polysynth", "Space Voice", "Bowed Glass", "Metal Pad", "Halo Pad", "Sweep Pad", "Ice Rain", "Soundtrack", "Crystal", "Atmosphere", "Brightness", "Goblin", "Echo Drops", "Star Theme", "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bag Pipe", "Fiddle", "Shannai", "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko", "Melo. Tom 1", "Synth Drum", "Reverse Cym.", "Gt.FretNoise", "Breath Noise", "Seashore", "Bird", "Telephone 1", "Helicopter", "Applause", "Gun Shot"]],
  [1, [120, 121, 122, 123, 124, 125, 126, 127], ["Gt.Cut Noise", "Fl.Key Click", "Rain", "Dog", "Telephone 2", "Car-Engine", "Laughing", "Machine Gun"]],
  [2, [120, 122, 123, 124, 125, 126, 127], ["String Slap", "Thunder", "Horse-Gallop", "DoorCreaking", "Car-Stop", "Screaming", "Lasergun"]],
  [3, [122, 124, 125, 126, 127], ["Wind", "Door", "Car-Pass", "Punch", "Explosion"]],
  [4, [122, 124, 125, 126], ["Stream", "Scratch", "Car-Crash", "Heart Beat"]],
  [5, [122, 124, 125, 126], ["Bubble", "Windchime", "Siren", "Footsteps"]],
  [6, [125], ["Train"]],
  [7, [125], ["Jetplane"]],
  [8, [4, 5, 6, 14, 16, 17, 19, 21, 24, 25, 26, 27, 28, 30, 31, 38, 39, 48, 50, 61, 62, 63, 80, 107, 115, 116, 117, 118, 125], ["Detuned EP 1", "Detuned EP 2", "Coupled Hps.", "Church Bell", "Detuned Or.1", "Detuned Or.2", "Church Org.2", "Accordion It", "Ukulele", "12-str.Gt", "Hawaiian Gt.", "Chorus Gt.", "Funk Gt.", "Feedback Gt.", "Gt. Feedback", "Synth Bass 3", "Synth Bass 4", "Orchestra", "Syn.Strings3", "Brass 2", "Synth Brass3", "Synth Brass4", "Sine Wave", "Taisho Koto", "Castanets", "Concert BD", "Melo. Tom 2", "808 Tom", "Starship"]],
  [9, [125], ["Burst Noise"]],
  [16, [25], ["Mandolin"]],
  [126, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63], ["Piano 2", "Piano 2", "Piano 2", "Honky-tonk", "Piano 1", "Piano 2", "Piano 2", "E.Piano 1", "Detuned EP 1", "E.Piano 2", "Steel-str.Gt", "Steel-str.Gt", "12-str.Gt", "Funk Gt.", "Muted Gt.", "Slap Bass 1", "Slap Bass 1", "Slap Bass 1", "Slap Bass 1", "Slap Bass 2", "Slap Bass 2", "Slap Bass 2", "Slap Bass 2", "Fingered Bs.", "Fingered Bs.", "Picked Bs.", "Picked Bs.", "Fretless Bs.", "Acoustic Bs.", "Choir Aahs", "Choir Aahs", "Choir Aahs", "Choir Aahs", "Slow Strings", "Strings", "Syn.Strings3", "Syn.Strings3", "Organ 1", "Organ 1", "Organ 1", "Organ 2", "Organ 1", "Organ 1", "Organ 2", "Organ 2", "Organ 2", "Trumpet", "Trumpet", "Trombone", "Trombone", "Trombone", "Trombone", "Trombone", "Trombone", "Alto Sax", "Tenor Sax", "Baritone Sax", "Alto Sax", "Brass 1", "Brass 1", "Brass 2", "Brass 2", "Brass 1", "OrchestraHit"]],
  [127, -1, ["Acou Piano 1", "Acou Piano 2", "Acou Piano 3", "Elec Piano 1", "Elec Piano 2", "Elec Piano 3", "Elec Piano 4", "Honkytonk", "Elec Org 1", "Elec Org 2", "Elec Org 3", "Elec Org 4", "Pipe Org 1", "Pipe Org 2", "Pipe Org 3", "Accordion", "Harpsi 1", "Harpsi 2", "Harpsi 3", "Clavi 1", "Clavi 2", "Clavi 3", "Celesta 1", "Celesta 2", "Syn Brass 1", "Syn Brass 2", "Syn Brass 3", "Syn Brass 4", "Syn Bass 1", "Syn Bass 2", "Syn Bass 3", "Syn Bass 4", "Fantasy", "Harmo Pan", "Chorale", "Glasses", "Soundtrack", "Atmosphere", "Warm Bell", "Funny Vox", "Echo Bell", "Ice Rain", "Oboe 2001", "Echo Pan", "Doctor Solo", "School Daze", "Bellsinger", "Square Wave", "Str Sect 1", "Str Sect 2", "Str Sect 3", "Pizzicato", "Violin 1", "Violin 2", "Cello 1", "Cello 2", "Contrabass", "Harp 1", "Harp 2", "Guitar 1", "Guitar 2", "Elec Gtr 1", "Elec Gtr 2", "Sitar", "Acou Bass 1", "Acou Bass 2", "Elec Bass 1", "Elec Bass 2", "Slap Bass 1", "Slap Bass 2", "Fretless 1", "Fretless 2", "Flute 1", "Flute 2", "Piccolo 1", "Piccolo 2", "Recorder", "Pan Pipes", "Sax 1", "Sax 2", "Sax 3", "Sax 4", "Clarinet 1", "Clarinet 2", "Oboe", "Engl Horn", "Bassoon", "Harmonica", "Trumpet 1", "Trumpet 2", "Trombone 1", "Trombone 2", "Fr Horn 1", "Fr Horn 2", "Tuba", "Brs Sect 1", "Brs Sect 2", "Vibe 1", "Vibe 2", "Syn Mallet", "Windbell", "Glock", "Tube Bell", "Xylophone", "Marimba", "Koto", "Sho", "Shakuhachi", "Whistle 1", "Whistle 2", "Bottleblow", "Breathpipe", "Timpani", "Melodic Tom", "Deep Snare", "Elec Perc 1", "Elec Perc 2", "Taiko", "Taiko Rim", "Cymbal", "Castanets", "Triangle", "Orche Hit", "Telephone", "Bird Tweet", "One Note Jam", "Water Bell", "Jungle Tune"]]
];
var SC55MK2 = [
  [0, -1, ["Piano 1", "Piano 2", "Piano 3", "Honky-tonk", "E.Piano 1", "E.Piano 2", "Harpsichord", "Clav.", "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular-bell", "Santur", "Organ 1", "Organ 2", "Organ 3", "Church Org.1", "Reed Organ", "Accordion Fr", "Harmonica", "Bandoneon", "Nylon-str.Gt", "Steel-str.Gt", "Jazz Gt.", "Clean Gt.", "Muted Gt.", "Overdrive Gt", "DistortionGt", "Gt.Harmonics", "Acoustic Bs.", "Fingered Bs.", "Picked Bs.", "Fretless Bs.", "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2", "Violin", "Viola", "Cello", "Contrabass", "Tremolo Str", "PizzicatoStr", "Harp", "Timpani", "Strings", "Slow Strings", "Syn.Strings1", "Syn.Strings2", "Choir Aahs", "Voice Oohs", "SynVox", "OrchestraHit", "Trumpet", "Trombone", "Tuba", "MutedTrumpet", "French Horn", "Brass 1", "Synth Brass1", "Synth Brass2", "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet", "Piccolo", "Flute", "Recorder", "Pan Flute", "Bottle Blow", "Shakuhachi", "Whistle", "Ocarina", "Square Wave", "Saw Wave", "Syn.Calliope", "Chiffer Lead", "Charang", "Solo Vox", "5th Saw Wave", "Bass & Lead", "Fantasia", "Warm Pad", "Polysynth", "Space Voice", "Bowed Glass", "Metal Pad", "Halo Pad", "Sweep Pad", "Ice Rain", "Soundtrack", "Crystal", "Atmosphere", "Brightness", "Goblin", "Echo Drops", "Star Theme", "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bag Pipe", "Fiddle", "Shanai", "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko", "Melo. Tom 1", "Synth Drum", "Reverse Cym.", "Gt.FretNoise", "Breath Noise", "Seashore", "Bird", "Telephone 1", "Helicopter", "Applause", "Gun Shot"]],
  [1, [38, 57, 60, 80, 81, 98, 102, 104, 120, 121, 122, 123, 124, 125, 126, 127], ["SynthBass101", "Trombone 2", "Fr.Horn 2", "Square", "Saw", "Syn Mallet", "Echo Bell", "Sitar 2", "Gt.Cut Noise", "Fl.Key Click", "Rain", "Dog", "Telephone 2", "Car-Engine", "Laughing", "Machine Gun"]],
  [2, [102, 120, 122, 123, 124, 125, 126, 127], ["Echo Pan", "String Slap", "Thunder", "Horse-Gallop", "DoorCreaking", "Car-Stop", "Screaming", "Lasergun"]],
  [3, [122, 123, 124, 125, 126, 127], ["Wind", "Bird 2", "Door", "Car-Pass", "Punch", "Explosion"]],
  [4, [122, 124, 125, 126], ["Stream", "Scratch", "Car-Crash", "Heart Beat"]],
  [5, [122, 124, 125, 126], ["Bubble", "Windchime", "Siren", "Footsteps"]],
  [6, [125], ["Train"]],
  [7, [125], ["Jetplane"]],
  [8, [0, 1, 2, 3, 4, 5, 6, 11, 12, 14, 16, 17, 19, 21, 24, 25, 26, 27, 28, 30, 31, 38, 39, 40, 48, 50, 61, 62, 63, 80, 81, 107, 115, 116, 117, 118, 125], ["Piano 1w", "Piano 2w", "Piano 3w", "Honky-tonk w", "Detuned EP 1", "Detuned EP 2", "Coupled Hps.", "Vib.w", "Marimba w", "Church Bell", "Detuned Or.1", "Detuned Or.2", "Church Org.2", "Accordion It", "Ukulele", "12-str.Gt", "Hawaiian Gt.", "Chorus Gt.", "Funk Gt.", "Feedback Gt.", "Gt. Feedback", "Synth Bass 3", "Synth Bass 4", "Slow Violin", "Orchestra", "Syn.Strings3", "Brass 2", "Synth Brass3", "Synth Brass4", "Sine Wave", "Doctor Solo", "Taisho Koto", "Castanets", "Concert BD", "Melo. Tom 2", "808 Tom", "Starship"]],
  [9, [14, 118, 125], ["Carillon", "Elec Perc 1", "Burst Noise"]],
  [16, [0, 4, 5, 6, 16, 19, 24, 25, 28, 39, 62, 63], ["Piano 1d", "E.Piano 1v", "E.Piano 2v", "Harpsi.w", "60's Organ1", "Church Org.3", "Nylon Gt.o", "Mandolin", "Funk Gt.2", "Rubber Bass", "AnalogBrass1", "AnalogBrass2"]],
  [24, [4, 6], ["60's E.Piano", "Harpsi.o"]],
  [32, [16, 17, 24, 52], ["Organ 4", "Organ 5", "Nylon Gt.2", "Choir Aahs 2"]],
  [126, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63], ["Piano 2", "Piano 2", "Piano 2", "Honky-tonk", "Piano 1", "Piano 2", "Piano 2", "E.Piano 1", "Detuned EP 1", "E.Piano 2", "Steel-str.Gt", "Steel-str.Gt", "12-str.Gt", "Funk Gt.", "Muted Gt.", "Slap Bass 1", "Slap Bass 1", "Slap Bass 1", "Slap Bass 1", "Slap Bass 2", "Slap Bass 2", "Slap Bass 2", "Slap Bass 2", "Fingered Bs.", "Fingered Bs.", "Picked Bs.", "Picked Bs.", "Fretless Bs.", "Acoustic Bs.", "Choir Aahs", "Choir Aahs", "Choir Aahs", "Choir Aahs", "Slow Strings", "Strings", "Syn.Strings3", "Syn.Strings3", "Organ 1", "Organ 1", "Organ 1", "Organ 2", "Organ 1", "Organ 1", "Organ 2", "Organ 2", "Organ 2", "Trumpet", "Trumpet", "Trombone", "Trombone", "Trombone", "Trombone", "Trombone", "Trombone", "Alto Sax", "Tenor Sax", "Baritone Sax", "Alto Sax", "Brass 1", "Brass 1", "Brass 2", "Brass 2", "Brass 1", "OrchestraHit"]],
  [127, -1, ["Acou Piano 1", "Acou Piano 2", "Acou Piano 3", "Elec Piano 1", "Elec Piano 2", "Elec Piano 3", "Elec Piano 4", "Honkytonk", "Elec Org 1", "Elec Org 2", "Elec Org 3", "Elec Org 4", "Pipe Org 1", "Pipe Org 2", "Pipe Org 3", "Accordion", "Harpsi 1", "Harpsi 2", "Harpsi 3", "Clavi 1", "Clavi 2", "Clavi 3", "Celesta 1", "Celesta 2", "Syn Brass 1", "Syn Brass 2", "Syn Brass 3", "Syn Brass 4", "Syn Bass 1", "Syn Bass 2", "Syn Bass 3", "Syn Bass 4", "Fantasy", "Harmo Pan", "Chorale", "Glasses", "Soundtrack", "Atmosphere", "Warm Bell", "Funny Vox", "Echo Bell", "Ice Rain", "Oboe 2001", "Echo Pan", "Doctor Solo", "School Daze", "Bellsinger", "Square Wave", "Str Sect 1", "Str Sect 2", "Str Sect 3", "Pizzicato", "Violin 1", "Violin 2", "Cello 1", "Cello 2", "Contrabass", "Harp 1", "Harp 2", "Guitar 1", "Guitar 2", "Elec Gtr 1", "Elec Gtr 2", "Sitar", "Acou Bass 1", "Acou Bass 2", "Elec Bass 1", "Elec Bass 2", "Slap Bass 1", "Slap Bass 2", "Fretless 1", "Fretless 2", "Flute 1", "Flute 2", "Piccolo 1", "Piccolo 2", "Recorder", "Pan Pipes", "Sax 1", "Sax 2", "Sax 3", "Sax 4", "Clarinet 1", "Clarinet 2", "Oboe", "Engl Horn", "Bassoon", "Harmonica", "Trumpet 1", "Trumpet 2", "Trombone 1", "Trombone 2", "Fr Horn 1", "Fr Horn 2", "Tuba", "Brs Sect 1", "Brs Sect 2", "Vibe 1", "Vibe 2", "Syn Mallet", "Windbell", "Glock", "Tube Bell", "Xylophone", "Marimba", "Koto", "Sho", "Shakuhachi", "Whistle 1", "Whistle 2", "Bottleblow", "Breathpipe", "Timpani", "Melodic Tom", "Deep Snare", "Elec Perc 1", "Elec Perc 2", "Taiko", "Taiko Rim", "Cymbal", "Castanets", "Triangle", "Orche Hit", "Telephone", "Bird Tweet", "One Note Jam", "Water Bell", "Jungle Tune"]]
];
var DRUM_SETS = [[0, "STANDARD"], [8, "ROOM"], [16, "POWER"], [24, "ELECTRONIC"], [25, "TR-808"], [32, "JAZZ"], [40, "BRUSH"], [48, "ORCHESTRA"], [56, "SFX"], [127, "CM-64/32L"]];
function expand(table) {
  const out = [];
  for (const [bank, programs, names] of table) names.forEach((name, i) => out.push({ bank, program: programs === -1 ? i : programs[i], name }));
  for (const [program, name] of DRUM_SETS) out.push({ bank: 128, program, name });
  return out.sort((x, y) => x.bank - y.bank || x.program - y.program);
}
function soundCanvasPresets(model) {
  return expand(model === "roland-sc55" ? SC55 : SC55MK2);
}

// src/profiles.ts
var PROFILE_DESCRIPTORS = Object.freeze({
  soundfont: Object.freeze({ id: 0, label: "General MIDI SoundFont", technology: "TinySoundFont / SF2", availability: "bundled", userAssets: "none", maxVoices: 256 }),
  "sb16-opl3": Object.freeze({ id: 1, label: "Sound Blaster 16 (Yamaha OPL3)", technology: "Single YMF262 / libADLMIDI", availability: "bundled", userAssets: "none", maxVoices: 18 }),
  "sb16-cqm": Object.freeze({ id: 2, label: "Sound Blaster 16 (Creative CQM)", technology: "Nuked CQM / libADLMIDI", availability: "bundled", userAssets: "optional", maxVoices: 18 }),
  awe32: Object.freeze({ id: 3, label: "Sound Blaster AWE32", technology: "EMU8000 / AWE32Emu", availability: "local-build-required", userAssets: "required", maxVoices: 32 }),
  awe64: Object.freeze({ id: 4, label: "Sound Blaster AWE64 (hardware voices)", technology: "EMU8000 / AWE32Emu", availability: "local-build-required", userAssets: "required", maxVoices: 32 }),
  "sb-pci128": Object.freeze({ id: 5, label: "Sound Blaster PCI 128", technology: "AudioPCI ECW reconstruction (experimental)", availability: "bundled", userAssets: "required", maxVoices: 64 }),
  "gus-gf1": Object.freeze({ id: 6, label: "Gravis UltraSound (GF1)", technology: "GUSEMU32 GF1 / PAT driver (experimental)", availability: "bundled", userAssets: "required", maxVoices: 32 }),
  "roland-sc55": Object.freeze({ id: 7, label: "Roland SC-55", technology: "SoundCarcass / original firmware", availability: "bundled", userAssets: "required", maxVoices: 24 }),
  "roland-sc55mk2": Object.freeze({ id: 8, label: "Roland SC-55mkII", technology: "SoundCarcass / original firmware", availability: "bundled", userAssets: "required", maxVoices: 28 }),
  "roland-mt32": Object.freeze({ id: 9, label: "Roland MT-32", technology: "Munt / LA synthesis", availability: "bundled", userAssets: "required", maxVoices: 32 })
});
function isSynthProfile(value) {
  return typeof value === "string" && Object.hasOwn(PROFILE_DESCRIPTORS, value);
}

// src/profile-voices.ts
var INIT_ERRORS = [
  "",
  "the pack is malformed or of another model",
  "a ROM role is missing or not expected",
  "a ROM has the wrong size",
  "a ROM fails its CRC32 (another revision, or a bad dump)",
  "the core ran out of memory",
  "the firmware did not boot"
];
var MAX_PROFILE_ASSET_BYTES = 128 * 1024 * 1024;
var PROFILE_ABI = 2;
var PROFILE_SYSEX_MAX = 65536;
function dspk(model, records) {
  const size = 16 + records.reduce((n, [, data]) => n + 8 + data.length, 0), out = new Uint8Array(size), v = new DataView(out.buffer);
  out.set([68, 83, 80, 75]);
  v.setUint32(4, 1, true);
  v.setUint32(8, model, true);
  v.setUint32(12, records.length, true);
  let at = 16;
  for (const [role, data] of records) {
    v.setUint32(at, role, true);
    v.setUint32(at + 4, data.length, true);
    out.set(data, at + 8);
    at += 8 + data.length;
  }
  return out;
}
function cqmBankPack(bank) {
  const number = new Uint8Array(4);
  new DataView(number.buffer).setUint32(0, bank, true);
  return dspk(PROFILE_DESCRIPTORS["sb16-cqm"].id, [[33, number]]);
}
function cqmBank(pack) {
  const v = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  for (let at = 16; at + 8 <= pack.length; at += 8 + v.getUint32(at + 4, true)) {
    if (v.getUint32(at, true) === 33 && v.getUint32(at + 4, true) === 4 && at + 12 <= pack.length) return v.getUint32(at + 8, true);
  }
  return -1;
}
var REQUIRED = ["profile_abi", "profile_model", "profile_buffer", "profile_init", "profile_rate", "profile_message", "profile_sysex_buffer", "profile_sysex", "profile_render", "profile_voices", "profile_close"];
var NativeProfileVoices = class {
  /** fmBank: the embedded bank an sb16-cqm without a pack of its own plays, as the FM engine's option selects it. */
  constructor(kind, instance, asset, outputRate, fmBank = 0) {
    this.kind = kind;
    const desc = PROFILE_DESCRIPTORS[kind];
    this.name = desc.label;
    const w = instance.exports;
    if (!(w.memory instanceof WebAssembly.Memory) || REQUIRED.some((k) => typeof w[k] !== "function")) throw new Error("Invalid native synth ABI exports");
    this.w = w;
    w._initialize?.();
    if (w.profile_abi() !== PROFILE_ABI || w.profile_model() !== desc.id) throw new Error(`WASM ABI/model mismatch for ${kind}`);
    if (asset.byteLength > MAX_PROFILE_ASSET_BYTES) throw new RangeError("Profile asset too large");
    if (kind === "sb16-cqm") {
      if (!asset.byteLength) asset = cqmBankPack(fmBank);
      this.bank = cqmBank(asset);
    }
    this.asset = kind === "sb16-cqm" ? asset : new Uint8Array(0);
    try {
      this.init(asset);
      this.clock = new NativeClock(w.profile_rate(), outputRate);
      this.voiceLimit = kind === "gus-gf1" ? Math.round(617400 / w.profile_rate()) : desc.maxVoices;
    } catch (e) {
      w.profile_close();
      throw e;
    }
    if (kind === "roland-sc55" || kind === "roland-sc55mk2") this.list = soundCanvasPresets(kind);
    else {
      this.list = Array.from({ length: 128 }, (_, program) => ({ bank: 0, program, name: kind === "roland-mt32" ? `MT-32 patch ${program + 1}` : GM_PROGRAMS[program] }));
      if (kind !== "roland-mt32") this.list.push({ bank: 128, program: 0, name: "Percussion" });
    }
  }
  name;
  w;
  clock;
  closed = false;
  list;
  voiceLimit;
  view;
  heap;
  /** Messages and SysEx the core could not take (profile_message or profile_sysex 0): the host sends only valid ones,
   *  so they are input a core's queue had no room for, such as the Sound Canvas cores' 16 KiB MIDI IN at 3,125 bytes
   *  per second. They are dropped as a MIDI receiver drops what overflows it, instead of stopping the synthesizer. */
  dropped = 0;
  /** sb16-cqm: the embedded bank it plays (banks.ini's number), -1 for a WOPL bank; -1 on the other profiles. */
  bank = -1;
  /** The pack the core runs on, kept to restore it when a bank change fails. */
  asset;
  /** Copies asset into the core and initializes it; an Error names why it failed. */
  init(asset) {
    const w = this.w;
    if (asset.byteLength) {
      const at = w.profile_buffer(asset.byteLength) >>> 0;
      if (!at || at + asset.byteLength > w.memory.buffer.byteLength) throw new Error("Profile allocation failed");
      new Uint8Array(w.memory.buffer, at, asset.byteLength).set(asset);
    }
    if (w.profile_init(asset.byteLength) !== 1) {
      const reason = INIT_ERRORS[w.profile_init_error?.() ?? 0];
      throw new Error(`Invalid/missing assets or initialization failed for ${this.kind}${reason ? `: ${reason}` : ""}`);
    }
  }
  /** sb16-cqm: starts the core again on pack, at its power-on state; a pack it rejects restores the one before. */
  reload(pack) {
    if (this.closed) throw new Error("Profile is closed");
    if (this.kind !== "sb16-cqm") throw new Error(`The ${this.kind} profile has no FM bank`);
    this.w.profile_close();
    try {
      this.init(pack);
    } catch (error) {
      this.w.profile_close();
      this.init(this.asset);
      throw error;
    }
    this.asset = pack;
    this.bank = cqmBank(pack);
  }
  /** sb16-cqm: plays libADLMIDI's embedded bank (banks.ini's number), as FmVoices.setBank does. */
  setBank(bank) {
    this.reload(cqmBankPack(bank));
  }
  /** sb16-cqm: plays the instruments of a WOPL bank file (role 32); a file the core rejects keeps the bank. */
  loadBank(data) {
    this.reload(dspk(PROFILE_DESCRIPTORS["sb16-cqm"].id, [[32, data]]));
  }
  presets() {
    return this.list.map((p) => ({ ...p }));
  }
  maxVoices() {
    return this.voiceLimit;
  }
  voices() {
    return this.closed ? 0 : this.w.profile_voices();
  }
  // -1: not exposed by the chip API
  message(status, data1, data2) {
    if (this.closed) throw new Error("Profile is closed");
    if (this.w.profile_message(status, data1, data2) !== 1) this.dropped++;
  }
  /** One SysEx message, F0 through F7, of length bytes at offset in bytes; the core applies it or deliberately ignores
   *  it (profile_sysex 1), and resets on the GM, GM2, GS and XG resets itself; 0 (malformed, or no room) counts in
   *  dropped. Allocates nothing once the memory stopped growing. */
  sysex(bytes, offset = 0, length = bytes.length - offset) {
    if (this.closed) throw new Error("Profile is closed");
    if (!Number.isSafeInteger(length) || length < 2 || length > PROFILE_SYSEX_MAX || offset < 0 || offset + length > bytes.length) throw new RangeError("SysEx message length out of range");
    const at = this.w.profile_sysex_buffer() >>> 0;
    if (!this.heap || this.heap.buffer !== this.w.memory.buffer) this.heap = new Uint8Array(this.w.memory.buffer);
    const heap = this.heap;
    if (!at || at + length > heap.length) throw new Error("Native synth returned an invalid SysEx buffer");
    for (let i = 0; i < length; i++) heap[at + i] = bytes[offset + i];
    if (this.w.profile_sysex(length) !== 1) this.dropped++;
  }
  /** A preset of presets(): bank 128 (drums) on channel 10 by program change; any other bank as bank select (CC0 the
   *  bank, CC32 0; a Sound Canvas variation bank too) and program change. The MT-32 ignores bank select and gets the
   *  program change alone, on the channel given: its parts listen on channels 2 to 9 and its rhythm on 10. */
  setPreset(channel, bank, program) {
    if (!this.list.some((p) => p.bank === bank && p.program === program) || bank === 128 && channel !== 9) return false;
    if (this.kind !== "roland-mt32" && bank !== 128) {
      this.message(176 | channel, 0, bank);
      this.message(176 | channel, 32, 0);
    }
    this.message(192 | channel, program, 0);
    return true;
  }
  pull = (l, r, n) => {
    const ptr = this.w.profile_render(n) >>> 0, mem = this.w.memory.buffer;
    if (!ptr || ptr % 4 || ptr + n * 8 > mem.byteLength) throw new Error("Native synth returned invalid PCM pointer");
    if (!this.view || this.view.buffer !== mem || this.view.byteOffset !== ptr || this.view.length < n * 2) this.view = new Float32Array(mem, ptr, Math.min(256, (mem.byteLength - ptr) / 4));
    const v = this.view;
    for (let i = 0; i < n; i++) {
      l[i] = v[i];
      r[i] = v[n + i];
    }
  };
  render(left, right, at, n) {
    if (this.closed) throw new Error("Profile is closed");
    this.clock.render(left, right, at, n, this.pull);
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      this.w.profile_close();
    }
  }
};
function instantiateProfile(module) {
  let memory;
  const data = () => {
    if (!memory) throw new Error("Native profile must be a reactor without a start function");
    return new DataView(memory.buffer);
  };
  const wasi = {
    proc_exit: (code) => {
      throw new Error(`Native profile exited (${code})`);
    },
    environ_sizes_get: (count, size) => {
      const d = data();
      d.setUint32(count, 0, true);
      d.setUint32(size, 0, true);
      return 0;
    },
    environ_get: () => 0,
    fd_close: () => 8,
    // EBADF: no host file descriptors
    fd_seek: () => 70,
    // ESPIPE
    fd_write: (fd, iovs, count, written) => {
      if (fd !== 1 && fd !== 2) return 8;
      const d = data();
      let total = 0;
      if (count < 0 || count > 4096 || iovs < 0 || iovs + 8 * count > d.byteLength || written < 0 || written + 4 > d.byteLength) return 21;
      for (let i = 0; i < count; i++) {
        const p = d.getUint32(iovs + 8 * i, true), n = d.getUint32(iovs + 8 * i + 4, true);
        if (p + n > d.byteLength || total + n > 4294967295) return 21;
        total += n;
      }
      d.setUint32(written, total, true);
      return 0;
    }
  };
  const imports = { env: { emscripten_notify_memory_growth: () => void 0 }, wasi_snapshot_preview1: wasi };
  for (const entry of WebAssembly.Module.imports(module)) {
    const ns = imports[entry.module];
    if (entry.kind !== "function" || !ns || !Object.hasOwn(ns, entry.name)) throw new Error(`Unsupported profile import ${entry.module}.${entry.name}`);
  }
  const instance = new WebAssembly.Instance(module, imports);
  if (!(instance.exports.memory instanceof WebAssembly.Memory)) throw new Error("Profile exports no memory");
  memory = instance.exports.memory;
  return instance;
}

// src/fm-banks.ts
var FM_BANK_NAMES = Object.freeze([
  "AIL (The Fat Man 2op set, default AIL)",
  "Bisqwit (selection of 4op and 2op)",
  "HMI (Descent, Asterix)",
  "HMI (Descent:: Int) :NON-GM:",
  "HMI (Descent:: Ham) :NON-GM:",
  "HMI (Descent:: Rick) :NON-GM:",
  "HMI (Descent 2) :NON-GM:",
  "HMI (Normality)",
  "HMI (Shattered Steel)",
  "HMI (Theme Park)",
  "HMI (MegaPatch by LoudMouth)",
  "HMI (MegaPatch - Aces of the Deep)",
  "HMI (MegaPatch - Earthsiege)",
  "HMI (Anvil of Dawn)",
  "DMX (Bobby Prince v2)",
  "DMX (Cygnus Studios, default DMX)",
  "DMX (Bobby Prince v1)",
  "AIL (Discworld, Grandest Fleet, etc.)",
  "AIL (Warcraft 2)",
  "AIL (Syndicate) :MT-32:",
  "AIL (Guilty, Orion Conspiracy, TNSFC ::4op)",
  "AIL (Magic Carpet 2) :MT-32:",
  "AIL (Eric Heberling - Nemesis)",
  "AIL (Jagged Alliance) :MT-32:",
  "AIL (When Two Worlds War) :MT-32: :MISS-INS:",
  "AIL (Bards Tale Construction) :MT-32: :MISS-INS:",
  "AIL (Return to Zork) :MT-32:",
  "AIL (Theme Hospital)",
  "AIL (MegaPatch - National Hockey League PA)",
  "AIL (Inherit The Earth) :MT-32:",
  "AIL (Inherit The Earth, file two) :MT-32:",
  "AIL (Little Big Adventure) :4op:",
  "AIL (Heroes of Might and Magic II) :MT-32:",
  "AIL (Eric Heberling - Death Gate)",
  "AIL (FIFA International Soccer)",
  "AIL (Starship Invasion)",
  "AIL (Super Street Fighter 2 :4op:)",
  "AIL (Lords of the Realm) :MISS-INS:",
  "AIL (SimFarm, SimHealth) :4op:",
  "AIL (SimFarm, Settlers, Serf City)",
  "AIL (Caesar 2) :p4op: :MISS-INS:",
  "AIL (Syndicate Wars) :MT-32:",
  "AIL (MegaPatch mod by Probe Ent.)",
  "AIL (Warcraft) :NON-GM:",
  "AIL (Terra Nova Strike Force Centuri) :p4op:",
  "AIL (System Shock) :p4op:",
  "AIL (Eric Heberling - Advanced Civilization)",
  "AIL (Battle Chess 4000) :MT-32:",
  "AIL (Ultimate Soccer Manager :p4op:)",
  "AIL (Air Bucks, Blue And The Gray, etc) :MT-32:",
  "AIL (Ultima Underworld 2) :MT-32:",
  "AIL (FatMan MT32) :MT-32:",
  "AIL (High Seas Trader) :MISS-INS:",
  "AIL (Master of Magic) :4op:",
  "AIL (Master of Magic) :4op: orchestral drums",
  "SB (Action Soccer)",
  "SB (3d Cyberpuck :: melodic only)",
  "SB (Simon the Sorcerer) :MT-32:",
  "WOPL (The Fat Man 2op set; Win9x)",
  "WOPL (The Fat Man 4op set)",
  "OP3 (JungleVision 2op set :: melodic only)",
  "OP3 (Wallace 2op set, Nitemare 3D :: melodic only)",
  "TMB (Duke Nukem 3D)",
  "TMB (Shadow Warrior)",
  "DMX (Scott Host)",
  "SB (Modded GMOPL by Wohlstand)",
  "SB (Jamie O'Connell's bank)",
  "TMB (Apogee Sound System Default bank) :broken drums:",
  "WOPL (4op bank by James Alan Nguyen and Wohlstand)",
  "TMB (MegaPatch - Blood)",
  "TMB (Rise of the Triad)",
  "TMB (Nam)",
  "WOPL (DMXOPL3 bank by Sneakernets)",
  "EA (Cartooners)",
  "WOPL (Apogee IMF 90-ish)",
  "AIL (The Lost Vikings) :NON-GM:",
  "DMX (Strife)",
  "WOPL (MS-AdLib, Windows 3.x)",
  "AIL (Monopoly Deluxe)"
]);

// src/types.ts
var OP = {
  noteOn: 0,
  noteOff: 1,
  controlChange: 2,
  programChange: 3,
  pitchBend: 4,
  channelPressure: 5,
  polyPressure: 6,
  preset: 7,
  reset: 8,
  sysex: 9
};
var OP_COUNT = 10;
var SYSEX_MAX = 65536;
var OPERAND_MAX = 16383;
var MAX_SONG_BYTES = 16 * 1024 * 1024;
var MAX_SOUNDFONT_BYTES = 256 * 1024 * 1024;
var MAX_BANK_BYTES = 8 * 1024 * 1024;
var FM_BANKS = 79;
var MAX_CHIPS = 8;
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer in [${min}, ${max}]`);
  }
  return value;
}
function finite(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`Invalid ${label}`);
  return value;
}
function normalizeOptions(options = {}) {
  return {
    sampleRate: integer(options.sampleRate ?? 48e3, 8e3, 192e3, "sampleRate"),
    maxVoices: integer(options.maxVoices ?? 256, 1, 4096, "maxVoices"),
    engine: engineKind(options.engine ?? "soundfont"),
    chips: integer(options.chips ?? 2, 1, MAX_CHIPS, "chips"),
    fmBank: integer(options.fmBank ?? 0, 0, FM_BANKS - 1, "fmBank")
  };
}
function engineKind(kind) {
  if (kind !== "fm" && !isSynthProfile(kind)) throw new RangeError("Unknown synthesizer engine");
  return kind;
}
function isSysEx(bytes, offset = 0, length = bytes.length - offset) {
  if (!Number.isSafeInteger(length) || length < 2 || length > SYSEX_MAX || bytes[offset] !== 240 || bytes[offset + length - 1] !== 247) return false;
  for (let i = offset + 1; i < offset + length - 1; i++) {
    const b = bytes[i];
    if (!Number.isInteger(b) || b < 0 || b > 127) return false;
  }
  return true;
}
function inputBytes(data, max, label) {
  if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) throw new TypeError(`${label} must be a Uint8Array or ArrayBuffer`);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  integer(bytes.byteLength, 1, max, label);
  return bytes;
}

// src/parser.ts
var MIDI_RESET = 255;
function packMessage(status, data1 = 0, data2 = 0) {
  return (status | data1 << 8 | data2 << 16) >>> 0;
}
function dataBytes(status) {
  const kind = status & 240;
  return kind === 192 || kind === 208 ? 1 : 2;
}
var RESETS = [
  [126, -1, 9, 1],
  [126, -1, 9, 3],
  [65, -1, 66, 18, 64, 0, 127, 0, 65],
  [67, -1, 76, 0, 0, 126, 0]
];
function matchesReset(bytes, offset, length) {
  next: for (const known of RESETS) {
    if (known.length !== length) continue;
    for (let i = 0; i < length; i++) if (known[i] >= 0 && known[i] !== bytes[offset + i]) continue next;
    return true;
  }
  return false;
}
function isReset(bytes) {
  return matchesReset(bytes, 0, bytes.length);
}
function isResetMessage(bytes, offset, length) {
  return length >= 2 && bytes[offset] === 240 && bytes[offset + length - 1] === 247 && matchesReset(bytes, offset + 1, length - 2);
}
function masterVolume(bytes, offset, length) {
  if (length !== 8 || bytes[offset] !== 240 || bytes[offset + 1] !== 127 || bytes[offset + 3] !== 4 || bytes[offset + 4] !== 1 || bytes[offset + 7] !== 247) return -1;
  return bytes[offset + 5] | bytes[offset + 6] << 7;
}
var MidiParser = class {
  constructor(message, sysex = () => void 0) {
    this.message = message;
    this.sysex = sysex;
  }
  status = 0;
  data = [0, 0];
  have = 0;
  skip = 0;
  sysexBytes = null;
  /** The system exclusive message in progress has outgrown SYSEX_MAX and is dropped at its end. */
  overflow = false;
  /** Takes byte, which arrived at time. */
  feed(byte, time) {
    if (byte >= 248) {
      this.message(time, byte, 0, 0);
      return;
    }
    if (byte & 128) {
      if (this.sysexBytes) {
        const bytes = this.sysexBytes, whole = !this.overflow;
        this.sysexBytes = null;
        this.overflow = false;
        if (byte === 247) {
          if (whole) this.sysex(time, Uint8Array.from(bytes));
          return;
        }
      }
      this.have = 0;
      this.skip = 0;
      if (byte < 240) {
        this.status = byte;
        return;
      }
      this.status = 0;
      if (byte === 240) {
        this.sysexBytes = [];
        this.overflow = false;
      } else if (byte === 241 || byte === 243) this.skip = 1;
      else if (byte === 242) this.skip = 2;
      return;
    }
    if (this.sysexBytes) {
      if (this.sysexBytes.length < SYSEX_MAX - 2) this.sysexBytes.push(byte);
      else this.overflow = true;
      return;
    }
    if (this.skip) {
      this.skip--;
      return;
    }
    if (!this.status) return;
    this.data[this.have++] = byte;
    const needed = dataBytes(this.status);
    if (this.have === needed) {
      this.have = 0;
      this.message(time, this.status, this.data[0], needed === 2 ? this.data[1] : 0);
    }
  }
  /** Ends a message in progress as another status byte would, without one: a system exclusive message is dropped and
   *  the running status ends. A Standard MIDI File track uses it when a channel event interrupts a divided SysEx. */
  cancel() {
    this.sysexBytes = null;
    this.overflow = false;
    this.status = 0;
    this.have = 0;
    this.skip = 0;
  }
};

// src/midifile.ts
var SYSEX_STATUS = 240;
var MAX_FILE_SYSEX = 65536;
var Reader = class {
  constructor(bytes, at, end, label) {
    this.bytes = bytes;
    this.at = at;
    this.end = end;
    this.label = label;
  }
  need(n) {
    if (this.at + n > this.end) throw new Error(`Truncated ${this.label}`);
  }
  u8() {
    this.need(1);
    return this.bytes[this.at++];
  }
  u16be() {
    this.need(2);
    const v = this.bytes[this.at] << 8 | this.bytes[this.at + 1];
    this.at += 2;
    return v;
  }
  u16le() {
    this.need(2);
    const v = this.bytes[this.at] | this.bytes[this.at + 1] << 8;
    this.at += 2;
    return v;
  }
  u32be() {
    this.need(4);
    const v = (this.bytes[this.at] << 24 | this.bytes[this.at + 1] << 16 | this.bytes[this.at + 2] << 8 | this.bytes[this.at + 3]) >>> 0;
    this.at += 4;
    return v;
  }
  /** A variable-length quantity of at most four bytes (Standard MIDI Files 1.0). */
  vlq() {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.u8();
      value = value * 128 + (byte & 127);
      if (!(byte & 128)) return value;
    }
    throw new Error(`Malformed ${this.label}: variable-length quantity over four bytes`);
  }
  text(n) {
    this.need(n);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.bytes[this.at + i]);
    this.at += n;
    return s;
  }
};
var ascii = (bytes, at, text2) => text2.split("").every((c, i) => bytes[at + i] === c.charCodeAt(0));
function parseSong(bytes) {
  if (ascii(bytes, 0, "MThd")) return parseSmf(bytes);
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "RMID")) return parseSmf(rmiData(bytes));
  if (ascii(bytes, 0, "MUS")) return parseMus(bytes);
  throw new Error("Unsupported file format: expected a MIDI (MThd), RMI (RIFF RMID) or MUS header");
}
function rmiData(bytes) {
  const r = new Reader(bytes, 12, bytes.length, "RMI file");
  while (r.at + 8 <= r.end) {
    const id = r.text(4), size = r.u16le() + r.u16le() * 65536;
    r.need(size);
    if (id === "data") return bytes.subarray(r.at, r.at + size);
    r.at += size + (size & 1);
  }
  throw new Error("Malformed RMI file: no data chunk");
}
function parseSmf(bytes) {
  const r = new Reader(bytes, 0, bytes.length, "MIDI header");
  r.at = 4;
  const headerLength = r.u32be();
  if (headerLength < 6) throw new Error("Malformed MIDI header");
  const format = r.u16be(), tracks = r.u16be(), division = r.u16be();
  if (format > 1) throw new Error(`Unsupported MIDI format ${format}: formats 0 and 1 play`);
  if (!tracks) throw new Error("Malformed MIDI header: no tracks");
  let secondsPerTick;
  if (division & 32768) {
    const fps = 256 - (division >> 8), perFrame = division & 255;
    if (![24, 25, 29, 30].includes(fps) || !perFrame) throw new Error("Malformed MIDI header: SMPTE division");
    const rate = (fps === 29 ? 29.97 : fps) * perFrame;
    secondsPerTick = () => 1 / rate;
  } else {
    if (!division) throw new Error("Malformed MIDI header: zero ticks per quarter note");
    secondsPerTick = (tempo2) => tempo2 / 1e6 / division;
  }
  r.at = 8 + headerLength;
  const entries = [];
  let sysexCount = 0;
  let title = "", endTick = 0, track = 0, order = 0;
  while (track < tracks && r.at + 8 <= bytes.length) {
    const id = r.text(4), length = r.u32be();
    if (id !== "MTrk") {
      r.need(length);
      r.at += length;
      continue;
    }
    const t = new Reader(bytes, r.at, Math.min(bytes.length, r.at + length), "MIDI track");
    r.at = t.end;
    let tick = 0, status = 0;
    const sysex2 = (at, data) => {
      if (++sysexCount > MAX_FILE_SYSEX) throw new RangeError(`MIDI file holds more than ${MAX_FILE_SYSEX} system exclusive messages`);
      entries.push({ tick: at, track, order: order++, tempo: 0, message: isReset(data.subarray(1, data.length - 1)) ? MIDI_RESET : SYSEX_STATUS, data });
    };
    const escape = new MidiParser((at, s, d1, d2) => {
      if (s === 255) entries.push({ tick: at, track, order: order++, tempo: 0, message: MIDI_RESET });
      else if (s < 240) entries.push({ tick: at, track, order: order++, tempo: 0, message: packMessage(s, d1, d2) });
    }, (at, inner) => {
      const data = new Uint8Array(inner.length + 2);
      data[0] = 240;
      data.set(inner, 1);
      data[inner.length + 1] = 247;
      sysex2(at, data);
    });
    let open = null, openTick = 0, overflow = false;
    const close = () => {
      if (open && !overflow) {
        open.push(247);
        sysex2(openTick, Uint8Array.from(open));
      }
      open = null;
      overflow = false;
    };
    const packet = (from, end, escaped) => {
      let i = from;
      for (; open && i < end; i++) {
        const b = t.bytes[i];
        if (b >= 248) {
          if (b === 255) entries.push({ tick, track, order: order++, tempo: 0, message: MIDI_RESET });
          continue;
        }
        if (b === 247) {
          open.push(247);
          if (!overflow) sysex2(tick, Uint8Array.from(open));
          open = null;
          overflow = false;
          i++;
          break;
        }
        if (b & 128) {
          open = null;
          overflow = false;
          break;
        }
        if (open.length < SYSEX_MAX - 1) open.push(b);
        else overflow = true;
      }
      if (open) openTick = tick;
      else if (escaped || i < end) for (; i < end; i++) escape.feed(t.bytes[i], tick);
    };
    while (t.at < t.end) {
      tick += t.vlq();
      let byte = t.u8();
      if (byte === 255) {
        const type = t.u8(), size = t.vlq();
        t.need(size);
        if (type === 47) {
          t.at += size;
          break;
        }
        if (type === 81 && size === 3) {
          const tempo2 = t.u8() << 16 | t.u8() << 8 | t.u8();
          if (tempo2) entries.push({ tick, track, order: order++, tempo: tempo2, message: 0 });
        } else if (type === 3 && track === 0 && !title) title = t.text(size).split(String.fromCharCode(0))[0].trimEnd();
        else t.at += size;
        continue;
      }
      if (byte === 240 || byte === 247) {
        const size = t.vlq();
        t.need(size);
        if (byte === 240) {
          close();
          escape.cancel();
          open = [240];
        }
        packet(t.at, t.at + size, !open);
        t.at += size;
        continue;
      }
      if (byte & 128) {
        if (byte >= 240) throw new Error(`Malformed MIDI track: status ${byte.toString(16)}h`);
        status = byte;
        byte = t.u8();
      } else if (!status) throw new Error("Malformed MIDI track: data byte without a status");
      close();
      escape.cancel();
      const data2 = dataBytes(status) === 2 ? t.u8() & 127 : 0;
      entries.push({ tick, track, order: order++, tempo: 0, message: packMessage(status, byte & 127, data2) });
    }
    close();
    endTick = Math.max(endTick, tick);
    track++;
  }
  if (!track) throw new Error("Malformed MIDI file: no MTrk chunk");
  entries.sort((a, b) => a.tick - b.tick || a.track - b.track || a.order - b.order);
  const times = [], messages = [], sysex = /* @__PURE__ */ new Map();
  let tempo = 5e5, lastTick = 0, seconds = 0;
  for (const entry of entries) {
    seconds += (entry.tick - lastTick) * secondsPerTick(tempo);
    lastTick = entry.tick;
    if (entry.tempo) tempo = entry.tempo;
    else {
      if (entry.data) sysex.set(messages.length, entry.data);
      times.push(seconds);
      messages.push(entry.message);
    }
  }
  const duration = seconds + Math.max(0, endTick - lastTick) * secondsPerTick(tempo);
  return { title, duration, times: Float64Array.from(times), messages: Uint32Array.from(messages), sysex };
}
var MUS_CONTROLLERS = [0, 0, 1, 7, 10, 11, 91, 93, 64, 67];
var MUS_SYSTEM = { 10: 120, 11: 123, 12: 126, 13: 127, 14: 121 };
var MUS_RATE = 140;
function parseMus(bytes) {
  const h = new Reader(bytes, 4, bytes.length, "MUS header");
  const length = h.u16le(), start = h.u16le();
  const r = new Reader(bytes, start, Math.min(bytes.length, start + length), "MUS score");
  const velocity = Array.from({ length: 16 }, () => 127);
  const times = [], messages = [];
  let tick = 0;
  for (; ; ) {
    const event = r.u8(), kind = event >> 4 & 7, mus = event & 15;
    const channel = mus === 15 ? 9 : mus >= 9 ? mus + 1 : mus;
    const push = (status, d1 = 0, d2 = 0) => {
      times.push(tick / MUS_RATE);
      messages.push(packMessage(status | channel, d1, d2));
    };
    if (kind === 6) break;
    switch (kind) {
      case 0:
        push(128, r.u8() & 127);
        break;
      case 1: {
        const note = r.u8();
        if (note & 128) velocity[channel] = r.u8() & 127;
        push(144, note & 127, velocity[channel]);
        break;
      }
      case 2: {
        const bend = r.u8() * 64;
        push(224, bend & 127, bend >> 7);
        break;
      }
      case 3: {
        const mode = MUS_SYSTEM[r.u8()];
        if (mode !== void 0) push(176, mode, 0);
        break;
      }
      case 4: {
        const controller = r.u8(), value = Math.min(127, r.u8());
        if (controller === 0) push(192, value);
        else if (controller < MUS_CONTROLLERS.length) push(176, MUS_CONTROLLERS[controller], value);
        break;
      }
      case 5:
        break;
      default:
        throw new Error(`Malformed MUS score: event type ${kind}`);
    }
    if (event & 128) tick += r.vlq();
  }
  return { title: "", duration: tick / MUS_RATE, times: Float64Array.from(times), messages: Uint32Array.from(messages), sysex: /* @__PURE__ */ new Map() };
}

// src/voices.ts
var SYNTH_IMPORTS = { env: { emscripten_notify_memory_growth: () => void 0 } };
var RENDER_BLOCK = 128;
var SOUNDFONT_ENGINE = "TinySoundFont 0.9";
var FM_ENGINE = "libADLMIDI 1.6.2, Nuked OPL3";
var DRUMS = 9;
var PlanarOutput = class {
  constructor(memory, out) {
    this.memory = memory;
    this.out = out;
    this.view = new Float32Array(memory.buffer, out, RENDER_BLOCK * 2);
  }
  view;
  copy(left, right, at, n, gain) {
    if (this.view.buffer !== this.memory.buffer) this.view = new Float32Array(this.memory.buffer, this.out, RENDER_BLOCK * 2);
    const view = this.view;
    for (let i = 0; i < n; i++) {
      left[at + i] = view[i] * gain;
      right[at + i] = view[n + i] * gain;
    }
  }
};
function text(memory, at, max) {
  const heap = new Uint8Array(memory.buffer);
  let value = "";
  for (let p = at; heap[p] && value.length < max; p++) value += String.fromCharCode(heap[p]);
  return value;
}
var HeapWriter = class {
  constructor(memory) {
    this.memory = memory;
    this.heap = new Uint8Array(memory.buffer);
  }
  heap;
  write(at, bytes, offset, length) {
    if (this.heap.buffer !== this.memory.buffer) this.heap = new Uint8Array(this.memory.buffer);
    if (!at || at + length > this.heap.length) throw new Error("The synthesizer returned an invalid SysEx buffer");
    const heap = this.heap;
    for (let i = 0; i < length; i++) heap[at + i] = bytes[offset + i];
  }
};
var SoundFontVoices = class {
  constructor(instance, soundfont, options) {
    this.options = options;
    this.wasm = instance.exports;
    this.wasm._initialize?.();
    this.output = new PlanarOutput(this.wasm.memory, this.wasm.synth_render(0));
    this.load(soundfont);
  }
  kind = "soundfont";
  name = SOUNDFONT_ENGINE;
  wasm;
  output;
  list = [];
  /** The GM Master Volume as an amplitude factor; FFh and the resets return it to 1. */
  master = 1;
  /** Replaces the SoundFont; a rejected one leaves the loaded SoundFont in place (synth_load parses it first). */
  load(data) {
    const w = this.wasm, bytes = inputBytes(data, MAX_SOUNDFONT_BYTES, "SoundFont length");
    const at = w.synth_buffer(bytes.byteLength);
    if (!at) throw new Error("SoundFont buffer allocation failed");
    new Uint8Array(w.memory.buffer, at, bytes.byteLength).set(bytes);
    if (!w.synth_load(at, bytes.byteLength, this.options.sampleRate, SOUNDFONT_GAIN_DB, this.options.maxVoices)) throw new Error("Invalid SoundFont: not an SF2 file, or out of memory");
    const presets = [];
    for (let i = 0, count = w.synth_preset_count(); i < count; i++) {
      presets.push({ bank: w.synth_preset_bank(i), program: w.synth_preset_program(i), name: text(w.memory, w.synth_preset_name(i), 20).trim() });
    }
    this.list = presets.sort((a, b) => a.bank - b.bank || a.program - b.program);
  }
  presets() {
    return this.list.map((p) => ({ ...p }));
  }
  maxVoices() {
    return this.options.maxVoices;
  }
  message(status, data1, data2) {
    if (status === MIDI_RESET) this.master = 1;
    this.wasm.synth_message(status, data1, data2);
  }
  /** TinySoundFont has no SysEx: the resets act as FFh, and GM Master Volume (F0 7F <device> 04 01 <lsb> <msb> F7)
   *  scales the output at once, on the curve that TinySoundFont gives channel volume (tsf.h: the cube of the 14-bit
   *  level over 16383), so master volume v sounds as channel volume v would. Other messages are ignored. */
  sysex(bytes, offset, length) {
    if (isResetMessage(bytes, offset, length)) {
      this.message(MIDI_RESET, 0, 0);
      return;
    }
    const level = masterVolume(bytes, offset, length);
    if (level >= 0) this.master = (level / 16383) ** 3;
  }
  setPreset(channel, bank, program) {
    return this.wasm.synth_set_preset(channel, bank, program) === 1;
  }
  render(left, right, at, n) {
    if (!this.wasm.synth_voices()) {
      left.fill(0, at, at + n);
      right.fill(0, at, at + n);
      return;
    }
    this.wasm.synth_render(n);
    this.output.copy(left, right, at, n, this.master);
  }
  voices() {
    return this.wasm.synth_voices();
  }
  close() {
  }
};
var SOUNDFONT_GAIN_DB = -6;
var FM_GAIN = 2.5;
var FmVoices = class {
  kind;
  name;
  wasm;
  output;
  heap;
  sysexAt;
  names = [];
  current;
  constructor(instance, options, kind = "fm") {
    this.kind = kind;
    this.name = kind === "sb16-opl3" ? "Sound Blaster 16 (Yamaha OPL3)" : FM_ENGINE;
    this.wasm = instance.exports;
    this.wasm._initialize?.();
    if (!this.wasm.fm_init(options.sampleRate, kind === "sb16-opl3" ? 1 : options.chips, options.fmBank)) throw new Error("The FM synthesizer rejected its settings");
    this.output = new PlanarOutput(this.wasm.memory, this.wasm.fm_render(0));
    this.heap = new HeapWriter(this.wasm.memory);
    this.sysexAt = this.wasm.fm_sysex_buffer() >>> 0;
    for (let i = 0, count = this.wasm.fm_bank_count(); i < count; i++) this.names.push(text(this.wasm.memory, this.wasm.fm_bank_name(i), 120));
    this.current = options.fmBank;
  }
  info() {
    return { banks: [...this.names], bank: this.current, chips: this.wasm.fm_chips() };
  }
  /** Selects embedded bank (banks.ini's number); every voice ends. */
  setBank(bank) {
    integer(bank, 0, this.names.length - 1, "FM bank");
    if (!this.wasm.fm_set_bank(bank)) throw new Error(`The FM synthesizer rejected bank ${bank}`);
    this.current = bank;
  }
  /** Replaces the instruments with a WOPL bank file; a rejected file keeps the instruments. Every voice ends. */
  loadBank(data) {
    const w = this.wasm, bytes = inputBytes(data, MAX_BANK_BYTES, "bank length");
    const at = w.fm_buffer(bytes.byteLength);
    if (!at) throw new Error("Bank buffer allocation failed");
    new Uint8Array(w.memory.buffer, at, bytes.byteLength).set(bytes);
    if (!w.fm_load_bank(at, bytes.byteLength)) throw new Error("Invalid FM bank: not a WOPL file");
    this.current = -1;
  }
  /** The General MIDI programs on bank 0 and the percussion of channel 10 as bank 128. */
  presets() {
    return [...GM_PROGRAMS.map((name, program) => ({ bank: 0, program, name })), { bank: 128, program: 0, name: "Percussion" }];
  }
  maxVoices() {
    return this.wasm.fm_chips() * 18;
  }
  /** VERIFIED: FFh's libADLMIDI reset (adl_rt_resetState, adlmidi_midiplay.cpp) resets the controllers but keeps each channel's bank and program, so
   *  the General MIDI state's bank 0, program 1 follows it here. */
  message(status, data1, data2) {
    this.wasm.fm_message(status, data1, data2);
    if (status !== MIDI_RESET) return;
    for (let channel = 0; channel < 16; channel++) {
      this.wasm.fm_message(176 | channel, 0, 0);
      this.wasm.fm_message(176 | channel, 32, 0);
      this.wasm.fm_message(192 | channel, 0, 0);
    }
  }
  /** libADLMIDI's realTime_SysEx receives the message (fm.cpp fm_sysex): GM System On and Off, the GS reset and its
   *  rhythm part assignment, XG System On, GM Master Volume. A reset first resets as FFh does, since libADLMIDI's own
   *  keeps the voices sounding and each channel's bank and program. */
  sysex(bytes, offset, length) {
    if (isResetMessage(bytes, offset, length)) this.message(MIDI_RESET, 0, 0);
    this.heap.write(this.sysexAt, bytes, offset, length);
    if (!this.wasm.fm_sysex(length)) throw new Error("The FM synthesizer rejected a SysEx message");
  }
  /** Bank 128 is the percussion, which plays on channel 10 only; other banks go out as bank select and program. */
  setPreset(channel, bank, program) {
    if (bank === 128) {
      if (channel !== DRUMS) return false;
      this.wasm.fm_message(192 | channel, program, 0);
      return true;
    }
    if (bank !== 0) return false;
    this.wasm.fm_message(176 | channel, 0, 0);
    this.wasm.fm_message(176 | channel, 32, 0);
    this.wasm.fm_message(192 | channel, program, 0);
    return true;
  }
  render(left, right, at, n) {
    this.wasm.fm_render(n);
    this.output.copy(left, right, at, n, FM_GAIN);
  }
  voices() {
    return this.wasm.fm_voices();
  }
  close() {
    this.wasm.fm_message(MIDI_RESET & 255, 0, 0);
  }
};

// src/engine.ts
var CHANNELS = 16;
var Engine = class _Engine {
  options;
  maxFrames = RENDER_BLOCK;
  active;
  soundfont = null;
  loaded = /* @__PURE__ */ new Map();
  get fm() {
    if (this.active instanceof FmVoices) return this.active;
    const v = this.loaded.get("fm") ?? this.loaded.get("sb16-opl3");
    return v instanceof FmVoices ? v : null;
  }
  /** The loaded engines on libADLMIDI's banks: 'fm', 'sb16-opl3' and the 'sb16-cqm' profile, which setFmBank and
   *  loadFmBank keep on one bank. */
  fmFamily() {
    const out = [];
    for (const v of this.loaded.values()) if (v instanceof FmVoices || v instanceof NativeProfileVoices && v.kind === "sb16-cqm") out.push(v);
    return out;
  }
  /** The embedded bank the FM engines play (an engine loaded later starts on it), options.fmBank before one is loaded
   *  or while they play a WOPL file. */
  fmBank() {
    for (const v of this.fmFamily()) {
      const bank = v instanceof FmVoices ? v.info().bank : v.bank;
      if (bank >= 0) return bank;
    }
    return this.options.fmBank;
  }
  song = null;
  songFrames = new Float64Array(0);
  endFrame = 0;
  index = 0;
  /** The file's position in its own frames; it advances rate frames per output frame. */
  position = 0;
  rate = 1;
  state = "idle";
  loop = false;
  /** The velocity of each note the file holds now (channel * 128 + note), so a new engine strikes it again. */
  held = new Uint8Array(CHANNELS * 128);
  /** Starts with voices, made from options by SoundFontVoices or FmVoices. */
  constructor(voices, options = {}) {
    this.options = normalizeOptions({ ...options, engine: voices.kind });
    this.active = voices;
    try {
      this.active.message(MIDI_RESET, 0, 0);
      this.attach(voices);
    } catch (error) {
      voices.close();
      throw error;
    }
  }
  /** An engine with TinySoundFont on instance (midi-synth.wasm) and the SoundFont 2 file soundfont. */
  static withSoundFont(instance, soundfont, options = {}) {
    return new _Engine(new SoundFontVoices(instance, soundfont, normalizeOptions(options)), options);
  }
  /** An engine with libADLMIDI on instance (fm-synth.wasm), options.chips chips and embedded bank options.fmBank. */
  static withFm(instance, options = {}) {
    return new _Engine(new FmVoices(instance, normalizeOptions(options), options.engine === "sb16-opl3" ? "sb16-opl3" : "fm"), options);
  }
  attach(voices) {
    this.loaded.set(voices.kind, voices);
    if (voices instanceof SoundFontVoices) this.soundfont = voices;
  }
  ensure() {
    if (!this.active) throw new Error("Synth is disposed");
    return this.active;
  }
  info() {
    const v = this.ensure();
    const engines = [...this.loaded.keys()].sort((a, b) => (a === "soundfont" ? -2 : a === "fm" ? -1 : 0) - (b === "soundfont" ? -2 : b === "fm" ? -1 : 0));
    const fm = v instanceof NativeProfileVoices && v.kind === "sb16-cqm" ? { banks: [...FM_BANK_NAMES], bank: v.bank, chips: 1 } : this.fm?.info();
    return { engine: v.name, kind: v.kind, ...v.kind === "fm" ? {} : { profile: v.kind }, engines, sampleRate: this.options.sampleRate, maxVoices: v.maxVoices(), presets: v.presets(), ...fm ? { fm } : {} };
  }
  /** The engines loaded so far. */
  has(kind) {
    return this.loaded.has(kind);
  }
  /** Adds the other engine, made by SoundFontVoices or FmVoices with this engine's options. With replace, voices take
   *  the place of the loaded engine of their kind (a native profile on new sources): when that one plays, a file plays
   *  on through voices with its state replayed, as after use(). Replacing in place, rather than unloading the engine
   *  and loading it anew, keeps the file's clock, the held notes and the other loaded engines, so the swap sounds like
   *  a program change. VERIFIED: tests/profiles.test.ts "a new pack for a loaded one takes its place" (position kept,
   *  the file's program replayed into the new engine). */
  add(voices, replace = false) {
    let old;
    try {
      this.ensure();
      old = this.loaded.get(voices.kind);
      if (old && !replace) throw new Error(`The ${voices.kind} engine is already loaded`);
      voices.message(MIDI_RESET, 0, 0);
    } catch (error) {
      voices.close();
      throw error;
    }
    this.attach(voices);
    if (!old) return;
    if (this.active === old) {
      const held = this.held.slice();
      this.silence();
      this.held.set(held);
      this.active = voices;
      this.restore();
    }
    old.close();
  }
  /** Makes kind's engine play. The voices of the other one end; a loaded file keeps its position and plays on, with
   *  its controllers and programs up to the position replayed into the new engine and its held notes struck again. */
  use(kind) {
    const current = this.ensure(), next = this.loaded.get(engineKind(kind));
    if (!next) throw new Error(`The ${kind} engine is not loaded`);
    if (next === current) return;
    const held = this.held.slice();
    this.silence();
    this.held.set(held);
    this.active = next;
    this.restore();
  }
  /** Replaces the SoundFont engine's SoundFont; a rejected one leaves the loaded SoundFont in place. Stops file
   *  playback first when that engine plays. */
  loadSoundFont(data) {
    this.ensure();
    if (!this.soundfont) throw new Error("The soundfont engine is not loaded");
    if (this.active === this.soundfont) this.stop();
    this.soundfont.load(data);
  }
  /** Selects the embedded bank (banks.ini's number) of every loaded FM engine: 'fm', 'sb16-opl3' and the 'sb16-cqm'
   *  profile (a new pack for its core); a file keeps playing with its state replayed. */
  setFmBank(bank) {
    integer(bank, 0, FM_BANKS - 1, "FM bank");
    this.changeFmBank((v) => v.setBank(bank));
  }
  /** Replaces the instruments of every loaded FM engine with a WOPL bank file; a rejected file keeps the bank. */
  loadFmBank(data) {
    this.changeFmBank((v) => v.loadBank(data));
  }
  /** Applies a bank change to every loaded FM engine, the CQM first: its core may reject the bank, and goes first so a
   *  rejection leaves every engine on the bank it had. The CQM changes banks by restarting its core, which a rejection
   *  restarts on the pack it had, at power-on state: when it plays, the file's state is replayed then as after a change. */
  changeFmBank(apply) {
    const active = this.ensure(), family = this.fmFamily();
    if (!family.length) throw new Error("The fm engine is not loaded");
    try {
      for (const v of [...family].sort((a, b) => +(a instanceof FmVoices) - +(b instanceof FmVoices))) apply(v);
    } catch (error) {
      if (active instanceof NativeProfileVoices && active.kind === "sb16-cqm") this.restore();
      throw error;
    }
    if (family.includes(active)) this.restore();
  }
  /** The SoundFont engine's voices sounding now, releasing ones included; on the FM engine the chip channels that
   *  notes hold (fm.cpp's fm_voices). VERIFIED: an FM note's release still sounds after note off while this is 0. */
  voices() {
    return this.ensure().voices();
  }
  /** MIDI and SysEx the active engine could not take since it loaded: a native profile whose input queue was full,
   *  such as the Sound Canvas cores' MIDI IN; 0 on the other engines, which take everything. */
  dropped() {
    const v = this.ensure();
    return v instanceof NativeProfileVoices ? v.dropped : 0;
  }
  hasPreset(bank, program) {
    return this.ensure().presets().some((p) => p.bank === bank && p.program === program);
  }
  /** Parses a MIDI, RMI or MUS file and positions it at its start. Stops the previous file; a rejected file leaves
   *  none loaded. Every channel returns to its General MIDI state. */
  loadMidi(data, options = {}) {
    const bytes = inputBytes(data, MAX_SONG_BYTES, "file length");
    const tempo = finite(options.tempo ?? 1, 0.25, 4, "tempo");
    this.stop();
    this.song = null;
    const parsed = parseSong(bytes), rate = this.options.sampleRate;
    const song = tempo === 1 ? parsed : { ...parsed, times: parsed.times.map((time) => time / tempo), duration: parsed.duration / tempo };
    this.songFrames = song.times.map((time) => Math.round(time * rate));
    this.endFrame = Math.round(song.duration * rate);
    this.song = song;
    this.index = 0;
    this.position = 0;
    this.message(MIDI_RESET);
    return this.playbackInfo();
  }
  requireSong() {
    this.ensure();
    if (!this.song) throw new Error("Load a MIDI file first");
    return this.song;
  }
  play(loop = false) {
    this.requireSong();
    this.loop = loop;
    if (this.state === "ended") this.seek(0);
    this.state = "playing";
  }
  /** Freezes file playback and the synthesizer; render emits silence until play. */
  pause() {
    this.ensure();
    if (this.state === "playing") this.state = "paused";
  }
  /** Ends every sound at once and rewinds a loaded file to its start, in the General MIDI state. */
  stop() {
    this.ensure();
    this.silence();
    if (this.song) {
      this.index = 0;
      this.position = 0;
      this.message(MIDI_RESET);
    }
    this.state = "idle";
  }
  /** Ends every sound at once; queued and file events still follow. */
  panic() {
    this.ensure();
    this.silence();
  }
  /** Moves the file to seconds: resets the channels and applies every non-note message before that time. */
  seek(seconds) {
    const song = this.requireSong();
    finite(seconds, 0, song.duration, "seek position");
    this.silence();
    const target = Math.round(seconds * this.options.sampleRate);
    let i = 0;
    while (i < song.messages.length && this.songFrames[i] < target) i++;
    this.chase(i);
    this.index = i;
    this.position = target;
    if (this.state === "ended") this.state = "idle";
  }
  /** Sets the file's playback rate, 0.25 to 4: 2 plays it twice as fast at the same pitch. */
  setRate(rate) {
    this.ensure();
    this.rate = finite(rate, 0.25, 4, "playback rate");
  }
  /** The General MIDI state, then the file's state before message index count in file order, so a new engine or bank
   *  continues the file as it stood: every system exclusive message and reset, and of each channel's program, pitch
   *  bend, channel pressure and controller value the last one. A message that a later one of its kind replaces leaves
   *  nothing behind, and the Sound Canvas cores take MIDI at 3,125 bytes per second into 16 KiB, so a seek in a file of
   *  many controller changes would wait seconds, or overflow (dropped), behind ones that change nothing. Bank select,
   *  RPN, NRPN, data entry and the channel mode messages act on what comes after them: all of those go. */
  chase(count) {
    this.message(MIDI_RESET);
    const song = this.song;
    if (!song) return;
    const keep = chaseMask(song.messages, count);
    for (let i = 0; i < count; i++) if (keep[i]) this.apply(song, i);
  }
  /** Plays message index of song: a channel message, a reset, or a system exclusive message, which reaches the active
   *  engine as it is (each engine resets on the GM, GM2, GS and XG resets itself). */
  apply(song, index) {
    const data = (song.messages[index] & 240) === 240 ? song.sysex.get(index) : void 0;
    if (data) this.ensure().sysex(data, 0, data.length);
    else this.message(song.messages[index]);
  }
  /** Continues a loaded file on the active engine: its state up to the position, then the notes it holds. */
  restore() {
    this.chase(this.song ? this.index : 0);
    for (let i = 0; i < this.held.length; i++) if (this.held[i]) this.ensure().message(144 | i >> 7, i & 127, this.held[i]);
  }
  /** Plays file message index and keeps note on and off in held; a reset ends every held note. */
  play1(song, index) {
    const message = song.messages[index], kind = message & 240, key = (message & 15) << 7 | message >>> 8 & 127, velocity = message >>> 16 & 127;
    if (kind === 144) this.held[key] = velocity;
    else if (kind === 128) this.held[key] = 0;
    else if (kind === 176 && ((message >>> 8 & 127) === 123 || (message >>> 8 & 127) === 120)) this.held.fill(0, key & ~127, (key & ~127) + 128);
    else if (message === MIDI_RESET) this.held.fill(0);
    this.apply(song, index);
  }
  playbackInfo() {
    this.ensure();
    const song = this.song, rate = this.options.sampleRate;
    return { title: song?.title ?? "", duration: song?.duration ?? 0, position: song ? Math.min(song.duration, this.position / rate) : 0, ended: this.state === "ended", rate: this.rate };
  }
  /** Plays one packed message (status, data 1 << 8, data 2 << 16) or MIDI_RESET at once. */
  message(packed) {
    this.ensure().message(packed & 255, packed >>> 8 & 255, packed >>> 16 & 255);
  }
  /** Plays the system exclusive message of length bytes at offset in bytes (F0 through F7, validated by the caller) on
   *  the active engine at once; the scheduler passes its payload store, so nothing is allocated. */
  sysex(bytes, offset, length) {
    this.ensure().sysex(bytes, offset, length);
  }
  /** Called by the validated scheduler with scalar operands, avoiding event objects. */
  dispatch(op, a, b, c) {
    const v = this.ensure();
    switch (op) {
      case OP.noteOn:
        v.message(144 | a, b, c);
        break;
      case OP.noteOff:
        v.message(128 | a, b, 0);
        break;
      case OP.controlChange:
        v.message(176 | a, b, c);
        break;
      case OP.programChange:
        v.message(192 | a, b, 0);
        break;
      case OP.pitchBend:
        v.message(224 | a, b & 127, b >> 7);
        break;
      case OP.channelPressure:
        v.message(208 | a, b, 0);
        break;
      case OP.polyPressure:
        v.message(160 | a, b, c);
        break;
      case OP.preset:
        v.setPreset(a, b, c);
        break;
      case OP.reset:
        v.message(MIDI_RESET, 0, 0);
        break;
      default:
        throw new RangeError("Unknown event operation");
    }
  }
  controlAll(controller) {
    const v = this.ensure();
    for (let channel = 0; channel < CHANNELS; channel++) {
      v.message(176 | channel, 64, 0);
      v.message(176 | channel, controller, 0);
    }
  }
  /** Sustain off and All Sound Off (120) on every channel: voices end at once. */
  silence() {
    this.controlAll(120);
    this.held.fill(0);
  }
  /** Sustain off and All Notes Off (123) on every channel: voices release. */
  notesOff() {
    this.controlAll(123);
    this.held.fill(0);
  }
  /** The file reached its end: start again when looping, else end with the notes released. */
  finish() {
    if (this.loop && this.endFrame > 0) {
      this.notesOff();
      this.index = 0;
      this.position = 0;
    } else {
      this.state = "ended";
      this.notesOff();
    }
  }
  /** Writes frames (at most maxFrames) of planar Float32 PCM into left and right from offset, playing the file's
   *  messages at their frames: a message at file frame f plays at the first output frame where the file position,
   *  advancing rate frames per output frame, has reached f. */
  render(left, right, offset, frames) {
    const v = this.ensure();
    integer(frames, 0, this.maxFrames, "render frames");
    integer(offset, 0, Math.min(left.length, right.length) - frames, "render offset");
    if (this.state === "paused") {
      left.fill(0, offset, offset + frames);
      right.fill(0, offset, offset + frames);
      return;
    }
    let done = 0;
    while (done < frames) {
      let n = frames - done;
      if (this.state === "playing") {
        const song = this.song;
        while (this.index < song.messages.length && this.songFrames[this.index] <= this.position) this.play1(song, this.index++);
        if (this.index >= song.messages.length && this.position >= this.endFrame) {
          this.finish();
          continue;
        }
        const next = this.index < song.messages.length ? this.songFrames[this.index] : this.endFrame;
        n = Math.min(n, Math.ceil((next - this.position) / this.rate));
      }
      v.render(left, right, offset + done, n);
      if (this.state === "playing") this.position += n * this.rate;
      done += n;
    }
  }
  close() {
    for (const voice of this.loaded.values()) voice.close();
    this.loaded.clear();
    this.active = null;
    this.soundfont = null;
    this.song = null;
  }
};
var CHASE_ALL = /* @__PURE__ */ new Set([0, 6, 32, 38, 96, 97, 98, 99, 100, 101, 120, 121, 122, 123, 124, 125, 126, 127]);
function chaseMask(messages, count) {
  const keep = new Uint8Array(count), seen = new Uint8Array(16 * 131);
  for (let i = count - 1; i >= 0; i--) {
    const m = messages[i], kind = m & 240, slot = (m & 15) * 131;
    if (kind === 128 || kind === 144 || kind === 160) continue;
    const key = kind === 176 ? CHASE_ALL.has(m >>> 8 & 127) ? -1 : slot + (m >>> 8 & 127) : kind === 192 ? slot + 128 : kind === 224 ? slot + 129 : kind === 208 ? slot + 130 : -1;
    if (key >= 0) {
      if (seen[key]) continue;
      seen[key] = 1;
    }
    keep[i] = 1;
  }
  return keep;
}

// src/queue.ts
var MAX_QUEUED_SYSEX_BYTES = 16 * 1024 * 1024;
var EventQueue = class {
  constructor(capacity = 8192) {
    this.capacity = capacity;
    integer(capacity, 1, 1048576, "queue capacity");
    this.frames = new Float64Array(capacity);
    this.order = new Float64Array(capacity);
    this.ops = new Int32Array(capacity * 4);
  }
  frames;
  order;
  ops;
  serial = 0;
  size = 0;
  /** The bytes of the queued SysEx messages; sysex events index it (offset, length) until they are taken. */
  payload = new Uint8Array(0);
  payloadEnd = 0;
  payloadLive = 0;
  get nextFrame() {
    return this.size ? this.frames[0] : Infinity;
  }
  /** The SysEx bytes that queued events hold. */
  get sysexBytes() {
    return this.payloadLive;
  }
  clear() {
    this.size = 0;
    this.serial = 0;
    this.payloadEnd = 0;
    this.payloadLive = 0;
  }
  /** Preflight the entire batch so rejection never leaves half a score scheduled. A sysex event ([frame, OP.sysex,
   *  index, 0, 0]) takes its message, F0 through F7, from payloads[index]. */
  pushBatch(events, payloads = []) {
    if (events.length > this.capacity - this.size) throw new RangeError("Event queue full");
    if (this.serial + events.length > Number.MAX_SAFE_INTEGER) throw new RangeError("Event sequence exhausted");
    if (!Array.isArray(payloads)) throw new TypeError("Invalid SysEx payloads");
    let bytes = 0;
    for (const event of events) {
      if (!Array.isArray(event) || event.length !== 5) throw new TypeError("Invalid packed event");
      integer(event[0], 0, Number.MAX_SAFE_INTEGER, "frame");
      integer(event[1], 0, OP_COUNT - 1, "operation");
      if (event[1] === OP.sysex) {
        const data = payloads[integer(event[2], 0, payloads.length - 1, "SysEx payload index")];
        if (!(data instanceof Uint8Array) || !isSysEx(data)) throw new RangeError("Invalid SysEx payload");
        integer(event[3], 0, 0, "operand");
        integer(event[4], 0, 0, "operand");
        bytes += data.length;
      } else for (let j = 2; j < 5; j++) integer(event[j], 0, OPERAND_MAX, "operand");
    }
    if (bytes > MAX_QUEUED_SYSEX_BYTES - this.payloadLive) throw new RangeError("SysEx queue full");
    if (bytes > this.payload.length - this.payloadEnd) this.reserve(bytes);
    for (const e of events) {
      let i = this.size++;
      this.frames[i] = e[0];
      this.order[i] = this.serial++;
      if (e[1] === OP.sysex) {
        const data = payloads[e[2]];
        this.payload.set(data, this.payloadEnd);
        this.ops[i * 4] = OP.sysex;
        this.ops[i * 4 + 1] = this.payloadEnd;
        this.ops[i * 4 + 2] = data.length;
        this.ops[i * 4 + 3] = 0;
        this.payloadEnd += data.length;
        this.payloadLive += data.length;
      } else for (let j = 0; j < 4; j++) this.ops[i * 4 + j] = e[j + 1];
      while (i > 0) {
        const p = i - 1 >>> 1;
        if (!this.before(i, p)) break;
        this.swap(i, p);
        i = p;
      }
    }
  }
  /** Moves the live SysEx messages to the front of a store with room for bytes more after them: the current store when
   *  it is large enough, else one twice as large or as large as needed. */
  reserve(bytes) {
    const need = this.payloadLive + bytes;
    const target = need <= this.payload.length ? this.payload : new Uint8Array(Math.min(MAX_QUEUED_SYSEX_BYTES, Math.max(need, this.payload.length * 2, 65536)));
    const held = [];
    for (let i = 0; i < this.size; i++) if (this.ops[i * 4] === OP.sysex) held.push(i);
    held.sort((a, b) => this.ops[a * 4 + 1] - this.ops[b * 4 + 1]);
    let at = 0;
    for (const i of held) {
      const from = this.ops[i * 4 + 1], length = this.ops[i * 4 + 2];
      if (target === this.payload) target.copyWithin(at, from, from + length);
      else target.set(this.payload.subarray(from, from + length), at);
      this.ops[i * 4 + 1] = at;
      at += length;
    }
    this.payload = target;
    this.payloadEnd = at;
  }
  /** Write into caller-owned scratch, never allocate while popping. A sysex event's message stays in payload at the
   *  offset and length of target[1] and target[2] until the next pushBatch or clear. */
  pop(target) {
    if (!this.size) throw new RangeError("Empty event queue");
    for (let j = 0; j < 4; j++) target[j] = this.ops[j];
    if (this.ops[0] === OP.sysex && (this.payloadLive -= this.ops[2]) === 0) this.payloadEnd = 0;
    this.size--;
    if (!this.size) return;
    this.frames[0] = this.frames[this.size];
    this.order[0] = this.order[this.size];
    for (let j = 0; j < 4; j++) this.ops[j] = this.ops[this.size * 4 + j];
    let i = 0;
    while (i * 2 + 1 < this.size) {
      let c = i * 2 + 1;
      if (c + 1 < this.size && this.before(c + 1, c)) c++;
      if (!this.before(c, i)) break;
      this.swap(c, i);
      i = c;
    }
  }
  before(a, b) {
    return this.frames[a] < this.frames[b] || this.frames[a] === this.frames[b] && this.order[a] < this.order[b];
  }
  swap(a, b) {
    let t = this.frames[a];
    this.frames[a] = this.frames[b];
    this.frames[b] = t;
    t = this.order[a];
    this.order[a] = this.order[b];
    this.order[b] = t;
    for (let j = 0; j < 4; j++) {
      t = this.ops[a * 4 + j];
      this.ops[a * 4 + j] = this.ops[b * 4 + j];
      this.ops[b * 4 + j] = t;
    }
  }
};

// src/session.ts
var RENDER_GRID = 64;
var RenderSession = class {
  constructor(engine, capacity = 8192) {
    this.engine = engine;
    this.queue = new EventQueue(capacity);
  }
  queue;
  scratch = new Int32Array(4);
  frame = 0;
  lateEvents = 0;
  /** Adds a batch atomically; sysex events take their messages from payloads (packEvent). */
  schedule(events, payloads) {
    this.queue.pushBatch(events, payloads);
  }
  clear() {
    this.queue.clear();
  }
  stats() {
    return { frame: this.frame, queuedEvents: this.queue.size, lateEvents: this.lateEvents };
  }
  process(left, right, startFrame = this.frame) {
    integer(startFrame, this.frame, Number.MAX_SAFE_INTEGER - left.length, "start frame");
    if (left.length !== right.length) throw new RangeError("Stereo buffers must have equal length");
    this.frame = startFrame;
    let offset = 0;
    while (offset < left.length) {
      while (this.queue.nextFrame <= this.frame) {
        if (this.queue.nextFrame < this.frame) this.lateEvents++;
        this.queue.pop(this.scratch);
        if (this.scratch[0] === OP.sysex) this.engine.sysex(this.queue.payload, this.scratch[1], this.scratch[2]);
        else this.engine.dispatch(this.scratch[0], this.scratch[1], this.scratch[2], this.scratch[3]);
      }
      const frames = Math.min(left.length - offset, this.engine.maxFrames, this.queue.nextFrame - this.frame, RENDER_GRID - this.frame % RENDER_GRID);
      this.engine.render(left, right, offset, frames);
      offset += frames;
      this.frame += frames;
    }
  }
};

// src/worklet.ts
var MidiProcessor = class extends AudioWorkletProcessor {
  session;
  settings;
  closed = false;
  /** The modules compiled so far, by moduleKey: a later engine on one of them comes without bytes. VERIFIED:
   *  scripts/e2e.mjs plays fm and sb16-opl3 in the browser with one fm-synth.wasm request. */
  modules = /* @__PURE__ */ new Map();
  constructor(options) {
    super();
    this.port.onmessage = (event) => this.command(event.data);
    const config = options.processorOptions;
    this.settings = normalizeOptions({ ...config.settings, sampleRate });
    try {
      const engine = new Engine(this.voices(config.part), this.settings);
      this.session = new RenderSession(engine, config.capacity);
      this.port.postMessage({ type: "ready", info: engine.info() });
    } catch (error) {
      this.fail(error);
    }
  }
  /** The engine's voices. Native cores boot in profile_init (the Sound Canvas firmware for up to seconds), so voices
   *  are made only here, in the constructor and in addEngine's message, never in process(): a render quantum never
   *  holds a boot, though a long boot still delays the quanta after the message. */
  voices(part, module = part.module ?? this.modules.get(part.key)) {
    if (!module) throw new Error("The engine part has no module");
    const voices = this.build(part, module);
    this.modules.set(part.key, module);
    return voices;
  }
  build(part, module) {
    const fmBank = this.session?.engine.fmBank() ?? this.settings.fmBank;
    if ("assets" in part) return new NativeProfileVoices(part.kind, instantiateProfile(module), new Uint8Array(part.assets), this.settings.sampleRate, fmBank);
    const instance = new WebAssembly.Instance(module, SYNTH_IMPORTS);
    if (part.kind === "fm" || part.kind === "sb16-opl3") return new FmVoices(instance, { ...this.settings, fmBank }, part.kind);
    if (!part.soundfont) throw new Error("The soundfont engine needs a SoundFont");
    return new SoundFontVoices(instance, new Uint8Array(part.soundfont), this.settings);
  }
  fail(error) {
    this.port.postMessage({ type: "fatal", error: error instanceof Error ? error.message : String(error) });
    this.closed = true;
    this.session?.engine.close();
  }
  command(request) {
    try {
      if (request.method === "dispose") {
        this.closed = true;
        this.session?.engine.close();
        this.port.postMessage({ id: request.id, result: null });
        return;
      }
      if (this.closed || !this.session) throw new Error("Processor is not ready");
      if (request.method === "addEngine") {
        void this.addEngine(request);
        return;
      }
      const s = this.session, e = s.engine, a = request.args;
      let result = null;
      switch (request.method) {
        case "schedule":
          s.schedule(a[0], a[1] ?? []);
          break;
        case "clear":
          s.clear();
          break;
        case "panic":
          s.clear();
          e.panic();
          break;
        case "useEngine":
          s.clear();
          e.use(a[0]);
          result = e.info();
          break;
        case "loadSoundFont":
          s.clear();
          e.loadSoundFont(a[0]);
          result = e.info();
          break;
        case "setFmBank":
          e.setFmBank(a[0]);
          result = e.info();
          break;
        case "loadFmBank":
          e.loadFmBank(a[0]);
          result = e.info();
          break;
        case "loadMidi":
          s.clear();
          result = e.loadMidi(a[0], a[1]);
          break;
        case "play":
          e.play(a[0]);
          break;
        case "pause":
          e.pause();
          break;
        case "stop":
          s.clear();
          e.stop();
          break;
        case "seek":
          s.clear();
          e.seek(a[0]);
          break;
        case "rate":
          e.setRate(a[0]);
          break;
        case "status":
          result = { ...s.stats(), ...e.playbackInfo(), voices: e.voices(), dropped: e.dropped() };
          break;
        default:
          throw new Error(`Unknown command: ${request.method}`);
      }
      this.port.postMessage({ id: request.id, result });
    } catch (error) {
      this.port.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  /** Compiles the bytes of a later engine without blocking the audio thread, then adds the engine; the reply waits
   *  for both, and the synthesizer sends no other engine command meanwhile. */
  async addEngine(request) {
    try {
      const part = request.args[0];
      const module = part.module ?? (part.wasm ? await WebAssembly.compile(part.wasm) : this.modules.get(part.key));
      if (this.closed || !this.session) throw new Error("Processor is not ready");
      const engine = this.session.engine;
      engine.add(this.voices(part, module), request.args[1] === true);
      this.port.postMessage({ id: request.id, result: engine.info() });
    } catch (error) {
      this.port.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  process(_inputs, outputs) {
    if (this.closed) return false;
    const out = outputs[0];
    if (!out || out.length < 2 || !this.session) return true;
    try {
      this.session.process(out[0], out[1], Math.max(currentFrame, this.session.frame));
    } catch (error) {
      out[0].fill(0);
      out[1].fill(0);
      this.fail(error);
      return false;
    }
    return true;
  }
};
registerProcessor("defuss-midi-synth", MidiProcessor);
//# sourceMappingURL=worklet.js.map
