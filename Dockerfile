# ABOUTME: Builds the standalone db-specialist container for oh-my-pi sessions.
# ABOUTME: Installs omp via bun alongside node, exposes omp as the entrypoint.
FROM node:22-bookworm

COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

RUN apt-get update \
  && apt-get install -y --no-install-recommends git libpq-dev \
  && rm -rf /var/lib/apt/lists/*

RUN bun install -g @oh-my-pi/pi-coding-agent
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app
COPY . .
RUN npm install

ENTRYPOINT ["omp"]
