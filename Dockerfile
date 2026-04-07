# ABOUTME: Builds the standalone db-specialist pi package for container sessions.
# ABOUTME: Installs the pi CLI, project dependencies, and exposes pi as the entrypoint.
FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends git libpq-dev \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @mariozechner/pi-coding-agent

WORKDIR /app
COPY . .
RUN npm install

ENTRYPOINT ["pi"]
