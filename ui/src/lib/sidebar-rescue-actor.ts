export type Point = readonly [number, number];
type Pair = readonly [Point, Point];

export type RescueActor = {
  hips: Point;
  shoulder: Point;
  hands: Pair;
  feet: Pair;
  mood: "strain" | "surprised" | "happy" | "alert";
  facing?: -1 | 1;
  /** Vertical scale of the head, with a small counter-stretch across it. */
  squash?: number;
  opacity?: number;
};

function limb(
  ctx: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  length: number,
  bend: number,
): void {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const distance = Math.max(1, Math.hypot(dx, dy));
  const flex = Math.min(4.3, Math.sqrt(Math.max(0, length ** 2 - distance ** 2)) / 2) * bend;
  ctx.moveTo(...start);
  ctx.lineTo(
    (start[0] + end[0]) / 2 - (dy / distance) * flex,
    (start[1] + end[1]) / 2 + (dx / distance) * flex,
  );
  ctx.lineTo(...end);
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function face(ctx: CanvasRenderingContext2D, mood: RescueActor["mood"], facing: number): void {
  const look = facing * 0.75;
  ctx.translate(look, 0);
  ctx.lineWidth = 0.85;
  if (mood === "strain") {
    ctx.beginPath();
    ctx.moveTo(-2.7, -2);
    ctx.lineTo(-0.8, -1.05);
    ctx.lineTo(-2.6, -0.55);
    ctx.moveTo(2.6, -2);
    ctx.lineTo(0.75, -1.05);
    ctx.lineTo(2.5, -0.55);
    ctx.moveTo(-1.65, 2.05);
    ctx.quadraticCurveTo(0, 0.85, 1.65, 2.05);
    ctx.stroke();
    return;
  }

  dot(ctx, -1.6, -1.05, mood === "surprised" ? 0.75 : 0.59);
  dot(ctx, 1.55, -1.05, mood === "surprised" ? 0.75 : 0.59);
  ctx.beginPath();
  if (mood === "surprised") {
    ctx.ellipse(0.05, 1.9, 0.95, 1.14, 0, 0, Math.PI * 2);
  } else if (mood === "happy") {
    ctx.moveTo(-2.1, 1.35);
    ctx.quadraticCurveTo(0.12, 4.25, 2.15, 1.3);
  } else {
    ctx.moveTo(-0.85, 1.65);
    ctx.quadraticCurveTo(0.05, 2.18, 0.95, 1.65);
    ctx.moveTo(facing * 0.88, -2.75);
    ctx.quadraticCurveTo(facing * 1.65, -3.22, facing * 2.48, -2.8);
  }
  ctx.stroke();
}

export function drawRescueActor(
  ctx: CanvasRenderingContext2D,
  actor: RescueActor,
  ink: string,
  fill: string,
): void {
  const { hips, shoulder, hands, feet, mood, facing = 1, squash = 1, opacity = 1 } = actor;
  if (opacity <= 0) return;
  const dx = shoulder[0] - hips[0];
  const dy = shoulder[1] - hips[1];
  const angle = dx === 0 && dy === 0 ? 0 : Math.atan2(dx, -dy);
  const up: Point = [Math.sin(angle), -Math.cos(angle)];
  const side: Point = [-up[1], up[0]];
  const head: Point = [shoulder[0] + up[0] * 6.65, shoulder[1] + up[1] * 6.65];

  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const alpha = ctx.globalAlpha * Math.min(1, opacity);

  for (const i of [0, 1] as const) {
    const far = i === 0;
    const hand = hands[i];
    const foot = feet[i];
    const sign = far ? -1 : 1;
    ctx.globalAlpha = alpha * (far ? 0.75 : 1);
    ctx.lineWidth = far ? 1.35 : 1.65;
    ctx.beginPath();
    limb(
      ctx,
      [shoulder[0] + side[0] * sign * 1.2, shoulder[1] + side[1] * sign * 1.2],
      hand,
      12,
      sign,
    );
    limb(ctx, [hips[0] + side[0] * sign * 0.85, hips[1] + side[1] * sign * 0.85], foot, 13, -sign);
    ctx.lineTo(foot[0] + facing * 2.3, foot[1] - 0.2);
    ctx.stroke();
    dot(ctx, ...hand, far ? 1.05 : 1.33);
  }

  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1.85;
  ctx.beginPath();
  ctx.moveTo(...hips);
  ctx.quadraticCurveTo(
    (hips[0] + shoulder[0]) / 2 + side[0],
    (hips[1] + shoulder[1]) / 2 + side[1],
    ...shoulder,
  );
  ctx.lineTo(...head);
  ctx.stroke();

  ctx.translate(...head);
  ctx.rotate(angle);
  const stretch = Math.max(0.65, squash);
  ctx.scale(1 / Math.sqrt(stretch), stretch);
  ctx.beginPath();
  ctx.ellipse(0, 0, 5.15, 5.45, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = ink;
  face(ctx, mood, facing);
  ctx.restore();
}
