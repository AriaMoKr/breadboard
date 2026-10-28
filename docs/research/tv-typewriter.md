# Don Lancaster's TV Typewriter (research)

The TV Typewriter (TVT) put 16 lines of 32 characters on an unmodified TV set. It was one of the
first home-built computer terminals, from Radio-Electronics, September 1973. It is a breadboard-era
digital design like Ben's computer: mostly TTL counters and gates, with a few MOS memory and
character-generator chips. These notes list what archive.org has on it and what the simulator would
need to run it, as of 2026-10-27. Nothing in the simulator follows them yet.

Labels: [R] read in the scan's OCR text (summarised here, not quoted). [N] part numbers counted in
the OCR text, not read in context. [I] inferred or recalled, not checked. [Lab] an idea for the
simulator.

## Where to find it

- The construction story, free in Don Lancaster's own collection:
  - https://archive.org/details/donlancaster_tv_typewriter_9_73
  - the same text again: https://archive.org/details/donlancaster_bdtvtype
  - another scan of it: https://archive.org/details/donlancaster_tvt02

  [R] Its pages are numbered 2-12 with the magazine's name, and it has every schematic, the parts
  lists, the waveforms, and the foil patterns and parts placement for the boards. [I] So it looks
  like the full construction booklet the article offered, rather than the magazine's own pages
  (43-5+). It also has the parts list of the improved ASCII encoder from February 1974, so this
  copy would be a later printing.
- The magazine issue it first appeared in, lending-only: https://archive.org/details/radioelectronics44unse_7
- *TV Typewriter Cookbook* (Howard W. Sams, 1976), free in the same collection:
  https://archive.org/details/donlancaster_tvtcb. A lending copy is
  https://archive.org/details/tvtypewritercook0000lanc.
- A list of Lancaster's articles, with magazines, dates and pages:
  https://archive.org/details/donlancaster_tempmbib.
- [R] The Computer Museum's 1986 report lists the TVT-1 prototype as Lancaster's gift:
  https://archive.org/details/computermuseufal1986comp.

## The 1973 design

- [R] What it shows:
  - 512 characters, as 16 lines of 32. A second memory page makes 1024.
  - Upper-case ASCII: capitals, numerals and most punctuation.
  - Its own RF modulator clips onto a TV's antenna terminals (channels 2-5). There is also a
    direct video output.
- [R] Input:
  - Six ASCII bits in parallel (the full code also works), entered by grounding a "key pressed"
    line. The input is debounced on the board, and characters can come up to 30 a second.
  - Any CTRL key gives a combined carriage return and line feed.
  - The keyboard can be the homemade one from February 1973, or six switches and a pushbutton.
- [R] Editing:
  - A winking cursor shows where the next character goes. It can be blanked, or moved in any
    direction without changing the text.
  - The screen wraps at the end of each line, and at the bottom it goes back to the top and writes
    over the old text.
  - Switches for REPEAT, KEEP-CHANGE (memory protect), HOME or erase, page A or B, and a
    line-scan mode for calculator use.
- [R] Timing:
  - A 4.561920 MHz crystal gives the dot clock, which a TTL divider brings down to a 15.840 kHz
    line rate (a 63 µs line) and 60 Hz frames.
  - The display is not interlaced, but the timing chain is split so interlace can be added for
    video titling.
- [R] Construction:
  - A mainframe (mother board) carries the power supply, the RF modulator and the control
    switches. The timing board, the cursor board and one or two memory boards stack onto it.
  - 33 ICs, 8 of them MOS LSI.
  - Lancaster calls it no first project, but notes that once the early stages work, the TV itself
    helps with debugging.
