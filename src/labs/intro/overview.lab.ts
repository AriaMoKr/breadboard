import { mountComputerWorkbench } from '../../app/computer-page';
import { VIDEO_BY_INDEX } from '../../app/chapters';
import type { ModuleId } from '../../sim/signals';
import { h } from '../../ui/dom';
import { defineLab } from '../types';

const MODULES: { id: ModuleId; title: string; text: string; videos: number[] }[] = [
  { id: 'clock', title: 'Clock', text: 'Three 555 timers: an astable one for a free-running clock with adjustable speed, a monostable one for single debounced pulses, and a bistable one as a debounced switch to select between them. HLT can stop it.', videos: [2, 3, 4, 5] },
  { id: 'bus', title: 'Bus', text: 'Eight shared wires that connect every module. At any moment exactly one module puts a value on the bus (tri-state outputs) and any number of modules can read it on the next clock edge.', videos: [9, 10, 34] },
  { id: 'pc', title: 'Program counter', text: 'A 4-bit counter (74LS161) holding the address of the next instruction. CE counts, CO outputs it to the bus and J loads it from the bus (jumps).', videos: [24, 25, 26, 27, 28, 29] },
  { id: 'mar', title: 'Memory address register', text: 'Remembers which of the 16 RAM addresses is being accessed. In program mode, DIP switches select the address instead.', videos: [19, 20] },
  { id: 'ram', title: 'RAM', text: '16 bytes of memory built from two 74LS189 16×4 RAM chips, with DIP switches and a button to enter a program by hand.', videos: [19, 20, 21, 22, 23] },
  { id: 'ir', title: 'Instruction register', text: 'Holds the current instruction. The upper 4 bits (opcode) go to the control logic, the lower 4 bits (operand) can be put on the bus.', videos: [11, 12, 13] },
  { id: 'a', title: 'A register', text: 'The accumulator: an 8-bit register (74LS173 ×2) whose output feeds the ALU and can be put on the bus.', videos: [11, 12, 13] },
  { id: 'alu', title: 'ALU', text: 'Adds or subtracts B from A using two 4-bit adders (74LS283) and XOR gates that invert B for two’s-complement subtraction.', videos: [14, 15, 16, 17, 18] },
  { id: 'b', title: 'B register', text: 'The second ALU operand. It only reads from the bus.', videos: [11, 12, 13] },
  { id: 'out', title: 'Output register & display', text: 'Latches a value from the bus and shows it in decimal on four multiplexed 7-segment displays, decoded by an EEPROM, unsigned or two’s complement.', videos: [30, 31, 32, 33] },
  { id: 'flags', title: 'Flags register', text: 'Remembers whether the last ALU operation produced a carry or a zero result. That information enables the conditional jumps JC and JZ.', videos: [43, 44] },
  { id: 'control', title: 'Control logic', text: 'A step counter and two EEPROMs of microcode turn each instruction into a sequence of control words. Each control word decides which module writes to the bus and which ones read from it on the next clock pulse.', videos: [35, 36, 37, 38, 39, 40, 41] },
];

export default defineLab({
  id: 'overview',
  title: 'Tour of the 8-bit computer',
  summary:
    'The first video shows where the series is heading: a working programmable computer on breadboards. Click any module below to see what it does and which videos build it, then run a program to see them work together.',
  mount(root) {
    const info = h('div', { class: 'callout' }, 'Click a module to learn about it.');
    const show = (m: ModuleId) => {
      const mod = MODULES.find((x) => x.id === m);
      if (!mod) return;
      info.replaceChildren(
        h('strong', null, mod.title),
        ' — ',
        mod.text,
        h('br'),
        h('span', { class: 'dim small' }, 'Built in: '),
        ...mod.videos.flatMap((n, i) => {
          const vid = VIDEO_BY_INDEX.get(n);
          return vid ? [i ? ', ' : '', h('a', { href: `#/lab/${vid.lab}/${vid.index}` }, `${n}. ${vid.title.split(' - ')[0]}`)] : [];
        }),
      );
      root.querySelectorAll('.module').forEach((el) => el.classList.toggle('highlight', (el as HTMLElement).dataset.module === m));
    };
    const host = h('div');
    const more = h('p', { class: 'note' }, 'To see Ben’s first build run programs, from before the series, watch ', h('a', { href: '#/more/in-action' }, 'The computer in action'), '.');
    root.append(info, host, more);
    const wb = mountComputerWorkbench(host, { program: 'add', tabs: ['program', 'output'] });
    host.querySelectorAll('.module').forEach((el) => {
      (el as HTMLElement).style.cursor = 'pointer';
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button, input, label, select')) return;
        show((el as HTMLElement).dataset.module as ModuleId);
      });
    });
    return wb.dispose;
  },
});
