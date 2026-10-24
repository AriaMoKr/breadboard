# CLAUDE.md

Guidance for Claude Code in this repository.

## What this is

A browser simulator for breadboard circuits (TypeScript and Vite 7, no UI framework; three.js 0.186
in the VR view only). It is built around Ben Eater's 8-bit breadboard computer: the finished
computer, the same computer as his boards, a breadboard sandbox simulated chip by chip, a lab for
each video of his playlist and of his other series that go with it, and a WebXR view. It is meant to
grow into a breadboard for projects from other learning sites and videos too. `README.md` covers
using, building and deploying it; `docs/BREADBOARD.md` the breadboard model (geometry, module
boards, the chip-level engine, the VR model); `docs/LABS.md` writing a lab; `docs/research/` the
sources each part follows.

Published at https://ariamokr.github.io/breadboard/ from `main` of AriaMoKr/breadboard by
`.github/workflows/pages.yml`. The VR view (`vr.html`) is behind a door of the Hallway
(https://ariamokr.github.io/hallway/, AriaMoKr/hallway, a checkout at `../hallway`). The contract
between them is AriaMoKr/common (a checkout at `../common`): `common/door.js` and `common/nav.js`
(with the Hallway's `portal.js` and `fade.js`, and `access.js`, the accessibility settings), and its README ("Going in", "Linking back", "The view from your door", "Moving in VR"); the shared
session is the Hallway's README, "Together", and AriaMoKr/layersharedsession (`../layersharedsession`).
Both are GitHub dependencies at a tag, with types of their own: to take a new version, move the
tag in package.json and `npm install`.

## Commands

```bash
npm run dev             # Vite: http://localhost:5173/ (the app) and /vr.html (the VR view)
npm test                # vitest (tests/, src/**/*.test.ts)
npm run typecheck
npm run build           # dist/: the app, then the VR view (--mode vr), sw.js, the zip
npm run verify          # tests, build, check:browser on dist/: before a commit or a push (~4 min)
npm run check:browser   # headless Chrome on the dev server (-- --dist, -- --url <address>)
npm run check:input     # real clicks and taps on every page's controls (~7 min; -- --page <text>, -- --url <address>): after changing controls or layout
npm run preview-image   # public/social-preview.jpg and public/hallway-preview.jpg, headless Chrome
npm run icons           # public/icons/ from icon.svg
```

Node runs under MSYS2 UCRT64 here, which is why Vite stays on 7 (Vite 8's Rolldown has no build
for that Node).

## Layout

- `src/sim/`: the finished computer at control-signal level, cycle-exact (`computer.ts`), with Ben's microcode in its four versions (`microcode.ts`), the display EEPROM (`display.ts`), the assembler and his programs. `machine.ts` wraps it with the clock module's front panel and runs it in real time; the computer page and the breadboard view share one `Machine`.
- `src/logic/circuit.ts`: the labs' event-driven, gate-level engine (0/1/Z/X, unit gate delays, tri-state).
- `src/breadboard/` (docs/BREADBOARD.md): geometry, the chip catalog, `Layout`, the SVG view and its `PanZoom`, the computer's module boards (`boards/*.board.ts`, auto-registered), sandbox links (`share.ts`) and the chip-level engine (`sim/`).
- `src/labs/<group>/<id>.lab.ts`: a lab each, registered by file name (docs/LABS.md); `src/app/chapters.ts` maps the videos to them.
- `src/app/`: the pages behind the `#/…` routes (`app.ts`): the computer, the breadboard view, the sandbox, the labs. `src/ui/`: framework-free widgets.
- `src/vr/` (`vr.html`): `main.ts` (renderer, the rig the camera and controllers ride on, room, panel, input, VR entry and `sessiongranted`), `model.ts` (a `Layout` in three.js), `exhibits.ts` (what stands on the table, picked by the `#hash`), `panel.ts`, `carry.ts` (the grips), `hallway.ts` (pure: this door's id and the doorway back as kept for the tab; the rest of the door contract is `common/door.js`), `door.ts` (the doorway back, hung with `common/portal.js`, the Hallway's doorway shader), `move.ts` (pure: walking, turning and jumping in VR, as the Hallway does; the choice is `common/nav.js`, the blink `common/fade.js`, the comfort vignette and seated lift `common/access.js`), and `together.ts` (the shared session, layersharedsession's `session.js`, with its `avatars.js` drawing the others).
- `scripts/`: the build steps (`sw-dist.mjs`, `zip-dist.mjs`), the checks (`check-browser.mjs`, `check-input.mjs`, `verify.mjs`) and the pictures (`make-preview.mjs`, `make-icons.mjs`); `lib/chrome.mjs` drives headless Chrome over DevTools.

## Conventions

- Ben's designs as he builds them: chip for chip, with his reference designators, component values and microcode. Check behaviour against `docs/research/` and the videos, and note a new source there.
- One JS and one CSS file per page (`inlineDynamicImports`), and relative URLs only (`base: './'`): the site lives under `/breadboard/`, and a wget mirror, the zip and the offline cache each get all of it. The link-preview tags are the exception: absolute, naming the GitHub Pages copy (`tests/link-preview.test.ts`).
- The VR view keeps the Hallway's door contract as vrlbry, music and outside do, through the shared packages rather than a copy: a change belongs in AriaMoKr/common or AriaMoKr/layersharedsession, then a new tag here.
- Comfort settings (common's `access.js`, `hallway.access` in localStorage, shared with the Hallway): the VR view offers them on the room's panel and in the bar's Comfort disclosure. With less motion (`reduce`) nothing glides or fades slowly (`fly` cuts, fades blink, the doorway's `uTime` holds), and the 2D pages have the class `reduce-motion` on `<html>` (`src/ui/motion.ts`), which stills the page's own transitions: give a new one a `.reduce-motion` rule, unless it is the simulation's (LEDs, digits, signals, wires), which stays.
- Accessible to WCAG 2.2 AA: `check:browser` runs axe-core on every page, dark and light, and must find nothing. Text is at least 4.5:1 on what it sits on: `--fg-faint` is the dimmest text, text on a lit `--led-blue` is `--on-blue`, a level's colour as text is `--wire-0-text`/`--wire-1-text`, and a dimmed control dims its graphics, not its words. Targets are 24 px, or 24 px apart. Every control and picture has a name (a toggle also `aria-pressed`; a schematic is an `img` until it holds a control, then a `group`), panels head with `h2` and what is inside them with `h3`, an empty header cell is `headCell('')`, and `.sr-only` holds words for screen readers only. The output display is announced politely (`aria-live`), throttled.
- `vr.html`'s `<meta name="description">` is also its `og:description` (tested) and, word for word, the subtitle of the Hallway's door to here (`public/js/environments.js` there): change them together.
- `scripts/lib/chrome.mjs` writes each new Chrome profile's `Local State` before launching it, so Windows sees no failed logon: keep that. Outside (AriaMoKr/outside, `../outside`) has a copy as `tools/lib/chrome.mjs` that differs only in comments: a fix to one belongs in the other.
- Scripted testing: the VR view exposes `window.breadboardVR` (`machine`, `exhibit`, `way`, `visit`, `door`, `rig`, `camera`, `xrDevice`, `nav`, `access`, `reduce`, `vignette`, `together`, `screenPoint`, `panelLabels`, `panelPoint`, `doorPoint`, `look`, `preview`), and `vr.html?debug` logs what the controllers do and the frame timing. On the dev server `vr.html?xr=emulate` installs IWER (a Quest 3): XR frames need the browser pane's tab in front (`tabs_select`), Enter VR needs a real click, `xrDevice.position` moves the headset and `xrDevice.controllers.left.updateAxes('thumbstick', x, y)` pushes a stick (`check-browser.mjs` does all of it on the dev server). The 2D app exposes nothing: drive it through the DOM, as `check-browser.mjs` does. `.claude/launch.json` has `breadboard-dev` (5173), `breadboard-dist` (`vite preview` of `dist/`, 4173) and `breadboard-quest` (127.0.0.1:5174). A shared session needs two pages: open the same `vr.html?room=…` in two tabs (each tab is its own visitor); the checks leave it out, since it needs the public relays.
- The repository is public. Commits use the no-reply identity in the repository's git config, and personal email addresses, private host names, server logins and local paths stay out of tracked files and commit messages. The full name appears only in `LICENSE`.
