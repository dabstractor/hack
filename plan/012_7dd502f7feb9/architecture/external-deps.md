# External Dependencies & Reference Data — Session 012

---

## Gitmoji Reference Table (compiled-in for `PRP_COMMIT_STYLE=gitmoji`)

The PRD requires the canonical gitmoji reference table to be **compiled into
the binary at build time** (no network fetch). The canonical source is
<https://gitmoji.dev/> (the specification page). Below is the full canonical
set (~60+ entries) as of the latest stable release. The system prompt for the
`gitmoji` mode includes this table so the agent can select the correct emoji.

The table maps **emoji → description** (the agent selects the emoji that best
matches the change):

| Emoji | Code | Description |
| ----- | ---- | ----------- |
| 🎨 | art | Improve structure / format of the code |
| ⚡️ | zap | Improve performance |
| 🔥 | fire | Remove code or files |
| 🐛 | bug | Fix a bug |
| 🚑 | ambulance | Critical hotfix |
| ✨ | sparkles | Introduce new features |
| 📝 | memo | Update documentation |
| 🚀 | rocket | Deploy stuff |
| 💄 | lipstick | Add or update the UI and style files |
| 🎉 | tada | Begin a project |
| ✅ | white_check_mark | Add, update, or pass tests |
| 🔒 | lock | Fix security or privacy issues |
| 🔖 | bookmark | Release / Version tags |
| 🚨 | rotating_light | Fix compiler / linter warnings |
| 🚧 | construction | Work in progress |
| 💚 | green_heart | Fix CI Build |
| ⬇️ | arrow_down | Downgrade dependencies |
| ⬆️ | arrow_up | Upgrade dependencies |
| 📌 | pushpin | Pin dependencies to specific versions |
| 👷 | construction_worker | Add or update CI build system |
| 📈 | chart_with_upwards_trend | Add or update analytics or track code |
| ♻️ | recycle | Refactor code |
| ➕ | heavy_plus_sign | Add a dependency |
| ➖ | heavy_minus_sign | Remove a dependency |
| 🔧 | wrench | Add or update configuration files |
| 🔨 | hammer | Add or update development scripts |
| 🌐 | globe_with_meridians | Internationalization and localization |
| ✏️ | pencil2 | Fix typos |
| 💩 | poop | Write bad code that needs to be improved |
| ⏪️ | rewind | Revert changes |
| 🔀 | twisted_rightwards_arrows | Merge branches |
| 📦️ | package | Add or update compiled files or packages |
| 👽 | alien | Update code due to external API changes |
| 🚚 | truck | Move or rename resources |
| 📄 | page_facing_up | Add or update license |
| 💥 | boom | Introduce breaking changes |
| 🍱 | bento | Add or update assets |
| ♿️ | wheelchair | Improve accessibility |
| 💡 | bulb | Add or update comments in source code |
| 🍻 | beers | Write code drunkenly |
| 💬 | speech_balloon | Update text and literals |
| 🗃️ | card_file_box | Perform database related changes |
| 🔊 | loud_sound | Add or update logs |
| 🔇 | mute | Remove logs |
| 👥 | busts_in_silhouette | Add or update contributors |
| 🚸 | children_crossing | Improve user experience / usability |
| 🏗️ | building_construction | Make architectural changes |
| 📱 | iphone | Work on responsive design |
| 🤡 | clown_face | Mock things |
| 🥚 | egg | Add or update an easter egg |
| 🙈 | see_no_evil | Add or update a .gitignore file |
| 📸 | camera_flash | Add or update snapshots |
| ⚗️ | alembic | Perform experiments |
| 🔍 | mag | Improve SEO |
| 🏷️ | label | Add or update types |
| 🌱 | seedling | Add or update seed files |
| 🚩 | triangular_flag_on_post | Add, update, or remove feature flags |
| 🥅 | goal_net | Catch errors |
| 💫 | dizzy | Add or update animations and transitions |
| 🗑️ | wastebasket | Deprecate code that needs to be cleaned up |
| 🛂 | passport_control | Work on code related to authorization |
| 🩹 | adhesive_bandage | Simple fix for a non-critical issue |
| 🧐 | monocle | Data exploration |
| ⚰️ | coffin | Remove dead code |
| 🧪 | test_tube | Add a failing test |
| 👔 | necktie | Add or update business logic |
| 🩺 | stethoscope | Add or update healthcheck |
| 🧱 | bricks | Infrastructure related changes |
| 🧵 | thread | Add or update code related to multithreading or concurrency |
| 🦺 | safety_vest | Add or update code related to validation |

### Implementation note

The table should be embedded as a **template literal string** in the system
prompt builder (not a separate data file — keeping it inline avoids an extra
import and keeps the build self-contained). The PRD says "refreshed with the
same verification discipline as the model defaults" — i.e., a manual refresh
process, not a build-time fetch. The table above is the current canonical set.

---

## Conventional Commits Vocabulary

The `conventional` mode contract instructs the agent to emit:
```
type(scope): description
```
with the **standard type vocabulary** from the Conventional Commits spec
(https://www.conventionalcommits.org/):

- `feat` — a new feature
- `fix` — a bug fix
- `docs` — documentation only changes
- `style` — changes that do not affect the meaning of the code (white-space,
  formatting, missing semi-colons, etc.)
- `refactor` — a code change that neither fixes a bug nor adds a feature
- `perf` — a code change that improves performance
- `test` — adding missing tests or correcting existing tests
- `build` — changes that affect the build system or external dependencies
- `ci` — changes to CI configuration files and scripts
- `chore` — other changes that don't modify src or test files
- `revert` — reverts a previous commit

Scope is optional. Description should be ~50 characters, imperative mood.

### Relationship with the position layer

The PRD explicitly states: when `conventional` (or `gitmoji`) is combined with
`PRP_COMMIT_FORMAT=task-prefix`, both prefixes render:
`<position>: type(scope): description` or `<position>: <emoji> description`.
This is by design — a team wanting clean history sets
`PRP_COMMIT_FORMAT=plain`.