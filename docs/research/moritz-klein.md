# Moritz Klein's DIY synthesizer videos (research)

Moritz Klein designs analog synthesizer circuits on a breadboard and explains them from scratch,
part by part, on his YouTube channel (Moritz Klein, @MoritzKlein0), which sets out to make DIY
electronics more accessible. As of 2026-10-31 it has 61 uploads since April 2020 in 12
playlists, and since 2022 Erica Synths has sold his designs as kits (mki x es.EDU). These notes
cover which videos could make a section here, starting with his "For Beginners" playlist (the
breadboard guide, then DIY VCO parts 1-4), and what the simulator needs for them. The playlist is
a group on the site (`OTHER_GROUPS` in `src/app/chapters.ts`), and its labs are in
`src/labs/synth/`: the breadboard guide's (`using-a-breadboard`), then VCO part 1's
(`oscillator-core`), part 2's (`exponential-converter`), part 3's (`vco-tuning`) and part 4's
(`sawtooth-to-square`). His "DIY VCO Series" playlist, which goes on from part 4, is a second
group, with labs for its sawtooth-to-triangle quick tip (`sawtooth-to-triangle`) and for adding
voltage-controlled PWM (`voltage-controlled-pwm`).

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
- [Lab] The lab (`using-a-breadboard`) builds the four circuits on one board, as the video does,
  with his parts and values, and these estimates, said on the page:
  - the TL074's output swings to about ±7.5 V on ±9 V (its datasheet gives the swing on ±15 V
    only), and a red LED drops about 2 V;
  - the floating − input is drift and mains hum made up to show the idea, not measured;
  - the oscillators are the exact solution of the RC charge between the thresholds, so the period
    is 2RC ln 3 at any time step; the sound is a square wave at that pitch;
  - headphones (about 32 Ω) load the 1k of the divider down to a few tens of millivolts.

  The holes are the lab's own, since these notes come from the transcript rather than the
  picture: the second battery sits above the board, its − lead in the top rail and its + lead in
  the bottom ground rail.

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
- [Lab] The lab (`oscillator-core`) builds it in the video's five steps: the core; a jack straight
  on it; the buffer; the AC coupling; the divider and the jack, with the sound. Its estimates,
  said on the page:
  - the thresholds above, a 0.7 V diode, and the 40106's output as about 300 Ω. The jump then
    takes about 0.3 µs and the pitch is about 10.9 kHz. The 40106's delay of some tens of
    nanoseconds is left out: in a real core the capacitor overshoots the upper threshold a little,
    which lowers the pitch.
  - What is plugged into the jack in the second step. Headphones (about 32 Ω) hold the capacitor
    under a volt, so the core stops. An amplifier's line input (about 10k) would instead drain it
    about ten times faster, above 100 kHz.
  - After the 1 µF, the wave settles on its average, about 4.34 V, not on the middle of its swing.

### DIY VCO Part 2: The simplest exponential converter

- [D] Parts: a BC548C, a 4k, two 10k, two 100k, a 100k pot, and a jack for a sequencer's CV.
  Topics: NPN basics, the pot, adding voltages, scaling and offset, and temperature dependence.
- [D] He later added a correction: his account of a linear region versus a half-on state is wrong,
  because the collector current always depends exponentially on the base voltage. The circuit
  still works.
- [V] He starts by fixing part 1's output stage. The top of the wave looked odd, which he puts down
  to the 100k/100k divider making an accidental band-pass filter, so two 10k replace the two 100k.
- [V] To bring the pitch down, the fall has to slow:
  - 1 µF for the 2.2 nF (about 450 times) makes it almost an LFO, and 1M for the 100k (10 times)
    lowers it less;
  - but a capacitor can only be swapped by hand, and a big one bends the quick first phase, so the
    wave turns into an odd, triangle-like shape;
  - a resistance can be controlled: an LDR, a thermistor, or a transistor used as a
    voltage-controlled resistor.
- [V] He explains an NPN transistor as water pipes: a T joint, a seal and a spring. From about
  0.7 V up it is in its linear region, a current amplifier with a gain of 100 to 900, until it
  saturates. For a VCO that has three drawbacks: it is too open, it answers to current, and it is
  linear.
- [V] 1 V per octave: C0 is 16.35 Hz, and each octave doubles the frequency.
- [V] Below 0.7 V he describes a "semi-active" region (the description's update corrects the
  split): barely open, voltage-controlled and exponential, which suits 1 V per octave.
- [V] The circuit:
  - a BC548 takes the drain resistor's place, its collector on the capacitor (with the diode and
    the Schmitt trigger's input) and its emitter on ground;
  - a 100k pot across the 12 V rail is a variable divider, 0 to 12 V on his multimeter;
  - a 100k between the wiper and the base keeps a turn too far from destroying the transistor.
- [V] Most of the pot's range is dead. The core starts around 550 mV and is finicky: from about
  550 to 350 mV it goes from a high pitch to periodic clicks.
- [V] Scaling for his SQ-1 sequencer:
  - it puts out 0 to 5 V, 0 V being a low C;
  - the transistor's window of about 200 mV is 25 times smaller, so 100k with about 4k to ground,
    roughed in, to be tuned later.
- [V] The offset is a passive mixer, two resistors into one point, with the pot as the offset; with
  the 4k it makes a divider with two inputs. With the pot turned down the sequence only clicks
  oddly; opening it slides the sequence into hearing, but it isn't harmonious.
- [V] Touching the transistor makes the pitch drift dramatically. The next part deals with
  temperature and tunes the scaling.
- [I] Why it isn't harmonious: the 4k gives the base about 1/27 of each input's voltage, about
  37 mV a volt, where 1 V per octave wants VT ln 2, about 17.8 mV at 25 °C (a little under 2k to
  ground instead of the 4k): about two octaves a volt.
