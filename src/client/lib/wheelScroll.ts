// Chip strips (`.sort-strip`) scroll sideways, which touch screens and
// trackpads do on their own but a mouse wheel doesn't: over a strip that can
// scroll that way, turn the wheel's vertical turn into a sideways scroll.

const LINE_PX = 16;

const onWheel = (event: WheelEvent): void => {
  if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  const target = event.target instanceof Element ? event.target : null;
  const strip = target?.closest<HTMLElement>(".sort-strip");
  if (!strip) return;
  const max = strip.scrollWidth - strip.clientWidth;
  if (max <= 0) return;
  const delta =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? event.deltaY * LINE_PX
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? event.deltaY * strip.clientWidth
        : event.deltaY;
  const next = Math.max(0, Math.min(max, strip.scrollLeft + delta));
  // At either end, let the wheel scroll the page as usual.
  if (next === strip.scrollLeft) return;
  event.preventDefault();
  strip.scrollLeft = next;
};

export const installWheelScroll = (): void => {
  window.addEventListener("wheel", onWheel, { passive: false });
};
