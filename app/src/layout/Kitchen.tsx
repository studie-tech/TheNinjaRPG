"use client";

import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Progress } from "@/components/ui/progress";
import { MAX_COOKING_BATCHES } from "@/drizzle/constants";
import { ActiveTimedBuffs } from "@/layout/ActiveTimedBuffs";
import ContentBox from "@/layout/ContentBox";
import ContentImage from "@/layout/ContentImage";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { TimedQueue } from "@/layout/TimedQueue";
import {
  describeMealEffect,
  getCookingLevel,
  getCookingRankProgress,
  getCookingSeconds,
} from "@/libs/cooking";
import { getTotalItemQuantity } from "@/libs/crafting";
import { getTerritoryWarBoost } from "@/libs/territoryWar";
import { showMutationToast } from "@/libs/toast";
import { formatSecondsToTimeDisplay } from "@/utils/time";
import { useRequiredUserData } from "@/utils/UserContext";
import { countBoostingShrines, getShrineBoost } from "@/utils/village";

/** Recipe selection, batch production, Cooking progression, and active meal effects. */
export default function Kitchen({ image }: { image?: string }) {
  const { data: user } = useRequiredUserData();
  const utils = api.useUtils();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [batches, setBatches] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const recipeTriggerRef = useRef<HTMLButtonElement>(null);
  const recipes = api.occupation.getCookingRecipes.useQuery();
  const inventory = api.item.getUserItems.useQuery();
  const queue = api.occupation.getCraftingQueue.useQuery(undefined, {
    refetchInterval: 15000,
  });
  const refresh = async () => {
    await Promise.all([
      utils.item.getUserItems.invalidate(),
      utils.item.getUserItemsWithVariants.invalidate(),
      utils.occupation.getCraftingQueue.invalidate(),
      utils.profile.getUser.invalidate(),
      utils.profile.getSidebarTimers.invalidate(),
    ]);
  };
  const cook = api.occupation.craftItem.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      setMessage(result.message);
      if (result.success) {
        setSelectedId("");
        setBatches(1);
        await refresh();
      }
    },
    onError: (error) => setMessage(error.message),
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const cancel = api.occupation.cancelQueuedCraft.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      setMessage(result.message);
      await refresh();
    },
    onError: (error) => setMessage(error.message),
  });
  const selected = recipes.data?.find((recipe) => recipe.id === selectedId);
  const level = getCookingLevel(user?.cookingExperience ?? 0);
  const progress = getCookingRankProgress(user?.cookingExperience ?? 0);
  const active = inventory.data?.find(
    (owned) => owned.craftingFinishedAt && owned.craftingFinishedAt > new Date(),
  );
  const waiting = queue.data?.waiting ?? [];
  const isFull = (active ? 1 : 0) + waiting.length >= (queue.data?.capacity ?? 1);
  const validQuantity =
    Number.isInteger(batches) && batches >= 1 && batches <= MAX_COOKING_BATCHES;
  const hasIngredients = selected?.craftingRequirements.every(
    (requirement) =>
      getTotalItemQuantity(inventory.data ?? [], requirement.requirementItemId) >=
      requirement.quantity * batches,
  );
  const shrineBoost = getShrineBoost(
    countBoostingShrines(user?.village?.sectors),
    "Crafting",
    user?.village,
  );
  const blocked =
    user?.status !== "AWAKE"
      ? "You must be awake to cook"
      : isFull
        ? "Your shared Crafting and Cooking queue is full"
        : !selected
          ? "Select a recipe"
          : level < selected.cookingMinLevel
            ? `Cooking level ${selected.cookingMinLevel} required`
            : !validQuantity
              ? `Choose 1–${MAX_COOKING_BATCHES} batches`
              : !hasIngredients
                ? "Missing ingredients"
                : null;
  const filtered =
    recipes.data?.filter((recipe) =>
      recipe.name.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];

  if (!user || recipes.isPending || inventory.isPending || queue.isPending)
    return <Loader explanation="Loading kitchen" />;
  if (recipes.isError || inventory.isError || queue.isError)
    return (
      <div role="alert">
        Unable to load your kitchen.{" "}
        <Button
          onClick={() => {
            void recipes.refetch();
            void inventory.refetch();
            void queue.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );

  return (
    <div className="space-y-4">
      <ContentBox
        title="Your Kitchen"
        subtitle={`${progress.rank.title} · Cooking level ${level}`}
        topRightContent={
          image ? (
            <ContentImage
              image={image}
              alt="Your kitchen"
              className="h-16 w-16 object-contain"
              hideBorder
            />
          ) : undefined
        }
      >
        <p>{(user?.cookingExperience ?? 0).toLocaleString()} total Cooking XP</p>
        <Progress
          value={progress.progress}
          className="my-2"
          aria-label="Cooking rank progress"
        />
        <p className="text-muted-foreground text-sm">
          {progress.next
            ? `${progress.next.title} at level ${progress.next.level} (${progress.nextExperience?.toLocaleString()} XP)`
            : "Highest Cooking rank reached"}
        </p>
        <p className="mt-2 text-sm">
          Cooking XP is awarded when meals finish. Ingredients are reserved when you
          start. Meals continue cooking while you are offline.
        </p>
      </ContentBox>
      <TimedQueue
        title="Crafting & Cooking Queue"
        subtitle="Shared production capacity"
        capacity={queue.data?.capacity ?? 1}
        help="Cooking and Crafting share one active slot and the same waiting slots. Cancel a waiting job to return its reserved ingredients."
        active={
          active
            ? {
                title: `${active.quantity}× ${active.item.name}`,
                finishesAt: active.craftingFinishedAt!,
              }
            : null
        }
        waiting={waiting.map((job) => ({
          id: job.id,
          title: `${job.quantity}× ${job.name}`,
          startsAt: job.startsAt,
          finishesAt: job.finishesAt,
        }))}
        onCancel={(id) => cancel.mutate({ queueId: id })}
        cancelLabel="Cancel and return ingredients"
        isPending={cancel.isPending || cook.isPending}
        emptyText="Choose a recipe to start cooking."
        onActiveFinish={() => {
          void refresh();
        }}
      />
      <ActiveTimedBuffs />
      <ContentBox title="Meal Recipes" subtitle="Prepare a meal">
        <Input
          aria-label="Search meal recipes"
          placeholder="Search recipes"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {filtered.length === 0 && (
          <p className="py-4 text-muted-foreground">No meal recipes available.</p>
        )}
        <div className="my-3 grid gap-3 sm:grid-cols-2">
          {filtered.map((recipe) => {
            const locked = level < recipe.cookingMinLevel;
            const missing = recipe.craftingRequirements.some(
              (requirement) =>
                getTotalItemQuantity(
                  inventory.data ?? [],
                  requirement.requirementItemId,
                ) < requirement.quantity,
            );
            return (
              <button
                type="button"
                key={recipe.id}
                aria-haspopup="dialog"
                className={`rounded border p-3 text-left ${selectedId === recipe.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                onClick={(event) => {
                  recipeTriggerRef.current = event.currentTarget;
                  setSelectedId(recipe.id);
                  setBatches(1);
                  setMessage(null);
                }}
              >
                <div className="flex items-center gap-3">
                  <ContentImage
                    image={recipe.image}
                    alt={recipe.name}
                    className="h-14 w-14 rounded object-cover"
                  />
                  <div>
                    <p className="font-bold">{recipe.name}</p>
                    <p className="text-xs">
                      {recipe.rarity} · Cooking level {recipe.cookingMinLevel}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-sm">{describeMealEffect(recipe)}</p>
                <p className="mt-1 text-xs">
                  {recipe.cookingOutputQuantity} meals ·{" "}
                  {formatSecondsToTimeDisplay(
                    getCookingSeconds(
                      recipe,
                      1,
                      shrineBoost,
                      user ? getTerritoryWarBoost(user) : 0,
                    ),
                  )}{" "}
                  ·{" "}
                  {Math.floor(
                    recipe.cookingExperience *
                      recipe.cookingOutputQuantity *
                      (1 + (user ? getTerritoryWarBoost(user) : 0)),
                  )}{" "}
                  XP
                </p>
                <p className="mt-1 text-xs">
                  {locked
                    ? `Locked: requires Cooking level ${recipe.cookingMinLevel}`
                    : missing
                      ? "Missing ingredients"
                      : "Ready to cook"}
                </p>
              </button>
            );
          })}
        </div>
        {message && !selected && (
          <p role="status" className="mt-3 text-sm">
            {message}
          </p>
        )}
      </ContentBox>
      <Modal
        title={selected?.name ?? "Recipe Details"}
        isOpen={!!selected}
        setIsOpen={(open) => {
          if (!open && !cook.isPending) {
            setSelectedId("");
            setBatches(1);
          }
        }}
        returnFocusRef={recipeTriggerRef}
        proceed_label={active || waiting.length ? "Queue meal" : "Start cooking"}
        proceed_loading_label="Preparing…"
        isLoading={cook.isPending}
        keepOpenOnAccept
        proceedDisabled={!!blocked}
        onAccept={() => {
          if (!selected || inFlight.current || blocked) return;
          inFlight.current = true;
          setMessage(null);
          cook.mutate({ itemId: selected.id, quantity: batches });
        }}
      >
        {selected && (
          <div className="space-y-3">
            <p className="text-sm">{selected.description}</p>
            <p className="text-sm">{describeMealEffect(selected)}</p>
            <ul className="text-sm">
              {selected.craftingRequirements.map((requirement) => {
                const owned = getTotalItemQuantity(
                  inventory.data ?? [],
                  requirement.requirementItemId,
                );
                const needed = requirement.quantity * (validQuantity ? batches : 1);
                return (
                  <li
                    key={requirement.id}
                    className={owned < needed ? "text-red-600" : ""}
                  >
                    {requirement.requirementItem?.name ?? "Removed ingredient"}: {owned}{" "}
                    / {needed}
                  </li>
                );
              })}
            </ul>
            <label className="block text-sm" htmlFor="cooking-batches">
              Batches (each produces {selected.cookingOutputQuantity} meals)
            </label>
            <NumberInput
              id="cooking-batches"
              value={batches}
              onValueChange={setBatches}
              min={1}
              max={MAX_COOKING_BATCHES}
              disabled={cook.isPending}
            />
            {validQuantity && (
              <p className="text-sm">
                Output: {batches * selected.cookingOutputQuantity} meals ·{" "}
                {formatSecondsToTimeDisplay(
                  getCookingSeconds(
                    selected,
                    batches,
                    shrineBoost,
                    user ? getTerritoryWarBoost(user) : 0,
                  ),
                )}{" "}
                ·{" "}
                {Math.floor(
                  batches *
                    selected.cookingOutputQuantity *
                    selected.cookingExperience *
                    (1 + (user ? getTerritoryWarBoost(user) : 0)),
                )}{" "}
                XP on completion
              </p>
            )}
            {blocked && <p className="text-muted-foreground text-sm">{blocked}</p>}
            {message && (
              <p role="status" className="text-sm">
                {message}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
