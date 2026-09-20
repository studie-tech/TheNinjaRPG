"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";

/** Deliberately small authoring surface; templates and schedules are versioned server-side. */
export function FishingRaidEditor() {
  const [message, setMessage] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [speciesId, setSpeciesId] = useState("");
  const [habitatId, setHabitatId] = useState("");
  const [minimumLevel, setMinimumLevel] = useState(10);
  const [minimumParticipants, setMinimumParticipants] = useState(3);
  const [maximumParticipants, setMaximumParticipants] = useState(8);
  const [entryBait, setEntryBait] = useState(1);
  const [encounterSeconds, setEncounterSeconds] = useState(240);
  const [rewardExperience, setRewardExperience] = useState(250);
  const [startsAt, setStartsAt] = useState("");
  const [recurrenceMinutes, setRecurrenceMinutes] = useState(1440);
  const [spawnWindowSeconds, setSpawnWindowSeconds] = useState(900);
  const [announcementLeadSeconds, setAnnouncementLeadSeconds] = useState(900);
  const [active, setActive] = useState(true);
  const admin = api.fishingRaid.adminList.useQuery();
  const deactivate = api.fishingRaid.deactivateSchedule.useMutation({
    onSuccess: (result) => {
      setMessage(result.message);
      void admin.refetch();
    },
  });
  const cancel = api.fishingRaid.cancelOccurrence.useMutation({
    onSuccess: (result) => {
      setMessage(result.message);
      void admin.refetch();
    },
  });
  const saveTemplate = api.fishingRaid.saveTemplate.useMutation({
    onSuccess: (result) => {
      setMessage(result.message);
      if (result.success) setTemplateId(result.id);
    },
  });
  const saveSchedule = api.fishingRaid.saveSchedule.useMutation({
    onSuccess: (result) => setMessage(result.message),
  });
  return (
    <ContentBox
      title="Fishing Raid Content"
      subtitle="UTC schedules and versioned cooperative encounter templates"
      defaultBackHref="/manual"
    >
      <div className="space-y-4">
        <p className="text-sm">
          Use an existing active fishing habitat ID. Saving a template creates a new
          version for future occurrences; active groups keep their snapshot.
        </p>
        {message && <p className="rounded border p-2 text-sm">{message}</p>}
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            className="rounded border p-2"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Raid name"
          />
          <input
            className="rounded border p-2"
            value={speciesId}
            onChange={(event) => setSpeciesId(event.target.value)}
            placeholder="Raid species ID"
          />
          <input
            className="rounded border p-2"
            value={habitatId}
            onChange={(event) => setHabitatId(event.target.value)}
            placeholder="Water habitat ID"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          {[
            ["Level", minimumLevel, setMinimumLevel],
            ["Min players", minimumParticipants, setMinimumParticipants],
            ["Max players", maximumParticipants, setMaximumParticipants],
            ["Entry bait", entryBait, setEntryBait],
            ["Duration seconds", encounterSeconds, setEncounterSeconds],
            ["Fishing XP", rewardExperience, setRewardExperience],
            ["Window seconds", spawnWindowSeconds, setSpawnWindowSeconds],
            ["Lead seconds", announcementLeadSeconds, setAnnouncementLeadSeconds],
            ["Recurrence minutes (0 = once)", recurrenceMinutes, setRecurrenceMinutes],
          ].map(([label, value, setValue]) => (
            <label key={String(label)} className="text-sm">
              {String(label)}
              <input
                className="ml-1 w-20 rounded border p-1"
                type="number"
                value={Number(value)}
                onChange={(event) =>
                  (setValue as (next: number) => void)(Number(event.target.value))
                }
              />
            </label>
          ))}
        </div>
        <label className="block text-sm">
          Start time (shown locally, stored as UTC)
          <input
            className="ml-2 rounded border p-1"
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </label>
        <label className="ml-3 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />{" "}
          Active
        </label>
        <button
          type="button"
          className="rounded bg-primary px-3 py-2 text-primary-foreground"
          disabled={!name || !speciesId || !habitatId || saveTemplate.isPending}
          onClick={() =>
            saveTemplate.mutate({
              name,
              speciesId,
              habitatId,
              minimumLevel,
              minimumParticipants,
              maximumParticipants,
              entryBait,
              encounterSeconds,
              rewardExperience,
              maxRewardsPerOccurrence: 1,
              active,
              config: {},
            })
          }
        >
          Save template
        </button>
        <button
          type="button"
          className="ml-2 rounded border px-3 py-2"
          disabled={!templateId || saveSchedule.isPending}
          onClick={() =>
            saveSchedule.mutate({
              templateId,
              startsAt: startsAt
                ? new Date(startsAt)
                : new Date(Date.now() + 60 * 60 * 1000),
              recurrenceMinutes: recurrenceMinutes > 0 ? recurrenceMinutes : null,
              spawnWindowSeconds,
              announcementLeadSeconds,
              active,
            })
          }
        >
          Save UTC schedule
        </button>
        {admin.data?.success && (
          <section className="text-sm">
            <h2 className="font-semibold">Existing content</h2>
            <p>
              {admin.data.templates.length} templates · {admin.data.schedules.length}{" "}
              schedules · {admin.data.occurrences.length} occurrences
            </p>
            {admin.data.schedules.map((schedule) => (
              <button
                key={schedule.id}
                type="button"
                className="mr-2 rounded border px-2 py-1"
                onClick={() => deactivate.mutate({ id: schedule.id })}
              >
                Deactivate schedule
              </button>
            ))}
            {admin.data.occurrences
              .filter(
                (occurrence) =>
                  occurrence.state === "SCHEDULED" || occurrence.state === "OPEN",
              )
              .map((occurrence) => (
                <button
                  key={occurrence.id}
                  type="button"
                  className="mr-2 rounded border px-2 py-1"
                  onClick={() => cancel.mutate({ id: occurrence.id })}
                >
                  Cancel occurrence
                </button>
              ))}
          </section>
        )}
      </div>
    </ContentBox>
  );
}
