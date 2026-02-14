import { FlaskConical, Scissors, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  BLOODLINE_COST,
  REMOVAL_COST,
  ROLL_CHANCE_PERCENTAGE,
} from "@/drizzle/constants";
import type { Bloodline } from "@/drizzle/schema";
import BloodFiltering, { getFilter, useFiltering } from "@/layout/BloodlineFiltering";
import { ActionSelector } from "@/layout/CombatActions";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import NavTabs from "@/layout/NavTabs";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

/**
 * Show Current bloodline & let user remove it
 */
interface PurchaseBloodlineProps {
  initialBreak?: boolean;
}

/**
 * Let user purchase a new bloodline
 */
export const PurchaseBloodline: React.FC<PurchaseBloodlineProps> = (props) => {
  // State
  const { data: userData } = useRequiredUserData();
  const [bloodline, setBloodline] = useState<Bloodline | undefined>(undefined);
  const [isOpen, setIsOpen] = useState<boolean>(false);

  // Two-level filtering
  const state = useFiltering("A");

  // utils
  const utils = api.useUtils();

  // Fetch data
  const { data: bloodlines, isFetching } = api.bloodline.getAll.useInfiniteQuery(
    { ...getFilter(state), limit: 500 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allBloodlines = bloodlines?.pages
    .flatMap((page) => page.data)
    .filter((b) => !b.villageId || b.villageId === userData?.villageId);

  // Mutations
  const { mutate: purchase, isPending: isPurchasing } =
    api.bloodline.purchaseBloodline.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.profile.getUser.invalidate();
      },
      onSettled: () => {
        setIsOpen(false);
        document.body.style.cursor = "default";
      },
    });

  // Derived calculations
  const rank = state.rank === "None" ? "D" : state.rank;
  const cost = BLOODLINE_COST[rank];
  const canAfford = userData?.reputationPoints && userData.reputationPoints >= cost;

  return (
    <ContentBox
      id="tutorial-bloodline-purchase"
      title="Bloodline"
      subtitle="Purchase special abilities"
      initialBreak={props.initialBreak}
      topRightContent={
        <div className="flex flex-row gap-2">
          <NavTabs
            current={state.rank}
            options={["D", "C", "B", "A"]}
            setValue={state.setRank}
          />
          <BloodFiltering state={state} limitRanks={["D", "C", "B", "A"]} />
        </div>
      }
    >
      {userData && (
        <div className="pb-2">
          <p className="pb-2">
            {rank}-rank bloodline costs <b>{cost} reputation points</b>. You have{" "}
            <span className={`${!canAfford ? "text-red-500" : ""} font-bold`}>
              {userData.reputationPoints} points.{" "}
            </span>
          </p>
          {!canAfford && (
            <Link href="/points">
              <Button className="w-full" decoration="gold" animation="pulse">
                <Star className="mr-2 h-6 w-6" />
                Purchase Reputation Points
              </Button>
            </Link>
          )}
        </div>
      )}

      {!isFetching && (
        <ActionSelector
          items={allBloodlines}
          selectedId={bloodline?.id}
          showBgColor={false}
          showLabels={true}
          onClick={(id) => {
            if (id === bloodline?.id) {
              setBloodline(undefined);
              setIsOpen(false);
            } else {
              setBloodline(allBloodlines?.find((b) => b.id === id));
              setIsOpen(true);
            }
          }}
        />
      )}
      {isFetching && <Loader explanation="Loading bloodlines" />}
      {isOpen && userData && bloodline && (
        <Modal2
          title="Confirm Purchase"
          proceed_label={
            isPurchasing
              ? undefined
              : canAfford
                ? `Buy for ${cost} reps`
                : `Need ${cost - userData.reputationPoints} reps`
          }
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          isValid={false}
          onAccept={() => {
            if (canAfford) {
              purchase({ bloodlineId: bloodline.id });
            } else {
              setIsOpen(false);
            }
          }}
          confirmClassName={
            canAfford
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-red-600 text-white hover:bg-red-700"
          }
        >
          {!isPurchasing && <ItemWithEffects item={bloodline} key={bloodline.id} />}
          {isPurchasing && <Loader explanation={`Purchasing ${bloodline.name}`} />}
        </Modal2>
      )}
    </ContentBox>
  );
};

