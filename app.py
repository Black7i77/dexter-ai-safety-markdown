#!/usr/bin/env python3
"""Dexter AI Web

A local-first Flask website that streams real responses from Ollama.
The public website talks only to this backend; Ollama remains bound locally.
"""

from __future__ import annotations

import hmac
import io
import json
import os
import re
import threading
import time
import zipfile
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Any, Generator
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request, send_file, stream_with_context

load_dotenv()

APP_NAME = "Dexter AI"
CREATOR = "Scotty Pollock"
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
DEFAULT_MODEL = os.getenv("DEXTER_DEFAULT_MODEL", "llama3.2:latest")
HOST = os.getenv("DEXTER_HOST", "127.0.0.1")
PORT = int(os.getenv("DEXTER_PORT", "5050"))
TRUST_CLOUDFLARE = os.getenv("TRUST_CLOUDFLARE", "false").lower() in {"1", "true", "yes", "on"}
RATE_LIMIT_REQUESTS = max(1, int(os.getenv("RATE_LIMIT_REQUESTS", "20")))
RATE_LIMIT_WINDOW_SECONDS = max(10, int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "300")))
MAX_HISTORY_MESSAGES = max(4, int(os.getenv("MAX_HISTORY_MESSAGES", "32")))
MAX_MESSAGE_CHARS = max(500, int(os.getenv("MAX_MESSAGE_CHARS", "8000")))
MAX_TOTAL_CHARS = max(MAX_MESSAGE_CHARS, int(os.getenv("MAX_TOTAL_CHARS", "48000")))
OLLAMA_CONNECT_TIMEOUT = float(os.getenv("OLLAMA_CONNECT_TIMEOUT", "10"))
OLLAMA_READ_TIMEOUT = float(os.getenv("OLLAMA_READ_TIMEOUT", "600"))
PUBLIC_BETA = os.getenv("PUBLIC_BETA", "true").lower() in {"1", "true", "yes", "on"}
ENABLE_PUBLIC_CHAT = os.getenv("ENABLE_PUBLIC_CHAT", "true").lower() in {"1", "true", "yes", "on"}
BETA_ACCESS_CODE = os.getenv("BETA_ACCESS_CODE", "").strip()
MAX_CONCURRENT_GLOBAL = max(1, int(os.getenv("MAX_CONCURRENT_GLOBAL", "3")))
MAX_CONCURRENT_PER_IP = max(1, int(os.getenv("MAX_CONCURRENT_PER_IP", "1")))
MAX_EXPORT_FILES = max(1, min(100, int(os.getenv("MAX_EXPORT_FILES", "40"))))
MAX_EXPORT_CHARS = max(10000, min(2_000_000, int(os.getenv("MAX_EXPORT_CHARS", "500000"))))
ALLOWED_HOSTS = {host.strip().lower() for host in os.getenv("ALLOWED_HOSTS", "").split(",") if host.strip()}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024


BASE_SYSTEM_PROMPT = f"""You are Dexter AI, created by {CREATOR}.
You are a highly capable, thoughtful, and practical assistant for general questions, software engineering, Linux, troubleshooting, and defensive cybersecurity.

Core behaviour:
- Give accurate, direct answers and clearly separate confirmed facts from uncertainty.
- Think through the problem before answering, but present only the useful conclusion and concise reasoning.
- Prefer complete, working solutions over vague placeholders.
- When giving code, make it safe, readable, and usable with sensible error handling.
- Use clean Markdown headings, lists, emphasis, inline code, and fenced code blocks when they improve readability.
- In Build mode, when creating a multi-file project, put each file path in a Markdown heading immediately before its fenced code block, for example: ### `app.py`. This lets Dexter export the project as a ZIP.
- Never claim that an action, command, test, deployment, or result happened unless it actually did.
- Be respectful and approachable. Do not overwhelm the user with unnecessary jargon.

Safety and privacy rules:
- For cybersecurity, stay within legal, authorized, defensive, educational, or lab-only activity. Refuse harmful intrusion, credential theft, malware, ransomware creation, destructive exploitation, evasion, persistence, or spreading malicious code. Redirect toward safe defensive work.
- Defensive malware and ransomware guidance may cover detection, isolation, recovery, backups, incident response, and harmless simulations. Do not provide deployable malware or instructions that encrypt, destroy, steal, extort, evade security, or disable protections.
- In ransomware detection guidance, prioritize realistic behavioral indicators such as rapid mass file changes, ransom-note creation, suspicious backup deletion, unusual process behavior, abnormal authentication, and lateral movement. Do not claim that ordinary encryption use alone proves ransomware.
- Refuse instructions for bypassing paywalls, access controls, subscriptions, licensing, or other payment restrictions. Offer legitimate alternatives such as subscriptions, free trials, libraries, authorized copies, or contacting the publisher or author.
- Never tell a user to reveal or share a password, one-time verification code, MFA code, authenticator approval, password-reset code or link, backup code, recovery code, session cookie, private key, seed phrase, or API secret. There are no exceptions for a person claiming to be support, even when the user initiated contact or reached an official-looking channel.
- When someone requests an authentication secret, tell the user not to share it, not to approve unexpected prompts, to end that interaction, and to independently contact the organization through its official website or app.
- Do not treat a caller's name, department, reference number, video call, badge, or claimed identity as proof that sharing a secret is safe.
"""

