import { buildLabel } from '../build-info';
import type { Lab } from '../labs/types';
import { Machine } from '../sim/machine';
import { h } from '../ui/dom';
import { CHAPTERS, LAB_IDS, MORE_GROUPS, OTHER_GROUPS, PLAYLIST_URL, PROJECTS, VIDEOS, VIDEO_BY_INDEX, embedUrl, groupLabs, groupTitle, moreVideosForLab, projectForLab, seriesLabs, shortTitle, videoNumber, videoUrl, videosForLab, watchUrl, type Chapter, type MoreGroup, type Project, type ProjectPart, type Source } from './chapters';
import { mountComputerWorkbench } from './computer-page';
import { hasLab, loadLab, loadedLab } from './lab-loader';

type Route = { kind: 'home' } | { kind: 'computer' } | { kind: 'breadboard' } | { kind: 'sandbox' } | { kind: 'more'; group?: string } | { kind: 'lab'; id: string; video?: number };

function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'lab' && parts[1]) return { kind: 'lab', id: parts[1], video: parts[2] ? Number(parts[2]) : undefined };
  if (parts[0] === 'computer') return { kind: 'computer' };
  if (parts[0] === 'breadboard') return { kind: 'breadboard' };
  if (parts[0] === 'sandbox') return { kind: 'sandbox' };
  if (parts[0] === 'more') return { kind: 'more', group: parts[1] };
  if (parts[0] === 'video' && parts[1]) {
    const vid = VIDEO_BY_INDEX.get(Number(parts[1]));
    if (vid) return { kind: 'lab', id: vid.lab, video: vid.index };
  }
  return { kind: 'home' };
}

const labHref = (id: string, video?: number) => `#/lab/${id}${video ? `/${video}` : ''}`;

/** Ben's playlist, as his pages link it. */
const BEN: Source = { href: PLAYLIST_URL, label: 'Ben’s playlist' };

/**
 * Where the build a page belongs to comes from, for the top bar's link: Ben's playlist on his
 * pages, a group's list (eater.net/clock, Moritz's playlist) on its labs and its part of the More
 * videos page, a project's article on its labs. None on the home page and the whole More videos
 * page, which have more than one.
 */
function sourceOf(route: Route): Source | null {
  if (route.kind === 'home') return null;
  if (route.kind === 'more') return [...MORE_GROUPS, ...OTHER_GROUPS].find((g) => g.id === route.group)?.source ?? null;
  if (route.kind === 'lab' && !LAB_IDS.includes(route.id)) return moreVideosForLab(route.id)[0]?.group.source ?? projectForLab(route.id)?.project.source ?? null;
  return BEN;
}

/** What a video card shows: a playlist video, or one of Ben's others (no number, or its part). */
interface CardVideo {
  num?: string;
  youtubeId: string;
  title: string;
  duration: string;
  url: string;
  date?: string;
  /** A lab to link to from the card (on the More videos page). */
  lab?: string;
}

const DATE = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The site's name, in the top bar and every page's title (index.html and vr.html have it too). */
const SITE = 'Breadboard Workshop';
/** What it is, on the home page (index.html's description and the manifest's say it too). */
const DESCRIPTION = 'Breadboard builds, part for part, in your browser: Ben Eater’s 8-bit computer, Don Lancaster’s TV Typewriter and Moritz Klein’s synth, with a lab for each stage.';
/** The whole site as one zip, written next to index.html by scripts/zip-dist.mjs. */
const SITE_ZIP = 'breadboard-8bit.zip';

export class App {
  private main: HTMLElement;
  private nav: HTMLElement;
  /** The top bar's link to where the page's build comes from (`sourceOf`). */
  private sourceLink: HTMLAnchorElement;
  private cleanup: (() => void) | null = null;
  private shell: HTMLElement;
  /** Incremented on every render, so a lab that finishes loading after the route changed is dropped. */
  private renderToken = 0;
  /**
   * One computer for the finished-computer page and the breadboard view, so the program,
   * its state, the clock mode and the speed carry over between them. Labs have their own.
   */
  private sharedMachine: Machine | null = null;

