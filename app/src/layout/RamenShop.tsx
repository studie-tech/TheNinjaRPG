"use client";

import Image from "next/image";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import BanInfo from "@/layout/BanInfo";
import { api } from "@/app/_trpc/client";
import { getRamenHealPercentage, calcRamenCost } from "@/utils/ramen";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";
import { getStrucBoost } from "@/utils/village";
import { useAwake } from "@/utils/routing";
import {
  IMG_RAMEN_WELCOME,
  IMG_RAMEN_SMALL,
  IMG_RAMEN_MEDIUM,
  IMG_RAMEN_LARGE,
} from "@/drizzle/constants";
import type { RamenOption } from "@/utils/ramen";
import type { UserWithRelations } from "@/routers/profile";

interface RamenShopProps {
  initialBreak?: boolean;
  defaultBackHref?: string;
  showImage?: boolean;
}

const RamenShop: React.FC<RamenShopProps> = (props) => {
  const { data: userData, updateUser } = useRequiredUserData();

  const { mutate, isPending } = api.village.buyFood.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success && userData) {
        await updateUser({
          money: userData.money - (data?.cost || 0),
          curHealth: data?.newHealth || userData.curHealth,
          curStamina: data?.newStamina || userData.curStamina,
          curChakra: data?.newChakra || userData.curChakra,
        });
      }
    },
  });

  useAwake(userData);

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (userData.isBanned) return <BanInfo />;

  return (
    <ContentBox
      title="Ramen Shop"
      subtitle="Healthy food to regain chakra & stamina"
      defaultBackHref={props.defaultBackHref}
      padding={false}
      initialBreak={props.initialBreak}
    >
      {props.showImage && (
        <Image
          alt="welcome"
          src={IMG_RAMEN_WELCOME}
          width={512}
          height={221}
          className="w-full"
        />
      )}
      {isPending && <Loader explanation="Purchasing food" />}
      {!isPending && (
        <div className="grid grid-cols-3 text-center font-bold italic p-3">
          <MenuEntry
            title="Small Bowl"
            entry="small"
            image={IMG_RAMEN_SMALL}
            userData={userData}
            onPurchase={() => mutate({ ramen: "small" })}
          />
          <MenuEntry
            title="Medium Bowl"
            entry="medium"
            image={IMG_RAMEN_MEDIUM}
            userData={userData}
            onPurchase={() => mutate({ ramen: "medium" })}
          />
          <MenuEntry
            title="Large Bowl"
            entry="large"
            image={IMG_RAMEN_LARGE}
            userData={userData}
            onPurchase={() => mutate({ ramen: "large" })}
          />
        </div>
      )}
    </ContentBox>
  );
};

export default RamenShop;

interface MenuEntryProps {
  title: string;
  entry: RamenOption;
  image: string;
  userData: NonNullable<UserWithRelations>;
  onPurchase: () => void;
}

const MenuEntry: React.FC<MenuEntryProps> = (props) => {
  // Destructure
  const { title, entry, image, userData, onPurchase } = props;

  // Get current village
  const { data: sectorVillage } = api.travel.getVillageInSector.useQuery(
    { sector: userData?.sector ?? -1, isOutlaw: userData?.isOutlaw ?? false },
    { enabled: !!userData },
  );

  // Get structure discount
  const discount = getStrucBoost("ramenDiscountPerLvl", sectorVillage?.structures);

  // Convenience
  const factor = (100 - discount) / 100;
  const healPerc = getRamenHealPercentage(entry);
  const cost = calcRamenCost(entry, userData) * factor;

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

  return (
    <div className="hover:cursor-pointer" onClick={onClick}>
      <Image
        alt={title}
        src={image}
        width={256}
        height={256}
        className={`hover:opacity-30 ${!canAfford || noDiff ? "grayscale opacity-50 cursor-not-allowed" : ""}`}
      />
      <p>{title}</p>
      <p className="text-green-700">+{healPerc.toFixed()}% SP/CP</p>
      <p className="text-red-700">-{cost.toFixed(2)} ryo</p>
    </div>
  );
};
