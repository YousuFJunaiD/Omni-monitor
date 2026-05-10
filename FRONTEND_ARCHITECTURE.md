# Frontend Architecture Status

This project currently has two frontend systems in the repository.

## Active production system

The deployed entry path is:

```text
index.html -> src/main.jsx -> src/styles.css
```

Edit these files for production UI behavior today:

- `src/main.jsx`
- `src/styles.css`

The active responsive strategy is:

- desktop: `1101px` and up
- tablet / compact rail: `769px` to `1100px`
- mobile app shell: `768px` and down
- compact mobile: `420px` and down

## Dormant system

The following files are present but are not mounted by `index.html` today:

- `src/App.jsx`
- `src/layouts/*`
- `src/screens/*`
- `src/components/tasks/KanbanBoard.jsx`
- `src/styles/*`
- `src/context/DashboardContext.jsx`

Do not assume edits to the dormant system affect production. Only migrate to it through an explicit architecture migration that changes the entry path and verifies auth, routing, dashboard context, services, tasks, notifications, and mobile behavior end to end.

## Stabilization rule

Until a migration is intentionally planned, production fixes should preserve the active entry path and avoid mixing active CSS with dormant split CSS.
