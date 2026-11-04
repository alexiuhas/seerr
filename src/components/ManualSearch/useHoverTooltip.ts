import { useEffect, useState } from 'react';
import type { Config } from 'react-popper-tooltip';

const CAN_HOVER = '(hover: hover)';

/**
 * Tooltip config that shows the tooltip on hover only where there is real
 * hover. On touch screens a tap counts as hovering and nothing ends it, so
 * the tooltip would linger over the page; there the button's aria-label has
 * to do.
 */
export function useHoverTooltip(): Partial<Config> {
  const [canHover, setCanHover] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(CAN_HOVER);
    setCanHover(query.matches);
    const onChange = (e: MediaQueryListEvent) => setCanHover(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return { trigger: canHover ? 'hover' : null };
}
