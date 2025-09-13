#!/bin/bash

echo "🐳 Starting Model Deployment UI with Docker (Development Mode)..."

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# 获取公网 IP
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null)
PUBLIC_IP=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null)

# 清理可能存在的旧容器
docker stop ui-panel-dev 2>/dev/null || true
docker rm ui-panel-dev 2>/dev/null || true

if ! docker images | grep -q ui-panel-dev; then
    REMOTE_REPO="public.ecr.aws/t5u4s6i0/hyperpod-instantstart-web:latest"
    
    echo "📥 Trying to pull from remote repository..."
    if docker pull $REMOTE_REPO; then
        echo "✅ Successfully pulled from remote repository"
        docker tag $REMOTE_REPO ui-panel-dev
        echo "🏷️ Tagged as ui-panel-dev"
    else
        echo "🔧 Failed to pull from remote repository, building locally..."
        docker build -f Dockerfile.dev -t ui-panel-dev .
    fi
fi

# 确保本地目录权限
echo "🔧 Setting up permissions..."
mkdir -p ~/.kube ~/.aws logs tmp deployments managed_clusters_info

echo "🚀 Creating and starting new container..."
# --user root
docker run -d \
  --name ui-panel-dev \
  --network host \
  --user 1000:1000 \
  -v $(pwd)/server:/app/server \
  -v $(pwd)/client/src:/app/client/src \
  -v $(pwd)/client/public:/app/client/public \
  -v $(pwd)/templates:/app/templates \
  -v $(pwd)/deployments:/app/deployments \
  -v $(pwd)/config:/app/config \
  -v $(pwd)/logs:/app/logs \
  -v $(pwd)/tmp:/app/tmp \
  -v $(pwd)/mlflow:/app/mlflow \
  -v $(pwd)/managed_clusters_info:/app/managed_clusters_info \
  -v $(pwd)/container-entrypoint.sh:/app/container-entrypoint.sh \
  -v $(pwd)/.env:/app/.env \
  -v $(pwd)/package.json:/app/package.json \
  -v $(pwd)/nodemon.json:/app/nodemon.json \
  -v ~/.kube:/home/node/.kube:rw \
  -v ~/.aws:/home/node/.aws:ro \
  -e NODE_ENV=development \
  -e HOME=/home/node \
  ui-panel-dev

echo "✅ Container is running!"
echo "📊 Dashboard: http://localhost:3099"
echo "📊 Dashboard: http://$PUBLIC_IP:3099"
echo "🔍 View logs: docker logs -f ui-panel-dev"
echo "🛑 Stop: docker stop ui-panel-dev"
