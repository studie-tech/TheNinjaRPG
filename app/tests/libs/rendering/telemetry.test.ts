import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  vi,
} from "bun:test";
import {
  createRendererDiagnostics,
  histogramPercentile,
  parseGpuIdentity,
  RENDERER_METRICS_SAMPLE_RATE,
} from "@/libs/rendering/telemetry";

const gl = (
  renderer = "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB (0x00001C03) Direct3D11 vs_5_0 ps_5_0, D3D11)",
) => {
  const parameters: Record<number, unknown> = {
    1: "WebKit WebGL",
    2: renderer,
    3: 16384,
    4: 16,
  };
  return {
    RENDERER: 1,
    MAX_TEXTURE_SIZE: 3,
    MAX_TEXTURE_IMAGE_UNITS: 4,
    FRAGMENT_SHADER: 5,
    HIGH_FLOAT: 6,
    getParameter: (name: number) => parameters[name],
    getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 2 }),
    getShaderPrecisionFormat: () => ({ precision: 23 }),
  } as unknown as WebGLRenderingContext;
};
const renderer = (context = gl()) => ({
  gl: context,
  resolution: 2,
  canvas: { width: 1440, height: 900 },
});
const setup = (random = 0) => {
  const metrics = { count: vi.fn(), distribution: vi.fn() };
  const capture = vi.fn();
  return {
    metrics,
    capture,
    diagnostics: createRendererDiagnostics({ capture, metrics, random: () => random }),
  };
};
const names = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.map(([name]) => name);
/** Warm-up, then the requested duration of 16 ms frames. */
const play = (
  observer: { frame: (interval: number, work: number) => void },
  seconds: number,
) => {
  observer.frame(3_000, 1);
  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += 16) observer.frame(16, 4);
};

beforeEach(() => {
  Object.assign(globalThis, { matchMedia: () => ({ matches: true }) });
});

describe("GPU identity", () => {
  it.each([
    [
      "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB (0x00001C03) Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "NVIDIA GeForce GTX 1060 6GB",
      "D3D11",
      false,
    ],
    [
      "ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Max, Unspecified Version)",
      "Apple M5 Max",
      "Metal",
      false,
    ],
    [
      "ANGLE (Qualcomm, Adreno (TM) 660, OpenGL ES 3.2)",
      "Adreno (TM) 660",
      "OpenGL ES 3.2",
      false,
    ],
    [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      "Vulkan 1.3.0 (SwiftShader Device (Subzero))",
      "SwiftShader driver",
      true,
    ],
    ["Apple GPU", "Apple GPU", "native", false],
    [
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      "native",
      true,
    ],
    ["", "unknown", "native", false],
  ])("normalises %s", (raw, device, backend, software) => {
    expect(parseGpuIdentity(raw)).toEqual({
      gpu: device,
      gpu_backend: backend,
      software,
    });
  });
});

describe("frame histogram", () => {
  it("reads quantiles, including from an empty histogram", () => {
    const histogram = new Uint16Array(256);
    expect(histogramPercentile(histogram, 0.95)).toBe(0);
    histogram[16] = 95;
    histogram[33] = 5;
    expect(histogramPercentile(histogram, 0.5)).toBe(16);
    expect(histogramPercentile(histogram, 0.95)).toBe(16);
    expect(histogramPercentile(histogram, 0.96)).toBe(33);
  });
});