  constructor(private root: HTMLElement) {
    this.nav = this.buildNav();
    void this.offerDownload();
    this.main = h('main', { class: 'content', id: 'content', tabindex: -1 });
    const menuBtn = h('button', { class: 'btn btn-ghost menu-btn', type: 'button', 'aria-label': 'Toggle chapter list', onClick: () => this.shell.classList.toggle('nav-open') }, '☰');
    this.sourceLink = h('a', { class: 'topbar-link', target: '_blank', rel: 'noopener' });
    const header = h(
      'header',
      { class: 'topbar' },
      menuBtn,
      h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-led' }), SITE),
      h('span', { class: 'topbar-sub' }, 'Ben Eater’s 8-bit computer, Don Lancaster’s TV Typewriter and Moritz Klein’s synth, part for part'),
      this.sourceLink,
    );
    this.shell = h('div', { class: 'shell' }, header, h('div', { class: 'shell-body' }, this.nav, this.main));
    this.root.replaceChildren(this.shell);
    window.addEventListener('hashchange', () => this.render());
    this.render();
  }

  private buildNav(): HTMLElement {
    const items = CHAPTERS.map((ch) =>
      h(
        'li',
        { class: 'nav-chapter' },
        h('div', { class: 'nav-chapter-title' }, ch.title),
        h('ol', { class: 'nav-videos' }, ch.videos.map((vid) => h('li', null, h('a', { href: labHref(vid.lab, vid.index), dataset: { lab: vid.lab, video: String(vid.index) } }, h('span', { class: 'nav-num' }, String(vid.index)), h('span', { class: 'nav-title' }, shortTitle(vid.title)), h('span', { class: 'nav-dur' }, vid.duration))))),
      ),
    );
    // a group's videos that have labs, numbered if it is a series in parts
    const labVideos = (g: MoreGroup) => g.videos.filter((v) => v.lab).map((v) => h('li', null, h('a', { href: labHref(v.lab!), dataset: { lab: v.lab! } }, h('span', { class: 'nav-num' }, g.numbered ? String(videoNumber(g, g.videos.indexOf(v))) : '·'), h('span', { class: 'nav-title' }, shortTitle(v.title)), h('span', { class: 'nav-dur' }, v.duration))));
    const moreLink = (g: MoreGroup, title: string) => h('li', null, h('a', { href: `#/more/${g.id}`, dataset: { route: 'more', group: g.id } }, h('span', { class: 'nav-num' }, '▸'), h('span', { class: 'nav-title' }, title), h('span', { class: 'nav-dur' }, String(g.videos.length))));
    return h(
      'nav',
      { class: 'sidebar', 'aria-label': 'Chapters' },
      h('a', { class: 'nav-computer', href: '#/computer', dataset: { route: 'computer' } }, '▣ The finished computer'),
      h('a', { class: 'nav-computer', href: '#/breadboard', dataset: { route: 'breadboard' } }, '⌗ Breadboard view'),
      h('a', { class: 'nav-computer', href: '#/sandbox', dataset: { route: 'sandbox' } }, '✎ Breadboard sandbox'),
      h('a', { class: 'nav-computer', href: 'vr.html', dataset: { route: 'vr' }, title: 'The breadboard computer in 3D: VR headsets, or mouse and touch' }, '◈ VR view'),
      h('ol', { class: 'nav-chapters' }, items),
      ...MORE_GROUPS.filter((g) => g.videos.some((v) => v.lab)).map((g) =>
        h('div', { class: 'nav-chapter' }, h('div', { class: 'nav-chapter-title' }, g.title), h('ol', { class: 'nav-videos' }, labVideos(g))),
      ),
      h('div', { class: 'nav-chapter' }, h('div', { class: 'nav-chapter-title' }, 'More from Ben'), h('ol', { class: 'nav-videos' }, MORE_GROUPS.map((g) => moreLink(g, g.title)))),
      ...PROJECTS.map((p) =>
        h(
          'div',
          { class: 'nav-chapter' },
          h('div', { class: 'nav-chapter-title' }, `${p.by}’s ${p.title}`),
          h('ol', { class: 'nav-videos' }, p.parts.map((part, i) => h('li', null, h('a', { href: labHref(part.lab), dataset: { lab: part.lab } }, h('span', { class: 'nav-num' }, String(i + 1)), h('span', { class: 'nav-title' }, part.title), h('span', { class: 'nav-dur' }))))),
        ),
      ),
      // other creators: a group's labs, then all its videos on the More videos page
      ...OTHER_GROUPS.map((g) =>
        h('div', { class: 'nav-chapter' }, h('div', { class: 'nav-chapter-title' }, groupTitle(g)), h('ol', { class: 'nav-videos' }, labVideos(g), moreLink(g, 'All its videos'))),
      ),
      h('p', { class: 'nav-build', title: 'The commit this site was built from, and its date' }, buildLabel()),
    );
  }

