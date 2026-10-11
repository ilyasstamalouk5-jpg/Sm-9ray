# Voice Bot

Discord bot that tracks voice-chat time, gives milestone roles, runs a small
Dirham (DH) economy with casino games and flag / map / logo guessing games, a color-role shop with a wardrobe, and shows profile / rank / leaderboard slash
commands as picture cards.

- Every voice channel counts, including AFK, muted, deafened, or alone.
- Time is saved continuously. A heartbeat is written about once a minute, so a
  crash or restart only loses the last minute or so.
- Database tables are created automatically when the bot starts.

## Environment variables

Set these in your host's "Environment variables" page. Never commit them.
See `.env.example` for the full list.

| Name | Required | What it is |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Bot token from the Discord Developer Portal (`DISCORD_BOT_TOKEN` is also accepted) |
| `DATABASE_URL` | yes | Postgres connection string (for example from Neon) |
| `TARGET_GUILD_ID` | yes | ID of the one Discord server the bot serves |
| `ADMIN_ROLE_ID` | no | Extra role allowed to use `/economy-admin` |
| `CURRENCY_IMAGE_URL` | no | Https link to the Dirham coin image |
| `ACTIVITY_TIMEZONE` | no | IANA time zone that decides where a day ends on the activity card (default `UTC`, for example `Africa/Casablanca`) |
| `MILESTONE_GUILD_ID` | no | Server that has the milestone roles |
| `MILESTONE_ROLE_1` ... `MILESTONE_ROLE_10` | no | Role ID for each milestone |
| `MILESTONE_ANNOUNCE_CHANNEL_ID` | no | Channel where milestone "Congratulations!" cards are posted (empty = no announcements) |
| `MILESTONE_BULLET` | no | Emoji in front of each line of the announcement (default 🏆) |
| `MILESTONE_CHECK_INTERVAL_MS` | no | How often milestones are checked (default 30000, minimum 10000) |
| `VOICE_REWARD_CHECK_INTERVAL_MS` | no | How often voice DH rewards are checked (default 60000, allowed 10000 to 3600000) |
| `QUIZ_MIN_REWARD` / `QUIZ_MAX_REWARD` | no | DH range of the guessing games (default 40 and 70) |
| `QUIZ_TIME_LIMIT_SECONDS` | no | Seconds to answer (default 15) |
| `QUIZ_COOLDOWN_SECONDS` | no | Wait before the same player can start the same game again (default 30) |
| `LOG_LEVEL` | no | `debug`, `info`, `warn` or `error` |

All economy settings (currency name, reward amounts, cooldowns, wager limits and game
rules) are optional too. `.env.example` lists them with their defaults.

Milestones are at 1h, 2h, 4h, 8h, 16h, 24h, 48h, 72h, 100h, 150h.

## Admin commands

`/voiceadmin` is only visible to server administrators, and it is checked again
every time it runs. Replies are private (only the admin sees them).

| Command | What it does |
| --- | --- |
| `/voiceadmin time-add user hours` | Adds voice time to a member |
| `/voiceadmin time-remove user hours` | Removes voice time (never below 0) |
| `/voiceadmin time-set user hours` | Sets a member's saved total |
| `/voiceadmin milestone-time tier hours` | Changes the hours a milestone needs |
| `/voiceadmin milestone-role tier role [remove_old]` | Changes the role a milestone gives |
| `/voiceadmin milestones` | Lists every milestone with its hours and role |
| `/voiceadmin season-reset [confirm]` | Starts a new season (see "Season reset" below) |

Notes:

- Hours can be decimals (`1.5` = 1h 30m).
- A milestone's hours must stay between the tiers on either side of it.
- Changes are saved in the database and win over the defaults in the code and
  the `MILESTONE_ROLE_*` settings, so you only need to edit them once.
- Milestones a member has already reached are never taken away, even if their
  time is lowered or a milestone's hours are raised.
- `remove_old` is off by default, so changing a role never strips it from
  members unless you ask.
- Every admin change is written to the bot's log with the admin's ID.

