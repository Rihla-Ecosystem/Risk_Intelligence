import type { Severity } from "../engine/models.js";

export function textSeverityClassifier(text: string): Severity {
  const t = text.toLowerCase();
  if (["death", "fatal", "kill", "emergency", "evacuate"].some((w) => t.includes(w))) return "critical";
  if (["outbreak", "casualt", "injured", "warning", "severe", "pandemic"].some((w) => t.includes(w))) return "warning";
  if (["risk", "unrest", "protest", "clash", "advisory", "caution", "threat"].some((w) => t.includes(w))) return "advisory";
  return "info";
}

export function earthquakeSeverity(magnitude: number): Severity {
  if (magnitude >= 6.5) return "critical";
  if (magnitude >= 5.0) return "warning";
  if (magnitude >= 3.5) return "advisory";
  return "info";
}

export function uvIndexSeverity(uvIndex: number): Severity {
  if (uvIndex >= 11) return "critical";
  if (uvIndex >= 8) return "warning";
  if (uvIndex >= 6) return "advisory";
  return "info";
}

export function tempSeverity(celsius: number): Severity {
  if (celsius >= 45) return "critical";
  if (celsius >= 40) return "warning";
  if (celsius >= 36) return "advisory";
  return "info";
}

export function aqiSeverity(aqi: number): Severity {
  // OpenWeatherMap AQI scale: 1 (good) to 5 (very poor)
  if (aqi >= 5) return "critical";
  if (aqi >= 4) return "warning";
  if (aqi >= 3) return "advisory";
  return "info";
}

export function fireConfidenceSeverity(confidencePct: number, frp: number): Severity {
  if (confidencePct >= 80 && frp >= 50) return "critical";
  if (confidencePct >= 60) return "warning";
  if (confidencePct >= 30) return "advisory";
  return "info";
}

export function advisoryLevelSeverity(level: number): Severity {
  if (level >= 4) return "critical";
  if (level === 3) return "warning";
  if (level === 2) return "advisory";
  return "info";
}