  /**
   * Adds "Download for offline use" under the main links once the zip turns out to exist, so the
   * dev server, a wget mirror or an unzipped copy shows no dead link. A 200 alone isn't enough:
   * the dev server and some hosts answer a missing file with index.html.
   */
  private async offerDownload() {
    let res: Response;
    try {
      res = await fetch(SITE_ZIP, { method: 'HEAD' });
    } catch {
      return; // offline or blocked
    }
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return;
    const bytes = Number(res.headers.get('content-length'));
    const link = h(
      'a',
      { class: 'nav-download', href: SITE_ZIP, download: SITE_ZIP, title: 'The whole site as a zip. Serve the unzipped folder over HTTP to run it (see README.txt inside).' },
      '⤓ Download for offline use',
      h('span', { class: 'nav-download-size' }, bytes > 0 ? `zip · ${Math.round(bytes / 1024)} kB` : 'zip'),
    );
    this.nav.querySelector('[data-route="vr"]')?.after(link);
  }

  private highlightNav(route: Route) {
    this.nav.querySelectorAll('a').forEach((a) => {
      const el = a as HTMLAnchorElement;
      let active = false;
      if (route.kind === 'more') active = el.dataset.route === 'more' && el.dataset.group === route.group;
      else if (route.kind !== 'lab') active = el.dataset.route === route.kind;
      else if (el.dataset.lab === route.id) active = route.video ? el.dataset.video === String(route.video) : true;
      el.classList.toggle('active', active);
      if (active) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
      el.classList.toggle('in-lab', route.kind === 'lab' && el.dataset.lab === route.id);
    });
  }

  render() {
    this.cleanup?.();
    this.cleanup = null;
    const token = ++this.renderToken;
    this.shell.classList.remove('nav-open');
    const route = parseRoute(location.hash);
    this.highlightNav(route);
    this.showSource(route);
    this.main.replaceChildren();
    window.scrollTo(0, 0);
    if (route.kind === 'home') this.renderHome();
    else if (route.kind === 'computer') this.renderComputer();
    else if (route.kind === 'more') this.renderMore(route.group);
    else if (route.kind === 'breadboard' || route.kind === 'sandbox') void this.renderBoardPage(route.kind, token);
    else void this.renderLab(route.id, route.video, token);
    this.main.focus({ preventScroll: true });
  }

  private showSource(route: Route) {
    const src = sourceOf(route);
    if (src) {
      this.sourceLink.setAttribute('href', src.href);
      this.sourceLink.textContent = `${src.short ?? src.label} ↗`;
      this.sourceLink.removeAttribute('hidden');
    } else this.sourceLink.setAttribute('hidden', '');
  }

