import { Coins, Gem, Lock, Star } from "lucide-react";
import { cn } from "@/libs/shadui";
import type { ShopCurrency, ShopPrice } from "@/libs/shop";
import { missingForPrices } from "@/libs/shop";

/**
 * Each price as a pill with its currency icon. A price the player cannot pay turns grey with
 * a lock, and one line says how much is missing, so the state never rests on colour alone.
 */
export function ShopPriceTag({
  prices,
  wallet,
  quantity = 1,
  silverLabel,
}: {
  prices: ShopPrice[];
  wallet: Record<ShopCurrency, number>;
  quantity?: number;
  silverLabel: string;
}) {
  const missing = missingForPrices(prices, wallet, quantity);
  const label = (currency: ShopCurrency) =>
    currency === "silver" ? silverLabel : currency;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {prices.map(({ currency, amount }) => {
        const isShort = missing.some((entry) => entry.currency === currency);
        const Icon = isShort ? Lock : CURRENCY_ICON[currency];
        return (
          <span
            key={currency}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums",
              isShort
                ? "bg-muted text-muted-foreground ring-border ring-1 ring-inset"
                : "bg-amber-500/15 text-amber-900 dark:text-amber-200",
            )}
          >
            <Icon className="h-3 w-3 shrink-0" aria-hidden />
            {(amount * quantity).toLocaleString()} {label(currency)}
          </span>
        );
      })}
      {missing.length > 0 && (
        // Always its own line, so every card keeps the same layout.
        <span className="text-destructive basis-full text-xs font-medium">
          Need{" "}
          {missing.length === 1
            ? missing[0]?.amount.toLocaleString()
            : missing
                .map(
                  ({ currency, amount }) =>
                    `${amount.toLocaleString()} ${label(currency)}`,
                )
                .join(", ")}{" "}
          more
        </span>
      )}
    </span>
  );
}

const CURRENCY_ICON = { ryo: Coins, rep: Star, silver: Gem } as const;
