-- Razorpay checkout for practice-exam packages and Self Paced Study Courses.
--
-- Razorpay is a payment gateway, not a merchant of record: iParkar sets the
-- price. The server creates a Razorpay order for a fixed amount and records it
-- here BEFORE the student pays. Access is granted only when a captured payment
-- for exactly that order, amount and currency is confirmed (browser callback
-- with a verified signature, or the order.paid / payment.captured webhook —
-- whichever arrives first; the other is a no-op).

create table if not exists public.checkout_orders (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null default 'razorpay',
  provider_order_id  text not null,
  user_id            uuid references public.profiles (id) on delete set null,
  course_id          uuid references public.courses (id) on delete restrict,          -- practice-exam package
  study_course_id    uuid references public.study_courses (id) on delete restrict,    -- or a Self Paced Study Course
  access_days        int not null check (access_days > 0),
  amount_minor       bigint not null check (amount_minor > 0),
  currency           text not null check (currency ~ '^[A-Z]{3}$'),
  country            text,
  status             text not null default 'created'
                     check (status in ('created','paid','partially_refunded','refunded')),
  provider_payment_id text,
  payment_id         uuid references public.payments (id) on delete set null,
  refunded_minor     bigint not null default 0,
  created_at         timestamptz not null default now(),
  paid_at            timestamptz,
  unique (provider, provider_order_id),
  check ((course_id is null) <> (study_course_id is null))
);
create unique index if not exists checkout_orders_payment_uq on public.checkout_orders (provider, provider_payment_id)
  where provider_payment_id is not null;
create index if not exists checkout_orders_user_idx on public.checkout_orders (user_id, created_at desc);

alter table public.checkout_orders enable row level security;
-- Students may see their own orders; only the service role writes.
drop policy if exists checkout_orders_own on public.checkout_orders;
create policy checkout_orders_own on public.checkout_orders for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
revoke all on public.checkout_orders from anon;
revoke insert, update, delete, truncate, references, trigger on public.checkout_orders from authenticated;
grant select on public.checkout_orders to authenticated;

-- Grant access for a captured payment. Idempotent: the order row is locked and
-- only the first call moves it from 'created' to 'paid'.
create or replace function public.service_fulfil_checkout_order(
  p_order text, p_payment text, p_amount bigint, p_currency text, p_event text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o checkout_orders%rowtype;
  v_pay uuid;
  v_res jsonb;
begin
  select * into o from checkout_orders where provider = 'razorpay' and provider_order_id = p_order for update;
  if not found then
    insert into audit_logs (actor_id, action, entity, entity_id, details)
    values (null, 'payment.unmatched', 'checkout_order', p_order, jsonb_build_object('payment', p_payment, 'event', p_event));
    return jsonb_build_object('ok', false, 'reason', 'unknown order');
  end if;
  if o.status <> 'created' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'status', o.status);
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
   where id = o.id;
  return jsonb_build_object('ok', true, 'granted', true, 'course_id', coalesce(o.course_id, o.study_course_id), 'user_id', o.user_id);
end $$;

-- Record a processed refund. A full refund ends the course access bought with
-- that payment; a partial refund is recorded and flagged for the admin.
create or replace function public.service_refund_checkout_payment(
  p_payment text, p_refund text, p_amount bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o checkout_orders%rowtype;
  v_total bigint;
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
    return jsonb_build_object('ok', true, 'duplicate', true);
  end;

  v_total := o.refunded_minor + p_amount;
  if v_total >= o.amount_minor then
    update checkout_orders set refunded_minor = v_total, status = 'refunded' where id = o.id;
    if o.study_course_id is not null then
      perform service_revoke_study_purchase(o.payment_id, 'Refunded');   -- takes back this payment's days; progress kept
    elsif o.user_id is not null then
      perform service_revoke_for_payment(o.user_id, o.course_id, 'Refunded');
    end if;
    return jsonb_build_object('ok', true, 'revoked', true);
  end if;

  update checkout_orders set refunded_minor = v_total, status = 'partially_refunded' where id = o.id;
  insert into audit_logs (actor_id, action, entity, entity_id, details)
  values (null, 'refund.partial', 'checkout_order', o.id::text,
          jsonb_build_object('user_id', o.user_id, 'course_id', coalesce(o.course_id, o.study_course_id), 'refunded', v_total, 'paid', o.amount_minor,
                             'note', 'Access kept. Revoke it in Students & access if the refund should end access.'));
  return jsonb_build_object('ok', true, 'revoked', false);
end $$;

revoke execute on function public.service_fulfil_checkout_order(text, text, bigint, text, text, jsonb),
  public.service_refund_checkout_payment(text, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.service_fulfil_checkout_order(text, text, bigint, text, text, jsonb),
  public.service_refund_checkout_payment(text, text, bigint, jsonb) to service_role;
