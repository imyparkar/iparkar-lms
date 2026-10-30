-- One-time ASP/CSP/CIH checkout. The browser cannot write payment/access state.
create table public.paddle_checkout_sessions (
 transaction_id text primary key,
 user_id uuid not null references public.profiles(id),
 course_id uuid not null references public.courses(id),
 price_id text not null,
 access_days int not null check(access_days>0),
 created_at timestamptz not null default now()
);
alter table public.paddle_checkout_sessions enable row level security;
revoke all on public.paddle_checkout_sessions from public, anon, authenticated;
grant all on public.paddle_checkout_sessions to service_role;

create or replace function public.service_process_paddle_event(p_event jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_data jsonb := p_event->'data';
 v_kind text := p_event->>'event_type';
 v_txn text;
 v_session paddle_checkout_sessions%rowtype;
 v_payment uuid;
 v_original uuid;
 v_base timestamptz;
 v_refunded boolean;
begin
 if coalesce(p_event->>'event_id','')='' or jsonb_typeof(v_data)<>'object' then raise exception 'Invalid event'; end if;
 if v_kind not in ('transaction.completed','adjustment.created','adjustment.updated') then return jsonb_build_object('ignored',true); end if;
 v_txn := case when v_kind='transaction.completed' then v_data->>'id' else v_data->>'transaction_id' end;
 -- Serialize duplicate transactions and adjustments arriving in different orders.
 perform pg_advisory_xact_lock(hashtextextended(coalesce(v_txn,''),0));
 if exists(select 1 from payments where provider='paddle' and provider_event_id=p_event->>'event_id') then return jsonb_build_object('duplicate',true); end if;
 select * into v_session from paddle_checkout_sessions where transaction_id=v_txn;
 if not found then raise exception 'Unmatched checkout; configure or reconcile before retry'; end if;
 if v_kind='transaction.completed' then
  if v_data->>'status' is distinct from 'completed' or v_data->>'subscription_id' is not null then raise exception 'Not a completed one-time transaction'; end if;
  if v_data->'custom_data'->>'user_id' is distinct from v_session.user_id::text or v_data->'custom_data'->>'course_id' is distinct from v_session.course_id::text then raise exception 'Checkout identity mismatch'; end if;
  if jsonb_array_length(v_data->'items')<>1 or v_data->'items'->0->'price'->>'id' is distinct from v_session.price_id or (v_data->'items'->0->>'quantity')::int is distinct from 1 then raise exception 'Checkout item mismatch'; end if;
  if exists(select 1 from payments where provider='paddle' and event_type='transaction.completed' and provider_txn_id=v_txn) then return jsonb_build_object('duplicate',true); end if;
 end if;
 insert into payments(user_id,course_id,provider,provider_event_id,provider_txn_id,event_type,status,amount_minor,currency,payload)
 values(v_session.user_id,v_session.course_id,'paddle',p_event->>'event_id',v_txn,v_kind,coalesce(v_data->>'status','unknown'),nullif(v_data->'details'->'totals'->>'grand_total','')::bigint,v_data->>'currency_code',p_event) returning id into v_payment;
 if v_kind='transaction.completed' then
  select exists(select 1 from payments where provider='paddle' and provider_txn_id=v_txn and event_type in ('adjustment.created','adjustment.updated') and payload->'data'->>'status'='approved' and (payload->'data'->>'action'='chargeback' or (payload->'data'->>'action'='refund' and payload->'data'->>'type'='full'))) into v_refunded;
  if v_refunded then return jsonb_build_object('refunded',true); end if;
  -- Serialize separate purchases for the same account/course as well.
  perform pg_advisory_xact_lock(hashtextextended(v_session.user_id::text||v_session.course_id::text,1));
  select greatest(now(),coalesce(max(expires_at),now())) into v_base from course_entitlements where user_id=v_session.user_id and course_id=v_session.course_id and revoked_at is null and expires_at>now();
  insert into course_entitlements(user_id,course_id,source,starts_at,expires_at,payment_id,note)
  values(v_session.user_id,v_session.course_id,'purchase',v_base,v_base+make_interval(days=>v_session.access_days),v_payment,'Verified Paddle one-time purchase');
  insert into audit_logs(action,entity,entity_id,details) values('payment.fulfilled','payment',v_payment::text,jsonb_build_object('transaction_id',v_txn));
 elsif v_data->>'status'='approved' and (v_data->>'action'='chargeback' or (v_data->>'action'='refund' and v_data->>'type'='full')) then
  select id into v_original from payments where provider='paddle' and provider_txn_id=v_txn and event_type='transaction.completed';
  update course_entitlements set revoked_at=now(),revoked_reason='Paddle refund or chargeback' where payment_id=v_original and revoked_at is null;
 else
  insert into audit_logs(action,entity,entity_id,details) values('payment.adjustment_review','payment',v_payment::text,jsonb_build_object('transaction_id',v_txn,'action',v_data->>'action','type',v_data->>'type','status',v_data->>'status'));
 end if;
 return jsonb_build_object('ok',true);
 -- Any exception rolls back BOTH the event receipt and entitlement, so retries can recover.
end $$;
revoke all on function public.service_process_paddle_event(jsonb) from public, anon, authenticated;
grant execute on function public.service_process_paddle_event(jsonb) to service_role;
