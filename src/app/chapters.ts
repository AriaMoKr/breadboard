/**
 * The playlist "Building an 8-bit breadboard computer!" by Ben Eater,
 * grouped into chapters. Each video points at the lab that recreates it.
 */

export const PLAYLIST_ID = 'PLowKtXNTBypGqImE405J2565dvjafglHU';
export const PLAYLIST_URL = `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`;

export interface Video {
  /** 1-based position in the playlist. */
  index: number;
  youtubeId: string;
  title: string;
  duration: string;
  /** Lab that covers this video. Several videos may share a lab. */
  lab: string;
}

export interface Chapter {
  id: string;
  title: string;
  videos: Video[];
}

const v = (index: number, youtubeId: string, title: string, duration: string, lab: string): Video => ({ index, youtubeId, title, duration, lab });

export const CHAPTERS: Chapter[] = [
  {
    id: 'intro',
    title: 'Introduction',
    videos: [v(1, 'HyznrdDSSGM', '8-bit computer update', '6:53', 'overview')],
  },
  {
    id: 'clock',
    title: 'Clock',
    videos: [
      v(2, 'kRlSFm519Bo', 'Astable 555 timer - 8-bit computer clock - part 1', '27:51', '555-astable'),
      v(3, '81BgFhm2vz8', 'Monostable 555 timer - 8-bit computer clock - part 2', '12:50', '555-monostable'),
      v(4, 'WCwJNnx36Rk', 'Bistable 555 - 8-bit computer clock - part 3', '10:31', '555-bistable'),
      v(5, 'SmQ5K7UQPMM', 'Clock logic - 8-bit computer clock - part 4', '10:42', 'clock-logic'),
    ],
  },
  {
    id: 'latches',
    title: 'Latches & flip-flops',
    videos: [
      v(6, 'KM0DdEaY5sY', 'SR latch', '12:58', 'sr-latch'),
      v(7, 'peCh_859q7Q', 'D latch', '9:16', 'd-latch'),
      v(8, 'YW-_GkUguMM', 'D flip-flop', '16:01', 'd-flip-flop'),
    ],
  },
  {
    id: 'registers',
    title: 'Registers & the bus',
    videos: [
      v(9, 'QzWW-CBugZo', 'Bus architecture and how register transfers work - 8 bit register - Part 1', '9:36', 'bus-transfers'),
      v(10, 'faAjse109Q8', 'Tri-state logic: Connecting multiple outputs together - 8 bit register - Part 2', '9:03', 'tri-state'),
      v(11, '-arYx_oVIj8', 'Designing and building a 1-bit register - 8 bit register - Part 3', '20:07', 'one-bit-register'),
      v(12, 'CiMaWbz_6E8', 'Building an 8-bit register - 8-bit register - Part 4', '9:40', 'eight-bit-register'),
      v(13, '9WE3Obdjtv0', "Testing our computer's registers - 8-bit register - Part 5", '10:53', 'register-test'),
    ],
  },
  {
    id: 'alu',
    title: 'Arithmetic',
    videos: [
      v(14, '4qH4unVtJkE', 'Twos complement: Negative numbers in binary', '13:49', 'twos-complement'),
      v(15, 'mOVOS9AjgFs', 'ALU Design', '15:10', 'alu-design'),
      v(16, 'S-3fXU3FZQc', 'Building the ALU', '16:17', 'alu-build'),
      v(17, 'U7Q8-2YZTUU', 'Troubleshooting the ALU', '15:10', 'alu-troubleshooting'),
      v(18, '4nCMDvnR2Fg', "Testing the computer's ALU", '5:42', 'alu-test'),
    ],
  },
  {
    id: 'ram',
    title: 'Memory',
    videos: [
      v(19, 'FnxPIZR1ybs', '8-bit computer RAM intro', '13:45', 'ram-intro'),
      v(20, 'uYXwCBo40iA', 'RAM module build - part 1', '13:45', 'ram-build'),
      v(21, 'KNve2LCcSRc', 'RAM module build - part 2', '21:02', 'ram-build'),
      v(22, '5rl1tEFXKt0', 'RAM module build - part 3', '14:13', 'ram-build'),
      v(23, 'Vw3uDOUJRGw', 'RAM module testing and troubleshooting', '16:43', 'ram-test'),
    ],
  },
  {
    id: 'counter',
    title: 'Counters & program counter',
    videos: [
      v(24, 'F1OC5e7Tn_o', 'JK flip-flop', '10:03', 'jk-flip-flop'),
      v(25, 'st3mUEub99E', 'JK flip-flop racing', '12:28', 'jk-racing'),
      v(26, 'rXHSB5w7CyE', 'Master-slave JK flip-flop', '12:42', 'master-slave-jk'),
      v(27, 'exGEmA67dNc', 'Binary counter', '5:13', 'binary-counter'),
      v(28, 'g_1HyxBzjl0', 'Program counter design', '9:18', 'program-counter'),
      v(29, 'tNwU7pK_3tk', 'Program counter build', '7:47', 'program-counter'),
    ],
  },
  {
    id: 'output',
    title: 'Output',
    videos: [
      v(30, '7zffjsXqATg', 'Designing a 7-segment hex decoder', '15:33', 'hex-decoder'),
      v(31, 'BA12Z7gQ4P0', 'Using an EEPROM to replace combinational logic', '25:22', 'eeprom'),
      v(32, 'K88pgWhEb1M', 'Build an Arduino EEPROM programmer', '57:30', 'eeprom-programmer'),
      v(33, 'dLh1n2dErzE', 'Build an 8-bit decimal display for our 8-bit computer', '32:47', 'decimal-display'),
    ],
  },
  {
    id: 'control',
    title: 'Control logic',
    videos: [
      v(34, '-6JAgFWCL9w', '8-bit computer build: Connecting the bus', '19:11', 'connecting-bus'),
      v(35, 'AwUirxi9eBg', '8-bit CPU control signal overview', '13:17', 'control-signals'),
      v(36, 'dXdoim96v5A', '8-bit CPU control logic: Part 1', '27:52', 'control-logic'),
      v(37, 'X7rCxs1ppyY', '8-bit CPU control logic: Part 2', '18:22', 'control-logic'),
      v(38, 'dHWFpkGsxOs', '8-bit CPU control logic: Part 3', '43:52', 'control-logic'),
      v(39, 'HtFro0UKqkk', '8-bit CPU reset circuit and power supply tips', '17:59', 'reset-circuit'),
    ],
  },
  {
    id: 'programming',
    title: 'Programming the CPU',
    videos: [
      v(40, 'JUVt_KYAp-I', 'Reprogramming CPU microcode with an Arduino', '31:14', 'microcode-programmer'),
      v(41, 'FCscQGBIL-Y', 'Adding more machine language instructions to the CPU', '18:50', 'more-instructions'),
      v(42, 'AqNDk_UJW4k', 'Making a computer Turing complete', '18:20', 'turing-complete'),
      v(43, 'ObnosznZvHY', 'CPU flags register', '29:27', 'flags-register'),
      v(44, 'Zg1NdPKoosU', 'Conditional jump instructions', '43:10', 'conditional-jumps'),
    ],
  },
];

