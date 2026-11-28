"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ScormLaunch } from "@/lib/scorm/types";

/**
 * SCORM 1.2 run-time (window.API) for one package, shown full-viewport in a same-origin iframe.
 *
 * - Values come from scorm_launch; writes are buffered and sent to /api/scorm/commit on
 *   LMSCommit, every 30 s while dirty, on LMSFinish and when the page is hidden/unloaded
 *   (sendBeacon). The server validates everything and never moves a status backwards.
 * - Activity inside the frame doesn't reach the app's idle sign-out (events don't cross
 *   frames), so it is relayed to the parent window.
 */
type Errors = "0" | "101" | "201" | "301" | "401" | "403" | "404" | "405";
const ERROR_TEXT: Record<Errors, string> = {
  "0": "No error", "101": "General exception", "201": "Invalid argument error", "301": "Not initialized",
  "401": "Not implemented error", "403": "Element is read only", "404": "Element is write only", "405": "Incorrect data type",
};
const STATUS = ["passed", "completed", "failed", "incomplete", "browsed", "not attempted"];
const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"] as const;

function timespan(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(4, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function ScormPlayer({ launch, courseHref, position, total, nextHref }:
  { launch: ScormLaunch; courseHref: string; position: number; total: number; nextHref: string | null }) {
  const router = useRouter();
  const frame = useRef<HTMLIFrameElement>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [finished, setFinished] = useState(launch.cmi.lesson_status === "passed" || launch.cmi.lesson_status === "completed");
  const src = `/api/scorm/content/${launch.course.code}/${launch.module.code}/${launch.module.launch_path}`;

  useEffect(() => {
    const cmi = launch.cmi;
    const values: Record<string, string> = {
      "cmi.core.student_id": cmi.student_id,
      "cmi.core.student_name": cmi.student_name,
      "cmi.core.lesson_location": cmi.lesson_location,
      "cmi.core.credit": "credit",
      "cmi.core.lesson_status": cmi.lesson_status,
      "cmi.core.entry": cmi.entry,
      "cmi.core.score.raw": cmi.score_raw,
      "cmi.core.score.min": "",
      "cmi.core.score.max": "",
      "cmi.core.total_time": cmi.total_time,
      "cmi.core.lesson_mode": "normal",
      "cmi.suspend_data": cmi.suspend_data,
      "cmi.launch_data": "",
      "cmi.comments": "",
      "cmi.student_data.mastery_score": cmi.mastery_score,
    };
    const CHILDREN: Record<string, string> = {
      "cmi.core._children": "student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time",
      "cmi.core.score._children": "raw,min,max",
      "cmi.student_data._children": "mastery_score",
      "cmi._version": "3.4",
    };
    const WRITABLE = new Set(["cmi.core.lesson_location", "cmi.core.lesson_status", "cmi.core.score.raw", "cmi.core.score.min",
      "cmi.core.score.max", "cmi.core.exit", "cmi.core.session_time", "cmi.suspend_data", "cmi.comments"]);
    const WRITE_ONLY = new Set(["cmi.core.exit", "cmi.core.session_time"]);
    let initialized = false, done = false, dirty = false, lastError: Errors = "0", commitTimer = 0;
    const startedAt = Date.now();
    const pending: Record<string, string> = {};

    const payload = (finish: boolean) => {
      const data: Record<string, string> = { ...pending };
      if (finish && !data.session_time) data.session_time = timespan(Date.now() - startedAt);
      return JSON.stringify({ course: launch.course.code, module: launch.module.code, finish, data });
    };
    const send = async (finish = false) => {
      if (!dirty && !finish) return;
      const body = payload(finish);
      dirty = false;
      setSaveState("saving");
      try {
        const r = await fetch("/api/scorm/commit", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } });
        setSaveState(r.ok ? "saved" : "error");
        if (!r.ok) dirty = true;
      } catch {
        dirty = true;
        setSaveState("error");
      }
    };
    const beacon = () => {
      if (!initialized) return;
      const body = payload(!done);
      try { navigator.sendBeacon("/api/scorm/commit", new Blob([body], { type: "text/plain" })); } catch { /* ignore */ }
      done = true;
    };

    const API = {
      LMSInitialize: (arg: string) => {
        if (arg !== "") { lastError = "201"; return "false"; }
        if (initialized) { lastError = "101"; return "false"; }
        initialized = true; lastError = "0"; return "true";
      },
      LMSFinish: (arg: string) => {
        if (arg !== "") { lastError = "201"; return "false"; }
        if (!initialized) { lastError = "301"; return "false"; }
        if (!done) { done = true; void send(true); setFinished(true); }
        lastError = "0"; return "true";
      },
      LMSGetValue: (key: string) => {
        if (!initialized) { lastError = "301"; return ""; }
        if (key in CHILDREN) { lastError = "0"; return CHILDREN[key]; }
        if (WRITE_ONLY.has(key)) { lastError = "404"; return ""; }
        if (key in values) { lastError = "0"; return values[key]; }
        lastError = "401"; return "";
      },
      LMSSetValue: (key: string, raw: unknown) => {
        if (!initialized) { lastError = "301"; return "false"; }
        const value = String(raw ?? "");
        if (key in CHILDREN || (key in values && !WRITABLE.has(key))) { lastError = "403"; return "false"; }
        if (!WRITABLE.has(key)) { lastError = "401"; return "false"; }
        if (key === "cmi.core.lesson_status" && (!STATUS.includes(value) || value === "not attempted")) { lastError = "405"; return "false"; }
        if (key.startsWith("cmi.core.score.") && value !== "" && !/^\d{1,3}(\.\d{1,2})?$/.test(value)) { lastError = "405"; return "false"; }
        if (key === "cmi.suspend_data" && value.length > 4096) { lastError = "405"; return "false"; }
        if (key === "cmi.core.lesson_location" && value.length > 255) { lastError = "405"; return "false"; }
        values[key] = value;
        const map: Record<string, string> = {
          "cmi.core.lesson_status": "lesson_status", "cmi.core.lesson_location": "lesson_location",
          "cmi.suspend_data": "suspend_data", "cmi.core.score.raw": "score_raw", "cmi.core.session_time": "session_time",
        };
        if (map[key]) { pending[map[key]] = value; dirty = true; }
        if (key === "cmi.core.lesson_status" && (value === "passed" || value === "completed")) setFinished(true);
        lastError = "0"; return "true";
      },
      LMSCommit: (arg: string) => {
        if (arg !== "") { lastError = "201"; return "false"; }
        if (!initialized) { lastError = "301"; return "false"; }
        // Packages often commit on every screen; batch those into one request per few seconds.
        if (!commitTimer) commitTimer = window.setTimeout(() => { commitTimer = 0; void send(false); }, 3_000);
        lastError = "0"; return "true";
      },
      LMSGetLastError: () => lastError,
      LMSGetErrorString: (code: string) => ERROR_TEXT[code as Errors] ?? "",
      LMSGetDiagnostic: (code: string) => ERROR_TEXT[(code || lastError) as Errors] ?? "",
    };
    (window as unknown as { API: typeof API }).API = API;

    const tick = window.setInterval(() => { void send(false); }, 30_000);
    const onHide = () => { if (document.visibilityState === "hidden" && dirty) beacon(); };
    window.addEventListener("pagehide", beacon);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearInterval(tick);
      if (commitTimer) window.clearTimeout(commitTimer);
      window.removeEventListener("pagehide", beacon);
      document.removeEventListener("visibilitychange", onHide);
      if (initialized && !done) beacon();
      delete (window as unknown as { API?: unknown }).API;
    };
  }, [launch]);

  // Relay activity inside the package to the app's idle sign-out timer.
  const onFrameLoad = () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    let last = 0;
    const relay = () => {
      const now = Date.now();
      if (now - last < 2_000) return;
      last = now;
      window.dispatchEvent(new Event("pointermove"));
    };
    try { ACTIVITY.forEach((e) => w.addEventListener(e, relay, { passive: true, capture: true })); } catch { /* cross-origin: not expected */ }
  };

  const saveText = { idle: "", saving: "Saving…", saved: "Progress saved", error: "Not saved — retrying" }[saveState];

  return (
    <div className="flex h-dvh flex-col bg-paper">
      <header className="z-10 flex h-nav shrink-0 items-center gap-3 bg-white px-4 shadow-nav sm:px-6">
        <Link href={courseHref} className="inline-flex items-center gap-2.5 rounded-button" aria-label={`Back to ${launch.course.title}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/iparkar-mark-primary-tm.svg" width={41} height={32} alt="" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-caption text-graphite">{launch.course.title} · Module {position} of {total}</p>
          <h1 className="truncate text-body-sm font-semibold text-ink">{launch.module.title}</h1>
        </div>
        <span className="hidden text-caption text-graphite sm:inline" role="status" aria-live="polite">{saveText}</span>
        {finished && nextHref && <Link href={nextHref} className="btn-primary">Next module</Link>}
        <button type="button" className="btn-outline" onClick={() => router.push(courseHref)}>Course page</button>
      </header>
      <iframe
        ref={frame}
        title={launch.module.title}
        src={src}
        onLoad={onFrameLoad}
        className="w-full flex-1 border-0 bg-white"
        allow="fullscreen"
      />
    </div>
  );
}
