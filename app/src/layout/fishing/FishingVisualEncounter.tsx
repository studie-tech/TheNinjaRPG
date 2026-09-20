"use client";

import { useEffect, useRef, useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { CatchResult, type CatchResultData } from "@/layout/fishing/CatchResult";
import {
  FishingCanvas,
  type FishingCanvasHandle,
} from "@/layout/fishing/FishingCanvas";
import {
  advanceFishingSimulation,
  type FishingSimulationInput,
  type FishingSimulationState,
} from "@/libs/fishing/simulation";

type FishingState = RouterOutputs["fishing"]["getState"];
type FishingSession = NonNullable<FishingState["activeSession"]>;

export function FishingVisualEncounter({
  state,
  sector,
  onNotice,
  onRefresh,
}: {
  state: FishingState;
  sector: number;
  onNotice: (message: string) => void;
  onRefresh: () => void;
}) {
  const [session, setSession] = useState<FishingSession | null>(state.activeSession);
  const [result, setResult] = useState<CatchResultData | null>(null);
  const [aim, setAim] = useState({ x: 0.5, y: 0.34 });
  const [charge, setCharge] = useState(0.72);
  const [rodUserItemId, setRodUserItemId] = useState("");
  const [baitUserItemId, setBaitUserItemId] = useState("");
  const [tackleUserItemId, setTackleUserItemId] = useState<string | null>(null);
  const [habitatId, setHabitatId] = useState("");
  const sessionRef = useRef(session);
  const canvasRef = useRef<FishingCanvasHandle>(null);
  const predictedRef = useRef<FishingSimulationState | null>(
    session?.simulation ?? null,
  );
  const pendingInputsRef = useRef<FishingSimulationInput[]>([]);
  const inFlightInputsRef = useRef<FishingSimulationInput[]>([]);
  const castChargeStartedAtRef = useRef<number | null>(null);
  const sequenceRef = useRef(session?.simulation?.lastInputSequence ?? 0);
  const controlsRef = useRef({ rodX: 0, rodY: 0, reel: false, hook: false });
  sessionRef.current = session;

  useEffect(() => {
    const incoming = state.activeSession;
    if (!incoming) {
      if (sessionRef.current?.state !== "LANDED") setSession(null);
      return;
    }
    if (!sessionRef.current || incoming.version > sessionRef.current.version) {
      setSession(incoming);
      predictedRef.current = incoming.simulation;
      if (incoming.simulation) canvasRef.current?.updateSimulation(incoming.simulation);
      pendingInputsRef.current = [];
      inFlightInputsRef.current = [];
      sequenceRef.current = incoming.simulation?.lastInputSequence ?? 0;
    }
  }, [state.activeSession]);

  useEffect(() => {
    const equipment = state.equipment;
    const choose = (kind: "ROD" | "BAIT" | "TACKLE", current: string) =>
      equipment.some((entry) => entry.kind === kind && entry.userItemId === current)
        ? current
        : (equipment.find((entry) => entry.kind === kind)?.userItemId ?? "");
    setRodUserItemId((current) => choose("ROD", current));
    setBaitUserItemId((current) => choose("BAIT", current));
    setTackleUserItemId((current) =>
      current &&
      equipment.some((entry) => entry.kind === "TACKLE" && entry.userItemId === current)
        ? current
        : null,
    );
    setHabitatId((current) =>
      state.habitats.some((habitat) => habitat.id === current)
        ? current
        : (state.habitats[0]?.id ?? ""),
    );
  }, [state.equipment, state.habitats]);

  const cast = api.fishing.cast.useMutation({
    onSuccess: (response) => {
      onNotice(response.message);
      if (response.success) {
        setResult(null);
        setSession(response.session);
        predictedRef.current = response.session.simulation;
        if (response.session.simulation)
          canvasRef.current?.updateSimulation(response.session.simulation);
        pendingInputsRef.current = [];
        inFlightInputsRef.current = [];
        sequenceRef.current = response.session.simulation?.lastInputSequence ?? 0;
      }
      onRefresh();
    },
  });
  const sync = api.fishing.sync.useMutation({
    onSuccess: (response) => {
      if (response.success) {
        inFlightInputsRef.current = [];
        let predicted = response.session.simulation;
        if (
          predicted &&
          response.session.state !== "LANDED" &&
          response.session.state !== "FAILED"
        ) {
          for (const frame of pendingInputsRef.current)
            predicted = advanceFishingSimulation(
              predicted,
              frame,
              predicted.behavior,
              predicted.modifiers,
            );
        } else pendingInputsRef.current = [];
        predictedRef.current = predicted;
        if (predicted) canvasRef.current?.updateSimulation(predicted);
        setSession({ ...response.session, simulation: predicted });
        sequenceRef.current = Math.max(
          sequenceRef.current,
          response.session.simulation?.lastInputSequence ?? 0,
        );
        if (response.session.state === "LANDED" || response.session.state === "FAILED")
          onNotice(response.message);
      } else {
        pendingInputsRef.current = [];
        inFlightInputsRef.current = [];
        onNotice(response.message);
        onRefresh();
      }
    },
    onError: () => {
      pendingInputsRef.current = [
        ...inFlightInputsRef.current,
        ...pendingInputsRef.current,
      ].slice(-8);
      inFlightInputsRef.current = [];
    },
  });
  const cancel = api.fishing.cancel.useMutation({
    onSuccess: (response) => {
      onNotice(response.message);
      if (response.success) setSession(null);
      predictedRef.current = null;
      pendingInputsRef.current = [];
      onRefresh();
    },
  });
  const legacyAct = api.fishing.act.useMutation({
    onSuccess: (response) => {
      onNotice(response.message);
      onRefresh();
    },
  });
  const resolve = api.fishing.resolve.useMutation({
    onSuccess: (response) => {
      onNotice(response.message);
      if (response.success) {
        setResult({
          speciesId: response.speciesId,
          fishingExperienceDelta: response.fishingExperienceDelta,
          isFirstDiscovery: response.isFirstDiscovery,
          size: response.size,
          quality: response.quality,
          pendingInventoryClaim: response.pendingInventoryClaim,
        });
        setSession(null);
        predictedRef.current = null;
        pendingInputsRef.current = [];
      }
      onRefresh();
    },
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = sessionRef.current;
      const predicted = predictedRef.current;
      if (
        !current?.simulation ||
        !predicted ||
        current.state === "LANDED" ||
        current.state === "FAILED" ||
        current.state === "RESOLVED"
      )
        return;
      const controls = controlsRef.current;
      const frame: FishingSimulationInput = {
        sequence: ++sequenceRef.current,
        durationMs: 50,
        rodX: controls.rodX,
        rodY: controls.rodY,
        reel: controls.reel,
        hook: controls.hook,
      };
      controls.hook = false;
      pendingInputsRef.current.push(frame);
      predictedRef.current = advanceFishingSimulation(
        predicted,
        frame,
        predicted.behavior,
        predicted.modifiers,
      );
      canvasRef.current?.updateSimulation(predictedRef.current);
    }, 50);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = sessionRef.current;
      if (
        !current?.simulation ||
        sync.isPending ||
        inFlightInputsRef.current.length > 0 ||
        pendingInputsRef.current.length === 0
      )
        return;
      const batch = pendingInputsRef.current.splice(0, 8);
      inFlightInputsRef.current = batch;
      sync.mutate({ sessionId: current.id, version: current.version, inputs: batch });
    }, 200);
    return () => window.clearInterval(timer);
  }, [sync]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          "input, textarea, select, button, [contenteditable='true']",
        )
      )
        return;
      const key = event.key.toLowerCase();
      if (["arrowleft", "a"].includes(key)) controlsRef.current.rodX = -1;
      if (["arrowright", "d"].includes(key)) controlsRef.current.rodX = 1;
      if (["arrowup", "w"].includes(key)) controlsRef.current.rodY = -1;
      if (["arrowdown", "s"].includes(key)) controlsRef.current.rodY = 1;
      if (event.code === "Space") controlsRef.current.reel = true;
      if (key === "h") controlsRef.current.hook = true;
      if (
        ["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key) ||
        event.code === "Space"
      )
        event.preventDefault();
    };
    const up = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (["arrowleft", "a"].includes(key) && controlsRef.current.rodX < 0)
        controlsRef.current.rodX = 0;
      if (["arrowright", "d"].includes(key) && controlsRef.current.rodX > 0)
        controlsRef.current.rodX = 0;
      if (["arrowup", "w"].includes(key) && controlsRef.current.rodY < 0)
        controlsRef.current.rodY = 0;
      if (["arrowdown", "s"].includes(key) && controlsRef.current.rodY > 0)
        controlsRef.current.rodY = 0;
      if (event.code === "Space") controlsRef.current.reel = false;
    };
    const release = () => {
      controlsRef.current.reel = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, []);

  const simulation = session?.simulation ?? null;
  const remainingSeconds = session
    ? Math.max(0, Math.ceil((session.expiresAt.getTime() - Date.now()) / 1_000))
    : 0;
  const onCanvasAim = (point: { x: number; y: number }) => {
    if (session) {
      controlsRef.current.rodX = Math.max(-1, Math.min(1, (point.x - 0.5) * 2));
      controlsRef.current.rodY = Math.max(-1, Math.min(1, (point.y - 0.45) * 2));
    } else setAim({ x: point.x, y: Math.min(0.7, point.y) });
  };
  const submitCast = (power: number) =>
    cast.mutate({
      sector,
      habitatId,
      rodUserItemId,
      baitUserItemId,
      tackleUserItemId,
      aimX: aim.x,
      aimY: aim.y,
      charge: power,
    });

  return (
    <section className="space-y-3 rounded-xl border p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Riverbank encounter</h2>
          <p className="text-muted-foreground text-xs">
            {!session
              ? "Tap the water to aim, set power, then cast."
              : simulation?.phase === "ATTRACT"
                ? "Sweep the lure near a school without moving too wildly."
                : simulation?.phase === "BITE"
                  ? "The bobber is down — set the hook!"
                  : simulation?.phase === "FIGHT"
                    ? "Steer against the run and hold Reel while tension is safe."
                    : simulation?.phase === "LANDED"
                      ? "Catch secured. Choose what to do with it."
                      : "The encounter has ended."}
          </p>
        </div>
        {session && (
          <span className="rounded-full border px-3 py-1 text-xs">
            {remainingSeconds}s
          </span>
        )}
      </div>

      <FishingCanvas
        ref={canvasRef}
        simulation={simulation}
        aim={aim}
        onAim={onCanvasAim}
        active={!!session}
      />

      {session && simulation && (
        <div className="grid grid-cols-2 gap-2 text-sm" aria-live="polite">
          <Meter
            label="Line tension"
            value={Math.round(simulation.line.tension)}
            danger
          />
          <Meter
            label={simulation.phase === "ATTRACT" ? "Fish interest" : "Landing"}
            value={
              simulation.phase === "ATTRACT"
                ? Math.round(simulation.fish.interest)
                : Math.round(simulation.landingProgress)
            }
          />
        </div>
      )}

      {!session && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            Habitat
            <select
              className="mt-1 w-full rounded border bg-background p-2"
              value={habitatId}
              onChange={(e) => setHabitatId(e.target.value)}
            >
              {state.habitats.map((habitat) => (
                <option key={habitat.id} value={habitat.id}>
                  {habitat.name}
                </option>
              ))}
            </select>
          </label>
          <GearSelect
            label="Rod"
            kind="ROD"
            value={rodUserItemId}
            state={state}
            onChange={setRodUserItemId}
          />
          <GearSelect
            label="Bait"
            kind="BAIT"
            value={baitUserItemId}
            state={state}
            onChange={setBaitUserItemId}
          />
          <GearSelect
            label="Tackle"
            kind="TACKLE"
            value={tackleUserItemId ?? ""}
            state={state}
            optional
            onChange={(value) => setTackleUserItemId(value || null)}
          />
          <label className="text-sm sm:col-span-2">
            Cast power · {Math.round(charge * 100)}%
            <input
              className="mt-2 w-full"
              type="range"
              min="10"
              max="100"
              value={Math.round(charge * 100)}
              onChange={(event) => setCharge(Number(event.target.value) / 100)}
            />
          </label>
          <button
            type="button"
            className="rounded bg-primary px-4 py-3 font-semibold text-primary-foreground sm:col-span-2"
            disabled={cast.isPending || !habitatId || !rodUserItemId || !baitUserItemId}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              castChargeStartedAtRef.current = performance.now();
            }}
            onPointerUp={() => {
              const startedAt = castChargeStartedAtRef.current;
              if (startedAt === null) return;
              castChargeStartedAtRef.current = null;
              const power = Math.min(
                1,
                Math.max(0.1, (performance.now() - startedAt) / 1_200),
              );
              setCharge(power);
              submitCast(power);
            }}
            onPointerCancel={() => {
              castChargeStartedAtRef.current = null;
            }}
            onClick={(event) => {
              if (event.detail === 0) submitCast(charge);
            }}
          >
            {cast.isPending ? "Casting…" : "Hold, then release to cast"}
          </button>
        </div>
      )}

      {session &&
        simulation &&
        !["LANDED", "FAILED", "RESOLVED"].includes(session.state) && (
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              className="rounded border px-3 py-3 font-semibold"
              onClick={() => {
                controlsRef.current.hook = true;
              }}
              disabled={simulation?.phase !== "BITE"}
            >
              Set hook <span className="text-xs">[H]</span>
            </button>
            <button
              type="button"
              className="rounded bg-primary px-3 py-3 font-semibold text-primary-foreground"
              onPointerDown={() => {
                controlsRef.current.reel = true;
              }}
            >
              Hold reel <span className="text-xs">[Space]</span>
            </button>
            <button
              type="button"
              className="rounded border px-3 py-3"
              disabled={cancel.isPending}
              onClick={() =>
                cancel.mutate({ sessionId: session.id, version: session.version })
              }
            >
              Cancel
            </button>
          </div>
        )}

      {session && !simulation && (
        <div className="rounded border border-amber-400/50 p-3 text-sm">
          <p className="mb-2">
            This short-lived cast began on the previous encounter engine. Finish it here
            or cancel; the next cast opens the visual minigame.
          </p>
          <div className="flex flex-wrap gap-2">
            {(session.state === "ATTRACT"
              ? (["LURE"] as const)
              : session.state === "HOOK"
                ? (["HOOK"] as const)
                : session.state === "FIGHT"
                  ? (["REEL", "SLACK", "STEER"] as const)
                  : []
            ).map((actionName) => (
              <button
                key={actionName}
                type="button"
                className="rounded border px-3 py-2"
                disabled={legacyAct.isPending}
                onClick={() =>
                  legacyAct.mutate({
                    sessionId: session.id,
                    version: session.version,
                    action: actionName,
                  })
                }
              >
                {actionName}
              </button>
            ))}
            <button
              type="button"
              className="rounded border px-3 py-2"
              onClick={() =>
                cancel.mutate({ sessionId: session.id, version: session.version })
              }
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {session?.state === "LANDED" && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="rounded bg-primary px-4 py-3 font-semibold text-primary-foreground"
            disabled={resolve.isPending}
            onClick={() =>
              resolve.mutate({
                sessionId: session.id,
                version: session.version,
                keep: true,
              })
            }
          >
            Keep catch
          </button>
          <button
            type="button"
            className="rounded border px-4 py-3 font-semibold"
            disabled={resolve.isPending}
            onClick={() =>
              resolve.mutate({
                sessionId: session.id,
                version: session.version,
                keep: false,
              })
            }
          >
            Release
          </button>
        </div>
      )}
      {result && <CatchResult result={result} />}
      <p className="text-muted-foreground text-xs">
        Controls: drag/tap to steer · WASD/arrow keys steer · hold Space to reel · H
        sets the hook.
      </p>
    </section>
  );
}

function Meter({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  const safeValue = Math.min(100, Math.max(0, value));
  const color =
    danger && safeValue > 82
      ? "bg-red-500"
      : danger && safeValue > 60
        ? "bg-amber-500"
        : "bg-cyan-500";
  return (
    <div>
      <div className="mb-1 flex justify-between">
        <span>{label}</span>
        <span>{safeValue}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-muted">
        <div
          className={`h-full ${color} transition-[width]`}
          style={{ width: `${safeValue}%` }}
        />
      </div>
    </div>
  );
}

function GearSelect({
  label,
  kind,
  value,
  state,
  optional = false,
  onChange,
}: {
  label: string;
  kind: "ROD" | "BAIT" | "TACKLE";
  value: string;
  state: FishingState;
  optional?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm">
      {label}
      <select
        className="mt-1 w-full rounded border bg-background p-2"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {optional && <option value="">None</option>}
        {state.equipment
          .filter((entry) => entry.kind === kind)
          .map((entry) => (
            <option key={entry.userItemId} value={entry.userItemId}>
              {entry.name}
              {kind === "BAIT" ? ` ×${entry.quantity}` : ""}
            </option>
          ))}
      </select>
    </label>
  );
}
