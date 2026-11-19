/** Payment-methods line with the official Apple Pay mark (unaltered artwork, per Apple's guidelines). */
export function PayMethods() {
  return (
    <p className="mt-4 flex flex-wrap items-center gap-2 text-caption text-graphite">
      <span>
        Secure payment by Razorpay: cards, UPI, net banking, wallets and
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG brand mark, no optimisation needed */}
      <img src="/brand/apple-pay-mark.svg" alt="Apple Pay" width={45} height={29} className="m-[3px] h-[29px] w-auto flex-none" />
      <span>
        Access opens as soon as your payment is confirmed. See our <a className="link" href="https://iparkar.com/refunds">refund policy</a>.
      </span>
    </p>
  );
}
