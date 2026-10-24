import { requireAdmin } from "@/lib/auth/session";
import { NavLink } from "@/components/shell/NavLink";

const LINKS = [
  ["/admin", "Overview"], ["/admin/questions", "Questions"], ["/admin/questions/import", "Import"],
  ["/admin/blueprints", "Blueprints"], ["/admin/students", "Students & access"], ["/admin/attempts", "Attempts"],
  ["/admin/settings", "Exam settings"], ["/admin/audit", "Audit log"],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="space-y-6">
      <div>
        <p className="text-caption text-slate">Administration</p>
        <nav aria-label="Admin" className="mt-2 flex flex-wrap gap-1 border-b border-hairline pb-2">
          {LINKS.map(([href, label]) => <NavLink key={href} href={href} exact={href === "/admin" || href === "/admin/questions/import"}>{label}</NavLink>)}
        </nav>
      </div>
      {children}
    </div>
  );
}
