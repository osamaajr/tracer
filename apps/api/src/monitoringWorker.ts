import { HttpPriceFetcher } from "./httpPriceFetcher";
import { loadConfig } from "./config";
import { FileTracerRepository } from "./repositories/fileTracerRepository";
import { startMonitoringScheduler } from "./monitoringScheduler";

const config = loadConfig();
const repository = new FileTracerRepository(config.dataFile);
const priceFetcher = new HttpPriceFetcher();
const intervalHours = positiveNumber(process.env.TRACER_MONITOR_INTERVAL_HOURS, 12);
startMonitoringScheduler({ repository, priceFetcher, intervalHours });

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
