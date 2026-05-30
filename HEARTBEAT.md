# HEARTBEAT.md - Periodic Checks

# Add tasks below when you want the agent to check something periodically.

## Daily/Regular Checks (rotate through these 2-4 times per day)

- **Email** - Any urgent unread messages? (if email integration available)
- **Calendar** - Upcoming events in next 24-48h? (if calendar integration available)
- **Git Status** - Check for uncommitted changes or updates needed in ClearDoc
- **Documentation** - Review and update MEMORY.md with insights from daily files
- **Dependencies** - Check for outdated npm packages (npm outdated)
- **Build Health** - Verify Next.js dev server can start without errors

## Weekly Checks

- **Memory Maintenance** - Review recent memory/YYYY-MM-DD.md files and distill learnings into MEMORY.md
- **Project Health** - Run tests, check for breaking changes, update README if needed
- **Security** - Check for known vulnerabilities in dependencies (npm audit)

## Tracking

Track your checks in `memory/heartbeat-state.json`:

```json
{
  "lastChecks": {
    "email": null,
    "calendar": null,
    "git": null,
    "docs": null,
    "deps": null,
    "build": null
  }
}
```

## When to Reach Out

- Important email arrived (if applicable)
- Calendar event coming up (<2h)
- Something interesting you found in code review
- It's been >8h since you said anything
- Git status shows uncommitted changes that should be addressed
- Documentation needs updating based on recent work

## When to Stay Quiet (HEARTBEAT_OK)

- Late night (23:00-08:00) unless urgent
- Human is clearly busy
- Nothing new since last check
- You just checked <30 minutes ago

## Proactive Work You Can Do Without Asking

- Read and organize memory files
- Check on projects (git status, etc.)
- Update documentation (README.md, API docs)
- Commit and push your own changes (with descriptive messages)
- Review and update MEMORY.md (see below)
- Run linting/formatting checks
- Check for and install minor dependency updates

## Memory Maintenance (During Heartbeats)

Periodically (every few days), use a heartbeat to:

1. Read through recent `memory/YYYY-MM-DD.md` files
2. Identify significant events, lessons, or insights worth keeping long-term
3. Update `MEMORY.md` with distilled learnings
4. Remove outdated info from MEMORY.md that's no longer relevant

Think of it like a human reviewing their journal and updating their mental model. Daily files are raw notes; MEMORY.md is curated wisdom.