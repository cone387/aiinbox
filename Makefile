.PHONY: all build run dev test clean

# Backend
backend-deps:
	cd backend && go mod tidy

backend-build:
	cd backend && CGO_ENABLED=1 go build -o ../bin/aiinbox ./cmd/server

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
