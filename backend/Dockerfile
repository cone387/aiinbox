# syntax=docker/dockerfile:1
# Multi-stage build: bundle the React frontend into the Go single binary.
# Build context is the repo root (see docker-compose.yml).

# Stage 1: build the frontend
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: embed frontend and compile the Go server
FROM golang:1.25-alpine AS backend
ENV GOPROXY=https://goproxy.cn,direct \
    GOTOOLCHAIN=auto \
    GOSUMDB=sum.golang.google.cn \
    CGO_ENABLED=0
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
# go.mod replaces getlantern/systray with a local fork, so the replacement
# directory must be present before `go mod download`.
COPY backend/third_party ./third_party
RUN go mod download
COPY backend/ ./
# Replace the placeholder embed dir with the freshly built frontend.
COPY --from=frontend /app/frontend/dist ./internal/webui/dist
RUN go build -trimpath -ldflags "-s -w" -o aiinbox-server ./cmd/server

# Stage 3: minimal runtime
# The static Go binary serves plain HTTP locally (nginx terminates TLS) and uses
# SQLite, so no CA certs or extra packages are needed — keep the image apk-free.
FROM alpine:latest
WORKDIR /app
COPY --from=backend /app/aiinbox-server ./
COPY config.docker.yaml ./config.yaml
# SQLite db, exports and jwt_secret live under /app/data (resolved relative to
# the binary). Mount a volume here to persist data.
EXPOSE 9531
CMD ["./aiinbox-server", "--config", "config.yaml"]
