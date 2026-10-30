import {beforeEach,describe,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn(),session:vi.fn(),from:vi.fn(),fetch:vi.fn(),mapping:{access_days:180,kind:'one_time',course_id:'course-id'},save:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/auth/session',()=>({getSession:mock.session}));
vi.mock('@/lib/supabase/admin',()=>({getServiceClient:()=>({from:mock.from})}));
vi.mock('@/lib/env',()=>({SITE_URL:'https://sandbox.example.test'}));
import {priceForCourse} from '@/lib/payments/config';
import {ACCESS_PLANS} from '@/lib/payments/plans';
import {POST} from '@/app/api/checkout/route';
import {NextRequest} from 'next/server';
function req(body:unknown){return new NextRequest('https://sandbox.example.test/api/checkout',{method:'POST',headers:{origin:'https://sandbox.example.test','content-type':'application/json'},body:JSON.stringify(body)});}
beforeEach(()=>{
 vi.clearAllMocks();vi.stubGlobal('fetch',mock.fetch);
 process.env.PADDLE_ENVIRONMENT='sandbox';process.env.PADDLE_CHECKOUT_ENABLED='true';process.env.PADDLE_API_KEY='sandbox-test-key';process.env.PADDLE_CLIENT_TOKEN='test_unit';
 for(const code of ['ASP','CSP','CIH']) for(const p of ACCESS_PLANS)process.env[`PADDLE_PRICE_ID_${code}${p.days===90?'':'_'+p.days}`]=`pri_${code}_${p.days}`;
 mock.mapping={access_days:180,kind:'one_time',course_id:'course-id'};
 mock.rpc.mockResolvedValue({data:[{code:'ASP',id:'course-id',exams_enabled:true,has_access:false}]});
 mock.session.mockResolvedValue({user:{id:'student-id'},profile:{status:'active'},supabase:{rpc:mock.rpc}});
 mock.save.mockResolvedValue({error:null});
 mock.from.mockImplementation((table:string)=>{
  if(table==='paddle_checkout_sessions')return {insert:mock.save};
  const chain:any={select:()=>chain,eq:()=>chain,single:async()=>({data:mock.mapping,error:null})};return chain;
 });
 mock.fetch.mockImplementation(async (_url:string,options:any)=>{
  const body=JSON.parse(options.body),price=body.items[0].price_id;
  const days=Number(price.split('_').at(-1));const plan=ACCESS_PLANS.find(x=>x.days===days)!;
  return {ok:true,json:async()=>({data:{id:'txn_unit',items:[{price:{id:price,billing_cycle:null,unit_price:{amount:plan.amount,currency_code:'USD'}},quantity:1}]}})};
 });
});
describe('Extended checkout server selection',()=>{
 for(const code of ['ASP','CSP','CIH']) for(const days of [180,365])it(`${code} ${days}: binds the correct price and duration to the signed-in student`,async()=>{
  mock.rpc.mockResolvedValue({data:[{code,id:'course-id',exams_enabled:true,has_access:false}]});mock.mapping.access_days=days;
  const r=await POST(req({course:code,days,price_id:'pri_attack',user_id:'other',amount:'1'}));expect(r.status).toBe(200);
  const body=JSON.parse(mock.fetch.mock.calls[0][1].body);expect(body.items).toEqual([{price_id:`pri_${code}_${days}`,quantity:1}]);expect(body.custom_data.user_id).toBe('student-id');
  expect(mock.save).toHaveBeenCalledWith(expect.objectContaining({access_days:days,price_id:`pri_${code}_${days}`,user_id:'student-id'}));
 });
 it('keeps existing 90-day requests compatible',async()=>{mock.mapping.access_days=90;expect((await POST(req({course:'ASP'}))).status).toBe(200);});
 for(const days of [1,366,'180',null,-1])it(`rejects invalid period ${String(days)}`,async()=>{expect((await POST(req({course:'ASP',days}))).status).toBe(400);expect(mock.fetch).not.toHaveBeenCalled();});
 it('fails closed when the mapping duration differs',async()=>{mock.mapping.access_days=90;expect((await POST(req({course:'ASP',days:180}))).status).toBe(503);expect(mock.fetch).not.toHaveBeenCalled();});
 it('does not accept a missing configured price',async()=>{delete process.env.PADDLE_PRICE_ID_ASP_180;expect((await POST(req({course:'ASP',days:180}))).status).toBe(503);});
 it('rejects an incorrect provider amount before opening checkout',async()=>{mock.fetch.mockResolvedValue({ok:true,json:async()=>({data:{id:'txn_unit',items:[{price:{id:'pri_ASP_180',billing_cycle:null,unit_price:{amount:'9900',currency_code:'USD'}},quantity:1}]}})});expect((await POST(req({course:'ASP',days:180}))).status).toBe(503);expect(mock.save).not.toHaveBeenCalled();});
 it('blocks signed-out checkout',async()=>{mock.session.mockResolvedValue(null);expect((await POST(req({course:'ASP',days:180}))).status).toBe(401);});
 it('rejects invalid course and duration config lookups',()=>{expect(priceForCourse('ASP',366)).toBeUndefined();expect(priceForCourse('OTHER',180)).toBeUndefined();});
});