export const VIDEOS: Video[] = CHAPTERS.flatMap((c) => c.videos);
export const VIDEO_BY_INDEX = new Map(VIDEOS.map((x) => [x.index, x]));

/** Distinct lab ids in playlist order. */
export const LAB_IDS: string[] = [...new Set(VIDEOS.map((x) => x.lab))];

/**
 * Ben's videos outside the playlist that go with it: the ones eater.net/8bit links (his first
 * build running programs, and an introduction to transistors and gates) and his digital clock
 * series (eater.net/clock), built from the same kind of chips.
 */
export interface MoreVideo {
  youtubeId: string;
  title: string;
  duration: string;
  /** Publication date, YYYY-MM-DD. */
  date: string;
  /** Lab that covers it, if any. */
  lab?: string;
}

/** Where videos are listed or a design was published, linked from its pages. */
export interface Source {
  href: string;
  label: string;
  /** Its name where `label` is too long or reads only in a sentence, as on the top bar's link ("Moritz’s playlist"). */
  short?: string;
}

export interface MoreGroup {
  id: string;
  title: string;
  /** Whose videos they are, if not Ben's (`OTHER_GROUPS`). */
  by?: string;
  /** What these videos are and how they relate to the series. */
  text: string;
  /** Where Ben (or `by`) lists them. */
  source: Source;
  /** A series in parts, numbered in the list. */
  numbered?: boolean;
  /** The number of its first video, for a series that goes on from another group (1 if not given). */
  first?: number;
  videos: MoreVideo[];
}

