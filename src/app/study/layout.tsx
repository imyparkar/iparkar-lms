import { IdleLogout } from "@/components/shell/IdleLogout";

/** Signed-in pages outside the main app shell still sign out after 10 minutes without activity. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <><IdleLogout />{children}</>;
}
