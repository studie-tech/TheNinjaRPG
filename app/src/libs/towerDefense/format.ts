const SUFFIXES = ["", "K", "M", "B", "T", "q", "Q", "s", "S", "o", "n", "d"];

/** Short-scale number for HUDs and damage numbers: 999, 1.2K, 34M, 5.6B and so on. */
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
  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${sign}${amount.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1")}${SUFFIXES[tier]}`;
};
