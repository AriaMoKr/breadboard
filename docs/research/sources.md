# Other sources worth using (research)

Books, articles and datasheets on archive.org that could help the breadboard grow beyond Ben's
playlist: more parts for the catalog, circuits for the sandbox, and projects to follow next. As of
2026-10-27. Forrest Mims's books and columns are in mims.md, and the TV Typewriter in
tv-typewriter.md. Nothing in the simulator follows these yet.

Labels: [R] read in the scan's OCR text (summarised here, not quoted). [N] part numbers counted in
the OCR text, not read in context. [I] inferred or recalled, not checked. [Lab] an idea for the
simulator. "Lending" means the scan is in the Internet Archive's lending library, so it can be
borrowed but not downloaded.

## Don Lancaster's books and articles (free, in his own collection)

- *TTL Cookbook* (Howard W. Sams, 1974), https://archive.org/details/donlancaster_TTLCB1.
  - [R] The chapters:
    - TTL basics: packages, power supplies and decoupling, breadboarding, testing and monitoring
      states;
    - a catalog of TTL ICs;
    - logic, including open-collector and three-state logic, data selectors and ROMs;
    - gate and timer circuits, including 555 circuits;
    - JK and D flip-flops;
    - divide-by-N counters;
    - shift registers, noise generators and rate multipliers.
  - [N] It covers most of the 7400 family, including parts the catalog lacks: 7489, 7473, 7475,
    7447, 74165, 74123, 74154, 74164, 74181 and 74190-74192.
  - [Lab] Pinouts and behaviour for new catalog parts, and small circuits for the sandbox.
- *RTL Cookbook*, https://archive.org/details/donlancaster_rtlcb.
  - [R] This copy is the 2010 third edition from Lancaster's own press.
  - It starts from two-input gates and how transistors make them, then logic functions, an encoder
    and a decoder, and driving lamps. Then multivibrators: two inverters back to back, the RS
    flip-flop, counting with RS flip-flops, contact conditioners, and monostable and astable
    circuits.
  - [Lab] Goes with background.md and `#/lab/transistor-gates`.
- *CMOS Cookbook*, https://archive.org/details/donlancaster_cmoscb.
  - [R] This copy is the fourth edition (first published 1977). It has a catalog of CMOS ICs and
    chapters on logic and three-state logic, multivibrators (including the CMOS 555), JK and D
    flip-flops (4013, 4027), counters and shift registers.
  - [Lab] For 4000-series parts, if the catalog adds them; Mims's circuits use the 4011 and 4017.
- Clocked Logic, Parts 1-3 (Kilobaud). [R] Excerpted from the 1977 *CMOS Cookbook*:
  - Part 1, the D and JK flip-flops: https://archive.org/details/donlancaster_Kilobaud-Clocked_Logic_I
  - Part 2, some basic applications: https://archive.org/details/donlancaster_Kilobaud-Clocked_Logic_II
  - Part 3: https://archive.org/details/donlancaster_Kilobaud-Clocked_Logic_III
- "Build the Digital Logic Microlab" (Popular Electronics, April 1970),
  https://archive.org/details/donlancaster_digital_microlab_4_70.
  - [R] A breadboarding trainer: four JK flip-flops, four two-input gates, two buffers and three
    bounceless switches, each block with its own pilot light, wired with clip leads. It's RTL, but
    adaptable to DTL or TTL, and good for over 100 basic logic experiments.
  - [Lab] A model for a trainer layout in the sandbox: fixed blocks with lamps, wired by the user.
- "Build R-E's Logic Demonstrator" (Radio-Electronics, May 1972),
  https://archive.org/details/donlancaster_logic_dem_re_5_72.
  - [R] Shows OR, NOR, AND, NAND, exclusive-OR and exclusive-NOR with a TTL chip and lamps. It's
    meant as a first TTL project, covering mounting, power, decoupling and showing logic states.
    [N] 7400.
  - [Lab] A small first example circuit for the sandbox.
- *Publications of Don Lancaster*, a list of his articles with magazines, dates and pages:
  https://archive.org/details/donlancaster_tempmbib.

## Datasheets

