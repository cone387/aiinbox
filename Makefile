.PHONY: all build build-bundle run dev test clean

# Backend
backend-deps:
	cd backend && go mod tidy

backend-build:
	cd backend && CGO_ENABLED=0 go build -o ../bin/aiinbox ./cmd/server

backend-run:
	cd backend && go run ./cmd/server --config ../config.yaml

backend-test:
	cd backend && go test ./...

# Frontend
frontend-deps:
	cd frontend && npm install

frontend-dev:
	cd frontend && npm run dev

frontend-build:
	cd frontend && npm run build

# Extension
extension-deps:
	cd extension && npm install

extension-dev:
	cd extension && npm run dev

extension-build:
	cd extension && npm run build

# All
deps: backend-deps frontend-deps extension-deps

build: backend-build frontend-build extension-build

# Self-contained single binary: build the frontend, embed it into the
# server, then compile. Produces bin/aiinbox-server with the web UI baked in.
build-bundle: frontend-build
	rm -rf backend/internal/webui/dist
	mkdir -p backend/internal/webui/dist
	cp -r frontend/dist/. backend/internal/webui/dist/
	cd backend && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o ../bin/aiinbox-server ./cmd/server

dev: backend-run

test: backend-test

clean:
	rm -rf bin/ frontend/dist/ extension/dist/

# Docker
docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

docker-build:
	docker-compose build
