import * as Sentry from "@sentry/nextjs";
import { isNativeUserAgent } from "@/libs/native/userAgent";

/** Page-load sampling: frame and device metrics stay bounded, failures are never sampled. */
export const RENDERER_METRICS_SAMPLE_RATE = 0.25;
/** Excludes shader compilation and first-texture stalls from frame percentiles. */
const FRAME_WARMUP_MS = 3_000;
const FRAME_WINDOW_MS = 20_000;
/** Shorter visits are dropped; a later visit to the same surface can still report. */
const FRAME_MIN_WINDOW_MS = 5_000;
/** One-millisecond buckets; the last holds every slower frame. */
const FRAME_BUCKETS = 256;
const CONTEXT_RESTORE_TIMEOUT_MS = 10_000;
const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const UNKNOWN_GPU: GpuIdentity = {
  gpu: "unknown",
  gpu_backend: "unknown",
  software: false,
};

/**
 * Reports renderer failures and aggregate GPU diagnostics. Attributes describe the device
 * class only; player identity is stripped from every `renderer.` metric before sending.
 */
export const createRendererDiagnostics = ({
  capture = Sentry.captureException,
  metrics = Sentry.metrics,
  random = Math.random,
}: RendererDiagnosticsDependencies = {}) => {
  const isSampled = random() < RENDERER_METRICS_SAMPLE_RATE;
  const reportedSurfaces = new Set<RendererSurface>();
  let gpu = UNKNOWN_GPU;
  let isDeviceReported = false;

  const reportFailure = (error: unknown, failure: RendererFailure) => {
    guard(() =>
      capture(error, {
        tags: {
          source: "gameRenderer",
          surface: failure.surface,
          phase: failure.phase,
          gpu: gpu.gpu,
          gpu_backend: gpu.gpu_backend,
          gpu_software: gpu.software,
        },
      }),
    );
  };

  const observe = (surface: RendererSurface, renderer: ObservedRenderer) => {
    guard(() => {
      const device = readDeviceProfile(renderer.gl);
      gpu = device.identity;
      if (isSampled && !isDeviceReported) {
        isDeviceReported = true;
        metrics.count("renderer.session", 1 / RENDERER_METRICS_SAMPLE_RATE, {
          attributes: {
            ...gpu,
            ...device.limits,
            ...clientAttributes(),
            sample_rate: RENDERER_METRICS_SAMPLE_RATE,
          },
        });
      }
    });
    const intervals = new Uint16Array(FRAME_BUCKETS);
    const workloads = new Uint16Array(FRAME_BUCKETS);
    let isCollecting = isSampled && !reportedSurfaces.has(surface);
    let warmup = FRAME_WARMUP_MS;
    let observed = 0;
    let lostAt: number | null = null;
    let restoreTimer: ReturnType<typeof setTimeout> | null = null;

    const finishFrames = () => {
      isCollecting = false;
      if (observed < FRAME_MIN_WINDOW_MS || reportedSurfaces.has(surface)) return;
      reportedSurfaces.add(surface);
      guard(() => {
        const attributes = {
          ...gpu,
          ...clientAttributes(),
          surface,
          resolution: renderer.resolution,
          megapixels:
            Math.round((renderer.canvas.width * renderer.canvas.height) / 1e5) / 10,
          sample_rate: RENDERER_METRICS_SAMPLE_RATE,
        };
        const options = { unit: "millisecond", attributes };
        metrics.distribution(
          "renderer.frame.p50",
          histogramPercentile(intervals, 0.5),
          options,
        );
        metrics.distribution(
          "renderer.frame.p95",
          histogramPercentile(intervals, 0.95),
          options,
        );
        metrics.distribution(
          "renderer.frame.work.p95",
          histogramPercentile(workloads, 0.95),
          options,
        );
      });
    };
    const awaitRestore = () => {
      restoreTimer = setTimeout(() => {
        // Browsers may defer restoration until the tab returns, which the player cannot see.
        if (document.hidden) awaitRestore();
        else
          reportFailure(new Error("WebGL context was not restored"), {
            surface,
            phase: "context",
          });
      }, CONTEXT_RESTORE_TIMEOUT_MS);
    };
    const clearRestoreTimer = () => {
      if (restoreTimer !== null) clearTimeout(restoreTimer);
      restoreTimer = null;
    };

    return {
      /** Runs inside the frame callback: must stay allocation-free and must not throw. */
      frame: (interval: number, work: number) => {
        if (!isCollecting) return;
        if (warmup > 0) {
          warmup -= interval;
          return;
        }
        intervals[Math.min(FRAME_BUCKETS - 1, Math.round(interval))]!++;
        workloads[Math.min(FRAME_BUCKETS - 1, Math.round(work))]!++;
        observed += interval;
        if (observed >= FRAME_WINDOW_MS) finishFrames();
      },
      contextLost: () => {
        lostAt = performance.now();
        guard(() =>
          metrics.count("renderer.context.lost", 1, {
            attributes: { ...gpu, surface, hidden: document.hidden },
          }),
        );
        clearRestoreTimer();
        awaitRestore();
      },
      contextRestored: () => {
        clearRestoreTimer();
        if (lostAt === null) return;
        const recovery = performance.now() - lostAt;
        lostAt = null;
        guard(() =>
          metrics.distribution("renderer.context.recovery", recovery, {
            unit: "millisecond",
            attributes: { ...gpu, surface },
          }),
        );
      },
      dispose: () => {
        clearRestoreTimer();
        if (isCollecting) finishFrames();
      },
    };
  };

  return { observe, reportFailure };
};

