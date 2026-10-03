import type { MerchMoney, MerchProduct } from "@/validators/merch";
import designs from "./designs.json";

export const MERCH_DESIGNS = designs;
export const getMerchDesign = (key: string) => MERCH_DESIGNS.find((d) => d.key === key);
export const findMerchDesign = (title: string, tags: string[] = []) =>
  MERCH_DESIGNS.find((d) => tags.includes(`design:${d.key}`)) ??
  MERCH_DESIGNS.find((d) => title.toLowerCase().includes(d.name.toLowerCase()));

export const formatMerchMoney = (money: MerchMoney | null) =>
  money
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: money.currencyCode,
      }).format(Number(money.amount))
    : "Price at launch";

export const productFromPrice = (product: MerchProduct) => {
  const prices = product.variants.flatMap((v) => (v.price ? [v.price] : []));
  return prices.sort((a, b) => Number(a.amount) - Number(b.amount))[0] ?? null;
};
