"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children, exact = false }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const path = usePathname();
  const active = path === href || (!exact && path.startsWith(href + "/"));
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={`rounded-button px-3 py-2 text-body-sm font-medium transition-colors duration-200 ${active ? "text-action" : "text-ink-54 hover:text-ink"}`}>
      {children}
    </Link>
  );
}
