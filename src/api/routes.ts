import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { SourceAdapter } from "../engine/models.js";
import { runSource } from "../engine/poller.js";
import { runAllOnce } from "../engine/scheduler.js";
import { getCityState, getAllStates } from "../engine/currentState.js";
import { getChangesSince } from "../engine/eventLog.js";
import { getSourcesHealth } from "../engine/health.js";
import { getStaticCrimeNotes } from "../sources/deferred/numboCrime.stub.js";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_ACCESS_SECRET || "";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

async function authHook(req: FastifyRequest, reply: FastifyReply) {
   

  return ;
}

export async function registerRoutes(app: FastifyInstance, adapters?: SourceAdapter[]) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dashboardPath = path.join(__dirname, "..", "public", "dashboard.html");

  app.get("/", async (_req, reply) => {
    const html = await readFile(dashboardPath, "utf8");
    return reply.type("text/html").send(html);
  });

  app.addHook("preHandler", authHook);

  app.get("/safety/current", async (req, reply) => {
    const { city } = req.query as { city?: string };

    if (city) {
      const state = await getCityState(city);
      const staticNotes = await getStaticCrimeNotes();
      if (!state && !staticNotes[city]) {
        return reply.code(404).send({ error: `no data for city: ${city}` });
      }
      return {
        city,
        ...state,
        staticNote: staticNotes[city] ?? null,
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

  app.post("/safety/refresh", async (req, reply) => {
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