  /** The front page: what the site is, then each build with its stages (their labs), where to start and its source. */
  private renderHome() {
    document.title = SITE;
    const tvt = PROJECTS.find((p) => p.id === 'tvt')!;
    const synth = OTHER_GROUPS.find((g) => g.id === 'klein-beginners')!;
    const synthGroups = OTHER_GROUPS.filter((g) => g.by === synth.by);
    // a stage's lab, numbered as in the sidebar; Ben's by his chapters and their videos
    const stage = (href: string, num: string, title: string) => h('li', null, h('a', { href }, h('span', { class: 'nav-num' }, num), ' ', h('span', null, title)));
    const videos = (ch: Chapter) => {
      const first = ch.videos[0].index, last = ch.videos[ch.videos.length - 1].index;
      return first === last ? String(first) : `${first}–${last}`;
    };
    const build = (led: string, title: string, text: HTMLElement[], stages: HTMLElement[], start: HTMLElement, ...links: HTMLElement[]) =>
      h('section', { class: 'home-build' }, h('h2', null, h('span', { class: `home-led ${led}` }), title), text, h('ol', { class: 'home-stages' }, stages), h('div', { class: 'home-links' }, start, links));
    const start = (href: string, words: string) => h('a', { class: 'btn btn-primary', href }, `${words} →`);
    const away = (src: Source) => h('a', { class: 'btn btn-ghost', href: src.href, target: '_blank', rel: 'noopener' }, `${src.short ?? src.label} ↗`);
    this.main.append(
      h('div', { class: 'page-head' }, h('h1', null, SITE), h('p', { class: 'lede' }, DESCRIPTION), h('p', { class: 'note' }, 'Each lab rebuilds one stage with the same chips and parts as its source, and runs it: flip its switches, step its clock and watch its signals.')),
      build(
        'red',
        'Ben Eater’s 8-bit computer',
        [
          h('p', { class: 'lede' }, 'A programmable computer on breadboards, built from 74LS chips over 44 videos: a clock, registers on a bus, an ALU that adds and subtracts, 16 bytes of RAM, a program counter, a decimal display and microcoded control logic.'),
          h('p', { class: 'note' }, 'Run ', h('a', { href: '#/computer' }, 'the finished computer'), ', see it ', h('a', { href: '#/breadboard' }, 'on breadboards'), ' as he built it or ', h('a', { href: 'vr.html' }, 'in VR'), ', build circuits of your own in ', h('a', { href: '#/sandbox' }, 'the sandbox'), ', or watch ', h('a', { href: '#/more' }, 'his other videos'), '.'),
        ],
        CHAPTERS.map((ch) => stage(labHref(ch.videos[0].lab, ch.videos[0].index), videos(ch), ch.title)),
        start(labHref(VIDEOS[0].lab, VIDEOS[0].index), 'Start with video 1'),
        away(BEN),
      ),
      build(
        'green',
        `${tvt.by}’s ${tvt.title}`,
        [h('p', { class: 'lede' }, 'Letters typed on a keyboard, shown on a television: 16 lines of 32 characters, from standard TTL and Signetics’ MOS memories on boards that plug into one stack. From Radio-Electronics, September 1973, built here from his schematics board by board.')],
        tvt.parts.map((part, i) => stage(labHref(part.lab), String(i + 1), part.title)),
        start(labHref(tvt.parts[0].lab), 'Start with the timing chain'),
        away(tvt.source),
      ),
      build(
        'yellow',
        'Moritz Klein’s synth',
        [h('p', { class: 'lede' }, 'Analog synthesizer circuits on a breadboard, explained from scratch. His “For Beginners” videos start with a guide to the breadboard itself, then build a voltage-controlled oscillator part by part: a sawtooth core, an exponential converter for 1 V per octave, keeping it in tune, and shaping the sawtooth into a square. A quick tip from his DIY VCO series turns the sawtooth into a triangle. The labs show each stage on a scope and play it.')],
        synthGroups.flatMap((g) => g.videos.filter((v) => v.lab).map((v) => stage(labHref(v.lab!), String(videoNumber(g, g.videos.indexOf(v))), shortTitle(v.title)))),
        start(labHref(groupLabs(synth)[0]), 'Start with the breadboard guide'),
        h('a', { class: 'btn btn-ghost', href: `#/more/${synth.id}` }, 'All his videos'),
        away(synth.source),
      ),
    );
  }

