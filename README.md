# Expenzo - AI-Powered Expense Tracking App

A mobile-first React Native application with a FastAPI backend for intelligent voice-based expense logging and real-time budget analytics.

## Features

- **Voice-Powered Expense Logging**: Record expenses by speaking naturally. AI analyzes audio and auto-categorizes spending.
- **Budget Envelopes**: Create multiple budget projects for different goals (travel, home improvements, etc.)
- **Real-Time Analytics**: Track burn rate, daily averages, and projected budget exhaustion dates.
- **Health Badges**: Visual indicators (SAFE, WARNING, CRITICAL) showing budget status.
- **Multi-Project Support**: Manage separate budgets and track spending across different projects.

## Project Structure

```
expenzo-client/          # React Native Expo mobile app
├── App.js              # Main application component
├── lib/
│   ├── auth.js        # Authentication utilities
│   └── supabase.js    # Supabase database helpers
├── package.json       # Frontend dependencies
└── [other files]

repositories/          # Backend data access layer
├── supabase_client.py
├── expense_repository.py
└── project_repository.py

services/             # Backend business logic
├── voice_service.py    # Gemini AI voice processing
└── analytics_service.py # Burn rate calculations

main.py              # FastAPI backend server
requirements.txt     # Python dependencies
```

## Setup Instructions

### Prerequisites

- Node.js & npm (for Expo CLI)
- Python 3.9+ (for backend)
- Supabase project (create at https://supabase.com)
- Google GenAI API key (from https://ai.google.dev)

### Backend Setup

1. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your credentials:
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_KEY`: Your Supabase service role key (not anon key)
   - `GOOGLE_API_KEY`: Your Google GenAI API key

3. **Start the backend server**:
   ```bash
   python main.py
   ```
   The API will be available at `http://localhost:8001`

### Frontend Setup

1. **Install frontend dependencies**:
   ```bash
   cd expenzo-client
   npm install
   ```

2. **Start Expo development server**:
   ```bash
   npm start
   ```

3. **Run on different platforms**:
   - Android: Press `a` in the Expo CLI or run `npm run android`
   - iOS: Press `i` in the Expo CLI or run `npm run ios`
   - Web: Press `w` in the Expo CLI or run `npm run web`

## API Endpoints

### Health Check
- `GET /health` - Server health status

### Projects
- `GET /projects` - Get all projects
- `POST /projects` - Create a new project
- `GET /analytics/burn-rate?project_id={id}&timescale=month` - Get burn rate analytics

### Expenses
- `GET /expenses?project_id={id}&timescale=month` - Get expenses with filters
- `POST /expense/voice` - Log expense from voice audio (multipart form-data)

## Voice Logging Flow

1. User taps the microphone button
2. App records audio locally
3. Audio is uploaded to `/expense/voice` endpoint
4. Backend:
   - Transcribes audio using Whisper (via Gemini)
   - Extracts amount, category, date using Gemini vision
   - Saves to Supabase
   - Computes burn rate analytics
5. Mobile app receives parsed expense and updates UI

## Database Schema

The app uses Supabase with the following tables:

### `projects`
- `id` (UUID, primary key)
- `name` (text)
- `total_budget` (numeric)
- `type` (text) - e.g., "Travel", "Personal"
- `color` (text) - Hex color code
- `icon` (text) - Icon name
- `user_id` (UUID)
- `created_at` (timestamp)

### `expenses`
- `id` (UUID, primary key)
- `project_id` (UUID, foreign key)
- `amount` (numeric)
- `date` (date)
- `category` (text) - e.g., "Dining", "Transport", "Housing"
- `transcript` (text) - Original voice transcript
- `user_id` (UUID)
- `created_at` (timestamp)

## Recent Fixes

- Fixed Supabase `.single()` read-only property mutation crash
- Fixed port configuration (backend now runs on 8001)
- Fixed ProjectRepository method signature (now uses `@classmethod`)
- Updated date references to May 31, 2026
- Added null safety checks for project creation
- Improved error handling for GenAI API initialization
- Fixed analytics to handle negative/exhausted budgets

## Troubleshooting

### "Failed to create project" Error
- Verify Supabase credentials are correct
- Check that the `projects` table exists in Supabase
- Ensure the service role key (not anon key) is being used in the backend

### Voice Logging Not Working
- Ensure `GOOGLE_API_KEY` environment variable is set
- Check microphone permissions on mobile device
- Verify backend is running and accessible at `http://localhost:8001`

### Port Already in Use
If port 8001 is in use, modify `main.py` line 217 to use a different port:
```python
uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=True)
```

## Deployment Notes

- **Frontend**: Can be deployed to Expo Go, app stores, or web platforms
- **Backend**: Deploy FastAPI app using Docker, Cloud Run, or any Python hosting
- **Environment**: Update API_URL in App.js to point to your deployed backend
