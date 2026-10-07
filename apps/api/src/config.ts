export interface ApiConfig {
  port: number;
  dataFile: string;
  databaseUrl?: string;
  cronSecret?: string;
  devUserId: string;
  enableDevAuth: boolean;
  enableDevEndpoints: boolean;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const nodeEnv = environment.NODE_ENV ?? "development";

  return {
    port: Number(environment.PORT ?? environment.TRACER_API_PORT ?? 4000),
    dataFile: environment.TRACER_DATA_FILE ?? ".tracer-data/dev-store.json",
    ...(environment.DATABASE_URL ? { databaseUrl: environment.DATABASE_URL } : {}),
    ...(environment.CRON_SECRET ? { cronSecret: environment.CRON_SECRET } : {}),
    devUserId: environment.TRACER_DEV_USER_ID ?? "dev-user-tracer",
    enableDevAuth: nodeEnv !== "production" && !environment.VERCEL,
    enableDevEndpoints: nodeEnv !== "production" && !environment.VERCEL,
  };
}
