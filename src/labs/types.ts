/**
 * A chapter lab: an interactive page that recreates what one (or a few)
 * videos build. Each lab lives in its own `*.lab.ts` file under src/labs/
 * and default-exports `defineLab({...})`; the registry discovers it
 * automatically (no shared file to edit).
 */
export interface Lab {
  /** Must match a `lab` id in src/app/chapters.ts. */
  id: string;
  title: string;
  /** One-paragraph intro shown above the lab. */
  summary: string;
  /**
   * Build the lab inside `root`. Return a cleanup function that stops
   * animation loops / listeners (the root element itself is removed by the
   * app).
   */
  mount(root: HTMLElement): (() => void) | void;
}

export function defineLab(lab: Lab): Lab {
  return lab;
}
