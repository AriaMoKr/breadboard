# Ben's digital clock (research)

Notes on Ben Eater's breadboard digital clock series (eater.net/clock), parts 1-5, the ones on
YouTube as of 2026-10-18. Three more parts are on Patreon only, and the full schematics are
"coming soon", so the hours (12- or 24-hour) aren't covered yet. The labs in `src/labs/dclock/`
and the sandbox examples "Divide by 60" and "Seconds 00-59" follow these notes.

Labels: [V] Ben's own words in the video, from YouTube's auto-generated captions (summarised here,
not quoted). [D] from the datasheets Ben links on eater.net/clock. [K] from the kit page.
[Lab] a choice or simplification made in the labs.

Parts in the kit [K]: 74LS00, 74LS74, 74LS85, 74LS86, 5× 74LS90, 4× 74LS92, 74LS283, 6× CD4511,
2× LM339, LM7805, DB105 bridge rectifier, TO-220 heat sink, 10,000 µF 16 V, 6 seven-segment
displays, 4 LEDs, 12× 0.1 µF, 16× 47 kΩ, 10× 4.7 kΩ, 5× 100 kΩ, 10× 220 Ω, 1 kΩ, 3 tact switches,
3× 1N914 diodes, and a 120 V or 240 V AC-to-AC adapter (not dual voltage). Both kits can be built as
a 12-hour (1-12) or a 24-hour (0-23) clock [V].

## 1. Let's build a digital clock! (3XDH-fZKnQk, 26:47, 2026-08-08)

- [V] The clock keeps time with the mains: 60 Hz (50 Hz in many countries), which the power company
  keeps exact over the long run because its generators have to stay in sync. When the grid runs
  slow under load, it is run slightly fast afterwards to catch up.
- [V] Power: a "12 V AC" adapter (that is RMS: the sine wave peaks near ±17 V in the simulator, about
  ±20 V on the scope). In the simulator: a half-wave rectifier passes only the positive half; a
  capacitor fills in between the peaks, with ripple; a full bridge passes both halves. With no load
  the capacitor stays perfectly smooth, 100 Ω shows some ripple, 10 Ω a lot; 1 kΩ with a big
  capacitor is fine (about 15 V DC).
- [V][D] LM7805: middle pin ground, left pin 7-35 V in, right pin 5 V out, 0.1 µF from input and
  output to ground. 10,000 µF (mind the polarity) across the rectified input. Without it the
  regulator drops out whenever the input falls below about 7 V.
- [V] The 60 Hz: one side of the AC, measured from the bridge's ground, goes from about 16 V to a diode
  drop below ground. A 47 kΩ / 47 kΩ divider halves it and 0.1 µF smooths it (he first tried 1 kΩ / 1 kΩ
  and 10 µF, which smooths it away). Another 47 kΩ / 47 kΩ divider makes a 2.5 V reference. He uses
  one resistor value throughout: the ratio is what matters, and bigger means less current.
- [V][D] LM339 quad comparator: power on pin 3, ground on pin 12; comparator 1 has its − input on
  pin 4, + on pin 5 and its output on pin 2. Signal on −, reference on +. Open-collector output, so
  a 4.7 kΩ pull-up. The unused comparators' inputs go to ground.
- [V] Problem: both inputs are a little noisy (100 mV/div), so near the crossing the output switches
  more than once. He caught it with a pulse-width trigger (low pulses under 96 µs). Every extra
  pulse would make the clock run fast.
- [V] Hysteresis: the result depends on history, like a thermostat (a minimum on-time, or more
  commonly two set points). A 100 kΩ resistor from the output (pin 2) to the + input (pin 5) moves
  the reference up while the output is high and down while it is low, so once it switches the
  noise can't switch it back. [Lab] With 47k / 47k / 100k / 4.7k that is 2.96 V and 2.02 V.

