# Moritz Klein's DIY synthesizer videos (research)

Moritz Klein designs analog synthesizer circuits on a breadboard and explains them from scratch,
part by part, on his YouTube channel (Moritz Klein, @MoritzKlein0), which sets out to make DIY
electronics more accessible. As of 2026-10-31 it has 61 uploads since April 2020 in 12
playlists, and since 2022 Erica Synths has sold his designs as kits (mki x es.EDU). These notes
cover which videos could make a section here, starting with his "For Beginners" playlist (the
breadboard guide, then DIY VCO parts 1-4), and what the simulator would need for them. Nothing in
the simulator follows them yet.

Labels: [V] his own words in the video, from YouTube's auto-generated transcript, read in the
browser (summarised here, not quoted). [D] from the video's description: his bill of materials,
chapters and links. [S] from his CircuitJS simulation linked in the description, decoded from the
link. [K] from Erica Synths' pages and the press about the kits. [I] inferred or recalled, not
checked. [Lab] an idea for the simulator.

Lengths and dates are from each video's watch page. The captions are all YouTube's auto-generated
ones: the diode ladder video has none, and the sawtooth-to-triangle tip's are taken for Dutch. As
videos.md found, YouTube's caption endpoint wants a proof-of-origin token, but the transcript
panel works in the in-app browser.

## For Beginners (playlist PLHeL0JWdJLvRv-r0TTjWxegtBha0ajdYh)

| # | Video | id | Length | Date |
|---|---|---|---|---|
| 1 | Complete beginner's guide to using a breadboard | XpMZoR3fgd0 | 21:22 | 2021-03-29 |
| 2 | DIY VCO Part 1: The analog oscillator core anyone can build | QBatvo8bCa4 | 27:09 | 2020-06-20 |
| 3 | DIY VCO Part 2: The simplest exponential converter | 4qxgwN9aq8E | 22:59 | 2020-07-07 |
| 4 | DIY VCO Part 3: Tuning your VCO (and making sure it stays in tune) | dd1dws6pSNo | 24:56 | 2020-07-24 |
| 5 | DIY VCO Part 4: Shaping Sawtooth to Square | E76z9ZTc5po | 27:11 | 2020-08-17 |

### Complete beginner's guide to using a breadboard

- [D] Parts:
  - a full-size breadboard (830 tie points), two 9 V batteries with clips, jumpers, two
    alligator-clip leads, a 6.35 or 3.5 mm jack socket and an optional multimeter;
  - a TL074, a few LEDs, a 1 µF foil capacitor, three 100k, a 10k and two 1k.
- [D] Chapters: components and tools, a simple LED circuit, an inverter, a low-frequency
  oscillator, an audible oscillator.
- [V] It's about the practical side only. The theory is in his DIY VCO series, which he points
  to at the end.
- [V] He recommends batteries over a mains supply for a first circuit, because a short only warms
  them.
- [V] The parts:
  - small 0.4 W resistors, whose values he reads with the multimeter rather than from the colour
    rings;
  - capacitors: electrolytic (a cylinder), foil (a box) and ceramic (a disc), with the value and
    voltage rating printed on them, and he warns that exceeding the rating can make one burst;
  - LEDs, whose longer leg goes towards the resistor;
  - the TL074, four op amps in one chip.
- [V] Circuit 1, an LED: 9 V, then 1k, then the LED, then ground. He draws the same schematic once
  as a loop and once with separate supply symbols. The breadboard:
  - the power rails run its length, and on some boards they're split halfway, shown by a gap in
    the red and blue lines;
  - the channel down the middle;
  - rows of five holes running across the board.
- [V] Circuit 2, a "crude" op-amp inverter (a comparator):
  - the + input goes to ground, and the output drives 1k and an LED to ground;
  - a jumper into the − input: on the positive rail the LED goes dark, and on the negative rail it
    lights.
  - Op-amp symbols leave out the supply pins, so look up the chip's pinout and match it to the
    chip by the notch.
  - The negative rail comes from a second battery, with its + on the ground rail.
- [V] Circuit 3, a square-wave oscillator (an op-amp relaxation oscillator) with the same LED
  output:
  - the + input has 100k to ground and 100k to the output;
  - the − input has 1 µF to ground (non-polarised, so foil) and 100k to the output;
  - the LED flashes.
