# Sunspec task board

Shared task board for the Sunspec Solar / ControlWorx team. Node 22, Express, and SQLite. The app listens on `127.0.0.1:8082`. Put nginx in front of it.

Accounts are created by a superuser or admin. There is no self sign-up. The first account is a **superuser**.

## Serve it on the VPS (http://160.119.249.201:8090)

The board is reached on port **8090**. Nothing on ports 80 or 443 is changed, so the existing sites stay as they are. Login works over plain HTTP: the session cookie is marked `Secure` only when the request is HTTPS.

Debian 13, with Node 22, nginx, and certbot already installed.

```bash
sudo adduser --system --group --no-create-home --shell /usr/sbin/nologin sunspec
sudo git clone https://github.com/arshadc95/sunspec-taskboard.git /opt/sunspec-taskboard
sudo chown -R sunspec:sunspec /opt/sunspec-taskboard

cd /opt/sunspec-taskboard
sudo -u sunspec npm ci --omit=dev

sudo -u sunspec cp .env.example .env
openssl rand -hex 32
sudo -u sunspec nano .env
```

In `.env` set `SESSION_SECRET` to the `openssl` value, and set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (8 characters or more), and `ADMIN_NAME`. Leave `PORT=8082` and the database path under `./data` so the service can write it.

If `command -v node` is not `/usr/bin/node`, change `ExecStart=` in `deploy/sunspec-taskboard.service` to that path before the next step. If `npm ci` tries to compile and fails, install build tools and run it again:

```bash
sudo apt-get install -y build-essential python3
sudo -u sunspec npm ci --omit=dev
```

Create the superuser, then start the app and nginx:

```bash
cd /opt/sunspec-taskboard
sudo -u sunspec npm run create-superuser

sudo cp deploy/sunspec-taskboard.service /etc/systemd/system/sunspec-taskboard.service
sudo systemctl daemon-reload
sudo systemctl enable --now sunspec-taskboard
sudo systemctl status sunspec-taskboard --no-pager

sudo cp deploy/nginx-taskboard-ip.conf /etc/nginx/sites-available/sunspec-taskboard-ip.conf
sudo ln -sf /etc/nginx/sites-available/sunspec-taskboard-ip.conf /etc/nginx/sites-enabled/sunspec-taskboard-ip.conf
sudo nginx -t
sudo systemctl reload nginx
```

`npm run create-superuser` reads `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_NAME` from `.env`. You can also pass them on the command line:

```bash
sudo -u sunspec npm run create-superuser -- you@sunspec.co.za 'a-long-password' 'Your Name'
```

If you skip the script, the first process start creates the same superuser when the database has no users and those variables are set. After the account exists you can remove `ADMIN_PASSWORD` from `.env` and restart the service.

Open the firewall only if ufw is already enforcing:

```bash
sudo ufw status
sudo ufw allow 8090/tcp
```

Check it, then sign in at **http://160.119.249.201:8090**:

```bash
curl -fsS http://127.0.0.1:8082/healthz
curl -fsSI http://127.0.0.1:8090/login
```

## Add tasks.sunspec.co.za later

When the DNS A record for `tasks.sunspec.co.za` points at `160.119.249.201`:

```bash
sudo cp /opt/sunspec-taskboard/deploy/nginx-taskboard.conf /etc/nginx/sites-available/sunspec-taskboard.conf
sudo ln -sf /etc/nginx/sites-available/sunspec-taskboard.conf /etc/nginx/sites-enabled/sunspec-taskboard.conf
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d tasks.sunspec.co.za
```

The site is then at https://tasks.sunspec.co.za. nginx sends `X-Forwarded-Proto`, and the session cookie is `Secure` on that HTTPS host. The port 8090 site can stay up for HTTP access.

## Update

```bash
cd /opt/sunspec-taskboard
sudo -u sunspec git pull
sudo -u sunspec npm ci --omit=dev
sudo systemctl restart sunspec-taskboard
```

## Backups

The database is SQLite in WAL mode. Copying the file with `cp` while the app is running can produce a torn backup. Use SQLite's `.backup` instead. Install the `sqlite3` client once (`sudo apt-get install -y sqlite3`), then add this to the `sunspec` user crontab (`sudo crontab -u sunspec -e`):

```cron
15 2 * * * mkdir -p /opt/sunspec-taskboard/data/backups && sqlite3 /opt/sunspec-taskboard/data/taskboard.sqlite ".backup /opt/sunspec-taskboard/data/backups/taskboard-$(date +\%F).sqlite"
20 2 * * * tar -C /opt/sunspec-taskboard/data -czf /opt/sunspec-taskboard/data/backups/uploads-$(date +\%F).tar.gz uploads
```

## Run it on a laptop

```bash
cp .env.example .env
# set SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm install
npm run create-superuser
npm start
```

Open http://127.0.0.1:8082 . `npm run create-admin` is the same script.

## Accounts and roles

| Role | What they can do |
| --- | --- |
| Superuser | Everything. Create, edit, deactivate, and change the role of any account, including other admins and superusers. Edit or delete any task. Delete any comment. |
| Admin | Create, edit, and deactivate **users** only. Edit or delete any task. Delete their own comments. |
| User | Use the board. Edit tasks they created or are assigned. Delete their own comments. |

Everyone who can sign in sees the same board and can create tasks, assign them, and comment. Deactivated people cannot sign in. A person cannot deactivate their own account or change their own role, and the last active superuser cannot be removed.

Passwords are hashed with bcrypt. Session cookies are `HttpOnly` and `SameSite=Strict`. Failed logins are limited to 8 attempts per IP per 15 minutes.

Due dates are calendar dates in Africa/Johannesburg. A task is overdue when its due date is before today and it is not Done. The board is grouped by status and sorted by due date.

A task can belong to a project (type a new name such as Tubecon on the task form) and a priority of Low, Med, High, or Urgent. Filter the board by project. Comments can mention a person with `@Their Name`; the Mentions filter lists tasks where you were mentioned. Status, assignee, and due-date changes are kept on the task. Files up to 10 MB are stored in `DATA_DIR/uploads` and can only be downloaded by someone who is signed in. CSV downloads the tasks that match the current filters. Manage, for superusers and admins, shows open, overdue, and completed work per person, plus time spent by person, project, and task and the average time on completed tasks. On a task, Start begins a time entry for you and Stop ends it. Only one timer runs per person; starting another stops the previous one. Starting a timer on a To Do task moves it to In Progress. On a narrow screen the task table becomes cards and the orange bar along the bottom replaces the sidebar. Click a task title, or anywhere else on its row, to open it.

The database is migrated when the process starts. An update is still `git pull`, `npm ci --omit=dev`, and `systemctl restart sunspec-taskboard`. No new settings are required.

Press N to open the new-task drawer. Enter in the add row creates a To Do task. Complete (✓) is available to the assignee, the creator, and admins. Only the assignee can start or stop a timer. Mentions use `@[Name](id)` from the picker so names with spaces stay attached to the person. The Team page shows the week and month leaderboard.
