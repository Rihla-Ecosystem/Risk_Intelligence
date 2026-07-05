import { describe, it, expect } from "vitest";
import {
  earthquakeSeverity,
  uvIndexSeverity,
  tempSeverity,
  aqiSeverity,
  fireConfidenceSeverity,
  advisoryLevelSeverity,
  textSeverityClassifier,
} from "../severity/rules.js";

describe("earthquakeSeverity", () => {
  it("returns info for magnitude < 3.5", () => {
    expect(earthquakeSeverity(3.0)).toBe("info");
    expect(earthquakeSeverity(3.4)).toBe("info");
  });
  it("returns advisory for magnitude 3.5–4.9", () => {
    expect(earthquakeSeverity(3.5)).toBe("advisory");
    expect(earthquakeSeverity(4.0)).toBe("advisory");
    expect(earthquakeSeverity(4.9)).toBe("advisory");
  });
  it("returns warning for magnitude 5.0–6.4", () => {
    expect(earthquakeSeverity(5.0)).toBe("warning");
    expect(earthquakeSeverity(6.0)).toBe("warning");
    expect(earthquakeSeverity(6.4)).toBe("warning");
  });
  it("returns critical for magnitude >= 6.5", () => {
    expect(earthquakeSeverity(6.5)).toBe("critical");
    expect(earthquakeSeverity(8.0)).toBe("critical");
  });
});

describe("uvIndexSeverity", () => {
  it("returns info for UV < 6", () => expect(uvIndexSeverity(5)).toBe("info"));
  it("returns advisory for UV 6–7", () => expect(uvIndexSeverity(6)).toBe("advisory"));
  it("returns warning for UV 8–10", () => expect(uvIndexSeverity(8)).toBe("warning"));
  it("returns critical for UV >= 11", () => expect(uvIndexSeverity(11)).toBe("critical"));
});

describe("tempSeverity", () => {
  it("returns info for temp < 36", () => expect(tempSeverity(35)).toBe("info"));
  it("returns advisory for temp 36–39", () => expect(tempSeverity(37)).toBe("advisory"));
  it("returns warning for temp 40–44", () => expect(tempSeverity(42)).toBe("warning"));
  it("returns critical for temp >= 45", () => expect(tempSeverity(45)).toBe("critical"));
});

describe("aqiSeverity", () => {
  it("returns info for AQI 1–2", () => expect(aqiSeverity(2)).toBe("info"));
  it("returns advisory for AQI 3", () => expect(aqiSeverity(3)).toBe("advisory"));
  it("returns warning for AQI 4", () => expect(aqiSeverity(4)).toBe("warning"));
  it("returns critical for AQI 5", () => expect(aqiSeverity(5)).toBe("critical"));
});

describe("fireConfidenceSeverity", () => {
  it("returns info for confidence < 30%", () => expect(fireConfidenceSeverity(20, 0)).toBe("info"));
  it("returns advisory for confidence 30–59%", () => expect(fireConfidenceSeverity(50, 0)).toBe("advisory"));
  it("returns warning for confidence 60–79%", () => expect(fireConfidenceSeverity(70, 0)).toBe("warning"));
  it("returns critical for confidence >=80% and FRP >= 50", () => expect(fireConfidenceSeverity(85, 60)).toBe("critical"));
  it("returns warning for confidence >=80% but low FRP", () => expect(fireConfidenceSeverity(85, 10)).toBe("warning"));
});

describe("advisoryLevelSeverity", () => {
  it("returns info for level 1", () => expect(advisoryLevelSeverity(1)).toBe("info"));
  it("returns advisory for level 2", () => expect(advisoryLevelSeverity(2)).toBe("advisory"));
  it("returns warning for level 3", () => expect(advisoryLevelSeverity(3)).toBe("warning"));
  it("returns critical for level >= 4", () => {
    expect(advisoryLevelSeverity(4)).toBe("critical");
    expect(advisoryLevelSeverity(5)).toBe("critical");
  });
});

describe("textSeverityClassifier", () => {
  it("returns info for neutral text", () => {
    expect(textSeverityClassifier("The weather is pleasant today")).toBe("info");
  });
  it("returns advisory for risk-related text", () => {
    expect(textSeverityClassifier("There is a risk of flooding in the Nile Delta")).toBe("advisory");
    expect(textSeverityClassifier("Protesters gathered in Tahrir Square")).toBe("advisory");
    expect(textSeverityClassifier("Travel advisory issued for Cairo")).toBe("advisory");
  });
  it("returns warning for outbreak/casualty text", () => {
    expect(textSeverityClassifier("Dengue outbreak reported in Aswan")).toBe("warning");
    expect(textSeverityClassifier("Several casualties after building collapse")).toBe("warning");
  });
  it("returns critical for death/emergency text", () => {
    expect(textSeverityClassifier("Two fatalities in Luxor bus accident")).toBe("critical");
    expect(textSeverityClassifier("Emergency evacuation ordered in coastal areas")).toBe("critical");
  });
  it("handles case-insensitive matching", () => {
    expect(textSeverityClassifier("DEATH TOLL RISES IN EGYPT")).toBe("critical");
    expect(textSeverityClassifier("Outbreak ALERT In Cairo")).toBe("warning");
  });
});
