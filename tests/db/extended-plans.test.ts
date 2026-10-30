import {beforeAll,afterAll,it,expect} from 'vitest';
import {createDb,createUser,type DB} from './harness';
let db:DB;
beforeAll(async()=>{db=await createDb();});afterAll(async()=>{await db.close();});
for(const code of ['ASP','CSP','CIH'])for(const days of [180,365])it(`${code} purchase grants exactly ${days} days once and no other exam`,async()=>{
 const user=await createUser(db,{username:`buyer-${code}-${days}`});const course=(await db.query<{id:string}>('select id from courses where code=$1',[code])).rows[0].id;
 const txn=`txn_${code}_${days}`,price=`pri_${code}_${days}`;
 await db.query('insert into paddle_checkout_sessions(transaction_id,user_id,course_id,price_id,access_days) values($1,$2,$3,$4,$5)',[txn,user,course,price,days]);
 const event={event_id:`evt_${code}_${days}`,event_type:'transaction.completed',data:{id:txn,status:'completed',currency_code:'USD',custom_data:{user_id:user,course_id:course},items:[{price:{id:price},quantity:1}]}};
 const apply=async()=>db.query('select service_process_paddle_event($1::jsonb)',[JSON.stringify(event)]);
 await apply();await apply();event.event_id+='retry';await apply();
 const rows=(await db.query<{course_id:string;days:number}>('select course_id,extract(epoch from (expires_at-starts_at))/86400 as days from course_entitlements where user_id=$1',[user])).rows;
 expect(rows).toHaveLength(1);expect(rows[0].course_id).toBe(course);expect(Number(rows[0].days)).toBe(days);
});
