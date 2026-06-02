import os
from dotenv import load_dotenv
load_dotenv()

import logging
import uvicorn
import datetime
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import local modules
from services.voice_service import process_voice_audio
from services.analytics_service import compute_burn_rate
from repositories.expense_repository import ExpenseRepository
from repositories.project_repository import ProjectRepository

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main_api")

# Pydantic Incoming Schemas
class ProjectCreate(BaseModel):
    name: str
    total_budget: float

app = FastAPI(
    title="Expenzo AI Voice Pipeline & Analytics API",
    description="FastAPI backend service supporting AI-powered expense logging and real-time burn rate calculations.",
    version="1.0.0"
)

# Configure standard CORS middleware allowances to allow local network React Native Expo streams
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins for local network testing / mobile clients
    allow_credentials=True,
    allow_methods=["*"],  # Allows all standard methods (GET, POST, OPTIONS, etc.)
    allow_headers=["*"],  # Allows all standard headers
)

@app.post("/expense/voice", status_code=status.HTTP_201_CREATED)
async def create_expense_from_voice(
    audio: UploadFile = File(...),
    project_id: str = Form(...)
):
    """
    Accepts a mobile audio file upload (any extension: .m4a, .3gp, .wav, etc.)
    and a project ID. Reads the raw byte stream directly from the UploadFile
    memory buffer, transcribes and extracts expense details using the two-tier
    AI voice pipeline, saves the record, recomputes burn rate analytics, and
    returns a unified response payload.

    No strict filename extension check is enforced — the MIME type is resolved
    dynamically inside the voice service based on the uploaded filename.
    """
    incoming_filename = audio.filename or "audio_upload"
    logger.info(
        f"Received voice expense upload — file='{incoming_filename}' "
        f"content_type='{audio.content_type}' project_id='{project_id}'"
    )

    # 1. Ingest the raw binary stream directly from the UploadFile memory buffer
    try:
        audio_bytes = await audio.read()
    except Exception as e:
        logger.error(f"Failed to read uploaded audio file '{incoming_filename}': {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to process uploaded audio file stream."
        )

    # 2. Pass raw buffer bytes + filename into process_voice_audio.
    #    The service resolves the MIME type from the filename extension so any
    #    mobile container format (.m4a, .3gp, .wav) is handled seamlessly.
    try:
        extraction_result = process_voice_audio(audio_bytes, filename=incoming_filename)
    except ValueError as ve:
        # Handle Whisper STT confidence score failures (ERR_STT_FAIL)
        logger.warning(f"Voice pipeline failure: {ve}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(ve)
        )
    except Exception as e:
        logger.error(f"Unexpected error in voice pipeline: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI voice pipeline execution error: {str(e)}"
        )

    # 3. Save the amount, category, date, and transcript text straight to the database
    try:
        persisted_expense = ExpenseRepository.create_expense(
            project_id=project_id,
            amount=float(extraction_result["amount"]),
            date=extraction_result["date"],
            category=extraction_result["category"],
            transcript=extraction_result.get("transcript")
        )
    except Exception as e:
        logger.error(f"Database persistence failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to persist expense record straight to database."
        )

    # 4. Fetch the project's metadata to get its total budget limit and run compute_burn_rate
    try:
        total_budget = ProjectRepository.get_project_budget(project_id)
        burn_rate_analytics = compute_burn_rate(project_id=project_id, total_budget=total_budget)
    except Exception as e:
        logger.error(f"Burn rate calculation failed: {e}")
        # Note: We still return success for the expense persistence, but flag the analytics calculation error
        burn_rate_analytics = {
            "error": "Failed to recompute burn rate analytics",
            "detail": str(e)
        }

    # 5. Return a clean unified response payload
    return {
        "message": "Expense logged successfully and budget analytics updated.",
        "expense": persisted_expense,
        "analytics": burn_rate_analytics
    }

@app.post("/projects", status_code=status.HTTP_201_CREATED)
def create_project(project: ProjectCreate):
    """
    Accepts a ProjectCreate payload and registers the new project envelope.
    """
    try:
        new_project = ProjectRepository.create_project(project.name, project.total_budget)
        return {
            "message": "Project created successfully.",
            "project": new_project
        }
    except Exception as e:
        logger.error(f"Failed to create project: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create project: {str(e)}"
        )

@app.get("/projects")
def get_projects():
    """
    Returns all registered projects in the ledger.
    """
    try:
        return ProjectRepository.get_all_projects()
    except Exception as e:
        logger.error(f"Failed to fetch projects: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch projects: {str(e)}"
        )

@app.get("/expenses")
def get_expenses(project_id: str = None, timescale: str = "month"):
    """
    Returns logged expenses, optionally filtered by project_id and timescale relative to May 31, 2026.
    """
    try:
        today = datetime.date(2026, 5, 31)
        timescale_val = (timescale or "month").lower().strip()
        if timescale_val == "daily":
            start_date = today.strftime("%Y-%m-%d")
            end_date = today.strftime("%Y-%m-%d")
        elif timescale_val == "weekly":
            start_date = (today - datetime.timedelta(days=6)).strftime("%Y-%m-%d")
            end_date = today.strftime("%Y-%m-%d")
        elif timescale_val == "month":
            start_date = "2026-05-01"
            end_date = "2026-05-31"
        elif timescale_val == "yearly":
            start_date = "2026-01-01"
            end_date = "2026-12-31"
        else:
            # Fallback to month
            start_date = "2026-05-01"
            end_date = "2026-05-31"

        return ExpenseRepository.get_expenses_filtered(
            project_id=project_id,
            start_date=start_date,
            end_date=end_date
        )
    except Exception as e:
        logger.error(f"Failed to fetch expenses: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch expenses: {str(e)}"
        )

@app.get("/analytics/burn-rate")
def get_burn_rate(project_id: str, timescale: str = "month"):
    """
    Returns the real-time burn rate analytics for a project under the specified timescale.
    """
    try:
        total_budget = ProjectRepository.get_project_budget(project_id)
        burn_rate = compute_burn_rate(project_id=project_id, total_budget=total_budget, timescale=timescale)
        return burn_rate
    except Exception as e:
        logger.error(f"Failed to fetch burn rate analytics: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to calculate burn rate: {str(e)}"
        )

@app.get("/health")
def health_check():
    """
    Simple API health check endpoint.
    """
    return {"status": "healthy", "service": "expenzo-backend"}

if __name__ == "__main__":
    # Expose the server on port 8001 to match client configuration
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