- [Lab] The lab (`exponential-converter`) has five steps: a bigger R or C; the transistor with the
  pot; the sequencer scaled down alone (the lab's own step, to show why the offset is needed); the
  offset; a finger on the transistor. Its estimates, said on the page:
  - the whole circuit runs on the 12 V rail. The 40106's thresholds there are interpolated from
    TI's typical values, 7.06 and 4.66 V: nearly the ratio of 9 V's, so part 1's core still
    plays about 10.9 kHz.
  - The BC548C follows I_S (e^(V_BE/V_T) − 1), with I_S from its datasheets' typical 660 mV at
    2 mA (about 1.4 × 10⁻¹⁴ A), a current gain of 520, and SPICE's temperature law (T³ and
    1.11 eV). The Early effect is left out. This puts 350 mV at about 2 Hz and 550 mV at about
    5 kHz, as he finds. Past about 4 V on the pot (about 0.71 V at the base and 14 mA through the
    transistor) the 40106 can't put back what it drains, and the core stops.
  - The datasheets allow 580 to 700 mV at 2 mA, a factor of about 100 in current, so another
    transistor's window can sit tens of millivolts away.
  - The sequence, C2 G2 C3 G3 C4 G4 C5 C6 for 0 to 4 V, is the lab's own. With the pot near the top
    (about 11.6 V) it plays from about 29 Hz to 9 kHz.
  - A finger warms the transistor towards 32 °C with a time constant of 6 s, both made up: about
    1.6 semitones a degree.
  - The model doesn't show the big capacitor's bent jump: its 40106 fills even 1 µF in about
    0.14 ms. Listen plays the browser's own sawtooth at the pitch, the core's upside down.

### DIY VCO Part 3: Tuning your VCO (and making sure it stays in tune)

- [D] Parts: a BC558C, 1M, 1.5k and a 1k precision trimmer. Topics: less temperature dependence,
  then fine-tuning, with PNP transistors, an emitter follower and subtracting voltages.
- [V] Two problems are left from part 2. The transistor opens up as it warms, so the VCO would
  need retuning whenever the room changes. And the scaling was only roughed in, so sequences
  sound out of tune.
- [V] The PNP transistor, the NPN's "bizarro twin", in his water pipes, upside down:
  - the emitter on top, the collector below; water flows from the emitter to the collector only
    if it can also flow from the emitter out of the base;
  - so it opens as its base drops below its emitter, once by about 0.7 V, when its spring (which
    pulls, where the NPN's pushes) is overpowered;
  - warmth opens it, just as it opens the NPN, and by about as much.
- [V] The emitter follower: the PNP with a resistor from the positive rail to its emitter. It
  copies the base's voltage to the emitter, a buffer. It is also a voltage divider, with the
  transistor as a voltage-controlled resistor.
  - On the NPN's base, warmth opens the NPN, which raises the pitch. It also opens the PNP, which
    lets the emitter down and closes the NPN. That's a negative feedback loop that cancels the
    drift, as long as the two are at the same temperature, so they should sit close together.
- [V] Biasing: a follower needs its transistor in its linear region. His rule of thumb is half
  the supply on the base (6 V, or 4.5 V on 9 V batteries), which would push the output far above
  550 mV. So the collector goes to the negative rail instead. The range is then 24 V, +12 to
  −12 V, centred on 0 V, and the base can stay at 0 V.
- [V] The output is always a small fixed amount above the input (the spring again): about
  500 mV in his experiments. So where part 2 added an offset, this one has to subtract it.
- [V] The resistor's value hardly matters to the voltage: a wider pipe lets more water in, but the
  transistor opens to let it through ("negative current feedback"). It sets the most current the
  output can give. A base needs little, so 1M.
- [V] On the breadboard: a BC558 (the BC548's pinout: collector, base, emitter), its emitter
  through 1M to +12 V, its base on ground and its collector on −12 V. His multimeter reads about
  480 mV on the emitter.
  - On the BC548's base, 480 mV is far too high a baseline, and the pitch is piercing.
  - Touching the PNP lowers the pitch and touching the NPN raises it. Left alone at the same
    temperature, they balance.
- [V] The offset pot's top end goes to −12 V instead of +12 V. The two-input divider works the
  same with negative voltages, so it subtracts. The pot through 100k into the follower's base,
  with the 4k to ground for rough scaling, brings the pitch down to a reasonable baseline, and
  the sequencer comes in through another 100k.
- [V] Scaling: the 4k is swapped out. The value could be worked out, but a pot is better, because
  the supply is hardly ever exactly ±12 V and may sag as modules are added. He uses a 1k precision
  trimmer (ten turns end to end) in series with 1.5k, since the right value is between 1.5k and
  2.5k: finer control.
- [V] Tuning:
  - four of the sequencer's steps at its lowest level (0 V) and four at its highest (1, 2 or 5 V,
    as it is set), starting with 1 V;
  - Ableton's tuner plugin, since by ear he finds it hard;
  - the offset pot puts the low note on a C, then the trimmer brings the high note to the octave
    above; the trimmer moves the low note too, so it's trial and error.

  The 2 V and 5 V ranges then check out, and in major mode a sequence sounds harmonious.
- [V] Part 4 will add a second, fine-tune pot and a square-wave output.
- [I] Why it cancels. With both transistors at one temperature, the BC548C's current is
  I_P (I_SN / I_SP) e^(V_mix / V_T), where I_P is the follower's current and V_mix the voltage
  at the BC558C's base. The ratio of the two I_S doesn't change with temperature, so the drift
  cancels at V_mix = 0. Elsewhere, V_T still grows with the absolute temperature, about 0.34% a
  degree at 25 °C, which narrows the scale.
  - In the model, tuned at 25 °C, a room at 30 °C puts 0 V about 49 cents sharp and 5 V about
    50 cents flat. Part 2's converter, tuned the same, would be about 8 semitones sharp.
  - The note at V_mix = 0 moves under 2 cents, since the 1M's current changes a little.
  - That is the drift part 4's thermistors are for.
- [I] His reason for a trimmer, in the model: a sagging supply moves every note alike, about
  23 cents for both rails 0.1 V low. Nearly all of that comes through the offset pot's −12 V end;
  the +12 V rail's effect on the follower's current and on the 40106's thresholds about cancel.
  So a sag is an offset, which the offset pot puts back. The scale depends only on the 100k
  against the 1.5k and trimmer, and on V_T. The trimmer is still needed, since the resistors'
  tolerance and the room's temperature decide where it goes: about 346 Ω at 25 °C, 378 Ω at
  30 °C in the model.
- [I] His reason for the −12 V collector: with the collector on ground instead, a base near 0 V
  would still leave the emitter about 0.44 to 0.53 V above the collector, which looks enough to
  keep it out of saturation at 11.5 µA. Not checked. −12 V leaves room to spare, as he says.
- [Lab] The lab (`vco-tuning`) has five steps:
  - the follower alone: the base on a slider, a multimeter on the emitter, and a finger on the
    transistor;
  - on the BC548C's base, with a finger on either transistor, and a chart recorder of both
    temperatures and the pitch;
  - subtracting the offset, with the 4k;
  - tuning with the 1.5k and the trimmer against a tuner, four steps at 0 V and four at 1, 2 or
    5 V;
  - the room's temperature, with a major arpeggio, beside part 2's converter tuned the same.

  Its estimates, said on the page:
  - The BC558C's I_S is set so that its emitter sits 480 mV above its base for the 1M's 11.5 µA,
    as his multimeter read. Its datasheets' typical V_BE(on) at 2 mA is 620 mV (onsemi; 550 to
    700) or 660 mV (Fairchild; 600 to 750), which would put it at about 487 or 527 mV.
  - Its current gain is 270, onsemi's typical for the C grade at 10 µA. It follows the same law
    for temperature as the BC548C: its emitter falls about 2.4 mV a degree.
  - Only the transistors warm: the 40106, the capacitor and the resistors don't. The finger's
    32 °C and 6 s are made up, as in part 2's lab.
  - The rails are exactly ±12 V, 0 V on the jack is meant as C2, and the sequences are the lab's
    own.
  - The tuning is exact, by bisection, not by ear. The trimmer is at about 346 Ω and the pot about
    23.6% of the way to −12 V. 0 to 5 V then come out within 4 cents.

