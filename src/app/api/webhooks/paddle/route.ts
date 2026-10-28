import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { verifyPaddleSignature } from "@/lib/payments/paddle";
import { getServiceClient } from "@/lib/supabase/admin";
const eventSchema=z.object({event_id:z.string().min(1),event_type:z.string().min(1),data:z.object({id:z.string().min(1)}).passthrough()}).passthrough();
export async function POST(request: NextRequest) {
  const secret=process.env.PADDLE_WEBHOOK_SECRET;
  if(!secret) return NextResponse.json({error:"Webhook not configured"},{status:503});
  const raw=await request.text();
  if(!(await verifyPaddleSignature(raw,request.headers.get("paddle-signature"),secret))) return NextResponse.json({error:"Invalid signature"},{status:401});
  let event;
  try {event=eventSchema.parse(JSON.parse(raw));} catch {return NextResponse.json({error:"Invalid event"},{status:400});}
  const {data,error}=await getServiceClient().rpc("service_process_paddle_event",{p_event:event});
  if(error) return NextResponse.json({error:"Payment processing pending; retry required"},{status:500});
  return NextResponse.json(data);
}
