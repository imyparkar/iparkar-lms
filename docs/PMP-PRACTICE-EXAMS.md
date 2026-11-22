# PMP® practice examinations

The PMP course runs on the same exam engine as ASP, CSP, CIH, EPI, QEP and CIT
(100-question mixed exam in 150 minutes, 20-question domain exams in 30 minutes,
answers and explanations after submit). Two things differ:

* **No calculator.** `courses.calculator_enabled = false` hides the calculator
  button and panel. Every other course keeps the default (`true`).
* **Interactive item types** from the PMI July 2026 ECO, added by
  `20261122000200_interactive_items.sql`:

| `question_type`     | Learner does                                   | Saved with      | Scoring                    |
|---------------------|------------------------------------------------|-----------------|----------------------------|
| `single_best_answer`| picks one option                               | `save_answer`   | unchanged                  |
| `pulldown`          | picks the option that fills `[[F1]]`           | `save_answer`   | as single best answer      |
| `multiple_response` | ticks N options                                | `save_response` | exact set                  |
| `matching`          | pairs each left item with a right option       | `save_response` | all pairs right            |
| `enhanced_matching` | drags labels onto exhibit targets (or lists)   | `save_response` | every label in an accepted target (`UNPLACED` allowed when keyed) |
| `hotspot`           | clicks region(s) of an exhibit                 | `save_response` | exact set                  |

Case briefs (`question_cases`) and SVG exhibits (`question_exhibits`) are copied
into each question's version snapshot, so an attempt always shows what the
student saw. Exhibits are shown as `<img>` (scripts inside SVG never run) with a
text version from the exhibit's data table. Every drag-and-drop and hotspot has a
keyboard equivalent on the same question (selects, focusable regions).

Single-best-answer snapshots, grading and review payloads are unchanged, so the
existing courses behave exactly as before (covered by the existing test suite).

## Loading the bank

The PMP26 bank is premium content and never enters this repository. Copy the
export folder into `imports/` (git-ignored) and run:

```bash
ADMIN_EMAIL=… ADMIN_PASSWORD='…' npm run import:pmp -- --dir imports/PMP26_Question_Bank --status published
```

`admin_import_rich_questions` validates each item, versions changed ones and
reports failures one by one; re-running is safe. Interactive items are
read-only in Admin → Questions (pull-down items stay editable); change them in
the bank and re-import.

Then make the course visible and enable exams in Admin → Courses. The course
has no online price yet, so access is granted by an administrator until prices
are added to `src/lib/payments/catalogue.ts` (and iparkar.com).

To check the bank locally against the real migrations:

```bash
PMP_BANK_DIR=imports/PMP26_Question_Bank npx vitest run tests/db/pmp-bank.test.ts
```
