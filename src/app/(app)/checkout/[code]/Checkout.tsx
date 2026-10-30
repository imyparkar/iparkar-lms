"use client";
import Script from "next/script";
import { useState, useRef } from "react";
type Paddle = {Environment:{set:(env:string)=>void};Initialize:(settings:{token:string;eventCallback:(event:{name:string})=>void})=>void;Checkout:{open:(settings:{transactionId:string})=>void}};
declare global {interface Window {Paddle?:Paddle}}
export function Checkout({code,days}:{code:string;days:number}) {
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [completed,setCompleted]=useState(false);
  const initialized=useRef(false);
  async function open() {
    setBusy(true);setMessage("");
    try {
      const response=await fetch("/api/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({course:code,days})});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||"Unable to open checkout");
      const paddle=window.Paddle;
      if(!paddle) throw new Error("Checkout could not load. Please refresh and try again.");
      if(!initialized.current) {
      if(data.environment==="sandbox") paddle.Environment.set("sandbox");
      paddle.Initialize({token:data.token,eventCallback:event=>{if(event.name==="checkout.completed"){setCompleted(true);setMessage("Payment submitted. We are confirming your access. Open your course to check its status.");}}});
      initialized.current=true;
      }
      paddle.Checkout.open({transactionId:data.transactionId});
    } catch(error) {setMessage(error instanceof Error?error.message:"Unable to open checkout");}
    finally {setBusy(false);}
  }
  return <><Script src="https://cdn.paddle.com/paddle/v2/paddle.js" onReady={()=>setReady(true)} onError={()=>setMessage("Secure checkout could not load. Please try again later.")}/><button className="btn-primary" onClick={open} disabled={!ready||busy||completed}>{busy?"Preparing checkout…":"Continue to secure checkout"}</button><p role="status" aria-live="polite">{message}</p>{completed&&<a className="btn-dark" href={`/courses/${code}`}>Check my {code} access</a>}<p className="text-caption text-graphite">Closing or completing the checkout screen does not itself grant access. You can return to your course after payment confirmation.</p></>;
}