/** A group's number for its video at `i` (0-based), counting from its `first`. */
export const videoNumber = (g: MoreGroup, i: number) => (g.first ?? 1) + i;

const m = (youtubeId: string, title: string, duration: string, date: string, lab?: string): MoreVideo => ({ youtubeId, title, duration, date, lab });

export const MORE_GROUPS: MoreGroup[] = [
  {
    id: 'in-action',
    title: 'The computer in action',
    text: 'Four short videos from 2015, before the series, of Ben’s first build running programs. His Fibonacci program is one of the examples on the finished computer.',
    source: { href: 'https://eater.net/8bit', label: 'eater.net/8bit' },
    videos: [
      m('9PPrrSyubG0', 'Programming my 8-bit breadboard computer', '15:23', '2015-02-08'),
      m('35zLnS3fXeA', 'Stepping through a program on the 8-bit breadboard computer', '11:17', '2015-02-08'),
      m('yOyaJXpAYZQ', 'Comparing C to machine language', '10:02', '2015-02-08'),
      m('a73ZXDJtU48', 'Programming Fibonacci on a breadboard computer', '7:26', '2015-02-08'),
    ],
  },
  {
    id: 'background',
    title: 'From semiconductors to logic gates',
    text: 'Ben’s introduction, from 2015, for anyone unsure how transistors and logic gates work; eater.net/8bit points to these before the SR latch. The 4-bit adder video, from the same time, builds an adder like the ALU’s from XOR, AND and OR gates.',
    source: { href: 'https://eater.net/8bit', label: 'eater.net/8bit' },
    videos: [
      m('33vbFFFn04k', 'How semiconductors work', '15:51', '2015-03-18', 'transistor-gates'),
      m('DXvAlwMAxiA', 'How a transistor works', '11:23', '2015-03-19', 'transistor-gates'),
      m('sTu3LwpF6XI', 'Making logic gates from transistors', '13:02', '2015-03-22', 'transistor-gates'),
      m('wvJc9CZcvBc', 'Learn how computers add numbers and build a 4 bit adder circuit', '13:39', '2015-03-01'),
    ],
  },
  {
    id: 'clock',
    title: 'Build a digital clock',
    text: 'Ben’s new series, from 2026: a digital clock on breadboards, from 74LS counters, decoders and 7-segment displays, meant as a gentler start than a computer. It is still coming out; these are the parts on YouTube so far.',
    source: { href: 'https://eater.net/clock', label: 'eater.net/clock' },
    numbered: true,
    videos: [
      m('3XDH-fZKnQk', "Let's build a digital clock!", '26:47', '2026-08-08', 'mains-60hz'),
      m('RT0mp4f4QIs', 'Making a square wave square: Breadboard clock part 2', '22:19', '2026-08-22', 'square-wave'),
      m('gnmrKDpTM7o', 'Dividing a signal by counting: Breadboard clock part 3', '14:35', '2026-09-05', 'divide-by-60'),
      m('ZymtNiyGB_g', 'Building the minutes and seconds for my clock: Breadboard clock part 4', '27:36', '2026-10-03', 'minutes-seconds'),
      m('ou2RFTK86eA', 'Setting the time on my breadboard clock: Breadboard clock part 5', '20:22', '2026-10-18', 'setting-time'),
    ],
  },
];

