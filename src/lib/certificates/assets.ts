import type { CertificateAssets } from "./pdf";

export type AllCertificateAssets = CertificateAssets & { fonts: CertificateAssets["fonts"] & { frauncesLight: Uint8Array } };

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
let cached: AllCertificateAssets | null = null;

/** Fonts and images for the certificate template, decoded once per isolate. Loaded lazily so only certificate routes pay for them. */
export async function certificateAssets(): Promise<AllCertificateAssets> {
  if (cached) return cached;
  const a = await import("./assets.generated");
  cached = {
    fonts: { interRegular: b64(a.interRegular), interMedium: b64(a.interMedium), interSemiBold: b64(a.interSemiBold), interBold: b64(a.interBold), serifSemiBold: b64(a.serifSemiBold), frauncesLight: b64(a.frauncesLight) },
    images: { talentTriangle: b64(a.talentTriangle), iconBA: b64(a.iconBA), iconWoW: b64(a.iconWoW), iconPS: b64(a.iconPS) },
  };
  return cached;
}
