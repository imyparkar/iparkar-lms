import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { paddleConfig } from "@/lib/payments/config";
import { accessPlan } from "@/lib/payments/plans";
import { Checkout } from "./Checkout";
export default async function CheckoutPage({params,searchParams}:{params:Promise<{code:string}>;searchParams:Promise<{days?:string}>}) {
  const code=(await params).code.toUpperCase();
  const plan=accessPlan(Number((await searchParams).days ?? 90));
  if(!["ASP","CSP","CIH"].includes(code)||!plan) notFound();
  await requireUser();
  const sandbox=paddleConfig().environment === "sandbox";
  return <div className="mx-auto max-w-2xl space-y-6"><Link className="link" href={`/courses/${code}`}>Back to {code}</Link>
    {sandbox && <p className="rounded-card bg-marigold p-4 font-semibold">Sandbox checkout - test payments only</p>}
    <h1 className="text-3xl font-semibold">{code} {plan.name}</h1>
    <p className="text-xl font-semibold">US${Number(plan.amount)/100} / {plan.days} days of access</p>
    <p>One-time payment. No automatic renewal. The final price and applicable taxes are shown before payment. Access starts after payment is verified.</p>
    <Checkout code={code} days={plan.days}/></div>;
}
