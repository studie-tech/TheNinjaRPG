"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";

/** Compact, polling-safe raid panel intended for the Fishing page and mobile layouts. */
export function FishingRaidActivity() {
  const utils = api.useUtils();
  const upcoming = api.fishingRaid.upcoming.useQuery(undefined, {
    refetchInterval: 10_000,
  });
  const equipment = api.fishing.getState.useQuery();
  const [notice, setNotice] = useState("");
  const [lobbyId, setLobbyId] = useState<string>();
  const [rodUserItemId, setRodUserItemId] = useState("");
  const [baitUserItemId, setBaitUserItemId] = useState("");
  const [tackleUserItemId, setTackleUserItemId] = useState<string | null>(null);
  const mine = api.fishingRaid.myActiveLobby.useQuery(undefined);
  const openLobbies = api.fishingRaid.openLobbies.useQuery(undefined, {
    refetchInterval: 5_000,
  });
  const createLobby = api.fishingRaid.createLobby.useMutation({
    onSuccess: (result) => {
      setNotice(result.message);
      if (result.success) setLobbyId(result.lobbyId);
      void utils.fishingRaid.upcoming.invalidate();
    },
  });
  const join = api.fishingRaid.joinLobby.useMutation({
    onSuccess: (result) => {
      setNotice(result.message);
      if (result.success) {
        setLobbyId(result.lobbyId);
        void utils.fishingRaid.myActiveLobby.invalidate();
        void utils.fishingRaid.openLobbies.invalidate();
      }
    },
  });
  const lobby = api.fishingRaid.getLobby.useQuery(
    { occurrenceId: lobbyId ?? "pending" },
    { enabled: !!lobbyId, refetchInterval: 2_000 },
  );
  const refresh = () => {
    if (lobbyId) void utils.fishingRaid.getLobby.invalidate({ occurrenceId: lobbyId });
  };
  const ready = api.fishingRaid.setReady.useMutation({
    onSuccess: (result) => {
      setNotice(result.message);
      refresh();
    },
  });
  const start = api.fishingRaid.start.useMutation({
    onSuccess: (result) => {
      setNotice(result.message);
      refresh();
    },
  });
  const action = api.fishingRaid.act.useMutation({
    onSuccess: (result) => {
      setNotice(result.message);
      refresh();
    },
  });
  const reconnect = api.fishingRaid.reconnect.useMutation({
    onSuccess: (result) => {
      setNotice(result.message);
      refresh();
    },
  });
  const leave = api.fishingRaid.leave.useMutation({
    onSuccess: async (result) => {
      setNotice(result.message);
      if (result.success) {
        await Promise.all([
          utils.fishingRaid.myActiveLobby.invalidate(),
          utils.fishingRaid.openLobbies.invalidate(),
        ]);
        setLobbyId(undefined);
      }
    },
  });
  useEffect(() => {
    if (!lobbyId && mine.data) setLobbyId(mine.data);
  }, [lobbyId, mine.data]);
  useEffect(() => {
    const entries = equipment.data?.equipment;
    if (!entries) return;
    const first = (kind: "ROD" | "BAIT", current: string) =>
      entries.some((entry) => entry.userItemId === current && entry.kind === kind)
        ? current
        : (entries.find((entry) => entry.kind === kind)?.userItemId ?? "");
    setRodUserItemId((current) => first("ROD", current));
    setBaitUserItemId((current) => first("BAIT", current));
    setTackleUserItemId((current) =>
      current &&
      entries.some((entry) => entry.userItemId === current && entry.kind === "TACKLE")
        ? current
        : null,
    );
  }, [equipment.data?.equipment]);
  if (!upcoming.data) return null;
  const lobbyData = lobby.data;
  const lobbyState = lobbyData?.lobby;
  return (
    <section className="rounded border p-4" aria-live="polite">
      <h2 className="font-semibold">Scheduled raid fishing</h2>
      <p className="mt-1 text-sm">
        Cooperate with distinct anglers to land special event fish. Times use your local
        timezone.
      </p>
      {notice && <p className="mt-2 text-sm">{notice}</p>}
      {!lobbyId && equipment.data && (
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <label>
            Raid rod
            <select
              className="mt-1 w-full rounded border p-2"
              value={rodUserItemId}
              onChange={(event) => setRodUserItemId(event.target.value)}
            >
              <option value="">Choose a rod</option>
              {equipment.data.equipment
                .filter((entry) => entry.kind === "ROD")
                .map((entry) => (
                  <option key={entry.userItemId} value={entry.userItemId}>
                    {entry.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Raid bait
            <select
              className="mt-1 w-full rounded border p-2"
              value={baitUserItemId}
              onChange={(event) => setBaitUserItemId(event.target.value)}
            >
              <option value="">Choose bait</option>
              {equipment.data.equipment
                .filter((entry) => entry.kind === "BAIT")
                .map((entry) => (
                  <option key={entry.userItemId} value={entry.userItemId}>
                    {entry.name} ×{entry.quantity}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Raid tackle
            <select
              className="mt-1 w-full rounded border p-2"
              value={tackleUserItemId ?? ""}
              onChange={(event) => setTackleUserItemId(event.target.value || null)}
            >
              <option value="">No tackle</option>
              {equipment.data.equipment
                .filter((entry) => entry.kind === "TACKLE")
                .map((entry) => (
                  <option key={entry.userItemId} value={entry.userItemId}>
                    {entry.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}
      {upcoming.data.length === 0 ? (
        <p className="mt-2 text-sm">No raid windows are announced yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {upcoming.data.map((occurrence) => (
            <li
              className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm"
              key={occurrence.id}
            >
              <span>
                {occurrence.state === "OPEN"
                  ? "Open now"
                  : new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(occurrence.opensAt)}
              </span>
              {occurrence.state === "OPEN" && (
                <button
                  type="button"
                  className="rounded bg-primary px-3 py-1 text-primary-foreground"
                  disabled={createLobby.isPending || !rodUserItemId || !baitUserItemId}
                  onClick={() =>
                    createLobby.mutate({
                      occurrenceId: occurrence.id,
                      rodUserItemId,
                      baitUserItemId,
                      tackleUserItemId,
                    })
                  }
                >
                  Create lobby
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!lobbyId && openLobbies.data && (
        <ul className="mt-3 space-y-2">
          {openLobbies.data.map((open) => (
            <li
              key={open.id}
              className="flex justify-between rounded border p-2 text-sm"
            >
              <span>
                Open group {open.rosterCount}/{open.cap}
              </span>
              <button
                type="button"
                className="rounded border px-2 py-1"
                disabled={!rodUserItemId || !baitUserItemId}
                onClick={() =>
                  join.mutate({
                    occurrenceId: open.id,
                    rodUserItemId,
                    baitUserItemId,
                    tackleUserItemId,
                  })
                }
              >
                Join
              </button>
            </li>
          ))}
        </ul>
      )}
      {lobbyId && lobbyData && lobbyState && (
        <div className="mt-3 space-y-3 rounded border p-3">
          <p className="text-sm">
            {lobbyState.state} lobby ·{" "}
            {lobbyData.participants.filter((participant) => participant.active).length}{" "}
            active anglers
          </p>
          <button
            type="button"
            className="rounded border px-2 py-1 text-sm"
            onClick={() => leave.mutate({ lobbyId })}
          >
            Leave
          </button>
          {lobbyState.state === "OPEN" && (
            <div className="flex flex-wrap gap-2">
              {(["PULLER", "ANCHOR", "GUIDE"] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  className="rounded border px-2 py-1"
                  onClick={() => ready.mutate({ lobbyId, role, ready: true })}
                >
                  {role}
                </button>
              ))}
              {lobbyState.hostUserId === lobbyData.selfUserId && (
                <button
                  type="button"
                  className="rounded bg-primary px-3 py-1 text-primary-foreground"
                  onClick={() => start.mutate({ lobbyId, version: lobbyState.version })}
                >
                  Start raid
                </button>
              )}
            </div>
          )}
          {lobbyData.encounter && (
            <EncounterControls
              lobbyId={lobbyId}
              encounter={lobbyData.encounter}
              role={
                lobbyData.participants.find(
                  (participant) => participant.userId === lobbyData.selfUserId,
                )?.role
              }
              action={action}
              reconnect={reconnect}
            />
          )}
        </div>
      )}
    </section>
  );
}

function EncounterControls({
  lobbyId,
  encounter,
  role,
  action,
  reconnect,
}: {
  lobbyId: string;
  encounter: {
    version: number;
    phase: number;
    fishStamina: number;
    landingProgress: number;
  };
  role: "PULLER" | "ANCHOR" | "GUIDE" | undefined;
  action: ReturnType<typeof api.fishingRaid.act.useMutation>;
  reconnect: ReturnType<typeof api.fishingRaid.reconnect.useMutation>;
}) {
  const roleAction =
    role === "ANCHOR"
      ? encounter.phase === 4
        ? "SLACK"
        : "HOLD"
      : role === "GUIDE"
        ? "TURN"
        : "REEL";
  return (
    <div className="text-sm">
      <p>
        Phase {encounter.phase} · stamina {encounter.fishStamina}% · landing{" "}
        {encounter.landingProgress}%
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="rounded bg-primary px-3 py-1 text-primary-foreground"
          onClick={() =>
            action.mutate({ lobbyId, version: encounter.version, action: roleAction })
          }
        >
          {roleAction}
        </button>
        <button
          type="button"
          className="rounded border px-3 py-1"
          onClick={() => reconnect.mutate({ lobbyId })}
        >
          Reconnect line
        </button>
      </div>
    </div>
  );
}
