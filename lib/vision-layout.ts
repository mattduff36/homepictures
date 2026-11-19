import type { ViewerCamera } from "./viewer-protocol";

export type Wall = "swann" | "all" | "ring";
export type LayoutPreference = "auto" | "featured" | "grid";
export type VisionPreferences = { layout: LayoutPreference; seconds: number; fit: "cover" | "contain"; dataSaver: boolean };
export const DEFAULT_VISION_PREFERENCES: VisionPreferences = { layout: "auto", seconds: 15, fit: "cover", dataSaver: false };
export const VISION_PREFERENCES_KEY = "mpdee.website.vision.v1";

export function normalizePreferences(value: unknown): VisionPreferences {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    layout: item.layout === "featured" || item.layout === "grid" ? item.layout : "auto",
    seconds: typeof item.seconds === "number" && Number.isFinite(item.seconds) ? Math.round(Math.min(3600, Math.max(5, item.seconds))) : 15,
    fit: item.fit === "contain" ? "contain" : "cover",
    dataSaver: item.dataSaver === true,
  };
}

export function effectiveLayout(preference: LayoutPreference, widePointer: boolean, override: "featured" | "grid" | null) {
  return preference === "auto" ? override ?? (widePointer ? "featured" : "grid") : preference;
}

export function featuredSlots(cameras: readonly ViewerCamera[], featuredId: string, offset: number): Record<string, string> {
  const selected = cameras.find(camera => camera.id === featuredId) ?? cameras[0];
  if (!selected) return {};
  const swann = cameras.filter(camera => camera.kind === "swann" && camera.id !== selected.id);
  const omitted = selected.kind === "ring" && swann.length > 4 ? Math.abs(offset) % swann.length : -1;
  const slots: Record<string, string> = {};
  let left = 0, bottom = 0;
  for (let index = 0; index < swann.length; index++) {
    slots[swann[index].id] = index === omitted ? "vision-feature-held" : `vision-feature-left-${++left}`;
  }
  for (const camera of cameras.filter(camera => camera.kind === "ring")) slots[camera.id] = `vision-feature-bottom-${++bottom}`;
  slots[selected.id] = "vision-feature-main";
  return slots;
}