- Texas Instruments, *The TTL Data Book for Design Engineers*, 2nd edition (1976). Bitsavers split
  it into eleven items, 00-10, each a slice of the book. 00 is the indexes and selection guide:
  https://archive.org/details/bitsavers_tidataBook2ed00_137882. The others follow the same
  pattern, for example https://archive.org/details/bitsavers_tidataBook2ed01_1276104.
  - [Lab] The datasheet to check each new catalog part against, as clock.md does with Ben's.
    Several recalled pinouts in mims.md and tv-typewriter.md are still unchecked, such as
    7489/74LS189 and 7473/74LS107.
- *Signetics MOS* (1972), for the TV Typewriter's MOS parts: see tv-typewriter.md.

## Books in the lending library

- Malvino, *Digital Computer Electronics* (2nd edition, 1983), lending:
  https://archive.org/details/digitalcomputere00malv.
  - [R] It presents SAP-1, SAP-2 and SAP-3, with SAP-1 a bare-bones computer.
  - [Lab] videos.md says Ben's book recommendation is very likely this book, unchecked. Mims also
    names it as the source of his PIP-1 (mims.md). So it's the book to check Ben's design against.
- *The Bugbook I: Logic & Memory Experiments Using TTL Integrated Circuits* (Rony, Larsen and Braden,
  1974), lending: https://archive.org/details/bugbookilogicmem0000pete.
  - [R] Numbered experiments, each with its purpose, built on E&L Instruments' SK-10 solderless
    breadboard.
  - *The Bugbook II* (Larsen and Rony, 1974), the same kind of experiments, lending:
    https://archive.org/details/bugbookii0000davi. Going by their titles, the later ones (*The
    Bugbook III* and *The 8080A Bugbook*) turn to microcomputer interfacing.
  - [Lab] Ready-made, step-by-step sandbox exercises.
- *555 Timer Applications Sourcebook, with Experiments* (Berlin, 1976, a Bugbook reference),
  lending: https://archive.org/details/trs1555timerappl0000howa. [Lab] For the 555 labs.
- Radio-Electronics, March 1975, lending: https://archive.org/details/radioelectronics46unse_0.
  [R] Its cover lists "Build an IC breadboard" next to Part 2 of TV Typewriter II. Only the cover
  line was seen.

## Projects to follow next (free scans)

- Altair 8800, by H. Edward Roberts and William Yates (Popular Electronics):
  - Part 1, January 1975 (p. 33): https://archive.org/details/197501PopularElectronics
  - Part 2, February 1975, on using and programming it: https://archive.org/details/197502PopularElectronics
  - [R] The first was billed as a minicomputer project for under $400.
  - [I] The Altair is built around the 8080, so a sandbox version would need a microprocessor
    part.
- COSMAC Elf, by Joseph Weisbecker (Popular Electronics):
  - Part 1, August 1976: https://archive.org/details/197608-popular-electronics-cosmac-elf-part-1
  - Part 2, September 1976: https://archive.org/details/197609-popular-electronics-cosmac-elf-part-2
  - Part 3, March 1977: https://archive.org/details/197703-popular-electronics-cosmac-elf-part-3
  - [R] An RCA 1802 microcomputer trainer, billed at as little as $80.
    - Part 1 builds it and programs it from toggle switches.
    - Part 2 adds a cheap LED display in place of the hex display, an 8-bit I/O port, a 16-switch
      monitor for a hex keyboard, and a battery to keep the RAM's contents.
    - Part 3 covers operating systems and adding 1024 bytes of memory for about $20.
  - [Lab] Few chips and front-panel switches, much like Ben's computer in spirit, but it too needs
    a microprocessor part.

## Ben's other series

- [I] Ben's video card series builds VGA timing from TTL counters on breadboards. It's the nearest
  of his series to the TV Typewriter (tv-typewriter.md), and would need the same display part. His
  6502 computer series likewise pairs with Lancaster's TVT-6 and *Cheap Video* books, which get
  video out of a 6502. Both are recalled, not checked against the videos; check them before
  planning labs.

_Sources: the archive.org scans above (their OCR text and archive.org's full-text search)._
