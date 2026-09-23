# JobTrack AI

A personal job application tracker built with HTML, CSS, and JavaScript.

JobTrack AI helps job seekers organize and monitor their job applications in one place. The current version focuses on core tracking features, with AI-powered and workflow automation ideas planned for future development.

## Project Status

**Phase 1 — Core Job Tracker**

Core features have been implemented and manually tested. The project is still in development, and the roadmap below may change as the project evolves.

## Current Features

- Dashboard summary of job applications
- Add, view, edit, and delete applications
- Automatic search as you type, with a clear-search button
- Filter and sort applications
- Store job details, including company, position, status, application date, and optional information
- Required-field validation, with focus moved to the first invalid field
- Success and error notifications
- Export application data for backup
- Responsive layout for desktop and mobile

## Built With

- HTML
- CSS
- JavaScript
- Browser `localStorage`

## Getting Started

### Run locally

1. Download or clone this repository.
2. Open the project folder.
3. Open `index.html` in a browser.
4. Add and manage your job applications.

The current version does not require a backend server or database.

## Data and Privacy Notes

The current version stores application data in the browser using `localStorage`.

- Records are stored in the browser's local storage context.
- Data is not synced across devices or accounts.
- Clearing browser site data may remove saved records.
- Use the export feature to create a backup.
- Avoid entering sensitive personal information into a public demo.

## Roadmap

The following are **planned ideas**, not features currently available. Their scope and order may change.

### Phase 2 — AI-Assisted Job Matching

- Compare a resume with a job description
- Highlight relevant skills and experience
- Identify potential skill gaps
- Suggest areas to tailor in a resume

### Phase 3 — Workflow Automation

- Explore n8n integration
- Explore Google Sheets integration for application tracking
- Reduce repetitive manual data entry

### Phase 4 — Email and Application Updates

- Explore Gmail-based application update capture
- Identify relevant application confirmation or status emails
- Reduce manual status updates

### Phase 5 — Cloud and Account Features

- Explore user accounts and authentication
- Consider cloud database storage
- Consider syncing records across devices

## Project Goals

- Build a practical job application tracking tool
- Strengthen frontend JavaScript skills
- Practice software testing and quality assurance
- Explore Playwright test automation
- Gradually learn AI integration and workflow automation

## Disclaimer

JobTrack AI is a personal development project. Features listed in the roadmap are exploratory and have not necessarily been implemented.
