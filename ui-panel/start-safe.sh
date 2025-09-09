#!/bin/bash

# Model Deployment UI 安全启动脚本 - 避免SSH断开

# 端口配置
LOCAL_FORWARD_PORT=${1:-${LOCAL_FORWARD_PORT:-3099}}

echo "🚀 Starting Model Deployment Management Dashboard (Safe Mode)..."
echo "🔧 Using local forward port: $LOCAL_FORWARD_PORT"

# 设置进程优先级，避免占用过多系统资源
renice -n 10 $$ > /dev/null 2>&1

# 限制并发度，避免系统负载过高
export UV_THREADPOOL_SIZE=4
export NODE_OPTIONS="--max-old-space-size=2048"

if [ ! -f ".venv/" ]; then
    echo "🔧 Running setup (this may take a few minutes)..."
    ./_setup.sh
fi

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

echo "✅ kubectl connection successful"

# 激活 Python 环境
echo "🐍 Activating Python environment..."
if [ -d ".venv" ]; then
    source .venv/bin/activate
    echo "✅ Python environment activated: $(python --version)"
else
    echo "⚠️  Python environment not found. Training History may not work"
fi

# 温和地清理进程，避免强制杀死可能影响SSH的进程
echo "🧹 Gently cleaning up existing processes..."
pkill -f "node server/index.js" 2>/dev/null || true
pkill -f "react-scripts start" 2>/dev/null || true
pkill -f "concurrently" 2>/dev/null || true
pkill -f "nodemon server/index.js" 2>/dev/null || true

# 等待进程自然退出
sleep 5

# 检查端口，但不强制杀死进程
echo "🔍 Checking port availability..."
for port in 3099 3001 8081; do
    if lsof -ti :$port >/dev/null 2>&1; then
        echo "⚠️  Port $port is occupied. You may need to manually stop the process."
        echo "   Run: lsof -ti :$port | xargs kill"
    else
        echo "✅ Port $port is available"
    fi
done

# 获取公网IP
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null)
PUBLIC_IP=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null)

if [ -n "$PUBLIC_IP" ]; then
    echo "🌐 Application will be accessible at: http://$PUBLIC_IP:$LOCAL_FORWARD_PORT"
else
    echo "🌐 Application will be accessible at: http://localhost:$LOCAL_FORWARD_PORT"
fi

# 检查依赖
if [ ! -d "node_modules" ] || [ ! -d "client/node_modules" ]; then
    echo "📦 Installing dependencies (this may take a few minutes)..."
    echo "   Please keep your SSH session active during installation..."
    npm run install-all
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies"
        exit 1
    fi
fi

# 创建日志目录
mkdir -p logs

echo "🌟 Starting services with resource limits..."
if [ -n "$PUBLIC_IP" ]; then
    echo "📊 Dashboard will be available at: http://$PUBLIC_IP:$LOCAL_FORWARD_PORT"
else
    echo "📊 Dashboard will be available at: http://localhost:$LOCAL_FORWARD_PORT"
fi
echo "🔌 API server will run on: http://localhost:3001"
echo "🔄 WebSocket server will run on: ws://localhost:8081"
echo ""
echo "⚠️  First startup may take 2-3 minutes for React compilation"
echo "   Your SSH session should remain stable during this process"
echo ""
echo "Press Ctrl+C to stop all services"
echo "----------------------------------------"

# 启动开发服务器
npm run dev
