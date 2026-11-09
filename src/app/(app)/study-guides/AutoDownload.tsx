"use client";
import { useEffect } from "react";

/** Starts the download once when the page is opened with ?download=<code>. */
export function AutoDownload({ href }: { href: string }) {
  useEffect(() => {
    const t = setTimeout(() => { window.location.href = href; }, 400);
    return () => clearTimeout(t);
  }, [href]);
  return null;
}
