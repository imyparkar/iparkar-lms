# PMP® Exam Prep Course (PMP-SPS): build, certificates and handoff

Status on 21 Nov 2026: **built and validated, not yet imported or published.** Content review status is `draft` on all 52 chapters. The course runs on the shared study engine (`docs/STUDY-COURSE.md`). This file covers what is specific to PMP: the 35-hour curriculum, original content, and the new **certificate of course completion** feature, which any study course can turn on.

## 1. Sources

| Input | Used for | Notes |
|---|---|---|
| PMI PMP® Examination Content Outline, July 2026 | Task mapping | 26 tasks: People 8, Process 10, Business Environment 8. Every task is covered (`content/pmp-sps/coverage.csv`). |
| PMBOK® Guide 8th ed. (2025), supplied PDF | Technical reference | Every chapter cites sections with **printed** page numbers, all checked against headings extracted from the PDF. The course content is original. No PMBOK text, figures or PMI questions are reproduced. |
| PMI® Certification Handbook (revised June 2026) and pmi.org | Module 9 (exam readiness) | Facts are date-stamped 21 Nov 2026. The course gives no exam fees (sources conflict) and does not claim ATP status. |
| Course brief (35 h, module budget) | Time model | 2,100 minutes: Business Acumen 480, Ways of Working 1,140, Power Skills 480. Validated by `scripts/pmp-sps/build_package.py` and `tests/unit/pmp-package.test.ts`. |
| `PMP certificate — A4 landscape-html/` | Certificate design | Reimplemented in `src/lib/certificates/pdf.ts` (pdf-lib) at 297 × 210 mm, using the supplied Talent Triangle artwork and icons unchanged. |

## 2. Files

| Path | In git? | Contents |
|---|---|---|
| `content/pmp-sps/manifest.json` | yes | 9 modules (stored as study domains; `weight` = module hours), 52 chapters (`1.1` … `9.4`, objectives = ECO task codes, `pages: null`) |
| `content/pmp-sps/content-register.csv` | yes | Per chapter: minutes by component (reading, lesson, example, activity, check), Talent Triangle category, ECO tasks, PMBOK references, approaches, example industry, check items, review status |
| `content/pmp-sps/coverage.csv` | yes | ECO task → chapters |
| `content/pmp-sps/access.json` | yes | Self enrollment, 7-day trial, 365 days, US$120 (mirrors ASP/CSP; **owner to confirm**) |
| `imports/pmp-sps/authoring/` | **no** | Source YAML (one file per module) and the PMBOK heading index |
| `imports/pmp-sps/chapters/<id>.json` | **no** | Generated lesson packages (content and answer keys) |
| `scripts/pmp-sps/build_package.py` | yes | Authoring YAML → manifest, registers and chapter JSON, with curriculum validation |

The repository is public, so lessons and answer keys exist only in `imports/` (git-ignored) and the database. A private copy was delivered to the owner's `PMP Exam Prep` folder.

### Chapter pattern
Each course section becomes one chapter with five study sections, which together account for the chapter's minutes:

1. **Lesson**: objectives (as the cover outcomes), explanation, original diagrams as safe SVG with a text equivalent, and a *Required reading* note with the PMBOK sections.
2. **Worked example**: one industry, labelled with its delivery approach. 52 examples span 29 industries; 6 now use oil and gas, after the rebalance for a non-energy audience.
3. **Practice activity**: a written response (`self_check`), saved, followed by a model answer.
4. **Recap**.
5. **Knowledge check**: scenario questions with a rationale, feedback for each wrong option, and an item ID and reference in the feedback for editorial review. Submitting counts toward completion and there is no pass mark. Retries are allowed.

Format conversions in 9.2 (practice exam), flagged for review: each *matching* item becomes one single-choice question per row; the *drop-down* item becomes a choice between completed statements; the *hotspot* becomes a single choice under the exhibit figure. The engine has no drag-and-drop or image-region questions.

## 3. Import

```bash
python3 scripts/pmp-sps/build_package.py                   # validate and regenerate (needs imports/pmp-sps/authoring)
npm run import:study -- --course pmp-sps --dry-run         # engine schema, safe SVG, activity keys
npm run import:study -- --course pmp-sps --batch 5         # loads version 1.0.0 as draft
```
Then, on `/admin/study`, review it with a pilot enrollment, publish it and make it the enrollment default. Run `supabase/migrations/20261121000100_study_certificates.sql` before learners can finish the course. The engine change in this PR allows `pages: null` for courses that are not drawn from a page-numbered study guide.

## 4. Certificates of course completion

**Rules**

