import { runPriceMonitoringCycle, type TracerRepository, type PriceFetcher } from "@tracer/core";

export interface MonitoringSchedulerOptions {
  repository: TracerRepository;
  priceFetcher: PriceFetcher;
  intervalHours?: number;
  runImmediately?: boolean;
  log?: (entry: Record<string, unknown>) => void;
}

export function startMonitoringScheduler(options: MonitoringSchedulerOptions): () => void {
  const intervalHours = positiveNumber(options.intervalHours, 12);
  const intervalMs = intervalHours * 60 * 60 * 1_000;
  const log = options.log ?? ((entry) => console.info(JSON.stringify(entry)));
  let running = false;

  const runCycle = async (): Promise<void> => {
    if (running) {
      log({ event: "monitoring_skipped", reason: "previous_cycle_running" });
      return;
    }

    running = true;
    const startedAt = new Date().toISOString();
    log({ event: "monitoring_started", startedAt });
    try {
      const summary = await runPriceMonitoringCycle({
        repository: options.repository,
        priceFetcher: options.priceFetcher,
        now: startedAt,
      });
      log({ event: "monitoring_finished", startedAt, ...summary });
    } catch (error) {
      log({
        event: "monitoring_failed",
        startedAt,
        reason: error instanceof Error ? error.message : "Unknown monitoring failure",
      });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void runCycle(), intervalMs);
  if (options.runImmediately !== false) {
    void runCycle();
  }
  log({ event: "monitoring_scheduler_ready", intervalHours });

  return () => clearInterval(timer);
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
