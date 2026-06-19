import { getFarmQuantityPrice } from "@/libs/farming";

type FarmTransactionSummaryProps = {
  verb: string;
  quantity: number;
  itemName: string;
  unitPrice?: number;
  suffix?: string;
};

export function FarmTransactionSummary({
  verb,
  quantity,
  itemName,
  unitPrice,
  suffix = "farm coins",
}: FarmTransactionSummaryProps) {
  return (
    <p className="rounded-md bg-muted px-2 py-1.5 text-muted-foreground text-xs">
      {verb} {quantity}× {itemName}
      {unitPrice !== undefined
        ? ` · ${getFarmQuantityPrice(unitPrice, quantity).toLocaleString()} ${suffix}`
        : ""}
    </p>
  );
}
