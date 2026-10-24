import { Alert } from "./Alert";

export function Flash({ sp }: { sp: { notice?: string; error?: string; saved?: string } }) {
  if (sp.error) return <Alert tone="error">{sp.error}</Alert>;
  if (sp.notice) return <Alert tone="success">{sp.notice}</Alert>;
  if (sp.saved) return <Alert tone="success">Saved.</Alert>;
  return null;
}
