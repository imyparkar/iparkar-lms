# ASP study course: content pipeline

Turns the iParkar ASP Exam Study Guide PDF into lesson packages for `npm run import:study`.

| Step | Script | Output |
|---|---|---|
| Curriculum manifest | `../build_manifest.py`, `../pagemap.py` | `content/asp-sps/manifest.json` (public: titles, objectives, page ranges) |
| Layout extraction | `extract.py` | tables (from header fills and row rules), worked-example rows, callouts, two-column end matter, super/subscripts |
| Chapter assembly | `convert.py <id>` / `runall.py <domain>` | `imports/asp-sps/chapters/<id>.json` (git-ignored) |
| Equation crops for transcription | `eqcrops.py <domain>` | PNG sheets of each equation as printed |
| Review digest | `digest.py <id> …` | summary, errors, terms and worked-example answers per chapter |

Hand-written inputs live in `imports/asp-sps/authoring/` (git-ignored, because this repo is public):
`overlays/<id>.json` holds the transcribed TeX for each equation (`equations`), the original
knowledge-check questions (`kc`), optional Try-it overrides (`tryit`) and text fixes (`fixes`);
`eq_*.py` and `kc_*.py` are the editable sources that write those overlays (via `kclib.py`).
Chapter 1.1 is hand-authored (`ch_1_1.py`) and is not regenerated.

Environment: `ASP_GUIDE_PDF` (the guide PDF), `ASP_GUIDE_TEXT` (its extracted text, used for
hyphenation vocabulary), `LMS_ROOT` (repo root), `ASP_OVERLAYS`. Requires `pdfplumber` and `Pillow`.

Every converted chapter records `meta.checks.flags`: layout cases the converter handled
heuristically (tables named from their header, drawing labels dropped, worked examples without a
separate Answer row). They are review prompts for the subject-matter reviewer, not errors.