describe("renderer diagnostics", () => {
  it("reports the device once per page load, weighted by the sample rate", () => {
    const { metrics, diagnostics } = setup();
    diagnostics.observe("travel", renderer());
    diagnostics.observe("combat", renderer());
    expect(names(metrics.count)).toEqual(["renderer.session"]);
    const [, weight, options] = metrics.count.mock.calls[0]!;
    expect(weight).toBe(1 / RENDERER_METRICS_SAMPLE_RATE);
    expect(options.attributes).toMatchObject({
      gpu: "NVIDIA GeForce GTX 1060 6GB",
      gpu_backend: "D3D11",
      max_texture_size: 16384,
      max_texture_units: 16,
      fragment_highp: true,
      coarse_pointer: true,
    });
  });

  it("does not ask for the debug extension when the browser exposes a usable renderer", () => {
    const context = gl();
    const getExtension = vi.spyOn(context, "getExtension");
    (context as unknown as { getParameter: (name: number) => unknown }).getParameter = (
      name,
    ) => (name === 1 ? "Mali-G78, or similar" : 8);
    const { metrics, diagnostics } = setup();
    diagnostics.observe("travel", renderer(context));
    expect(getExtension).not.toHaveBeenCalled();
    expect(metrics.count.mock.calls[0]![2].attributes.gpu).toBe("Mali-G78, or similar");
  });

  it("sends only frame percentiles after the warm-up, once per surface", () => {
    const { metrics, diagnostics } = setup();
    const first = diagnostics.observe("travel", renderer());
    first.frame(2_000, 500);
    play(first, 21);
    play(first, 21);
    first.dispose();
    expect(names(metrics.distribution)).toEqual([
      "renderer.frame.p50",
      "renderer.frame.p95",
      "renderer.frame.work.p95",
    ]);
    expect(metrics.distribution.mock.calls.map(([, value]) => value)).toEqual([
      16, 16, 4,
    ]);
    expect(metrics.distribution.mock.calls[0]![2].attributes).toMatchObject({
      surface: "travel",
      resolution: 2,
      megapixels: 1.3,
    });
    play(diagnostics.observe("travel", renderer()), 21);
    expect(metrics.distribution).toHaveBeenCalledTimes(3);
    play(diagnostics.observe("combat", renderer()), 21);
    expect(metrics.distribution).toHaveBeenCalledTimes(6);
  });

  it("flushes a useful partial window on dispose and drops a short visit", () => {
    const { metrics, diagnostics } = setup();
    const short = diagnostics.observe("travel", renderer());
    play(short, 2);
    short.dispose();
    expect(metrics.distribution).not.toHaveBeenCalled();
    const longer = diagnostics.observe("travel", renderer());
    play(longer, 6);
    longer.dispose();
    expect(metrics.distribution).toHaveBeenCalledTimes(3);
  });

  it("collects no frames or device metrics on unsampled page loads but still reports failures", () => {
    const { metrics, capture, diagnostics } = setup(0.99);
    const observer = diagnostics.observe("combat", renderer());
    play(observer, 21);
    observer.dispose();
    expect(metrics.count).not.toHaveBeenCalled();
    expect(metrics.distribution).not.toHaveBeenCalled();
    diagnostics.reportFailure(new Error("lost"), { surface: "combat", phase: "frame" });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]![1].tags).toEqual({
      source: "gameRenderer",
      surface: "combat",
      phase: "frame",
      gpu: "NVIDIA GeForce GTX 1060 6GB",
      gpu_backend: "D3D11",
      gpu_software: false,
    });
  });

  it("tags a failure before any context exists as an unknown GPU", () => {
    const { capture, diagnostics } = setup();
    diagnostics.reportFailure(new Error("no webgl"), {
      surface: "travel",
      phase: "init",
    });
    expect(capture.mock.calls[0]![1].tags).toMatchObject({
      gpu: "unknown",
      phase: "init",
    });
  });

  it("survives a context that cannot be queried and a metrics backend that throws", () => {
    const metrics = {
      count: vi.fn(() => {
        throw new Error("sdk");
      }),
      distribution: vi.fn(() => {
        throw new Error("sdk");
      }),
    };
    const capture = vi.fn(() => {
      throw new Error("sdk");
    });
    const diagnostics = createRendererDiagnostics({
      capture,
      metrics,
      random: () => 0,
    });
    const broken = {
      resolution: 1,
      canvas: { width: 1, height: 1 },
    } as unknown as Parameters<typeof diagnostics.observe>[1];
    const observer = diagnostics.observe("farm", broken);
    expect(() => {
      play(observer, 21);
      observer.contextLost();
      observer.contextRestored();
      observer.dispose();
      diagnostics.reportFailure(new Error("x"), { surface: "farm", phase: "frame" });
    }).not.toThrow();
  });
});

describe("context loss", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    setSystemTime();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  it("records a recovered loss and its duration without raising a failure", () => {
    const { metrics, capture, diagnostics } = setup(0.99);
    const observer = diagnostics.observe("combat", renderer());
    observer.contextLost();
    observer.contextRestored();
    vi.advanceTimersByTime(60_000);
    expect(names(metrics.count)).toEqual(["renderer.context.lost"]);
    expect(names(metrics.distribution)).toEqual(["renderer.context.recovery"]);
    expect(capture).not.toHaveBeenCalled();
  });

  it("raises a failure when a visible context never returns", () => {
    const { capture, diagnostics } = setup(0.99);
    diagnostics.observe("combat", renderer()).contextLost();
    vi.advanceTimersByTime(10_000);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]![1].tags.phase).toBe("context");
    vi.advanceTimersByTime(60_000);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("waits for a hidden tab to return before judging a loss", () => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    const { capture, metrics, diagnostics } = setup(0.99);
    const observer = diagnostics.observe("combat", renderer());
    observer.contextLost();
    expect(metrics.count.mock.calls[0]![2].attributes.hidden).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(capture).not.toHaveBeenCalled();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    vi.advanceTimersByTime(10_000);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("stops watching a disposed renderer", () => {
    const { capture, diagnostics } = setup(0.99);
    const observer = diagnostics.observe("combat", renderer());
    observer.contextLost();
    observer.dispose();
    vi.advanceTimersByTime(60_000);
    expect(capture).not.toHaveBeenCalled();
  });
});
