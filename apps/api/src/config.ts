export interface ApiConfig {
  port: number;
  dataFile: string;
  devUserId: string;
  enableDevAuth: boolean;
  enableDevEndpoints: boolean;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const nodeEnv = environment.NODE_ENV ?? "development";

  return {
    port: Number(environment.TRACER_API_PORT ?? 4000),
    dataFile: environment.TRACER_DATA_FILE ?? ".tracer-data/dev-store.json",
    devUserId: environment.TRACER_DEV_USER_ID ?? "dev-user-tracer",
    enableDevAuth: nodeEnv !== "production",
    enableDevEndpoints: nodeEnv !== "production",
  };
}