  private renderComputer() {
    document.title = `The finished computer · ${SITE}`;
    const intro = h(
      'div',
      { class: 'page-head' },
      h('h1', null, 'The finished computer'),
      h('p', { class: 'lede' }, 'Ben Eater’s 8-bit breadboard computer as it stands at the end of the playlist: 16 bytes of RAM, A and B registers, an adder/subtractor ALU with carry and zero flags, a microcoded control unit and a decimal display. Load an example, then press Run, or pulse the clock by hand', h('span', { class: 'key-hint' }, ' (Space)'), ' and watch every control signal and bus transfer.'),
      h('p', { class: 'note' }, 'New here? Start with ', h('a', { href: labHref('overview', 1) }, 'video 1'), ' and follow the chapters on the left: each one has a lab that rebuilds what that video builds. Or see the same computer ', h('a', { href: '#/breadboard' }, 'laid out on breadboards'), ', build your own circuits in the ', h('a', { href: '#/sandbox' }, 'sandbox'), ', or watch ', h('a', { href: '#/more' }, 'Ben’s other videos'), ' that go with the series.'),
    );
    const host = h('div');
    this.main.append(intro, host);
    const wb = mountComputerWorkbench(host, { versionPicker: true, program: 'multiply', machine: this.machine(), keepProgram: true });
    this.cleanup = wb.dispose;
  }

  /** Ben's videos outside the playlist, then other creators', grouped; `group` scrolls to one group. */
  private renderMore(group: string | undefined) {
    document.title = `More videos · ${SITE}`;
    const head = h(
      'div',
      { class: 'page-head' },
      h('h1', null, 'More videos'),
      h('p', { class: 'lede' }, 'Ben’s videos outside the playlist that go with it: his first build running programs, his introduction to transistors and logic gates, and his new digital clock series. Then videos from other channels that teach circuits on a breadboard: Moritz Klein’s synthesizer videos, from his guide to the breadboard on.'),
    );
    const section = (g: MoreGroup) =>
      h(
        'section',
        { class: 'more-group', id: `more-${g.id}` },
        h('h2', null, groupTitle(g)),
        h('p', { class: 'lede' }, g.text, ' ', h('span', { class: 'dim' }, `${g.by ?? 'Ben'} lists them on `, h('a', { href: g.source.href, target: '_blank', rel: 'noopener' }, `${g.source.label} ↗`), '.')),
        h('div', { class: 'video-list' }, g.videos.map((v, i) => this.videoCard({ ...v, num: g.numbered ? String(videoNumber(g, i)) : undefined, url: watchUrl(v.youtubeId), lab: v.lab }, false))),
      );
    this.main.append(head, ...MORE_GROUPS.map(section), ...OTHER_GROUPS.map(section));
    if (group) this.main.querySelector(`#more-${group}`)?.scrollIntoView?.();
  }

