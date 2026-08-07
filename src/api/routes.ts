import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { SourceAdapter } from "../engine/models.js";
import { runSource } from "../engine/poller.js";
import { runAllOnce } from "../engine/scheduler.js";
import { getCityState, getAllStates } from "../engine/currentState.js";
import { getChangesSince } from "../engine/eventLog.js";
import { getSourcesHealth } from "../engine/health.js";
import { getStaticCrimeNotes } from "../sources/deferred/numboCrime.stub.js";
import { nearestCity } from "../engine/models.js";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_ACCESS_SECRET || "";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

async function authHook(req: FastifyRequest, reply: FastifyReply) {
  // Option 1: Internal API key (Core-Server gateway)
  const apiKey = req.headers["x-internal-api-key"] as string | undefined;
  if (apiKey && INTERNAL_API_KEY && apiKey === INTERNAL_API_KEY) {
    return;
  }

  // Option 2: Admin JWT
  const authHeader = req.headers.authorization as string | undefined;
  if (authHeader?.startsWith("Bearer ") && JWT_SECRET) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { sub: string; role: string };
      if (payload.role === "admin") {
        return;
      }
      return reply.code(403).send({ error: "Admin privileges required for direct access" });
    } catch {
      return reply.code(401).send({ error: "Invalid or expired token" });
    }
  }

  return reply.code(401).send({ error: "Authentication required" });
}

export async function registerRoutes(app: FastifyInstance, adapters?: SourceAdapter[]) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dashboardPath = path.join(__dirname, "..", "public", "dashboard.html");

  app.get("/", async (_req, reply) => {
    const html = await readFile(dashboardPath, "utf8");
    return reply.type("text/html").send(html);
  });

  app.get("/safety/current", async (req, reply) => {
    const { city, lat, lon } = req.query as { city?: string; lat?: string; lon?: string };

    const resolvedCity = city ?? resolveCityFromCoords(lat, lon);

    if (resolvedCity) {
      const state = await getCityState(resolvedCity);
      const staticNotes = await getStaticCrimeNotes();
      if (!state && !staticNotes[resolvedCity]) {
        return reply.code(404).send({ error: `no data for city: ${resolvedCity}` });
      }
      return {
        city: resolvedCity,
        ...state,
        staticNote: staticNotes[resolvedCity] ?? null,
      };
    }

    return getAllStates();
  });

  app.get("/safety/changes", async (req, reply) => {
    const { since, city } = req.query as { since?: string; city?: string };
    if (!since) {
      return reply.code(400).send({ error: "missing required query param: since" });
    }
    const events = await getChangesSince(since, city);
    return { events, count: events.length };
  });

  app.get("/safety/health", async () => {
    const sources = await getSourcesHealth();
    return {
      status: "ok",
      time: new Date().toISOString(),
      sources,
    };
  });

  app.post("/safety/refresh", { preHandler: authHook }, async (req, reply) => {
    if (!adapters) {
      return reply.code(500).send({ error: "adapters not injected" });
    }
    const { source } = req.query as { source?: string };

    if (source) {
      const adapter = adapters.find((a) => a.name === source);
      if (!adapter) {
        return reply.code(404).send({ error: `unknown source: ${source}` });
      }
      const result = await runSource(adapter);
      return { source, ...result };
    }

    const results = await runAllOnce(adapters);
    return { refreshed: results.length, sources: results };
  });
}

function resolveCityFromCoords(lat?: string, lon?: string): string | null {
  if (lat == null || lon == null) return null;
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (Number.isNaN(latNum) || Number.isNaN(lonNum)) return null;
  return nearestCity(latNum, lonNum);
}