### DIY VCO Part 4: Shaping Sawtooth to Square

- [D] Parts: two 100k linear pots, 1 µF, a 1N4148, 1M, 200k, three 100k, 33k, 20k and three 10k
  NTC thermistors.
- [D] Topics: thermistors against drift, a fine-tune knob from a weighted divider, a 40106 turning
  the sawtooth into a variable pulse, op-amp basics and the non-inverting amplifier, and modular
  levels (10 V peak to peak).
- [D] Links: the Ebers-Moll model on Wikipedia, and René Schmitz's pages.
- [I] Why temperature matters: the collector current goes up by a factor of e for every VT (about
  26 mV at room temperature), so 1 V per octave needs the CV scaled to about 18 mV per volt
  (VT ln 2). At a fixed base voltage the current grows with temperature mostly through I_S: the
  base voltage for a given current falls about 2.4 mV a degree in the converter's window, about
  1.6 semitones in part 2's lab. VT grows with absolute temperature too, which changes the scale.
  That is the drift parts 3 and 4 fight: part 3's follower takes out the first, and the second is
  left for the thermistors.
- [V] A viewer reminded him of thermistors. He calls part 3's "the NPN and the PNP react alike to
  warmth" a broad generalisation, points to the Ebers-Moll equation, which he says he can't
  really get his head round, and tries a primitive experiment instead: a finger on both
  transistors at once. In a perfect world the pitch wouldn't move. It goes down before it
  settles, "the PNP wins", and he deduces that its response needs taming: its base should rise
  as it warms.
- [V] An NTC thermistor's resistance falls as it warms. In series with the 100k, it makes the
  divider's ratio depend on the temperature, its output rising as it warms, and every input
  needs one. Out of his depth on the value, he takes René Schmitz's, whose VCO he draws on
  heavily for the series: 10k thermistors with the 100k, between each 100k and the PNP's base.
  They add at least a few k, so the VCO needs retuning.
- [V] The fine-tune knob: the coarse pot's 0 to −12 V divided by about 50 is 0 to about −240 mV,
  a huge range. A second 100k pot, also from ground to −12 V, goes in through 1M where the others
  have 100k, with its own 10k thermistor: a division of about 500. (The captions give 0 to
  "minus 4" millivolts; 12 V over 500 is 24 mV.) It also makes it easier to detune one VCO
  against others.
- [V] The pulse needs no new chip: the 40106 has five spare inverters. Its output goes off when
  its input passes the upper threshold and on again under the lower one, a pulse out of phase
  with the sawtooth, which doesn't matter. The width depends on the sawtooth's size, which has
  to reach the upper threshold, about 7 V, but after the 1 µF it is only about ±1.2 V. So one of
  the TL074's three spare op amps amplifies it.
- [V] Op amps in his water pipes: two pressure sensors that let no water in, and a pump that
  pushes out their difference times a huge gain, as far as its supply allows, which is where it
  ends up 99.9% of the time. As a buffer, its output on its − input, it settles a hair under the
  input: a unity-gain amplifier, one that doesn't amplify. With a divider from the output to the
  − input it has to work harder: two 100k double the input, and any divider gives a gain above 1,
  since a divider only reduces.
