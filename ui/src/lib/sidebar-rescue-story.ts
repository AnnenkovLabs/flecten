import type { Point } from "./sidebar-rescue-actor";

export interface RescueRow {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SPLIT = 1550;
const EXIT = 950;
const clamp = (n: number) => Math.min(1, Math.max(0, n));
function span(t: number, start: number, end: number) {
  const u = clamp((t - start) / (end - start));
  return u * u * (3 - 2 * u);
}

// Extract the bottom card first. Each following card enters the top slot while
// the cards already extracted slide down by the same amount.
export function sidebarRescueStory(rows: RescueRow[]) {
  const first = rows[0];
  if (!first) throw new Error("A sidebar rescue needs at least one chat");
  const lip = first.y;
  let end = SPLIT;
  const beats = [...rows].reverse().map((row, turn) => {
    const index = rows.length - 1 - turn;
    const duration = turn === 0 ? 1790 : turn < 5 ? 1480 + (turn % 2) * 140 : 830;
    const start = end;
    end += duration;
    return { row, index, start, end, duration };
  });
  const duration = end + EXIT;
  let cursor = 0;

  function sample(time: number) {
    while (cursor + 1 < beats.length && time >= (beats[cursor]?.end ?? end)) cursor++;
    const beat = beats[cursor];
    if (!beat) throw new Error("A sidebar rescue needs at least one chat");
    const { row, index } = beat;
    const phase: "split" | "haul" | "exit" = time < SPLIT ? "split" : time < end ? "haul" : "exit";
    const progress = clamp(
      phase === "split"
        ? time / SPLIT
        : phase === "haul"
          ? (time - beat.start) / beat.duration
          : (time - end) / EXIT,
    );
    const p = phase === "split" ? 0 : phase === "exit" ? 1 : progress;

    // The first tug takes up slack, briefly slips, then the second seats the card.
    const travel =
      0.29 * span(p, 0.2, 0.42) -
      0.1 * span(p, 0.42, 0.5) +
      0.86 * span(p, 0.51, 0.77) -
      0.05 * span(p, 0.77, 0.86);
    const inset = Math.min(29, row.width * 0.14) * (1 - span(p, 0.78, 0.97));
    const insetY = row.height * 0.42;
    const pitch = (rows[index + 1]?.y ?? row.y + row.height) - row.y;
    const clipped = (1 - travel) * (row.height - 4);
    const y = lip + Math.max(2, insetY - clipped);
    const left: Point = [row.x + inset, y];
    const right: Point = [row.x + row.width - inset, y];

    return {
      phase,
      progress,
      index,
      left,
      right,
      startY: lip + 37,
      dy: lip - row.y - clipped,
      clipped: Math.max(0, clipped),
      stackShift: lip - row.y - pitch * (1 - travel),
      scale: 1 - (2 * inset) / row.width,
      cover: 1 - span(p, 0.87, 0.99),
    } as const;
  }

  return { sample, duration };
}