/**
 * Show Current bloodline & let user remove it
 */
interface CurrentBloodlineProps {
  bloodlineId: string;
  initialBreak?: boolean;
}

export const CurrentBloodline: React.FC<CurrentBloodlineProps> = (props) => {
  // Get current bloodline
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();
  const { data, isFetching } = api.bloodline.get.useQuery(
    { id: props.bloodlineId },
    {},
  );

  // Mutations
  const { mutate: remove, isPending: isRemoving } =
    api.bloodline.removeBloodline.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getUser.invalidate();
        }
      },
    });

  // Can afford removing
  const canAfford =
    userData?.reputationPoints && userData.reputationPoints >= REMOVAL_COST;

  return (
    <ContentBox
      title="Bloodline"
      subtitle="Genetic Details"
      initialBreak={props.initialBreak}
    >
      {(isFetching || isRemoving) && <Loader explanation="Loading bloodline" />}
      {!isFetching && data && userData && (
        <>
          <ItemWithEffects item={data} key={data.id} />
          <Confirm2
            title="Bloodline Removal"
            proceed_label={
              canAfford
                ? `Remove for ${REMOVAL_COST} reps`
                : `Need ${userData.reputationPoints - REMOVAL_COST} more reps`
            }
            isValid={!isFetching}
            button={
              <Button id="check" className="w-full">
                <Scissors className="mr-2 h-6 w-6" />
                Remove Bloodline
              </Button>
            }
            onAccept={(e) => {
              e.preventDefault();
              if (canAfford) remove();
            }}
          >
            <p>
              Confirm using <b>{REMOVAL_COST} reputation points</b> to have the doctors
              at the hospital remove your bloodline.
            </p>
          </Confirm2>
        </>
      )}
    </ContentBox>
  );
};

/**
 * Component for rolling a new bloodline
 */
interface RollBloodlineProps {
  refetch: () => void;
  initialBreak?: boolean;
}
export const RollBloodline: React.FC<RollBloodlineProps> = (props) => {
  const utils = api.useUtils();
  // State
  const { mutate: roll, isPending: isRolling } = api.bloodline.roll.useMutation({
    onSuccess: async (data) => {
      props.refetch();
      showMutationToast({ ...data, title: "Bloodline Roll" });
      if (data.success) {
        await utils.profile.getUser.invalidate();
      }
    },
  });

  return (
    <div className="p-3">
      {isRolling && <Loader explanation="Rolling bloodline" />}
      <Confirm2
        title="Confirm Roll - Check Genetics"
        proceed_label="Roll"
        isValid={!isRolling}
        button={
          <Button id="check" className="w-full">
            <FlaskConical className="mr-2 h-6 w-6" />
            Talk with Bloodline Experts
          </Button>
        }
        onAccept={(e) => {
          e.preventDefault();
          roll();
        }}
      >
        <p>
          You are about to get your genetics checked to see if you have a bloodline.
          Statistically, the chances for the different ranks of bloodlines are:
        </p>
        <ul className="pt-3 pl-5">
          <li>S-Ranked: {ROLL_CHANCE_PERCENTAGE.S * 100}%</li>
          <li>A-Ranked: {ROLL_CHANCE_PERCENTAGE.A * 100}%</li>
          <li>B-Ranked: {ROLL_CHANCE_PERCENTAGE.B * 100}%</li>
          <li>C-Ranked: {ROLL_CHANCE_PERCENTAGE.C * 100}%</li>
        </ul>
        <p className="pt-3">
          <b>NOTE:</b> If you have an existing bloodline it will be replaced in the
          event a bloodline would be rewarded, if no bloodline would be rewarded your
          previous bloodline will not be removed.
        </p>
      </Confirm2>
    </div>
  );
};
