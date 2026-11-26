-- GST on invoices and credit notes (iParkar Learning, GSTIN 27ATAPP7789A1ZF, Maharashtra, from 24 Nov 2026).
--
-- Prices are GST-inclusive. At issue time each invoice gets a tax treatment:
--   intra_state  Indian buyer in Maharashtra (27): CGST 9% + SGST 9%
--   inter_state  Indian buyer in another state/UT: IGST 18%
--   export_lut   buyer outside India, LUT in force: zero-rated, no IGST
--   export_igst  buyer outside India, no LUT: zero-rated on payment of IGST 18% (refund claimable)
--   none         issued before GST registration took effect
-- Place of supply for an unregistered Indian buyer is the state they choose at checkout (recorded on the
-- invoice as the address on record, Rule 46 proviso / Circular 242/36/2024-GST); for a registered buyer it
-- is the state in their GSTIN. Credit notes copy the treatment of the invoice they adjust.

create table if not exists public.gst_config (
  id              int primary key default 1 check (id = 1),
  gstin           text not null check (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  legal_name      text not null,
  trade_name      text not null,
  state_code      text not null check (state_code ~ '^[0-9]{2}$'),
  effective_from  date not null,
  sac             text not null,
  rate_bp         int  not null check (rate_bp between 0 and 10000),   -- 1800 = 18%
  lut_arn         text,
  lut_valid_from  date,
  lut_valid_to    date,
  udyam           text,
  updated_at      timestamptz not null default now()
);
insert into public.gst_config (id, gstin, legal_name, trade_name, state_code, effective_from, sac, rate_bp, udyam,
                              lut_arn, lut_valid_from, lut_valid_to)
values (1, '27ATAPP7789A1ZF', 'Imran Iqbal Parkar', 'iParkar Learning', '27', date '2026-11-24', '999293', 1800, 'UDYAM-MH-28-0101316',
        -- LUT (GST RFD-11) filed 26 Nov 2026, ARN AD271126028060L, for FY 2026-27. Renew before 1 April each year.
        'AD271126028060L', date '2026-11-26', date '2027-03-31')
on conflict (id) do nothing;

create table if not exists public.gst_states (
  code text primary key check (code ~ '^[0-9]{2}$'),
  name text not null
);
insert into public.gst_states (code, name) values
 ('01','Jammu and Kashmir'),('02','Himachal Pradesh'),('03','Punjab'),('04','Chandigarh'),('05','Uttarakhand'),
 ('06','Haryana'),('07','Delhi'),('08','Rajasthan'),('09','Uttar Pradesh'),('10','Bihar'),('11','Sikkim'),
 ('12','Arunachal Pradesh'),('13','Nagaland'),('14','Manipur'),('15','Mizoram'),('16','Tripura'),('17','Meghalaya'),
 ('18','Assam'),('19','West Bengal'),('20','Jharkhand'),('21','Odisha'),('22','Chhattisgarh'),('23','Madhya Pradesh'),
 ('24','Gujarat'),('26','Dadra and Nagar Haveli and Daman and Diu'),('27','Maharashtra'),('29','Karnataka'),
 ('30','Goa'),('31','Lakshadweep'),('32','Kerala'),('33','Tamil Nadu'),('34','Puducherry'),
 ('35','Andaman and Nicobar Islands'),('36','Telangana'),('37','Andhra Pradesh'),('38','Ladakh'),('97','Other Territory')
on conflict (code) do update set name = excluded.name;

alter table public.gst_config enable row level security;
alter table public.gst_states enable row level security;
revoke all on public.gst_config from anon, authenticated;
revoke all on public.gst_states from anon, authenticated;

-- Buyer tax details captured at checkout (Indian buyers only).
alter table public.checkout_orders add column if not exists buyer_state_code text check (buyer_state_code ~ '^[0-9]{2}$');
alter table public.checkout_orders add column if not exists buyer_gstin text check (buyer_gstin ~ '^[0-9]{2}[A-Z0-9]{13}$');
alter table public.checkout_orders add column if not exists buyer_business_name text check (length(buyer_business_name) <= 120);

-- Tax particulars on each invoice / credit note (frozen at issue).
alter table public.invoices add column if not exists tax_regime text not null default 'none'
  check (tax_regime in ('none','intra_state','inter_state','export_lut','export_igst'));
alter table public.invoices add column if not exists supplier_gstin text;
alter table public.invoices add column if not exists sac text;
alter table public.invoices add column if not exists place_of_supply text;
alter table public.invoices add column if not exists buyer_state_code text;
alter table public.invoices add column if not exists buyer_gstin text;
alter table public.invoices add column if not exists buyer_business_name text;
alter table public.invoices add column if not exists gst_rate_bp int not null default 0;
alter table public.invoices add column if not exists taxable_minor bigint;
alter table public.invoices add column if not exists cgst_minor bigint not null default 0;
alter table public.invoices add column if not exists sgst_minor bigint not null default 0;
alter table public.invoices add column if not exists igst_minor bigint not null default 0;
alter table public.invoices add column if not exists lut_arn text;
update public.invoices set taxable_minor = amount_minor where taxable_minor is null;

-- Split a GST-inclusive amount into taxable value and tax.
create or replace function public.gst_split(p_amount bigint, p_regime text, p_rate_bp int,
  out taxable bigint, out cgst bigint, out sgst bigint, out igst bigint)
language plpgsql immutable set search_path = public as $$
declare v_tax bigint;
begin
  cgst := 0; sgst := 0; igst := 0;
  if p_regime in ('none','export_lut') or coalesce(p_rate_bp, 0) = 0 then
    taxable := p_amount; return;
  end if;
  taxable := round(p_amount * 10000.0 / (10000 + p_rate_bp));
  v_tax := p_amount - taxable;
  if p_regime = 'intra_state' then
    cgst := v_tax / 2; sgst := v_tax - cgst;
  else
    igst := v_tax;
  end if;
end $$;

-- Tax treatment for an order, decided when its invoice is issued.
create or replace function public.gst_treatment(o checkout_orders,
  out regime text, out rate_bp int, out supplier_gstin text, out sac text, out place_of_supply text,
  out state_code text, out lut_arn text)
language plpgsql stable security definer set search_path = public as $$
declare
  c gst_config;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into c from gst_config where id = 1;
  if c.id is null or v_today < c.effective_from then
    regime := 'none'; rate_bp := 0; return;
  end if;
  supplier_gstin := c.gstin; sac := c.sac; rate_bp := c.rate_bp;
  if coalesce(o.country, '') = 'IN' or o.currency = 'INR' then
    -- Registered buyer: state from GSTIN. Unregistered: state chosen at checkout; if none was recorded,
    -- the location of the supplier (section 12(2)(b)(ii) IGST Act).
    state_code := coalesce(left(o.buyer_gstin, 2), o.buyer_state_code, c.state_code);
    regime := case when state_code = c.state_code then 'intra_state' else 'inter_state' end;
    place_of_supply := coalesce((select name from gst_states where code = state_code), 'State') || ' (' || state_code || ')';
  else
    place_of_supply := 'Outside India' || case when coalesce(o.country, '') <> '' then ' (' || o.country || ')' else '' end;
    if c.lut_arn is not null and v_today >= coalesce(c.lut_valid_from, v_today) and v_today <= coalesce(c.lut_valid_to, v_today) then
      regime := 'export_lut'; lut_arn := c.lut_arn;
    else
      regime := 'export_igst';
    end if;
  end if;
end $$;

create or replace function public.service_fulfil_checkout_order(
  p_order text, p_payment text, p_amount bigint, p_currency text, p_event text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o checkout_orders%rowtype;
  v_pay uuid;
  v_res jsonb;
  v_inv uuid;
  l record;
  num record;
  t record;
  s record;
begin
  select * into o from checkout_orders where provider = 'razorpay' and provider_order_id = p_order for update;
  if not found then
    insert into audit_logs (actor_id, action, entity, entity_id, details)
    values (null, 'payment.unmatched', 'checkout_order', p_order, jsonb_build_object('payment', p_payment, 'event', p_event));
    return jsonb_build_object('ok', false, 'reason', 'unknown order');
  end if;
  if o.status <> 'created' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'status', o.status,
                              'invoice_id', (select id from invoices where checkout_order_id = o.id and kind = 'invoice'));
  end if;
  if p_amount is distinct from o.amount_minor or upper(p_currency) is distinct from o.currency then
    insert into audit_logs (actor_id, action, entity, entity_id, details)
    values (null, 'payment.amount_mismatch', 'checkout_order', o.id::text,
            jsonb_build_object('expected', o.amount_minor, 'currency', o.currency, 'got', p_amount, 'got_currency', p_currency, 'payment', p_payment));
    return jsonb_build_object('ok', false, 'reason', 'amount mismatch');
  end if;
  if o.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'account deleted');
  end if;

  insert into payments (user_id, course_id, study_course_id, provider, provider_event_id, provider_txn_id, event_type, status, amount_minor, currency, payload)
  values (o.user_id, o.course_id, o.study_course_id, 'razorpay', 'paid:' || p_order, p_payment, 'order.paid', 'captured', p_amount, o.currency, coalesce(p_payload, '{}'::jsonb))
  returning id into v_pay;

  if o.study_course_id is not null then
    v_res := service_apply_study_purchase(o.user_id, o.study_course_id, o.access_days, v_pay);
  else
    v_res := service_apply_purchase(o.user_id, o.course_id, o.access_days, v_pay, 'purchase', null);
  end if;
  if coalesce((v_res->>'ok')::boolean, false) is not true then
    raise exception 'grant failed: %', v_res;
  end if;

  update checkout_orders set status = 'paid', provider_payment_id = p_payment, payment_id = v_pay, paid_at = now()
   where id = o.id returning * into o;

  select * into l from checkout_order_line(o);
  select * into num from next_document_number('invoice');
  select * into t from gst_treatment(o);
  select * into s from gst_split(o.amount_minor, t.regime, t.rate_bp);
  insert into invoices (kind, number, fy, checkout_order_id, user_id, buyer_name, buyer_email, buyer_country, description,
                        access_days, currency, amount_minor, provider_payment_id,
                        tax_regime, supplier_gstin, sac, place_of_supply, buyer_state_code, buyer_gstin, buyer_business_name,
                        gst_rate_bp, taxable_minor, cgst_minor, sgst_minor, igst_minor, lut_arn)
  values ('invoice', num.doc_number, num.doc_fy, o.id, o.user_id, l.buyer_name, l.buyer_email, o.country, l.description,
          o.access_days, o.currency, o.amount_minor, p_payment,
          t.regime, t.supplier_gstin, t.sac, t.place_of_supply, t.state_code, o.buyer_gstin, o.buyer_business_name,
          t.rate_bp, s.taxable, s.cgst, s.sgst, s.igst, t.lut_arn)
  returning id into v_inv;

  return jsonb_build_object('ok', true, 'granted', true, 'course_id', coalesce(o.course_id, o.study_course_id),
                            'user_id', o.user_id, 'invoice_id', v_inv);