  private async renderBoardPage(kind: 'breadboard' | 'sandbox', token: number) {
    const breadboard = kind === 'breadboard';
    document.title = `${breadboard ? 'Breadboard view' : 'Breadboard sandbox'} · ${SITE}`;
    const head = h(
      'div',
      { class: 'page-head' },
      h('h1', null, breadboard ? 'Breadboard view' : 'Breadboard sandbox'),
      h(
        'p',
        { class: 'lede' },
        breadboard
          ? 'The finished computer laid out on breadboards the way Ben built it. Every chip, LED and wire is placed in its hole, and the running simulation lights the LEDs. Click the clock button, mode switches and DIP switches on the boards themselves, or use the toolbar. It is the same computer as on the finished-computer page: its program, state and clock speed carry over.'
          : 'An empty breadboard with Ben’s parts bin. Place 74LS chips, LEDs, switches and resistors, wire them up, and the chip-level simulator runs what you built. Start from an example or from scratch.',
      ),
    );
    const body = h('div', { class: 'board-page' }, h('p', { class: 'dim' }, 'Loading…'));
    this.main.append(head, body);
    const mod = breadboard ? await import('./breadboard-page') : await import('./sandbox-page');
    if (token !== this.renderToken) return;
    body.replaceChildren();
    this.cleanup = 'mountBreadboardPage' in mod ? mod.mountBreadboardPage(body, { machine: this.machine() }) : mod.mountSandboxPage(body);
  }

  private machine(): Machine {
    return (this.sharedMachine ??= new Machine({ microcodeVersion: 'flags' }));
  }

  private async renderLab(id: string, videoIndex: number | undefined, token: number) {
    // prev/next within the playlist, the series the lab belongs to (another creator's groups one after the other), or its project
    const group = moreVideosForLab(id)[0]?.group, project = projectForLab(id)?.project;
    const order = project ? project.parts.map((p) => p.lab) : LAB_IDS.includes(id) || !group ? LAB_IDS : seriesLabs(group);
    const idx = order.indexOf(id);
    const prev = idx > 0 ? order[idx - 1] : null;
    const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
    let lab: Lab | undefined = loadedLab(id);
    if (!lab && hasLab(id)) {
      const pending = h('p', { class: 'dim', style: 'padding: 20px 0' }, 'Loading the lab…');
      this.main.replaceChildren(pending);
      lab = await loadLab(id);
      if (token !== this.renderToken) return; // the route changed while loading
      this.main.replaceChildren();
    }
    this.mountLab(id, lab, videoIndex, prev, next);
  }

  private mountLab(id: string, lab: Lab | undefined, videoIndex: number | undefined, prev: string | null, next: string | null) {
    const videos = videosForLab(id);
    const more = moreVideosForLab(id);
    const project = projectForLab(id);
    const chapter = CHAPTERS.find((c) => c.videos.some((x) => x.lab === id));
    const title = lab?.title ?? videos[0]?.title ?? more[0]?.video.title ?? project?.part.title ?? id;
    document.title = `${title} · ${SITE}`;
    const labTitle = (lid: string) => loadedLab(lid)?.title ?? videosForLab(lid)[0]?.title ?? moreVideosForLab(lid)[0]?.video.title ?? projectForLab(lid)?.part.title ?? lid;
    const crumbs = chapter
      ? [chapter.title, videos.length ? ` · video${videos.length > 1 ? 's' : ''} ${videos.map((x) => x.index).join(', ')}` : '']
      : more.length
        ? [groupTitle(more[0].group), more[0].group.numbered ? ` · part${more.length > 1 ? 's' : ''} ${more.map((x) => x.part).join(', ')}` : '']
        : project
          ? [`${project.project.by}’s ${project.project.title}`, ` · part ${project.num}`]
          : ['Lab', ''];

    const head = h(
      'div',
      { class: 'page-head' },
      h('div', { class: 'crumbs' }, ...crumbs),
      h('h1', null, title),
      lab ? h('p', { class: 'lede' }, lab.summary) : null,
      h(
        'div',
        { class: 'video-list' },
        videos.map((vid) => this.videoCard({ ...vid, num: String(vid.index), url: videoUrl(vid) }, vid.index === videoIndex)),
        more.map(({ group, video, part }) => this.videoCard({ ...video, num: group.numbered ? String(part) : undefined, url: watchUrl(video.youtubeId), lab: undefined }, false)),
        project ? this.sourceCard(project.project, project.part, project.num) : null,
      ),
    );
    const body = h('div', { class: 'lab-root' });
    const prevLink = prev ? h('a', { class: 'btn btn-ghost', href: labHref(prev) }, `← ${labTitle(prev)}`) : null;
    const nextLink = next ? h('a', { class: 'btn btn-ghost', href: labHref(next) }, `${labTitle(next)} →`) : null;
    const end = more.length
      ? h('a', { class: 'btn btn-ghost', href: `#/more/${more[0].group.id}` }, 'More videos →')
      : project
        ? h('a', { class: 'btn btn-ghost', href: '#/sandbox' }, 'Its chips in the sandbox →')
        : h('a', { class: 'btn btn-ghost', href: '#/computer' }, 'The finished computer →');
    const nav = h('div', { class: 'lab-nav' }, prevLink ?? h('span'), nextLink ?? end);
    // swap in the real lab titles once the neighbours have loaded
    const token = this.renderToken;
    for (const [lid, link, fmt] of [[prev, prevLink, (t: string) => `← ${t}`], [next, nextLink, (t: string) => `${t} →`]] as const) {
      if (lid && link && !loadedLab(lid))
        void loadLab(lid).then((l) => {
          if (l && token === this.renderToken) link.textContent = fmt(l.title);
        });
    }
    this.main.append(head, body, nav);

    if (!lab) {
      const why = hasLab(id) ? 'This lab failed to load (see the browser console).' : 'This lab hasn’t been built yet.';
      body.appendChild(h('div', { class: 'placeholder' }, h('p', null, why), h('p', null, h('a', { href: '#/computer' }, 'Open the finished computer'), ' in the meantime.')));
      return;
    }
    try {
      const c = lab.mount(body);
      this.cleanup = typeof c === 'function' ? c : null;
    } catch (err) {
      console.error(err);
      body.appendChild(h('pre', { class: 'error' }, `Lab failed to load: ${(err as Error).message}`));
    }
  }

