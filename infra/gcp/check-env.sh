#!/usr/bin/env bash
# Reads the server's .env and names anything that is missing or still set
# for development. Prints names only, never values.
#
#   bash infra/gcp/check-env.sh .env
set -uo pipefail
f=${1:-.env}
[ -f "$f" ] || { echo "no $f"; exit 1; }
val() { grep -E "^$1=" "$f" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
bad=0
need() { [ -n "$(val "$1")" ] || { echo "MISSING  $1"; bad=1; }; }
must() { [ "$(val "$1" | tr A-Z a-z)" = "$2" ] || { echo "WRONG    $1 must be $2"; bad=1; }; }
notdev() { case "$(val "$1")" in ""|change-me*) echo "WEAK     $1 still the example value"; bad=1;; esac; }

for k in DOMAIN MEDIA_BASE DATABASE_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET \
         R2_ACCOUNT_ID R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_PUBLIC_BASE \
         GEMINI_API_KEY SMTP_URL MAIL_FROM; do need "$k"; done
for k in JWT_ACCESS_SECRET JWT_REFRESH_SECRET BYOK_ENCRYPTION_KEY; do notdev "$k"; done
if [ -n "$(val BANK_ACCOUNT_NO)" ]; then
  need BANK_CODE; need BANK_ACCOUNT_NAME
  [ -n "$(val SEPAY_WEBHOOK_SECRET)$(val SEPAY_API_KEY)" ] ||
    { echo "MISSING  SEPAY_WEBHOOK_SECRET (or SEPAY_API_KEY): payments would never be confirmed"; bad=1; }
else
  echo "NOTE     BANK_ACCOUNT_NO empty: Premium shows as coming soon"
fi
must AUTH_DEV_USER false
must DEV_ENDPOINTS false
case "$(val PAID_CHAPTERS | tr A-Z a-z)" in true) echo "NOTE     PAID_CHAPTERS=true but there is no checkout";; esac
[ "$(val GOOGLE_CALLBACK_URL)" = "https://$(val DOMAIN)/api/auth/google/callback" ] ||
  { echo "WRONG    GOOGLE_CALLBACK_URL must be https://\$DOMAIN/api/auth/google/callback"; bad=1; }
case "$(val DATABASE_URL)" in *localhost*|*127.0.0.1*) echo "WRONG    DATABASE_URL points at this machine"; bad=1;; esac

[ $bad = 0 ] && echo "env OK"
exit $bad
