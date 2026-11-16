# JobTrack AI

JobTrack AI is a lightweight job application tracker with AI-assisted resume-to-job matching.

It started as a local job application tracker and has evolved into a portfolio project combining practical QA workflows, frontend development, backend API integration, deterministic scoring, and AI-assisted job requirement analysis.

## Live Demo

**[https://cjayjaval.github.io/jobtrack-ai/](https://cjayjaval.github.io/jobtrack-ai/)**

## Current Version

**v0.4.3 — Application Favorites & Auto-Ghosted**

## Features

### Dashboard

The JobTrack AI dashboard provides a centralized overview of job search activity.

It includes:

- Application statistics and status summaries
- Quick access to application management
- Search, filtering, and sorting
- Responsive dashboard layout
- Light Glass and Dark Glass appearance modes
- Persistent theme preference
- Updated visual design and navigation

### Job Application Tracking

- Create, edit, and delete job applications
- Automatic Application IDs (`APP-0001`, `APP-0002`, etc.)
- Track company, position, application date, source, location, and job URL
- Track work arrangement and employment type
- Track expected salary and actual salary offers
- Track interview dates
- Search, filter, and sort applications
- Responsive desktop and mobile layouts
- Local browser persistence using `localStorage`
- JSON data export

### Favorites

- Mark any application as a favorite from a heart icon in the table, the mobile cards, or Application Details — all three stay in sync
- Filter the list by All applications, Favorites only, or Not favorites, alongside every other filter
- Favorite state is saved in `localStorage` and survives edits, filtering, and page refreshes

### Responsive Layout & Navigation

Desktop scrolling behavior was refined so page headers and key controls stay in view while content scrolls independently.

- Desktop Applications table keeps the page header, toolbar, and a sticky column header in view while only the table content scrolls
- Desktop Dashboard keeps the greeting and key actions in view while dashboard content scrolls independently
- A floating "Back to Top" control appears on mobile after scrolling down
- Layout and navigation adapt across desktop, tablet, and mobile screen widths

### Application Status Tracking

Supported statuses include:

- To Apply
- Applied
- For Initial Interview
- For Technical Interview
- For Final Interview
- Offered
- Ghosted
- Rejected
- Withdrawn
- Failed

An application left at **Applied** for 14 calendar days automatically moves to **Ghosted** — no action needed. Manually changing it back to Applied restarts that 14-day countdown from the date of the change, so it won't immediately flip back.

### Job Requirements

Applications can contain:

- Job Description
- Required Skills
- Nice-to-Have Skills
- Custom Required Skills
- Custom Nice-to-Have Skills

Matching predefined skills cannot be selected as both Required and Nice-to-Have at the same time.

### How to Use Tutorial

JobTrack AI includes an in-app "How to Use" guide.

- Narrated walkthrough video demonstrating the core workflow
- Optional English captions, available through the video player's native controls
- Written step-by-step instructions alongside the video

## AI Job Match

JobTrack AI can compare a resume against an application's job requirements and generate an evidence-based alignment analysis.

The analysis provides:

- Match Score
- Core Requirements coverage
- Nice-to-Have coverage
- Requirements Met
- Partial Matches
- Missing / Not Evident requirements
- Supporting resume evidence
- Short alignment summary

The Match Score represents **resume-to-job-requirement alignment only**. It is not a prediction of hiring, interview selection, or ATS ranking.

### How Analysis Works

JobTrack AI uses a multi-stage analysis pipeline:

1. Job requirements are normalized into canonical requirements and material components.
2. Resume evidence is evaluated against those fixed components.
3. Component results are rolled up deterministically.
4. The final Match Score is calculated by application code rather than generated directly by the AI model.

This separation helps make scoring more explainable and reduces unnecessary variation in the final calculation.

### Core vs Nice-to-Have Scoring

Requirements are separated into:

- **Core** — required and unspecified-priority requirements
- **Nice-to-Have** — preferred/optional requirements

Nice-to-Have requirements act as bonus alignment and do not reduce a candidate's score simply because optional qualifications are missing.

A candidate with complete Core coverage can therefore reach 100% without satisfying every Nice-to-Have requirement.

## Resume Support

JobTrack AI currently supports text-readable PDF resumes.

PDF text extraction happens directly in the browser using PDF.js.

The raw PDF file is not uploaded to the JobTrack AI backend. Only extracted resume text is sent for analysis when the user explicitly starts an analysis.

Currently:

- PDF files only
- Text-readable PDFs supported
- Scanned/image-only PDFs are not supported
- Corrupted or unreadable PDFs are rejected
- Oversized files/text are rejected

## Analysis Freshness

JobTrack AI avoids unnecessary repeat AI calls.

Each successful analysis records an identity based on:

- Resume content fingerprint
- Job requirements fingerprint
- JobTrack AI analysis version

If neither the resume content nor job requirements have changed, the existing analysis is considered up to date and Re-analyze is disabled.

If the resume or job requirements change, the existing result remains visible but is marked stale and re-analysis becomes available.

Returning to the exact previously analyzed resume and job requirements automatically restores the analysis to the up-to-date state without another AI request.

## AI Analysis UX

The Application Details workspace includes:

- Analyze/Re-analyze controls
- Estimated circular analysis progress
- Current/stale analysis indicators
- Required and Optional requirement badges
- Automatic navigation to the AI analysis section
- Go-to-Top navigation for long analysis results
- Persistent previous results if re-analysis fails

The progress percentage is an estimated visual indicator and does not represent measured backend completion progress.

## Appearance and Theme System

JobTrack AI includes a dedicated appearance system supporting:

- Light Glass theme
- Dark Glass theme
- Persistent theme preference
- Theme-specific visual assets
- Consistent styling across the application shell and dashboard
- Theme initialization before page rendering to reduce incorrect-theme flashing

Theme behavior is separated into its own frontend module to keep appearance logic independent from the main application logic.

## Architecture

### Frontend

- HTML
- CSS
- Vanilla JavaScript
- Modular JavaScript for dashboard, application shell, and theme behavior
- PDF.js
- Browser `localStorage`

### Backend

- Node.js
- Express
- REST API
- Official OpenAI SDK
- Environment-based configuration using dotenv

### AI Pipeline

- Canonical requirement extraction
- Fixed component-level evidence evaluation
- Deterministic result rollup
- Deterministic application-side scoring
- Structured JSON output
- Provider abstraction for future AI-provider support

## Security and Validation

JobTrack AI includes:

- Server-side API key protection
- CORS allowlisting
- Request validation
- Resume/job-input size limits
- Structured AI output validation
- Prompt-injection defenses
- XSS-safe rendering of AI-generated content
- Generic server error handling
- Environment secrets excluded from Git

The OpenAI API key is never exposed to frontend code.

## Project Structure

```text
JobTrack-AI/
├── index.html
├── style.css
├── script.js
├── README.md
├── .gitignore
├── assets/
│   ├── bg-dark.png
│   ├── bg-light.png
│   ├── how-to-use.mp4
│   ├── how-to-use.vtt
│   ├── logo-mark.png
│   └── logo.png
├── js/
│   ├── dashboard.js
│   ├── resume.js
│   ├── shell.js
│   └── theme.js
└── server/
    ├── server.js
    ├── package.json
    ├── package-lock.json
    ├── .env.example
    ├── dev/
    │   ├── stage-a-consistency-check.js
    │   └── stage-b-consistency-check.js
    ├── middleware/
    │   └── errorHandler.js
    ├── providers/
    │   └── openaiProvider.js
    ├── routes/
    │   └── analyzeJobMatch.js
    ├── services/
    │   └── aiService.js
    └── utils/
        ├── canonicalRequirementsValidator.js
        ├── hash.js
        ├── limits.js
        ├── rollup.js
        ├── schemaValidator.js
        ├── scoring.js
        └── scoring.test.js
```

## Known Limitations

The following features are planned but not yet implemented:

- **Analytics** — charts and trends for application history are not yet available; the Dashboard currently shows summary metrics only
- **Resume Library** — JobTrack AI currently supports a single resume used across all applications; multi-resume support is planned

Both are visible in the navigation as upcoming features.

The automatic Ghosted status check runs when the app loads and whenever an application is added, edited, or deleted — not merely when switching between Dashboard and Applications. An application can sit past its 14-day mark, still showing Applied, until the next one of those events.

## Project Status

JobTrack AI is an actively developed personal portfolio project.

The project is used to practice and demonstrate:

- Software QA and test design
- Frontend development
- API integration
- AI-assisted application features
- Deterministic scoring and validation
- Security-conscious AI integration
- Git and GitHub development workflows
- Incremental product development