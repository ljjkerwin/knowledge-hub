#!/usr/bin/env python3
"""Generate a Ragas RAG test set from local Markdown or text files.

The script deliberately keeps the source test set in Ragas' schema, then can
optionally write a second JSONL file in this repository's evaluation-runner
schema.  The source file contains ``reference_contexts`` for Ragas metrics;
the runner file keeps the generated reference answer for the existing Node.js
evaluation runner.

Example:
    OPENAI_API_KEY=... python evaluation/generate_ragas_dataset.py \
      --input ../test-files/parenting-ecommerce \
      --size 30 \
      --output evaluation/generated/parenting-ragas.jsonl \
      --runner-output evaluation/generated/parenting-runner.jsonl
"""

from __future__ import annotations

import argparse
import hashlib
import inspect
import json
import os
import sys
from pathlib import Path
from typing import Any, Iterable

from dotenv import load_dotenv
from langchain_core.documents import Document
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from ragas.testset import TestsetGenerator


SUPPORTED_SUFFIXES = {".md", ".markdown", ".txt"}
BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
DEFAULT_CONTEXT = (
    "这是一个中文知识库。生成简体中文的真实用户问题与参考答案；"
    "所有答案只能基于给定资料，不能编造资料之外的事实。"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Use Ragas to generate a RAG evaluation dataset from local files."
    )
    parser.add_argument(
        "--input",
        type=Path,
        required=True,
        help="A Markdown/text file or a directory scanned recursively.",
    )
    parser.add_argument("--size", type=int, default=30, help="Number of cases to generate.")
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Output Ragas-schema JSONL path.",
    )
    parser.add_argument(
        "--runner-output",
        type=Path,
        help="Optional JSONL compatible with backend/evaluation/run-dataset.mjs.",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("OPENAI_MODEL_NAME", "gpt-4.1-mini"),
        help="Generator LLM model (default: OPENAI_MODEL_NAME).",
    )
    parser.add_argument(
        "--llm-base-url",
        default=os.environ.get("OPENAI_BASE_URL"),
        help="Generator LLM base URL (default: OPENAI_BASE_URL).",
    )
    parser.add_argument(
        "--llm-api-key-env",
        default="OPENAI_API_KEY",
        help="Environment variable holding the generator LLM API key.",
    )
    parser.add_argument(
        "--embedding-model",
        default=os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small"),
        help="Embedding model (default: EMBEDDING_MODEL).",
    )
    parser.add_argument(
        "--embedding-base-url",
        default=os.environ.get("EMBEDDING_BASE_URL"),
        help="Embedding base URL (default: EMBEDDING_BASE_URL).",
    )
    parser.add_argument(
        "--embedding-api-key-env",
        default="EMBEDDING_API_KEY",
        help="Environment variable holding the embedding model API key.",
    )
    parser.add_argument("--split", choices=("smoke", "dev", "test"), default="test")
    parser.add_argument(
        "--llm-context",
        default=DEFAULT_CONTEXT,
        help="Extra domain/language constraints passed to the generator LLM.",
    )
    return parser.parse_args()


def input_files(input_path: Path) -> list[Path]:
    if input_path.is_file():
        if input_path.suffix.lower() not in SUPPORTED_SUFFIXES:
            raise ValueError(
                f"Unsupported input type: {input_path.suffix}. "
                f"Supported types: {', '.join(sorted(SUPPORTED_SUFFIXES))}"
            )
        return [input_path]

    if not input_path.is_dir():
        raise ValueError(f"Input path does not exist: {input_path}")

    files = sorted(
        path
        for path in input_path.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
    )
    if not files:
        raise ValueError(f"No Markdown/text files found below: {input_path}")
    return files


def load_documents(input_path: Path) -> list[Document]:
    """Load source files while preserving stable document-level metadata."""
    documents: list[Document] = []
    for path in input_files(input_path):
        content = path.read_text(encoding="utf-8").strip()
        if not content:
            print(f"Skipping empty file: {path}", file=sys.stderr)
            continue

        try:
            relative_path = path.relative_to(input_path.parent)
        except ValueError:
            relative_path = path
        document_id = hashlib.sha256(str(relative_path).encode("utf-8")).hexdigest()
        documents.append(
            Document(
                page_content=content,
                metadata={
                    "source": str(path),
                    "document_id": document_id,
                    "document_title": path.stem,
                },
            )
        )
    if not documents:
        raise ValueError("All source files were empty.")
    return documents


