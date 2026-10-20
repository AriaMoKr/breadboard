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
(https://ariamokr.github.io/hallway/, AriaMoKr/hallway, a checkout at `../hallway`), whose README
("Going in", "Linking back", "The view from your door") is the contract between them.

## Commands

```bash
npm run dev             # Vite: http://localhost:5173/ (the app) and /vr.html (the VR view)
npm test                # vitest (tests/, src/**/*.test.ts)
npm run typecheck
npm run build           # dist/: the app, then the VR view (--mode vr), sw.js, the zip
npm run verify          # tests, build, check:browser on dist/: before a commit or a push (~2.5 min)
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
- `src/vr/` (`vr.html`): `main.ts` (renderer, room, panel, input, VR entry and `sessiongranted`), `model.ts` (a `Layout` in three.js), `exhibits.ts` (what stands on the table, picked by the `#hash`), `panel.ts`, `carry.ts` (the grips), `hallway.ts` (the Hallway's door link and the way back).
- `scripts/`: the build steps (`sw-dist.mjs`, `zip-dist.mjs`), the checks (`check-browser.mjs`, `check-input.mjs`, `verify.mjs`) and the pictures (`make-preview.mjs`, `make-icons.mjs`); `lib/chrome.mjs` drives headless Chrome over DevTools.

## Conventions

- Ben's designs as he builds them: chip for chip, with his reference designators, component values and microcode. Check behaviour against `docs/research/` and the videos, and note a new source there.
- One JS and one CSS file per page (`inlineDynamicImports`), and relative URLs only (`base: './'`): the site lives under `/breadboard/`, and a wget mirror, the zip and the offline cache each get all of it. The link-preview tags are the exception: absolute, naming the GitHub Pages copy (`tests/link-preview.test.ts`).
- `vr.html`'s `<meta name="description">` is also its `og:description` (tested) and, word for word, the subtitle of the Hallway's door to here (`public/js/environments.js` there): change them together.
- `scripts/lib/chrome.mjs` writes each new Chrome profile's `Local State` before launching it, so Windows sees no failed logon: keep that. Outside (AriaMoKr/outside, `../outside`) has a copy as `tools/lib/chrome.mjs` that differs only in comments: a fix to one belongs in the other.
- Scripted testing: the VR view exposes `window.breadboardVR` (`machine`, `exhibit`, `way`, `screenPoint`, `panelLabels`, `panelPoint`, `preview`), and `vr.html?debug` logs what the controllers do and the frame timing. The 2D app exposes nothing: drive it through the DOM, as `check-browser.mjs` does. `.claude/launch.json` has `breadboard-dev` (5173) and `breadboard-quest` (127.0.0.1:5174).
- The repository is public. Commits use the no-reply identity in the repository's git config, and personal email addresses, private host names, server logins and local paths stay out of tracked files and commit messages. The full name appears only in `LICENSE`.
