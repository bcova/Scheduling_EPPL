# Scheduling_EPPL

Desk-shift scheduler for the Elmwood Park Public Library, built as a Google Sheets + Apps Script add-on.
Adult Services (AS) and Youth Services (YS) each have their own shift tab. The scheduler reads the library's
programs sheet (read-only) and warns when someone is scheduled on desk while running a program.

- **Install:** see [INSTALL.md](INSTALL.md)
- `src/Logic.gs`: pure scheduling logic (no Google APIs)
- `src/Code.gs`: sheet/calendar I/O and the 📅 Scheduler menu
- `tests/logic.test.js`: run with `node tests/logic.test.js`
