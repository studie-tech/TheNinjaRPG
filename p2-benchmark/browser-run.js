async function benchmarkInput(config) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const panel = () => document.querySelector('[role="tabpanel"]');
  const state = () => ({
    cards: panel()?.querySelectorAll('ul.grid > li').length ?? 0,
    loader: !!panel()?.querySelector('img[alt="Loader Icon"]'),
    updating: /Updating lots…|Updating offers…/.test(panel()?.innerText ?? ''),
    empty: /No lots match|No active requests|No active trades/.test(panel()?.innerText ?? ''),
  });
  if (document.visibilityState !== 'visible') throw new Error('Benchmark tab is hidden');
  const input = document.getElementById(config.inputId);
  if (!input || input.value !== '') throw new Error('Expected an empty benchmark input');
  const initial = state();
  if (initial.loader || initial.updating) throw new Error('Initial query has not settled');
  const parse = (url) => {
    const parsed = new URL(url, location.href);
    const paths = parsed.pathname.split('/api/trpc/')[1]?.split(',') ?? [];
    const index = paths.indexOf(config.endpoint);
    if (index < 0) return null;
    return JSON.parse(parsed.searchParams.get('input'))?.[index]?.json ?? null;
  };
  const requests = [];
  const timings = [];
  const samples = [];
  const edits = [];
  const originalFetch = window.fetch;
  const started = performance.now();
  let active = 0;
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0].url;
    const query = parse(url);
    const promise = originalFetch.apply(this, args);
    if (query) {
      const record = { at: performance.now() - started, input: query };
      requests.push(record);
      active += 1;
      promise.then(
        (response) => { record.status = response.status; active -= 1; },
        () => { record.failed = true; active -= 1; },
      );
    }
    return promise;
  };
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.startTime < started || !parse(entry.name)) continue;
      timings.push({
        at: entry.startTime - started,
        duration: entry.duration,
        end: entry.responseEnd - started,
        encodedBytes: entry.encodedBodySize,
        decodedBytes: entry.decodedBodySize,
        transferBytes: entry.transferSize,
        input: parse(entry.name),
      });
    }
  });
  observer.observe({ type: 'resource', buffered: false });
  const timer = setInterval(() => samples.push({ at: performance.now() - started, ...state() }), 10);
  let settledAt;
  try {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (let i = 0; i < config.values.length; i += 1) {
      if (i) await sleep(150);
      setter.call(input, config.values[i]);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      edits.push({ at: performance.now() - started, value: config.values[i] });
    }
    const finalValue = config.numeric ? Number(config.values.at(-1)) : config.values.at(-1);
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      const finalRequest = timings.find((entry) => entry.input[config.field] === finalValue);
      const visible = state();
      if (finalRequest && !visible.loader && !visible.updating) {
        settledAt = performance.now() - started;
        break;
      }
      await sleep(10);
    }
    if (settledAt === undefined) throw new Error('Final query/UI did not settle');
    while ((active > 0 || timings.length < requests.length) && performance.now() < deadline) await sleep(10);
    await sleep(50);
    if (active > 0 || timings.length < requests.length) throw new Error('Unfinished benchmark requests');
    const finalRequest = timings.find((entry) => entry.input[config.field] === finalValue);
    const lastEdit = edits.at(-1).at;
    let loaderMs = 0;
    let absentMs = 0;
    let previous = { at: 0, ...initial };
    for (const sample of [...samples.filter((x) => x.at < settledAt), { at: settledAt, ...state() }]) {
      const delta = sample.at - previous.at;
      if (previous.loader) loaderMs += delta;
      if (initial.cards > 0 && previous.cards === 0) absentMs += delta;
      previous = sample;
    }
    return {
      config, initial, final: state(), edits,
      requestCount: requests.length,
      encodedResponseBytes: timings.reduce((sum, x) => sum + x.encodedBytes, 0),
      transferBytes: timings.reduce((sum, x) => sum + x.transferBytes, 0),
      finalRequestDurationMs: finalRequest.duration,
      finalRequestStartAfterLastEditMs: finalRequest.at - lastEdit,
      finalResponseAfterLastEditMs: finalRequest.end - lastEdit,
      settledAfterLastEditMs: settledAt - lastEdit,
      loaderMs,
      cardAbsentMs: initial.cards > 0 ? absentMs : null,
      finalSettledAtMs: settledAt,
      requests, timings,
      samples: samples.filter((x) => x.at <= settledAt),
    };
  } finally {
    window.fetch = originalFetch;
    clearInterval(timer);
    observer.disconnect();
  }
}
