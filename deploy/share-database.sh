#!/usr/bin/env bash
# Run this on your FIRST server, the one with the database.
#
#   sudo /opt/stagepass/deploy/share-database.sh
#
# It lets other servers in the same private network connect to this server's
# PostgreSQL, then prints the exact command to run on each new server.
# Safe to run again.

set -euo pipefail

ENV_FILE=/etc/stagepass/api.env

if [[ $EUID -ne 0 ]]; then
  echo "Run this script with sudo: sudo $0"
  exit 1
fi

if [[ ! -f $ENV_FILE ]] || ! grep -q '@localhost:' "$ENV_FILE"; then
  echo "Run this on the server that has the database (your first server), after setup.sh."
  exit 1
fi

PG_DIR=$(ls -d /etc/postgresql/*/main | sort -V | tail -1)

# 1. By default Postgres only listens on localhost. Listen on the private network too.
cat > "$PG_DIR/conf.d/stagepass-network.conf" <<'CONF'
# Accept connections on all network interfaces, not only localhost.
# Who may actually log in is decided by pg_hba.conf below.
listen_addresses = '*'
CONF

# 2. Allow the stagepass user to log in from private network addresses only, with a password.
#    These three ranges are the private address ranges every cloud network uses.
#    Public internet addresses are still rejected.
for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
  line="host    stagepass    stagepass    $net    scram-sha-256"
  grep -qxF "$line" "$PG_DIR/pg_hba.conf" || echo "$line" >> "$PG_DIR/pg_hba.conf"
done

systemctl restart postgresql

# 3. Print the command for the next server, with this server's private IP filled in
private_ip=$(hostname -I | awk '{print $1}')
db_url=$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
jwt_secret=$(grep '^JWT_SECRET=' "$ENV_FILE" | cut -d= -f2-)
remote_db_url=${db_url/@localhost:/@${private_ip}:}

cat <<MSG

Postgres now accepts connections from the private network on ${private_ip}:5432.

On each NEW server, after cloning the repo, run this one command:

sudo /opt/stagepass/deploy/setup.sh --database-url '${remote_db_url}' --jwt-secret '${jwt_secret}'

It contains the database password, so don't paste it anywhere public.
MSG
