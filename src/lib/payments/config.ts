import "server-only";

export function paddleConfig() {
  const environment = process.env.PADDLE_ENVIRONMENT ?? "production";
  if (!["sandbox", "production"].includes(environment)) throw new Error("Invalid Paddle environment");
  const token = process.env.PADDLE_CLIENT_TOKEN ?? "";
  const apiKey = process.env.PADDLE_API_KEY ?? "";
  if (apiKey && !(environment === "sandbox" ? apiKey.startsWith("pdl_sdbx_") : apiKey.startsWith("pdl_live_"))) throw new Error("Paddle API key/environment mismatch");
  const enabled = process.env.PADDLE_CHECKOUT_ENABLED === "true" && !!token && !!apiKey;
  if (token && !(environment === "sandbox" ? token.startsWith("test_") : token.startsWith("live_"))) {
    throw new Error("Paddle token/environment mismatch");
  }
  return { environment, token, apiKey, enabled, base: environment === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com" };
}
export function priceForCourse(code: string, days = 90) {
  if (!["ASP", "CSP", "CIH"].includes(code) || ![90, 180, 365].includes(days)) return undefined;
  return process.env[`PADDLE_PRICE_ID_${code}${days === 90 ? "" : `_${days}`}`];
}
