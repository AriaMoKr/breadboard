import { describe, expect, it } from 'vitest';
import { MODULE_BOARDS } from '../src/breadboard/boards';
import { untidy } from './helpers/tidy';

// The tidiness rules of docs/BREADBOARD.md, applied to every module board.
describe('every module board is tidy', () => {
  for (const def of MODULE_BOARDS.values()) it(def.id, () => expect(untidy(def)).toEqual([]));
});
