"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps a view fresh without polling a tab nobody is looking at.
 *
 * Calls `refresh` every `intervalMs` while the tab is visible, pauses while it is
 * hidden, and refreshes once as soon as it becomes visible again. With
 * `intervalMs` null it only does the catch-up refresh. It does not refresh on
 * mount; load initial data separately.
 */
export function useLiveRefresh(refresh: () => unknown, intervalMs: number | null): void {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const run = () => {
      void refreshRef.current();
    };
    const start = () => {
      if (intervalMs !== null && timer === null) timer = setInterval(run, intervalMs);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        run();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs]);
}
