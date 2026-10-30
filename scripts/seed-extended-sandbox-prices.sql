-- Staging project gyfkyaclmrvfbgyqkukn only. No production price IDs.
with plans(code,price_id,days) as (values
 ('ASP','pri_01m66x0akj5et6920nbv3hb2az',180),
 ('ASP','pri_01m66x0av28bg4wqc6trbr8av1',365),
 ('CSP','pri_01m66x0ba4tzb95q7t2g67jmwy',180),
 ('CSP','pri_01m66x0bj4p4n7shasnvwtrnsj',365),
 ('CIH','pri_01m66x0c04wf2vmb5ch9d2rdkz',180),
 ('CIH','pri_01m66x0c7bvhjdvfx4dzp0vf6q',365)
) insert into public.course_products(course_id,provider,provider_price_id,access_days,kind,is_active)
select c.id,'paddle',p.price_id,p.days,'one_time',true from plans p join public.courses c on c.code=p.code
on conflict(provider,provider_price_id) do nothing;
