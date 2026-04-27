# ABOUTME: Builds the shared workstation image for isolated oh-my-pi lab containers.
# ABOUTME: Installs OMP, database clients, GitHub tooling, and common diagnostics without copying this repo.
FROM mcr.microsoft.com/devcontainers/universal:3-linux AS base

USER root

COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

ENV BUN_INSTALL="/usr/local"
ENV PATH="/usr/local/bin:${PATH}"

RUN rm -f /etc/apt/sources.list.d/yarn.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    default-mysql-client \
    direnv \
    fd-find \
    gh \
    git \
    htop \
    jq \
    mycli \
    netcat-openbsd \
    openssh-client \
    pgcli \
    pkg-config \
    postgresql-client \
    python3 \
    python3-pip \
    pipx \
    ripgrep \
    sqlite3 \
    tmux \
    tree \
    wget \
  && rm -rf /var/lib/apt/lists/*

RUN bun install -g @oh-my-pi/pi-coding-agent

RUN mkdir -p /checkpoint-src \
  && cd /checkpoint-src \
  && npm init -y \
  && npm install \
    @oh-my-pi/pi-ai@^14.1.2 \
    @sinclair/typebox@^0.34.49 \
    pg@^8.20.0

RUN mkdir -p /etc/ssh/ssh_known_hosts.d \
  && ssh-keyscan github.com > /etc/ssh/ssh_known_hosts

RUN mkdir -p /home/codespace/.ssh \
  && printf 'Host github.com\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/id_rsa\n  IdentitiesOnly yes\n' > /home/codespace/.ssh/config \
  && chown -R codespace:codespace /home/codespace/.ssh \
  && chmod 700 /home/codespace/.ssh \
  && chmod 600 /home/codespace/.ssh/config

RUN mkdir -p /workspace \
  && chown codespace:codespace /workspace

WORKDIR /workspace

USER codespace

ENTRYPOINT ["omp"]

FROM base AS control

FROM base AS skilled

USER root

COPY src /checkpoint-src/src
COPY skills /checkpoint-skills
COPY docker/omp-skilled-entrypoint.sh /usr/local/bin/checkpoint-skilled-entrypoint

RUN chown -R codespace:codespace /checkpoint-src/src /checkpoint-skills \
  && chmod 755 /usr/local/bin/checkpoint-skilled-entrypoint

USER codespace

ENTRYPOINT ["checkpoint-skilled-entrypoint"]
