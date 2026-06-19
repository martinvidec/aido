"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "@/lib/firebase/firebase";

// Work-machine side of the device-login flow (issue #183, epic #186). Starts a
// flow (/api/auth/device/start), shows the user_code + a locally-generated QR of
// the verification URL, and polls (/api/auth/device/poll) until the user approves
// on their second device — then signs in with the returned Firebase custom token.
// The QR is generated client-side (no third-party service) so the code never
// leaks to the very proxy this flow exists to avoid.

interface StartResp {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

type Phase = "idle" | "waiting" | "signing-in" | "error";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function DeviceLoginPanel() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [info, setInfo] = useState<StartResp | null>(null);
  const [qr, setQr] = useState("");
  const [message, setMessage] = useState("");
  const cancelled = useRef(false);

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  // Generate the QR for the prefilled verification URL whenever a flow starts.
  useEffect(() => {
    if (!info) {
      setQr("");
      return;
    }
    QRCode.toDataURL(info.verification_uri_complete, { margin: 1, width: 200 })
      .then(setQr)
      .catch(() => setQr(""));
  }, [info]);

  async function start() {
    cancelled.current = false;
    setPhase("waiting");
    setMessage("");
    setInfo(null);
    let started: StartResp;
    try {
      const res = await fetch("/api/auth/device/start", { method: "POST" });
      if (!res.ok) throw new Error("start failed");
      started = (await res.json()) as StartResp;
    } catch {
      setPhase("error");
      setMessage("Konnte die Anmeldung nicht starten. Bitte erneut versuchen.");
      return;
    }
    setInfo(started);
    void poll(started);
  }

  async function poll(started: StartResp) {
    let interval = Math.max(1, started.interval) * 1000;
    while (!cancelled.current) {
      await sleep(interval);
      if (cancelled.current) return;
      let data: { firebaseCustomToken?: string; error?: string };
      try {
        const res = await fetch("/api/auth/device/poll", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ device_code: started.device_code }),
        });
        data = await res.json();
      } catch {
        continue; // transient network blip — keep polling
      }
      if (data.firebaseCustomToken) {
        setPhase("signing-in");
        try {
          await signInWithCustomToken(auth, data.firebaseCustomToken);
          // AuthProvider picks up the session; LoginPage redirects to /todos.
        } catch {
          setPhase("error");
          setMessage("Anmeldung fehlgeschlagen. Bitte erneut versuchen.");
        }
        return;
      }
      switch (data.error) {
        case "authorization_pending":
          break; // keep waiting
        case "slow_down":
          interval += 5000;
          break;
        case "access_denied":
          setPhase("error");
          setMessage("Auf dem anderen Gerät abgelehnt.");
          return;
        case "expired_token":
          setPhase("error");
          setMessage("Der Code ist abgelaufen. Bitte erneut starten.");
          return;
        default:
          setPhase("error");
          setMessage("Anmeldung fehlgeschlagen. Bitte erneut starten.");
          return;
      }
    }
  }

  function reset() {
    cancelled.current = true;
    setPhase("idle");
    setInfo(null);
    setMessage("");
  }

  if (phase === "idle") {
    return (
      <button
        onClick={start}
        className="inline-flex items-center px-6 py-3 bg-bg-card border border-border rounded-md shadow-sm text-base font-medium text-text hover:bg-row-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-bg focus:ring-accent"
      >
        Über Zweitgerät anmelden
      </button>
    );
  }

  if (phase === "signing-in") {
    return <p className="text-text-dim">Anmeldung läuft …</p>;
  }

  if (phase === "error") {
    return (
      <div className="w-full max-w-sm text-center">
        <p className="text-sm text-danger mb-3">{message}</p>
        <button onClick={start} className="rounded-full bg-accent px-4 py-2 font-extrabold text-white">
          Erneut versuchen
        </button>
      </div>
    );
  }

  // waiting
  return (
    <div className="w-full max-w-sm rounded-2xl border border-border bg-bg-card p-6 text-center shadow-sm">
      <p className="text-text-dim mb-4">
        Öffne <span className="font-semibold text-text">{info?.verification_uri}</span> auf deinem Handy
        und gib diesen Code ein:
      </p>
      <p className="font-mono text-3xl font-black tracking-widest mb-4">{info?.user_code}</p>
      {qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR-Code zum Anmelden" width={200} height={200} className="mx-auto mb-4 rounded-lg bg-white p-2" />
      )}
      <p className="text-sm text-text-dim mb-4">Warte auf Bestätigung vom anderen Gerät …</p>
      <button onClick={reset} className="text-sm font-semibold text-text-dim hover:text-text">
        Abbrechen
      </button>
    </div>
  );
}
