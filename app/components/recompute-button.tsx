"use client";

import { useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Public, password-gated button to re-run the BigQuery index (POST /api/recompute). */
export function RecomputeButton() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setMsg("Re-scanning BigQuery…");
    try {
      const res = await fetch("/api/recompute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const j = await res.json();
      if (res.status === 401) setMsg("Wrong password.");
      else if (!res.ok) setMsg(`Failed: ${j.error ?? res.status}`);
      else if (j.skipped) setMsg(`Skipped — ${j.reason ?? "not configured"}.`);
      else
        setMsg(
          `Done — ${j.agentsUpserted ?? "?"} agents · ${j.feedback ?? "?"} feedback · ${j.ratedAgents ?? "?"} rated.`,
        );
    } catch (e) {
      setMsg(`Failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-[11px] text-muted-foreground shadow-soft-sm transition-colors hover:border-signal-ink/40 hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Re-run BigQuery index
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && run()}
            placeholder="password"
            autoFocus
            className="h-8 w-28 rounded-lg border border-border bg-background px-2.5 font-mono text-xs text-foreground outline-none focus:border-signal-ink/50"
          />
          <button
            onClick={run}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-signal px-3 py-1.5 font-mono text-[11px] font-semibold text-signal-foreground shadow-soft-sm transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            {loading ? "Running…" : "Run"}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label="cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {msg && <span className="font-mono text-[10px] text-muted-foreground">{msg}</span>}
    </div>
  );
}
