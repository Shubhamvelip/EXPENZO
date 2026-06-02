import logging
import json
import os
import tempfile
import datetime
from dotenv import load_dotenv
load_dotenv()

from google import genai
from google.genai import types
from pydantic import BaseModel
from faster_whisper import WhisperModel

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice_service")


# ─── Pydantic schema for structured Gemini text extraction ───────────────────
class ExpenseExtraction(BaseModel):
    amount: int
    category: str
    date: str


# ═════════════════════════════════════════════════════════════════════════════
# STEP 1 — LOCAL WHISPER STT
# ─────────────────────────────────────────────────────────────────────────────
# The WhisperModel is loaded lazily on the first call to avoid a slow startup
# when the module is imported. The `base` model (~145 MB) is downloaded to
# ~/.cache/huggingface/hub/ on first use and reused on subsequent runs.
# ═════════════════════════════════════════════════════════════════════════════

_whisper_model: WhisperModel | None = None


def _get_whisper_model() -> WhisperModel:
    """
    Returns a lazily-loaded, cached WhisperModel instance.

    Uses the 'base' model on CPU with int8 quantization for a good
    balance of accuracy and speed on any developer machine.
    First call takes a few seconds to download (~145 MB) and initialize.
    Subsequent calls return the cached instance immediately.
    """
    global _whisper_model
    if _whisper_model is None:
        logger.info("[Whisper] Loading faster-whisper 'tiny' model (first-run download ~75 MB)...")
        _whisper_model = WhisperModel("tiny", device="cpu", compute_type="int8")
        logger.info("[Whisper] Model loaded and ready.")
    return _whisper_model


def transcribe_audio_locally(audio_bytes: bytes, filename: str = "audio_upload.wav") -> str:
    """
    Transcribes raw audio bytes using the local faster-whisper model.

    Writes the bytes to a temporary file on disk (faster-whisper requires a
    file path rather than a bytes buffer). The temp file is deleted after
    transcription completes.

    Args:
        audio_bytes: Raw binary content of the recorded audio file.
        filename:    Original filename used to derive the file extension for
                     the temp file (important for whisper's container detection).

    Returns:
        The transcribed text as a single stripped string.

    Raises:
        ValueError: If audio_bytes is empty.
        RuntimeError: If transcription yields no segments.
    """
    if not audio_bytes:
        raise ValueError("Audio bytes cannot be empty.")

    # Derive the extension from the original filename so whisper picks up the
    # correct container format (.m4a, .3gp, .wav, etc.).
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ".wav"

    logger.info(
        f"[Whisper] Starting transcription — filename='{filename}' "
        f"ext='{ext}' buffer_size={len(audio_bytes):,} bytes."
    )

    # Write to a named temp file. delete=False keeps the file on disk while
    # we pass the path to whisper, then we clean it up manually.
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        model = _get_whisper_model()
        segments, info = model.transcribe(tmp_path, beam_size=1)

        transcription = "".join(segment.text for segment in segments).strip()
        logger.info(
            f"[Whisper] Transcription complete — lang='{info.language}' "
            f"prob={info.language_probability:.2f} text='{transcription}'"
        )

        if not transcription:
            raise RuntimeError("Whisper returned an empty transcription. Try speaking more clearly.")

        return transcription

    finally:
        # Always clean up the temp file even if transcription fails.
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
            logger.debug(f"[Whisper] Temp file deleted: {tmp_path}")


# ═════════════════════════════════════════════════════════════════════════════
# STEP 2 — GEMINI TEXT-ONLY ENTITY EXTRACTION
# ─────────────────────────────────────────────────────────────────────────────
# Takes the plain transcription text and sends it to Gemini as a *text-only*
# request (no audio bytes, no multimodal). This avoids all audio-quota limits
# and works reliably since the input is just a short sentence.
# ═════════════════════════════════════════════════════════════════════════════

_genai_client: genai.Client | None = None


