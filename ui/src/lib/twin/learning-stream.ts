// The trailer's coordinates and 60 fps clock, without a finite film timeline.
export const LEARNING = { start: 1292, stage: 1306, fps: 60, completionFrames: 36 } as const;

export type LearningCard = {
  id: number;
  a: number;
  at: number;
  side: -1 | 1;
  y: number;
};

const spacing = 32;
const lifetime = 102;
const variation = 8;
const history = 120;

function cardAt(id: number): LearningCard {
  const a = LEARNING.start + 2 + id * spacing + 5 * Math.sin(id * 2.399) + 3 * Math.sin(id * 0.79);
  return {
    id,
    a,
    at: a + lifetime + variation * Math.sin(id * 1.73 + 0.7),
    side: id % 2 === 0 ? -1 : 1,
    y: id % 4 < 2 ? 455 : 671,
  };
}

/** Bounded current, incoming and recent events shared by DOM paths and the physical rig. */
export function learningCards(frame: number): LearningCard[] {
  const elapsed = Math.max(0, frame - LEARNING.start);
  const first = Math.max(0, Math.floor((elapsed - lifetime - variation - history) / spacing) - 1);
  const last = Math.floor(elapsed / spacing) + 2;
  const cards: LearningCard[] = [];
  for (let id = first; id <= last; id++) {
    const card = cardAt(id);
    if (card.at >= frame - history) cards.push(card);
  }
  return cards;
}
