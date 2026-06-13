/**
 * GCP credentials shim for serverless (Vercel).
 *
 * Locally we use GOOGLE_APPLICATION_CREDENTIALS = a path to the service-account
 * JSON. That file doesn't exist on Vercel, so we instead ship the key as a
 * base64 env var (GCP_SA_KEY_B64), materialize it to /tmp on first use, and
 * point Application Default Credentials at it. After this runs, the BigQuery
 * and Vertex SDKs authenticate exactly as they do locally.
 *
 * Best-effort: if neither a usable file path nor GCP_SA_KEY_B64 is present,
 * this is a no-op and callers fall back to their unconfigured path.
 */

import { writeFileSync, existsSync } from "node:fs";

let _ensured = false;

export function ensureGcpCredentials(): void {
  if (_ensured) return;
  _ensured = true;

  // A real, readable key file already configured? Keep it.
  const existing = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (existing && existsSync(existing)) return;

  const b64 = process.env.GCP_SA_KEY_B64;
  if (!b64) return;

  try {
    const json = Buffer.from(b64, "base64").toString("utf8");
    const path = "/tmp/gcp-sa.json";
    writeFileSync(path, json);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path;
    if (!process.env.GOOGLE_CLOUD_PROJECT && !process.env.GCP_PROJECT) {
      try {
        process.env.GOOGLE_CLOUD_PROJECT = JSON.parse(json).project_id;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore — leave ADC as-is */
  }
}

/** True once GCP auth is materially available (file path or inline key). */
export function gcpCredsAvailable(): boolean {
  ensureGcpCredentials();
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  return Boolean((p && existsSync(p)) || process.env.GCP_SA_KEY_B64);
}
