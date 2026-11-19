/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures read untyped JSON */
import { beforeAll, describe, expect, it } from "vitest";
import { DB, as, courseId, createDb, createUser } from "./harness";

/** Invoices and credit notes issued with Razorpay purchases and refunds. */
let db: DB;
let ann: string, bob: string, asp: string, cit: string;

async function order(id: string, uid: string, course: string, amount: number, currency: string, days = 90) {
  await db.query(`insert into checkout_orders (provider_order_id, user_id, course_id, access_days, amount_minor, currency, country)
                  values ($1, $2, $3, $4, $5, $6, 'KW')`, [id, uid, course, days, amount, currency]);
}
const fulfil = async (o: string, p: string, amount: number, currency: string) =>
  (await db.query<{ r: any }>(`select public.service_fulfil_checkout_order($1,$2,$3,$4,'order.paid','{}'::jsonb) r`, [o, p, amount, currency])).rows[0].r;
const refund = async (p: string, r: string, amount: number) =>
  (await db.query<{ r: any }>(`select public.service_refund_checkout_payment($1,$2,$3,'{}'::jsonb) r`, [p, r, amount])).rows[0].r;
const docs = async () => (await db.query<any>(`select * from invoices order by number`)).rows;

const fy = (() => {
  const d = new Date(Date.now() + 5.5 * 3600_000); // IST
  const y = d.getUTCFullYear() - (d.getUTCMonth() < 3 ? 1 : 0);
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
})();

beforeAll(async () => {
  db = await createDb();
  ann = await createUser(db, { username: "ann_buyer" });
  bob = await createUser(db, { username: "bob_buyer" });
  await db.query(`update profiles set full_name = 'Ann Buyer' where id = $1`, [ann]);
  asp = await courseId(db, "ASP");
  cit = await courseId(db, "CIT");
});

describe("invoices", () => {
  it("issues one numbered invoice per paid order, in sequence", async () => {
    await order("order_i1", ann, asp, 30000, "KWD");
    await order("order_i2", bob, cit, 7900, "USD", 180);
    const r1 = await fulfil("order_i1", "pay_i1", 30000, "KWD");
    const r2 = await fulfil("order_i2", "pay_i2", 7900, "USD");
    expect(r1.invoice_id).toBeTruthy();
    expect(r2.invoice_id).toBeTruthy();
    const again = await fulfil("order_i1", "pay_i1", 30000, "KWD");
    expect(again).toMatchObject({ duplicate: true, invoice_id: r1.invoice_id });
    const d = await docs();
    expect(d.map((x: any) => x.number)).toEqual([`INV/${fy}/0001`, `INV/${fy}/0002`]);
    expect(d[0]).toMatchObject({
      kind: "invoice", buyer_name: "Ann Buyer", buyer_email: "ann_buyer@example.test", buyer_country: "KW",
      description: "ASP practice exams – 90 days access", currency: "KWD", amount_minor: 30000, provider_payment_id: "pay_i1",
    });
    expect(d[1].description).toBe("CIT practice exams – 180 days access");
  });

  it("issues a credit note for each processed refund, once", async () => {
    const a = await refund("pay_i2", "rfnd_i1", 2000);
    expect(a.credit_note_id).toBeTruthy();
    expect((await refund("pay_i2", "rfnd_i1", 2000)).duplicate).toBe(true);
    const b = await refund("pay_i2", "rfnd_i2", 5900);
    expect(b.revoked).toBe(true);
    const cns = (await docs()).filter((x: any) => x.kind === "credit_note");
    expect(cns.map((x: any) => [x.number, x.amount_minor])).toEqual([[`CN/${fy}/0001`, 2000], [`CN/${fy}/0002`, 5900]]);
    const inv = (await docs()).find((x: any) => x.provider_payment_id === "pay_i2" && x.kind === "invoice");
    expect(cns.every((x: any) => x.original_invoice_id === inv.id)).toBe(true);
    expect(cns[0].description).toBe("Refund: CIT practice exams – 180 days access");
  });

  it("refunds an order paid before invoicing without a credit note", async () => {
    await order("order_old", ann, cit, 4900, "USD");
    await fulfil("order_old", "pay_old", 4900, "USD");
    await db.query(`delete from invoices where provider_payment_id = 'pay_old'`); // stands in for a pre-invoicing order
    expect(await refund("pay_old", "rfnd_old", 4900)).toMatchObject({ ok: true, revoked: true, credit_note_id: null });
  });

  it("shows buyers only their own documents and keeps writes server-side", async () => {
    const mine = await as(db, ann, `select number from invoices order by number`);
    expect(mine.map((r: any) => r.number)).toEqual([`INV/${fy}/0001`]);
    await expect(as(db, ann, `update invoices set amount_minor = 1`)).rejects.toThrow();
    await expect(as(db, ann, `select public.next_document_number('invoice')`)).rejects.toThrow();
    await expect(as(db, ann, `select * from invoice_counters`)).rejects.toThrow();
  });
});