- [V] Circuit 4 makes it audible:
  - the 100k from the output to the − input becomes 1k;
  - the LED and its resistor become a 10k/1k divider into the jack, tip for signal and sleeve for
    ground, with the socket's switch lug left unused;
  - the lugs are found with the multimeter's continuity beeper.
- [I] With equal resistors on the + input, the period is 2RC ln 3, about 2.2 RC. That's about
  4.6 Hz with 100k and 1 µF, and about 455 Hz with 1k. Not checked against his scope.
- [I] Things to check before building a lab:
  - On the negative swing (about −7 V from a TL074 on ±9 V), the LEDs of circuits 2 and 3 are
    reversed by more than the 5 V most LED datasheets allow, with 1k limiting any current. His
    sequencer video (2022) has a chapter on safe status LEDs.
  - In circuit 2, the − input floats whenever the jumper is out.

### DIY VCO Part 1: The analog oscillator core anyone can build

- [D] Parts: a breadboard, two 9 V batteries or a dual 9-15 V supply, a 40106, a TL074 (one op
  amp of it), a 1N4148, 1 µF and 2.2 nF foil capacitors, four 100k and a jack socket.
- [V] The aim is the simplest VCO that is still musically useful, with reasonably accurate 1 V per
  octave tracking so a standard sequencer can play it.
- [V] He explains voltage and current as pressure and flow in a water pipe. A square wave is a
  voltage switching between two levels. A sawtooth's frequency is set by its slow fall alone,
  which makes it easy to control.
- [V] The core is four parts: a 40106 Schmitt-trigger inverter, 2.2 nF from its input to ground,
  100k from its input to ground, and a 1N4148 from its output to its input.
  - Below the lower threshold, the output is high and charges the capacitor at once through the
    diode.
  - Past the upper threshold, the output goes low and the diode blocks. The capacitor drains
    slowly through the 100k until the lower threshold.
  - The result is a sawtooth that rises at once and falls slowly.
  - The unused 40106 inputs go to ground, or they pick up noise and upset the one in use.
- [V] A jack straight on the capacitor stops the oscillation, because it drains the capacitor. So:
  - a TL074 voltage follower buffers it, on ±9 V for headroom, from two 9 V batteries in series
    with the middle as ground;
  - 1 µF and 100k to ground then centre the wave on 0 V (AC coupling);
  - a 100k/100k divider halves it, from 3 divisions to 1.5 on his scope.
- [V] It ends too high in pitch. Part 2 brings the frequency down and puts it under control.
- [I] On 9 V, a 40106's thresholds are near 5.3 V and 3.5 V (recalled from the datasheet), so the
  fall through 100k × 2.2 nF takes RC ln(5.3/3.5), about 90 µs: roughly 10 kHz, which fits "too
  high".

### Parts 2-4 (from the descriptions)

- [D] Part 2:
  - parts: a BC548C, 4k, two 10k, two 100k, a 100k pot, and a jack for a sequencer's CV;
  - topics: NPN basics, the pot, adding voltages, scaling and offset, and temperature dependence.
  - He later added a correction: his account of a linear region versus a half-on state is wrong,
    because the collector current always depends exponentially on the base voltage. The circuit
    still works. [Lab] Show it as corrected.
- [D] Part 3:
  - parts: a BC558C, 1M, 1.5k and a 1k precision trimmer;
  - topics: less temperature dependence, then fine-tuning, with PNP transistors, an emitter
    follower and subtracting voltages.
- [D] Part 4:
  - parts: two 100k linear pots, 1 µF, a 1N4148, 1M, 200k, three 100k, 33k, 20k and three 10k
    NTC thermistors;
  - topics: thermistors against drift, a fine-tune knob from a weighted divider, a 40106 turning
    the sawtooth into a variable pulse, op-amp basics and the non-inverting amplifier, and
    modular levels (10 V peak to peak);
  - links: the Ebers-Moll model on Wikipedia, and René Schmitz's pages.
- [I] Why temperature matters: the collector current goes up by a factor of e for every VT (about
  26 mV at room temperature), so 1 V per octave needs the CV scaled to about 18 mV per volt
  (VT ln 2). VT grows with absolute temperature, which is the drift parts 3 and 4 fight. [Lab] A
  temperature slider that shows the pitch drifting, with and without the thermistors.
