import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLiveRefresh } from "./use-live-refresh";

let hidden = false;

function setTabHidden(value: boolean) {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useLiveRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes on the interval while the tab is visible", () => {
    const refresh = vi.fn();
    renderHook(() => useLiveRefresh(refresh, 3_000));

    vi.advanceTimersByTime(9_000);

    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("pauses while the tab is hidden and catches up as soon as it is visible again", () => {
    const refresh = vi.fn();
    renderHook(() => useLiveRefresh(refresh, 3_000));

    vi.advanceTimersByTime(3_000);
    setTabHidden(true);
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    setTabHidden(false);
    expect(refresh).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(3_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("without an interval, refreshes only when the tab becomes visible again", () => {
    const refresh = vi.fn();
    renderHook(() => useLiveRefresh(refresh, null));

    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();

    setTabHidden(true);
    setTabHidden(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the interval is cleared, and everything stops on unmount", () => {
    const refresh = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ interval }: { interval: number | null }) => useLiveRefresh(refresh, interval),
      { initialProps: { interval: 3_000 as number | null } },
    );

    rerender({ interval: null });
    vi.advanceTimersByTime(30_000);
    expect(refresh).not.toHaveBeenCalled();

    unmount();
    setTabHidden(true);
    setTabHidden(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("uses the latest refresh function without restarting the timer", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ refresh }) => useLiveRefresh(refresh, 3_000), {
      initialProps: { refresh: first },
    });

    vi.advanceTimersByTime(2_000);
    rerender({ refresh: second });
    vi.advanceTimersByTime(1_000);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