const diagnostics = createRendererDiagnostics();
export const observeRenderer = diagnostics.observe;
export const reportRendererFailure = diagnostics.reportFailure;

/** Collapses browser renderer strings so equivalent devices aggregate together. */
export const parseGpuIdentity = (renderer: string): GpuIdentity => {
  const angle = /^ANGLE \([^,]+, (.+), ([^,]+)\)$/.exec(renderer);
  const gpu = (angle?.[1] ?? renderer)
    .replace(/^ANGLE Metal Renderer: /, "")
    .replace(/ \(0x[0-9a-f]+\)/gi, "")
    .replace(/ Direct3D.*$/, "")
    .trim()
    .slice(0, 80);
  return {
    gpu: gpu || "unknown",
    gpu_backend: renderer.includes("Metal Renderer")
      ? "Metal"
      : (angle?.[2] ?? "native"),
    software: SOFTWARE_GPU.test(renderer),
  };
};

/** Value at the given quantile of a one-millisecond histogram. */
export const histogramPercentile = (histogram: Uint16Array, quantile: number) => {
  let total = 0;
  for (const count of histogram) total += count;
  const target = Math.ceil(total * quantile);
  let seen = 0;
  for (const [bucket, count] of histogram.entries()) {
    seen += count;
    if (seen >= target && seen > 0) return bucket;
  }
  return 0;
};

const readDeviceProfile = (gl: WebGLRenderingContext) => {
  const reported = String(gl.getParameter(gl.RENDERER));
  // Firefox warns about the debug extension and already reports a sanitized RENDERER.
  const debug =
    reported === "WebKit WebGL" ? gl.getExtension("WEBGL_debug_renderer_info") : null;
  const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  return {
    identity: parseGpuIdentity(
      String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : reported),
    ),
    limits: {
      max_texture_size: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
      max_texture_units: Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)),
      fragment_highp: (highp?.precision ?? 0) > 0,
    },
  };
};

const clientAttributes = () => ({
  device_pixel_ratio: window.devicePixelRatio || 1,
  coarse_pointer: matchMedia("(pointer: coarse)").matches,
  native_shell: isNativeUserAgent(navigator.userAgent),
});

/** Diagnostics must never interrupt rendering or replace the original failure. */
const guard = (record: () => void) => {
  try {
    record();
  } catch {}
};

export type RendererSurface =
  | "battlefield-preview"
  | "character-preview"
  | "combat"
  | "farm"
  | "globe"
  | "sector-preview"
  | "tower-defense"
  | "travel";

type RendererFailure = {
  surface: RendererSurface;
  phase: "init" | "frame" | "context" | "generation";
};

type GpuIdentity = { gpu: string; gpu_backend: string; software: boolean };

type ObservedRenderer = {
  gl: WebGLRenderingContext;
  resolution: number;
  canvas: { width: number; height: number };
};

type RendererDiagnosticsDependencies = {
  capture?: (
    error: unknown,
    context: { tags: Record<string, string | boolean> },
  ) => unknown;
  metrics?: Pick<typeof Sentry.metrics, "count" | "distribution">;
  random?: () => number;
};
