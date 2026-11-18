from typing import Annotated

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

import generator

app = FastAPI(title="AI Quiz Authoring")


class GenerateRequest(BaseModel):
    notes: Annotated[str, Field(strict=True, min_length=1, max_length=20000)]
    count: Annotated[int, Field(strict=True, ge=1, le=10)]

    @field_validator("notes")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("notes must not be blank")
        return value


@app.get("/health")
def health():
    return {"status": "ok", "model": generator.setting("AI_MODEL"), "configured": generator.configured()}


@app.post("/generate")
def generate(request: GenerateRequest):
    try:
        result, _ = generator.generate(request.notes, request.count)
    except generator.GenerationError as e:
        raise HTTPException(e.status, e.detail)
    return result
