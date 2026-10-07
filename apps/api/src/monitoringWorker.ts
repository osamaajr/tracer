import { HttpPriceFetcher } from "./httpPriceFetcher";
import { loadConfig } from "./config";
import { FileTracerRepository } from "./repositories/fileTracerRepository";
import { PostgresTracerRepository } from "./repositories/postgresTracerRepository";
import { startMonitoringScheduler } from "./monitoringScheduler";

const config = loadConfig();
if (process.env.NODE_ENV === "production" && !config.databaseUrl) {
  throw new Error("DATABASE_URL is required in production");
}
const repository = config.databaseUrl
  ? new PostgresTracerRepository(config.databaseUrl)
  : new FileTracerRepository(config.dataFile);
const priceFetcher = new HttpPriceFetcher();
const intervalHours = positiveNumber(process.env.TRACER_MONITOR_INTERVAL_HOURS, 12);
startMonitoringScheduler({ repository, priceFetcher, intervalHours });

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