end $$;

create or replace function public.service_refund_checkout_payment(
  p_payment text, p_refund text, p_amount bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o checkout_orders%rowtype;
  v_total bigint;
  v_inv invoices%rowtype;
  v_cn uuid;
  num record;
  s record;
  v_revoked boolean := false;
begin
  select * into o from checkout_orders where provider = 'razorpay' and provider_payment_id = p_payment for update;
  if not found then
    insert into audit_logs (actor_id, action, entity, entity_id, details)
    values (null, 'refund.unmatched', 'payment', p_payment, jsonb_build_object('refund', p_refund, 'amount', p_amount));
    return jsonb_build_object('ok', false, 'reason', 'unknown payment');
  end if;

  begin
    insert into payments (user_id, course_id, study_course_id, provider, provider_event_id, provider_txn_id, event_type, status, amount_minor, currency, payload)
    values (o.user_id, o.course_id, o.study_course_id, 'razorpay', 'refund:' || p_refund, p_payment, 'refund.processed', 'refunded', p_amount, o.currency, coalesce(p_payload, '{}'::jsonb));
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'duplicate', true,
                              'credit_note_id', (select id from invoices where provider_refund_id = p_refund and kind = 'credit_note'));
  end;

  v_total := o.refunded_minor + p_amount;
  if v_total >= o.amount_minor then
    update checkout_orders set refunded_minor = v_total, status = 'refunded' where id = o.id;
    if o.study_course_id is not null then
      perform service_revoke_study_purchase(o.payment_id, 'Refunded');   -- takes back this payment's days; progress kept
    elsif o.user_id is not null then
      perform service_revoke_for_payment(o.user_id, o.course_id, 'Refunded');
    end if;
    v_revoked := true;
  else
    update checkout_orders set refunded_minor = v_total, status = 'partially_refunded' where id = o.id;
    insert into audit_logs (actor_id, action, entity, entity_id, details)
    values (null, 'refund.partial', 'checkout_order', o.id::text,
            jsonb_build_object('user_id', o.user_id, 'course_id', coalesce(o.course_id, o.study_course_id), 'refunded', v_total, 'paid', o.amount_minor,
                               'note', 'Access kept. Revoke it in Students & access if the refund should end access.'));
  end if;

  -- Credit note against the order's invoice (orders paid before invoicing started have none).
  select * into v_inv from invoices where checkout_order_id = o.id and kind = 'invoice';
  if v_inv.id is not null then
    select * into num from next_document_number('credit_note');
    -- A credit note carries the same tax treatment as the invoice it adjusts.
    select * into s from gst_split(p_amount, v_inv.tax_regime, v_inv.gst_rate_bp);
    insert into invoices (kind, number, fy, checkout_order_id, original_invoice_id, user_id, buyer_name, buyer_email, buyer_country,
                          description, access_days, currency, amount_minor, provider_payment_id, provider_refund_id,
                          tax_regime, supplier_gstin, sac, place_of_supply, buyer_state_code, buyer_gstin, buyer_business_name,
                          gst_rate_bp, taxable_minor, cgst_minor, sgst_minor, igst_minor, lut_arn)
    values ('credit_note', num.doc_number, num.doc_fy, o.id, v_inv.id, v_inv.user_id, v_inv.buyer_name, v_inv.buyer_email, v_inv.buyer_country,
            'Refund: ' || v_inv.description, v_inv.access_days, o.currency, p_amount, p_payment, p_refund,
            v_inv.tax_regime, v_inv.supplier_gstin, v_inv.sac, v_inv.place_of_supply, v_inv.buyer_state_code, v_inv.buyer_gstin,
            v_inv.buyer_business_name, v_inv.gst_rate_bp, s.taxable, s.cgst, s.sgst, s.igst, v_inv.lut_arn)
    returning id into v_cn;
  end if;

  return jsonb_build_object('ok', true, 'revoked', v_revoked, 'credit_note_id', v_cn);
end $$;


revoke execute on function public.gst_treatment(public.checkout_orders), public.gst_split(bigint, text, int)
  from public, anon, authenticated;
grant execute on function public.gst_treatment(public.checkout_orders), public.gst_split(bigint, text, int) to service_role;
revoke execute on function public.service_fulfil_checkout_order(text, text, bigint, text, text, jsonb),
  public.service_refund_checkout_payment(text, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.service_fulfil_checkout_order(text, text, bigint, text, text, jsonb),
  public.service_refund_checkout_payment(text, text, bigint, jsonb) to service_role;
