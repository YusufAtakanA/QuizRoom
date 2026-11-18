import re

TEXT_FIELDS = ("text", "explanation", "sourceExcerpt")
FIELDS = ("text", "options", "correctIndex", "explanation", "sourceExcerpt")
MAX_LENGTHS = {"text": 1000, "explanation": 2000, "sourceExcerpt": 2000}


def collapse_spaces(s):
    return re.sub(r"[ \t\n\x0b\f\r]+", " ", s).strip()


def problem(q, notes):
    if not isinstance(q, dict):
        return "Question is not a JSON object"
    for name in FIELDS:
        if name not in q:
            return f"Missing field: {name}"
    for name in TEXT_FIELDS:
        if not isinstance(q[name], str):
            return f"{name} must be a string"
    options = q["options"]
    if not isinstance(options, list) or not all(isinstance(o, str) for o in options):
        return "options must be a list of strings"
    if type(q["correctIndex"]) is not int:
        return "correctIndex must be an integer"
    if not q["text"].strip():
        return "Question text is empty"
    if len(options) != 4:
        return f"Expected exactly 4 options, got {len(options)}"
    if any(not o.strip() for o in options):
        return "Options must not be empty"
    if any(len(o) > 255 for o in options):
        return "Options must be at most 255 characters"
    if len({o.strip().lower() for o in options}) != 4:
        return "Options must be distinct (ignoring case and surrounding whitespace)"
    if not 0 <= q["correctIndex"] <= 3:
        return "correctIndex must be between 0 and 3"
    if not q["explanation"].strip():
        return "Explanation is empty"
    if not q["sourceExcerpt"].strip():
        return "sourceExcerpt is empty"
    for name, limit in MAX_LENGTHS.items():
        if len(q[name]) > limit:
            return f"{name} is longer than {limit} characters"
    if collapse_spaces(q["sourceExcerpt"]) not in collapse_spaces(notes):
        return "sourceExcerpt is not found in the notes"
    return None


def validate(items, notes, count):
    questions, rejected = [], []
    for index, q in enumerate(items):
        reason = "Extra question beyond the requested count" if index >= count else problem(q, notes)
        if reason:
            rejected.append({"index": index, "reason": reason})
        else:
            questions.append({name: q[name] for name in FIELDS})
    if len(items) < count:
        rejected.append({"index": None, "reason": f"Model returned {len(items)} of {count} requested questions"})
    return questions, rejected
