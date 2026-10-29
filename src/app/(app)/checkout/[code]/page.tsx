import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { Checkout } from "./Checkout";
export default async function CheckoutPage({params}:{params:Promise<{code:string}>}) {
  const code=(await params).code.toUpperCase();
  if(!["ASP","CSP","CIH"].includes(code)) notFound();
  await requireUser();
  return <div className="mx-auto max-w-2xl space-y-6"><Link className="link" href={`/courses/${code}`}>Back to {code}</Link><h1 className="text-3xl font-semibold">Get {code} exam access</h1><p>Complete the secure Paddle checkout to purchase your exam package. Access is activated after payment is verified. The checkout shows the final price, currency and taxes before you pay.</p><Checkout code={code}/></div>;
}