- [V] The non-inverting amplifier: the sawtooth, picked up right after the 1 µF, on the + input,
  100k from the output to the − input, and a 100k pot from there to ground. Turning the pot, the
  sawtooth grows and shrinks, clips at what he calls the ±12 V lines, and becomes a 50% square
  wave. For a fixed 50% square alone, the Schmitt trigger could be skipped.
- [V] Into the 40106: a wire would probably fry it, since the wave's lower half is below 0 V and
  its inputs must stay between 0 and 12 V. A 1N4148 pointing at the inverter is a one-way street,
  but while it blocks the input is undefined and picks up noise, so 100k pulls it down.
- [V] His test: with the gain fully cranked, a 50% square. Turning the pot widens the on phase
  until, after about a third of its range, it takes over; the other two thirds are useless. By
  trial and error he puts 200k in place of the 100k from the output to the − input, which should
  move evenly from 50 to 100% over one turn, and it seems to work nicely.
- [V] The outputs: AC coupling as in part 1, 1 µF and 100k after the inverter. Modules often
  expect 10 V peak to peak, ±5 V, and the square is ±6 V, so 20k and 100k after the capacitor
  take roughly 17% off: he puts in "the cap and resistor", then adds the divider, so the 100k
  after the capacitor and the divider's are two. The sawtooth, 2.4 V peak to peak, needs a gain a
  bit over four: "one of the remaining" op amps with 100k and "32k", which the description
  corrects to 33k, its + input on the sawtooth once part 2's divider is out. Which op amp, he
  doesn't say, for this one or the pulse's. With the pull-down that makes four 100k, where the
  parts list has three.
- [V] Through a jack, the square at 50% is very round and heavy, and more and more nasal as the
  pot turns. Next comes the module: panel, stripboard and soldering, with full schematics on his
  Patreon.
