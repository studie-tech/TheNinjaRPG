"use client";

import {
  Cookie,
  Eye,
  EyeOff,
  GitMerge,
  HousePlus,
  Locate,
  MapPinned,
  Maximize2,
  Search,
  Swords,
  UserRoundSearch,
  Zap,
  ZapOff,
} from "lucide-react";
import dynamic from "next/dynamic";
import { Fragment, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  HIDEOUT_COST,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  MAX_TRAVEL_PIN_LABEL_LENGTH,
  MAX_TRAVEL_PINS,
  VILLAGE_LEAVE_REQUIRED_RANK,
  VILLAGE_REDUCED_GAINS_DAYS,
} from "@/drizzle/constants";
import type {
  AttackTarget,
  RevealedPlayer,
  TravelSession,
} from "@/hooks/useTravelSession";
import AutoAttackModal from "@/layout/AutoAttackModal";
import { CaravanControlsTrigger } from "@/layout/CaravanControls";
import { ActionSelector } from "@/layout/CombatActions";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import type { HeaderActionItem } from "@/layout/ContentBoxHeaderActions";
import { FindSectorPopover, SectorIdField } from "@/layout/FindSectorPopover";
import { HuntingArrival } from "@/layout/HuntingArrival";
import ItemLoadoutSelector from "@/layout/ItemLoadoutSelector";
import ItemWithEffects from "@/layout/ItemWithEffects";
import JutsuLoadoutSelector from "@/layout/JutsuLoadoutSelector";
import Loader from "@/layout/Loader";
import MapError from "@/layout/MapError";
import Modal from "@/layout/Modal";
import NavTabs from "@/layout/NavTabs";
import { TravelArrivalStatus } from "@/layout/TravelArrivalStatus";
import { TravelPositionLabel } from "@/layout/TravelPositionLabel";
import { StealthControls } from "@/layout/travel/StealthControls";
import { mapIconToolClassName as mapToolClassName } from "@/layout/travel/styles";
import { WarFieldActions } from "@/layout/WarFieldActions";
import { canAttemptAwakeAction } from "@/libs/actionReadiness";
import { nonCombatConsume } from "@/libs/item";
import { getItemConsumeInput } from "@/libs/itemConsumption";
import { hasRequiredRank } from "@/libs/rank";
import { calcGlobalTravelTime } from "@/libs/travel";
import { getReadableVillageHexColor } from "@/utils/color";

