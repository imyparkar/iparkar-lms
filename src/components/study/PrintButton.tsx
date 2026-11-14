"use client";
export function PrintButton() {
  return <button type="button" className="btn-primary" onClick={() => window.print()}>Download or print (PDF)</button>;
}
