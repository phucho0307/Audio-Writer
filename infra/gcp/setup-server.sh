#!/usr/bin/env bash
# First-time setup on the server itself (after `gcloud compute ssh nhipbut`):
#
#   bash infra/gcp/setup-server.sh      # from the cloned repo
#
# Installs Docker, adds 4 GB of swap so a build never runs the machine out
# of memory alongside VieNeu, and turns on automatic security updates.
set -euo pipefail

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unattended-upgrades git
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

echo "Done. Log out and back in once so 'docker' works without sudo."