/** Render travel maps, controls and dialogs from a single session. */
export function TravelView({
  session,
  hasLocationRequest = false,
  immersive = false,
  isInteractive = true,
}: TravelViewProps) {
  const {
    showActive,
    setShowActive,
    setRevealOthersInTutorial,
    showOwnership,
    setShowOwnership,
    autoAttackMode,
    setAutoAttackMode,
    showModal,
    setShowModal,
    showSorrounding,
    setShowSorrounding,
    showAutoAttackModal,
    setShowAutoAttackModal,
    revealedPlayers,
    setRevealedPlayers,
    showRevealedPlayersModal,
    setShowRevealedPlayersModal,
    pendingAttackTarget,
    setPendingAttackTarget,
    activeTab,
    setActiveTab,
    focusSector,
    setFocusSector,
    isWorldExpanded,
    setWorldExpanded,
    cameraFocusRevision,
    setCameraFocusRevision,
    isArrivalRejected,
    hasOpenedGlobal,
    hasOpenedSector,
    locationRequest,
    setLocationRequest,
    setAutoDestination,
    pinLabel,
    setPinLabel,
    isQuickTravelOpen,
    setQuickTravelOpen,
    globe,
    mapError,
    currentTile,
    targetPosition,
    setTargetPosition,
    targetSector,
    pusher,
    timeDiff,
    userRef,
    userData,
    isRetryingAdmission,
    admissionRecovery,
    travelState,
    retryAdmission,
    loadLpcCatalog,
    setScenePosition,
    pins,
    savePins,
    tutorialRunning,
    showOtherUsers,
    villageData,
    sectorVillageName,
    sectorWindow,
    currentSectorMap,
    villages,
    travelDestinations,
    sectorNames,
    describeSector,
    trackedBounties,
    sectorVillage,
    userItems,
    isFetchingItems,
    useritem,
    setUserItem,
    isOpen,
    setIsOpen,
    currentSector,
    hasCurrentSector,
    sectorLink,
    globalLink,
    quickTravelForm,
    quickTravelSector,
    isStartingTravel,
    finishGlobalMove,
    isFinishingTravel,
    joinVillage,
    isJoining,
    purchaseHideout,
    isCreatingHideout,
    consume,
    isConsuming,
    attackRevealedUser,
    isAttackingRevealed,
    handleGlobalMove,
    canTravelTo,
    initiateTravelToSector,
    isTraveling,
    globeJourney,
    isGlobal,
    showGlobal,
    isPreparingSector,
    globeFocusSector,
    showSector,
  } = session;
  const hasUser = !!userData;
  // Memoized Map component to prevent re-renders during countdown updates
  const MapComponent = useMemo(() => {
    return (
      villages &&
      globe && (
        <GlobalMap
          highlights={villages}
          usersHighlighted={trackedBounties}
          userLocation={true}
          showOwnership={showOwnership && !userData?.tutorialOn}
          autoRotate={false}
          focusSector={globeFocusSector}
          actionExplanation={
            isTraveling ? "You are traveling to your destination" : undefined
          }
          routeTarget={showModal ? targetSector : null}
          journey={globeJourney}
          onTileClick={(sector) => initiateTravelToSector(sector)}
          hexasphere={globe}
        />
      )
    );
  }, [
    villages,
    globe,
    trackedBounties,
    showOwnership,
    globeFocusSector,
    isTraveling,
    globeJourney,
    showModal,
    targetSector,
    userData?.tutorialOn,
    initiateTravelToSector,
  ]);

  // Retain the sector scene while the view switches map tabs.
  const SectorComponent = useMemo(() => {
    return (
      hasUser &&
      currentTile &&
      currentSector !== undefined &&
      sectorWindow &&
      currentSectorMap && (
        <Sector
          loadLpcCatalog={loadLpcCatalog}
          tile={currentTile}
          sector={currentSector}
          sectorWindow={sectorWindow}
          target={targetPosition}
          showSorrounding={showSorrounding}
          showActive={showOtherUsers}
          isActive={!!showSector && isInteractive}
          autoAttackMode={autoAttackMode}
          isWorldExpanded={isWorldExpanded && !!showSector}
          cameraFocusRevision={cameraFocusRevision}
          setWorldExpanded={setWorldExpanded}
          setShowSorrounding={setShowSorrounding}
          setPosition={setScenePosition}
        />
      )
    );
  }, [
    loadLpcCatalog,
    currentTile,
    currentSector,
    currentSectorMap,
    sectorWindow,
    hasCurrentSector,
    setScenePosition,
    targetPosition,
    showSorrounding,
    showOtherUsers,
    autoAttackMode,
    isWorldExpanded,
    showSector,
    isInteractive,
    cameraFocusRevision,
    villages,
    hasUser,
    setWorldExpanded,
    setShowSorrounding,
  ]);

  if (!userData) return <Loader explanation="Loading userdata" />;

  // Derived
  const loadedVillages = villages && villages.length > 0;
  const isOutlaw = userData.isOutlaw;
  const canJoin = hasRequiredRank(userData.rank, VILLAGE_LEAVE_REQUIRED_RANK);
  const clanLeader = userData.clan?.leaderId === userData.userId;
  const hadHideout = userData?.village?.type !== "OUTLAW" && userData.isOutlaw;
  const canAffordHideout = (userData?.clan?.bank || 0) >= HIDEOUT_COST;
  const canCreateHideout =
    isOutlaw && !sectorVillage && clanLeader && !hadHideout && loadedVillages;
  const joinVillageBtn = userData.isOutlaw && canJoin && sectorVillage?.joinable;
  const subtitle =
    hasCurrentSector && userData && !isGlobal
      ? `Sector ${currentSector} ${sectorVillageName ? `(${sectorVillageName})` : ""}`
      : "The world of Seichi";
  const consumableItems = userItems?.filter(
    (i) =>
      nonCombatConsume(i.item, userData) &&
      (!i.craftingFinishedAt || i.craftingFinishedAt < new Date()),
  );
  const shownConsumables = consumableItems?.map((ui) => ({ ...ui.item, ...ui }));

  // Render

  // Map tools in their display order. On narrow screens they leave the header row by
  // priority (lower stays longer) into a "More" menu: stealth and sensory first, then
  // the tabs and quick travel, the way out of a sector.
  const isSectorTools = !isGlobal && activeTab !== "";
  const travelTools: HeaderActionItem[] = [
    { key: "war", node: <WarFieldActions />, priority: 10 },
    {
      key: "caravans",
      // Kept out of the tutorial's guided map lessons.
      node: isSectorTools && !tutorialRunning && (
        <CaravanControlsTrigger className={mapToolClassName} />
      ),
      priority: 8,
    },
    {
      key: "auto-attack",
      node:
        isSectorTools &&
        userData?.anbuId &&
        (autoAttackMode ? (
          <button
            type="button"
            aria-label="Stop auto-attack"
            aria-pressed={true}
            className={mapToolClassName}
            onClick={() => setAutoAttackMode(false)}
          >
            <Zap className="h-7 w-7 text-red-500" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Start auto-attack"
            aria-pressed={false}
            className={mapToolClassName}
            onClick={() => setShowAutoAttackModal(true)}
          >
            <ZapOff className="h-7 w-7 hover:text-red-500" />
          </button>
        )),
      priority: 2,
      attention: autoAttackMode,
    },
    {
      key: "stealth",
      node: isSectorTools && (
        <StealthControls
          asMenu={false}
          onRevealed={(players) => {
            setRevealedPlayers(players);
            setShowRevealedPlayersModal(true);
          }}
        />
      ),
      priority: 1,
    },
    {
      key: "players",
      node: isSectorTools && (
        <TooltipProvider delayDuration={50}>
          <Tooltip>
            <TooltipTrigger
              aria-label="Show other players on the map"
              aria-pressed={showOtherUsers}
              className={mapToolClassName}
              onClick={() =>
                tutorialRunning
                  ? setRevealOthersInTutorial((prev) => !prev)
                  : setShowActive(!showActive)
              }
            >
              {showOtherUsers ? (
                <Eye className="h-7 w-7 text-orange-500" />
              ) : (
                <EyeOff className="h-7 w-7" />
              )}
            </TooltipTrigger>
            <TooltipContent>
              {showOtherUsers
                ? "Hide other players on the map"
                : "Show other players on the map"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
      priority: 6,
      // Hidden players are easy to forget about once the switch sits in the menu. The
      // tutorial starts with them hidden on purpose.
      attention: isSectorTools && !tutorialRunning && !showOtherUsers,
    },
    {
      key: "scout",
      node: isSectorTools && userData.status === "AWAKE" && (
        <button
          type="button"
          aria-label="Scout surrounding sectors"
          aria-pressed={showSorrounding}
          className={mapToolClassName}
          onClick={() => setShowSorrounding((prev) => !prev)}
        >
          <UserRoundSearch
            className={`h-7 w-7 hover:text-orange-500 ${showSorrounding ? "fill-orange-500" : ""}`}
          />
        </button>
      ),
      priority: 7,
    },
    {
      key: "find",
      node: isGlobal && !isTraveling && (
        <FindSectorPopover
          focusSector={globeFocusSector}
          onFocusSector={setFocusSector}
          triggerAsChild
          trigger={
            <button
              type="button"
              aria-label="Find a sector"
              className={mapToolClassName}
            >
              <Locate
                className={`h-7 w-7 hover:text-purple-500 ${focusSector !== null ? "text-purple-500" : ""}`}
              />
            </button>
          }
        />
      ),
      priority: 8,
      attention: isGlobal && focusSector !== null,
    },
    {
      key: "quick-travel",
      node: (
        <Popover open={isQuickTravelOpen} onOpenChange={setQuickTravelOpen}>
          <PopoverTrigger aria-label="Quick Travel" className={mapToolClassName}>
            <Search className="h-7 w-7 hover:text-orange-500" />
          </PopoverTrigger>
          <PopoverContent className="w-72">
            <p className="py-2 font-semibold">Quick Travel</p>
            <p className="pb-2 text-muted-foreground text-sm">
              Travel to a village, saved pin, or sector ID.
            </p>
            <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pb-3">
              {(isQuickTravelOpen ? travelDestinations : []).map((destination) => {
                const dotColor = getReadableVillageHexColor(destination.color);
                const description =
                  "description" in destination ? destination.description : undefined;
                const button = (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-auto justify-start py-1.5"
                    style={{ borderColor: dotColor }}
                    disabled={!canTravelTo(destination.sector)}
                    onClick={() => initiateTravelToSector(destination.sector)}
                  >
                    <span
                      className="mr-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/30 dark:ring-white/30"
                      style={{ backgroundColor: dotColor }}
                    />
                    <span className="flex min-w-0 flex-col items-start text-left">
                      <span>{destination.label}</span>
                      {description && (
                        <span className="font-normal text-[10px] text-red-600 dark:text-red-400">
                          {description}
                        </span>
                      )}
                    </span>
                    <span className="ml-auto text-muted-foreground text-xs">
                      {destination.sector}
                    </span>
                  </Button>
                );
                if (!description) {
                  return <Fragment key={destination.id}>{button}</Fragment>;
                }
                return (
                  <TooltipProvider key={destination.id} delayDuration={50}>
                    <Tooltip>
                      <TooltipTrigger asChild>{button}</TooltipTrigger>
                      <TooltipContent>{description}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })}
            </div>
            <div className="flex flex-col gap-2 border-t py-3">
              <p className="font-semibold text-sm">Saved pins</p>
              <p className="text-muted-foreground text-xs">
                Saved on this device for your account.
              </p>
              {pins.map((pin, index) => (
                <div
                  key={`${pin.sector}-${pin.longitude}-${pin.latitude}`}
                  className="flex gap-1"
                >
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-auto min-w-0 flex-1 flex-col items-start whitespace-normal text-left"
                    disabled={
                      !!admissionRecovery ||
                      isStartingTravel ||
                      !canAttemptAwakeAction(userData)
                    }
                    onClick={() => setLocationRequest(pin)}
                  >
                    <span>{pin.label}</span>
                    <span className="text-muted-foreground text-xs">
                      Sector {pin.sector} [{pin.longitude}, {pin.latitude}]
                    </span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Remove pin ${pin.label}`}
                    onClick={() => savePins(pins.filter((_, i) => i !== index))}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Input
                aria-label="Pin name"
                placeholder="Name this location"
                maxLength={MAX_TRAVEL_PIN_LABEL_LENGTH}
                value={pinLabel}
                onChange={(event) => setPinLabel(event.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !pinLabel.trim() ||
                  pins.length >= MAX_TRAVEL_PINS ||
                  !canAttemptAwakeAction(userData)
                }
                onClick={() => {
                  const next = pins.filter(
                    (pin) =>
                      pin.sector !== userData.sector ||
                      pin.longitude !== userData.longitude ||
                      pin.latitude !== userData.latitude,
                  );
                  savePins([
                    ...next,
                    {
                      label: pinLabel.trim(),
                      sector: userData.sector,
                      longitude: userRef.current?.longitude ?? userData.longitude,
                      latitude: userRef.current?.latitude ?? userData.latitude,
                    },
                  ]);
                  setPinLabel("");
                }}
              >
                Save current location
              </Button>
            </div>
            <Form {...quickTravelForm}>
              <form
                onSubmit={quickTravelForm.handleSubmit((data) => {
                  initiateTravelToSector(data.sector);
                })}
                className="flex flex-col gap-2 border-t pt-3"
              >
                <SectorIdField control={quickTravelForm.control} />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!canTravelTo(quickTravelSector)}
                >
                  Travel to Sector{" "}
                  {Number.isFinite(quickTravelSector) ? quickTravelSector : "..."}
                </Button>
              </form>
            </Form>
          </PopoverContent>
        </Popover>
      ),
      priority: 4,
    },
    {
      key: "expand",
      node: !isGlobal && activeTab !== "" && (
        <button
          type="button"
          aria-label="Expand world"
          aria-expanded={isWorldExpanded}
          disabled={!showSector || !SectorComponent}
          className={`${mapToolClassName} hover:text-orange-500`}
          onClick={() => setWorldExpanded(true)}
        >
          <Maximize2 className="h-7 w-7" />
        </button>
      ),
      priority: 9,
    },
    {
      key: "ownership",
      node: isGlobal && (
        <TooltipProvider delayDuration={50}>
          <Tooltip>
            <TooltipTrigger
              aria-label="Show sector ownerships and factions"
              aria-pressed={showOwnership}
              className={mapToolClassName}
              onClick={() => setShowOwnership(!showOwnership)}
            >
              <MapPinned
                className={`h-7 w-7 ${showOwnership ? "text-orange-500" : ""}`}
              />
            </TooltipTrigger>
            <TooltipContent>Show sector ownerships and factions</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
      priority: 9,
      attention: isGlobal && showOwnership,
    },
    {
      key: "join",
      node: joinVillageBtn && (
        <Confirm
          title={`Join Village [${sectorVillage.name}]`}
          proceed_label="Join village"
          button={<GitMerge className="h-7 w-7 hover:text-orange-500" />}
          triggerClassName={mapToolClassName}
          triggerLabel={`Join ${sectorVillage.name}`}
          disabled={isJoining}
          isLoading={isJoining}
          keepOpenOnAccept
          onAccept={(_, { close }) =>
            joinVillage({ villageId: sectorVillage.id }, { onSettled: close })
          }
        >
          Do you confirm that you wish to join {sectorVillage.name}? Please be aware
          that if you join this village your training benefits & regen will be reduced
          for {VILLAGE_REDUCED_GAINS_DAYS} days, and village loyalty bonuses will begin
          from day 0.
        </Confirm>
      ),
      priority: 11,
    },
    {
      key: "hideout",
      node: canCreateHideout && (
        <Confirm
          title="Purchase Hideout"
          proceed_label={canAffordHideout ? "Purchase hideout" : "Not enough ryo"}
          button={<HousePlus className="h-7 w-7 hover:text-orange-500" />}
          triggerClassName={mapToolClassName}
          triggerLabel="Purchase hideout"
          disabled={isCreatingHideout}
          isLoading={isCreatingHideout}
          keepOpenOnAccept
          onAccept={(_, { close }) => {
            if (!canAffordHideout) return close();
            purchaseHideout(
              { clanId: userData.clanId || "", sector: currentSector ?? 0 },
              { onSettled: close },
            );
          }}
        >
          As a leader of a faction, you have the option of founding a hideout for your
          faction, thereby effectively de-coupling yourself from the common syndicate of
          outlaws. The purchase costs <b>{HIDEOUT_COST} ryo</b>, and the faction
          currently has <b>{userData?.clan?.bank} ryo</b>. Do you want to create your
          faction hideout in this sector?
        </Confirm>
      ),
      priority: 12,
    },
    {
      key: "tabs",
      node: (
        <NavTabs
          current={isGlobal ? globalLink : activeTab}
          options={sectorLink ? [sectorLink, globalLink] : [globalLink]}
          labels={{ [sectorLink]: "Sector" }}
          itemClassName={(option) => (option === globalLink ? "mr-0" : "")}
          disabledOptions={isTraveling ? [sectorLink] : undefined}
          setValue={setActiveTab}
          onChange={(value) => {
            if (value !== globalLink)
              setCameraFocusRevision((previous) => previous + 1);
          }}
        />
      ),
      // Tutorial steps point at the Global tab, so the tabs stay in the row while it runs.
      priority: tutorialRunning ? 0 : 3,
    },
  ];

  return (
    <>
      <HuntingArrival
        blocked={
          !isInteractive ||
          !!admissionRecovery ||
          !!locationRequest ||
          hasLocationRequest
        }
      />
      {locationRequest && (
        <Modal
          id="tutorial-auto-travel"
          title="Auto Travel"
          isOpen={true}
          setIsOpen={() => setLocationRequest(null)}
          proceed_label="Travel"
          proceedDisabled={
            !!admissionRecovery || !canAttemptAwakeAction(userData) || isStartingTravel
          }
          onAccept={() => {
            if (!canAttemptAwakeAction(userData) || isStartingTravel) return;
            setAutoDestination(locationRequest);
            if (locationRequest.sector !== userData.sector)
              handleGlobalMove(locationRequest.sector);
            setLocationRequest(null);
          }}
        >
          Travel to {describeSector(locationRequest.sector)}
          {locationRequest.longitude !== undefined &&
          locationRequest.latitude !== undefined
            ? `, position [${locationRequest.longitude}, ${locationRequest.latitude}]`
            : ""}
          ?
          <p className="py-2">
            {locationRequest.longitude !== undefined &&
            locationRequest.latitude !== undefined
              ? "You will walk to the destination after arriving in its sector."
              : "You will travel to the destination sector."}
          </p>
          {locationRequest.sector === MAP_WAR_TORN_BATTLEGROUND_SECTOR && (
            <p className="text-red-600">Free-for-all PvP; sleeping is disabled.</p>
          )}
        </Modal>
      )}
      <ContentBox
        title="Travel"
        subtitle={
          isSectorTools && hasCurrentSector ? (
            <>
              {subtitle} · <TravelPositionLabel />
            </>
          ) : (
            subtitle
          )
        }
        padding={false}
        topRightItems={travelTools}
      >
        {/* The countdown needs a viewport even while the destination scene is loading. */}
        <div
          data-travel-viewport={immersive ? "" : undefined}
          className={userData.travelFinishAt ? "relative min-h-80" : "relative"}
        >
          {(showGlobal || (hasOpenedGlobal && villages && globe)) && (
            <div
              aria-hidden={!showGlobal}
              inert={!showGlobal}
              className={!showGlobal ? PAUSED_SCENE_CLASS : undefined}
            >
              {MapComponent}
            </div>
          )}
          {mapError && <MapError />}
          {/* Prepare the destination offscreen so its scene is ready on arrival. */}
          {(showSector ||
            isPreparingSector ||
            (hasOpenedSector && SectorComponent)) && (
            <div
              aria-hidden={!showSector}
              inert={!showSector}
              className={
                showSector
                  ? undefined
                  : isPreparingSector
                    ? "invisible absolute inset-0"
                    : PAUSED_SCENE_CLASS
              }
            >
              {SectorComponent}
            </div>
          )}
          {!villages && <Loader explanation="Loading data" />}
          {villages &&
            !isGlobal &&
            !mapError &&
            userData.status !== "TRAVEL" &&
            (!showSector || !SectorComponent) && <SectorLoadingPlaceholder />}
          {showModal && globe && userData && targetSector !== null && (
            <Modal
              id="tutorial-global-travel"
              title="World Travel"
              isOpen={showModal}
              setIsOpen={setShowModal}
              proceed_label={!isStartingTravel ? "Travel" : undefined}
              keepOpenOnAccept
              onAccept={() => handleGlobalMove(targetSector)}
            >
              {isStartingTravel && <Loader explanation="Preparing to Travel" />}
              {!isStartingTravel && (
                <div>
                  You are about to move from {describeSector(userData.sector)} to{" "}
                  {describeSector(targetSector)}.{" "}
                  <p className="py-2">
                    The travel time is estimated to be{" "}
                    {calcGlobalTravelTime(userData.sector, targetSector, globe)}{" "}
                    seconds.
                  </p>
                  {targetSector === MAP_WAR_TORN_BATTLEGROUND_SECTOR && (
                    <p className="mb-2 rounded-md border border-red-600/40 bg-red-600/10 p-2 text-red-700 text-sm dark:text-red-400">
                      Warning: this is a free-for-all PvP zone. Anyone can attack you
                      regardless of village or XP bracket, and you cannot sleep there.
                    </p>
                  )}
                  Do you confirm?
                </div>
              )}
            </Modal>
          )}
          {travelState?.travelFinishAt && (
            <TravelArrivalStatus
              sector={targetSector ?? travelState.sector}
              destinationName={sectorNames.get(targetSector ?? travelState.sector)}
              finishAt={travelState.travelFinishAt}
              timeDiff={timeDiff}
              isBusy={isFinishingTravel || isStartingTravel || !!admissionRecovery}
              isArrivalRejected={isArrivalRejected}
              onArrive={() => finishGlobalMove()}
              onRetrySync={
                admissionRecovery && !isStartingTravel ? retryAdmission : undefined
              }
              isSyncing={isRetryingAdmission}
            />
          )}
        </div>
      </ContentBox>
      <div className="flex flex-wrap items-start justify-between gap-2 p-1">
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          {showSector && <JutsuLoadoutSelector size="small" label="Jutsu" compact />}
          {showSector && <ItemLoadoutSelector size="small" label="Items" compact />}
        </div>
        {showSector && userData?.anbuId && autoAttackMode && (
          <div className="flex items-center font-semibold text-red-500 text-sm">
            <Zap className="mr-1 h-4 w-4" />
            Auto-Attack: Scanning for enemies to hunt...
          </div>
        )}
      </div>
      {shownConsumables && shownConsumables.length > 0 && (
        <div className="flex flex-col" inert={isFetchingItems}>
          <p className="font-bold">Consumables</p>
          {isFetchingItems && <Loader explanation="Refreshing items" />}
          <ActionSelector
            className="grid-cols-6"
            items={shownConsumables}
            counts={shownConsumables}
            selectedId={useritem?.id}
            showBgColor={false}
            showLabels={false}
            onClick={(id) => {
              if (id === useritem?.id) {
                setUserItem(undefined);
                setIsOpen(false);
              } else {
                setUserItem(shownConsumables?.find((item) => item.id === id));
                setIsOpen(true);
              }
            }}
          />
          {isOpen && useritem && (
            <Modal
              title="Item Details"
              isOpen={isOpen}
              setIsOpen={setIsOpen}
              keepOpenOnAccept
            >
              <ItemWithEffects
                item={{
                  ...useritem.item,
                  curDurability: useritem.durability,
                }}
                key={useritem.id}
                showStatistic="item"
              />
              {!isConsuming && (
                <div className="flex flex-row gap-1">
                  {nonCombatConsume(useritem.item, userData) && (
                    <Button
                      variant="info"
                      disabled={isFetchingItems}
                      onClick={() =>
                        consume(getItemConsumeInput(userData?.userId ?? "", useritem))
                      }
                    >
                      <Cookie className="mr-2 h-5 w-5" />
                      Consume
                    </Button>
                  )}
                </div>
              )}
              {isConsuming && <Loader explanation="Using" />}
            </Modal>
          )}
        </div>
      )}

      {/* Auto Attack Configuration Modal */}
      {showAutoAttackModal && (
        <AutoAttackModal
          isOpen={showAutoAttackModal}
          setIsOpen={setShowAutoAttackModal}
          onEnable={() => setAutoAttackMode(true)}
        />
      )}

      {/* Revealed Players Modal (from Sensory Scan) */}
      {showRevealedPlayersModal && revealedPlayers.length > 0 && (
        <Modal
          title="Players Revealed by Sensory!"
          isOpen={showRevealedPlayersModal}
          setIsOpen={setShowRevealedPlayersModal}
          keepOpenOnAccept
        >
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Your sensory ability detected the following stealthed players:
            </p>
            {revealedPlayers.map((player) => (
              <RevealedPlayerCard
                key={player.userId}
                player={player}
                userData={userData}
                villageData={villageData}
                isAttackingRevealed={isAttackingRevealed}
                pendingAttackTarget={pendingAttackTarget}
                attackRevealedUser={attackRevealedUser}
                originSocketId={pusher?.connection.socket_id}
                setPendingAttackTarget={setPendingAttackTarget}
                setTargetPosition={setTargetPosition}
                setShowRevealedPlayersModal={setShowRevealedPlayersModal}
              />
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * Revealed Player Card: a player revealed by sensing, with actions to travel to or
 * attack them.
 */
const RevealedPlayerCard = ({
  player,
  userData,
  villageData,
  isAttackingRevealed,
  pendingAttackTarget,
  attackRevealedUser,
  originSocketId,
  setPendingAttackTarget,
  setTargetPosition,
  setShowRevealedPlayersModal,
}: {
  player: RevealedPlayer;
  userData: TravelSession["userData"];
  villageData: { id: string; name: string; hexColor: string }[] | undefined;
  isAttackingRevealed: boolean;
  pendingAttackTarget: AttackTarget | null;
  originSocketId?: string;
  attackRevealedUser: (params: {
    originSocketId?: string;
    userId: string;
    longitude: number;
    latitude: number;
    sector: number;
  }) => void;
  setPendingAttackTarget: (target: AttackTarget) => void;
  setTargetPosition: (pos: { x: number; y: number }) => void;
  setShowRevealedPlayersModal: (show: boolean) => void;
}) => {
  const sameHex =
    player.latitude === userData?.latitude && player.longitude === userData?.longitude;

  const village = villageData?.find((v) => v.id === player.villageId);
  const villageName =
    village?.name ?? (player.villageId || player.isMasked ? "Unknown" : "Outlaw");
  const villageColor = village?.hexColor ?? "gray";

  const showAttack = player.canAttack;

  return (
    <div className="flex items-center justify-between rounded-lg bg-muted p-3">
      <div>
        <p className="font-semibold">{player.username}</p>
        <p className="text-muted-foreground text-sm">
          {player.level !== null && `Lvl. ${player.level} - `}
          <span style={{ color: villageColor }}>{villageName}</span>
        </p>
        <p className="text-muted-foreground text-sm">
          Position: ({player.longitude}, {player.latitude})
          {sameHex && " - Same hex as you!"}
        </p>
      </div>
      <div className="flex gap-2">
        {showAttack && sameHex && userData ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() =>
              attackRevealedUser({
                originSocketId,
                userId: player.userId,
                longitude: player.longitude,
                latitude: player.latitude,
                sector: userData.sector,
              })
            }
            disabled={isAttackingRevealed}
          >
            <Swords className="mr-1 h-4 w-4" />
            Attack
          </Button>
        ) : showAttack && !sameHex ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setPendingAttackTarget({
                userId: player.userId,
                username: player.username,
                longitude: player.longitude,
                latitude: player.latitude,
              });
              setTargetPosition({
                x: player.longitude,
                y: player.latitude,
              });
              setShowRevealedPlayersModal(false);
            }}
            disabled={isAttackingRevealed || !!pendingAttackTarget}
          >
            <Swords className="mr-1 h-4 w-4" />
            Attack
          </Button>
        ) : !showAttack ? (
          <span className="text-muted-foreground text-sm italic">Cannot attack</span>
        ) : null}
      </div>
    </div>
  );
};

const GlobalMap = dynamic(() => import("@/layout/Map"), {
  ssr: false,
  loading: () => <Loader explanation="Loading world map" />,
});
const Sector = dynamic(() => import("@/layout/Sector"), {
  ssr: false,
  loading: () => <SectorLoadingPlaceholder />,
});
// Start both renderers alongside hydration while the map queries load.
if (typeof window !== "undefined") {
  // The dynamic component reports a failed chunk load when it renders.
  void import("@/layout/Map").catch(() => undefined);
  void import("@/layout/Sector").catch(() => undefined);
}

/**
 * Hides a mounted scene and moves it out of the viewport, so the renderer's intersection
 * observer suspends its frame loop until the scene's tab is shown again.
 */
const PAUSED_SCENE_CLASS =
  "pointer-events-none invisible absolute inset-0 -translate-x-[200vw] overflow-hidden";

/** Holds the sector scene's space with its loading pill until its data and code arrive. */
const SectorLoadingPlaceholder = () => (
  <div className="flex min-h-60 items-center justify-center">
    <div
      role="status"
      className="bg-background/95 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-md motion-reduce:[&_img]:animate-none"
    >
      <Loader noPadding size={20} />
      <span>Loading world…</span>
    </div>
  </div>
);

interface TravelViewProps {
  session: TravelSession;
  /** Fill the host’s available map viewport while retaining the page controls. */
  immersive?: boolean;
  /** A building dialog pauses map input and automatic arrival prompts. */
  isInteractive?: boolean;
  /** A route destination is being read before its confirmation reaches the session. */
  hasLocationRequest?: boolean;
}
