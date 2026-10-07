import Fastify from "fastify";
import "./dist/server.cjs";

// Vercel detects Fastify through an import in the entrypoint. The bundled
// bootstrap above starts the application and keeps workspace imports portable.
void Fastify;
