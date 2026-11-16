const SUFFIXES = ["", "K", "M", "B", "T", "q", "Q", "s", "S", "o", "n", "d"];

/** Short-scale number for HUDs and damage numbers: 999, 1.2K, 34M, 5.6B, then 1.2e39. */
export const formatTdNumber = (value: number) => {
  if (!Number.isFinite(value)) return "∞";
  const sign = value < 0 ? "-" : "";
  let amount = Math.abs(value);
  if (amount < 1000) return `${sign}${Math.floor(amount)}`;
  let tier = 0;
  while (amount >= 999.5 && tier < SUFFIXES.length - 1) {
    amount /= 1000;
    tier++;
  }
  // Past the last suffix, a short exponent keeps the number readable: 1.23e45.
  if (amount >= 999.5) {
    const [mantissa = "", exponent = ""] = Math.abs(value).toExponential(2).split("e+");
    return `${sign}${mantissa.replace(/\.?0+$/, "")}e${exponent}`;
  }
  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${sign}${amount.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1")}${SUFFIXES[tier]}`;
};
