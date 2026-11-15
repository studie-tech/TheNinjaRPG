/** Default and maximum requested scene frame rate; whole-refresh pacing can present above it. */
export const MAX_FRAME_RATE = 60;
/** While only slow decorative motion plays: water, sway, pulses and loops of at most this rate. */
export const AMBIENT_FRAME_RATE = 30;
/** While motion is frozen and only clock-driven lighting or late artwork can change the picture. */
export const STILL_FRAME_RATE = 1;
/** Assumed until measured so initial frames use a paced interval on high-refresh displays. */
const DEFAULT_REFRESH_MS = 1000 / 120;
/** Consecutive callback gaps sampled for the refresh estimate; longer gaps are stalls, not vsyncs. */
const REFRESH_SAMPLES = 15;
const MAX_REFRESH_SAMPLE_MS = 50;

/**
 * One animation-frame request for all visible game canvases. It measures the display's
 * refresh interval, so scenes can present on whole multiples of it rather than every vsync.
 */
export const createFrameLoop = (
  request: (callback: FrameRequestCallback) => number,
  cancel: (id: number) => void,
) => {
  const callbacks = new Set<FrameRequestCallback>();
  const samples = new Float64Array(REFRESH_SAMPLES);
  const sorted = new Float64Array(REFRESH_SAMPLES);
  let sampleCount = 0;
  let refresh = DEFAULT_REFRESH_MS;
  let pending: number | null = null;
  let previous: number | null = null;
  const sample = (gap: number) => {
    if (gap <= 0 || gap > MAX_REFRESH_SAMPLE_MS) return;
    samples[sampleCount % REFRESH_SAMPLES] = gap;
    sampleCount++;
    // The median ignores occasional long frames; a full window refreshes the estimate.
    if (sampleCount % REFRESH_SAMPLES) return;
    sorted.set(samples);
    sorted.sort();
    refresh = sorted[REFRESH_SAMPLES >> 1] ?? refresh;
  };
  const tick: FrameRequestCallback = (now) => {
    pending = null;
    if (previous !== null) sample(now - previous);
    previous = now;
    for (const callback of [...callbacks]) {
      if (callbacks.has(callback)) callback(now);
    }
    if (callbacks.size && pending === null) pending = request(tick);
    else if (pending === null) previous = null;
  };
  return {
    subscribe: (callback: FrameRequestCallback) => {
      callbacks.add(callback);
      if (pending === null) pending = request(tick);
      return () => {
        callbacks.delete(callback);
        if (!callbacks.size && pending !== null) {
          cancel(pending);
          pending = null;
          previous = null;
        }
      };
    },
    /**
     * Shortest gap after a presented frame before the next one at this frame rate. Frames
     * land on whole refresh multiples (two vsyncs at 120 Hz, two at 144 Hz for 72 fps), so
     * pacing stays even; the half-vsync margin absorbs timestamp jitter.
     */
    minimumInterval: (frameRate: number) => {
      const vsyncs = Math.max(1, Math.floor(1000 / (refresh * frameRate) + 0.3));
      return (vsyncs - 0.5) * refresh;
    },
  };
};