- [D] "How to build a DIY 3X VCO module from scratch" (OCAb2UoSPs0, 16:17, 2020-09-28) ends the
  series: three VCOs on stripboard, behind a panel.

## The other series

Main parts from his bills of materials [D]. The kit videos ("Introducing the mki x es.edu DIY …
kit", 3-8 minutes each) are left out.

| Series | Videos (id, length, date) | Parts |
|---|---|---|
| DIY VCO, after parts 1-4 | 3X VCO module (above); sawtooth-to-triangle quick tip 4r3TTaUKNe0, 15:41, 2021-01-18; voltage-controlled PWM FUz3gFAh9pY, 17:25, 2021-04-18 | TL074 |
| Power | dual supply pQKN30Mzi2g, 26:04, 2020-11-15: he says it's not for beginners, who should use 9 V batteries | 7812, 7912, 1N4007, 4700 µF, a 12 V AC wall wart |
| DIY VCF | Part 1, analog filtering basics 3tMGNI--ofU, 21:46, 2020-12-15; Part 2, active filters and resonance YNoj9Rrw_VM, 27:30, 2021-01-03; Part 3, resonant high-pass and vactrol control ITJX9jP-zm4, 29:21, 2021-02-14; diode ladder filter jvNNgUl3al0, 36:04, 2021-03-08; as a Eurorack module tWKLFcc_BJM, 34:47, 2021-05-12 | TL074s, diodes, vactrols |
| VCA | transistor VCA yMrCCx6uqcE, 48:41, 2021-08-09 | 2 matched BC548, TL072 |
| Envelope | ADSR(-ish) aGFb7JbTdNU, 30:59, 2021-06-14; looping an envelope L9vTz0vm6pc, 2:48, 2021-08-29 | TL074, TL072 |
| S&H and noise | sample and hold kIJqzkRe4do, 31:03, 2021-12-14; white, pink and blue noise 0yB_h_wFkh4, 25:28, 2022-07-04 | TL074, BC548 |
| Sequencer | 5-step sequencer vHNQQ6yUGyo, 32:08, 2022-03-14 | CD4017, TL074, 5 BC548, 13 1N4148, 5 pots, LEDs |
| Mixer | 3-channel mixer with diode distortion q8tmUgaXrEQ, 26:39, 2022-05-03 | 2 TL072 |
| Wavefolder | double wavefolder jbStEUfBWXY, 21:30, 2022-09-26 | TL074, 2 BC548, 2 BC558 |
| Effects | compressor Wag-yTyAxPA, 29:23, 2023-01-01; production-ready compressor OMeKERW1E60, 23:17, 2023-04-06; BBD delay 4LjP5Y1yxXs, 44:55, 2024-10-16 | TL072/TL074; MN3205 or V3205 (a 4096-stage BBD) |
| Drums | kick yz37Yz315eU, 39:11, 2023-08-10; TR-606 style hi-hat zbBY7JL9nnQ, 36:43, 2023-12-05; TR-808 style snare hULEn2_4Unw, 22:44, 2024-04-19; FM drum Xbl1xwFR3eg, 36:30, 2025-04-16; drum sequencer s9HKXLPiX0w, 31:47, 2025-09-29 | BC548/BC558, TL072/TL074, a 40106 (hi-hat, [S]); a shift register and a DAC (sequencer) |
| Arpeggiator / quantizer | logic-gate arpeggiator, Parts 1-3: 3v1yTFsypqA, 16:49, 2020-04-16; 3k53J40eEy0, 13:34, 2020-04-22; qQPQKX6YF7k, 20:02, 2020-05-10 | 4040, TLC7524 (or AD7524) DAC, TL074; 40106, 2 4081, 4070; 4015, ADC0820, 7805, BC548 |

- [D] The arpeggiator is his oldest series, and digital. Part 1 covers digital-to-analog
  conversion. Part 2 builds a "bit processor" from CMOS gates. Part 3 feeds it in several ways,
  and finds it can quantize a CV.
- [D] The drum sequencer avoids a microcontroller and a grid of buttons. A shift register works as
  the trigger sequencer, with accents from a synced triangle LFO and a DAC at the end. Its build
  guide is Erica's PDF.
- [D] Two more: "I created a DIY synth prototyping station" (QyapQpQOwUM, 4:10, 2024-06-13)
  introduces Labor, a breadboard station Erica sells, and "Labor Scope is out now!" (8YweHBtXg0k,
  1:21, 2025-03-27) a scope to go with it. There are also about 15 Shorts and a few livestreams,
  including a 1:37:00 stream about the Erica collaboration (vy5F__2bnlo, 2021-10-24).

## His CircuitJS simulations

- [D] Every design video from the sawtooth-to-triangle tip (2021-01-18) on links a working
  simulation in Paul Falstad's CircuitJS (falstad.com/circuit), except three: the breadboard
  guide, the noise generator and the drum sequencer. That makes 20 links in 19 videos, since the
  S&H also has a BJT version. VCO parts 1-4 have none.
- [S] Each tinyurl link leads to a CircuitJS address that carries the whole circuit
  (lz-string-compressed). Decoded, all 20 have the same settings:
  - a 5 µs time step, CircuitJS's default [I];
  - ±12 V Eurorack rails, with the op amps clipping at ±12 V (some at ±15 V, CircuitJS's default
    [I]);
  - inputs from CircuitJS's generators: sawtooth, square, triangle, sine or noise, from 1 Hz to
    1 kHz.
- [S][I] The element types they use. The codes are matched to types from CircuitJS's source as
  recalled, and the LED, LDR, CD4017 and 40106 codes agree with each file's labels and parts:
  - in nearly every file: wires, resistors, capacitors, diodes, op amps, ground, DC rails and
    generators;
  - potentiometers (in 15 of the 20) and sliders for CV;
  - text labels (in 12, the later files especially);
  - BJTs, NPN and PNP (in 9);
  - SPST and SPDT switches (in 5);
  - LEDs (in 3: the sequencer's step lights, the compressor's gain-reduction light, and VCF part
    3's two vactrols, each an LED with an LDR);
  - once or twice each: JFETs (in the S&H and the delay), MOSFETs, a decade counter (the
    sequencer's CD4017), six inverting Schmitt triggers (the hi-hat's 40106), test points, and
    scopes inside the circuit (the delay's three-stage discrete BBD).
- [S] The labels name real parts (BC548, 2N3904, CD4017, 40106, B100k and log pots) and give build
  notes. Examples: tie the 4017's enable low and leave its carry out unconnected; don't use the
  switched socket; all resistors 1%.
- [I] CircuitJS is GPL-2.0 (recalled), and this repository is MIT, so its code can't be copied in.
  Linking to his simulations is fine.
- [Lab] Reading his circuits from those links would give each lab his circuit as he simulated it,
  but laid out as a schematic, not on a breadboard.

## mki x es.EDU (Erica Synths)

- [K] A planned series of nine Eurorack kits for a monosynth: sequencer, VCO, wavefolder,
  noise/S&H, mixer, VCF, envelope, dual VCA, and an output mixer with a headphone amplifier.
  - The VCO came first, at 60 EUR (CDM, 3 January 2022), and the kit videos number the others: VCA
    2, EG 3, sequencer 4, VCF 5, S&H/noise and mixer 6 and 7 [D].
  - Later kits follow the later videos: compressor, kick, hi-hat, snare, FM drum, BBD delay, drum
    sequencer, and Labor.
- [K] Each kit has a manual of over 40 pages on the circuit and on synthesis, not just assembly.
  The Mixer's (48 pages) has:
  - the schematic and bill of materials, powering the breadboard, a close-up of the design with
    suggested breadboard layouts in some chapters, and appendices on components, tools, assembly
    and soldering;
  - a note that most chapters' circuits can be tried in CircuitJS;
  - a note that the kit doesn't include a breadboard.
- [K] The VCO kit's manual, the first of the series, is a PDF of over 10 MB on Erica's product
  page. Not read.
- [Lab] The manuals are Erica's: link to them, don't copy them.

## What the simulator would need

- [Lab] The digital videos could run on the chip-level engine once the catalog has their
  4000-series parts, as it took the CD4511:
  - the arpeggiator: 4040, 4081, 4070, 40106, 4015;
  - the drum sequencer's shift register;
  - the 5-step sequencer's CD4017.

  Each ends in an analog stage (a DAC and an op amp, or transistors and pots), which the engine
  doesn't model.
- [Lab] Small per-lab analog models, as `src/labs/dclock/_analog.ts` does for Ben's clock: plain
  arithmetic at a fixed step, with the circuit's own equations.
  - The breadboard guide's four circuits and the VCO part 1 core fit this: Schmitt thresholds, a
    diode, a capacitor charging and draining.
  - Add sound through WebAudio and a scope trace (the labs have scopes).
  - It's the smallest real step, and it would cover the "For Beginners" playlist's first two
    videos.
- [Lab] An analog engine for the sandbox, for VCO parts 2-4 and everything after them.
  - Modified nodal analysis, Newton-Raphson for diodes and transistors, and companion models for
    capacitors.
  - A fixed step like CircuitJS's 5 µs (200,000 steps a second of sound). [I] That should be fine
    for a few dozen nodes, run in an AudioWorklet.
  - Op amps as behavioural models: gain, clipping at the rails, perhaps slew rate.
  - New parts: TL072/TL074, BC548/BC558, 1N4148, an analog CD40106, NTC thermistors, a vactrol,
    jack sockets, and 9 V batteries for the guide's ±9 V. Ben's 555 and LM339 labs could use it
    too.
  - It's the big piece of work.
- [I] Further off: the delay's BBD, a 4096-stage analog shift register, which his simulation cuts
  to three stages. His dual supply is close to what the clock labs' supply model already does
  (rectifier, filter capacitors, regulators).

## As a section of the site

- [Lab] It's a creator's video series, like Ben's "More videos" groups (`MORE_GROUPS` in
  `src/app/chapters.ts`), but by someone else. Two ways to fit it:
  - give `MoreGroup` a `by`, with a heading per creator;
  - or add a list beside `PROJECTS`.

  The first group could be his own "For Beginners" playlist, numbered: the guide, then VCO parts
  1-4.
- [Lab] Labs, in order:
  - "Using a breadboard": the guide's four circuits;
  - "The oscillator core" (VCO part 1);
  - the exponential converter (part 2);
  - tuning and temperature (part 3);
  - sawtooth to square (part 4).

  The embeds and links work as Ben's do (youtube-nocookie), with the playlist or his channel as
  the source.
- [Lab] His designs as drawn: his values, and his part names where his labels give them, with his
  later corrections (part 2's) shown, not quietly applied.

## Parts these use that the catalog lacks

| Part | Used in | Nearest part in the catalog |
|---|---|---|
| TL072, TL074 op amps | nearly every video, the breadboard guide | — |
| CD40106 hex Schmitt inverter | VCO core and part 4, arpeggiator 2, hi-hat | 74LS04 (no hysteresis) |
| BC548, BC558, 2N3904 transistors | VCO 2-3, VCA, sequencer, wavefolder, drums | — |
| 1N4148 diodes | VCO core, envelope, sequencer, mixer | — |
| NTC thermistors | VCO 4 | — |
| CD4017 decade counter | 5-step sequencer | 74LS90 (counts in BCD, not one of ten) |
| CD4040 12-bit counter | arpeggiator 1 | 74LS161 (4 bits) |
| CD4081 AND, CD4070 XOR | arpeggiator 2 | 74LS08, 74LS86 |
| CD4015 dual 4-bit shift register | arpeggiator 3 | 74165 (8-bit parallel-in) |
| TLC7524 DAC, ADC0820 | arpeggiator 1 and 3 | — |
| 7805, 7812, 7912 regulators | arpeggiator 3, the dual supply | — (the clock labs model a 7805) |
| LDR and LED (vactrol) | VCF 3 | — |
| Jack sockets, 9 V batteries | everything | — |
| MN3205 / V3205 BBD | delay | — |
| Capacitors as timing parts | everything | — (the sandbox's capacitors only make edge pulses) |

_Sources: his channel and its playlists on YouTube (the watch pages' details and descriptions; the
transcripts of the guide and VCO part 1); his CircuitJS links (tinyurl.com, decoded); Erica
Synths' kit pages; CDM, 3 January 2022; the Mixer kit's manual as rendered on manualsdir.com; the
parts in src/breadboard/catalog.ts._
