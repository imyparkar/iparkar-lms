import { requireUser } from "@/lib/auth/session";
import { AppHeader } from "@/components/shell/AppHeader";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  return (
    <>
      <AppHeader name={profile.full_name || profile.username} isAdmin={profile.role === "admin"} />
      <main className="mx-auto max-w-content px-4 pb-20 pt-8 sm:px-8">{children}</main>
      <footer className="border-t border-hairline py-6 text-center text-caption text-graphite no-print">
        Practice questions are original study material — not actual examination items — and practice scores do not predict or guarantee certification results.
      </footer>
    </>
  );
}
