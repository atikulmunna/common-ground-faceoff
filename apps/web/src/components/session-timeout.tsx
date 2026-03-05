"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { signOut } from "next-auth/react";

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_MS = 5 * 60 * 1000;  // 5-minute warning before timeout
const WARNING_AT = TIMEOUT_MS - WARNING_MS; // show warning at 25 min

export function SessionTimeout() {
  const [showWarning, setShowWarning] = useState(false);
  const [remaining, setRemaining] = useState(WARNING_MS);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const lastActivityRef = useRef(Date.now());

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowWarning(false);
    setRemaining(WARNING_MS);
  }, []);

  useEffect(() => {
    const events = ["mousedown", "keydown", "scroll", "touchstart"] as const;
    const handler = () => resetTimer();

    for (const event of events) {
      window.addEventListener(event, handler, { passive: true });
    }

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;

      if (elapsed >= TIMEOUT_MS) {
        clearInterval(interval);
        void signOut({ callbackUrl: "/sign-in" });
        return;
      }

      if (elapsed >= WARNING_AT) {
        setShowWarning(true);
        setRemaining(Math.max(0, TIMEOUT_MS - elapsed));
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      for (const event of events) {
        window.removeEventListener(event, handler);
      }
    };
  }, [resetTimer]);

  if (!showWarning) return null;

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        bottom: "1rem",
        right: "1rem",
        background: "#fef3c7",
        border: "1px solid #f59e0b",
        borderRadius: "0.5rem",
        padding: "1rem 1.5rem",
        zIndex: 9999,
        maxWidth: "20rem"
      }}
    >
      <p style={{ margin: 0, fontWeight: 600 }}>Session expiring</p>
      <p style={{ margin: "0.25rem 0" }}>
        You will be signed out in {minutes}:{seconds.toString().padStart(2, "0")} due to inactivity.
      </p>
      <button onClick={resetTimer} style={{ marginTop: "0.5rem" }}>
        Stay signed in
      </button>
    </div>
  );
}
