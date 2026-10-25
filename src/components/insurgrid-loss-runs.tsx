import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createInsurGridSession, insurGridConfigured } from "@/lib/insurgrid";

const EMBED_SRC = "https://dashboard.insurgrid.com/embed.js";

interface InsurGridApi {
  mount: (
    el: HTMLElement,
    opts: {
      product: "loss-runs";
      minHeight?: number;
      getToken: () => Promise<{ token: string; expiresAt: string }>;
    },
  ) => { destroy: () => void };
}

declare global {
  interface Window {
    InsurGrid?: InsurGridApi;
  }
}

// Loaded without the snippet's data-token-url so it doesn't auto-mount; we
// mount it ourselves and hand it tokens from a server function instead.
let scriptPromise: Promise<InsurGridApi> | null = null;
function loadEmbedScript(): Promise<InsurGridApi> {
  if (window.InsurGrid) return Promise.resolve(window.InsurGrid);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = EMBED_SRC;
    script.async = true;
    script.onload = () =>
      window.InsurGrid ? resolve(window.InsurGrid) : reject(new Error("InsurGrid failed to load"));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("InsurGrid failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function InsurGridLossRuns() {
  const target = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState(false);
  const checkConfigured = useServerFn(insurGridConfigured);
  const getSession = useServerFn(createInsurGridSession);

  const { data: configured, isLoading } = useQuery({
    queryKey: ["insurgrid-configured"],
    queryFn: () => checkConfigured(),
  });

  useEffect(() => {
    if (!configured || !target.current) return;
    let embed: { destroy: () => void } | undefined;
    let cancelled = false;
    loadEmbedScript()
      .then((api) => {
        if (cancelled || !target.current) return;
        embed = api.mount(target.current, {
          product: "loss-runs",
          minHeight: 640,
          getToken: () => getSession(),
        });
      })
      .catch(() => setLoadError(true));
    return () => {
      cancelled = true;
      embed?.destroy();
    };
  }, [configured, getSession]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!configured) {
    return (
      <p className="text-sm text-muted-foreground">
        Connecting directly to your carrier through InsurGrid is coming soon. Use "Request Manually"
        in the meantime.
      </p>
    );
  }
  if (loadError) {
    return (
      <p className="text-sm text-destructive">
        InsurGrid couldn't be loaded. Please try again later or use "Request Manually".
      </p>
    );
  }
  return <div ref={target} id="insurgrid-loss-runs" />;
}
