import argparse
import csv
import json
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

import generator

HERE = Path(__file__).resolve().parent
COLUMNS = ["run", "note", "index", "question", "options", "proposed_answer", "explanation", "source_excerpt",
           "structurally_valid", "correct", "supported_by_notes", "action", "comment"]


def review_rows(run, note, count, item):
    if item["status"] != "ok":
        return [{"run": run, "note": note, "index": index, "structurally_valid": "n",
                 "comment": f"generation failed: {item['error']}"} for index in range(count)]
    invalid = {r["index"]: r["reason"] for r in item["rejected"]}
    rows = []
    for index, q in enumerate(item["raw"][:count]):
        q = q if isinstance(q, dict) else {}
        options = q.get("options") if isinstance(q.get("options"), list) else []
        answer = q.get("correctIndex")
        proposed = options[answer] if type(answer) is int and 0 <= answer < len(options) else ""
        rows.append({
            "run": run, "note": note, "index": index, "question": q.get("text", ""),
            "options": " | ".join(map(str, options)), "proposed_answer": proposed,
            "explanation": q.get("explanation", ""), "source_excerpt": q.get("sourceExcerpt", ""),
            "structurally_valid": "n" if index in invalid else "y", "comment": invalid.get(index, ""),
        })
    for index in range(len(item["raw"]), count):
        rows.append({"run": run, "note": note, "index": index, "structurally_valid": "n",
                     "comment": "missing: model returned fewer questions than requested"})
    return rows


def run_generation(args):
    notes_files = sorted(Path(args.notes_dir).glob("*.md"))
    calls = len(notes_files) * args.runs
    print(f"About to make {calls} API calls ({len(notes_files)} notes x {args.runs} runs, count={args.count}, "
          f"model={generator.setting('AI_MODEL')}, effort={generator.setting('AI_EFFORT')}, "
          f"up to {generator.setting('AI_MAX_RETRIES')} retries each).")
    if not generator.configured():
        print("ANTHROPIC_API_KEY is not set; refusing to run generation.", file=sys.stderr)
        return 2
    if not args.yes:
        print("These calls are billed. Re-run with --yes to proceed.", file=sys.stderr)
        return 1
    out = Path(args.out) / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out.mkdir(parents=True)
    items, rows = [], []
    for run in range(1, args.runs + 1):
        for path in notes_files:
            notes = path.read_text(encoding="utf-8")
            started = time.perf_counter()
            try:
                result, raw = generator.generate(notes, args.count)
                item = {"status": "ok", "model": result["model"], "durationMs": result["durationMs"],
                        "validCount": len(result["questions"]), "rejectedCount": len(result["rejected"]),
                        "rejected": result["rejected"], "raw": raw}
            except generator.GenerationError as e:
                item = {"status": "error", "error": f"{e.status} {e.detail}",
                        "durationMs": round((time.perf_counter() - started) * 1000),
                        "validCount": 0, "rejectedCount": 0, "rejected": [], "raw": []}
            item = {"run": run, "note": path.name, **item}
            items.append(item)
            rows += review_rows(run, path.name, args.count, item)
            print(f"run {run} {path.name}: {item['status']} valid={item['validCount']} ({item['durationMs']} ms)")
    results = {"model": generator.setting("AI_MODEL"), "promptVersion": generator.PROMPT_VERSION,
               "effort": generator.setting("AI_EFFORT"), "maxTokens": generator.MAX_TOKENS,
               "count": args.count, "runs": args.runs, "items": items}
    (out / "results.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    with open(out / "review.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {out}")
    return 0


def rate(hits, total):
    return f"{hits}/{total} = {hits / total:.0%}" if total else "n/a (nothing reviewed yet)"


def summarize(csv_path):
    csv_path = Path(csv_path)
    with open(csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    flag = lambda row, col: row.get(col, "").strip().lower()[:1]
    valid = [r for r in rows if flag(r, "structurally_valid") == "y"]
    correct = [flag(r, "correct") for r in valid if flag(r, "correct") in ("y", "n")]
    supported = [flag(r, "supported_by_notes") for r in valid if flag(r, "supported_by_notes") in ("y", "n")]
    actions = [r.get("action", "").strip().lower() for r in valid if r.get("action", "").strip()]
    needs_work = sum(a in ("edit", "reject") for a in actions)
    results = json.loads((csv_path.parent / "results.json").read_text(encoding="utf-8"))
    durations = [item["durationMs"] for item in results["items"]]
    summary = {
        "structural_validity": (len(valid), len(rows)),
        "correctness": (correct.count("y"), len(correct)),
        "supported_by_notes": (supported.count("y"), len(supported)),
        "needs_edit_or_reject": (needs_work, len(actions)),
        "needs_edit_or_reject_incl_invalid": (needs_work + len(rows) - len(valid), len(rows)),
        "duration_median_ms": statistics.median(durations) if durations else None,
        "duration_max_ms": max(durations) if durations else None,
    }
    print(f"Model: {results['model']}  prompt: {results['promptVersion']}  effort: {results['effort']}  "
          f"count: {results['count']}  runs: {results['runs']}")
    print(f"Structural validity:          {rate(*summary['structural_validity'])}")
    print(f"Correct (human-reviewed):     {rate(*summary['correctness'])}")
    print(f"Supported by notes (human):   {rate(*summary['supported_by_notes'])}")
    print(f"Needs edit or rejection:      {rate(*summary['needs_edit_or_reject'])} of reviewed valid questions")
    print(f"  incl. structural rejects:   {rate(*summary['needs_edit_or_reject_incl_invalid'])} of all questions")
    print(f"Generation time per call:     median {summary['duration_median_ms']} ms, max {summary['duration_max_ms']} ms")
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description="Evaluate AI quiz generation on the fixed sample notes (T07).")
    parser.add_argument("--count", type=int, default=5, choices=range(1, 11), metavar="1..10")
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--yes", action="store_true", help="confirm the billed API calls")
    parser.add_argument("--notes-dir", default=str(HERE / "eval" / "notes"))
    parser.add_argument("--out", default=str(HERE / "eval" / "results"))
    parser.add_argument("--summarize", metavar="REVIEW_CSV")
    args = parser.parse_args(argv)
    if args.summarize:
        summarize(args.summarize)
        return 0
    load_dotenv(HERE / ".env")
    return run_generation(args)


if __name__ == "__main__":
    sys.exit(main())
