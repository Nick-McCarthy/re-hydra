# ps1-gcc target. Debian mipsel GCC emits little-endian MIPS ELF.
# PSY-Q ccpsx is a different compiler. This image also keeps host gcc.
FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    gcc g++ binutils ca-certificates bubblewrap \
    gcc-mipsel-linux-gnu g++-mipsel-linux-gnu \
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
ENV MATCHD_PS1_GCC=mipsel-linux-gnu-gcc
ENV MATCHD_PS1_GXX=mipsel-linux-gnu-g++
ENV MATCHD_MIPSEL_NM=mipsel-linux-gnu-nm
ENV MATCHD_MIPSEL_OBJDUMP=mipsel-linux-gnu-objdump
ENV MATCHD_TIMEOUT_MS=30000
ENV MATCHD_SANDBOX=bwrap

EXPOSE 3001
CMD ["node", "--import", "tsx", "src/main.ts"]