export const MORE_VIDEOS: MoreVideo[] = MORE_GROUPS.flatMap((g) => g.videos);

/** Labs for Ben's other videos (transistors and gates, the digital clock), in order. */
export const MORE_LAB_IDS: string[] = [...new Set(MORE_VIDEOS.flatMap((v) => (v.lab ? [v.lab] : [])))];

/**
 * Other creators' videos that teach circuits on a breadboard, with labs built as Ben's are: so far
 * Moritz Klein's synthesizer videos (docs/research/moritz-klein.md), from his breadboard guide on.
 */
export const OTHER_GROUPS: MoreGroup[] = [
  {
    id: 'klein-beginners',
    title: 'For Beginners',
    by: 'Moritz Klein',
    text: 'Moritz Klein designs analog synthesizer circuits on a breadboard and explains them from scratch. His “For Beginners” playlist starts with a guide to the breadboard itself, then builds a voltage-controlled oscillator in four parts: a sawtooth core, an exponential converter for 1 V per octave, keeping it in tune, and shaping the sawtooth into a square.',
    source: { href: 'https://www.youtube.com/playlist?list=PLHeL0JWdJLvRv-r0TTjWxegtBha0ajdYh', label: 'his “For Beginners” playlist', short: 'Moritz’s playlist' },
    numbered: true,
    videos: [
      m('XpMZoR3fgd0', "Complete beginner's guide to using a breadboard", '21:22', '2021-03-29', 'using-a-breadboard'),
      m('QBatvo8bCa4', 'DIY VCO Part 1: The analog oscillator core anyone can build', '27:09', '2020-06-20', 'oscillator-core'),
      m('4qxgwN9aq8E', 'DIY VCO Part 2: The simplest exponential converter', '22:59', '2020-07-07', 'exponential-converter'),
      m('dd1dws6pSNo', 'DIY VCO Part 3: Tuning your VCO (and making sure it stays in tune)', '24:56', '2020-07-24', 'vco-tuning'),
      m('E76z9ZTc5po', 'DIY VCO Part 4: Shaping Sawtooth to Square', '27:11', '2020-08-17', 'sawtooth-to-square'),
    ],
  },
  {
    id: 'klein-vco',
    title: 'DIY VCO Series',
    by: 'Moritz Klein',
    text: 'His “DIY VCO Series” playlist starts with VCO parts 1 to 4, the last four of For Beginners, and goes on: the VCO built as a module, three of them on stripboard behind a panel; a quick tip that turns its sawtooth into a triangle; voltage control of its pulse width; and the kit Erica Synths makes of it, the first of his mki x es.EDU kits.',
    source: { href: 'https://www.youtube.com/playlist?list=PLHeL0JWdJLvTuGCyC3qvx0RM39YvopVQN', label: 'his “DIY VCO Series” playlist', short: 'Moritz’s playlist' },
    numbered: true,
    first: 5,
    videos: [
      m('OCAb2UoSPs0', 'How to build a DIY 3X VCO module from scratch', '16:17', '2020-09-28'),
      m('4r3TTaUKNe0', 'DIY SYNTH Quick Tip: Sawtooth-to-Triangle Converter', '15:41', '2021-01-18', 'sawtooth-to-triangle'),
      m('FUz3gFAh9pY', 'Adding voltage controlled PWM to my VCO', '17:25', '2021-04-18', 'voltage-controlled-pwm'),
      m('8JuYLLpZzBs', 'Introducing the mki x es.edu DIY VCO kit', '7:23', '2022-01-09'),
    ],
  },
];

export const OTHER_VIDEOS: MoreVideo[] = OTHER_GROUPS.flatMap((g) => g.videos);

/** Labs for other creators' videos, in order. */
export const OTHER_LAB_IDS: string[] = [...new Set(OTHER_VIDEOS.flatMap((v) => (v.lab ? [v.lab] : [])))];

/** A group's name for headings: Ben's by its title, others' with whose they are ("Moritz Klein: For Beginners"). */
export const groupTitle = (g: MoreGroup) => (g.by ? `${g.by}: ${g.title}` : g.title);

