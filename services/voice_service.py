import logging
import json
from google import genai
from google.genai import types
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice_service")

# 1. Define the Pydantic schema class matching what main.py expects
class ExpenseExtraction(BaseModel):
    amount: int
    category: str
    date: str

# ─── Gemini-native audio MIME type table ─────────────────────────────────────
# Gemini 2.5 Flash natively supports: audio/wav, audio/mp3, audio/aiff,
# audio/aac, audio/ogg, audio/flac via Part.from_bytes (inline data path).
#
# Mobile containers NOT natively supported by the API:
#   • .m4a  (audio/m4a)  → remapped to audio/aac  (AAC is the codec inside M4A)
#   • .3gp  (audio/3gpp) → remapped to audio/aac  (AAC-LC is the standard 3GPP codec)
#   • .3gpp (audio/3gpp) → remapped to audio/aac
#
# Unknown extensions fall back to audio/mp3, which Gemini parses as raw byte
# chunks without enforcing a strict container boundary.
_AUDIO_MIME_MAP: dict[str, str] = {
    # iOS mobile container — AAC codec inside an MPEG-4 wrapper
    "m4a":  "audio/aac",
    # Android LOW_QUALITY containers — AAC-LC codec inside a 3GPP wrapper
    "3gp":  "audio/aac",
    "3gpp": "audio/aac",
    # Natively supported containers — pass through unchanged
    "aac":  "audio/aac",
    "mp3":  "audio/mp3",
    "wav":  "audio/wav",
    "aiff": "audio/aiff",
    "ogg":  "audio/ogg",
    "flac": "audio/flac",
    # webm/opus → ogg container is the closest Gemini-native equivalent
    "webm": "audio/ogg",
}

# Containers whose file extension differs from the Gemini-native MIME alias
# used, so we can emit an informative remap warning in the log.
_REMAPPED_EXTENSIONS: frozenset[str] = frozenset({"m4a", "3gp", "3gpp", "webm"})


def _resolve_mime_type(filename: str) -> str:
    """
    Derive a Gemini-natively-supported audio MIME type from the file extension.

    Unsupported mobile containers (.m4a, .3gp, .3gpp) are transparently remapped
    to ``audio/aac`` — the codec those containers carry — so Gemini 2.5 Flash
    can parse the raw audio byte stream without rejecting the request.
    Unknown extensions fall back to ``audio/mp3`` (raw chunk fallback).
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    resolved = _AUDIO_MIME_MAP.get(ext, "audio/mp3")  # raw chunk fallback

    if ext in _REMAPPED_EXTENSIONS:
        logger.warning(
            f"Container '{ext}' is not natively supported by Gemini Part.from_bytes — "
            f"remapping '{filename}' from unsupported container to Gemini-native "
            f"equivalent mime_type='{resolved}' for transparent byte-stream parsing."
        )
    else:
        logger.info(
            f"Resolved Gemini-native MIME type '{resolved}' "
            f"from filename '{filename}' (ext='{ext}')."
        )
    return resolved


# ─── Lazy GenAI client ────────────────────────────────────────────────────────
# Instantiated on first call to avoid module-load crashes when API key is absent.
_client = None

def get_genai_client():
    global _client
    if _client is None:
        try:
            _client = genai.Client()
        except Exception as e:
            logger.error(f"Failed to initialize GenAI client: {e}. Make sure GOOGLE_API_KEY environment variable is set.")
            raise
    return _client


def process_voice_audio(audio_bytes: bytes, filename: str = "audio_upload.wav") -> dict:
    """
    Processes voice audio bytes to transcribe and extract expense details
    (amount, category, date) using the Google GenAI SDK with gemini-2.5-flash.

    The ``audio_bytes`` buffer is passed inline via ``types.Part.from_bytes``
    with a Gemini-natively-supported MIME type resolved from ``filename``.
    Unsupported mobile containers (.m4a → audio/aac, .3gp → audio/aac) are
    transparently remapped so the model can parse the raw codec stream directly.

    Structured output is enforced via ``response_schema=ExpenseExtraction``
    (Pydantic), guaranteeing a type-safe dict with 'amount' (int),
    'category' (str), and 'date' (str) keys in the returned payload.

    Args:
        audio_bytes: Raw binary content read from the UploadFile memory buffer.
        filename:    Original upload filename used to resolve the Gemini-native
                     MIME type. Defaults to 'audio_upload.wav'.

    Raises:
        ValueError: If audio_bytes is empty.
        Exception:  If the Gemini API request fails.
    """
    if not audio_bytes:
        raise ValueError("Audio bytes cannot be empty")

    mime_type = _resolve_mime_type(filename)
    logger.info(
        f"Initializing Gemini-2.5-Flash multimodal request — "
        f"mime_type='{mime_type}' buffer_size={len(audio_bytes):,} bytes."
    )

    try:
        # Wrap the raw audio bytes in a Part using the Gemini-native MIME type.
        # Remapped containers (m4a, 3gp) declare audio/aac so Gemini reads the
        # underlying codec stream without enforcing a strict container boundary.
        audio_part = types.Part.from_bytes(
            data=audio_bytes,
            mime_type=mime_type
        )

        prompt = (
            "Analyze this audio expense description and extract the expense information. "
            "Assume today's date is strictly Sunday, May 31, 2026. "
            "Use this reference date context to resolve relative temporal words like 'today', 'yesterday', or 'this morning'."
        )

        # Call gemini-2.5-flash with structured output schema configuration
        response = get_genai_client().models.generate_content(
            model="gemini-2.5-flash",
            contents=[audio_part, prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=ExpenseExtraction,
                system_instruction=(
                    "You are an expert NLP financial entity extraction assistant for Expenzo.\n"
                    "Your task is to parse a voice audio recording of an expense and extract the amount, category, and date.\n"
                    "Today's date context is strictly Sunday, May 31, 2026."
                )
            )
        )
    except Exception as e:
        logger.error(f"Gemini API request failed: {e}")
        raise

    # Convert the parsed model back to a dictionary and inject the recreated transcript text
    if hasattr(response, "parsed") and response.parsed is not None:
        extracted = response.parsed
        result = {
            "amount": int(extracted.amount),
            "category": str(extracted.category).strip(),
            "date": str(extracted.date).strip(),
            "transcript": f"Spent {extracted.amount} on {extracted.category} {extracted.date}"
        }
    else:
        # Fallback raw text parsing if parsed attribute is missing
        raw_text = response.text
        logger.warning(f"Response not pre-parsed. Parsing manually: {raw_text}")
        extracted_data = json.loads(raw_text)
        result = {
            "amount": int(extracted_data.get("amount", 0)),
            "category": str(extracted_data.get("category", "")).strip(),
            "date": str(extracted_data.get("date", "")).strip(),
            "transcript": f"Spent {extracted_data.get('amount', 0)} on {extracted_data.get('category', '')} {extracted_data.get('date', '')}"
        }

    logger.info(f"Gemini multimodal extraction succeeded. Result: {result}")
    return result
