import type { SourceAdapter, RiskEvent, Checkpoint } from "../../engine/models.js";
import { textSeverityClassifier } from "../../severity/rules.js";

const EGYPT_KEYWORDS = ["egypt", "cairo", "nile", "sinai"];

function isEgyptRelevant(title: string, overview: string, summary: string): boolean {
  const text = `${title} ${overview} ${summary}`.toLowerCase();
  return EGYPT_KEYWORDS.some((kw) => text.includes(kw));
}

interface WhoDonItem {
  Id: string;
  Title: string;
  PublicationDate: string;
  ItemDefaultUrl: string;
  Overview: string;
  Summary: string;
}

export const whoOutbreak: SourceAdapter = {
  name: "who_outbreak",
  intervalMinutes: 720,
  enabled: true,

  buildRequest() {
    const params = new URLSearchParams({
      $top: "10",
      $orderby: "PublicationDate desc",
    });
    return { url: `https://www.who.int/api/news/diseaseoutbreaknews?${params}` };
  },

  parse(raw: any, checkpoint: Checkpoint): RiskEvent[] {
    const items = (raw?.value ?? []) as WhoDonItem[];
    const seenIds: string[] = Array.isArray(checkpoint.seenIds) ? checkpoint.seenIds as string[] : [];
    const lastUpdate = checkpoint.lastUpdateTime ? new Date(checkpoint.lastUpdateTime).getTime() : 0;

    return items
      .filter((item) => {
        if (seenIds.includes(item.Id)) return false;
        if (!isEgyptRelevant(item.Title, item.Overview ?? "", item.Summary ?? "")) return false;
        const pubDate = new Date(item.PublicationDate).getTime();
        if (pubDate <= lastUpdate) return false;
        return true;
      })
      .map((item) => ({
        source: "who_outbreak",
        category: "health" as const,
        severity: textSeverityClassifier(`${item.Title} ${item.Summary ?? ""}`),
        city: null,
        lat: 0,
        lon: 0,
        headline: item.Title,
        detail: item.Summary || item.Overview?.replace(/<[^>]+>/g, "").slice(0, 500),
        effectiveTime: item.PublicationDate,
        rawRef: `https://www.who.int${item.ItemDefaultUrl}`,
      }));
  },

  nextCheckpoint(raw: any, events: RiskEvent[], prev: Checkpoint): Checkpoint {
    const items = (raw?.value ?? []) as WhoDonItem[];
    const allIds = items.map((i) => i.Id);
    const prevSeen: string[] = Array.isArray(prev.seenIds) ? prev.seenIds as string[] : [];
    const merged = Array.from(new Set([...prevSeen, ...allIds])).slice(-200);

    // use the latest PublicationDate from all returned items as our checkpoint
    const dates = items.map((i) => i.PublicationDate).filter(Boolean).sort();
    const latestDate = dates.length > 0 ? dates[dates.length - 1] : new Date().toISOString();

    return { ...prev, seenIds: merged, lastUpdateTime: latestDate };
  },
};
