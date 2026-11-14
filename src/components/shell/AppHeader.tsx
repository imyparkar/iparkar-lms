import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { NavLink } from "./NavLink";
import { SignOutForm } from "./SignOutForm";

export function AppHeader({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  return (
    <header className="sticky top-0 z-30 h-nav bg-white shadow-nav no-print">
      <div className="mx-auto flex h-full max-w-page items-center justify-between gap-4 px-4 sm:px-8">
        <Logo />
        <nav aria-label="Main" className="flex min-w-0 items-center gap-1 overflow-x-auto">
          <NavLink href="/dashboard">Dashboard</NavLink>
          <NavLink href="/learn">My learning</NavLink>
          <NavLink href="/study-guides">Study guides</NavLink>
          {isAdmin && <NavLink href="/admin">Admin</NavLink>}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/account" className="hidden sm:inline text-body-sm text-ink-54 hover:text-ink transition-colors" title="Account">
            {name}
          </Link>
          <SignOutForm />
        </div>
      </div>
    </header>
  );
}
