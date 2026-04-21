# ── Stage 1: Frontend build ───────────────────────────────────────────────────
FROM node:20-slim AS frontend-builder

WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci --quiet

# Vite build-time env vars (baked into JS bundle)
ARG VITE_SHOPIFY_CLIENT_ID=3cc5db4cd2e08e09887b0cfa230b8c78
ARG VITE_API_URL=https://live.shoptimize.com.tr
ENV VITE_SHOPIFY_CLIENT_ID=$VITE_SHOPIFY_CLIENT_ID
ENV VITE_API_URL=$VITE_API_URL

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python API ───────────────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Copy built frontend from Stage 1
COPY --from=frontend-builder /frontend/dist ./frontend/dist

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
