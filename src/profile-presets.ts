/* The tone and drum set names of the Roland SC-55 and SC-55mkII for NativeProfileVoices.presets: each tone is
 * [bank (the GS variation number, CC0), program, name]; the drum sets are programs of bank 128. Taken unchanged from
 * SoundCarcass (https://github.com/superctr/sound-carcass, commit 6adfa172ccf59bd14fcd581601d3c64669cb0935, the
 * pin of scripts/build-native-profiles.py), src/editor/maps/names/sc55.json and sc55mk2.json (map 1), whose notice
 * follows.
 *
 * BSD 3-Clause License
 *
 * Copyright (c) 2026, Ian Karlsson
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
/** Per bank: the programs (-1: all 128 in order) and their names. */
type ToneTable = readonly (readonly [number, readonly number[] | -1, readonly string[]])[];

const SC55: ToneTable = [
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
  [127, -1, ["Acou Piano 1", "Acou Piano 2", "Acou Piano 3", "Elec Piano 1", "Elec Piano 2", "Elec Piano 3", "Elec Piano 4", "Honkytonk", "Elec Org 1", "Elec Org 2", "Elec Org 3", "Elec Org 4", "Pipe Org 1", "Pipe Org 2", "Pipe Org 3", "Accordion", "Harpsi 1", "Harpsi 2", "Harpsi 3", "Clavi 1", "Clavi 2", "Clavi 3", "Celesta 1", "Celesta 2", "Syn Brass 1", "Syn Brass 2", "Syn Brass 3", "Syn Brass 4", "Syn Bass 1", "Syn Bass 2", "Syn Bass 3", "Syn Bass 4", "Fantasy", "Harmo Pan", "Chorale", "Glasses", "Soundtrack", "Atmosphere", "Warm Bell", "Funny Vox", "Echo Bell", "Ice Rain", "Oboe 2001", "Echo Pan", "Doctor Solo", "School Daze", "Bellsinger", "Square Wave", "Str Sect 1", "Str Sect 2", "Str Sect 3", "Pizzicato", "Violin 1", "Violin 2", "Cello 1", "Cello 2", "Contrabass", "Harp 1", "Harp 2", "Guitar 1", "Guitar 2", "Elec Gtr 1", "Elec Gtr 2", "Sitar", "Acou Bass 1", "Acou Bass 2", "Elec Bass 1", "Elec Bass 2", "Slap Bass 1", "Slap Bass 2", "Fretless 1", "Fretless 2", "Flute 1", "Flute 2", "Piccolo 1", "Piccolo 2", "Recorder", "Pan Pipes", "Sax 1", "Sax 2", "Sax 3", "Sax 4", "Clarinet 1", "Clarinet 2", "Oboe", "Engl Horn", "Bassoon", "Harmonica", "Trumpet 1", "Trumpet 2", "Trombone 1", "Trombone 2", "Fr Horn 1", "Fr Horn 2", "Tuba", "Brs Sect 1", "Brs Sect 2", "Vibe 1", "Vibe 2", "Syn Mallet", "Windbell", "Glock", "Tube Bell", "Xylophone", "Marimba", "Koto", "Sho", "Shakuhachi", "Whistle 1", "Whistle 2", "Bottleblow", "Breathpipe", "Timpani", "Melodic Tom", "Deep Snare", "Elec Perc 1", "Elec Perc 2", "Taiko", "Taiko Rim", "Cymbal", "Castanets", "Triangle", "Orche Hit", "Telephone", "Bird Tweet", "One Note Jam", "Water Bell", "Jungle Tune"]],
];
const SC55MK2: ToneTable = [
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
  [127, -1, ["Acou Piano 1", "Acou Piano 2", "Acou Piano 3", "Elec Piano 1", "Elec Piano 2", "Elec Piano 3", "Elec Piano 4", "Honkytonk", "Elec Org 1", "Elec Org 2", "Elec Org 3", "Elec Org 4", "Pipe Org 1", "Pipe Org 2", "Pipe Org 3", "Accordion", "Harpsi 1", "Harpsi 2", "Harpsi 3", "Clavi 1", "Clavi 2", "Clavi 3", "Celesta 1", "Celesta 2", "Syn Brass 1", "Syn Brass 2", "Syn Brass 3", "Syn Brass 4", "Syn Bass 1", "Syn Bass 2", "Syn Bass 3", "Syn Bass 4", "Fantasy", "Harmo Pan", "Chorale", "Glasses", "Soundtrack", "Atmosphere", "Warm Bell", "Funny Vox", "Echo Bell", "Ice Rain", "Oboe 2001", "Echo Pan", "Doctor Solo", "School Daze", "Bellsinger", "Square Wave", "Str Sect 1", "Str Sect 2", "Str Sect 3", "Pizzicato", "Violin 1", "Violin 2", "Cello 1", "Cello 2", "Contrabass", "Harp 1", "Harp 2", "Guitar 1", "Guitar 2", "Elec Gtr 1", "Elec Gtr 2", "Sitar", "Acou Bass 1", "Acou Bass 2", "Elec Bass 1", "Elec Bass 2", "Slap Bass 1", "Slap Bass 2", "Fretless 1", "Fretless 2", "Flute 1", "Flute 2", "Piccolo 1", "Piccolo 2", "Recorder", "Pan Pipes", "Sax 1", "Sax 2", "Sax 3", "Sax 4", "Clarinet 1", "Clarinet 2", "Oboe", "Engl Horn", "Bassoon", "Harmonica", "Trumpet 1", "Trumpet 2", "Trombone 1", "Trombone 2", "Fr Horn 1", "Fr Horn 2", "Tuba", "Brs Sect 1", "Brs Sect 2", "Vibe 1", "Vibe 2", "Syn Mallet", "Windbell", "Glock", "Tube Bell", "Xylophone", "Marimba", "Koto", "Sho", "Shakuhachi", "Whistle 1", "Whistle 2", "Bottleblow", "Breathpipe", "Timpani", "Melodic Tom", "Deep Snare", "Elec Perc 1", "Elec Perc 2", "Taiko", "Taiko Rim", "Cymbal", "Castanets", "Triangle", "Orche Hit", "Telephone", "Bird Tweet", "One Note Jam", "Water Bell", "Jungle Tune"]],
];
/** The ten drum sets of both units, on bank 128. */
const DRUM_SETS: readonly (readonly [number, string])[] = [[0, "STANDARD"], [8, "ROOM"], [16, "POWER"], [24, "ELECTRONIC"], [25, "TR-808"], [32, "JAZZ"], [40, "BRUSH"], [48, "ORCHESTRA"], [56, "SFX"], [127, "CM-64/32L"]];
export interface NamedPreset { bank: number; program: number; name: string }
function expand(table: ToneTable): NamedPreset[] {
  const out: NamedPreset[] = [];
  for (const [bank, programs, names] of table) names.forEach((name, i) => out.push({ bank, program: programs === -1 ? i : programs[i]!, name }));
  for (const [program, name] of DRUM_SETS) out.push({ bank: 128, program, name });
  return out.sort((x, y) => x.bank - y.bank || x.program - y.program);
}
/** The presets of a Sound Canvas model: 381 tones on the SC-55, 418 on the SC-55mkII, and the ten drum sets. */
/** VERIFIED: tests/native-profile-abi.test.ts checks the GS tones on their variation banks and ten drum sets on bank 128. */
export function soundCanvasPresets(model: 'roland-sc55' | 'roland-sc55mk2'): NamedPreset[] { return expand(model === 'roland-sc55' ? SC55 : SC55MK2); }
