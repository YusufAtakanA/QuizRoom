# AI Quiz Authoring: evaluation (T07)

This page explains how the generated drafts from the AI Quiz Authoring service (`project/services/ai-quiz-authoring`) are evaluated, how to run the evaluation, how to review the output, and how to read the results.

## What is measured

| Metric | Source | Meaning |
|---|---|---|
| Structural validity | automatic (T06 checks) | Share of requested questions that passed every automatic check: required fields and types, at most `count` questions, non-empty text and explanation, four non-empty options that differ ignoring case and surrounding spaces, `correctIndex` an integer 0–3, and a `sourceExcerpt` that appears in the notes (whitespace collapsed). Missing questions and failed calls count as invalid. |
| Correctness | human review | Share of reviewed, structurally valid questions whose proposed answer is actually right. |
| Support from the notes | human review | Share of reviewed, structurally valid questions that can be answered from the notes alone, with an excerpt that really backs the answer. |
| Needs edit or rejection | human review | Share of reviewed questions the reviewer would edit or reject. Printed twice: among reviewed valid questions, and among all requested questions (structural rejects added). |
| Generation time | automatic | Duration of each generation call: median and maximum. |

Every run records the model id, prompt version, effort level, `max_tokens` and requested count, so results from different configurations can be compared.

**Passing the automatic checks is not proof that a question is correct.** The checks only confirm the shape of the output and that the excerpt is copied from the notes. The proposed answer can still be wrong, the excerpt can be unrelated to the question, or the question can be ambiguous. That is why every generated question is saved as `DRAFT` and the host must review and approve it before it can be played, and why correctness and support are measured by a human here.

## Method

- **Fixed inputs:** five original study notes in `project/services/ai-quiz-authoring/eval/notes/` (photosynthesis, HTTP basics, supply and demand, Newton's laws, the French Revolution), 300–600 words each. Do not change them between runs you want to compare; add new files instead and mention it in the comparison.
- **Same code path as production:** `evaluate.py` calls the same `generator.generate` function the `/generate` endpoint uses (same prompt, schema, model call, and validation), in-process, not over HTTP.
- **Configuration:** model, effort, timeout and retries come from the same environment variables as the service (`AI_MODEL`, `AI_EFFORT`, `AI_TIMEOUT_SECONDS`, `AI_MAX_RETRIES`). The prompt version is the `PROMPT_VERSION` constant in `generator.py`; change it whenever the prompt or schema changes.
- **Repetition:** use `--runs N` to call the model several times per note, which shows how stable validity and timing are.

## How to run

```bash
cd project/services/ai-quiz-authoring
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt -r requirements-dev.txt   # Linux/macOS: .venv/bin/python
cp .env.example .env    # then put your own ANTHROPIC_API_KEY in .env (never commit it)

.venv/Scripts/python evaluate.py --count 5 --runs 1          # prints how many API calls it would make, then stops
.venv/Scripts/python evaluate.py --count 5 --runs 1 --yes    # actually runs them (billed)
```

The script refuses to run without `ANTHROPIC_API_KEY`, and always prints the number of API calls (notes × runs, plus up to `AI_MAX_RETRIES` retries each) before it spends anything. Without `--yes` it stops there.

Output goes to `eval/results/<UTC timestamp>/`:

- `results.json`: model id, prompt version, effort, `max_tokens`, count, runs, and for every call the note, duration, number of valid and rejected questions, the rejection reasons, and the raw questions returned by the model (or the error if the call failed).
- `review.csv`: one row per requested question, ready for a human reviewer.

## How to fill in review.csv

Open the file in a spreadsheet. The first columns (`run`, `note`, `index`, `question`, `options`, `proposed_answer`, `explanation`, `source_excerpt`, `structurally_valid`) are filled in by the script. Rows with `structurally_valid = n` were rejected automatically; their reason is in `comment`, and you do not need to review them.

For every row with `structurally_valid = y`, read the question next to the matching notes file and fill in:

| Column | Value | Rule |
|---|---|---|
| `correct` | `y` / `n` | Is `proposed_answer` the right answer to `question`? |
| `supported_by_notes` | `y` / `n` | Can the question be answered from the notes alone, and does `source_excerpt` back the answer? Answer `n` if it needs outside knowledge. |
| `action` | `keep` / `edit` / `reject` | What a host would do: `keep` as is, `edit` if a small fix makes it usable (wording, a weak distractor, a slightly wrong explanation), `reject` if it is wrong, unsupported, ambiguous or trivial. |
| `comment` | free text | Why you chose `edit` or `reject`. |

Leave a cell empty if you have not reviewed that row; empty cells are left out of the rates. Keep the file as CSV (UTF-8) when saving.

Then print the summary:

```bash
.venv/Scripts/python evaluate.py --summarize eval/results/<timestamp>/review.csv
```

It reads `results.json` from the same folder for the timing and configuration.

## How to interpret the results

- **Structural validity** below 100% means the model ignored part of the format or copied the excerpt inaccurately. Look at the reasons in `comment` / `results.json`; a frequent excerpt failure usually means the prompt needs to stress copying verbatim.
- **Correctness** and **support from the notes** are the numbers that matter for quality. A question can be correct but unsupported (the model used outside knowledge), which still counts as a problem because hosts expect questions about their own notes.
- **Needs edit or rejection** estimates how much host work the drafts save. A high share means the host still rewrites most questions.
- **Generation time** must stay well under the Question Library's 120 s timeout. The service limits each provider call to `AI_TIMEOUT_SECONDS` (45 s) and makes at most `AI_MAX_RETRIES` (1) retry itself, only after a timeout, connection error or 5xx, after a 1 s pause, and only while the whole request still fits in 100 s. A rate limit (429) returns 503 at once, whatever its Retry-After header says. A maximum close to the limit means some real requests will end in 504.
- Only compare runs with the same notes and count. When the model id, effort or prompt version differs, say so next to the numbers. With 25 questions per run, a difference of one or two questions is noise; use `--runs` or more notes before drawing conclusions.