MODE_PROMPTS: dict[str, str] = {
    "general": "Handle the request as a versatile general-purpose AI assistant.",
    "build": (
        "Act as a senior software engineer. Focus on architecture, complete implementation, "
        "maintainability, testing, and clear run instructions. Identify assumptions and failure modes."
    ),
    "debug": (
        "Act as a patient debugging specialist. Diagnose from evidence, explain the likely root cause, "
        "then provide the smallest reliable fix and a verification step. Do not invent logs or results."
    ),
    "linux": (
        "Act as an expert Linux assistant, especially for Debian and Kali-based systems. Prefer safe, "
        "copyable commands, explain destructive commands before using them, and preserve user data."
    ),
    "security": (
        "Act as a defensive security analyst. Support hardening, auditing, incident response, secure coding, "
        "CTFs, and authorized lab testing only. Keep guidance legal and non-destructive."
    ),
}

MODE_TEMPERATURES: dict[str, float] = {
    "general": 0.65,
    "build": 0.25,
    "debug": 0.15,
    "linux": 0.2,
    "security": 0.2,
}

LANGUAGE_EXTENSIONS: dict[str, str] = {
    "python": ".py", "py": ".py", "javascript": ".js", "js": ".js",
    "typescript": ".ts", "ts": ".ts", "html": ".html", "css": ".css",
    "json": ".json", "yaml": ".yml", "yml": ".yml", "bash": ".sh",
    "shell": ".sh", "sh": ".sh", "sql": ".sql", "rust": ".rs",
    "go": ".go", "java": ".java", "c": ".c", "cpp": ".cpp",
    "c++": ".cpp", "csharp": ".cs", "cs": ".cs", "markdown": ".md",
    "md": ".md", "text": ".txt", "txt": ".txt", "toml": ".toml",
    "ini": ".ini", "dockerfile": "", "xml": ".xml", "vue": ".vue",
    "jsx": ".jsx", "tsx": ".tsx", "php": ".php", "ruby": ".rb",
}


def safe_project_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip(".-_")
    return (cleaned[:64] or "dexter-project")


def safe_archive_path(value: str) -> str | None:
    value = value.strip().strip("`'\"").replace("\\", "/")
    value = re.sub(r"^[A-Za-z]:", "", value).lstrip("/")
    value = re.sub(r"[\x00-\x1f]", "", value)
    parts: list[str] = []
    for part in value.split("/"):
        part = part.strip()
        if not part or part == ".":
            continue
        if part == "..":
            return None
        part = re.sub(r"[<>:\"|?*]", "_", part)
        if part:
            parts.append(part[:100])
    if not parts:
        return None
    path = "/".join(parts)
    return path[:240]


