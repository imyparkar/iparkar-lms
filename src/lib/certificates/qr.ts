// QR matrix for the certificate's verification link. Uses only the pure-JS core of `qrcode` (no canvas, no fs),
// so it runs inside the Cloudflare Worker.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require("qrcode/lib/core/qrcode") as {
  create(text: string, opts: { errorCorrectionLevel: "L" | "M" | "Q" | "H" }): { modules: { size: number; data: Uint8Array | boolean[] } };
};

/** Square matrix of dark (true) / light (false) modules, without the quiet zone. */
export function qrMatrix(text: string): boolean[][] {
  const { modules } = core.create(text, { errorCorrectionLevel: "M" });
  const n = modules.size, out: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(Boolean(modules.data[r * n + c]));
    out.push(row);
  }
  return out;
}

/** The public verification page for a certificate number. */
export const verifyUrl = (certificateNo: string) => `https://iparkar.com/verify/?id=${encodeURIComponent(certificateNo)}`;
