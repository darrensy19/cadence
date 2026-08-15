// Synthesised, not downloaded. A bell is a handful of inharmonic partials, each decaying at
// its own rate — which is what separates a bell from a beep. No audio files in the repo.

let ac = null;

function ctx() {
  if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
  // Autoplay policy suspends contexts created before a gesture; every caller here is
  // downstream of a click or a timer the user started, so resuming is safe.
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}

/** Warm the context on the first user gesture so the first chime is not swallowed. */
export function unlock() { try { ctx(); } catch (e) { /* no audio available */ } }

function strike(partials, dur, level) {
  let c;
  try { c = ctx(); } catch (e) { return; }
  const t = c.currentTime;
  const out = c.createGain();
  out.gain.value = level;
  out.connect(c.destination);
  for (const [freq, amp, decay] of partials) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * decay);
    o.connect(g); g.connect(out);
    o.start(t);
    o.stop(t + dur * decay + 0.05);
  }
}

/** Focus block finished — bright, so it carries when you are absorbed. */
export function bell() {
  strike([[880, 0.5, 1], [1320, 0.28, 0.7], [2640, 0.14, 0.4], [3520, 0.07, 0.28]], 2.4, 0.5);
}

/** Break finished — softer, since you are not concentrating on anything. */
export function marimba() {
  strike([[523.25, 0.6, 1], [2093, 0.16, 0.32], [3139, 0.06, 0.18]], 1.1, 0.55);
}

/** Long break — low and slow, audibly different from the other two across a room. */
export function gong() {
  strike([[164.8, 0.55, 1], [247, 0.3, 0.9], [311, 0.22, 0.75],
          [438, 0.13, 0.5], [621, 0.08, 0.35]], 5.0, 0.5);
}
