# Grok assistant

Grok is a chat bubble on every signed-in page, and an `@Grok` mention in a task comment. The board does not call a model itself. It posts a webhook and waits for the bot API to write the reply.

No tokens belong in the repository. Set them in the server `.env` only.

## Environment

| Name | Purpose |
| --- | --- |
| `GROK_WEBHOOK_URL` | Where the board POSTs. Empty means the bubble says `Grok isn't connected yet` and `@Grok` does not call out. |
| `GROK_WEBHOOK_SECRET_HEADER` | Header name for the shared secret. Sent only when both this and the secret are set. Example: `X-Grok-Secret` |
| `GROK_WEBHOOK_SECRET` | Header value. Example: `replace-with-a-long-random-string` |
| `BOT_API_TOKEN` | Bearer token for `/api/bot`. Empty disables the API (HTTP 503). Example: `replace-with-a-long-random-string` |
| `GROK_DAILY_LIMIT` | Messages per person per 24 hours. Default `100`. |
| `GROK_HOURLY_LIMIT` | Optional. Messages per person per hour. Default `20`. |
| `GROK_FILE_TTL_HOURS` | How long a Grok PDF is kept. Default `24`. Expired files are deleted by an hourly cleanup in the app process. |

Each chat message and each `@Grok` comment counts as one request. Over the limit, the person sees a short message and nothing is posted.

## Webhook

`POST` JSON, fire-and-forget, 10 second timeout. The board does not retry.

Chat:

```json
{
  "type": "chat",
  "request_id": "ab12cd34ef56ab12cd34ef56",
  "user": { "id": 4, "name": "Lindi Nkosi", "role": "user" },
  "text": "What is due today?",
  "thread_id": 4,
  "files": [
    { "id": 9, "filename": "quote.pdf", "size": 48211, "kind": "in" }
  ],
  "recent_context": [
    { "role": "user", "text": "What is due today?", "at": "2026-11-24T12:00:00.000Z" }
  ],
  "board_snapshot": {
    "users": [{ "id": 4, "name": "Lindi Nkosi" }],
    "projects": [{ "id": 2, "name": "Site" }],
    "tasks": [
      { "id": 18, "title": "Replace the inverter fan", "status": "in_progress", "assignee_id": 5, "assignee_ids": [5, 6], "due": "2026-11-25", "priority": "high" }
    ]
  },
  "board_url": "https://tasks.sunspec.co.za/"
}
```

Comment (`thread_id` is omitted; `task` is included):

```json
{
  "type": "comment",
  "request_id": "ab12cd34ef56ab12cd34ef56",
  "user": { "id": 4, "name": "Lindi Nkosi", "role": "user" },
  "text": "@[Grok](1) can you mark this done?",
  "task": {
    "id": 18,
    "title": "Replace the inverter fan",
    "status": "in_progress",
    "assignee": "Thabang Madikgetla",
    "due": "2026-11-25"
  },
  "files": [],
  "recent_context": [
    { "role": "Lindi Nkosi", "text": "@[Grok](1) can you mark this done?", "at": "2026-11-24T12:00:00.000Z" }
  ],
  "board_snapshot": {
    "users": [{ "id": 4, "name": "Lindi Nkosi" }],
    "projects": [{ "id": 2, "name": "Site" }],
    "tasks": [
      { "id": 18, "title": "Replace the inverter fan", "status": "in_progress", "assignee_id": 5, "assignee_ids": [5, 6], "due": "2026-11-25", "priority": "high" }
    ]
  },
  "board_url": "https://tasks.sunspec.co.za/tasks/18"
}
```

`recent_context` is the last 10 messages. Chat roles are `user` or `grok`. Comment roles are the author's name. `files` lists PDFs attached to that message. `thread_id` is the chat. A person can keep several chats; the first message's first 40 characters becomes the title until they rename it.

`board_snapshot` is the same on chat and comment webhooks. `users` is active people (`id`, `name`). `projects` is `id` and `name`. `tasks` is open work only (not Done, not removed): `id`, `title`, `status`, `assignee_id` (the first assignee), `assignee_ids` (everyone assigned), `due`, `priority`, at most 100, most recently updated first. Done tasks are left out so the bot can answer from this list without another call.

People attach PDFs in the Grok chat only, with the paperclip button. A comment that mentions `@Grok` is text. The bot can still attach a generated PDF to a chat reply or a task. Files are checked by the `%PDF` magic bytes. At most 5 files, 15 MB each. They are stored under `DATA_DIR/grok-files` with a random name. The row records `stored_name`, and `message_id` or `comment_id`, so the file can be downloaded and shown on the reply. Those two columns are how the file is found; they are not part of the webhook.

