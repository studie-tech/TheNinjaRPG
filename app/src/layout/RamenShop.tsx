"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  IMG_RAMEN_LARGE,
  IMG_RAMEN_MEDIUM,
  IMG_RAMEN_SMALL,
  IMG_RAMEN_WELCOME,
} from "@/drizzle/constants";
import { useTutorialStep } from "@/hooks/tutorial";
import BanInfo from "@/layout/BanInfo";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import type { RamenOption } from "@/utils/ramen";
import { calcRamenPrice, getRamenHealPercentage } from "@/utils/ramen";
import { useAwake } from "@/utils/routing";
import { formatAmount } from "@/utils/string";
import { useRequiredUserData } from "@/utils/UserContext";

interface RamenShopProps {
  initialBreak?: boolean;
  defaultBackHref?: string;
  /** Replaces the default subtitle where the shop sits inside another feature. */
  subtitle?: string;
  showImage?: boolean;
}

const RamenShop: React.FC<RamenShopProps> = (props) => {
  return (
    <ContentBox
      title="Ramen Shop"
      subtitle={props.subtitle ?? "Healthy food to regain chakra & stamina"}
      defaultBackHref={props.defaultBackHref}
      padding={false}
      initialBreak={props.initialBreak}
    >
      <RamenMenu showImage={props.showImage} />
    </ContentBox>
  );
};

export default RamenShop;

/** Food menu of the ramen shop, optionally under its welcome banner. */
export const RamenMenu = ({ showImage }: RamenMenuProps) => {
  const { data: userData, prepareUserUpdate, updateUser } = useRequiredUserData();
  const { completeTutorialAction } = useTutorialStep();
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const { mutate, isPending } = api.village.buyFood.useMutation({
    onMutate: () => {
      setPurchaseError(null);
      return prepareUserUpdate();
    },
    onSuccess: async (data, _variables, revision) => {
      showMutationToast(data);
      if (!data.success) setPurchaseError(data.message);
      if (!data.success && data.userRecovery) await updateUser(data, { revision });
      if (data.success && userData) {
        await updateUser(data, { revision });
        void completeTutorialAction("buyRamen");
      }
    },
    onError: (error) => setPurchaseError(error.message),
  });

  useAwake(userData, { allowActionRecovery: true });

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (userData.isBanned) return <BanInfo />;

  const isFull =
    userData.curStamina >= userData.maxStamina &&
    userData.curChakra >= userData.maxChakra;

  return (
    <>
      {showImage && (
        <Image
          alt="Ramen shop"
          src={IMG_RAMEN_WELCOME}
          width={512}
          height={221}
          className="w-full"
        />
      )}
      {purchaseError && (
        <p role="alert" className="px-3 text-destructive text-sm">
          {purchaseError}
        </p>
      )}
      {isFull && !isPending && (
        <p
          role="status"
          className="px-3 pt-3 text-center text-muted-foreground text-sm"
        >
          Your stamina and chakra are full. Come back after training or battle.
        </p>
      )}
      {isPending && <Loader explanation="Purchasing food" />}
      <div
        id="tutorial-ramen-menu"
        className={`grid grid-cols-3 p-3 text-center font-bold italic ${isPending ? "hidden" : ""}`}
      >
        <MenuEntry
          title="Small Bowl"
          entry="small"
          image={IMG_RAMEN_SMALL}
          userData={userData}
          isPending={isPending}
          onPurchase={() => mutate({ ramen: "small" })}
        />
        <MenuEntry
          title="Medium Bowl"
          entry="medium"
          image={IMG_RAMEN_MEDIUM}
          userData={userData}
          isPending={isPending}
          onPurchase={() => mutate({ ramen: "medium" })}
        />
        <MenuEntry
          title="Large Bowl"
          entry="large"
          image={IMG_RAMEN_LARGE}
          userData={userData}
          isPending={isPending}
          onPurchase={() => mutate({ ramen: "large" })}
        />
      </div>
    </>
  );
};

type RamenMenuProps = {
  showImage?: boolean;
};

interface MenuEntryProps {
  title: string;
  entry: RamenOption;
  image: string;
  userData: NonNullable<UserWithRelations>;
  isPending: boolean;
  onPurchase: () => void;
}

const MenuEntry: React.FC<MenuEntryProps> = (props) => {
  // Destructure
  const { title, entry, image, userData, isPending, onPurchase } = props;

  // Get current village
  const { data: sectorVillage } = api.travel.getVillageInSector.useQuery(
    { sector: userData?.sector ?? -1, isOutlaw: userData?.isOutlaw ?? false },
    // A loaded user without a sector would otherwise send the -1 placeholder, which
    // the sector schema rejects. Sector 0 is real, so test for presence, not truth.
    { enabled: userData?.sector != null },
  );

  // Convenience
  const healPerc = getRamenHealPercentage(entry);
  const cost = calcRamenPrice(entry, userData, sectorVillage?.structures);

  // Checks
  const canAfford = userData.money >= cost;
  const dSP = (100 * (userData.maxStamina - userData.curStamina)) / userData.maxStamina;
  const dCP = (100 * (userData.maxChakra - userData.curChakra)) / userData.maxChakra;
  const noDiff = dSP === 0 && dCP === 0;

  // Click handler
  const onClick = () => {
    if (!canAfford) {
      showMutationToast({ success: false, message: "You don't have enough money" });
    } else if (noDiff) {
      showMutationToast({ success: false, message: "You don't need to eat that much" });
    } else {
      onPurchase();
    }
  };

  const isUnavailable = !canAfford || noDiff;

  return (
    <button
      type="button"
      className={`text-center ${isUnavailable ? "cursor-not-allowed" : "hover:cursor-pointer"}`}
      disabled={isPending}
      onClick={onClick}
    >
      <Image
        alt={title}
        src={image}
        width={256}
        height={256}
        className={isUnavailable ? "opacity-50 grayscale" : "hover:opacity-30"}
      />
      <p>{title}</p>
      <p className="text-success">+{healPerc.toFixed()}% SP/CP</p>
      <p className="text-destructive">-{formatAmount(cost)} ryo</p>
      {!canAfford && (
        <p className="font-normal text-destructive text-sm">Not enough ryo</p>
      )}
    </button>
  );
};
