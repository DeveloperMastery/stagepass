#!/usr/bin/env bash
# Sets up Stagepass on one fresh Ubuntu 24.04 server: Nginx, Node.js API, Postgres.
#
#   sudo git clone https://github.com/DeveloperMastery/stagepass.git /opt/stagepass
#   sudo /opt/stagepass/deploy/setup.sh
#
# Safe to run again. After a `git pull`, run it again to deploy the new code.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE=/etc/stagepass/api.env
WEB_ROOT=/var/www/stagepass
SERVICE_USER=stagepass

step() { echo -e "\n\033[1;33m==> $1\033[0m"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run this script with sudo: sudo $0"
  exit 1
fi

# 1. Swap. The free-tier servers have 1 GB of RAM, and installing npm packages
#    or building the React app can run out of memory. Swap lets the OS use disk
#    as extra (slow) memory so the build doesn't get killed.
step "Checking memory"
total_mb=$(free -m | awk '/^Mem:/ {print $2}')
if [[ $total_mb -lt 2000 && -z "$(swapon --show)" ]]; then
  echo "Only ${total_mb} MB of RAM. Adding a 2 GB swap file."
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
  echo "${total_mb} MB of RAM, swap: $(swapon --show --noheadings | awk '{print $3}' | head -1)"
fi

# 2. System packages
step "Installing Nginx and PostgreSQL"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx postgresql curl ca-certificates openssl >/dev/null

# 3. Node.js 22. Ubuntu's own package is too old, so we use NodeSource.
step "Installing Node.js"
node_major=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)
if [[ ${node_major:-0} -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "Node $(node -v), npm $(npm -v)"

# 4. A dedicated Linux user for the API, so it doesn't run as root
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"

# 5. Database and config. Postgres only listens on localhost by default,
#    so the database can't be reached from the internet.
step "Setting up the database"
systemctl enable --now postgresql >/dev/null
if [[ ! -f $ENV_FILE ]]; then
  db_password=$(openssl rand -hex 16)
  sudo -u postgres psql -q -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'stagepass') THEN
    CREATE ROLE stagepass LOGIN PASSWORD '${db_password}';
  ELSE
    ALTER ROLE stagepass WITH PASSWORD '${db_password}';
  END IF;
END
\$\$;
SQL
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'stagepass'" | grep -q 1 ||
    sudo -u postgres createdb -O stagepass stagepass

  mkdir -p "$(dirname "$ENV_FILE")"
  cat > "$ENV_FILE" <<ENV
DATABASE_URL=postgres://stagepass:${db_password}@localhost:5432/stagepass
JWT_SECRET=$(openssl rand -hex 32)
PORT=3000
HOLD_MINUTES=10
BOOKING_MODE=safe
ENV
  chown root:"$SERVICE_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  echo "Created database and $ENV_FILE"
else
  echo "$ENV_FILE already exists, keeping it"
fi

# 6. Build the API and update the database schema
step "Building the API"
cd "$APP_DIR/api"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
npm run migrate --silent
npm run seed --silent

# 7. Build the React app and copy the static files where Nginx serves them from
step "Building the frontend"
cd "$APP_DIR/web"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent
mkdir -p "$WEB_ROOT"
rm -rf "${WEB_ROOT:?}"/*
cp -r dist/* "$WEB_ROOT"/

# 8. Run the API as a service
step "Starting the API"
sed "s#__APP_DIR__#$APP_DIR#g" "$APP_DIR/deploy/stagepass-api.service" > /etc/systemd/system/stagepass-api.service
systemctl daemon-reload
systemctl enable stagepass-api >/dev/null 2>&1
systemctl restart stagepass-api

# 9. Nginx in front
step "Configuring Nginx"
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/stagepass
ln -sf /etc/nginx/sites-available/stagepass /etc/nginx/sites-enabled/stagepass
rm -f /etc/nginx/sites-enabled/default
nginx -t -q
systemctl reload nginx || systemctl restart nginx

# 10. Check that everything answers
step "Checking"
for _ in $(seq 1 20); do
  if curl -fs http://localhost/api/health >/dev/null; then
    echo "API is up: $(curl -s http://localhost/api/health)"
    echo
    echo "Done. Open http://<your-server-public-ip> in your browser."
    echo "Demo logins: customer@stagepass.dev / customer123 and organizer@stagepass.dev / organizer123"
    exit 0
  fi
  sleep 1
done

echo "The API did not come up. See the logs with: sudo journalctl -u stagepass-api -n 50"
exit 1
