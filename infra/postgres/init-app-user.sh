#!/bin/sh
set -eu

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${APP_DB_USER:?APP_DB_USER is required}"
: "${APP_DB_PASSWORD_FILE:?APP_DB_PASSWORD_FILE is required}"

case "$APP_DB_USER" in
  ''|*[!a-zA-Z0-9_]*)
    echo "APP_DB_USER must contain only letters, numbers, and underscores." >&2
    exit 1
    ;;
esac

app_db_password="$(cat "$APP_DB_PASSWORD_FILE")"
if [ -z "$app_db_password" ]; then
  echo "The application database password secret is empty." >&2
  exit 1
fi

psql --no-psqlrc --set ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set app_db_user="$APP_DB_USER" \
  --set app_db_name="$POSTGRES_DB" <<'SQL'
CREATE ROLE :"app_db_user" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE :"app_db_name" TO :"app_db_user";
GRANT USAGE, CREATE ON SCHEMA public TO :"app_db_user";
SQL

printf '%s\n%s\n' "$app_db_password" "$app_db_password" |
  psql --no-psqlrc --set ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --command="\\password $APP_DB_USER"

echo "Created restricted application role: $APP_DB_USER"
