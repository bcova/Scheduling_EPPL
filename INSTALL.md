# EPPL Desk Scheduler: Install Guide

About 10 minutes. You only do this once.

**The idea (an analogy):** think of the scheduler as a *new notebook* that is allowed to
*peek through a window* at your programs sheet. It can read the programs, but it can't reach
through and change them. Your programs data stays safe.

---

## Part A: Make the notebook

1. Go to <https://sheets.new> (makes a blank Google Sheet).
2. Name it **EPPL Desk Scheduler**.

## Part B: Put the code in

3. In that sheet: **Extensions → Apps Script**. A code editor opens in a new tab.
4. Left side, click the gear ⚙️ **Project Settings**. Tick **"Show 'appsscript.json' manifest file in editor"**.
5. Back on the **Editor** (`< >` icon). You'll see `Code.gs` and `appsscript.json`.
6. Open **`Code.gs`**. Delete everything in it. Paste in the full contents of **`src/Code.gs`** from this repo.
7. Click **+ → Script**, name it **`Logic`**. Delete what's in it. Paste in **`src/Logic.gs`**.
8. Click **+ → Script** again, name it **`WebApp`**. Paste in **`src/WebApp.gs`**.
9. Click **+ → HTML**, name it **`Index`** (exactly, capital I). Paste in **`src/Index.html`**.
10. Open **`appsscript.json`**. Replace its contents with **`src/appsscript.json`**.
11. Click 💾 **Save project**.

## Part C: Turn it on

12. Go back to the sheet tab and **refresh the page**. A new menu appears: **📅 Scheduler**.
13. Click **📅 Scheduler → 1. Set up / repair tabs**.
14. Google asks for permission (it needs to read the programs sheet and use Calendar).
    Click **Review permissions**, pick your account, then **Advanced → Go to EPPL Desk Scheduler (unsafe) → Allow**.
    (The "unsafe" warning shows because you wrote it yourself, not because anything is wrong.)
15. Run **Set up** again if it stopped after the permission step.

You now have these tabs: Settings, Staff, Hours, Coverage, Time Off, AS Shifts, YS Shifts,
Programs (auto), Warnings.

## Part D: Fill in the basics

| Tab | What to do |
|---|---|
| **Staff** | Staff names are pre-filled. Set each person's **Dept** (AS / YS / Both). Fill in **Email** and **Role** for the people who will sign in to the web app (see Part F). Optional: a weekly desk-hour cap, and "Also Known As" for other spellings. |
| **Hours** | I **guessed** the open hours. Fix them. |
| **Coverage** | Minimum people on each desk by day. Starts at 1. |
| **Settings** | Leave the Programs Sheet ID (it's your **copy**). Add a **Calendar ID**: use a **TEST calendar** first. |
| **Time Off** | Add vacations/sick days: Name, first day, last day. |

To make a test calendar: Google Calendar → **Other calendars +** → **Create new calendar** →
name it "EPPL Scheduler TEST". Then its **Settings → Integrate calendar → Calendar ID**.

## Part E: Daily use

1. **📅 Scheduler → 2. Refresh programs**: pulls the latest programs. Do this whenever programs change.
2. Schedulers type shifts on **AS Shifts** or **YS Shifts** (Date, Name, Start, End).
3. **📅 Scheduler → 3. Check schedule**: bad rows turn red/yellow and the **Warnings** tab explains why.
4. **📅 Scheduler → 4. Publish week to calendar**: creates events like **"Katie - YS Desk"**.
   Running it again updates the same events. It never creates duplicates and never touches
   events you typed in by hand.


## Part F: Turn on the web interface

The web app is the pretty front door. The sheet stays the filing cabinet behind it.

1. In the Apps Script editor: **Deploy → New deployment**.
2. Click the gear ⚙️ next to "Select type" → **Web app**.
3. Set:
   - **Execute as:** *Me*
   - **Who has access:** *Anyone within Elmwood Park Public Library* (your Google Workspace domain)
4. Click **Deploy**, approve the permissions, and **copy the Web app URL**. Share that link with staff or bookmark it.

**Who can do what** is set on the **Staff** tab:

| Role column says | They can |
|---|---|
| *(blank)* | **View** everything and use **My Shifts** |
| `AS Scheduler` | Edit the **AS** desk |
| `YS Scheduler` | Edit the **YS** desk |
| `Admin` | Edit **both** desks |

- A person is matched by their **Email** on the Staff tab (the same Google account they sign in with).
- Anyone whose email isn't on the Staff tab can still view; they just can't edit.
- Admins from your programs sheet's Lists tab are pre-filled as Admin.
- The server re-checks permissions on every save, so nobody can edit by tricking the page.

**Using it**
- **Add a shift:** drag on an empty spot in a day (or just click one).
- **Move a shift:** drag it. Drag its top or bottom edge to resize.
- A **red tooltip appears while you drag** if it would clash with a program, time off or a closure.
- The thin bar on the left of each day is coverage: green = covered, orange = short, red = nobody.
- Click a name in the sidebar to highlight them and the programs they run.
- **Refresh programs** and **Publish week** do the same thing as the menu items.

**After you change any code:** Deploy → **Manage deployments** → ✏️ edit → Version: **New version** → Deploy. (The link stays the same.)

**Trying the screen on your own computer first (optional, for tinkering):**
`node dev/build-preview.js`, then open `dev/preview.html?role=ys` in a browser. It uses fake data. Roles to try: `admin`, `as`, `ys`, `staff`.

## Switching to the REAL programs sheet later

1. Open the real programs sheet. Copy the long code in its address between `/d/` and `/edit`.
2. In the scheduler's **Settings** tab, paste it over **Programs Sheet ID**.
3. Make sure you (and anyone who runs the scheduler) can at least *view* the real sheet.
4. Run **2. Refresh programs**.

Nothing else changes. The scheduler only ever reads the programs sheet.

## What the checker looks for

- Someone on desk **while running a program** (setup and teardown included; prep time is ignored)
- A desk **below minimum coverage** (checked in 30-minute slots)
- Someone **over their weekly hour cap**
- Someone scheduled during **time off**
- A shift on a **closure day** or outside **open hours**
- A name that **isn't on the Staff tab** (typo)
- Someone **double-booked**

## Which programs count as "keeps staff busy"?

Skipped on purpose: **Passive** programs, **All Day** events, anything on the
**Non Date Blocking Programs** list (Take & Makes, Book Bags, Birthday Club...),
and cancelled / denied programs. Staff named "Outside", "All Staff" or "N/A" block nobody.
Active programs with a start *and* end date are treated as happening every day in that range.

## If something goes wrong

- **"Tab is missing"**: run *1. Set up / repair tabs* again.
- **"Could not open the programs sheet"**: check the ID on Settings and that you have access to it.
- **A person isn't being flagged for their program**: the refresh alert lists staff names it couldn't match.
  Add them on the Staff tab (use *Also Known As* for different spellings).
- **Shift dates look weird**: type them like `5/4/2026` and times like `9:00 AM`.
