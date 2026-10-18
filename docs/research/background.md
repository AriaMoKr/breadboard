# Ben's background videos on transistors and gates (research)

eater.net/8bit points readers who are unsure how transistors and logic gates work to three 2015
videos: How semiconductors work, How a transistor works, and Making logic gates from transistors.
They come before the SR latch, the playlist's first circuit. The lab `#/lab/transistor-gates`
(`src/labs/basics/`) follows these notes, which summarise the videos' auto-generated captions.

## How semiconductors work (33vbFFFn04k, 15:51, 2015-03-18)

- Silicon has four outer electrons, all held in bonds with its neighbours, so pure silicon doesn't
  conduct at normal temperatures.
- Doping. Phosphorus has five outer electrons, so one is free to wander: N-type silicon, with
  negative charge carriers. Boron has three, which leaves holes for nearby electrons to jump into,
  so the hole seems to move: P-type, with positive carriers. Neither is charged overall, because the
  extra electron (or the missing one) comes with an extra (or missing) proton.
- The PN junction. Near the boundary, electrons from the N side fill holes on the P side. That leaves
  a thin depletion region with no charge carriers: slightly positive on the N side, slightly negative
  on the P side, and it insulates.
- Forward (+ on P): beyond about 0.6 V the depletion region collapses and current flows. Reverse: the
  battery pulls carriers away, the region widens and nothing flows. That is a diode.
- The diode symbol's arrow follows conventional current (+ to −), although electrons flow the other
  way. Either convention works if it is used consistently.

## How a transistor works (DXvAlwMAxiA, 11:23, 2015-03-19)

- An NPN bipolar junction transistor has three layers: the emitter (N), the base (P) and the
  collector (N).
- It is a current-controlled switch, and can also be an amplifier. A small current from base to
  emitter (conventional) lets a large current flow from collector to emitter.
- With a battery only from emitter to collector, the base-collector junction blocks.
- Forward-bias the base-emitter junction (about 0.6-0.7 V) and its depletion region collapses. The
  heavily doped emitter floods the base with electrons. The base is very thin, so most of them (about
  99 %) are pulled across by the base-collector junction's positive charge and carry on into the
  collector.

## Making logic gates from transistors (sTu3LwpF6XI, 13:02, 2015-03-22)

- Each input is a push button that drives current through a resistor into a transistor's base. The
  output is an LED with a resistor from +5 V.
- Buffer: the LED in series with the transistor.
- Inverter: the LED from the node under the resistor to ground, with the transistor across it. When
  the transistor is on, it pulls the node to ground and the LED goes out.
- AND: two transistors in series. OR: two transistors in parallel.
- XOR, with five transistors. The OR pair reaches ground only through a third transistor. That one is
  normally on, because its base is pulled up through a resistor. Two more transistors in series,
  driven by A and B, ground its base when both inputs are on, and the LED goes out.
- NAND, NOR and XNOR are AND, OR and XOR with the output inverted, which the bubble on their symbols
  shows.

[Lab] The lab draws the carriers and the depletion region as pictures, not to scale. Ben gives no
resistor values in the gates video, so the lab shows none.

_Sources: https://eater.net/8bit; the three YouTube videos above (captions)._
