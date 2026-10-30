import {beforeAll,afterAll,describe,it,expect} from "vitest";
import {createDb,createUser,as,type DB} from "./harness";
let db:DB,user:string,course:string;
const txn='txn_test';
function event(id:string, overrides:Record<string,unknown>={}) {return {event_id:id,event_type:'transaction.completed',data:{id:txn,status:'completed',custom_data:{user_id:user,course_id:course},items:[{price:{id:'pri_asp'},quantity:1}],...overrides}};}
async function apply(evt:unknown) {return db.query('select service_process_paddle_event($1::jsonb) result',[JSON.stringify(evt)]);}
beforeAll(async()=>{db=await createDb();user=await createUser(db,{username:'buyer'});course=(await db.query<{id:string}>("select id from courses where code='ASP'")).rows[0].id;await db.query('insert into paddle_checkout_sessions values($1,$2,$3,$4,90,now())',[txn,user,course,'pri_asp']);});
afterAll(async()=>{await db.close();});
describe('Verified one-time fulfilment',()=>{
 it('rejects tampered identity and rolls back receipt so retry succeeds',async()=>{
  await expect(apply(event('evt_purchase',{custom_data:{user_id:'00000000-0000-0000-0000-000000000000',course_id:course}}))).rejects.toThrow();
  expect((await db.query('select id from payments')).rows).toHaveLength(0);
  await apply(event('evt_purchase'));
  expect((await db.query('select id from course_entitlements where user_id=$1',[user])).rows).toHaveLength(1);
 });
 it('does not double-grant for retried or separate events on the same transaction',async()=>{
  await apply(event('evt_purchase'));await apply(event('evt_second'));
  expect((await db.query('select id from course_entitlements where user_id=$1',[user])).rows).toHaveLength(1);
 });
 it('partial refund preserves access; full refund revokes only this purchase',async()=>{
  await apply({event_id:'evt_partial',event_type:'adjustment.updated',data:{id:'adj_1',transaction_id:txn,action:'refund',type:'partial',status:'approved'}});
  expect((await db.query('select revoked_at from course_entitlements where user_id=$1',[user])).rows[0].revoked_at).toBeNull();
  await apply({event_id:'evt_full',event_type:'adjustment.updated',data:{id:'adj_2',transaction_id:txn,action:'refund',type:'full',status:'approved'}});
  expect((await db.query('select revoked_at from course_entitlements where user_id=$1',[user])).rows[0].revoked_at).not.toBeNull();
 });
 it('denies student and anonymous fulfilment and checkout writes',async()=>{
  await expect(as(db,user,'select service_process_paddle_event($1::jsonb)',[JSON.stringify(event('evt_attack'))])).rejects.toThrow();
  await expect(as(db,null,'select * from paddle_checkout_sessions')).rejects.toThrow();
 });
 it('handles a refund arriving before completion without granting later',async()=>{
  const t='txn_early';await db.query('insert into paddle_checkout_sessions values($1,$2,$3,$4,90,now())',[t,user,course,'pri_asp']);
  await apply({event_id:'evt_early_refund',event_type:'adjustment.created',data:{id:'adj_early',transaction_id:t,action:'refund',type:'full',status:'approved'}});
  const e=event('evt_late_complete',{id:t});await apply(e);
  expect((await db.query('select id from course_entitlements where user_id=$1',[user])).rows).toHaveLength(1);
 });
});