## 2. Making a square wave square (RT0mp4f4QIs, 22:19, 2026-08-22)

- [V] The comparator's duty cycle depends on the sine wave's size next to the reference. Tuning the
  reference resistor (200 kΩ, 20 kΩ, 30 kΩ instead of 47 kΩ) moves it, but any change of input
  voltage moves it again. Adapters vary: the "12 V" one gives about 15 V, the 240 V kit's "9 V" one
  about 12 V. The duty cycle doesn't matter for a clock, but he wants it predictable over a wide
  range (about 7-30 V).
- [V] Edge detector: a capacitor from comparator 1's output and a pull-up to 5 V (0.1 µF and 4.7 kΩ in
  the simulator, 0.01 µF on the board). A rising edge would spike to about 10 V, so a diode to 5 V
  clips it; a falling edge dips to 0 V and recovers. Comparator 2 (pins 6 −, 7 +, out 1) compares
  the pulse with a 2.5 V divider.
- [V] Ramp: 0.1 µF from comparator 2's output to ground with a 100 kΩ pull-up (τ = 10 ms, aiming
  for about half the 16.7 ms period). Each pulse dumps it, then it recharges. Comparator 3 (pins
  8 −, 9 +, out 14, 4.7 kΩ pull-up, 100 kΩ hysteresis) turns the ramp into the final square wave,
  the same at 9, 12 or 20 V in.
- [V] The real gain is noise immunity. One extra pulse in 10,000 is a minute a week (there are about
  10,000 minutes in a week). With a lot of noise added in the simulator, extra pulses get past the
  hysteresis, but a second pulse only restarts the ramp, so the final output stays clean.
- [Lab] The labs model the noise as band-limited noise at comparator 1's input (what Ben saw on the
  scope in part 1), because noise added to the AC is mostly filtered out by the 2.35 ms RC in the
  model. The model's duty cycles follow Ben's trends but not his exact simulator numbers. Its final
  output is about 54 % high.

## 3. Dividing a signal by counting (gnmrKDpTM7o, 14:35, 2026-09-05)

- [V] A D flip-flop with Q̅ fed back to D toggles on every rising clock edge, halving the
  frequency. A chain of them divides by 2 again and again, and the outputs read as a binary count of
  the pulses: a frequency divider and a counter are the same thing.
- [V][D] 74LS90 decade counter: a ÷2 section (CP0 → Q0) and a ÷5 section (CP1 → Q1-Q3, 0-4). With
  Q0 to CP1 it counts 0-9 in BCD. 74LS92 divide-by-12: ÷2, then ÷3 (Q1, Q2) and a last ÷2 (Q3).
  [D] Both count on the falling edge. VCC is pin 5 and GND pin 10. 74LS90 outputs: Q0 12, Q1 9,
  Q2 8, Q3 11; 74LS92: Q0 12, Q1 11, Q2 9, Q3 8. The 74LS90 has MR (pins 2, 3) and MS (set to 9,
  pins 6, 7); the 74LS92 has MR on pins 6, 7.
- [V] 60 Hz: ÷2 = 30 Hz and ÷5 = 6 Hz on a 74LS90, then ÷2 = 3 Hz and ÷3 = 1 Hz on a 74LS92 (its last
  ÷2 is unused). 50 Hz: ÷2 and ÷5 = 5 Hz, then only the ÷5 section of a second 74LS90.
- [V] Build: the 60 Hz from LM339 pin 14 into the 74LS90's CP0 (pin 14), Q0 (pin 12) to CP1 (pin 1),
  every reset pin to ground; its pin 11 (6 Hz) into the 74LS92's pin 14, again pin 12 to pin 1; 1 Hz
  out of pin 9 to an LED with 220 Ω.

## 4. Building the minutes and seconds (ZymtNiyGB_g, 27:36, 2026-10-03)

- [V] Three more breadboards, each with one power rail removed so they share rails. The 7805 gets
  very hot with the displays (over 45 °C even on a big heat sink), so it goes on a TO-220 heat sink.