- [R] Memory board:
  - Six 2524 512-bit recirculating MOS shift registers, one per bit, hold 512 six-bit characters.
    A 7406 hex driver and two 2N5139 transistors go with them.
  - Page A also carries the shared output section, which a page-B board borrows over the bus:
    - a 2518 hex 32-bit recirculating register, a one-line memory that gives each row of
      characters back for each of its TV scans;
    - a 2513 character generator;
    - a 74165 parallel-in, serial-out register that shifts the dots out as video;
    - a 7401 open-collector NAND.

  Lancaster calls this bus organisation, and only one source may be enabled on the bus at a time.
- [R] Timing board:
  - Parts: an MC4024 dual astable (the crystal oscillator), four 8288 divide-by-12 counters, a 7473,
    two 7432s, two 7402s and two 7410s.
  - Its "main" timing is the divider chain's continuous outputs. Its "derived" timing combines them
    into composite sync and a blinker for the cursor wink, flashing and repeat.
- [R] Cursor board:
  - Parts: a 7408, two 74197 divide-by-16 counters (a 74177, 8281 or 8291 will also do), a 7473, two
    7402s, a 7474, a 7400 and a 555.
  - It keeps the next character position, winks the cursor and controls character entry. It also
    holds the input conditioner, the debouncer and the CTRL detector.
- [R] Figures: 2, the character generator; 3, the mainframe and power supply; 4, a page A or page B
  memory; 5, page A's character generator circuitry; 6, the main timing chain; 7, the derived
  timing; 8, the cursor's input conditioning; 9, the cursor board's position counter. There is
  also a page of key waveforms, and the full-size foil patterns and parts placement (12-15 and on).

## Articles that go with it (Radio-Electronics, all free in Lancaster's collection)

| Article | Issue | archive.org |
|---|---|---|
| Low Cost Keyboards | February 1973, pp. 54-7 | https://archive.org/details/donlancaster_low_cost_keyboard_2_73 |
| Build an ASCII Keyboard Encoder | April 1973, pp. 55-9 | https://archive.org/details/donlancaster_ascii_encoder_4_73 |
| Build Improved ASCII Encoder | February 1974, pp. 59-61 | https://archive.org/details/donlancaster_improved_encoder_2_74 |
| Understanding MOS Character Generators | June 1974, pp. 48-52 | https://archive.org/details/donlancaster_mos_character_gens_6_74 |
| What's a RAM? | September 1974, pp. 50-3 | https://archive.org/details/donlancaster_random_access_memory_9_74 |
| How It Works: IC MOS Shift Registers | December 1974 | https://archive.org/details/donlancaster_mos_shift_registers_12_74 |

- [R] The improved encoder uses a Harris HD0165 encoder, a 7402, an MC789P RTL hex inverter (the
  parts list says not to substitute it) and two 7400s.
- [N] What's a RAM? names the 7489, 2102, 7474, 74174 and 74175.
- [I] The bibliography doesn't list the shift-register article, so its magazine is unchecked.

## The TVTs after it

- [R] TV Typewriter II, the SWTPC CT-1024, by Ed Colle.
  - Radio-Electronics, February 1975 (p. 27), March (p. 56) and April (p. 61); a screen-read board
    followed in September (p. 56). All lending-only:
    https://archive.org/details/radioelectronics00unse_2,
    https://archive.org/details/radioelectronics46unse_0,
    https://archive.org/details/radioelectronics46unse_1.
  - The design: 16 lines of 32 characters, with 1024 held in six 2102 static RAMs (two pages). It
    uses a 2513 character generator, a UART on the serial option, and TTL for the rest.
  - SWTPC's brochure (October 1975) says it sold the kit from February 1975 and no longer supplied
    parts for the first TVT. Free copies of the brochure:
    https://archive.org/details/ct1024terminalsystem,
    https://archive.org/details/swtpc-ct-1024-terminal-system-kit-tv-typewriter-ii. The schematic:
    https://archive.org/details/tv-typewriter-ii-schematic.
- Electronic Systems' TVT kit (Burlingame, CA), https://archive.org/details/bitsavers_electronicElectronicSystemsTVTypewriter_573841.
  [R] 1024 characters in 32 lines of 32, with 16 shown. It scrolls, and the cursor moves up, down,
  left, right and home. [N] 74193.
