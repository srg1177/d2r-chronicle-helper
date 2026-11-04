# d2r-chronicle-helper

A web notebook for the **Chronicle** in Diablo II: Resurrected (Reign of the Warlock). The
in-game Chronicle only tells you an entry's base item until you find it. This app lists every
entry with both names, its stats, and a box to mark the ones you have, so you can see exactly
which Uniques, Sets and Runewords you're still missing.

- **All Chronicle entries:** 409 Uniques, 135 Set items (34 sets) and 99 Runewords, built from the
  game's own data tables. Items the game leaves out of the Chronicle are excluded.
- **Chronicle-style window:** Unique / Sets / Runewords tabs, Normal / Exceptional / Elite filters,
  and the game's Armor / Weapons / Accessories categories.
- **Both names on every row:** the real name (gold for uniques and runewords, green for sets) and
  the base item you see before identifying it.
- **Game-style tooltips:** base stats, required level, properties, and for set items the other
  pieces and every set bonus.
- **Search** by name, base item, set, rune or property (for example "faster cast").
- **Filters and count:** All / Discovered / Undiscovered, with a "Showing X of Y · Z marked" count.
- **Accounts:** each user has their own saved marks in PostgreSQL.
- **Reset and log out:** buttons under the progress bar. Reset clears the current tab's marks or
  all of them, after a confirmation.

## Run

Requires Docker with Compose.

```bash
docker compose up -d --build
```

Open http://localhost:8080 and log in as **Deckard** / **Cain**, or create an account.

```bash
docker compose down        # stop; accounts and marks are kept
docker compose down -v     # stop and delete all accounts and marks
```

### Running in WSL

Windows shuts the WSL distro down when no WSL terminal is open, which also stops Docker and the
site. Keep an Ubuntu terminal open while you use it. The containers restart on their own the next
time WSL starts, and no data is lost.

## Settings

Copy `.env.example` to `.env` and edit it before the first start. `.env` is git-ignored.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Port the site is served on |
| `DEFAULT_USERNAME` / `DEFAULT_PASSWORD` | `Deckard` / `Cain` | Account created on first start. Changing these later doesn't change an existing account. Leave either empty to skip it. |
| `ALLOW_REGISTRATION` | `true` | `false` hides "Create a new account" |
| `SESSION_DAYS` | `30` | How long a login lasts |
| `POSTGRES_PASSWORD` | `chronicle` | Database password between the containers |

## How it's built

```
docker-compose.yml   web + api + db
web/                 the page (HTML/CSS/JS) served by nginx, which forwards /api to the API
api/                 Node + Express: accounts, login sessions, marks
tools/build_data.py  generates web/data.js from the game's data tables
```

- **db:** PostgreSQL 16 with tables `users`, `sessions` and `marks`, created by the API on start.
  Data lives in the `pgdata` volume.
- **api:** passwords are hashed with bcrypt. Logins use a random session token in an HttpOnly
  cookie; only its SHA-256 hash is stored.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/config` | Whether registration is open |
| `POST /api/register`, `POST /api/login`, `POST /api/logout` | Accounts and sessions |
| `GET /api/me` | Current user |
| `GET /api/marks` | Your marked entry ids |
| `PUT /api/marks/:id`, `DELETE /api/marks/:id` | Mark / unmark an entry |
| `DELETE /api/marks` | Reset: clears the ids in the body `{"ids": [...]}`, or all marks with no body |

## Updating the item data after a game patch

The item lists come from the JSON exports of the game's data tables at
[blizzhackers/d2data](https://github.com/blizzhackers/d2data) (`json/` folder). Download the files
listed at the top of `tools/build_data.py` into a folder, then:

```bash
python3 -I tools/build_data.py /path/to/d2data-json web/data.js
docker compose up -d --build web
```

Entry ids come from the game's own row ids, so saved marks normally carry over to a new build.

## Known gaps

- The game data doesn't name the Warlock's three skill trees. The tooltips call them Chaos,
  Eldritch and Demon, inferred from the skills on each page.
- Rainbow Facet has 8 versions in the data. They're listed as 8 entries ("Variant 1" to "8"), and
  it's unconfirmed whether the in-game Chronicle counts them separately.
- The Runewords tab groups entries by the game's runeword categories (Body Armor, Helms, Offhand,
  Melee and Missile weapons). How the in-game tab groups them is unconfirmed.

---

Fan-made tool, not affiliated with or endorsed by Blizzard Entertainment. Diablo is a trademark of
Blizzard Entertainment, Inc.
