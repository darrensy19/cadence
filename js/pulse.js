// The signature motion. A calm heartbeat-style trace that scrolls while the timer is
// genuinely running and freezes the instant it is paused — a real reading of app state, not
// an ambient loop that plays regardless of what is actually happening. Colour follows
// --accent, so it recolours on the same amber/teal phase shift as everything else.
//
// One beat shape, defined once as [xFraction, yFraction] control points across a period, then
// stepped through as the trace scrolls. Flat baseline everywhere else — the point is a single
// legible blip per beat, not a dense waveform.
const BEAT = [
  [0.00, 0], [0.34, 0], [0.40, -0.16], [0.47, 0.95], [0.53, -0.52], [0.60, 0.10], [0.68, 0], [1.00, 0]
];
const PERIOD_PX = 240;   // spacing between beats
const SPEED_PX_S = 42;   // scroll speed

let canvas, ctx, raf = null;
let isRunning = false;
let offset = 0, lastFrameAt = null;
let color = '#FF7A45';
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mount(el) {
  canvas = el;
  ctx = canvas.getContext('2d');
  window.addEventListener('resize', resize);
  resize();
}

// Call this whenever the canvas goes from hidden to visible — an element hidden via
// [hidden]/display:none reports a zero-size rect, so the size sampled at mount time is stale
// by the time it is actually shown. No 'resize' event fires for a plain visibility change.
export function resize() {
  sizeCanvas();
  draw();
}

function sizeCanvas() {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function setColor(c) {
  if (c === color) return;
  color = c;
  draw();
}

export function setRunning(running) {
  isRunning = running && !reduceMotion;
  if (isRunning && !raf) {
    lastFrameAt = performance.now();
    raf = requestAnimationFrame(tick);
  } else if (!isRunning && raf) {
    cancelAnimationFrame(raf);
    raf = null;
    draw();
  }
}

function tick(t) {
  const dt = Math.min(0.1, (t - lastFrameAt) / 1000); // clamp a tab-throttle gap to one step
  lastFrameAt = t;
  offset = (offset + dt * SPEED_PX_S) % PERIOD_PX;
  draw();
  if (isRunning) raf = requestAnimationFrame(tick);
}

function beatY(localX) {
  const t = localX / PERIOD_PX;
  for (let i = 1; i < BEAT.length; i++) {
    const [x0, y0] = BEAT[i - 1], [x1, y1] = BEAT[i];
    if (t <= x1) {
      const f = x1 === x0 ? 0 : (t - x0) / (x1 - x0);
      return y0 + (y1 - y0) * f;
    }
  }
  return 0;
}

function draw() {
  if (!canvas || !ctx) return;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);
  if (w === 0 || h === 0) return;

  const mid = h / 2;
  ctx.strokeStyle = color;
  ctx.globalAlpha = isRunning ? 0.9 : 0.28;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let first = true;
  for (let x = 0; x <= w; x += 2) {
    const local = (((x + offset) % PERIOD_PX) + PERIOD_PX) % PERIOD_PX;
    const y = mid - beatY(local) * (h * 0.42);
    if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}