def infer_filename(info: str, code: str, preceding: str, index: int) -> tuple[str, str]:
    info = info.strip()
    language = (info.split()[0].lower() if info else "text").strip()
    candidates: list[str] = []

    for pattern in (
        r"(?:filename|file|path)\s*=\s*[\"']?([^\s\"']+)",
        r"(?:filename|file|path)\s*:\s*[\"']?([^\s\"']+)",
    ):
        match = re.search(pattern, info, flags=re.IGNORECASE)
        if match:
            candidates.append(match.group(1))

    info_tokens = info.split()
    if len(info_tokens) >= 2:
        maybe_path = info_tokens[-1].strip("`'\"")
        if "/" in maybe_path or "." in maybe_path:
            candidates.append(maybe_path)
    elif info and ("/" in info or re.search(r"\.[A-Za-z0-9]{1,8}$", info)) and language not in LANGUAGE_EXTENSIONS:
        candidates.append(info)

    nearby_lines = [line.strip() for line in preceding.splitlines() if line.strip()]
    for line in reversed(nearby_lines[-4:]):
        line = re.sub(r"^#{1,6}\s*", "", line).strip()
        line = line.strip("* _")
        backtick = re.search(r"`([^`]+)`", line)
        if backtick:
            candidates.append(backtick.group(1))
        label = re.search(r"^(?:file|filename|path)\s*:\s*(.+)$", line, flags=re.IGNORECASE)
        if label:
            candidates.append(label.group(1).strip())
        if re.fullmatch(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*", line) and ("/" in line or "." in line):
            candidates.append(line)

    first_line, sep, rest = code.partition("\n")
    metadata_match = re.match(
        r"^\s*(?:#|//|;|--|<!--)?\s*(?:filename|file|path)\s*:\s*([^>]+?)(?:-->)?\s*$",
        first_line,
        flags=re.IGNORECASE,
    )
    cleaned_code = code
    if metadata_match:
        candidates.insert(0, metadata_match.group(1).strip())
        cleaned_code = rest if sep else ""

    for candidate in candidates:
        safe = safe_archive_path(candidate)
        if safe:
            return safe, cleaned_code

    if language == "dockerfile":
        return ("Dockerfile" if index == 1 else f"Dockerfile-{index}"), cleaned_code
    extension = LANGUAGE_EXTENSIONS.get(language, ".txt")
    stem = "project_structure" if language in {"markdown", "md"} and index == 1 else f"file_{index:02d}"
    return f"{stem}{extension}", cleaned_code


def extract_project_files(content: str) -> list[tuple[str, str]]:
    blocks = list(re.finditer(r"```([^\n`]*)\n(.*?)```", content, flags=re.DOTALL))
    files: list[tuple[str, str]] = []
    used: set[str] = {".dexter/response.md", ".dexter/manifest.json"}
    for index, match in enumerate(blocks[:MAX_EXPORT_FILES], start=1):
        code = match.group(2).replace("\r\n", "\n")
        preceding = content[max(0, match.start() - 500):match.start()]
        filename, code = infer_filename(match.group(1), code, preceding, index)
        base = filename
        duplicate = 2
        while filename.lower() in used:
            if "." in base.rsplit("/", 1)[-1]:
                root, ext = base.rsplit(".", 1)
                filename = f"{root}_{duplicate}.{ext}"
            else:
                filename = f"{base}_{duplicate}"
            duplicate += 1
        used.add(filename.lower())
        files.append((filename, code.rstrip() + "\n"))
    return files



@dataclass
class ModelCache:
    names: list[str]
    fetched_at: float


_model_cache = ModelCache(names=[], fetched_at=0.0)
_model_cache_lock = threading.Lock()
_rate_lock = threading.Lock()
_rate_buckets: dict[str, deque[float]] = defaultdict(deque)
_active_lock = threading.Lock()
_active_global = 0
_active_by_ip: dict[str, int] = defaultdict(int)


def client_ip() -> str:
    """Resolve a client address, trusting Cloudflare only when explicitly enabled."""
    if TRUST_CLOUDFLARE:
        cf_ip = request.headers.get("CF-Connecting-IP", "").strip()
        if cf_ip:
            return cf_ip
    return request.remote_addr or "unknown"


def rate_limit_exceeded(ip: str) -> tuple[bool, int]:
    now = time.monotonic()
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS
    with _rate_lock:
        bucket = _rate_buckets[ip]
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= RATE_LIMIT_REQUESTS:
            retry_after = max(1, int(RATE_LIMIT_WINDOW_SECONDS - (now - bucket[0])))
            return True, retry_after
        bucket.append(now)
        return False, 0


def supplied_access_code() -> str:
    return request.headers.get("X-Dexter-Access-Key", "").strip()


def access_allowed() -> bool:
    if not BETA_ACCESS_CODE:
        return True
    supplied = supplied_access_code()
    return bool(supplied) and hmac.compare_digest(supplied, BETA_ACCESS_CODE)


def same_origin_request() -> bool:
    origin = request.headers.get("Origin", "").strip()
    if not origin:
        return True
    try:
        origin_host = (urlparse(origin).netloc or "").lower()
    except ValueError:
        return False
    return origin_host == request.host.lower()


def acquire_generation_slot(ip: str) -> tuple[bool, str | None]:
    global _active_global
    with _active_lock:
        if _active_global >= MAX_CONCURRENT_GLOBAL:
            return False, "Dexter is busy with other requests. Please try again shortly."
        if _active_by_ip[ip] >= MAX_CONCURRENT_PER_IP:
            return False, "You already have a Dexter response generating."
        _active_global += 1
        _active_by_ip[ip] += 1
        return True, None


def release_generation_slot(ip: str) -> None:
    global _active_global
    with _active_lock:
        _active_global = max(0, _active_global - 1)
        if _active_by_ip[ip] <= 1:
            _active_by_ip.pop(ip, None)
        else:
            _active_by_ip[ip] -= 1


def fetch_models(force: bool = False) -> list[str]:
    now = time.monotonic()
    with _model_cache_lock:
        if not force and _model_cache.names and now - _model_cache.fetched_at < 15:
            return list(_model_cache.names)

    response = requests.get(
        f"{OLLAMA_BASE_URL}/api/tags",
        timeout=(OLLAMA_CONNECT_TIMEOUT, 20),
    )
    response.raise_for_status()
    data = response.json()
    names = sorted(
        {
            str(model.get("name", "")).strip()
            for model in data.get("models", [])
            if str(model.get("name", "")).strip()
        }
    )

    with _model_cache_lock:
        _model_cache.names = names
        _model_cache.fetched_at = now
    return names


def selected_default_model(models: list[str]) -> str | None:
    if DEFAULT_MODEL in models:
        return DEFAULT_MODEL
    base_default = DEFAULT_MODEL.split(":", 1)[0]
    for model in models:
        if model.split(":", 1)[0] == base_default:
            return model
    return models[0] if models else None


def validate_messages(raw_messages: Any) -> tuple[list[dict[str, str]] | None, str | None]:
    if not isinstance(raw_messages, list) or not raw_messages:
        return None, "A non-empty messages array is required."

    trimmed = raw_messages[-MAX_HISTORY_MESSAGES:]
    clean: list[dict[str, str]] = []
    total_chars = 0

    for item in trimmed:
        if not isinstance(item, dict):
            return None, "Every message must be an object."
        role = item.get("role")
        content = item.get("content")
        if role not in {"user", "assistant"}:
            return None, "Messages may only use the user or assistant role."
        if not isinstance(content, str):
            return None, "Message content must be text."
        content = content.strip()
        if not content:
            continue
        if len(content) > MAX_MESSAGE_CHARS:
            return None, f"A message exceeds the {MAX_MESSAGE_CHARS:,}-character limit."
        total_chars += len(content)
        if total_chars > MAX_TOTAL_CHARS:
            return None, f"Conversation context exceeds the {MAX_TOTAL_CHARS:,}-character limit."
        clean.append({"role": role, "content": content})

    if not clean or clean[-1]["role"] != "user":
        return None, "The final message must be from the user."
    return clean, None


def ndjson(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"


@app.before_request
def validate_public_request() -> Response | None:
    if ALLOWED_HOSTS and request.host.split(":", 1)[0].lower() not in ALLOWED_HOSTS:
        return jsonify({"ok": False, "error": "Host is not allowed."}), 421
    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and not same_origin_request():
        return jsonify({"ok": False, "error": "Cross-site request rejected."}), 403
    return None


@app.after_request
def security_headers(response: Response) -> Response:
    response.headers.pop("Server", None)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    )
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
    response.headers.setdefault("X-Permitted-Cross-Domain-Policies", "none")
    cf_visitor = request.headers.get("CF-Visitor", "") if TRUST_CLOUDFLARE else ""
    if request.is_secure or '"scheme":"https"' in cf_visitor.replace(" ", ""):
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
        "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; "
        "form-action 'self'; frame-ancestors 'self'",
    )
    return response


