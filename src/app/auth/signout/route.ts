import { NextResponse, type NextRequest } from "next/server";
import { getServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await getServerClient();
  await supabase.auth.signOut();
  // Automatic sign-out after inactivity: say why, and return the learner to the same page after signing in.
  const form = await request.formData().catch(() => null);
  const url = new URL("/login", request.nextUrl.origin);
  if (form?.get("reason") === "idle") {
    url.searchParams.set("notice", "idle");
    const next = String(form.get("next") ?? "");
    if (next.startsWith("/") && !next.startsWith("//")) url.searchParams.set("next", next);
  } else {
    url.searchParams.set("notice", "signed-out");
  }
  return NextResponse.redirect(url, { status: 303 });
}