/** The labs of a group's videos, in order. */
export const groupLabs = (g: MoreGroup) => [...new Set(g.videos.flatMap((v) => (v.lab ? [v.lab] : [])))];

/** The labs a group's lab steps through: Ben's group's own, or all the labs of the creator's groups, one series after the other. */
export const seriesLabs = (g: MoreGroup) => (g.by ? [...new Set(OTHER_GROUPS.filter((x) => x.by === g.by).flatMap(groupLabs))] : groupLabs(g));

/**
 * Designs from other sources than Ben's videos, built here as his are, part by part with a lab
 * each: so far Don Lancaster's TV Typewriter, from a magazine article.
 */
export interface ProjectPart {
  title: string;
  lab: string;
  /** Where in the source it is. */
  where: string;
}

export interface Project {
  id: string;
  title: string;
  /** Who designed it. */
  by: string;
  /** What it is, for the lab pages. */
  text: string;
  /** The source to read alongside. */
  source: Source;
  parts: ProjectPart[];
}

export const PROJECTS: Project[] = [
  {
    id: 'tvt',
    title: 'TV Typewriter',
    by: 'Don Lancaster',
    text: 'Don Lancaster’s TV Typewriter, from Radio-Electronics in September 1973: 16 lines of 32 characters on a television, typed on a keyboard, from standard TTL and Signetics’ MOS memories, on boards that plug into one stack. Built here from his schematics, board by board.',
    source: { href: 'https://archive.org/details/donlancaster_tv_typewriter_9_73', label: 'Radio-Electronics, September 1973', short: 'Lancaster’s article' },
    parts: [
      { title: 'The timing chain', lab: 'tvt-timing', where: 'the timing board, Figs. 6 and 7' },
      { title: 'The character generator', lab: 'tvt-chargen', where: 'page A, Fig. 5, with the derived timing, Fig. 7' },
    ],
  },
];

/** Labs for the projects, in order. */
export const PROJECT_LAB_IDS: string[] = PROJECTS.flatMap((p) => p.parts.map((x) => x.lab));

/** The project a lab belongs to, with its part (1-based). */
export const projectForLab = (lab: string) =>
  PROJECTS.flatMap((project) => project.parts.flatMap((part, i) => (part.lab === lab ? [{ project, part, num: i + 1 }] : [])))[0];

/** Every lab: the playlist's, then those for Ben's other videos and other creators', then the projects'. */
export const ALL_LAB_IDS: string[] = [...LAB_IDS, ...MORE_LAB_IDS, ...OTHER_LAB_IDS, ...PROJECT_LAB_IDS];

/** The videos outside Ben's playlist (his other videos, then other creators') a lab covers, with their group and part number (from the group's `first`). */
export const moreVideosForLab = (lab: string) =>
  [...MORE_GROUPS, ...OTHER_GROUPS].flatMap((group) => group.videos.flatMap((video, i) => (video.lab === lab ? [{ group, video, part: videoNumber(group, i) }] : [])));

/** A video's title without the series name ("Making a square wave square: Breadboard clock part 2" -> "Making a square wave square"). */
export const shortTitle = (title: string) =>
  title
    .replace(/ - (8[- ]bit (computer clock|register)|8-bit register) - [Pp]art \d/, '')
    .replace(/: Breadboard clock part \d+$/, '')
    .replace(/ (for my clock|on my breadboard clock)$/, '')
    .replace(/^DIY VCO Part \d+: /, '')
    .replace(/^DIY SYNTH Quick Tip: /, '');

export const watchUrl = (youtubeId: string) => `https://www.youtube.com/watch?v=${youtubeId}`;
export const videoUrl = (vid: Video) => `https://www.youtube.com/watch?v=${vid.youtubeId}&list=${PLAYLIST_ID}&index=${vid.index}`;
export const embedUrl = (vid: { youtubeId: string }) => `https://www.youtube-nocookie.com/embed/${vid.youtubeId}`;
export const videosForLab = (lab: string) => VIDEOS.filter((x) => x.lab === lab);
