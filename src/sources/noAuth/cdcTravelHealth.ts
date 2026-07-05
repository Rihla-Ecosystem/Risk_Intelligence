import { XMLParser } from "fast-xml-parser";
import type { SourceAdapter, RiskEvent, Checkpoint } from "../../engine/models.js";
import { textSeverityClassifier, advisoryLevelSeverity } from "../../severity/rules.js";

const parser = new XMLParser({ ignoreAttributes: false });

export const cdcTravelHealth: SourceAdapter = {
  name: "cdc_travel_health",
  intervalMinutes: 720,
  enabled: true,

  buildRequest() {
    return { url: "https://wwwnc.cdc.gov/travel/rss/notices.xml" };
  },

  parse(raw: any): RiskEvent[] {
    const xml = typeof raw === "string" ? raw : String(raw);
    let parsed: any;
    try {
      parsed = parser.parse(xml);
    } catch (err) {
      console.error("cdc_travel_health: failed to parse RSS XML", err);
      return [];
    }

    const items = parsed?.rss?.channel?.item;
    const itemList = Array.isArray(items) ? items : items ? [items] : [];

    return itemList
      .filter((item: any) => {
        const title: string = item.title ?? "";
        return title.toLowerCase().includes("egypt");
      })
      .map((item: any) => {
        const title: string = item.title ?? "";
        const levelMatch = title.match(/Level\s+(\d)/i);
        const level = levelMatch ? Number(levelMatch[1]) : 0;
        // use level-based severity if we have a clear level, else fall back to text classifier
        const severity = level >= 1 ? advisoryLevelSeverity(level) : textSeverityClassifier(title);

        return {
          source: "cdc_travel_health",
          category: "health" as const,
          severity,
          city: null,
          lat: 0,
          lon: 0,
          headline: title,
          effectiveTime: item.pubDate ?? new Date().toISOString(),
          rawRef: item.link ?? "",
        };
      });
  },

  nextCheckpoint(_raw: any, _events: RiskEvent[], prev: Checkpoint): Checkpoint {
    return { ...prev, lastUpdateTime: new Date().toISOString() };
  },
};
