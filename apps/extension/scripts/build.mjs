import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const extensionRoot = resolve(import.meta.dirname, "..");
const outDir = resolve(extensionRoot, "dist");
const sourceDir = resolve(extensionRoot, "src");

const esbuild = resolve(extensionRoot, "..", "..", "node_modules", ".bin", "esbuild");
const definitions = [
  `--define:import.meta.env.MODE=${JSON.stringify("production")}`,
  `--define:import.meta.env.VITE_TRACER_STARTUP_TRACE=${JSON.stringify(process.env.VITE_TRACER_STARTUP_TRACE === "1")}`,
  `--define:import.meta.env.VITE_TRACER_API_BASE_URL=${JSON.stringify(process.env.VITE_TRACER_API_BASE_URL ?? "http://127.0.0.1:4000")}`,
  `--define:import.meta.env.VITE_TRACER_DASHBOARD_BASE_URL=${JSON.stringify(process.env.VITE_TRACER_DASHBOARD_BASE_URL ?? "http://127.0.0.1:5173")}`,
  `--define:import.meta.env.VITE_TRACER_USER_ID=${JSON.stringify(process.env.VITE_TRACER_USER_ID ?? "dev-user-tracer")}`,
];

function bundle(entry, output, format, globalName) {
  const args = [
    resolve(sourceDir, `${entry}.ts`),
    "--bundle",
    `--format=${format}`,
    "--platform=browser",
    "--target=chrome120",
    `--outfile=${resolve(outDir, output)}`,
    ...definitions,
  ];
  if (globalName) args.push(`--global-name=${globalName}`);
  const result = spawnSync(esbuild, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Failed to bundle ${entry}.`);
}

async function copyDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = resolve(source, entry.name);
    const destinationPath = resolve(destination, entry.name);
    if (entry.isDirectory()) await copyDirectory(sourcePath, destinationPath);
    else if (entry.isFile()) await copyFile(sourcePath, destinationPath);
  }
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await copyDirectory(resolve(extensionRoot, "public"), outDir);

bundle("background", "background.js", "esm");
bundle("popup", "popup.js", "esm");
bundle("storePriceCheck", "storePriceCheck.js", "esm");
for (const name of ["contentScript", "genericCapture", "watchlistCapture"]) {
  bundle(name, `${name}.js`, "iife", `Tracer_${name}`);
}

const popupSource = await readFile(resolve(extensionRoot, "popup.html"), "utf8");
const popupHtml = popupSource.replace(
  '<script type="module" src="/src/popup.ts"></script>',
  '<script type="module" src="/popup.js"></script>',
);
if (popupHtml === popupSource) throw new Error("Could not replace the popup source entry point.");
await writeFile(resolve(outDir, "popup.html"), popupHtml);
