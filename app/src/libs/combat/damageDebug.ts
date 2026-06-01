import type { DamagePacketDebugLog } from "@/libs/combat/types";

const formatDamage = (value: number) => value.toFixed(2);

/** Verbose browser-console output for damage modifier pipeline steps. */
export const logDamagePacketDebug = (logs: DamagePacketDebugLog[]) => {
  if (typeof window === "undefined" || logs.length === 0) return;

  for (const log of logs) {
    const shieldNote =
      log.afterShields !== undefined && log.afterShields !== log.pipelineDamage
        ? ` → ${formatDamage(log.afterShields)} after shields`
        : "";
    console.groupCollapsed(
      `[Combat damage] ${log.kind} | effect ${log.effectId} | ${log.attackerId} → ${log.defenderId} | raw ${formatDamage(log.rawDamage)} → pipeline ${formatDamage(log.pipelineDamage)}${shieldNote}`,
    );
    console.table(
      log.steps.map((step, index) => ({
        "#": index + 1,
        step: step.label,
        damage: formatDamage(step.damage),
        modifiers: step.modifiers?.length ?? 0,
      })),
    );
    for (const step of log.steps) {
      if (!step.modifiers?.length) continue;
      console.groupCollapsed(
        `  ↳ ${step.label} — buffs/debuffs (${step.modifiers.length})`,
      );
      console.table(
        step.modifiers.map((m) => ({
          applied: m.applied,
          type: m.type,
          from: m.fromType ?? "",
          power: m.power,
          ratio: m.ratio,
          contribution: m.contribution ?? "",
          note: m.note ?? "",
          effectId: m.effectId ?? "",
          target: m.targetId ?? "",
        })),
      );
      console.groupEnd();
    }
    console.groupEnd();
  }
};
