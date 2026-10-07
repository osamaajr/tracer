import { createTracerServer } from "./server";
import { loadConfig } from "./config";
import { HttpPriceFetcher } from "./httpPriceFetcher";
import { startMonitoringScheduler } from "./monitoringScheduler";
import { FileTracerRepository } from "./repositories/fileTracerRepository";
import { PostgresTracerRepository } from "./repositories/postgresTracerRepository";

const config = loadConfig();

async function start(): Promise<void> {
  if ((process.env.NODE_ENV === "production" || process.env.VERCEL) && !config.databaseUrl) {
    throw new Error("DATABASE_URL is required in production");
  }
  if (process.env.VERCEL && !config.cronSecret) {
    throw new Error("CRON_SECRET is required on Vercel");
  }
  const repository = config.databaseUrl
    ? new PostgresTracerRepository(config.databaseUrl)
    : new FileTracerRepository(config.dataFile);
  await repository.getMonitoringPreference("__startup_check__");
  const priceFetcher = new HttpPriceFetcher();
  const server = await createTracerServer({ config, repository, priceFetcher });
  let stopMonitoring: () => void = () => undefined;
  server.addHook("onClose", async () => {
    stopMonitoring();
    if (repository instanceof PostgresTracerRepository) await repository.close();
  });

  try {
    await server.listen({ port: config.port, host: "0.0.0.0" });
    if (!process.env.VERCEL) {
      stopMonitoring = startMonitoringScheduler({
        repository,
        priceFetcher,
        intervalHours: Number(process.env.TRACER_MONITOR_INTERVAL_HOURS ?? 12),
        log: (entry) => server.log.info(entry),
      });
    }
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

void start();
