import { requireUser } from "@/lib/auth/session";
import { AppHeader } from "@/components/shell/AppHeader";
import { IdleLogout } from "@/components/shell/IdleLogout";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  return (
    <>
      <IdleLogout />
      <AppHeader name={profile.full_name || profile.username} isAdmin={profile.role === "admin"} />
      <main className="mx-auto max-w-content px-4 pb-20 pt-8 sm:px-8">{children}</main>
      <footer className="border-t border-hairline py-6 text-center text-caption text-graphite no-print">
        Practice questions are original study material — not actual examination items — and practice scores do not predict or guarantee certification results.
        <span className="mt-2 flex items-center justify-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/iparkar-mark-primary-tm.svg" width={26} height={20} alt="" />
          © {new Date().getFullYear()} iParkar Learning™
        </span>
      </footer>
    </>
  );
}
