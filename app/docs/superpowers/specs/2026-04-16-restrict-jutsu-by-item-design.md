# Design: Restrict Jutsu by Equipped Bloodline Item (Issue #987)

## Overview

Add a `requiredBloodlineItemId` field to jutsu so admins can require a player to have a specific
bloodline-associated item equipped before the jutsu is available in combat. Mirrors the existing
`bloodlineId` restriction pattern throughout the codebase.

---

## Architecture

### 1. Schema — `app/drizzle/schema.ts`

Add a nullable `requiredBloodlineItemId` column to the `jutsu` table:

```ts
requiredBloodlineItemId: varchar("requiredBloodlineItemId", { length: 191 }),
```

Add a Drizzle relation in `jutsuRelations`:

```ts
requiredBloodlineItem: one(item, {
  fields: [jutsu.requiredBloodlineItemId],
  references: [item.id],
}),
```

No index needed — this column is not used in hot-path WHERE clauses.

### 2. Migration

Run `make makemigrations` after the schema change to generate the Drizzle migration file.

### 3. Validator — `app/src/validators/combat.ts`

Add to `JutsuValidatorRawSchema`:

```ts
requiredBloodlineItemId: z.string().nullable(),
```

### 4. Item router — `app/src/server/api/routers/item.ts`

Add a thin `getBloodlineNames` endpoint (MathiasGruber rule #4 — don't reuse fat `getAllNames`
for a thin use case):

```ts
getBloodlineNames: publicProcedure.query(async ({ ctx }) => {
  return await ctx.drizzle.query.item.findMany({
    columns: { id: true, name: true },
    where: isNotNull(item.bloodlineId),
    orderBy: (table, { asc }) => [asc(table.name)],
  });
}),
```

### 5. Admin editor — `app/src/hooks/jutsu.ts`

- Add `api.item.getBloodlineNames.useQuery(undefined)` query; include its `isPending` in `loading`.
- Add a `formData` entry after `bloodlineId`:

```ts
{
  id: "requiredBloodlineItemId",
  label: "Required Bloodline Item",
  type: "db_values",
  values: bloodlineItems,
  resetButton: true,
},
```

### 6. Combat runtime check — `app/src/server/api/routers/combat.ts`

Inside the `initiateBattle` jutsu filter (~line 2633), add a guard **before** the existing
bloodline `return`:

```ts
// Exclude jutsu if required bloodline item is not equipped
if (
  userjutsu.jutsu.requiredBloodlineItemId &&
  !user.isAi &&
  !user.items.some(
    (ui) =>
      ui.itemId === userjutsu.jutsu.requiredBloodlineItemId &&
      ui.equipped !== "NONE",
  )
) {
  return false;
}
```

`user.items` at this point is the raw loaded items array (DB data not yet filtered for battle),
so the check is accurate. No additional DB query needed — satisfies the CLAUDE.md
`performAction` one-fetch rule and MathiasGruber rule #1.

---

## Data Flow

```
Admin sets requiredBloodlineItemId on jutsu (only bloodline items listed in dropdown)
  ↓
Jutsu saved to DB with requiredBloodlineItemId
  ↓
Player enters battle → initiateBattle loads user.items (equipped items from DB)
  ↓
Jutsu filter: if requiredBloodlineItemId set AND item not equipped → jutsu excluded from battle
  ↓
Player's action list shown without restricted jutsu
```

---

## Scope: What This Does NOT Change

- **Training/learning**: `canUseJutsu` in `train.ts` is not modified. Item restriction is combat
  availability only, not a prerequisite for learning. The issue says "available if the player has
  the specified bloodline item equipped" — equipping is a runtime state.
- **`performAction`**: No changes. The jutsu is excluded at `initiateBattle` time; the action
  lookup in `performAction` inherits the filtered list.
- **Item `getAllNames`**: Not modified. A separate thin endpoint keeps this clean.

---

## MathiasGruber Review Checklist

- [x] All queries hoisted to top `Promise.all` — no new queries added; uses pre-loaded `user.items`
- [x] No second update to same row — no update logic changed
- [x] No duplicated predicate — single guard in the filter function
- [x] Thin endpoint for thin use case — `getBloodlineNames` returns only `{ id, name }`
- [x] No repetitive JSX blocks — no JSX added
- [x] Toggle guard scoped correctly — N/A

---

## Files Changed

| File | Change |
|---|---|
| `app/drizzle/schema.ts` | Add `requiredBloodlineItemId` column + relation to `jutsu` |
| `app/drizzle/migrations/…` | Generated migration file |
| `app/src/validators/combat.ts` | Add field to `JutsuValidatorRawSchema` |
| `app/src/server/api/routers/item.ts` | Add `getBloodlineNames` endpoint |
| `app/src/hooks/jutsu.ts` | Add query + formData entry |
| `app/src/server/api/routers/combat.ts` | Add item-equipped guard in jutsu filter |
