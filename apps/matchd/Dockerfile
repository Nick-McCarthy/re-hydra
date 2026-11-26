# host-gcc target. Console compilers are separate images registered in src/targets.
FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d

RUN apt-get update \
  && apt-get install -y --no-install-recommends gcc g++ binutils ca-certificates bubblewrap \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src

ENV MATCHD_PORT=3001
ENV MATCHD_GCC=gcc
ENV MATCHD_GXX=g++
ENV MATCHD_LD=ld
ENV MATCHD_NM=nm
ENV MATCHD_OBJDUMP=objdump
ENV MATCHD_TIMEOUT_MS=30000
ENV MATCHD_SANDBOX=bwrap

EXPOSE 3001
CMD ["node", "--import", "tsx", "src/main.ts"]
