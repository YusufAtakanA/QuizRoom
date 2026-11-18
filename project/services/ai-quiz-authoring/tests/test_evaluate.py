import csv
import json

import evaluate
import generator

ROWS = [
    {"run": 1, "note": "a.md", "index": 0, "structurally_valid": "y", "correct": "y", "supported_by_notes": "y", "action": "keep"},
    {"run": 1, "note": "a.md", "index": 1, "structurally_valid": "y", "correct": "n", "supported_by_notes": "y", "action": "reject"},
    {"run": 1, "note": "b.md", "index": 0, "structurally_valid": "y", "correct": "y", "supported_by_notes": "n", "action": "edit"},
    {"run": 1, "note": "b.md", "index": 1, "structurally_valid": "y", "correct": "Y", "supported_by_notes": "y", "action": "keep"},
    {"run": 1, "note": "b.md", "index": 2, "structurally_valid": "n", "comment": "sourceExcerpt is not found in the notes"},
]


def test_summarize_computes_metrics(tmp_path, capsys):
    with open(tmp_path / "review.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=evaluate.COLUMNS)
        writer.writeheader()
        writer.writerows(ROWS)
    results = {"model": "claude-opus-5-5", "promptVersion": "quiz-gen-v1", "effort": "medium", "count": 3, "runs": 1,
               "items": [{"durationMs": d} for d in (1000, 5000, 2000, 4000, 3000)]}
    (tmp_path / "results.json").write_text(json.dumps(results), encoding="utf-8")

    summary = evaluate.summarize(tmp_path / "review.csv")

    assert summary["structural_validity"] == (4, 5)
    assert summary["correctness"] == (3, 4)
    assert summary["supported_by_notes"] == (3, 4)
    assert summary["needs_edit_or_reject"] == (2, 4)
    assert summary["needs_edit_or_reject_incl_invalid"] == (3, 5)
    assert summary["duration_median_ms"] == 3000
    assert summary["duration_max_ms"] == 5000
    out = capsys.readouterr().out
    assert "claude-opus-5-5" in out and "quiz-gen-v1" in out and "80%" in out


def test_generation_refuses_without_key(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(evaluate, "load_dotenv", lambda *a, **k: None)
    monkeypatch.setattr(generator, "generate", lambda *a: (_ for _ in ()).throw(AssertionError("called")))
    assert evaluate.main(["--yes", "--out", str(tmp_path)]) == 2
    assert list(tmp_path.iterdir()) == []


def test_generation_requires_yes(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")
    monkeypatch.setattr(evaluate, "load_dotenv", lambda *a, **k: None)
    monkeypatch.setattr(generator, "generate", lambda *a: (_ for _ in ()).throw(AssertionError("called")))
    assert evaluate.main(["--runs", "2", "--out", str(tmp_path)]) == 1
    assert "About to make 10 API calls" in capsys.readouterr().out
    assert list(tmp_path.iterdir()) == []


def test_generation_writes_results_and_review(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")
    monkeypatch.setattr(evaluate, "load_dotenv", lambda *a, **k: None)
    raw = [{"text": "Q?", "options": ["A", "B", "C", "D"], "correctIndex": 1, "explanation": "E", "sourceExcerpt": "S"}, "junk"]
    result = {"model": "claude-opus-5-5", "durationMs": 1234, "questions": [raw[0]],
              "rejected": [{"index": 1, "reason": "Question is not a JSON object"}, {"index": None, "reason": "short"}]}
    monkeypatch.setattr(generator, "generate", lambda notes, count: (result, raw))
    assert evaluate.main(["--yes", "--count", "3", "--out", str(tmp_path)]) == 0
    [run_dir] = tmp_path.iterdir()
    results = json.loads((run_dir / "results.json").read_text(encoding="utf-8"))
    assert results["promptVersion"] == generator.PROMPT_VERSION and len(results["items"]) == 5
    with open(run_dir / "review.csv", newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 15
    assert [r["structurally_valid"] for r in rows[:3]] == ["y", "n", "n"]
    assert rows[0]["proposed_answer"] == "B"


def test_review_rows_skip_extra_questions():
    q = {"text": "Q?", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanation": "E", "sourceExcerpt": "S"}
    item = {"status": "ok", "raw": [q, q, q], "rejected": [{"index": 2, "reason": "Extra question beyond the requested count"}]}
    rows = evaluate.review_rows(1, "a.md", 2, item)
    assert [r["structurally_valid"] for r in rows] == ["y", "y"]
