#!/bin/bash

# 容器内启动脚本

echo "🚀 Starting Model Deployment Management Dashboard (Container Mode)..."

# 如果是root用户，设置权限后切换到node用户
if [ "$(id -u)" = "0" ]; then
    echo "🔧 Setting up permissions as root..."
    chown -R node:node /home/node/.kube /home/node/.aws /app 2>/dev/null || true
    chmod -R 755 /home/node/.kube /home/node/.aws 2>/dev/null || true
    
    echo "👤 Switching to node user..."
    exec su node -c "cd /app && bash $0"
fi

# 设置环境变量
export KUBECONFIG=/home/node/.kube/config
export HOME=/home/node

# 检查 kubectl 是否可用
if ! kubectl cluster-info &> /dev/null; then
    echo "⚠️  kubectl not configured, some features may not work"
else
    echo "✅ kubectl connection successful"
fi

# 获取 host IP
HOST_IP=$(hostname -i | awk '{print $1}')
echo "🌐 Application will be accessible at: http://$HOST_IP:3099"

# 启动服务
echo "🌟 Starting services..."
npm run dev