## Season reset (`/voiceadmin season-reset`)

A season reset makes every student start over from the first milestone. Run
`/voiceadmin season-reset` with no options first: it only shows a preview (how
many members and milestone records will be reset) and changes nothing. To run it,
type `/voiceadmin season-reset confirm:RESET` (capital letters). It cannot be undone.

| Reset | Kept exactly as it is |
| --- | --- |
| Total voice time, XP and the voice-reward checkpoint of every member | Wallets and the full Dirham history |
| Every reached/claimed milestone | Shop items, purchases and owned color roles |
| The study (milestone) roles, taken from every member who has them | Weekly tasks, milestone hours/role settings, economy settings |

Details worth knowing:

- Members who are in a voice channel when the reset runs keep earning time. Their
  running session is cut at the reset moment, and the new season counts from there.
- Old voice sessions are kept, so `/voicestats` history and weekly-task progress do
  not lose anything.
- Milestone Dirham rewards and hourly voice Dirhams can be earned again in the new
  season. Their wallet keys include the season number from season 2 on (season 1 keeps
  the old keys), so earlier payouts never block new ones. Dirhams already paid stay.
- Color roles bought in the shop are never removed. If a role sold in the shop were
  also set as a study role, the reset skips it and says so.
- The milestone check and the voice-reward timer pause while the reset runs, so they
  cannot write old data back.
- If a study role cannot be removed from some members (for example the bot's role is
  below it), the reply says how many; the progress reset has still happened, and those
  members keep the old role until you remove it by hand.
- Each reset is recorded in `discord_bot_seasons` (who, when, how many). The season
  number is the number of rows + 1. Migration `0006_add_seasons` creates the table.

## Dirham economy (DH)

A fictional, server-only currency. It has no real-world value. Amounts are whole
numbers, shown like `1,000 DH`. New members start with 0 DH.

### Ways to earn

| Source | Amount |
| --- | --- |
| Voice time (AFK channels count) | **50 DH for every full 60 minutes**; leftover minutes carry over |
| `/work` | **400 DH**, once every **4 hours** |
| `/daily` | **1,000 DH**, once every **24 hours** (no streak bonus) |
| Milestones | One-time reward per milestone, set with `MILESTONE_CURRENCY_REWARD_1` ... `_10` |
| `/guessflag`, `/guessmap`, `/guesslogo` | **40 to 70 DH** per correct answer (faster = more), one try, 15 seconds, 30 second cooldown per game |

Voice time that members had **before** this update is not paid retroactively
(see "Existing members" below). Only voice time from the update onward earns DH.

### Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/help` | everyone | Lists the commands that are really registered, grouped by category. A command that has no help entry yet still shows up under "Other" with its own description, so nothing is ever missing. Admin commands are shown only to administrators |
| `/profile [member]` | everyone | A profile card picture: avatar, voice rank tier, progress to the next milestone, total and 7-day voice time, DH balance |
| `/voicestats [member]` | everyone | The activity card: focus streak, today, this week, lifetime voice time, wallet, active days and a calendar of daily voice time |
| `/rank` | everyone | Your voice-time position |
| `/leaderboard` | everyone | The voice-time leaderboard as a picture card, with pages |
| `/topmoney` | everyone | The money leaderboard (members ranked by DH balance) as a picture card, with pages |
| `/balance [member]` | everyone | Shows a wallet (read-only) |
| `/shop` | everyone | The color shop as a gold-and-black picture card: pick a color, buy it, put it on |
| `/wardrobe` | everyone | Your own colors as a picture card: pick one to put it on (free), or take it off |
| `/work`, `/daily` | everyone | Claim the fixed rewards |
| `/transfer user amount` | everyone | Send DH to another member. The sender pays the amount; the receiver gets it minus a **5%** tax (rounded down, so payments under 20 DH are tax-free). Limits 10 to 100,000 DH. Change with `PAY_TAX_PERCENT`, `PAY_MIN_AMOUNT`, `PAY_MAX_AMOUNT`. |
| `/coinflip wager choice` | everyone | Heads or tails |
| `/mines wager [mines]` | everyone | 5x4 board, reveal tiles, cash out |
| `/blackjack wager` | everyone | Blackjack vs the dealer |
| `/appletower wager` | everyone | Pick the safe apple on each level |
| `/guessflag` | everyone | Guess the country from its flag (free to play, pays 40 to 70 DH) |
| `/guessmap` | everyone | Guess the highlighted country on a map (free to play, pays 40 to 70 DH) |
| `/guesslogo` | everyone | Guess the brand from its logo (free to play, pays 40 to 70 DH) |
| `/economy-admin give user amount` | Administrators, or the `ADMIN_ROLE_ID` role | Adds Dirhams to a member's balance (1 to 1,000,000,000 per use) |
| `/economy-admin take user amount` | Administrators, or the `ADMIN_ROLE_ID` role | Removes Dirhams from a member's balance (never below 0) |
| `/economy-admin image-view / image-set / image-clear` | Administrators, or the `ADMIN_ROLE_ID` role | Manage the currency image |
| `/shop-config add / edit / remove / list / check` | Administrators, or the `ADMIN_ROLE_ID` role | Choose the color roles for sale and their prices |
| `/voiceadmin ...` | Administrators | Existing voice-time and milestone tools |