@app.get("/")
def index() -> str:
    return render_template(
        "index.html",
        app_name=APP_NAME,
        creator=CREATOR,
        default_model=DEFAULT_MODEL,
        public_beta=PUBLIC_BETA,
    )


@app.get("/privacy")
def privacy() -> str:
    return render_template("privacy.html", app_name=APP_NAME, creator=CREATOR, public_beta=PUBLIC_BETA)


@app.get("/terms")
def terms() -> str:
    return render_template("terms.html", app_name=APP_NAME, creator=CREATOR, public_beta=PUBLIC_BETA)


@app.get("/robots.txt")
def robots() -> Response:
    body = "User-agent: *\nDisallow: /\n" if PUBLIC_BETA else "User-agent: *\nAllow: /\n"
    return Response(body, content_type="text/plain; charset=utf-8")


@app.get("/api/config")
def public_config() -> Response:
    return jsonify(
        {
            "ok": True,
            "public_beta": PUBLIC_BETA,
            "chat_enabled": ENABLE_PUBLIC_CHAT,
            "access_required": bool(BETA_ACCESS_CODE),
            "rate_limit_requests": RATE_LIMIT_REQUESTS,
            "rate_limit_window_seconds": RATE_LIMIT_WINDOW_SECONDS,
            "max_concurrent_global": MAX_CONCURRENT_GLOBAL,
        }
    )


