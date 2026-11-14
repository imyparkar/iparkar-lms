"use client";

type FigureImage = { key: string; width: number; height: number };

/**
 * Original drawings stream from the authenticated asset route (enrollment + access checked,
 * private no-store). Context menu and dragging are discouraged; this deters casual saving only —
 * anything a signed-in learner can see can still be captured from the screen.
 */
export function ProtectedImage({ image, alt }: { image: FigureImage; alt: string }) {
  return (
    <div className="overflow-x-auto" onContextMenu={(e) => e.preventDefault()}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/study/asset?k=${encodeURIComponent(image.key)}`}
        alt={alt}
        width={Math.round(image.width / 2)}
        height={Math.round(image.height / 2)}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="mx-auto h-auto max-w-full select-none"
        style={{ WebkitTouchCallout: "none" } as React.CSSProperties}
      />
    </div>
  );
}

