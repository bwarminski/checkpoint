# ABOUTME: Builds the shared workstation image for isolated oh-my-pi lab containers.
# ABOUTME: Installs OMP, database clients, GitHub tooling, and common diagnostics without copying this repo.
FROM mcr.microsoft.com/devcontainers/universal:2-linux

USER root

COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

RUN apt-get update \
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

RUN bun install -g @oh-my-pi/pi-coding-agent \
  && ln -s /root/.bun/bin/omp /usr/local/bin/omp

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

ENV PATH="/root/.bun/bin:${PATH}"
WORKDIR /workspace

USER codespace

ENTRYPOINT ["omp"]
