"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  Gavel,
  Hammer,
  Handshake,
  List,
  ShoppingCart,
} from "lucide-react";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AUCTION_HOUSE_MIN_LEVEL,
  AUCTION_LISTING_STATES,
  type AuctionListingState,
  auctionHouseLevelMessage,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { capitalizeFirstLetter } from "@/utils/string";
import { useRequireInVillage } from "@/utils/UserContext";
import { AuctionListing, type BrowseTab } from "./Listings";
import { NewAuctionListingDialog } from "./NewListingDialog";
import { AuctionOffers, NewOfferDialog } from "./Offers";

export default function AuctionHousePage() {
  // Settings
  const { userData, access } = useRequireInVillage("/auctionhouse");

  const [browseTab, setBrowseTab] = useState<BrowseTab>("AUCTION");

  // State
  const [selectedStatus, setSelectedStatus] = useState<AuctionListingState>("ACTIVE");

  // Guards
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Auction House" />;

  const belowAuctionMinLevel = userData.level < AUCTION_HOUSE_MIN_LEVEL;
  const isOfferTab = browseTab === "REQUEST" || browseTab === "TRADE";

  return (
    <ContentBox
      title="Auction House"
      subtitle="Buy, sell or exchange items"
      defaultBackHref="/village"
      topRightContent={
        <div className="mb-2 flex items-center justify-end gap-2">
          <Select
            value={selectedStatus}
            onValueChange={(value) => setSelectedStatus(value as AuctionListingState)}
          >
            <SelectTrigger aria-label="Listing status" className="w-28 px-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUCTION_LISTING_STATES.filter(
                (status) => !isOfferTab || status !== "EXPIRED",
              ).map((status) => (
                <SelectItem key={status} value={status}>
                  {isOfferTab && status === "SOLD"
                    ? "Completed"
                    : capitalizeFirstLetter(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!belowAuctionMinLevel &&
            (browseTab === "REQUEST" || browseTab === "TRADE" ? (
              <NewOfferDialog
                key={browseTab}
                offerType={browseTab}
                onCreated={() => setSelectedStatus("ACTIVE")}
              />
            ) : (
              <NewAuctionListingDialog
                key={browseTab === "DIRECT" ? "DIRECT" : "AUCTION"}
                defaultListingType={browseTab === "DIRECT" ? "DIRECT" : "AUCTION"}
                onCreated={() => {
                  setSelectedStatus("ACTIVE");
                  if (browseTab === "MY_BIDS") setBrowseTab("MINE");
                }}
              />
            ))}
        </div>
      }
    >
      {belowAuctionMinLevel && (
        <p className="border-b px-4 py-3 text-center text-muted-foreground text-sm">
          {auctionHouseLevelMessage}
        </p>
      )}
      <Tabs
        value={browseTab}
        onValueChange={(value) => {
          setBrowseTab(value as BrowseTab);
          if (
            (value === "REQUEST" || value === "TRADE") &&
            selectedStatus === "EXPIRED"
          ) {
            setSelectedStatus("ACTIVE");
          }
        }}
      >
        <div className="border-b pb-3">
          <div className="flex flex-col gap-2">
            <TabsList
              className="grid grid-cols-3 xl:grid-cols-6"
              aria-label="Auction House"
            >
              {BROWSE_TAB_OPTIONS.map(({ key, label, Icon }) => (
                <TabsTrigger
                  key={key}
                  value={key}
                  className="min-h-[44px] flex-col gap-1 whitespace-normal rounded-lg px-1 py-2.5 font-semibold text-[11px] sm:text-xs xl:flex-row xl:gap-2 xl:py-3 xl:text-sm"
                >
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0 opacity-90" />
                  <span className="text-center leading-tight">{label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            <p className="text-balance text-center text-muted-foreground text-xs leading-relaxed">
              {
                BROWSE_TAB_OPTIONS.find((option) => option.key === browseTab)
                  ?.description
              }
            </p>
          </div>
        </div>
        <TabsContent value={browseTab} className="mt-0">
          {browseTab === "REQUEST" || browseTab === "TRADE" ? (
            <AuctionOffers
              key={browseTab}
              offerType={browseTab}
              status={selectedStatus}
            />
          ) : (
            <AuctionListing browseTab={browseTab} selectedStatus={selectedStatus} />
          )}
        </TabsContent>
      </Tabs>
    </ContentBox>
  );
}

const BROWSE_TAB_OPTIONS: {
  key: BrowseTab;
  label: string;
  Icon: LucideIcon;
  description: string;
}[] = [
  {
    key: "AUCTION",
    label: "Auctions",
    Icon: Gavel,
    description: "Bid on items until the timer ends, or buy out at the listed price.",
  },
  {
    key: "DIRECT",
    label: "Direct sales",
    Icon: Handshake,
    description: "Private sales — only the chosen player can accept the offer.",
  },
  {
    key: "REQUEST",
    label: "Requests",
    Icon: ShoppingCart,
    description:
      "Buy materials at a fixed total price, or supply another player's request to earn ryo.",
  },
  {
    key: "TRADE",
    label: "Trades",
    Icon: ArrowLeftRight,
    description:
      "Exchange items without currency. Inspect the offered item before accepting.",
  },
  {
    key: "MINE",
    label: "My auctions",
    Icon: List,
    description:
      "Your auctions and direct sales. Find your requests and trades in their own tabs.",
  },
  {
    key: "MY_BIDS",
    label: "My bids",
    Icon: Hammer,
    description:
      "Auctions you have bid on — see whether you are leading or have been outbid.",
  },
];