- Generation unlocks only when the course is complete, meaning a `study_course_completions` row exists. That row is written from the canonical chapter rows when the last required chapter is finished.
- Generation also requires an active enrollment. The database checks all of this inside `study_claim_certificate`, using the learner's own session, on every request, whichever way it reaches the server.
- **One certificate per completion.** The certificate code (`IPL-PMP-XXXX-XXXX`) is created at the first attempt and never changes, even after a failed save. Concurrent or repeated clicks get `in_progress` or the already-issued certificate.
- **Stored before success.** The server renders the PDF and puts it at `certificates/<user id>/<code>.pdf` in the private `STUDY_GUIDES` R2 bucket. Only then does `service_finalize_study_certificate` (service role only) mark it issued, with its SHA-256 and size. If rendering or saving fails, the claim is released and the learner sees an actionable message and can retry immediately.
- **Immutable.** A trigger blocks changes to an issued certificate's name, code, file or dates, and blocks deleting it. The account-erasure cascade is the only exception. The name is the one the learner typed and confirmed, so a later profile rename changes nothing.
- **Downloads** return the stored PDF, never a re-render. `study_certificate_file` gives the storage key only to the owner or an admin, so any other account gets 404. Responses are `private, no-store`.
- **Names** are NFC-normalised, with whitespace collapsed and invisible characters removed. Allowed: letters and marks, single spaces, apostrophes, hyphens and full stops, 2 to 70 characters. Names are also checked against the certificate font's glyphs, so nothing prints as a blank box. A long name shrinks from 52 px to 34 px, then balances over two lines.
- The completion date is printed in UTC.

**Wording (owner decision, 21 Nov 2026):** the left panel reads **"Contact hours completed"**, and the body reads "…and completing 35 hours of project management training across the PMI Talent Triangle®". The Talent Triangle artwork is kept as supplied. The `study_certificate_programs.wording` value `pdu` would restore the template's PDU text, but don't use it unless iParkar Learning holds PMI ATP status.

**Turning certificates on for another course:** insert a row into `study_certificate_programs` (hours, categories, title, signatory) and set `certificate: true` in `courseProfile.ts`. The template is currently the PMP design.

| Piece | Where |
|---|---|
| Tables, RPCs, trigger, grants | `supabase/migrations/20261121000100_study_certificates.sql` |
| Renderer, name rules, assets | `src/lib/certificates/` (fonts and images bundled as base64 via `node scripts/gen-certificate-assets.mjs`, about 236 KB gzip) |
| Generate / download | `POST /api/certificates/generate`, `GET /api/certificates/[code]` |
| UI | Completion page panel (`Name on certificate`, `Confirm name`, **Generate Certificate**, then **Download Certificate**), `/certificates` page, and the *Certificates* link in the header |

## 5. Tests

- `tests/db/study-certificates.test.ts` (PGlite, real migrations) covers:
  - locked until the last chapter; not enrolled, revoked and anonymous requests refused;
  - four concurrent clicks produce one claim; forged tokens rejected; stored-then-issued ordering;
  - retry after a failed save keeps the same code;
  - server-side name validation, including accented and long names;
  - owner or admin downloads only; service-only finalize;
  - immutability and rename safety; no direct table access.
- `tests/unit/certificate.test.ts` covers:
  - one A4 landscape page and the issuer metadata;
  - long-name fitting and the name rules;
  - put-before-finalize ordering, release on save failure, no render for an incomplete course, and validation before any database call.

  Set `CERTIFICATE_PREVIEW_DIR` to write sample PDFs.
- `tests/unit/pmp-package.test.ts` covers:
  - module hours, the 2,100-minute category split and the ECO coverage;
  - schema validation of the private chapters, when present.

## 6. Open items for the owner

1. **Price and access period** for PMP-SPS (set to US$120 / 365 days like the other study courses). The iparkar.com catalogue (`site-config.js`, `build.mjs`) needs a PMP-SPS entry, and `NEXT_PUBLIC_CHECKOUT_URL_PMP_SPS` is optional.
2. **Talent Triangle artwork:** confirm your right to display it as a non-ATP, as noted in the course's flags-and-gaps document.
3. **Signatory line** "Imran Parkar, PMP, CSP / Course instructor, iParkar Learning": confirm it is current. It is in `study_certificate_programs`.
4. **Worker size:** the certificate assets add about 236 KB gzip, bringing the Worker to about 2.75 MB gzip. That is under the 3 MB Free-plan limit but close to it. On Workers Paid the limit is 10 MB.
5. Content review: chapters are `draft`. Approve them in the register before publishing.