- TVT-6 (Popular Electronics, July 1977, pp. 47-52), https://archive.org/details/donlancaster_tvt6_video_dis12_7_77.
  [R] Video for a KIM-1 (6502) from $20-35 of parts, with the microprocessor doing most of the work
  in software: 16 lines of 32 or 64 characters, or 32 lines of 64, with editing and a cursor. *The Cheap Video
  Cookbook* (https://archive.org/details/donlancaster_cvcb1) and *Son of Cheap Video*
  (https://archive.org/details/donlancaster_socv1) carry this on.

## TV Typewriter Cookbook (1976)

- [R] Nine chapters:
  1. Basics: TV fundamentals, dot-matrix scanning, ASCII.
  2. ICs for TVTs: baud-rate generators, character generators, keyboard encoders, PROMs, RAMs and
     UARTs.
  3. Memory and bus organisation.
  4. System timing: calculations and circuits, blanking, and combining sync, position and video.
  5. Cursor and update circuits, including a microprocessor cursor and a complete cursor system.
  6. Keyboards and encoders.
  7. Serial interfaces: Teletype, cassette and modems.
  8. The television interface: direct video, RF and colour.
  9. Hard copy and colour graphics, up to a 96 × 96 full-colour display.
- [N] It names CMOS more than TTL (4013, 4011, 4096, 4066, ...), and the 2102 RAM most of all.
  It is the design guide to read alongside the 1973 schematics.

## Datasheets for its MOS parts

- [N] *Signetics MOS* (1972), https://archive.org/details/bitsavers_signeticsdcsMOS_10148267. It
  names the 2513 static character generator, the 2518/2519 hex 32-bit registers and the
  2524/2525 512-bit recirculating registers.
- A separate 2513 sheet: https://archive.org/details/Signetics-25132560-BitStaticCharacterGenerator64x8x5OCR.

## What the simulator would need

| Part | Board | In the catalog? |
|---|---|---|
| 7400, 7402, 7408, 7432, 7474 | timing, cursor, encoder | yes (74LS) |
| 555 | cursor | yes (NE555) |
| 7401 open-collector NAND | memory (page A) | no |
| 7406 open-collector hex driver | memory | no |
| 7410 triple 3-input NAND | timing | no |
| 7473 dual JK | timing, cursor | no; 74LS107 does the same job on another pinout [I] |
| 74165 parallel-in serial-out register | memory (page A) | no |
| 74197 (or 74177) divide-by-16 counter | cursor | no; 74LS161 counts the same way, with other controls |
| 8288 divide-by-12 counter (Signetics) | timing | no; 74LS92 also divides by 12 (pinout not checked [I]) |
| MC4024 dual astable | timing (crystal oscillator) | no |
| 2513 character generator, 2518 and 2524 MOS shift registers | memory | no (Signetics MOS above) |
| HD0165 encoder, MC789P RTL inverter | improved encoder | no |

- [Lab] A display part for the sandbox, a TV that draws a raster from a video net and a sync net.
  Every TVT, and any video circuit, needs one.
- [Lab] The dot clock is 4.56 MHz, about 76,000 dot clocks a frame, and gate by gate the chip-level
  engine would not keep up [I]. A slow clock with the screen drawn as it goes would still show how
  it works, much as Step does in the sandbox. Another route is to run the counters as whole
  chips.
- [Lab] A lab track could follow the boards: the timing chain (crystal, ÷12 counters, sync), then
  the character generator and dot shifter, then the recirculating memory, then the cursor.
- [I] Ben's later video card series builds VGA timing from TTL counters on breadboards, so it
  would pair well with this. That's recalled, not checked against the videos.

_Sources: the archive.org scans above (their OCR text); Lancaster's bibliography; the parts in
src/breadboard/catalog.ts._
