import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { stdout, argv, execPath } from "node:process";
import { Buffer } from "node:buffer";
import { Script } from "node:vm";
import { gzipSync } from "node:zlib";

// Optional argument: directory holding the six pre-refactor extension JS files.
const root = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "tracer-performance-"));
const median = values => values.sort((a,b) => a-b)[Math.floor(values.length / 2)];
try {
  const output = join(scratch, "money.mjs");
  const build = spawnSync(execPath, [resolve(root,"node_modules/esbuild/bin/esbuild"), resolve(root,"packages/core/src/domain/money.ts"), "--bundle", "--platform=node", "--format=esm", `--outfile=${output}`], {encoding:"utf8"});
  if (build.status !== 0) throw new Error(build.stderr);
  const {formatMoney} = await import(pathToFileURL(output).href);
  const original = value => new Intl.NumberFormat("en-GB", {style:"currency", currency:value.currency, maximumFractionDigits:Number.isInteger(value.amountMinor / 100) ? 0 : 2}).format(value.amountMinor / 100);
  const prices = Array.from({length:100},(_,i)=>({currency:["GBP","USD","EUR"][i%3],amountMinor:i%2 ? i*100 : i*100+99}));
  const samples = {original:[],optimized:[]};
  for (const format of [original,formatMoney]) for(let i=0;i<3;i++) prices.forEach(format);
  for(let round=0;round<7;round++) {
    // Alternate order to avoid systematically favoring the warmed second run.
    for(const [name,format] of round%2 ? [["optimized",formatMoney],["original",original]] : [["original",original],["optimized",formatMoney]]) {
      const start=performance.now();for(let i=0;i<50;i++) prices.forEach(format);
      samples[name].push(performance.now()-start);
    }
  }
  stdout.write(JSON.stringify({currencyFormatting:{callsPerSample:5000,samples,medianMs:{original:median(samples.original),optimized:median(samples.optimized)}}})+"\n");
  const directories={optimized:resolve(root,"apps/extension/dist"),...(argv[2]?{baseline:resolve(argv[2])}:{})};
  for(const name of ["popup","background","storePriceCheck","contentScript","genericCapture","watchlistCapture"]) {
    const result={name};
    for(const [phase,directory] of Object.entries(directories)) {
      const source=readFileSync(join(directory,`${name}.js`),"utf8");
      // Bundled modules have no imports; remove only the final export declaration for vm.Script.
      const script=source.replace(/export\s*\{[^}]*\};?\s*$/,"");
      const times=[];
      for(let round=0;round<7;round++) {const start=performance.now();for(let i=0;i<100;i++)new Script(script+`\n// uncached parse ${round}-${i}`);times.push(performance.now()-start);}
      result[phase]={bytes:Buffer.byteLength(source),gzipBytes:gzipSync(source).length,nodeParse100MedianMs:median(times)};
    }
    stdout.write(JSON.stringify(result)+"\n");
  }
} finally { rmSync(scratch,{recursive:true,force:true}); }
