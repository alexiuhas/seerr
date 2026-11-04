import { useCallback, useRef } from 'react';

interface Wheel {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages (WheelEvent.deltaMode) */
  deltaMode: number;
}

interface ScrollRow {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

const LINE_HEIGHT = 16;

/**
 * How far a vertical mouse wheel should scroll a horizontal row, or null to
 * leave the wheel to the browser: for sideways gestures, rows that don't
 * overflow, and rows already at the end the wheel points to (so the panel
 * scrolls on instead of the row trapping the wheel).
 */
export const horizontalWheelDelta = (
  wheel: Wheel,
  row: ScrollRow
): number | null => {
  if (Math.abs(wheel.deltaX) >= Math.abs(wheel.deltaY)) {
    return null;
  }
  const maxScroll = row.scrollWidth - row.clientWidth;
  if (maxScroll <= 0) {
    return null;
  }
  const unit =
    wheel.deltaMode === 1
      ? LINE_HEIGHT
      : wheel.deltaMode === 2
        ? row.clientWidth
        : 1;
  const delta = wheel.deltaY * unit;
  const atEnd =
    (delta > 0 && row.scrollLeft >= maxScroll) ||
    (delta < 0 && row.scrollLeft <= 0);
  return atEnd ? null : delta;
};

/**
 * Scrolls a horizontal row with the mouse wheel while the pointer is on it.
 * Returns a callback ref, so it attaches whenever the row mounts.
 */
export const useHorizontalWheelScroll = () => {
  const detach = useRef<(() => void) | null>(null);
  return useCallback((row: HTMLElement | null) => {
    detach.current?.();
    detach.current = null;
    if (!row) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      const delta = horizontalWheelDelta(event, row);
      if (delta !== null) {
        event.preventDefault();
        row.scrollLeft += delta;
      }
    };
    // not passive, so the vertical scroll can be cancelled
    row.addEventListener('wheel', onWheel, { passive: false });
    detach.current = () => row.removeEventListener('wheel', onWheel);
  }, []);
};
