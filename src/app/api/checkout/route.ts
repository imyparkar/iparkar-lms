import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/env";
import { paddleConfig, priceForCourse } from "@/lib/payments/config";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== new URL(SITE_URL).origin) return NextResponse.json({error:"Invalid origin"},{status:403});
  const session = await getSession();
  if (!session || session.profile.status !== "active") return NextResponse.json({error:"Sign in first"},{status:401});
  const input = await request.json().catch(()=>null);
  const code = typeof input?.course === "string" ? input.course.toUpperCase() : "";
  if (!["ASP","CSP","CIH"].includes(code)) return NextResponse.json({error:"Unknown package"},{status:400});
  const config = paddleConfig(), price = priceForCourse(code);
  if (!config.enabled || !price) return NextResponse.json({error:"Checkout is not available yet"},{status:503});
  const {data:courses,error:courseError} = await session.supabase.rpc("get_my_courses");
  if (courseError) return NextResponse.json({error:"Unable to check course"},{status:503});
  const course = courses?.find((c: {code:string})=>c.code===code);
  if (!course?.exams_enabled) return NextResponse.json({error:"This exam package is not ready for purchase"},{status:409});
  if (course.has_access) return NextResponse.json({error:"You already have access to this package"},{status:409});
  const db=getServiceClient();
  const {data:product,error} = await db.from("course_products").select("course_id,access_days,kind").eq("provider","paddle").eq("provider_price_id",price).eq("course_id",course.id).eq("is_active",true).single();
  if(error || !product || product.kind!=="one_time" || !product.access_days) return NextResponse.json({error:"Package pricing is not configured"},{status:503});
  // Only the server selects the price, user and course; no price or account IDs are accepted from the browser.
  const response=await fetch(`${config.base}/transactions`,{method:"POST",headers:{Authorization:`Bearer ${config.apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({items:[{price_id:price,quantity:1}],collection_mode:"automatic",custom_data:{user_id:session.user.id,course_id:course.id},checkout:{url:`${SITE_URL}/checkout/${code}`}})});
  if(!response.ok) return NextResponse.json({error:"Unable to start checkout. Please try again."},{status:502});
  const {data:transaction}=await response.json() as {data:{id:string;items?:{price?:{id:string;billing_cycle:unknown};quantity:number}[]}};
  const item=transaction?.items?.[0];
  if(!/^txn_[a-z0-9]+$/.test(transaction?.id??"") || transaction.items?.length!==1 || item?.price?.id!==price || item.price.billing_cycle!==null || item.quantity!==1) {
    return NextResponse.json({error:"This package must use a one-time Paddle price"},{status:503});
  }
  const {error:saveError}=await db.from("paddle_checkout_sessions").insert({transaction_id:transaction.id,user_id:session.user.id,course_id:course.id,price_id:price,access_days:product.access_days});
  if(saveError) return NextResponse.json({error:"Unable to prepare package access. No checkout was opened."},{status:503});
  return NextResponse.json({transactionId:transaction.id,token:config.token,environment:config.environment},{headers:{"Cache-Control":"no-store"}});
}
