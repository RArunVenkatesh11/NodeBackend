# InnooRyze Marketing Maturity Assessment (MMA) Backend

A pure Node.js REST API for the InnooRyze Marketing Maturity Assessment application.

## Overview

This backend service provides endpoints for:
- Creating and managing marketing maturity assessments
- Processing user responses with OpenAI GPT-4o-mini analysis
- Storing assessment data in Supabase

## Tech Stack

- **Node.js** (CommonJS)
- **Express.js** - REST API framework
- **Supabase** - Database and authentication
- **OpenAI** - GPT-4o-mini for assessment analysis

## Environment Variables

The following environment variables are required:

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `OPENAI_API_KEY` | OpenAI API key for GPT-4o-mini |
| `PORT` | Server port (defaults to 3000) |

## API Endpoints

### Health Check

```
GET /health
```

Returns service status and timestamp.

**Response:**
```json
{
  "status": "ok",
  "service": "InnooRyze MMA Backend",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

### Start Assessment

```
POST /api/assessments/start
```

Creates a new assessment after collecting user information.

**Request Body:**
```json
{
  "businessType": "B2B",
  "userInfo": {
    "firstName": "Arun",
    "email": "user@example.com",
    "businessName": "InnooRyze",
    "country": "SG",
    "industry": "Marketing"
  },
  "selectedCategories": ["data", "channels", "technology"]
}
```

**Response:**
```json
{
  "assessmentId": "<uuid>"
}
```

### Submit Assessment

```
POST /api/assessments/:id/submit
```

Submits answers and receives AI-generated scoring and recommendations.

**Request Body:**
```json
{
  "businessType": "B2B",
  "selectedCategories": ["data", "channels", "technology"],
  "answers": {
    "b2b-data-1": { "score": 3 },
    "b2b-channels-2": { "score": 4 }
  }
}
```

**Response:**
```json
{
  "assessmentId": "<id>",
  "scores": {
    "overall": 3.4,
    "data": 3,
    "channels": 4,
    "technology": 3
  },
  "analysis": "Narrative explanation of marketing maturity...",
  "options": {
    "crawl": { "summary": "...", "actions": ["..."] },
    "walk": { "summary": "...", "actions": ["..."] },
    "run": { "summary": "...", "actions": ["..."] }
  },
  "growthSimulation": {
    "crawl": { "data": 3.5, "channels": 3.6, "technology": 3.0 },
    "walk": { "data": 4.0, "channels": 4.1, "technology": 3.5 },
    "run": { "data": 4.5, "channels": 4.6, "technology": 4.2 }
  }
}
```

### Get Assessment

```
GET /api/assessments/:id
```

Retrieves a specific assessment by ID.

**Response:** Full assessment object from database.

### Export PDF (Stub)

```
POST /api/assessments/:id/pdf
```

PDF export endpoint (not yet implemented).

**Response:**
```json
{
  "message": "PDF export not implemented yet."
}
```

## Database Schema

The backend expects the following Supabase tables:

### Users Table
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    phone TEXT,
    business_name TEXT,
    country TEXT,
    industry TEXT,
    company_size TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Assessments Table
```sql
CREATE TABLE assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_type TEXT NOT NULL CHECK (business_type IN ('B2B', 'B2C')),
    selected_categories TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed')),
    raw_answers JSONB,
    scores JSONB,
    analysis TEXT,
    options JSONB,
    growth_simulation JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
```

## Running the Server

```bash
node index.js
```

The server will start on the configured PORT (default: 3000).

## Error Handling

All errors return clean JSON responses:

- **400** - Bad Request (validation errors)
- **404** - Not Found (assessment not found)
- **500** - Internal Server Error (database or API errors)
- **501** - Not Implemented (PDF export)

```json
{
  "error": "Error message here"
}
```

## License

Proprietary - InnooRyze
