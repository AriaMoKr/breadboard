import type { Lab } from '../labs/types';
import { h } from '../ui/dom';
import { CHAPTERS, LAB_IDS, PLAYLIST_URL, VIDEO_BY_INDEX, embedUrl, videoUrl, videosForLab, type Video } from './chapters';
import { mountComputerWorkbench } from './computer-page';
import { hasLab, loadLab, loadedLab } from './lab-loader';

type Route = { kind: 'computer' } | { kind: 'breadboard' } | { kind: 'sandbox' } | { kind: 'lab'; id: string; video?: number };

function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'lab' && parts[1]) return { kind: 'lab', id: parts[1], video: parts[2] ? Number(parts[2]) : undefined };
  if (parts[0] === 'breadboard') return { kind: 'breadboard' };
  if (parts[0] === 'sandbox') return { kind: 'sandbox' };
  if (parts[0] === 'video' && parts[1]) {
    const vid = VIDEO_BY_INDEX.get(Number(parts[1]));
    if (vid) return { kind: 'lab', id: vid.lab, video: vid.index };
  }
  return { kind: 'computer' };
}

const labHref = (id: string, video?: number) => `#/lab/${id}${video ? `/${video}` : ''}`;

/** The whole site as one zip, written next to index.html by scripts/zip-dist.mjs. */
const SITE_ZIP = 'breadboard-8bit.zip';

export class App {
  private main: HTMLElement;
  private nav: HTMLElement;
  private cleanup: (() => void) | null = null;
  private shell: HTMLElement;
  /** Incremented on every render, so a lab that finishes loading after the route changed is dropped. */
  private renderToken = 0;

  constructor(private root: HTMLElement) {
    this.nav = this.buildNav();
    void this.offerDownload();
    this.main = h('main', { class: 'content', id: 'content', tabindex: -1 });
    const menuBtn = h('button', { class: 'btn btn-ghost menu-btn', type: 'button', 'aria-label': 'Toggle chapter list', onClick: () => this.shell.classList.toggle('nav-open') }, '☰');
    const header = h(
      'header',
      { class: 'topbar' },
      menuBtn,
      h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-led' }), 'Breadboard 8-bit'),
      h('span', { class: 'topbar-sub' }, 'a simulator that follows Ben Eater’s “Building an 8-bit breadboard computer!”'),
      h('a', { class: 'topbar-link', href: PLAYLIST_URL, target: '_blank', rel: 'noopener' }, 'Playlist ↗'),
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
        h('ol', { class: 'nav-videos' }, ch.videos.map((vid) => h('li', null, h('a', { href: labHref(vid.lab, vid.index), dataset: { lab: vid.lab, video: String(vid.index) } }, h('span', { class: 'nav-num' }, String(vid.index)), h('span', { class: 'nav-title' }, vid.title.replace(/ - (8[- ]bit (computer clock|register)|8-bit register) - [Pp]art \d/, '')), h('span', { class: 'nav-dur' }, vid.duration))))),
      ),
    );
    return h(
      'nav',
      { class: 'sidebar', 'aria-label': 'Chapters' },
      h('a', { class: 'nav-computer', href: '#/', dataset: { route: 'computer' } }, '▣ The finished computer'),
      h('a', { class: 'nav-computer', href: '#/breadboard', dataset: { route: 'breadboard' } }, '⌗ Breadboard view'),
      h('a', { class: 'nav-computer', href: '#/sandbox', dataset: { route: 'sandbox' } }, '✎ Breadboard sandbox'),
      h('ol', { class: 'nav-chapters' }, items),
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
    this.nav.querySelector('[data-route="sandbox"]')?.after(link);
  }

