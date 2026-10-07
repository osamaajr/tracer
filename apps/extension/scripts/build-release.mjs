import process from "node:process";

for (const key of ["VITE_TRACER_API_BASE_URL", "VITE_TRACER_DASHBOARD_BASE_URL"]) {
  const value = process.env[key];
  if (!value || !value.startsWith("https://")) {
    throw new Error(`${key} must be an HTTPS URL for a customer release`);
  }
}
if (process.env.VITE_TRACER_SAVED_PRICE_DROP_OVERRIDES &&
    process.env.VITE_TRACER_SAVED_PRICE_DROP_OVERRIDES !== "{}") {
  throw new Error("Demo price overrides cannot be included in a customer release");
}

process.env.TRACER_EXTENSION_OUTPUT_DIR = "release";
await import("./build.mjs");
