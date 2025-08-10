Troll Patrol API

This repository contains serverless API endpoints for the Troll Patrol browser extension, designed to collect user reports and metrics, and push aggregated troll data to a GitHub repository. The API runs on Vercel and uses Upstash Redis for storage.

# Installation

# Clone the repository
git clone https://github.com/your-username/troll-patrol-api.git
cd troll-patrol-api

# Install dependencies
npm install

# Environment Variables
Set the following in your .env file or in Vercel’s Environment Variables settings:
KV_REST_API_URL=your-upstash-redis-rest-url
KV_REST_API_TOKEN=your-upstash-redis-token
GITHUB_TOKEN=your-github-token
GITHUB_REPO=your-username/your-repo
GITHUB_BRANCH=main

# Deployment on Vercel
1. Push your code to GitHub.
2. Import the repo into Vercel.
3. Add your environment variables in Vercel’s Settings → Environment Variables.
4. Deploy the project.

# API Endpoints
1. POST /api/reports

Submit a list of reported troll profile IDs.

Request Body

{
  "reports": ["hashedProfileId1", "hashedProfileId2"]
}

Response

{
  "results": [
    {
      "profileId": "hashedProfileId1",
      "message": "Report received successfully",
      "reports": 3
    }
  ]
}

2. POST /api/metrics

Submit extension usage metrics.

Request Body

{
  "reports": {
    "uniqueReports": 5,
    "totalReports": 10,
    "blurredEncounters": 20,
    "unblurAttempts": 2
  }
}

Response

{ "message": "Metrics uploaded successfully." }

3. POST /api/push

Push the current Bloom filter stored in Redis to GitHub.

Response

{ "message": "Bloom filter pushed successfully." }

# Notes
Reports expire after 7 days.
Metrics are rate-limited to 5 uploads per minute per IP.
Uploads are blocked between 23:00–00:00 UTC.
All stored data is anonymous.
