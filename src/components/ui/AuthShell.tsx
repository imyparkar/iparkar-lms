import { Logo } from "./Logo";
import { AuthArtwork } from "./AuthArtwork";
import { MARKETING_URL } from "@/lib/env";

export function AuthShell({ title, lead, children, footer }: { title: string; lead?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="min-h-screen grid lg:grid-cols-2">
      <section className="flex flex-col px-4 py-8 sm:px-10">
        <Logo href={MARKETING_URL} />
        <div className="mx-auto my-auto w-full max-w-[400px] py-12">
          <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.6px]">{title}</h1>
          {lead && <p className="lead mt-2">{lead}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-body-sm text-graphite">{footer}</div>}
        </div>
        <p className="text-caption text-graphite">
          Practice questions are original study material, not actual examination items.
        </p>
      </section>
      <aside className="hidden lg:flex flex-col justify-between gap-10 bg-midnight p-12 text-white on-dark overflow-hidden">
        <span className="pill bg-marigold text-ink self-start">Premium practice</span>
        <div className="hidden [@media(min-height:820px)]:block">
          <AuthArtwork />
        </div>
        <div>
          <p className="font-serif text-[32px] leading-[1.25]">Timed, blueprint-weighted mock exams with a breakdown of every domain.</p>
          <ul className="mt-8 space-y-3 text-body text-white/85">
            <li>ASP · CSP · CIH — each with its own question bank</li>
            <li>Countdown timer, flagging and an on-screen scientific calculator</li>
            <li>Domain analytics that show where to study next</li>
          </ul>
        </div>
        <p className="text-caption text-white/70">© {new Date().getFullYear()} iParkar Learning</p>
      </aside>
    </main>
  );
}
