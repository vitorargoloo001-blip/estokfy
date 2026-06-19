import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after the user has
 * stopped changing it for `delay` ms. Use for search inputs and filters to
 * avoid running expensive queries / re-renders on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
}
