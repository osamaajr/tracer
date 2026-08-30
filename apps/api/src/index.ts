import { createAfterBuyServer } from "./server";
import { loadConfig } from "./config";

const config = loadConfig();
const server = await createAfterBuyServer({ config });

try {
  await server.listen({ port: config.port, host: "0.0.0.0" });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
