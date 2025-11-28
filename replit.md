# InnooRyze Marketing Maturity Assessment (MMA) Backend

## Project Overview

A pure Node.js REST API backend for the InnooRyze Marketing Maturity Assessment application. This API handles user management, assessment creation, AI-powered scoring via OpenAI GPT-4o-mini, and stores data in Supabase.

## Tech Stack

- **Runtime**: Node.js with Express.js
- **Database**: Supabase (PostgreSQL)
- **AI**: OpenAI GPT-4o-mini for assessment analysis
- **Language**: TypeScript (server) / JavaScript (standalone index.js)

## Architecture

The backend provides the following functionality:
- User registration and management in Supabase
- Assessment lifecycle management (create, submit, retrieve)
- AI-powered marketing maturity analysis with crawl/walk/run recommendations
- Growth simulation projections

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check - returns service status and timestamp |
| POST | `/api/assessments/start` | Create new assessment with user info |
| POST | `/api/assessments/:id/submit` | Submit answers for AI analysis |
| GET | `/api/assessments/:id` | Retrieve assessment by ID |
| POST | `/api/assessments/:id/pdf` | PDF export (stub - returns 501) |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `OPENAI_API_KEY` | Yes | OpenAI API key for GPT-4o-mini |
| `PORT` | No | Server port (defaults to 5000) |

## Database Schema (Supabase)

### Users Table
- `id` (UUID) - Primary key
- `email` (TEXT) - Unique, required
- `first_name` (TEXT) - Required
- `last_name` (TEXT) - Default empty
- `phone` (TEXT) - Optional
- `business_name` (TEXT) - Business name
- `country` (TEXT) - Country code
- `industry` (TEXT) - Industry type
- `company_size` (TEXT) - Company size range
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

### Assessments Table
- `id` (UUID) - Primary key
- `user_id` (UUID) - Foreign key to users
- `business_type` (TEXT) - "B2B" or "B2C"
- `selected_categories` (TEXT[]) - Array of category names
- `status` (TEXT) - "started" or "completed"
- `raw_answers` (JSONB) - User's answer responses
- `scores` (JSONB) - AI-generated scores
- `analysis` (TEXT) - AI-generated narrative analysis
- `options` (JSONB) - Crawl/Walk/Run recommendations
- `growth_simulation` (JSONB) - Projected growth scores
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `completed_at` (TIMESTAMPTZ) - Completion timestamp

## File Structure

```
/
├── server/
│   ├── routes.ts        # Main API endpoints (TypeScript)
│   ├── index.ts         # Express server setup
│   ├── storage.ts       # Storage interface (not used - using Supabase)
│   ├── vite.ts          # Vite development setup
│   └── static.ts        # Static file serving
├── index.js             # Standalone CommonJS backend (alternative entry)
├── README.md            # API documentation
└── replit.md            # This file - project documentation
```

## Running the Server

The server runs on port 5000 via the "Start application" workflow which executes `npm run dev`.

## Request/Response Examples

### Start Assessment
```bash
curl -X POST /api/assessments/start \
  -H "Content-Type: application/json" \
  -d '{
    "businessType": "B2B",
    "userInfo": {
      "firstName": "John",
      "email": "john@example.com",
      "businessName": "Acme Corp",
      "country": "US",
      "industry": "Technology"
    },
    "selectedCategories": ["data", "channels", "technology"]
  }'
```

### Submit Assessment
```bash
curl -X POST /api/assessments/{id}/submit \
  -H "Content-Type: application/json" \
  -d '{
    "businessType": "B2B",
    "selectedCategories": ["data", "channels"],
    "answers": {
      "b2b-data-1": {"score": 3},
      "b2b-channels-1": {"score": 4}
    }
  }'
```

## Error Handling

All errors return clean JSON responses:
- `400` - Bad Request (validation errors)
- `404` - Not Found (assessment not found)
- `500` - Internal Server Error
- `501` - Not Implemented (PDF export)

## Future Features (Planned)

1. Implement actual PDF generation with assessment results and charts
2. Add rate limiting and API authentication for production security
3. Create user dashboard endpoint to retrieve all assessments by user email
4. Add webhook support for sending assessment completion notifications
5. Implement caching layer for frequently accessed assessments
