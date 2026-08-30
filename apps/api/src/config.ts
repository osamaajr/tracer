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
    port: Number(environment.AFTERBUY_API_PORT ?? 4000),
    dataFile: environment.AFTERBUY_DATA_FILE ?? ".afterbuy-data/dev-store.json",
    devUserId: environment.AFTERBUY_DEV_USER_ID ?? "dev-user-afterbuy",
    enableDevAuth: nodeEnv !== "production",
    enableDevEndpoints: nodeEnv !== "production",
  };
}
