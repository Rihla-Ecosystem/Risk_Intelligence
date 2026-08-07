import { describe, it, expect } from "vitest";
import { nearestCity } from "../engine/models.js";
import { registerRoutes } from "../api/routes.js";
import Fastify from "fastify";

describe("nearestCity", () => {
  it("resolves coordinates to the closest supported city", () => {
    expect(nearestCity(30.0444, 31.2357)).toBe("cairo");
    expect(nearestCity(31.2, 29.9)).toBe("alexandria");
    expect(nearestCity(27.26, 33.81)).toBe("hurghada");
  });
});

describe("GET /safety/current with lat/lon", () => {
  it("resolves lat/lon to a city and returns its state", async () => {
    const app = Fastify();
    await registerRoutes(app);
    const res = await app.inject({
      method: "GET",
      url: "/safety/current?lat=30.0444&lon=31.2357",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.city).toBe("cairo");
    expect("staticNote" in body).toBe(true);
    await app.close();
  });

  it("ignores invalid coordinates and returns the full state map", async () => {
    const app = Fastify();
    await registerRoutes(app);
    const res = await app.inject({
      method: "GET",
      url: "/safety/current?lat=notanumber&lon=31.2",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).not.toHaveProperty("city");
    await app.close();
  });

  it("city param takes precedence over coordinates", async () => {
    const app = Fastify();
    await registerRoutes(app);
    const res = await app.inject({
      method: "GET",
      url: "/safety/current?city=luxor&lat=30.0444&lon=31.2357",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().city).toBe("luxor");
    await app.close();
  });
});