Reply to a chat with `POST /api/bot/chat/:thread_id/reply` and the same `request_id`. Reply to a comment with `POST /api/bot/tasks/:id/comments`.

While a reply is still pending, `POST /api/bot/chat/:thread_id/status` or `POST /api/bot/tasks/:id/status` with `{acting_user_id, request_id, text}` sets a short line under the "Got it, working on it…" indicator (`Reading the board…`, `Creating task…`). `text` is at most 160 characters. An empty `text` clears the line. The line is also cleared when the chat reply or the Grok comment lands. The board keeps polling every 3 seconds while any chat reply is pending, even if the panel is closed.

## Bot API

Base path `/api/bot`. Header `Authorization: Bearer <BOT_API_TOKEN>`.

Every write takes `acting_user_id`. The board applies that person's role the same way the pages do: a user can edit a task they created or are assigned, an admin can edit any task, and only the assignee can be implied by the same complete rules as the Complete button. There is no delete, and no user or password route.

The seeded user `Grok` (`grok@taskboard.local`) is `role=user`, inactive, and cannot sign in. It is hidden from assignees, the team page, and the user admin list. Bot comments are stored as that user.

Task changes and Grok comments are written to the task activity log as `Grok (on behalf of <name>)`. A chat reply has no task, so it is stored on the thread only.

```bash
TOKEN=replace-with-a-long-random-string
BASE=https://tasks.sunspec.co.za

curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/bot/tasks?status=todo&assignee=4&project=2&due_from=2026-11-01&due_to=2026-11-30&q=inverter"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/bot/tasks/18"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/bot/users"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/bot/projects"

curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"acting_user_id":4,"title":"Replace the inverter fan","status":"todo","priority":"high","due_date":"2026-11-25","assignee_id":5,"project":"Site"}' \
  "$BASE/api/bot/tasks"

curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"acting_user_id":4,"status":"in_progress"}' \
  "$BASE/api/bot/tasks/18"

curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"acting_user_id":4,"body":"The fan is on order."}' \
  "$BASE/api/bot/tasks/18/comments"

curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"acting_user_id":4,"request_id":"ab12cd34ef56ab12cd34ef56","text":"Reading the board…"}' \
  "$BASE/api/bot/chat/4/status"

curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"acting_user_id":4,"request_id":"ab12cd34ef56ab12cd34ef56","text":"Creating task…"}' \
  "$BASE/api/bot/tasks/18/status"

curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"acting_user_id":4,"request_id":"ab12cd34ef56ab12cd34ef56","text":"Two tasks are due today."}' \
  "$BASE/api/bot/chat/4/reply"

curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"acting_user_id":4}' \
  "$BASE/api/bot/complete/18"

curl -s -H "Authorization: Bearer $TOKEN" -o quote.pdf "$BASE/api/bot/files/9"

curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"acting_user_id":4,"filename":"answer.pdf","data":"JVBERi0xLjQK"}' \
  "$BASE/api/bot/chat/4/files"

curl -s -H "Authorization: Bearer $TOKEN" \
  -F "acting_user_id=4" -F "file=@answer.pdf;type=application/pdf" \
  "$BASE/api/bot/tasks/18/files"
```

`data` is the PDF as base64. A multipart upload uses the field name `file`. Either way the file is attached to the latest Grok reply in that chat, or the latest Grok comment on that task. `GET /api/bot/files/:id` downloads it until `GROK_FILE_TTL_HOURS` has passed.

Signed-in people download their own chat files, and any PDF on a task they can open, at `/files/:id`.

Nginx in front of the app must allow the upload: `client_max_body_size 80m`. Update the file that is actually enabled on the VPS, then reload nginx. The copies in `deploy/` already say 80m.

`POST` and `PATCH` accept `assignee_ids` (an array of user ids) and still accept a single `assignee_id`. `GET` task payloads include `assignee_id`, `assignee_ids`, and `assignees` (`id` and `name`). `PATCH` also accepts `title`, `description`, `status`, `priority`, `due` or `due_date`, and `project` or `project_id`. When `status` is `review`, `PATCH` accepts `reviewer_id` (an active user) and an optional `note`. That stores the reviewer, mentions them, and `GET` then includes `reviewer_id` and `reviewer`.

Nginx on `tasks.sunspec.co.za` proxies `/api/bot/` to the app on `127.0.0.1:8082`. The bearer token is the access control.
