const isDev = import.meta.env.DEV;

export const logger = {
  info(label: string, ...args: unknown[]) {
    if (isDev) console.info(`[INFO] ${label}`, ...args);
  },
  warn(label: string, ...args: unknown[]) {
    console.warn(`[WARN] ${label}`, ...args);
  },
  error(label: string, ...args: unknown[]) {
    console.error(`[ERROR] ${label}`, ...args);
  },
  group(label: string, data: Record<string, unknown>) {
    if (!isDev) return;
    console.group(`[API] ${label}`);
    for (const [k, v] of Object.entries(data)) {
      console.log(`${k}:`, v);
    }
    console.groupEnd();
  },
};
