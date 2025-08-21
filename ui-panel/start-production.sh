#!/bin/bash

# Model Deployment UI 生产模式启动脚本

echo "🚀 Starting Model Deployment Management Dashboard (Production Mode)..."

# 检查Node.js版本
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please upgrade to Node.js 16+."
    exit 1
fi

# 检查kubectl
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl is not installed or not in PATH."
    exit 1
fi

# 测试kubectl连接
echo "🔍 Testing kubectl connection..."
if ! kubectl cluster-info &> /dev/null; then
    echo "❌ kubectl is not properly configured or cluster is not accessible."
    echo "Please run: kubectl cluster-info"
    exit 1
fi

echo "✅ kubectl connection successful"

# 清理可能占用端口的进程
echo "🧹 Cleaning up existing processes..."
pkill -f "node server/index.js" 2>/dev/null || true
pkill -f "react-scripts start" 2>/dev/null || true
pkill -f "concurrently" 2>/dev/null || true
pkill -f "nodemon server/index.js" 2>/dev/null || true

# 停止nginx如果在运行
sudo systemctl stop nginx 2>/dev/null || true

# 等待进程完全退出
sleep 3

# 检查80端口
if sudo ss -tlnp | grep :80 >/dev/null 2>&1; then
    echo "⚠️  Port 80 is occupied, attempting to free it..."
    sudo fuser -k 80/tcp 2>/dev/null || true
    sleep 2
fi

# 构建React应用
echo "📦 Building React application..."
cd client
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Failed to build React application"
    exit 1
fi
cd ..

echo "✅ React application built successfully"

# 创建日志目录
mkdir -p logs

echo "🌟 Starting production server..."
echo "🌐 Dashboard will be available at: http://localhost:80"
echo "🔌 API server will run on: http://localhost:80"
echo "🔄 WebSocket server will run on: ws://localhost:8081"
echo ""
echo "Press Ctrl+C to stop the server"
echo "----------------------------------------"

# 启动生产服务器
sudo node server/index.js