@app.post("/api/access")
def verify_access() -> Response:
    if not BETA_ACCESS_CODE:
        return jsonify({"ok": True, "access_required": False})
    if not access_allowed():
        return jsonify({"ok": False, "error": "That beta access code is not valid."}), 401
    return jsonify({"ok": True, "access_required": True})


@app.get("/api/health")
def health() -> Response:
    try:
        models = fetch_models(force=True)
        default = selected_default_model(models)
        return jsonify(
            {
                "ok": True,
                "ollama": "online",
                "models": models,
                "default_model": default,
                "app": APP_NAME,
            }
        )
    except requests.RequestException as exc:
        return (
            jsonify(
                {
                    "ok": False,
                    "ollama": "offline",
                    "models": [],
                    "default_model": None,
                    "error": "Dexter cannot reach Ollama on the configured local address.",
                    "detail": str(exc),
                }
            ),
            503,
        )


@app.get("/api/models")
def models() -> Response:
    try:
        names = fetch_models(force=True)
        return jsonify({"ok": True, "models": names, "default_model": selected_default_model(names)})
    except requests.RequestException as exc:
        return jsonify({"ok": False, "models": [], "error": str(exc)}), 503


@app.post("/api/export-project")
def export_project() -> Response:
    if not access_allowed():
        return jsonify({"ok": False, "error": "A valid beta access code is required."}), 401

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "A valid JSON request body is required."}), 400

    content = payload.get("content")
    if not isinstance(content, str) or not content.strip():
        return jsonify({"ok": False, "error": "There is no Dexter response to export."}), 400
    if len(content) > MAX_EXPORT_CHARS:
        return jsonify({"ok": False, "error": "That response is too large to export safely."}), 413

    project_name = safe_project_name(str(payload.get("project_name", "dexter-project")))
    files = extract_project_files(content)
    if not files:
        return jsonify({"ok": False, "error": "No fenced code blocks were found in this response."}), 400

    memory = io.BytesIO()
    with zipfile.ZipFile(memory, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr(
            ".dexter/response.md",
            f"# {project_name}\n\nExported from Dexter AI.\n\n## Original response\n\n{content.strip()}\n",
        )
        for filename, code in files:
            archive.writestr(filename, code)
        archive.writestr(
            ".dexter/manifest.json",
            json.dumps({"project": project_name, "files": [name for name, _ in files]}, indent=2),
        )

    memory.seek(0)
    return send_file(
        memory,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"{project_name}.zip",
        max_age=0,
    )


@app.post("/api/chat")
def chat() -> Response:
    if not ENABLE_PUBLIC_CHAT:
        return jsonify({"ok": False, "error": "Public chat is temporarily paused."}), 503
    if not access_allowed():
        return jsonify({"ok": False, "error": "A valid beta access code is required."}), 401

    ip = client_ip()
    exceeded, retry_after = rate_limit_exceeded(ip)
    if exceeded:
        response = jsonify(
            {
                "ok": False,
                "error": "Too many requests. Please wait before sending another message.",
            }
        )
        response.status_code = 429
        response.headers["Retry-After"] = str(retry_after)
        return response

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "A valid JSON request body is required."}), 400

    messages, error = validate_messages(payload.get("messages"))
    if error:
        return jsonify({"ok": False, "error": error}), 400
    assert messages is not None

    mode = str(payload.get("mode", "general")).strip().lower()
    if mode not in MODE_PROMPTS:
        return jsonify({"ok": False, "error": "Unknown Dexter mode."}), 400

    try:
        available_models = fetch_models()
    except requests.RequestException:
        available_models = []

    requested_model = str(payload.get("model", "")).strip()
    model = requested_model or selected_default_model(available_models)
    if not model:
        return jsonify({"ok": False, "error": "No Ollama model is installed or available."}), 503
    if available_models and model not in available_models:
        return jsonify({"ok": False, "error": "The selected model is not installed in Ollama."}), 400

    system_message = {
        "role": "system",
        "content": BASE_SYSTEM_PROMPT + "\nCurrent mode:\n" + MODE_PROMPTS[mode],
    }
    ollama_payload = {
        "model": model,
        "messages": [system_message, *messages],
        "stream": True,
        "options": {
            "temperature": MODE_TEMPERATURES[mode],
            "num_ctx": int(os.getenv("OLLAMA_NUM_CTX", "8192")),
        },
    }

    acquired, busy_message = acquire_generation_slot(ip)
    if not acquired:
        return jsonify({"ok": False, "error": busy_message}), 429

    @stream_with_context
    def generate() -> Generator[str, None, None]:
        upstream: requests.Response | None = None
        started = time.monotonic()
        token_chars = 0
        try:
            yield ndjson({"type": "meta", "model": model, "mode": mode})
            upstream = requests.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json=ollama_payload,
                stream=True,
                timeout=(OLLAMA_CONNECT_TIMEOUT, OLLAMA_READ_TIMEOUT),
            )
            if not upstream.ok:
                detail = upstream.text[:500].strip()
                yield ndjson(
                    {
                        "type": "error",
                        "message": f"Ollama returned HTTP {upstream.status_code}.",
                        "detail": detail,
                    }
                )
                return

            for raw_line in upstream.iter_lines(decode_unicode=True):
                if not raw_line:
                    continue
                try:
                    event = json.loads(raw_line)
                except json.JSONDecodeError:
                    continue

                if event.get("error"):
                    yield ndjson({"type": "error", "message": str(event["error"])})
                    return

                content = str(event.get("message", {}).get("content", ""))
                if content:
                    token_chars += len(content)
                    yield ndjson({"type": "token", "content": content})

                if event.get("done"):
                    yield ndjson(
                        {
                            "type": "done",
                            "model": event.get("model", model),
                            "elapsed_ms": int((time.monotonic() - started) * 1000),
                            "characters": token_chars,
                            "prompt_tokens": event.get("prompt_eval_count"),
                            "response_tokens": event.get("eval_count"),
                        }
                    )
                    return

            yield ndjson({"type": "done", "model": model, "elapsed_ms": int((time.monotonic() - started) * 1000)})
        except requests.Timeout:
            yield ndjson({"type": "error", "message": "Ollama took too long to respond."})
        except requests.ConnectionError:
            yield ndjson(
                {
                    "type": "error",
                    "message": "Dexter cannot connect to Ollama. Make sure Ollama is running.",
                }
            )
        except requests.RequestException as exc:
            yield ndjson({"type": "error", "message": "The Ollama request failed.", "detail": str(exc)})
        except GeneratorExit:
            return
        finally:
            if upstream is not None:
                upstream.close()
            release_generation_slot(ip)

    return Response(
        generate(),
        content_type="application/x-ndjson; charset=utf-8",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "X-Accel-Buffering": "no",
        },
    )


@app.errorhandler(413)
def too_large(_: Exception) -> tuple[Response, int]:
    return jsonify({"ok": False, "error": "Request body is too large."}), 413


@app.errorhandler(404)
def not_found(_: Exception) -> tuple[Response, int]:
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "API endpoint not found."}), 404
    return render_template(
        "index.html",
        app_name=APP_NAME,
        creator=CREATOR,
        default_model=DEFAULT_MODEL,
        public_beta=PUBLIC_BETA,
    ), 404


if __name__ == "__main__":
    print(f"{APP_NAME} — Created by {CREATOR}")
    print(f"Website: http://{HOST}:{PORT}")
    print(f"Ollama:  {OLLAMA_BASE_URL}")
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