- [I] The thermistors in the model (B 3950 K assumed). The follower already cancels the drift of
  the transistors' I_S (part 3), and what is left is V_T, about 0.34% a degree. A 10k NTC with the
  100k lets an input about 0.39% further through each degree (about 0.34% for the offset, through
  the pot's wiper too), close to what V_T needs, so the notes keep their spacing.
  - Added to part 3's tuning, they put 0 V about 2.2 semitones sharp and leave 0.91 octaves a
    volt. Retuned (the trimmer about 531 Ω instead of 346 Ω), 0 to 5 V are within 4 cents.
  - At 30 °C, the arpeggio from C3 to C5 sits 8 to 9 cents sharp throughout, nearly an offset that
    the fine knob puts back; part 3's circuit, tuned the same, runs from +29 to −11 cents. At
    20 °C the thermistors' notes run from −2 to −15 cents: the correction isn't symmetric, since an
    NTC is exponential in 1/T where V_T is linear in T.
  - His finger test warms the transistors and not the thermistors, so it shows part 3's circuit:
    with both transistors equally warm, the note at V_mix = 0 (about F4) stays put, those below it
    go sharp and those above flat. The dip he hears fits the BC558C warming first.
  - With the offset on the negative side, warmer thermistors let the BC558C's base further down
    for the notes below about C♯4, not up. From there to F4 it rises a little: the offset's path
    has the pot's wiper in it too, so its share grows a little slower than the CV's. What they do
    is scale every input's share, as V_T needs.
- [I] The pulse's range in the model. After the 1 µF, the sawtooth's top is about 1.29 V at C3
  while part 2's two 10k still load it (its coupling's time constant about 17 ms instead of 0.1 s),
  and higher at low notes, 1.55 V at C1. A pulse needs that top, amplified, to reach the upper
  threshold (TI's typical 7.06 V on 12 V) plus the diode's drop: a gain over about 5.9, so the pot
  under 20.6k with the 100k (21% of its turn) and 41.2k with the 200k. A 40106 at the low end of
  TI's range (its upper threshold about 5.5 V on 12 V) gives 27.5k and 55.1k, and at C1 about 35k
  and 70k: a third, then two thirds. The whole turn would need a gain of 3 to be enough, an upper
  threshold under about 3.4 V, below TI's range. The top is the settled wave's, in closed form,
  with the core's jump taken as instant: it falls at the core's rate towards −S τ (S the jump over
  the period) and the jump puts back what the period took off, so it is ΔV ÷ (1 − e^(−T/τ)) − S τ.
- [I] The TL074 on ±12 V, from TI's datasheet (SLOS080W): the original swings to about ±13.5 V on
  ±15 V, so about 1.5 V short of each rail; the newer TL074H gets within about 0.1 V. Its output
  is short-circuit protected, about 26 mA for the H, more than the 10 mA a 40106 input is rated
  for, and the 40106's inputs are rated from −0.5 V to its supply plus 0.5 V (SCHS097F).
- [I] In the model, at C3, the square out at 50% is about ±5.2 V, and the saw out about +4.9 and
  −4.8 V.
- [D] "How to build a DIY 3X VCO module from scratch" (OCAb2UoSPs0, 16:17, 2020-09-28) comes
  next: three VCOs on stripboard, behind a panel. It opens his "DIY VCO Series" playlist's videos
  after part 4 (below).
- [Lab] The lab (`sawtooth-to-square`) has six steps:
  - the thermistors, with the room's temperature, fingers on both transistors, and a sequencer
    playing a major arpeggio beside part 3's circuit tuned the same;
  - the fine-tune knob, with both knobs' whole turns;
  - the amplifier, its pot and a scope, at C3;
  - into the 40106: a wire, the diode alone, or the diode and the pull-down;
  - the 200k, with a chart of the pulse width over the pot's turn;
  - 10 V peak to peak: the square and saw outputs with the sequencer.

  Its estimates, said on the page: the thermistors' B value of 3950 K, common for 10k ones (the
  video gives none); the TL074's swing, 1.5 V short of the rails; the 1N4148's 0.5 V with the
  pull-down; the 40106's protection diode at 0.7 V; TI's typical thresholds; the floating input,
  made up (so Listen stays quiet there); the note C3 from the third step to the fifth; which
  spare op amps the amplifiers use (the pulse's pins 5 to 7, the saw's 8 to 10); what warms: the
  transistors and the thermistors only, the thermistors with the room alone, out of a finger's
  reach (the video doesn't say where they sit); the finger's 32 °C and 6 s, as in parts 2 and 3;
  the sequence, the lab's own; and the core's jump, instant.

## DIY VCO Series (playlist PLHeL0JWdJLvTuGCyC3qvx0RM39YvopVQN)

| # | Video | id | Length | Date |
|---|---|---|---|---|
| 1-4 | DIY VCO Parts 1-4, as in For Beginners (above) | | | |
| 5 | How to build a DIY 3X VCO module from scratch | OCAb2UoSPs0 | 16:17 | 2020-09-28 |
| 6 | DIY SYNTH Quick Tip: Sawtooth-to-Triangle Converter | 4r3TTaUKNe0 | 15:41 | 2021-01-18 |
| 7 | Adding voltage controlled PWM to my VCO | FUz3gFAh9pY | 17:25 | 2021-04-18 |
| 8 | Introducing the mki x es.edu DIY VCO kit | 8JuYLLpZzBs | 7:23 | 2022-01-09 |

The site's group for it lists 5 to 8, numbered as in the playlist (`first` in `chapters.ts`),
since parts 1-4 are For Beginners' already. The kit video's length is from its watch page (443
s); the playlist shows 7:24.

### DIY SYNTH Quick Tip: Sawtooth-to-Triangle Converter

- [D] Parts: a TL074, two 1 µF foil or ceramic capacitors, two 200k, a 20k, two 10k ("matched!")
  and two 1N4148.
- [D] Chapters: intro, inverting buffers (1:26), spliced triangles (5:00), resistor values and
  imperfections (8:10), AC coupling input and output (10:27), sound demo and outro (14:02).
- [D] The first of a new series of shorter, less basic videos on smaller or auxiliary circuit
  ideas: a converter to use with his SHAPES VCO, for example, for another output wave. For
  refreshers it links VCO part 1, its AC coupling (at 20:48), and VCF part 2's op amps (at 2:28).
- [D] A correction: he cut corners explaining the output's AC coupling. The 20k goes to −12 V
  rather than ground also because of the diodes' drop: they conduct only with about 0.6 V across
  them, so with the point after them at 0 V at its lowest they cut off before the triangle reaches
  its valleys, and flatten them. With −12 V the point can go a fair bit below 0 V, and all of the
  triangle gets through.
- [S] His simulation is the same circuit with a ±5 V, 200 Hz sawtooth from a generator, but 100k
  after the input's 1 µF instead of 200k, and 10k to −12 V instead of 20k; the output's 1 µF and
  200k as built. Its op amps clip at ±15 V.
- [V] The captions are YouTube's auto-generated ones taken for Dutch, so the English comes out
  garbled; these notes piece them together with the description and what's on screen.
- [V] He suggests watching the VCO series first for the basics. The aim: a triangle as perfectly
  symmetrical as it can be.
- [V] The inverting buffer: part 1's buffer has the signal on its + input. Turned round, the +
  input goes to ground and the signal comes through 10k to the − input, with another 10k from the
  output back to it. The action is at the − input, which the op amp holds where its + input is: 5
  V in pushes current in through the first 10k, and the output has to take it away through the
  second, at −5 V if the two are identical. Within the supply's range, of course.
- [V] Splicing: the sawtooth and its inverted copy share their start and end points and cross
  precisely at 0 V halfway, so there are at least three ways to splice a triangle out of them. He
  takes the upper halves, with a 1N4148 from each op amp's output to one point: diodes conduct
  one way only, so whichever output is higher gets through.
- [V] On the scope the halves come up at slightly different angles, with a step at the peak: the
  devil is in the details. The two 10k have to be the same, and his bag of them (SEGOR) says 1%:
  two picked at random can be 2% apart. For most circuits that's negligible; here a matched pair
  is crucial. Mismatched, the inverted copy comes out bigger or smaller than the sawtooth, which
  adds overtones, never great in his opinion. He tests a bunch with a multimeter and keeps two
  that seem a good fit; a trimmer would let it be set exactly.
- [V] AC coupling: the converter needs the sawtooth centred on 0 V, since an offset moves the
  inverted copy the other way. So the input is AC coupled, as his modules' inputs and outputs
  usually are, with 1 µF and 200k. But the converter draws a fair amount of current, which would
  mess with the high-pass, so another of the TL074's op amps buffers it.
- [V] The triangle sits above 0 V, so the output wants AC coupling too, but the usual 1 µF and 200k
  give nothing: a high-pass needs its capacitor to charge and discharge, and the diodes let
  current flow one way only, so it fills up and stays there. A resistor from the point to the
  negative rail lets it discharge: 20k to −12 V. Why not to ground, he answers loosely (the
  correction above).
- [V] The sound demo plays the triangle from a sequence of notes, with the scope following it.
- [I] The model (`sawToTriangle` in `src/labs/synth/_analog.ts`) works out one settled period of
  every node, the point between the diodes by Newton's method:
  - the 1N4148 by the Shockley law, with the common SPICE model's I_S (2.52 nA) and n (1.752):
    0.58 V at a milliamp, 0.48 V at a tenth of one;
  - into the scope's 1M alone, the triangle peaks at 4.66 V (a drop of 0.34 V at about 5 µA), with
    its valleys at 0 V halfway; the drop shrinking near 0 V brings in even harmonics at about −36
    dB;
  - a mismatch gives the inverter a gain of their ratio and a step at the peak of about 4.7 V times
    the mismatch, 0.1 V for 2%;
  - an offset moves the crossing to (amplitude + offset) ÷ (2 × amplitude) of the period, 60% for 1
    V, and leaves a step of about twice the offset;
  - the input's 1 µF and 200k (0.2 s) bend the ramp, its top a little higher than its bottom is
    low: a step of its own at the peak of about the jump × T ÷ 6τ, 0.042 V at 200 Hz, 0.064 V at
    C3, 0.127 V at C2. A mismatch with the feedback 10k the smaller adds to it, the other way
    round takes from it. Without the buffer the inverter's 10k, its − input at 0 V, would sit
    across the 200k: 9.5 ms instead of 200 ms;
  - with nothing from the point, the output's 1 µF charges to about 4.72 V, and what comes out
    is blips of 0.07 V at the peaks;
  - 20k to ground: the diodes are off about 9% of each period, the valleys flat at 0.19 V (the
    20k and 200k dividing what the 1 µF holds, 2.07 V), the output +2.43 to −1.89 V, its second
    harmonic at −27 dB;
  - 20k to −12 V: the point from −0.52 to +4.45 V, the output +2.51 to −2.46 V, its odd harmonics
    at 1/n² (−19, −28, −34 and −38 dB for the 3rd to the 9th) and its second at −46 dB at 200 Hz
    from the input's bend (−38 dB with the pair 2% apart).
- [Lab] The lab (`sawtooth-to-triangle`) has six steps:
  - inverting buffers: part 1's buffer or the inverting one, with the sawtooth or a steady
    voltage;
  - spliced triangles: the converter, each diode in or out;
  - a matched pair: the two 10k on sliders within 1%, two at random or a matched pair, and a
    close-up of the peak;
  - AC coupling the input: an offset, and the 1 µF, 200k and buffer;
  - AC coupling the output: nothing, 20k to ground or 20k to −12 V from the point;
  - the sound: the finished converter with a sequencer playing part 4's arpeggio, the triangle
    or the sawtooth to listen to, the pair matched or 2% apart, and a chart of the harmonics.

  Its estimates, said on the page: the 1N4148's model; the scope's 1M as the point's only load
  in the second step to the fourth; the TL074 on ±12 V, clipping 1.5 V short of the rails; which
  op amps buffer and invert (his breadboard is filmed upside down); the sawtooth, his
  simulation's ±5 V at 200 Hz, instant at its jump; the output's 1 µF holding its charge over a
  period; and the sequence, the lab's own.

### Adding voltage controlled PWM to my VCO

- [D] Parts: two 100k, two 68k, a 14k, a 1k, a 250k linear mono pot and a TL074. The offset pot
  isn't listed: [I] part 4's 100k pulse-width pot, set up again as a divider.
- [D] Chapters: intro and sound demo, the trouble with pulse waves and AC coupling (1:02),
  comparators as saw-to-square converters (7:30), controlling the pulse width with external CV
  (11:10), output impedances (13:00), another sound demo and outro (14:33). Links: his Patreon,
  the Erica kit, and his simulation.
- [S] His simulation is the finished circuit, on a 5 µs step:
  - a sawtooth of ±1.5 V at 300 Hz from a generator (CircuitJS's, rising), on the comparator's +
    input, the op amp clipping at ±12 V;
  - on its − input: a 100k pot ("OFFSET", at 53% from its +12 V end: 47% of the lab's turn, its
    wiper at −0.71 V with nothing on it, which gives the − input's saved 0.0038 V) across ±12 V,
    its wiper through 100k, with 14k to ground;
  - a CV slider from −7 to +7 V (at 0.42 V) through a 250k pot as a variable resistor ("CV INT",
    at 0.5%: 1.25k) and 68k to the same − input;
  - the output through 100k, with 68k to ground, into a follower (its − input on its output), then
    1k to the output. At the moment it was saved the follower stood at −4.857 V, −12 V divided.
- [V] The intro: most of his VCO works, but he missed voltage control of the pulse's width, which
  only a knob set. After a demo of the result, the video adds it, fixing a bug on the way.
- [V] The bug: built as in part 4, the square out on a scope is centred on 0 V at 50%, but as the
  width grows the whole wave slides down, its centre reaching about −4.5 V at the widest: an
  offset too big to live with, audible as distortion. The AC coupling (1 µF, then 100k to ground)
  is there; it just doesn't suit every wave.
- [V] His water analogy, with three examples: the capacitor a stretchy membrane that can move a lot
  of water, the large resistor a thin pipe to ground that lets little through.
  - A 50% square with no offset, rising to 5 V: the step pushes through the membrane, and during
    the high phase a little leaks away through the pipe, so the voltage sags; swinging low it lands
    a little below −5 V and recovers slightly; it stays centred on 0 V, almost unchanged.
  - The same square raised, both phases positive: the voltage sags during both, so its centre
    sinks period after period; once its low phase is below 0 V the sinking slows, and it settles
    when the centre is at 0 V, where what the high phase loses the low phase gains back, the two
    being equally long.
  - A 5% pulse raised: it sinks too, but once its low phase is a little below 0 V the long low
    phase gains back what the short high phase loses, and it stays far off centre, as on his
    scope. AC coupling only centres a symmetrical wave, which is why it works for sawtooth, sine
    and triangle waves.
- [V] The comparator: part 4's way was roundabout, an op amp to amplify the sawtooth and then a
  Schmitt trigger inverter, whose pulse sat 6 V up. A comparator needs one op amp and no feedback,
  the signal on its + input and a threshold on its − input: it amplifies the difference so much
  that its output is nearly always at ±12 V here, high while the sawtooth is above the threshold
  and low while below. So the threshold also sets the width; his graphs show a sawtooth against
  several thresholds.
- [V] On the breadboard: the sawtooth core, a 100k pot as a divider for the threshold. Centred it
  gives nearly 50%, but most of its turn does nothing: the sawtooth swings only about ±1.5 V, and
  past that the output stays high or low and the oscillation stops. The threshold has to stay
  inside that swing: a 100k in place of the jumper and 14k to ground scale ±12 V to about ±1.5 V,
  and most of the turn then works.
- [V] External CV: mixed in through another resistor, whose value sets how much of the mix is its
  own. Two questions decide it: the range coming in, and whether the PWM should go through zero
  (the CV able to stop the pulse). His LFOs give +7 to −7 V and he wants it through zero; trial and
  error, rather than a calculation, gave 68k, with a 250k pot in series to set how strongly the CV
  acts, through a jack socket. With the intensity up, it goes through zero on his scope.
- [V] Output impedance: the comparator swings around 24 V peak to peak where 10 is wanted. Part 4's
  plain divider works, but left the output 20k behind the jack, easily dragged down by a load;
  professional modules have about 1k. A divider of smaller resistors would waste current to
  ground, almost 10 mA by his count. So a large divider buffered by an op amp, with 1k between it
  and the jack; the saw out's 20k on the schematic becomes 1k too. Built: the comparator's output
  through 100k with 68k to ground into another buffer, 1k to a new jack.
- [V] The demo: a slow LFO sounds like several detuned oscillators, through zero it becomes a
  rhythm, and an audio-rate oscillator on the CV gives harsh, strange tones. The comparator frees a
  Schmitt trigger inverter, so one 40106 could in theory run six VCOs, more than anyone needs.
- [I] The model (`src/labs/synth/_analog.ts`):
  - part 4's square out, its pulse 0 or 12 V: the 1 µF keeps its average at 0 V, so its middle is
    (6 − 12d) V, five sixths of it after the 20k and 100k: 0 V at 50%, −4.5 V at 95%. Part 4's model
    pulse stops at about 84% (a middle of −3.4 V), so the lab's first step sets the width directly;
  - AC coupling from rest (`coupledFromRest`), at 40 Hz through 1 µF and 100k (0.1 s): ±5 V settles
    at ±5.31 V (its first period's middle −0.29 V); the square from +2 to +12 V starts with a middle
    of about 6.3 V and comes down to 0 V; the 5% pulse settles at +9.56 and −0.56 V, its middle +4.5
    V;
  - the comparator's width (`comparatorWidth`): the sawtooth after part 1's 1 µF (0.1 s) falls from
    its top as −Sτ + (top + Sτ)e^(−t/τ), S the jump over the period, and the width is the time it
    takes to reach the threshold. At C3 it swings +1.22 to −1.18 V with TI's typical thresholds,
    where his scope shows about ±1.5 V;
  - the threshold (`thresholdOf`) by Millman's theorem from its feeds: the wiper behind the halves
    of its pot and the 100k, the 14k to 0 V, and the CV through 68k and the intensity pot. The bare
    pot gives a pulse over 10% of its turn, the jump over 24 V; 100k and 14k take ±12 V to ±1.474 V,
    a pulse over 86% of it (from 7% to 93%), and with the 68k beside the 14k the ends are ±1.248 V;
  - the CV's share: 0.156 with the intensity up (±1.09 V of the LFO's ±7 V), 0.038 at 250k (±0.27
    V). Centred and turned up, a ±7 V triangle takes the width from 4.9% to 96.1%, just short of
    zero. With the offset pot's wiper below −1.07 V or above +1.43 V (with nothing on it: 4.5% of
    its turn down, 6% up, the sawtooth sitting a little above centre) it goes through on that side;
  - the width over the LFO's cycle, the threshold held still at each point (`heldStill`), exact at
    the edges: a triangle spends as long at each level as at any other, so the share of its cycle
    past the sawtooth's top or bottom is a straight line in the threshold. It is exact for a moving
    threshold too while the threshold falls no faster than the sawtooth does at the end of each
    period, where it falls most slowly (`crossesOnce`): then the two cross once a period, as the
    sawtooth falls, and each period's pulse is as wide as the threshold held still where they
    cross would make it. At C3 that holds for an LFO up to 69 Hz with the intensity up, 283 Hz with
    the intensity pot at 250k. Faster, the readouts follow the threshold through each period
    (`comparatorPeriods`), each period exactly: cut where the triangle turns and where the
    threshold starts to fall faster than the sawtooth, so that they cross at most once between
    cuts. The periods start all over the LFO's cycle, 256 places in it with each share's edges
    found between them by halving, stretches narrower than the places sought where the margin
    dips towards 0, and the narrowest and widest sought out around the places. At C3, centred and
    turned up, a 110 Hz LFO gives 24% to 77% of each period, more than one pulse in 27% of them
    (the width held still would say 5% to 96%), and with the offset pot a quarter of the way up
    every period keeps a pulse, though the threshold is past the sawtooth a fifth of the time;
  - the output stage (`outStage`), from the TL074's ±10.5 V: 4.25 V open. 100k and 68k alone are
    40.5k behind and lose 29% into a module's 100k; 1k and 680 Ω take 5.46 mA, a load so heavy that
    the TL074 reaches only ±9.17 V into it (`swingInto`: TI's typical curve of its swing against
    the load, SLOS080W figure 5-43, has 13.5 V into 10k and about 12 V into 2k on ±15 V, as if 1.06
    V short of the rail behind 323 Ω), 3.71 V open. With the 323 Ω behind the 1k they are 449 Ω
    behind, not the 405 Ω of the two alone (`outZ`), and lose 0.4% into 100k, 4.3% into 10k. The
    buffer and 1k lose 1%, the divider taking 63 µA. From ±12 V his divider gives ±4.86 V.
- [I] The sound (`PwmTone` in `src/labs/synth/_sound.ts`): the browser's sawtooth less a copy of it
  delayed by the width, which is a pulse as free of aliasing as the sawtooth. The threshold, a
  steady voltage and a triangle LFO, goes through a curve of the model's width, so the delay
  follows it sample by sample; a gate shuts the pulse off where the output is stuck, since a
  delay of a whole period leaves the sawtooth's jump behind, smeared by the delay's interpolation.
  Rendered offline, its widths match the model's.
- [Lab] The lab (`voltage-controlled-pwm`) has seven steps:
  - the trouble with pulse waves: part 4's square out, the 40106's width on a slider;
  - AC coupling, cycle by cycle: his three examples from the moment each is connected;
  - a comparator: the offset pot through a jumper, with a chart of the width over its turn;
  - 100k and 14k: the same chart, with the jumper's dashed;
  - external CV: an LFO or a steady voltage through the intensity pot and 68k, with charts of the
    width over the LFO's cycle or the CV, and whether it goes through zero;
  - output impedances: the divider alone, a low-value one, or his buffer and 1k, into a scope, a
    module's input, three inputs or 10k;
  - the sound: the finished circuit with a sequencer playing part 4's arpeggio and an LFO on the
    CV, with his three sounds as presets.

  Its estimates, said on the page: the sawtooth, the core's with TI's typical thresholds; the
  TL074's swing for both op amps, and less into the low-value divider; the offset pot, presumably
  part 4's; the first step's width set directly; the three examples at 40 Hz, ±5 V and 7 V up; the
  LFO, a triangle with no resistance of its own; 100k and 68k alone (his divider without his
  buffer) and the low-value divider, the lab's own comparisons, and the loads; the note, C3, until
  the last step; the sequence; and his three sounds' settings, which he doesn't give: a slow LFO at
  0.4 Hz with the intensity pot at 50k, through zero at 2 Hz with the intensity up and the offset
  pot a quarter of the way up (no pulse over 20% of each cycle at C3), and the audio-rate
  oscillator, a triangle at 110 Hz.
- [Lab] The site's group lists all four videos after part 4. The tip and the PWM video have their
  labs, and the module video and the kit's introduction stay listed without.

## The other series

Main parts from his bills of materials [D]. The kit videos ("Introducing the mki x es.edu DIY …
kit", 3-8 minutes each) are left out, and so is the rest of the DIY VCO series, above.

| Series | Videos (id, length, date) | Parts |
|---|---|---|
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
  - It's the smallest real step, and it covers the "For Beginners" playlist's first two videos:
    their labs are built this way.
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
  `src/app/chapters.ts`), but by someone else. It went in the first of two ways: `MoreGroup` has
  a `by`, and `OTHER_GROUPS` holds his "For Beginners" playlist, numbered: the guide, then VCO
  parts 1-4. (The other way was a list beside `PROJECTS`.) His "DIY VCO Series" playlist follows
  it, numbered on from 5 as in the playlist. The labs' previous and next links run through both
  groups, and the home page's card lists the labs of both.
- [Lab] Labs, in order:
  - "Using a breadboard": the guide's four circuits;
  - "The oscillator core" (VCO part 1);
  - "The exponential converter" (part 2);
  - "Tuning the VCO" (part 3);
  - "Sawtooth to square" (part 4);
  - "Sawtooth to triangle" (the quick tip);
  - "Voltage-controlled PWM" (adding it to his VCO).

  The embeds and links work as Ben's do (youtube-nocookie), with the playlist or his channel as
  the source.
- [Lab] His designs as drawn: his values, and his part names where his labels give them, with his
  later corrections (part 2's) shown, not quietly applied.

## Parts these use that the catalog lacks

| Part | Used in | Nearest part in the catalog |
|---|---|---|
| TL072, TL074 op amps | nearly every video, the breadboard guide | the TL074 in `ANALOG_CHIPS`: drawn and wired, not simulated |
| CD40106 hex Schmitt inverter | VCO core and part 4, arpeggiator 2, hi-hat | 74LS04 (no hysteresis) |
| BC548, BC558, 2N3904 transistors | VCO 2-3, VCA, sequencer, wavefolder, drums | — |
| 1N4148 diodes | VCO core and part 4, the triangle tip, envelope, sequencer, mixer | — |
| NTC thermistors | VCO 4 | — |
| CD4017 decade counter | 5-step sequencer | 74LS90 (counts in BCD, not one of ten) |
| CD4040 12-bit counter | arpeggiator 1 | 74LS161 (4 bits) |
| CD4081 AND, CD4070 XOR | arpeggiator 2 | 74LS08, 74LS86 |
| CD4015 dual 4-bit shift register | arpeggiator 3 | 74165 (8-bit parallel-in) |
| TLC7524 DAC, ADC0820 | arpeggiator 1 and 3 | — |
| 7805, 7812, 7912 regulators | arpeggiator 3, the dual supply | — (the clock labs model a 7805) |
| LDR and LED (vactrol) | VCF 3 | — |
| Jack sockets, 9 V batteries | everything | — (the guide's lab draws them beside its board) |
| MN3205 / V3205 BBD | delay | — |
| Capacitors as timing parts | everything | — (the sandbox's capacitors only make edge pulses) |

_Sources: his channel and its playlists on YouTube (the watch pages' details and descriptions; the
transcripts of the guide, VCO parts 1-4, the triangle tip and the PWM video); his CircuitJS links
(tinyurl.com, decoded); the 1N4148's common SPICE model (D1N4148); Erica Synths' kit pages; CDM,
3 January 2022; the Mixer kit's manual as rendered on manualsdir.com; onsemi's BC556B/BC557/BC558B
datasheet (Rev. 3, 2007) and Fairchild's BC556-BC560 (Rev. 1.7, 2016); TI's CD40106B (SCHS097F)
and TL07xx (SLOS080W, its table and its typical curves) datasheets; the parts in
src/breadboard/catalog.ts._
