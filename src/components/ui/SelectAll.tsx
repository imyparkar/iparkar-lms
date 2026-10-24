"use client";

export function SelectAll({ form, name = "ids" }: { form: string; name?: string }) {
  return (
    <input type="checkbox" aria-label="Select all on this page" className="h-4 w-4 accent-[#02093a]"
      onChange={(e) => {
        document.querySelectorAll<HTMLInputElement>(`input[form="${form}"][name="${name}"]`).forEach((c) => (c.checked = e.target.checked));
      }} />
  );
}