def json_default(value: Any) -> Any:
    """Serialize occasional pandas/numpy scalar values without losing text."""
    item = getattr(value, "item", None)
    if callable(item):
        return item()
    return str(value)


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        for row in rows:
            file.write(json.dumps(row, ensure_ascii=False, default=json_default))
            file.write("\n")


def api_key_from_env(
    env_name: str, service_name: str, fallback_env_name: str | None = None
) -> str:
    api_key = os.environ.get(env_name) or (
        os.environ.get(fallback_env_name) if fallback_env_name else None
    )
    if not api_key:
        fallback_hint = f" (or {fallback_env_name})" if fallback_env_name else ""
        raise ValueError(f"{env_name}{fallback_hint} must be set for the {service_name}")
    return api_key


def ragas_rows(testset: Any) -> list[dict[str, Any]]:
    rows = testset.to_pandas().to_dict(orient="records")
    return [
        {
            "id": f"ragas-{index:04d}",
            "user_input": row["user_input"],
            "reference": row["reference"],
            "reference_contexts": row.get("reference_contexts", []),
            "synthesizer_name": row.get("synthesizer_name"),
        }
        for index, row in enumerate(rows, start=1)
    ]


def runner_rows(rows: Iterable[dict[str, Any]], split: str) -> list[dict[str, Any]]:
    """Adapt the synthetic cases to the repository's existing Node.js runner."""
    output: list[dict[str, Any]] = []
    for row in rows:
        output.append(
            {
                "id": row["id"],
                "input": {"question": row["user_input"], "context": {"history": []}},
                "expected": {
                    "route": "rag",
                    "mustCite": True,
                    "referenceAnswer": row["reference"],
                },
                "metadata": {
                    "category": row.get("synthesizer_name") or "ragas-generated",
                    "difficulty": "medium",
                    "split": split,
                    "source": "ragas",
                    # Kept here so the runner accepts the file while downstream
                    # Ragas evaluation can retain its oracle contexts.
                    "referenceContexts": row.get("reference_contexts", []),
                },
            }
        )
    return output


def main() -> int:
    # This is intentionally before argparse: .env values provide argument defaults.
    # Existing shell environment values take precedence over the file.
    load_dotenv(BACKEND_DIRECTORY / ".env")
    load_dotenv()
    args = parse_args()
    if args.size < 1:
        raise ValueError("--size must be at least 1")
    llm_api_key = api_key_from_env(args.llm_api_key_env, "generator LLM")
    embedding_api_key = api_key_from_env(
        args.embedding_api_key_env, "embedding model", "OPENAI_API_KEY"
    )

    docs = load_documents(args.input.resolve())
    print(f"Loaded {len(docs)} source document(s); generating {args.size} test case(s)...")

    llm = ChatOpenAI(
        model=args.model,
        temperature=0,
        api_key=llm_api_key,
        base_url=args.llm_base_url,
    )
    embeddings = OpenAIEmbeddings(
        model=args.embedding_model,
        api_key=embedding_api_key,
        base_url=args.embedding_base_url,
        # LangChain otherwise tokenizes text into integer IDs before calling
        # /embeddings. Many OpenAI-compatible local BGE services only accept
        # an array of strings and reject those IDs with HTTP 422.
        check_embedding_ctx_length=False,
    )
    generator_options = {"llm": llm, "embedding_model": embeddings}
    # Ragas 0.3.x does not accept llm_context; keeping this conditional makes
    # the script forward-compatible once the 0.4.x import regression is fixed.
    if "llm_context" in inspect.signature(TestsetGenerator.from_langchain).parameters:
        generator_options["llm_context"] = args.llm_context
    generator = TestsetGenerator.from_langchain(**generator_options)
    testset = generator.generate_with_langchain_docs(
        documents=docs,
        testset_size=args.size,
    )

    generated = ragas_rows(testset)
    write_jsonl(args.output, generated)
    print(f"Wrote {len(generated)} Ragas case(s) to {args.output}")

    if args.runner_output:
        write_jsonl(args.runner_output, runner_rows(generated, args.split))
        print(f"Wrote Node runner dataset to {args.runner_output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(2) from error
