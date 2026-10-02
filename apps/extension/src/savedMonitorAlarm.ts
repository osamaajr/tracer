/** Session storage survives service worker restarts but is cleared on browser restart. */
export const savedMonitorReadyAtKey = "tracerSavedMonitorReadyAt";

export function shouldRunSavedMonitorAlarm(
  scheduledTime: number | undefined,
  readyAt: unknown,
): boolean {
  return typeof readyAt === "number" && Number.isFinite(readyAt)
    && typeof scheduledTime === "number" && scheduledTime >= readyAt;
}
