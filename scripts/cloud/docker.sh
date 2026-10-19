#!/usr/bin/env bash
# Sobe o dockerd nesta VM (sem systemd; o PID 1 é o tini). Idempotente.
# medido em 2026-10-16: overlayfs do Docker 29.1.3 publica 127.0.0.1:5434 neste kernel.

if [ -n "${NOD_CLOUD_DOCKER_SH:-}" ]; then
  return 0 2>/dev/null || exit 0
fi
NOD_CLOUD_DOCKER_SH=1

nod_cloud_tmux() {
  if [ -f /exec-daemon/tmux.portal.conf ]; then
    tmux -f /exec-daemon/tmux.portal.conf "$@"
  else
    tmux "$@"
  fi
}

garantir_docker() {
  if sudo docker info >/dev/null 2>&1; then
    return 0
  fi
  sudo mkdir -p /var/run
  if ! nod_cloud_tmux has-session -t dockerd 2>/dev/null; then
    if [ -S /var/run/docker.sock ]; then
      sudo rm -f /var/run/docker.sock
    fi
    nod_cloud_tmux new-session -d -s dockerd -- sudo dockerd --host=unix:///var/run/docker.sock
  fi
  local i
  for i in $(seq 1 60); do
    if sudo docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "docker não ficou pronto" >&2
  nod_cloud_tmux capture-pane -t dockerd -p 2>/dev/null | tail -n 60 >&2 || true
  return 1
}
