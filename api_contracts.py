"""Runtime API contract validation for SmartNotes HTTP endpoints."""

API_SCHEMA_VERSION = "v1"


class ContractValidationError(Exception):
    def __init__(self, message, details=None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


def _require_object(payload, field_name="body"):
    if not isinstance(payload, dict):
        raise ContractValidationError(f"Invalid {field_name}: expected JSON object")


def _require_non_empty_string(payload, key):
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ContractValidationError(f"Missing required field: {key}")
    return value


def _require_optional_bool(payload, key):
    if key in payload and not isinstance(payload.get(key), bool):
        raise ContractValidationError(f"Invalid field type: {key} must be boolean")


def _validate_messages(payload):
    messages = payload.get("messages")
    if not isinstance(messages, list) or len(messages) == 0:
        raise ContractValidationError("Missing required field: messages[]")
    for idx, item in enumerate(messages):
        if not isinstance(item, dict):
            raise ContractValidationError(f"Invalid messages[{idx}]: expected object")
        role = item.get("role")
        if not isinstance(role, str) or not role.strip():
            raise ContractValidationError(f"Invalid messages[{idx}].role")
        if "content" not in item:
            raise ContractValidationError(f"Missing messages[{idx}].content")


def _validate_notes(payload):
    notes = payload.get("notes")
    if not isinstance(notes, list):
        raise ContractValidationError("Missing required field: notes[]")


def validate_api_request(method, path, payload):
    """Validate incoming request payload for known API endpoints."""
    if method != "POST":
        return payload

    _require_object(payload)

    if path == "/api/generate":
        _require_non_empty_string(payload, "prompt")
        _require_optional_bool(payload, "stream")
        return payload

    if path == "/api/chat":
        _validate_messages(payload)
        _require_optional_bool(payload, "stream")
        return payload

    if path == "/api/embeddings":
        prompt = payload.get("prompt") or payload.get("input")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ContractValidationError("Missing required field: prompt")
        return payload

    if path == "/api/model":
        _require_non_empty_string(payload, "model")
        return payload

    if path == "/api/file-notes/sync":
        _validate_notes(payload)
        return payload

    return payload


def validate_api_response(path, payload, status=200):
    """Validate known response envelopes for local API handlers."""
    if not isinstance(payload, dict):
        return

    if status >= 400:
        if "error" not in payload:
            raise ContractValidationError("Error responses must include 'error'")
        return

    if path == "/api/default-model":
        model = payload.get("model")
        if not isinstance(model, str) or not model.strip():
            raise ContractValidationError("Invalid response: model")
        if not isinstance(payload.get("source"), str):
            raise ContractValidationError("Invalid response: source")
        return

    if path == "/api/model":
        if not isinstance(payload.get("ok"), bool):
            raise ContractValidationError("Invalid response: ok")
        model = payload.get("model")
        if not isinstance(model, str) or not model.strip():
            raise ContractValidationError("Invalid response: model")
        return

    if path == "/api/file-notes/load":
        if not isinstance(payload.get("notes"), list):
            raise ContractValidationError("Invalid response: notes")
        if not isinstance(payload.get("count"), int):
            raise ContractValidationError("Invalid response: count")
        return

    if path == "/api/file-notes/sync":
        if not isinstance(payload.get("ok"), bool):
            raise ContractValidationError("Invalid response: ok")
        if not isinstance(payload.get("written"), int):
            raise ContractValidationError("Invalid response: written")
        if not isinstance(payload.get("files"), list):
            raise ContractValidationError("Invalid response: files")
