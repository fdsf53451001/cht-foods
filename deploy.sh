#!/bin/bash

# ============================================
# Cloud Run 部署腳本 (使用 Service Account)
# ============================================

# 設定變數 - 請根據您的環境修改
PROJECT_ID="helpful-pixel-431702-r0"           # 替換為您的 GCP 專案 ID
REGION="asia-east1"                     # 台灣區域
SERVICE_NAME="cht-foods"                # Cloud Run 服務名稱
SERVICE_ACCOUNT_NAME="cht-foods-sa"     # Service Account 名稱

echo "🚀 開始部署到 Cloud Run..."

# 1. 設定專案
echo "📌 設定 GCP 專案..."
gcloud config set project $PROJECT_ID

# 2. 啟用必要的 API
echo "🔧 啟用必要的 API..."
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable artifactregistry.googleapis.com

# 3. 建立 Service Account (如果不存在)
echo "👤 建立 Service Account..."
gcloud iam service-accounts create $SERVICE_ACCOUNT_NAME \
    --display-name="CHT Foods Service Account" \
    --description="Service Account for CHT Foods Cloud Run" \
    2>/dev/null || echo "Service Account 已存在"

SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# 4. 授予 Service Account 必要權限
echo "🔐 設定 Service Account 權限..."
# Cloud Run 執行權限
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/run.invoker" \
    --condition=None \
    --quiet

# 5. 建立 Artifact Registry 儲存庫 (如果不存在)
echo "📦 建立 Artifact Registry..."
gcloud artifacts repositories create cloud-run-images \
    --repository-format=docker \
    --location=$REGION \
    --description="Docker images for Cloud Run" \
    2>/dev/null || echo "Repository 已存在"

# 6. 設定 Docker 認證
echo "🔑 設定 Docker 認證..."
gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet

# 7. 建立並推送 Docker 映像
IMAGE_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-images/${SERVICE_NAME}"

echo "🐳 建立 Docker 映像 (amd64 架構)..."
docker build --platform linux/amd64 -t $IMAGE_URL .

echo "📤 推送映像到 Artifact Registry..."
docker push $IMAGE_URL

# 8. 部署到 Cloud Run
echo "☁️ 部署到 Cloud Run..."
gcloud beta run deploy $SERVICE_NAME \
    --image=$IMAGE_URL \
    --platform=managed \
    --region=$REGION \
    --service-account=$SERVICE_ACCOUNT_EMAIL \
    --allow-unauthenticated \
    --port=8080 \
    --memory=256Mi \
    --cpu=1 \
    --min-instances=0 \
    --max-instances=1 \
    --timeout=300

# 9. 取得服務 URL
echo ""
echo "✅ 部署完成！"
echo "🌐 服務 URL:"
gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)'
