#!/usr/bin/env bash
# Creates the trial server on Google Cloud. Run it in Cloud Shell (the >_
# button at the top of console.cloud.google.com), where gcloud is already
# signed in:
#
#   bash create-vm.sh
#
# Makes: a static IP, a firewall rule for 80/443, and one e2-highmem-2
# (2 vCPU / 16 GB) Ubuntu 24.04 VM in Singapore, the region Supabase is in.
# Safe to run again: anything that already exists is left as it is.
set -euo pipefail

NAME=${NAME:-nhipbut}
REGION=${REGION:-asia-southeast1}
ZONE=${ZONE:-asia-southeast1-b}
TYPE=${TYPE:-e2-highmem-2}
DISK_GB=${DISK_GB:-30}

gcloud services enable compute.googleapis.com

gcloud compute addresses describe "$NAME-ip" --region "$REGION" >/dev/null 2>&1 ||
  gcloud compute addresses create "$NAME-ip" --region "$REGION"
IP=$(gcloud compute addresses describe "$NAME-ip" --region "$REGION" --format='value(address)')

gcloud compute firewall-rules describe "$NAME-web" >/dev/null 2>&1 ||
  gcloud compute firewall-rules create "$NAME-web" \
    --allow tcp:80,tcp:443,udp:443 --target-tags "$NAME" \
    --description "HTTP/HTTPS to Caddy"

gcloud compute instances describe "$NAME" --zone "$ZONE" >/dev/null 2>&1 ||
  gcloud compute instances create "$NAME" \
    --zone "$ZONE" --machine-type "$TYPE" \
    --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
    --boot-disk-size "${DISK_GB}GB" --boot-disk-type pd-balanced \
    --address "$IP" --tags "$NAME"

echo
echo "Server IP: $IP"
echo "1. Put this IP on your DuckDNS name (duckdns.org > your domain > current ip > update ip)."
echo "2. Open a shell on the server:  gcloud compute ssh $NAME --zone $ZONE"
