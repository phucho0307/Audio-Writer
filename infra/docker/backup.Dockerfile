# syntax=docker/dockerfile:1.7
# Nightly database backup to R2 (infra/backup/backup.sh).
# pg_dump 17 to match Supabase's Postgres 17; aws-cli speaks R2's S3 API.
# `extra_ca` is the same optional build secret as the app images (a machine
# whose antivirus re-signs HTTPS); servers do not need it.
FROM postgres:17-alpine
RUN --mount=type=secret,id=extra_ca,required=false     cp /etc/ssl/certs/ca-certificates.crt /tmp/ca.bak   && if [ -s /run/secrets/extra_ca ]; then cat /run/secrets/extra_ca >> /etc/ssl/certs/ca-certificates.crt; fi   && apk add --no-cache aws-cli coreutils   && cp /tmp/ca.bak /etc/ssl/certs/ca-certificates.crt && rm /tmp/ca.bak
COPY infra/backup/backup.sh /usr/local/bin/backup
RUN chmod +x /usr/local/bin/backup
USER postgres
ENTRYPOINT ["backup"]
