import { HttpPriceFetcher } from "./httpPriceFetcher";
import { loadConfig } from "./config";
import { FileAfterBuyRepository } from "./repositories/fileAfterBuyRepository";
import { runPriceMonitoringCycle } from "@afterbuy/core";

const config = loadConfig();
const repository = new FileAfterBuyRepository(config.dataFile);
const priceFetcher = new HttpPriceFetcher();
const intervalHours = positiveNumber(process.env.AFTERBUY_MONITOR_INTERVAL_HOURS, 12);
const intervalMs = intervalHours * 60 * 60 * 1_000;
let running = false;

async function runCycle(): Promise<void> {
  if (running) {
    console.warn(JSON.stringify({ event: "monitoring_skipped", reason: "previous_cycle_running" }));
    return;
  }

  running = true;
  const startedAt = new Date().toISOString();
  console.info(JSON.stringify({ event: "monitoring_started", startedAt }));

  try {
    const summary = await runPriceMonitoringCycle({
      repository,
      priceFetcher,
      now: startedAt,
    });

    console.info(
      JSON.stringify({
        event: "monitoring_finished",
        startedAt,
        ...summary,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "monitoring_failed",
        startedAt,
        reason: error instanceof Error ? error.message : "Unknown monitoring failure",
      }),
    );
  } finally {
    running = false;
  }
}

await runCycle();
setInterval(() => void runCycle(), intervalMs);

console.info(
  JSON.stringify({
    event: "monitoring_worker_ready",
    intervalHours,
    dataFile: config.dataFile,
  }),
);

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
