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

export const videoUrl = (vid: Video) => `https://www.youtube.com/watch?v=${vid.youtubeId}&list=${PLAYLIST_ID}&index=${vid.index}`;
export const embedUrl = (vid: Video) => `https://www.youtube-nocookie.com/embed/${vid.youtubeId}`;
export const videosForLab = (lab: string) => VIDEOS.filter((x) => x.lab === lab);