- [V][D] Seconds units: a 74LS90 (1 Hz into pin 14, pin 12 to pin 1). CD4511 decoder: ~LT (pin 3) and
  ~BI (pin 4) high, LE (pin 5) low; inputs A 7, B 1, C 2, D 6 from Q0-Q3; outputs 9 e, 10 d, 11 c,
  12 b, 13 a, 14 g, 15 f. [D] It blanks for 10-15, and its 6 and 9 have no tails. The display's
  common cathode goes to ground through one 220 Ω resistor.
- [V] Seconds tens: a 74LS92 used as ÷6 (Q0-Q2 count 0-5 in binary; Q3 ignored, the decoder's D
  grounded), clocked from the units' Q3 (pin 11). It counts on the falling edge, so the tens step as
  the units go from 9 to 0, not from 7 to 8. Until now the edge hadn't mattered.
- [V] All six displays and the four colon LEDs (always on, 4.7 kΩ each) go in first to plan the
  wiring. Red gel in front of the displays is optional.
- [V] Zeroing the seconds: the reset pins of both counters are joined, held low through 220 Ω and
  pulled high by a button. He also resets the two divider counters, so the first second after the
  button is released is a whole one.
- [V] Minutes: the same two counters and decoders, clocked by the seconds tens' Q2 (falls at 59 → 00).
  Testing: feed the seconds a faster tap of the divider (6 Hz, or 60 Hz) and watch the minutes roll
  over.

## 5. Setting the time (ou2RFTK86eA, 20:22, 2026-10-18)

- [V] Setting the minutes means running them fast. An XOR gate (74LS86) passes the once-a-minute signal
  through while its other input is low. A button connects the 3 Hz tap of the divider to that other
  input, so the minutes count at 3 Hz while it is held. If the seconds roll over while you set, it
  may count one extra minute; he doesn't mind. Unused gate inputs go to ground, and 0.1 µF goes
  across each power rail.
- [V] An old button bounces: let go at 30 and it shows 35. In about 10 ms the contacts make and break
  several times, and each time can count. Testing it with a bare wire is worse still.
- [V] Debounce: the button's far side pulled up through 47 kΩ, then 47 kΩ into a comparator's −
  input with 0.1 µF to ground (4.7 ms), a 47 kΩ / 47 kΩ reference with 100 kΩ hysteresis, a
  4.7 kΩ pull-up. In the simulator the output switches once, under 10 ms late. On the board it is the
  second LM339's comparator 1 (pins 4, 5, out 2). It inverts, so with the button up it holds the
  XOR input low. He builds the same for the hours button on pins 6, 7 and 1.
- [Lab] The labs model bounce as a few contact glitches of 0.05-0.6 ms within 10 ms (25 ms for a bare
  wire), the way Ben taps the button in the simulator.

## Uncertainties

- The captions are auto-generated. A few pin numbers in them contradict each other or the datasheet:
  - Part 4 says the tens' outputs are "pins 12, 9 and 8", but the 74LS92 datasheet puts Q0-Q2 on 12,
    11 and 9.
  - Part 5 names XOR pins 10, 9, 8 and then 4, 6, 9.
  - Part 5's hours feedback resistor goes to "pin 6", but the reference input is pin 7.

  The labs follow the datasheets.
- No schematic is published yet, so the exact layout and some values (the edge detector's pull-up on
  the board, the diode type) come from the videos alone.
- The hours, and the 74LS74, 74LS85, 74LS283 and 74LS00 in the kit, belong to the parts still on
  Patreon.

_Sources: https://eater.net/clock; the five YouTube videos above (captions); datasheets
https://eater.net/datasheets/74ls90.pdf and 74ls92.pdf (one Motorola sheet for both), 74ls85.pdf, cd4511.pdf, 74ls86.pdf._