  private highlightNav(route: Route) {
    this.nav.querySelectorAll('a').forEach((a) => {
      const el = a as HTMLAnchorElement;
      let active = false;
      if (route.kind !== 'lab') active = el.dataset.route === route.kind;
      else if (el.dataset.lab === route.id) active = route.video ? el.dataset.video === String(route.video) : true;
      el.classList.toggle('active', active);
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
    this.main.replaceChildren();
    window.scrollTo(0, 0);
    if (route.kind === 'computer') this.renderComputer();
    else if (route.kind === 'breadboard' || route.kind === 'sandbox') void this.renderBoardPage(route.kind, token);
    else void this.renderLab(route.id, route.video, token);
    this.main.focus({ preventScroll: true });
  }

  private renderComputer() {
    document.title = 'The finished computer · Breadboard 8-bit';
    const intro = h(
      'div',
      { class: 'page-head' },
      h('h1', null, 'The finished computer'),
      h('p', { class: 'lede' }, 'Ben Eater’s 8-bit breadboard computer as it stands at the end of the playlist: 16 bytes of RAM, A and B registers, an adder/subtractor ALU with carry and zero flags, a microcoded control unit and a decimal display. Load an example, then press Run, or pulse the clock by hand (Space) and watch every control signal and bus transfer.'),
      h('p', { class: 'note' }, 'New here? Start with ', h('a', { href: labHref('overview', 1) }, 'video 1'), ' and follow the chapters on the left: each one has a lab that rebuilds what that video builds. Or see the same computer ', h('a', { href: '#/breadboard' }, 'laid out on breadboards'), ', or build your own circuits in the ', h('a', { href: '#/sandbox' }, 'sandbox'), '.'),
    );
    const host = h('div');
    this.main.append(intro, host);
    const wb = mountComputerWorkbench(host, { versionPicker: true, program: 'multiply' });
    this.cleanup = wb.dispose;
  }

  private async renderBoardPage(kind: 'breadboard' | 'sandbox', token: number) {
    const breadboard = kind === 'breadboard';
    document.title = `${breadboard ? 'Breadboard view' : 'Breadboard sandbox'} · Breadboard 8-bit`;
    const head = h(
      'div',
      { class: 'page-head' },
      h('h1', null, breadboard ? 'Breadboard view' : 'Breadboard sandbox'),
      h(
        'p',
        { class: 'lede' },
        breadboard
          ? 'The finished computer laid out on breadboards the way Ben built it. Every chip, LED and wire is placed in its hole, and the running simulation lights the LEDs. Click the clock button, mode switches and DIP switches on the boards themselves, or use the toolbar.'
          : 'An empty breadboard with Ben’s parts bin. Place 74LS chips, LEDs, switches and resistors, wire them up, and the chip-level simulator runs what you built. Start from an example or from scratch.',
      ),
    );
    const body = h('div', { class: 'board-page' }, h('p', { class: 'dim' }, 'Loading…'));
    this.main.append(head, body);
    const mod = breadboard ? await import('./breadboard-page') : await import('./sandbox-page');
    if (token !== this.renderToken) return;
    body.replaceChildren();
    this.cleanup = 'mountBreadboardPage' in mod ? mod.mountBreadboardPage(body) : mod.mountSandboxPage(body);
  }

  private async renderLab(id: string, videoIndex: number | undefined, token: number) {
    const idx = LAB_IDS.indexOf(id);
    const prev = idx > 0 ? LAB_IDS[idx - 1] : null;
    const next = idx >= 0 && idx < LAB_IDS.length - 1 ? LAB_IDS[idx + 1] : null;
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
    const chapter = CHAPTERS.find((c) => c.videos.some((x) => x.lab === id));
    const title = lab?.title ?? videos[0]?.title ?? id;
    document.title = `${title} · Breadboard 8-bit`;
    const labTitle = (lid: string) => loadedLab(lid)?.title ?? videosForLab(lid)[0]?.title ?? lid;

    const head = h(
      'div',
      { class: 'page-head' },
      h('div', { class: 'crumbs' }, chapter ? chapter.title : 'Lab', videos.length ? ` · video${videos.length > 1 ? 's' : ''} ${videos.map((x) => x.index).join(', ')}` : ''),
      h('h1', null, title),
      lab ? h('p', { class: 'lede' }, lab.summary) : null,
      h('div', { class: 'video-list' }, videos.map((vid) => this.videoCard(vid, vid.index === videoIndex))),
    );
    const body = h('div', { class: 'lab-root' });
    const prevLink = prev ? h('a', { class: 'btn btn-ghost', href: labHref(prev) }, `← ${labTitle(prev)}`) : null;
    const nextLink = next ? h('a', { class: 'btn btn-ghost', href: labHref(next) }, `${labTitle(next)} →`) : null;
    const nav = h('div', { class: 'lab-nav' }, prevLink ?? h('span'), nextLink ?? h('a', { class: 'btn btn-ghost', href: '#/' }, 'The finished computer →'));
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
      body.appendChild(h('div', { class: 'placeholder' }, h('p', null, why), h('p', null, h('a', { href: '#/' }, 'Open the finished computer'), ' in the meantime.')));
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

  private videoCard(vid: Video, focused: boolean): HTMLElement {
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
      h('div', { class: 'video-meta' }, h('span', { class: 'nav-num' }, String(vid.index)), h('span', { class: 'video-title' }, vid.title), h('span', { class: 'dim' }, vid.duration)),
      h('div', { class: 'video-actions' }, watch, h('a', { class: 'btn btn-ghost', href: videoUrl(vid), target: '_blank', rel: 'noopener' }, 'YouTube ↗')),
      frameHost,
    );
  }
}
