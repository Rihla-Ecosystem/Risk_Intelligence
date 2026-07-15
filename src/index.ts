import "dotenv/config";
import Fastify from "fastify";
import { readFile } from "fs/promises";
import { parse as parseYaml } from "yaml";
import path from "path";

import { ensureDataDir } from "./engine/checkpoint.js";
import { startScheduler } from "./engine/scheduler.js";
import { registerRoutes } from "./api/routes.js";
import type { SourceAdapter } from "./engine/models.js";

import { usgsEarthquake } from "./sources/noAuth/usgsEarthquake.js";
import { emscSeismic } from "./sources/noAuth/emscSeismic.js";
import { noaaTsunami } from "./sources/noAuth/noaaTsunami.js";
import { gdeltUnrest } from "./sources/noAuth/gdeltUnrest.js";
import { reliefweb } from "./sources/noAuth/reliefweb.js";
import { fcdoAdvisory } from "./sources/noAuth/fcdoAdvisory.js";
import { whoOutbreak } from "./sources/noAuth/whoOutbreak.js";
import { cdcTravelHealth } from "./sources/noAuth/cdcTravelHealth.js";
import { openWeather } from "./sources/withKey/openWeather.js";
import { openWeatherAir } from "./sources/withKey/openWeatherAir.js";
import { nasaFirms } from "./sources/withKey/nasaFirms.js";
import { acledUnrest } from "./sources/withKey/acledUnrest.js";

async function loadConfig() {
  const configPath = path.join(process.cwd(), "config", "sources.yaml");
  const raw = await readFile(configPath, "utf8");
  return parseYaml(raw) as { sources: Array<{ name: string; enabled: boolean; intervalMinutes: number }> };
}

const ALL_ADAPTERS: SourceAdapter[] = [
  usgsEarthquake,
  emscSeismic,
  noaaTsunami,
  gdeltUnrest,
  reliefweb,
  fcdoAdvisory,
  whoOutbreak,
  cdcTravelHealth,
  openWeather,
  openWeatherAir,
  nasaFirms,
  acledUnrest,
  // glofasSidecar intentionally excluded — GRIB parsing not implemented
];

async function main() {
  await ensureDataDir();
  const config = await loadConfig();

  // apply config overrides (enabled/interval) onto each adapter
  const activeAdapters = ALL_ADAPTERS.map((adapter) => {
    const override = config.sources.find((s) => s.name === adapter.name);
    if (!override) return adapter;
    return { ...adapter, enabled: override.enabled, intervalMinutes: override.intervalMinutes };
  });

  startScheduler(activeAdapters);

  const app = Fastify({ logger: true });
  await registerRoutes(app, activeAdapters);

  const port = Number(process.env.PORT) || 3000;
  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});