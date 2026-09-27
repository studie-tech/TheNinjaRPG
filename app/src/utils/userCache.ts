/** Apply a profile-cache patch, counting daily trainings from the cache the patch lands on. */
export const withDailyTrainingsDelta = <T extends { dailyTrainings: number }>(
  current: T,
  patch: object,
  delta: number,
): T =>
  ({
    ...current,
    ...patch,
    ...(delta !== 0 ? { dailyTrainings: current.dailyTrainings + delta } : {}),
  }) as T;
