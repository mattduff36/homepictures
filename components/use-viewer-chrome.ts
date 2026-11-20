"use client";

import { useEffect, type RefObject } from "react";

/** Keep idle overlays quiet without rerendering or restarting camera players. */
export function useViewerChrome(root: RefObject<HTMLElement | null>, enabled: boolean, held: boolean, view: string) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let controls: ReturnType<typeof setTimeout> | undefined;
    let badges: ReturnType<typeof setTimeout> | undefined;
    let wakeClick = false;
    let wakeDoubleClick = false;
    let lastMouseMove = -Infinity;
    const pointers = new Set<number>();
    const clear = () => { clearTimeout(controls); clearTimeout(badges); };
    const schedule = () => {
      clear();
      if (!enabled || held || pointers.size || document.hidden) return;
      controls = setTimeout(() => {
        // A keyboard user must not lose the control they are operating.
        if (!element.querySelector(":focus-visible")) element.setAttribute("data-controls", "hidden");
      }, 3000);
      badges = setTimeout(() => { element.setAttribute("data-badges", "quiet"); }, 8000);
    };
    const reveal = () => {
      element.setAttribute("data-controls", "shown");
      element.setAttribute("data-badges", "shown");
      schedule();
    };
    reveal();
    if (!enabled || held) return clear;

    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      wakeClick = element.dataset.controls === "hidden";
      pointers.add(event.pointerId);
      reveal();
    };
    const up = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      if (event.type === "pointercancel") wakeClick = false;
      schedule();
    };
    const click = (event: MouseEvent) => {
      // detail=0 is keyboard/assistive activation; keep its normal action.
      const consume = event.detail > 0 && (wakeClick || element.dataset.controls === "hidden");
      wakeClick = false;
      if (event.detail === 1) wakeDoubleClick = consume;
      reveal();
      if (consume) { event.preventDefault(); event.stopPropagation(); }
    };
    const doubleClick = (event: MouseEvent) => {
      if (!wakeDoubleClick) return;
      wakeDoubleClick = false;
      event.preventDefault(); event.stopPropagation();
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || performance.now() - lastMouseMove < 250) return;
      lastMouseMove = performance.now();
      reveal();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (!event.altKey && !event.ctrlKey && !event.metaKey &&
          ["Tab", "Enter", " ", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) reveal();
    };
    const visibility = () => {
      pointers.clear(); wakeClick = false;
      if (document.hidden) clear(); else reveal();
    };
    const focusOut = () => { if (element.dataset.controls !== "hidden") schedule(); };
    element.addEventListener("pointerdown", down, true);
    element.addEventListener("pointermove", move, {passive: true});
    element.addEventListener("click", click, true);
    element.addEventListener("dblclick", doubleClick, true);
    element.addEventListener("focusin", reveal);
    element.addEventListener("focusout", focusOut);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", reveal);
    return () => {
      clear();
      element.removeEventListener("pointerdown", down, true);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("click", click, true);
      element.removeEventListener("dblclick", doubleClick, true);
      element.removeEventListener("focusin", reveal);
      element.removeEventListener("focusout", focusOut);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pageshow", reveal);
    };
  }, [root, enabled, held, view]);
}
