/**
 * Compute Beta(1,1) posterior parameters and moments for a Bernoulli conversion rate.
 * @param conversions Number of successes (conversions).
 * @param total Number of trials (visitors/exposures).
 * @returns Object containing alpha (a), beta (b), posterior mean and variance.
 */
export const betaPosterior = (conversions: number, total: number) => {
  const a = conversions + 1;
  const b = Math.max(0, total - conversions) + 1;
  const mean = a / (a + b);
  const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
  return { a, b, mean, variance };
};

/**
 * Log-Gamma function via Lanczos approximation.
 * @param z Input value.
 * @returns ln(Γ(z)).
 */
export const logGamma = (z: number): number => {
  const p: number[] = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012,
    0.000009984369578019572, 0.00000015056327351493116,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let acc = p[0] ?? 0;
  for (let i = 1; i < p.length; i++) acc += (p[i] ?? 0) / (z + i);
  const t = z + p.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(acc);
};

/**
 * Log-Beta function using logGamma.
 * @param a Alpha parameter.
 * @param b Beta parameter.
 * @returns ln(B(a,b)).
 */
export const logBeta = (a: number, b: number): number =>
  logGamma(a) + logGamma(b) - logGamma(a + b);

/**
 * Beta probability density function.
 * @param x Point in (0,1).
 * @param a Alpha parameter (>0).
 * @param b Beta parameter (>0).
 * @returns Density at x.
 */
export const betaPdf = (x: number, a: number, b: number): number => {
  if (x <= 0 || x >= 1) return 0;
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - logBeta(a, b));
};

/**
 * Uniform(0,1) RNG.
 * @returns Random number in [0,1).
 */
export const randomUniform = (): number => Math.random();

/**
 * Standard Normal RNG via Box–Muller.
 * @returns Random N(0,1) variate.
 */
export const randomNormal = (): number => {
  const u = 1 - randomUniform();
  const v = 1 - randomUniform();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};

/**
 * Gamma(shape, scale=1) RNG using Marsaglia & Tsang method.
 * @param shape Shape (k > 0).
 * @returns Random Gamma(k,1) variate.
 */
export const sampleGamma = (shape: number): number => {
  if (shape <= 0) return 0;
  if (shape < 1) {
    const u = randomUniform();
    return sampleGamma(shape + 1) * u ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    const x = randomNormal();
    let v = 1 + c * x;
    if (v <= 0) continue;
    v = v * v * v;
    const u = randomUniform();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
};

/**
 * Sample from Beta(a,b) via ratio of independent Gammas.
 * @param a Alpha (>0).
 * @param b Beta (>0).
 * @returns Random number in (0,1).
 */
export const sampleBeta = (a: number, b: number): number => {
  const x = sampleGamma(a);
  const y = sampleGamma(b);
  const s = x + y;
  return s > 0 ? x / s : 0.5;
};

/**
 * Continuous quantile by linear interpolation between sorted values.
 * @param arr Sample array.
 * @param q Quantile in [0,1].
 * @returns q-quantile value.
 */
export const quantile = (arr: number[], q: number): number => {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((x, y) => x - y);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const baseVal = sorted[base];
  if (baseVal === undefined) return NaN;
  const nextVal = sorted[base + 1];
  if (nextVal !== undefined) return baseVal + rest * (nextVal - baseVal);
  return baseVal;
};

/**
 * Arithmetic mean of numbers.
 * @param arr Values.
 * @returns Mean.
 */
export const mean = (arr: number[]): number =>
  arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

/**
 * Population standard deviation of numbers.
 * @param arr Values.
 * @returns Standard deviation.
 */
export const stddev = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  const v = arr.reduce((acc, x) => acc + (x - m) * (x - m), 0) / arr.length;
  return Math.sqrt(Math.max(0, v));
};

/**
 * Gaussian kernel density estimate over a grid.
 * @param samples Input samples.
 * @param grid Points to evaluate density on.
 * @param bandwidth Optional bandwidth; if omitted, Silverman's rule-of-thumb (bounded).
 * @returns Density values aligned with grid.
 */
export const kde = (
  samples: number[],
  grid: number[],
  bandwidth?: number,
): number[] => {
  if (samples.length === 0) return grid.map(() => 0);
  const sd = stddev(samples) || 1e-3;
  const h =
    bandwidth ?? Math.max(0.005, Math.min(0.1, 1.06 * sd * samples.length ** (-1 / 5)));
  const invH = 1 / h;
  const invSqrt2Pi = 1 / Math.sqrt(2 * Math.PI);
  const n = samples.length;
  return grid.map((xi) => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      if (s === undefined) continue;
      const z = (xi - s) * invH;
      sum += Math.exp(-0.5 * z * z) * invH * invSqrt2Pi;
    }
    return sum / n;
  });
};