  /** A project's source, in place of a video: the article to read alongside the lab. */
  private sourceCard(project: Project, part: ProjectPart, num: number): HTMLElement {
    return h(
      'div',
      { class: 'video-card' },
      h('div', { class: 'video-meta' }, h('span', { class: 'nav-num' }, String(num)), h('span', { class: 'video-title' }, `${project.source.label}: ${part.where}`)),
      h('p', { class: 'dim small' }, project.text),
      h('div', { class: 'video-actions' }, h('a', { class: 'btn btn-ghost', href: project.source.href, target: '_blank', rel: 'noopener' }, 'Read it on archive.org ↗')),
    );
  }

  private videoCard(vid: CardVideo, focused: boolean): HTMLElement {
    const frameHost = h('div', { class: 'video-embed' });
    const watch = h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => {
      if (frameHost.firstChild) {
        frameHost.replaceChildren();
        watch.textContent = '▶ Watch here';
        return;
      }
      frameHost.appendChild(h('iframe', { src: embedUrl(vid), title: vid.title, allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture', allowFullscreen: true, loading: 'lazy', referrerPolicy: 'strict-origin-when-cross-origin' }));
      watch.textContent = '✕ Close video';
    } }, '▶ Watch here');
    return h(
      'div',
      { class: `video-card ${focused ? 'focused' : ''}` },
      h('div', { class: 'video-meta' }, vid.num ? h('span', { class: 'nav-num' }, vid.num) : null, h('span', { class: 'video-title' }, vid.title), h('span', { class: 'dim' }, vid.duration), vid.date ? h('span', { class: 'dim small video-date' }, DATE.format(new Date(vid.date))) : null),
      h('div', { class: 'video-actions' }, watch, h('a', { class: 'btn btn-ghost', href: vid.url, target: '_blank', rel: 'noopener' }, 'YouTube ↗'), vid.lab ? h('a', { class: 'btn btn-ghost', href: labHref(vid.lab) }, 'Lab →') : null),
      frameHost,
    );
  }
}
