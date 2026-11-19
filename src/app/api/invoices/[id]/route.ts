import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { docFileName, renderInvoicePdf, type InvoiceDoc } from "@/lib/invoices/pdf";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Download an invoice or credit note as PDF. Row-level security limits it to the buyer (or an admin). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { data: row } = await session.supabase.from("invoices")
    .select("kind, number, issued_at, buyer_name, buyer_email, buyer_country, description, currency, amount_minor, provider_payment_id, provider_refund_id, original:original_invoice_id(number, issued_at)")
    .eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const doc = { ...row, original: Array.isArray(row.original) ? row.original[0] ?? null : row.original } as InvoiceDoc;
  const pdf = await renderInvoicePdf(doc);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${docFileName(doc)}"`,
      "cache-control": "private, no-store",
    },
  });
}
