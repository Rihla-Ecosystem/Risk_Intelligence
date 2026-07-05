import type { SourceAdapter, RiskEvent, Checkpoint } from "../../engine/models.js";
import { nearestCity } from "../../engine/models.js";
import { textSeverityClassifier } from "../../severity/rules.js";

interface AcledToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface AcledEvent {
  event_id_cnty: string;
  event_date: string;
  event_type: string;
  sub_event_type: string;
  fatalities: number;
  location: string;
  latitude: number;
  longitude: number;
  notes: string;
  timestamp: string;
}

const ACLED_EMAIL = process.env.ACLED_EMAIL;
const ACLED_PASSWORD = process.env.ACLED_PASSWORD;

async function fetchToken(): Promise<AcledToken> {
  const res = await fetch("https://acleddata.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: ACLED_EMAIL ?? "",
      password: ACLED_PASSWORD ?? "",
      grant_type: "password",
      client_id: "acled",
      scope: "authenticated",
    }),
  });
  if (!res.ok) throw new Error(`ACLED auth failed: ${res.status}`);
  const body = await res.json();
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
}

async function refreshToken(token: AcledToken): Promise<AcledToken> {
  const res = await fetch("https://acleddata.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: token.refreshToken,
      grant_type: "refresh_token",
      client_id: "acled",
    }),
  });
  if (!res.ok) throw new Error(`ACLED token refresh failed: ${res.status}`);
  const body = await res.json();
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? token.refreshToken,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
}

async function loadOrRenewToken(checkpoint: Checkpoint): Promise<AcledToken> {
  const stored = checkpoint.acledToken as AcledToken | undefined;

  if (!stored) return fetchToken();
  if (stored.expiresAt > Date.now() + 60_000) return stored; // still valid
  if (stored.expiresAt > Date.now() - 13 * 24 * 3600_000) return refreshToken(stored); // refresh if not too old
  return fetchToken(); // too old, fresh login
}

const SEVERITY_BY_TYPE: Record<string, string> = {
  "Violence against civilians": "warning",
  Riots: "warning",
  Battles: "warning",
  "Explosions/Remote violence": "critical",
  Protests: "advisory",
  "Strategic development": "advisory",
};

function acledSeverity(event: AcledEvent): "info" | "advisory" | "warning" | "critical" {
  if (event.fatalities >= 3) return "critical";
  if (event.fatalities >= 1) return "warning";
  const byType = SEVERITY_BY_TYPE[event.event_type];
  if (byType) return byType as any;
  return textSeverityClassifier(`${event.event_type} ${event.sub_event_type} ${event.notes ?? ""}`);
}

export const acledUnrest: SourceAdapter = {
  name: "acled_unrest",
  intervalMinutes: 60,
  enabled: true,

  buildRequest() {
    return { url: "" };
  },

  async fetchData(checkpoint: Checkpoint): Promise<{ raw: unknown; events: RiskEvent[] }> {
    const token = await loadOrRenewToken(checkpoint);

    const startDate = checkpoint.lastUpdateTime
      ? new Date(checkpoint.lastUpdateTime).toISOString().split("T")[0]
      : new Date(Date.now() - 7 * 24 * 3600_000).toISOString().split("T")[0];

    const endDate = new Date().toISOString().split("T")[0];

    const res = await fetch(
      `https://acleddata.com/api/acled/read?_format=json&country=Egypt&event_date_where=BETWEEN&event_date=${startDate}|${endDate}&limit=50`,
      { headers: { Authorization: `Bearer ${token.accessToken}` } },
    );

    if (!res.ok) throw new Error(`ACLED API error ${res.status}`);

    const raw: any = await res.json();
    raw._acledToken = token; // pass back to nextCheckpoint for persistence

    const events: AcledEvent[] = raw.data ?? [];

    return {
      raw,
      events: events.map((e) => ({
        source: "acled_unrest",
        category: "unrest" as const,
        severity: acledSeverity(e),
        city: nearestCity(e.latitude, e.longitude),
        lat: e.latitude,
        lon: e.longitude,
        headline: `${e.event_type} in ${e.location}${e.fatalities > 0 ? ` (${e.fatalities} fatalities)` : ""}`,
        detail: `${e.sub_event_type} — ${e.notes ?? ""}`.slice(0, 500) || undefined,
        effectiveTime: new Date(e.event_date).toISOString(),
        rawRef: e.event_id_cnty,
      })),
    };
  },

  parse(): RiskEvent[] {
    return [];
  },

  nextCheckpoint(raw: any, _events: RiskEvent[], prev: Checkpoint): Checkpoint {
    const token = raw?._acledToken as AcledToken | undefined;
    return {
      ...prev,
      acledToken: token,
      lastUpdateTime: new Date().toISOString(),
    } as any;
  },
};
