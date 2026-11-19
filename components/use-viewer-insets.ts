"use client";

import { useLayoutEffect, type RefObject } from "react";

/** Insets belong to screen edges, not every cell of the camera wall. */
export function useViewerInsets(root: RefObject<HTMLElement | null>, enabled: boolean, layout: string) {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !enabled) return;
    let tiles = [...element.querySelectorAll<HTMLElement>(".vision-tile,.vision-feature-ring-copy")];
    let frame = 0;
    const measure = () => {
      frame = 0;
      const screen = element.getBoundingClientRect();
      // Read all geometry before writing styles; no measurement on media frames.
      const positions = tiles.filter(tile => !tile.hidden).map(tile => ({tile, box: tile.getBoundingClientRect()}));
      for (const {tile, box} of positions) {
        const distances = {top: box.top - screen.top, right: screen.right - box.right,
          bottom: screen.bottom - box.bottom, left: box.left - screen.left};
        for (const [edge, distance] of Object.entries(distances)) {
          tile.style.setProperty(`--vision-edge-${edge}`, `${Math.max(0, distance)}px`);
        }
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    observer?.observe(element);
    tiles.forEach(tile => observer?.observe(tile));
    // A render-error boundary may replace a tile without changing the wall layout.
    const replacements = new MutationObserver(() => {
      observer?.disconnect();
      tiles = [...element.querySelectorAll<HTMLElement>(".vision-tile,.vision-feature-ring-copy")];
      observer?.observe(element);
      tiles.forEach(tile => observer?.observe(tile));
      schedule();
    });
    const grid = element.querySelector(".vision-grid");
    if (grid) replacements.observe(grid, {childList:true});
    window.addEventListener("resize", schedule);
    window.addEventListener("pageshow", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      replacements.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pageshow", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [root, enabled, layout]);
}
