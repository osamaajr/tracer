import { createTracerServer } from "./server";
import { loadConfig } from "./config";
import { HttpPriceFetcher } from "./httpPriceFetcher";
import { startMonitoringScheduler } from "./monitoringScheduler";
import { FileTracerRepository } from "./repositories/fileTracerRepository";

const config = loadConfig();

async function start(): Promise<void> {
  const repository = new FileTracerRepository(config.dataFile);
  const priceFetcher = new HttpPriceFetcher();
  const server = await createTracerServer({ config, repository, priceFetcher });
  let stopMonitoring: () => void = () => undefined;
  server.addHook("onClose", async () => stopMonitoring());

  try {
    await server.listen({ port: config.port, host: "0.0.0.0" });
    stopMonitoring = startMonitoringScheduler({
      repository,
      priceFetcher,
      intervalHours: Number(process.env.TRACER_MONITOR_INTERVAL_HOURS ?? 12),
      log: (entry) => server.log.info(entry),
    });
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

void start();
