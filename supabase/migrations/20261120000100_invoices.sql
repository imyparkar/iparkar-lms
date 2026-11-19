-- Invoices and credit notes for Razorpay purchases (iParkar issues its own; no Razorpay Invoices).
--
-- * One invoice per paid checkout order, one credit note per processed refund.
-- * Numbers run consecutively per Indian financial year (1 April–31 March, IST)
--   and per document type: INV/2026-27/0001, CN/2026-27/0001 (max 16 characters).
-- * Documents are created in the same transaction as the access grant/revoke,
--   so every payment and refund has exactly one document. Emailing happens
--   afterwards in the app (emailed_at / email_error record the outcome).
-- * iParkar Learning is not registered for GST: no GST lines are shown.

create table if not exists public.invoice_counters (
  kind  text not null check (kind in ('invoice','credit_note')),
  fy    text not null check (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  last  int  not null default 0,
  primary key (kind, fy)
);

create table if not exists public.invoices (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('invoice','credit_note')),
  number             text not null unique check (length(number) <= 16),
  fy                 text not null,
  issued_at          timestamptz not null default now(),
  checkout_order_id  uuid not null references public.checkout_orders (id) on delete restrict,
  original_invoice_id uuid references public.invoices (id) on delete restrict,  -- credit notes: the invoice they adjust
  user_id            uuid references public.profiles (id) on delete set null,
  buyer_name         text,
  buyer_email        text,
  buyer_country      text,
  description        text not null,
  access_days        int not null,
  currency           text not null,
  amount_minor       bigint not null check (amount_minor > 0),
  provider_payment_id text,
  provider_refund_id  text,
  email_claimed_at   timestamptz,
  emailed_at         timestamptz,
  email_error        text,
  check ((kind = 'invoice') = (original_invoice_id is null))
);
create unique index if not exists invoices_one_per_order on public.invoices (checkout_order_id) where kind = 'invoice';
create unique index if not exists invoices_one_per_refund on public.invoices (provider_refund_id) where kind = 'credit_note';
create index if not exists invoices_user_idx on public.invoices (user_id, issued_at desc);

alter table public.invoice_counters enable row level security;
alter table public.invoices enable row level security;
revoke all on public.invoice_counters from anon, authenticated;
revoke all on public.invoices from anon;
revoke insert, update, delete, truncate, references, trigger on public.invoices from authenticated;
grant select on public.invoices to authenticated;
drop policy if exists invoices_own on public.invoices;
create policy invoices_own on public.invoices for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Next document number for the current Indian financial year.
create or replace function public.next_document_number(p_kind text)
returns table (doc_number text, doc_fy text) language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'Asia/Kolkata')::date;
  y int := extract(year from d)::int - case when extract(month from d) < 4 then 1 else 0 end;
  v_fy text := y::text || '-' || lpad(((y + 1) % 100)::text, 2, '0');
  n int;
begin
  insert into invoice_counters as c (kind, fy, last) values (p_kind, v_fy, 1)
  on conflict on constraint invoice_counters_pkey do update set last = c.last + 1
  returning c.last into n;
  return query select (case when p_kind = 'invoice' then 'INV/' else 'CN/' end) || v_fy || '/' || lpad(n::text, 4, '0'), v_fy;
end $$;

-- Description and buyer details for an order.
create or replace function public.checkout_order_line(o checkout_orders)
returns table (description text, buyer_name text, buyer_email text)
language sql stable security definer set search_path = public as $$
  select
    case when o.study_course_id is not null
         then coalesce((select s.title from study_courses s where s.id = o.study_course_id), 'Self Paced Study Course')
         else coalesce((select c.code || ' practice exams' from courses c where c.id = o.course_id), 'Practice exams') end
      || ' – ' || case when o.access_days = 365 then '1 year' else o.access_days || ' days' end || ' access',
    (select p.full_name from profiles p where p.id = o.user_id),
    (select u.email from auth.users u where u.id = o.user_id)
$$;

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
  insert into invoices (kind, number, fy, checkout_order_id, user_id, buyer_name, buyer_email, buyer_country, description,
                        access_days, currency, amount_minor, provider_payment_id)
  values ('invoice', num.doc_number, num.doc_fy, o.id, o.user_id, l.buyer_name, l.buyer_email, o.country, l.description,
          o.access_days, o.currency, o.amount_minor, p_payment)
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
    insert into invoices (kind, number, fy, checkout_order_id, original_invoice_id, user_id, buyer_name, buyer_email, buyer_country,
                          description, access_days, currency, amount_minor, provider_payment_id, provider_refund_id)
    values ('credit_note', num.doc_number, num.doc_fy, o.id, v_inv.id, v_inv.user_id, v_inv.buyer_name, v_inv.buyer_email, v_inv.buyer_country,
            'Refund: ' || v_inv.description, v_inv.access_days, o.currency, p_amount, p_payment, p_refund)
    returning id into v_cn;
  end if;

  return jsonb_build_object('ok', true, 'revoked', v_revoked, 'credit_note_id', v_cn);
end $$;

revoke execute on function public.next_document_number(text), public.checkout_order_line(public.checkout_orders)
  from public, anon, authenticated;
grant execute on function public.next_document_number(text), public.checkout_order_line(public.checkout_orders) to service_role;
revoke execute on function public.service_fulfil_checkout_order(text, text, bigint, text, text, jsonb),
  public.service_refund_checkout_payment(text, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.service_fulfil_checkout_order(text, text, bigint, text, text, jsonb),
  public.service_refund_checkout_payment(text, text, bigint, jsonb) to service_role;
