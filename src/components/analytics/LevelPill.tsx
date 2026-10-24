import { Pill } from "@/components/ui/Pill";
import { LEVEL_LABEL, type Level } from "@/lib/analytics/recommendations";

export function LevelPill({ level }: { level: Level }) {
  const tone = level === "strong" ? "strong" : level === "developing" ? "marigold" : level === "priority" ? "coral" : "neutral";
  return <Pill tone={tone}>{LEVEL_LABEL[level]}</Pill>;
}
