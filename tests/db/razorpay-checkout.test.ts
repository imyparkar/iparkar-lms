/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures read untyped JSON */
import { beforeAll, describe, expect, it } from "vitest";
import { DB, as, courseId, createDb, createUser } from "./harness";

/** Razorpay checkout orders: grant once, check amount/currency, refunds revoke. */
let db: DB;
let stu: string, other: string, asp: string;

async function order(id: string, uid: string, amount = 9900, currency = "USD", days = 90) {
  await db.query(`insert into checkout_orders (provider_order_id, user_id, course_id, access_days, amount_minor, currency)
                  values ($1, $2, $3, $4, $5, $6)`, [id, uid, asp, days, amount, currency]);
}
async function fulfil(o: string, p: string, amount = 9900, currency = "USD") {
  return (await db.query<{ r: any }>(`select public.service_fulfil_checkout_order($1, $2, $3, $4, 'order.paid', '{}'::jsonb) r`,
    [o, p, amount, currency])).rows[0].r;
}
async function refund(p: string, r: string, amount: number) {
  return (await db.query<{ r: any }>(`select public.service_refund_checkout_payment($1, $2, $3, '{}'::jsonb) r`, [p, r, amount])).rows[0].r;
}
async function access(uid: string) {
  return (await db.query<any>(`select * from course_entitlements where user_id = $1 and course_id = $2 and revoked_at is null`, [uid, asp])).rows;
}

beforeAll(async () => {
  db = await createDb();
  stu = await createUser(db, { username: "rzp_student" });
  other = await createUser(db, { username: "rzp_other" });
  asp = await courseId(db, "ASP");
});

describe("razorpay checkout", () => {
  it("grants 90 days once, however many times the payment is reported", async () => {
    await order("order_1", stu);
    expect((await fulfil("order_1", "pay_1")).granted).toBe(true);
    expect((await fulfil("order_1", "pay_1")).duplicate).toBe(true);
    const rows = await access(stu);
    expect(rows).toHaveLength(1);
    const d = (new Date(rows[0].expires_at).getTime() - Date.now()) / 86_400_000;
    expect(d).toBeGreaterThan(89.9);
    expect(d).toBeLessThan(90.1);
    const o = (await db.query<any>(`select * from checkout_orders where provider_order_id = 'order_1'`)).rows[0];
    expect(o.status).toBe("paid");
    expect(o.provider_payment_id).toBe("pay_1");
  });

  it("refuses a payment whose amount or currency differs from the order", async () => {
    await order("order_2", other, 799900, "INR");
    expect((await fulfil("order_2", "pay_2", 9900, "USD")).ok).toBe(false);
    expect((await fulfil("order_2", "pay_2", 100, "INR")).ok).toBe(false);
    expect(await access(other)).toHaveLength(0);
    const audit = (await db.query(`select 1 from audit_logs where action = 'payment.amount_mismatch'`)).rows;
    expect(audit.length).toBeGreaterThan(0);
  });

  it("ignores unknown orders and logs them", async () => {
    expect((await fulfil("order_nope", "pay_x")).ok).toBe(false);
    expect((await db.query(`select 1 from audit_logs where action = 'payment.unmatched' and entity_id = 'order_nope'`)).rows).toHaveLength(1);
  });

  it("keeps access on a partial refund and ends it on a full refund (once)", async () => {
    expect((await refund("pay_1", "rfnd_1", 4000)).revoked).toBe(false);
    expect(await access(stu)).toHaveLength(1);
    expect((await refund("pay_1", "rfnd_1", 4000)).duplicate).toBe(true);
    expect((await refund("pay_1", "rfnd_2", 5900)).revoked).toBe(true);
    expect(await access(stu)).toHaveLength(0);
    const o = (await db.query<any>(`select status, refunded_minor from checkout_orders where provider_order_id = 'order_1'`)).rows[0];
    expect(o).toMatchObject({ status: "refunded", refunded_minor: 9900 });
  });

  it("lets students read only their own orders and not call the service functions", async () => {
    expect(await as(db, stu, `select provider_order_id from checkout_orders`)).toEqual([{ provider_order_id: "order_1" }]);
    await expect(as(db, stu, `select public.service_fulfil_checkout_order('order_2','pay_9',799900,'INR','x','{}'::jsonb)`)).rejects.toThrow();
    await expect(as(db, stu, `insert into checkout_orders (provider_order_id, user_id, course_id, access_days, amount_minor, currency)
                              values ('order_x', '${stu}', '${asp}', 90, 1, 'USD')`)).rejects.toThrow();
  });
});