Wagers are whole numbers from `MIN_BET` (10) to `MAX_BET` (10,000) DH. A member
can have one game in progress at a time. There is no text-activity leaderboard
because the bot does not track text messages (and never invents statistics).

### Adding and removing Dirhams as an admin

`/economy-admin give user amount` adds Dirhams to a member's wallet, and
`/economy-admin take user amount` removes them. The reply is private (only the
admin sees it) and shows the member's new balance.

- Only administrators (or the `ADMIN_ROLE_ID` role) can use them, checked again on
  the server every time they run.
- The amount is a whole number from 1 to 1,000,000,000. Bots have no wallets.
- `give` works even if the member has no wallet yet; it is created with the amount.
- `take` refuses when the member has less than the amount ("That member only has
  X DH...") and changes nothing, so a wallet can never go below 0. To empty a
  wallet, take exactly its balance.
- Every use is saved as its own row in the wallet ledger (kind `admin_give` or
  `admin_take`) with a note naming the admin, and is written to the bot's log with
  the admin's ID, the member's ID and the amount.
- Only that one member's wallet changes.

### Game rules and payouts

All randomness comes from the operating system's secure random generator, on the
server. Payouts are rounded down to whole DH.

- **Coinflip:** a win returns `COINFLIP_PAYOUT_PERCENT`% of the wager in total
  (195 = 1.95x, so a 100 DH win nets +95). A loss costs the wager.
- **Mines:** 20 tiles (5x4), 3 mines by default (`MINES_DEFAULT_COUNT`; players can
  choose 1 to `MINES_MAX_COUNT`). After k safe tiles the payout is
  `wager x (1 - edge) x product of (20-i)/(20-mines-i) for i < k`, with the edge
  set by `MINES_HOUSE_EDGE_PERCENT` (3%). Cash out after at least one safe tile.
- **Apple Tower:** `APPLE_TOWER_LEVELS` levels (8), three apples each, one safe.
  After n cleared levels the payout is `wager x (1 - edge) x 3^n`
  (`APPLE_TOWER_HOUSE_EDGE_PERCENT`, 3%). Reaching the top pays out automatically.
- **Blackjack:** one freshly shuffled 52-card deck per hand. Aces count 11 or 1.
  Dealer stands on all 17s (`BLACKJACK_DEALER_HITS_SOFT_17=true` makes the dealer
  hit soft 17). Win pays 1:1, natural blackjack pays 3:2
  (`BLACKJACK_NATURAL_PAYOUT_PERCENT`), a push returns the wager. Hit and stand only
  (no double down, split or insurance).
- **Safety cap:** no single game can pay more than `MAX_GAME_PAYOUT` (1,000,000 DH).
- **Timeouts and restarts:** games are saved in the database and survive restarts.
  A game with no move for `GAME_TIMEOUT_MINUTES` (10) is settled automatically:
  Mines/Apple Tower cash out the progress made (or refund the wager if no move
  was made), and Blackjack stands automatically.

### Guessing games (`/guessflag`, `/guessmap`, `/guesslogo`)

Three independent quiz games. They cost nothing to play and are not wagers, so they
do not use the "one game at a time" rule of the casino games.

- A picture (a flag, a highlighted country on a map, or a brand logo) is posted with
  **4 answer buttons**. Only the member who ran the command can answer.
- The player has **15 seconds** (`QUIZ_TIME_LIMIT_SECONDS`). The reward falls in a straight
  line from **70 DH** for an instant answer to **40 DH** at the last second
  (`QUIZ_MAX_REWARD`, `QUIZ_MIN_REWARD`). A late answer, a wrong answer or no answer pays nothing.
- One try per question. The message then shows the right answer and the buttons switch off.
- Each player can start a new round of the same game every **30 seconds**
  (`QUIZ_COOLDOWN_SECONDS`); the three games have separate cooldowns.
- The clock starts when the question is on screen, not when the command is sent.
- Rewards go to the wallet once per round and appear in the ledger as `quiz_flag`,
  `quiz_map` and `quiz_logo`. They are not counted as voice earnings on `/voicestats`.
- Open rounds live in the bot's memory only. If the bot restarts, an unanswered question
  simply shows "This round is already over" and nothing is lost or paid.
- Flags are loaded by Discord from `flagcdn.com`. Maps are drawn from the `world-atlas`
  package and logos from the `simple-icons` package (both installed by `pnpm install`).
  Countries or brands missing from the installed packages are skipped automatically; if
  a whole data package is missing, only that one game switches itself off.
- The country list is in `services/discord-bot/src/economy/quiz/quiz-data.ts`; add or
  remove countries and brands there.

### Milestone announcements (card + embed)

When a member newly reaches a milestone, the bot posts a "🎉 Congratulations!"
embed (member, unlocked role, requirement, reward) with a generated gold-and-black
card underneath. The card shows the server name, the member's avatar and
`@username`, the role, the milestone badge (for example `100h COMPLETED`), the
reward (or `REWARD PENDING` when none is set) and the next milestone with the hours
left. The Dirham coin appears in the reward box when an image is set.

- Each line of the embed starts with the bullet emoji, 🏆 by default (change it with
  `MILESTONE_BULLET`; if it is set on your host, that value wins). The member is mentioned
  on the "Member" line inside the embed. Mentions inside an embed show the name but do
  not send a notification.
- Turn it on by setting `MILESTONE_ANNOUNCE_CHANNEL_ID` to the channel's ID. Without
  it, nothing is posted and everything else works as before.
- Only the highest milestone reached at that moment is announced, and each
  milestone is announced once. Milestones members reached before this update are
  never announced.
- If the card cannot be drawn, the embed is still posted without the picture.
- The card uses the role's Discord name as its title. Decorative symbols the card
  font cannot draw are removed (small-caps letters become normal letters).
- The font files live in `services/discord-bot/assets/fonts` (Poppins, open
  license). The card drawing uses the `@napi-rs/canvas` package, installed by
  `pnpm install`.

### Activity card (`/voicestats`)

`/voicestats` replies with a generated picture on the gold-and-black background in
`services/discord-bot/assets/activity-card-bg.jpg` (the layout code is in
`services/discord-bot/src/activity`). It shows the member's avatar and name, then six
boxes and a calendar:

| Box | What it shows |
| --- | --- |
| Focus streak | Days in a row with voice time, ending today (or yesterday if today is still empty). Says "Personal best record" when it equals the longest streak |
| Study today | Voice time today, DH earned today, and how it compares with the previous six days |
| Wallet balance | The DH balance, DH earned today and the voice rate per hour |
| This week | Voice time in the last 7 days (today included) and DH earned from voice in that window |
| Lifetime focus | Total voice time (the same total `/profile` shows) and all DH ever earned from voice |
| Active days | Days with any voice time, and the average per day over the last 7 days |

The calendar has 46 weeks (Monday to Sunday, the last column is the current week). A
gem appears on every day with voice time and gets bigger and brighter at 1 minute,
30 minutes, 90 minutes and 3 hours. Today has a gold ring (and a gold gem if there is
activity). The four boxes underneath repeat active days, longest streak, wallet balance
and the 7-day average.

- Days, streaks and the calendar come from the stored voice-session records, split at
  midnight in `ACTIVITY_TIMEZONE`. Time added with `/voiceadmin` has no sessions, so it
  counts toward lifetime focus but not toward the calendar or streaks.
- DH earned comes from the wallet ledger (voice rewards only, not `/work`, `/daily` or
  games). If the ledger cannot be read, the card still draws and leaves those figures out.
- Without the economy, the wallet box shows a dash and no DH amounts appear.
- If the picture cannot be drawn, `/voicestats` falls back to the older text embed.

### Profile card (`/profile`)

`/profile` replies with a generated picture on the gold-and-black background in
`services/discord-bot/assets/profile-card-bg.jpg` (the layout code is in
`services/discord-bot/src/profile`). It shows the member's avatar, name and
@username, the server voice position, the milestone rank with a progress bar to
the next goal, total voice time, voice time in the last 7 days, and the DH
balance (with the coin when an image is set).

- "This week" is added up from the stored voice-session records; a session that
  is still running counts up to now.
- If the picture cannot be drawn, `/profile` falls back to the older text embed.
- The background is a copy of the supplied artwork with the example word "RANK"
  removed, so the longer label can be drawn there.

### Leaderboard card (`/leaderboard`)

`/leaderboard` replies with a generated picture on the gold-and-black layout in
`services/discord-bot/assets/leaderboard-card-bg.jpg` (the code is in
`services/discord-bot/src/leaderboard`).

- **Left side, every page:** the overall top three: first place in the large card, second
  and third in the two medium cards.
- **Right side:** seven rows per page that carry on from the previous page: page 1 shows
  ranks 4 to 10, page 2 shows 11 to 17, page 3 shows 18 to 24, and so on.
- **Bottom left:** the member who ran the command, with their own rank and voice time, even
  when they are outside the top 100.
- **Header:** the line under the title reads "2BACSM • ALL TIME" (set in
  `LEADERBOARD_SERVER_LABEL` in `leaderboard-card-data.ts`); the top right shows the page.
- The Previous / Next buttons switch pages. Only the member who ran the command can use them.
- `/leaderboard` is voice only. The money ranking is `/topmoney`.
- Only the top 100 by voice time are listed (14 pages).
- Names are cleaned like the other cards: decorative symbols the font cannot draw are
  removed, falling back to the username.
- Members who left the server show as "Former member" with a letter instead of an avatar.
- If the picture cannot be drawn, the older text embed is sent instead.

### Money leaderboard card (`/topmoney`)

`/topmoney` replies with a generated picture on the background in
`services/discord-bot/assets/money-leaderboard-card-bg.jpg` (the code is in
`services/discord-bot/src/leaderboard`, files starting with `money-leaderboard`). It uses the same layout as the voice leaderboard card.

- **Left side, every page:** the three members with the most DH.
- **Right side:** seven rows per page that carry on from the previous page (4 to 10,
  then 11 to 17, and so on).
- **Bottom left:** the member who ran the command, with their rank and balance.
  Members with an empty wallet show as "Unranked".
- **Header:** the line under the title reads "2BACSM • RICHEST MEMBERS" (the server label
  is `LEADERBOARD_SERVER_LABEL` in `leaderboard-card-data.ts`); the top right shows the page.
- Only members with more than 0 DH are ranked, and only the top 100 are listed (14 pages).
  Ties are ordered by user ID, so the order never changes between pages.
- Amounts are shown like `231,715 DH`, using `CURRENCY_SYMBOL`.
- Members who left the server show as "Former member" with a letter instead of an avatar.
- If the picture cannot be drawn, a text list is sent instead.

### The Dirham image

The image is optional. Without one, everything shows plain `DH` text.

1. The coin picture is saved in this repo as `assets/dirham.png`. After you push it
   to GitHub, its link is
   `https://raw.githubusercontent.com/<your-user>/<your-repo>/<branch>/assets/dirham.png`
   (the repo must be public for Discord to load it).
2. In Discord, run `/economy-admin image-set url:<that link>`. The bot downloads it
   once to check it is a real PNG/JPEG/GIF/WebP under 5 MB, then saves the link.
3. **Replace:** upload a new picture to GitHub (or anywhere with a public https link)
   and run `/economy-admin image-set` again with the new link.
4. **Remove:** `/economy-admin image-clear`.
5. **See the current one:** `/economy-admin image-view`.

Discord attachment links expire, so uploading a picture straight into the command
is not supported. Use a permanent link such as the GitHub one above. As an
alternative to the command you can set `CURRENCY_IMAGE_URL`; an image saved with
`/economy-admin` takes priority over it.

### Existing members

The database update records each member's current voice time as "already
rewarded", so nobody receives a surprise payout for time earned before the
economy existed. If you want to pay for past voice time as well, set
`credited_seconds` to 0 in the `discord_bot_voice_reward_checkpoints` table for the
members you choose.

If you set `MILESTONE_CURRENCY_REWARD_n` after members have already reached
milestone n, those members receive that reward the next time the bot checks
(once each). Leave a reward empty if you do not want that.

### Before you deploy

1. Add `TARGET_GUILD_ID` (required) and make sure `DATABASE_URL` and the Discord
   token are set. Optionally `ADMIN_ROLE_ID`, `CURRENCY_IMAGE_URL` and the
   `MILESTONE_CURRENCY_REWARD_*` values.
2. Deploy. The new tables are created automatically at startup by migration
   `0003_add_economy.sql`; nothing existing is changed or deleted.
3. The bot registers its slash commands in your server on startup and removes older
   global copies of the same commands, so members never see duplicates.
4. Run `/economy-admin image-set` if you want the coin picture.
5. Run `pnpm install` once after updating: the guessing games need two new packages
   (`world-atlas` for the maps and `simple-icons` for the logos).

## Weekly study task (`/weekly-task`)

Admins post a study challenge as a black-and-gold card in any channel. Members study in voice, then press **Claim reward** on the card.

| Command | What it does |
| --- | --- |
| `/weekly-task create title hours reward [description] [days] [channel]` | Starts a task and posts its card (default: this channel, 7 days). |
| `/weekly-task list` | Shows the open tasks with their IDs and how many members finished. |
| `/weekly-task end id` | Ends a task now. Its card turns gray and the buttons stop working. |

- **Progress** is the member's voice time between the moment the task was created and its deadline (from the same voice records as `/voicestats`; AFK channels count like they do for voice rewards).
- **Reward** is paid once per member through the wallet ledger (kind `weekly_task`), so pressing the button twice, or at the same moment, cannot pay twice.
- **Buttons:** 🎁 *Claim reward* pays if the goal is reached, otherwise tells the member how much is left. 📊 *My progress* shows a private progress bar. Answers are only visible to the member who pressed.
- **Claim window:** members can still claim for 24 hours after the deadline. Up to 3 tasks can be open at once.
- Needs the bot to be able to view the channel, send messages, embed links and attach files. If posting fails the task is cancelled.
- Only Administrators (or the `ADMIN_ROLE_ID` role) can use the command. Adds one table (migration `0005_add_weekly_tasks`), applied automatically at startup.

## Color shop

Members spend Dirhams (DH) to buy **name-color roles**. Admins decide which roles
are for sale and how much they cost. Prices are meant to be a long-term goal, not
something a member can afford in a day.

| Step | What it adds | Status |
| --- | --- | --- |
| 1 | Foundation: database tables, safe purchase logic, role rules, tests | **done** |
| 2 | Admin config: `/shop-config` to add, edit, remove, list and check color roles | **done** |
| 3 | Member shop: `/shop` as a gold-and-black picture card with a buy flow | **done** |
| 4 | Wardrobe `/wardrobe`, `/help` entries, final polish | **done** |

### Step 1: foundation

The engine under the shop. On its own it adds no commands; those come in steps 2 and 3.

- **Two new tables** (created automatically by migration `0004_add_color_shop.sql`;
  nothing existing is changed): `discord_bot_shop_items` (the roles on sale) and
  `discord_bot_shop_purchases` (who owns what).
- **Buying is atomic.** The charge and the ownership record are saved in one
  database transaction, using the same wallet lock and ledger as every other
  payment (ledger kind `shop_purchase`). Double clicks, two clicks at the same
  moment and restarts can never charge twice.
- **Price check.** The buy button remembers the price the member saw. If an admin
  changes the price in between, the purchase is refused and nobody is charged.
- **Nobody pays for a role the bot cannot give.** Before charging, the bot checks
  that it can assign the role. If Discord still refuses right after payment, the
  member keeps the color and can put it on later for free.
- **Buy once, own forever.** A member can switch between owned colors for free and
  wears one shop color at a time (the others are removed automatically). Removing
  an item from sale hides it from the shop but members who bought it keep it.
- **Roles that can never be sold:** `@everyone`, bot-managed roles, your milestone
  roles, the `ADMIN_ROLE_ID` role, and any role with powerful permissions
  (Administrator, Manage Roles, Manage Server, Kick/Ban, Manage Messages and similar).
  Shop roles must be purely cosmetic, otherwise a member could buy moderation powers.
- Limits: price from 1 to 1,000,000,000 DH, at most 50 colors, names up to 32
  characters, descriptions up to 80.

### Step 2: admin config (`/shop-config`)

Only server administrators (or the `ADMIN_ROLE_ID` role) can use it, it is checked
again every time it runs, and every reply is private. The shop is empty until you
add colors.

| Command | What it does |
| --- | --- |
| `/shop-config add role price [name] [description]` | Puts a role on sale. `name` is what members see (default: the role's name) and `description` is a short line under it |
| `/shop-config edit role [price] [name] [description] [position]` | Changes a color in the shop. `position` 1 shows it first. Type `-` as the description to clear it |
| `/shop-config remove role` | Takes it off sale. Members who already bought it keep it and can still wear it. You can add the same role again later |
| `/shop-config list` | Every color with its price, position and number of owners |
| `/shop-config check` | Tests every color: role still exists, the bot can give it, it has no powerful permissions, it has a color, and no higher colored role hides it |

**How to set up a color role**

1. In Server Settings > Roles, create the role (for example "Royal Gold"), pick its
   **color**, and give it **no permissions**.
2. Drag it **above** your colored milestone roles and **below** the bot's own role.
   Discord shows the color of the highest colored role a member has, so a colored
   role above it would hide it.
3. Run `/shop-config add role:@Royal Gold price:250000 description:Rare gold`.
4. Run `/shop-config check`. It tells you what to fix, if anything.

`add` also warns you right away when the role has no color or when a milestone role
above it will hide its color.

Changing a price is safe at any time: nobody is ever charged a price they did not
see (see "Price check" above). Edits and removals are written to the bot's log with
the admin's ID. Members see what you set up through `/shop` (step 3).

**Setting prices.** Members earn at most about 3,400 DH a day from `/work` and
`/daily`, plus 50 DH per hour in voice. As a starting point (you set the real
prices in step 2):

| Tier | Price | About how long at the daily claim rate |
| --- | --- | --- |
| Common | 100,000 DH | about 1 month |
| Rare | 250,000 DH | about 2.5 months |
| Epic | 500,000 DH | about 5 months |
| Legendary | 1,000,000 DH | about 10 months |

Code lives in `services/discord-bot/src/shop` and is tested in
`services/discord-bot/tests/shop-service.test.ts`.

### Step 3: member shop (`/shop`)

Anyone can use it. The reply is a gold-and-black picture card, six colors per page
(3 across, 2 down), with **Previous / Next** buttons when there is more than one
page. Each color shows its name in the role's color, a color band, the price
(dimmed while the member cannot afford it yet), and an **OWNED** or **WEARING**
badge. The footer shows the member's name and Dirham balance. If drawing ever
fails, a plain text list is sent instead, so `/shop` always answers.

**Buy flow**

1. Choose a color in the menu under the card (the numbers match the card).
2. A detail view shows the price, the member's balance and what happens next.
   - Not owned: **Buy for N DH** (greyed out with "You need N more" when the
     balance is too low).
   - Owned: **Put it on** (free).
   - Wearing it now: **Take it off**.
3. After buying, the color is put on automatically, replacing any other shop color.
   A result message shows the new balance and a **Back to the shop** button.

Safety is the same as in step 1: the charge and ownership are saved together, the
price the member saw is re-checked at the moment they press Buy, and nobody pays
for a role the bot cannot give. If Discord refuses the role change right after
payment, the member keeps the color and can put it on later for free.

Only the member who opened `/shop` can use its buttons and menu; anyone else who
presses them is told to run `/shop` themselves. The card reads each role's live
color from Discord (the color saved by `/shop-config` is the fallback).

Code: `services/discord-bot/src/shop/shop-card*.ts` (card), `shop-ids.ts` (button
IDs) and `services/discord-bot/src/commands/shop-commands.ts` (command and buy
flow). Tests: `tests/shop-card.test.ts` and `tests/shop-ids.test.ts`.

### Step 4: wardrobe (`/wardrobe`)

Anyone can use it. It is the member's own colors as a picture card in the same
gold-and-black style as `/shop`, six per page, with **Previous / Next** buttons
when there are more. Nothing is bought here, so there are no prices: every tile
says "Free to wear", with an **OWNED** or **WEARING** badge.

- **Put a color on:** choose it in the menu under the card. It is on right away,
  replacing any other shop color, and the card redraws so the **WEARING** badge
  moves. This is always free.
- **Take it off:** the red **Take off** button removes the worn color (greyed out
  when none is worn). The member still owns it.
- **Colors taken off sale** (by `/shop-config remove`) stay in the wardrobe,
  because buying is permanent.
- **Empty wardrobe:** the card says so and points to `/shop`.
- If Discord refuses a role change, the member gets a private message saying what
  to ask an admin to check (the bot's role must sit above the color roles and have
  Manage Roles). If drawing the card fails, a plain text list is sent instead.

Only the member who opened `/wardrobe` can use its buttons and menu. The card
reuses the shop's drawing code with a "wardrobe" mode. The detail view in `/shop`
also offers **Put it on** and **Take it off** for colors that member already owns,
so nobody hits a dead end there.

Code: `commands/shop-commands.ts` (wardrobe command and handlers),
`shop/shop-ids.ts` (the `wd|` button IDs) and the wardrobe mode in
`shop/shop-card-data.ts`. Tests: `tests/shop-card.test.ts` and
`tests/shop-ids.test.ts`.

The color shop is complete: foundation, admin config, `/shop` and `/wardrobe`.


## Hosting notes

- Run exactly one copy of the bot. If your host offers a deploy strategy, pick
  "stop the old version before starting the new one" so two copies never run at
  the same time.
- The Discord Developer Portal needs the **Server Members Intent** turned on.
- The bot's role must be above the milestone roles in the server's role list,
  and it needs the **Manage Roles** permission.

## Commands (for developers)

Needs Node 24 and pnpm 10 (the repo pins the pnpm version).

```
pnpm install
pnpm typecheck
pnpm test
pnpm start
```

Project layout:

- `services/discord-bot/src`: the bot (`bot` startup, `commands`, `voice`, `milestones`,
  `economy` with `games` and `quiz`, `shop`, `profile`, `activity`, `leaderboard`, `rewards`, `database`)
- `services/discord-bot/tests`: automated tests (`pnpm test`)
- `services/discord-bot/assets`: card backgrounds and the Poppins fonts
- `lib/db`: database tables (`src/schema`) and SQL migrations (`migrations`, `0000` to `0004`)
- `assets/dirham.png`: the coin picture
