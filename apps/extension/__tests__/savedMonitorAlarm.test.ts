import { describe, expect, it } from "vitest";
import { shouldRunSavedMonitorAlarm } from "../src/savedMonitorAlarm";

describe("saved-item monitor alarm startup guard", () => {
  it("ignores overdue alarms delivered before or after the startup event", () => {
    expect(shouldRunSavedMonitorAlarm(1_000, undefined)).toBe(false);
    expect(shouldRunSavedMonitorAlarm(1_000, 2_000)).toBe(false);
  });

  it("allows a scheduled alarm after the startup delay across worker restarts", () => {
    expect(shouldRunSavedMonitorAlarm(2_000, 2_000)).toBe(true);
    expect(shouldRunSavedMonitorAlarm(2_001, 2_000)).toBe(true);
  });

  it("fails closed when the alarm or session marker is missing", () => {
    expect(shouldRunSavedMonitorAlarm(undefined, 2_000)).toBe(false);
    expect(shouldRunSavedMonitorAlarm(2_000, "2_000")).toBe(false);
  });
});