def _get_genai_client() -> genai.Client:
    """
    Returns a lazily-loaded, cached Google GenAI client.
    Reads the API key from the GOOGLE_API_KEY environment variable.
    """
    global _genai_client
    if _genai_client is None:
        try:
            _genai_client = genai.Client()
            logger.info("[Gemini Text] GenAI client initialized.")
        except Exception as e:
            logger.error(
                f"[Gemini Text] Failed to initialize GenAI client: {e}. "
                "Make sure GOOGLE_API_KEY environment variable is set."
            )
            raise
    return _genai_client


def extract_expense_from_text(transcription: str) -> dict:
    """
    Extracts structured expense data from a plain-text transcription using
    Gemini text-only API with structured JSON output.

    This is much cheaper and faster than the multimodal audio approach because
    the input is just a short text sentence (~10–30 tokens).

    Args:
        transcription: The plain-text transcription from the local Whisper STT.

    Returns:
        A dict with keys: amount (int), category (str), date (str YYYY-MM-DD),
        transcript (str, the original transcription text).

    Raises:
        Exception: If the Gemini API request fails.
    """
    today_str = datetime.date.today().strftime("%A, %B %d, %Y")
    today_iso = datetime.date.today().isoformat()

    logger.info(f"[Gemini Text] Extracting entities from: '{transcription}'")

    try:
        response = _get_genai_client().models.generate_content(
            model="gemini-3.5-flash",
            contents=(
                f"Today's date is {today_str} ({today_iso}).\n"
                f"Parse this expense statement and extract the details:\n"
                f"\"{transcription}\"\n\n"
                "Return ONLY a valid JSON object with these exact keys:\n"
                "{ \"amount\": <integer>, \"category\": \"<one of: Dining, Transport, Housing, "
                "Shopping, Entertainment, Healthcare, Education, Other>\", \"date\": \"<YYYY-MM-DD>\" }\n"
                "Use today's date for 'today', yesterday's date for 'yesterday', etc.\n"
                "The amount must be a plain integer (no currency symbol, no decimals)."
            ),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=ExpenseExtraction,
                system_instruction=(
                    "You are a financial data extraction assistant for the Expenzo app.\n"
                    "Extract expense amount, category, and date from the user's text.\n"
                    f"Today's date is {today_str}. Resolve all relative dates correctly."
                ),
            ),
        )
    except Exception as e:
        logger.error(f"[Gemini Text] API request failed: {e}")
        raise

    # Prefer the pre-parsed Pydantic object if available
    if hasattr(response, "parsed") and response.parsed is not None:
        extracted = response.parsed
        result = {
            "amount": int(extracted.amount),
            "category": str(extracted.category).strip(),
            "date": str(extracted.date).strip(),
            "transcript": transcription,
        }
    else:
        # Fallback: parse the raw JSON text manually
        raw_text = response.text
        logger.warning(f"[Gemini Text] Response not pre-parsed, parsing manually: {raw_text}")
        data = json.loads(raw_text)
        result = {
            "amount": int(data.get("amount", 0)),
            "category": str(data.get("category", "Other")).strip(),
            "date": str(data.get("date", today_iso)).strip(),
            "transcript": transcription,
        }

    logger.info(f"[Gemini Text] Extraction succeeded: {result}")
    return result


# ═════════════════════════════════════════════════════════════════════════════
# PUBLIC API — called by main.py
# ═════════════════════════════════════════════════════════════════════════════

def process_voice_audio(audio_bytes: bytes, filename: str = "audio_upload.wav") -> dict:
    """
    Full two-step voice expense pipeline:
      1. Transcribe audio locally using faster-whisper (zero API cost).
      2. Extract {amount, category, date} from the transcription text using
         Gemini text-only API (cheap text tokens, no audio quota needed).

    Args:
        audio_bytes: Raw binary content read from the UploadFile memory buffer.
        filename:    Original upload filename — used to derive the audio
                     container extension for the temp file.

    Returns:
        dict with keys: amount (int), category (str), date (str), transcript (str).

    Raises:
        ValueError: If audio_bytes is empty or transcription is empty.
        Exception:  If either the Whisper or Gemini step fails.
    """
    # Step 1: Local STT
    transcription = transcribe_audio_locally(audio_bytes, filename=filename)

    # Step 2: Cloud text extraction (text-only, no audio quota)
    result = extract_expense_from_text(transcription)

    return result
