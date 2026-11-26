/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures read untyped JSON */
import { beforeAll, describe, expect, it } from "vitest";
import { DB, courseId, createDb, createUser } from "./harness";

/** GST treatment on invoices and credit notes (prices GST-inclusive). */
let db: DB;
let u: string, asp: string;
let n = 0;

async function paid(opts: { currency: string; country: string; amount: number; state?: string; gstin?: string; biz?: string }) {
  n++;
  await db.query(
    `insert into checkout_orders (provider_order_id, user_id, course_id, access_days, amount_minor, currency, country, buyer_state_code, buyer_gstin, buyer_business_name)
     values ($1, $2, $3, 90, $4, $5, $6, $7, $8, $9)`,
    [`order_g${n}`, u, asp, opts.amount, opts.currency, opts.country, opts.state ?? null, opts.gstin ?? null, opts.biz ?? null]);
  const r = (await db.query<{ r: any }>(`select public.service_fulfil_checkout_order($1,$2,$3,$4,'order.paid','{}'::jsonb) r`,
    [`order_g${n}`, `pay_g${n}`, opts.amount, opts.currency])).rows[0].r;
  return (await db.query<any>(`select * from invoices where id = $1`, [r.invoice_id])).rows[0];
}
const num = (x: any) => Number(x);

beforeAll(async () => {
  db = await createDb();
  u = await createUser(db, { username: "gst_buyer" });
  asp = await courseId(db, "ASP");
});

describe("GST on invoices", () => {
  it("splits CGST + SGST for a buyer in Maharashtra (₹7,999 inclusive)", async () => {
    const i = await paid({ currency: "INR", country: "IN", amount: 799900, state: "27" });
    expect(i).toMatchObject({ tax_regime: "intra_state", supplier_gstin: "27ATAPP7789A1ZF", sac: "999293", place_of_supply: "Maharashtra (27)", gst_rate_bp: 1800 });
    expect([num(i.taxable_minor), num(i.cgst_minor), num(i.sgst_minor), num(i.igst_minor)]).toEqual([677881, 61009, 61010, 0]);
    expect(num(i.taxable_minor) + num(i.cgst_minor) + num(i.sgst_minor)).toBe(799900);
  });

  it("charges IGST for another state, and uses the GSTIN's state for a business buyer", async () => {
    const i = await paid({ currency: "INR", country: "IN", amount: 799900, state: "29" });
    expect(i).toMatchObject({ tax_regime: "inter_state", place_of_supply: "Karnataka (29)" });
    expect([num(i.taxable_minor), num(i.igst_minor), num(i.cgst_minor)]).toEqual([677881, 122019, 0]);
    const b = await paid({ currency: "INR", country: "IN", amount: 1850000, state: "27", gstin: "29AAACB1234C1Z5", biz: "Acme Safety Pvt Ltd" });
    expect(b).toMatchObject({ tax_regime: "inter_state", buyer_state_code: "29", buyer_gstin: "29AAACB1234C1Z5", buyer_business_name: "Acme Safety Pvt Ltd" });
  });

  it("falls back to the supplier's state when an Indian buyer's state is missing", async () => {
    const i = await paid({ currency: "INR", country: "IN", amount: 399900 });
    expect(i).toMatchObject({ tax_regime: "intra_state", place_of_supply: "Maharashtra (27)" });
  });

  it("treats foreign sales as exports: IGST without an LUT, zero-rated with one", async () => {
    const cfg = (await db.query<any>(`select lut_arn, lut_valid_to from gst_config`)).rows[0];
    expect(cfg.lut_arn).toBe("AD271126028060L");
    await db.query(`update gst_config set lut_arn = null, lut_valid_from = null, lut_valid_to = null`);
    const a = await paid({ currency: "KWD", country: "KW", amount: 30000 });
    expect(a).toMatchObject({ tax_regime: "export_igst", place_of_supply: "Outside India (KW)", lut_arn: null });
    expect([num(a.taxable_minor), num(a.igst_minor)]).toEqual([25424, 4576]);
    await db.query(`update gst_config set lut_arn = 'AD271126000123X', lut_valid_from = date '2026-04-01', lut_valid_to = date '2099-03-31'`);
    const b = await paid({ currency: "USD", country: "US", amount: 9900 });
    expect(b).toMatchObject({ tax_regime: "export_lut", lut_arn: "AD271126000123X" });
    expect([num(b.taxable_minor), num(b.igst_minor)]).toEqual([9900, 0]);
    await db.query(`update gst_config set lut_arn = null, lut_valid_from = null, lut_valid_to = null`);
  });

  it("issues no GST before the registration date", async () => {
    await db.query(`update gst_config set effective_from = date '2999-01-01'`);
    const i = await paid({ currency: "INR", country: "IN", amount: 799900, state: "27" });
    expect(i).toMatchObject({ tax_regime: "none", supplier_gstin: null });
    expect(num(i.taxable_minor)).toBe(799900);
    await db.query(`update gst_config set effective_from = date '2026-11-24'`);
  });

  it("gives credit notes the invoice's treatment, split on the refunded amount", async () => {
    const inv = await paid({ currency: "INR", country: "IN", amount: 799900, state: "27" });
    const r = (await db.query<{ r: any }>(`select public.service_refund_checkout_payment($1,'rfnd_g1',400000,'{}'::jsonb) r`, [inv.provider_payment_id])).rows[0].r;
    const cn = (await db.query<any>(`select * from invoices where id = $1`, [r.credit_note_id])).rows[0];
    expect(cn).toMatchObject({ kind: "credit_note", tax_regime: "intra_state", place_of_supply: "Maharashtra (27)", original_invoice_id: inv.id });
    expect(num(cn.taxable_minor) + num(cn.cgst_minor) + num(cn.sgst_minor)).toBe(400000);
    expect(num(cn.taxable_minor)).toBe(338983);
  });
});
