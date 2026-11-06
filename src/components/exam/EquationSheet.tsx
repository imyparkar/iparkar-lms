"use client";
/**
 * "Useful Equations and Conversion Factors for the QEP and GES Examinations"
 * (Board for Global EHS Credentialing), the reference the BGC provides on the
 * exam computer. Transcribed as HTML so it reads well on any screen and can be
 * searched; the original PDF is one click away for the printed layout.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, X } from "lucide-react";
import { RichText } from "@/components/ui/RichText";

export const EQUATION_SHEET_PDF = "/reference/BGC-QEP-GES-Equation-Sheet.pdf";

function Frac({ n, d }: { n: ReactNode; d: ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex flex-col items-center align-middle leading-tight">
      <span className="border-b border-ink px-1">{n}</span>
      <span className="px-1">{d}</span>
    </span>
  );
}
const Tex = ({ src }: { src: string }) => <RichText text={`\\(\\displaystyle ${src}\\)`} />;
const Eq = ({ children }: { children: ReactNode }) => <li className="py-1.5 text-[15px] text-ink">{children}</li>;
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="text-body-sm font-semibold text-ink underline underline-offset-2">{title}</h3>
      <ul className="mt-1">{children}</ul>
    </section>
  );
}

export function EquationSheetContent() {
  return (
    <div className="text-body-sm text-graphite">
      <p className="text-caption">
        Board for Global EHS Credentialing. The list is not guaranteed to be complete, variables are not standardized, and it may
        include items that are not on the GES or QEP exam.
      </p>

      <h2 className="mt-4 text-body font-semibold text-ink">I. Constants and Conversion Factors</h2>
      <ul>
        <Eq>°F = 9/5 (°C) + 32</Eq>
        <Eq>K = °C + 273.15</Eq>
        <Eq>Molar volume at 25 °C, 1 atm = 24.45 L</Eq>
        <Eq>1 ft³ = 28.32 L</Eq>
        <Eq>1 ft³ = 7.481 U.S. gal</Eq>
        <Eq>1 L = 1.0567 qt</Eq>
        <Eq>1 inch = 2.54 cm</Eq>
        <Eq>12 inches = 1 foot</Eq>
        <Eq>1 lb = 453.6 grams</Eq>
        <Eq>1 gram = 15.43 grains</Eq>
        <Eq>1 atm = 14.7 psi = 760 mm Hg = 29.92 in Hg = 33.93 ft water = 1013.25 mbar = 101,325 pascals</Eq>
        <Eq>1 BTU = 1054.8 joules = 0.293 watt hr</Eq>
        <Eq>1 cal = 4.184 joules</Eq>
        <Eq>Avogadro’s number = 6.024 × 10²³</Eq>
        <Eq>Gas constant, R = 8.314 J/mole K = 0.082 L atm/mole K</Eq>
        <Eq>Density of air = 1.29 g/L at 1 atm, 0 °C</Eq>
        <Eq>g = 981 cm/sec² = 32 ft/sec²</Eq>
        <Eq>1 gallon of water = 8.34 pounds</Eq>
        <Eq>pi = π = 3.142</Eq>
      </ul>

      <h2 className="mt-5 text-body font-semibold text-ink">II. Common Environmental Formulas</h2>
      <p className="mt-2 font-semibold text-ink">a. General / Cross Discipline</p>
      <Group title="Area">
        <Eq>Rectangle or square: A = L × W</Eq>
        <Eq>Circle: A = 0.785 × D²</Eq>
        <Eq>Triangle: A = <Frac n="B × H" d="2" /></Eq>
        <Eq>Area of an open-ended cylinder = 2πrh + πr²</Eq>
        <Eq>Area of a close-ended cylinder = 2πrh + 2πr²</Eq>
      </Group>
      <Group title="Volume">
        <Eq>Rectangle: Volume = Area × Height = L × W × H</Eq>
        <Eq>Cylinder: Volume = Area × Height = 0.785 × D² × H</Eq>
        <Eq>Cone: Volume = <Frac n="Area × Height" d="3" /> = <Frac n="0.785 × D² × H" d="3" /></Eq>
      </Group>
      <Group title="Velocity">
        <Eq>Velocity = <Frac n="Distance traveled" d="Time" /></Eq>
        <Eq>Velocity = <Frac n="Flow rate" d="Area" /></Eq>
      </Group>
      <Group title="Other">
        <Eq>pH = −log[H₃O⁺]</Eq>
        <Eq><Tex src={String.raw`S^2 = \frac{\sum (x_i - \bar{x})^2}{n - 1}`} /></Eq>
        <Eq><Tex src={String.raw`t = \frac{\bar{x}_1 - \bar{x}_2}{\sqrt{\left(\dfrac{S_1^2}{n_1} + \dfrac{S_2^2}{n_2}\right)}}`} /></Eq>
        <Eq><Tex src={String.raw`\mathrm{UCL}_{1-\alpha} = \bar{x} + t_{\alpha,\,n-1}\, s/\sqrt{n}`} /></Eq>
      </Group>

      <p className="mt-4 font-semibold text-ink">b. Water-Related</p>
      <ul>
        <Eq>Q<sub>s</sub>C<sub>s</sub> + Q<sub>d</sub>C<sub>d</sub> = Q<sub>r</sub>C<sub>r</sub></Eq>
        <Eq>DTW<sub>c</sub> = DTW<sub>m</sub> − (PT × Rho)</Eq>
        <Eq>Top of water table depression from overlaying liquid = Apparent thickness × Density</Eq>
        <Eq>C<sub>EW</sub> = Σ(C<sub>i</sub>/d<sub>i</sub>) / Σ(1/d<sub>i</sub>)</Eq>
      </ul>

      <p className="mt-4 font-semibold text-ink">c. Air-Related</p>
      <p className="mt-1 text-caption">
        AE (mass), E (mass/energy), HI (energy/time), T (time), C<sub>d</sub> = concentration (dry), Q<sub>d</sub> = flow rate (dry),
        C<sub>w</sub> = concentration (wet), Q<sub>w</sub> = flow rate (wet), M% = moisture (%)
      </p>
      <ul>
        <Eq>AE [air emissions] = E × HI × T × Capacity Factor</Eq>
        <Eq>E = K × C<sub>w</sub> × Q<sub>w</sub></Eq>
        <Eq>C<sub>d</sub> = C<sub>w</sub> / (1 − M%/100%)</Eq>
        <Eq>Q<sub>d</sub> = Q<sub>w</sub> / (1 − M%/100%)</Eq>
        <Eq>K = 2.596 × 10⁻⁹ × (MW) (lb/dscf)/ppm</Eq>
        <Eq><Tex src={String.raw`E = \frac{\sum_{i=1}^{n} E_i}{n} = \frac{E_1 + E_2 + \dots + E_n}{n}`} /></Eq>
      </ul>
    </div>
  );
}

/** Movable, non-modal panel shown during the exam. */
export function EquationSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => { if (open) panel.current?.focus(); }, [open]);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    if (window.innerWidth < 640 || !panel.current) return; // docked on phones
    const r = panel.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);
  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current || !panel.current) return;
    const w = panel.current.offsetWidth, h = panel.current.offsetHeight;
    setPos({
      x: Math.min(Math.max(0, e.clientX - drag.current.dx), window.innerWidth - w),
      y: Math.min(Math.max(64, e.clientY - drag.current.dy), Math.max(64, window.innerHeight - h)),
    });
  }, []);
  const onDragEnd = useCallback(() => { drag.current = null; }, []);

  return (
    <div ref={panel} hidden={!open} tabIndex={-1} role="dialog" aria-modal="false" aria-label="Equation sheet"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
      className="fixed bottom-[65px] left-0 z-40 flex max-h-[70vh] w-full flex-col rounded-t-[10px] border border-hairline bg-white shadow-mockup outline-none sm:bottom-[84px] sm:left-4 sm:max-h-[calc(100vh-170px)] sm:w-[440px] sm:rounded-[10px]">
      <div className="flex cursor-move select-none items-center justify-between gap-2 border-b border-hairline bg-paper px-3 py-1.5 sm:cursor-grab"
        onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd} title="Drag to move">
        <span className="text-[12px] font-semibold text-ink">Useful equations and conversion factors</span>
        <div className="flex items-center gap-1">
          <a href={EQUATION_SHEET_PDF} target="_blank" rel="noopener" onPointerDown={(e) => e.stopPropagation()}
             className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-action hover:bg-black/5">
            PDF <ExternalLink size={12} aria-hidden />
          </a>
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}
                  className="rounded p-0.5 text-ink hover:bg-black/10" aria-label="Hide equation sheet"><X size={15} aria-hidden /></button>
        </div>
      </div>
      <div className="overflow-y-auto px-4 pb-5 pt-3">
        <EquationSheetContent />
      </div>
    </div>
  );
}
