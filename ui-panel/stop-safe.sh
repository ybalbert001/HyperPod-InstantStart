#!/bin/bash

# Model Deployment UI 安全停止脚本
# 避免误杀SSH等系统进程

echo "🛑 Stopping Model Deployment UI services safely..."

# 记录当前工作目录，确保只杀死本项目的进程
PROJECT_DIR=$(pwd)
echo "📁 Project directory: $PROJECT_DIR"

# 更精确的进程查找和终止
echo "📋 Terminating project-specific processes..."

# 查找并终止后端服务器进程
BACKEND_PIDS=$(pgrep -f "$PROJECT_DIR/server/index.js" 2>/dev/null)
if [ -n "$BACKEND_PIDS" ]; then
    echo "  🔧 Stopping backend server (PIDs: $BACKEND_PIDS)"
    echo "$BACKEND_PIDS" | xargs kill -TERM 2>/dev/null
    echo "  ✅ Backend server stop signal sent"
else
    echo "  ℹ️  No backend server process found"
fi

# 查找并终止前端开发服务器
FRONTEND_PIDS=$(pgrep -f "react-scripts start" | xargs -I {} sh -c 'ps -p {} -o pid,ppid,cmd --no-headers | grep -v grep' 2>/dev/null | awk '{print $1}')
if [ -n "$FRONTEND_PIDS" ]; then
    echo "  🔧 Stopping frontend server (PIDs: $FRONTEND_PIDS)"
    echo "$FRONTEND_PIDS" | xargs kill -TERM 2>/dev/null
    echo "  ✅ Frontend server stop signal sent"
else
    echo "  ℹ️  No frontend server process found"
fi

# 查找并终止concurrently进程（如果存在）
CONCURRENT_PIDS=$(pgrep -f "concurrently.*npm.*start" 2>/dev/null)
if [ -n "$CONCURRENT_PIDS" ]; then
    echo "  🔧 Stopping concurrently process (PIDs: $CONCURRENT_PIDS)"
    echo "$CONCURRENT_PIDS" | xargs kill -TERM 2>/dev/null
    echo "  ✅ Concurrently process stop signal sent"
else
    echo "  ℹ️  No concurrently process found"
fi

# 查找并终止nodemon进程
NODEMON_PIDS=$(pgrep -f "nodemon.*$PROJECT_DIR" 2>/dev/null)
if [ -n "$NODEMON_PIDS" ]; then
    echo "  🔧 Stopping nodemon process (PIDs: $NODEMON_PIDS)"
    echo "$NODEMON_PIDS" | xargs kill -TERM 2>/dev/null
    echo "  ✅ Nodemon process stop signal sent"
else
    echo "  ℹ️  No nodemon process found"
fi

# 等待进程优雅退出
echo "⏳ Waiting for processes to exit gracefully..."
sleep 5

# 检查端口占用（但不强制杀死）
echo "🔍 Checking port status..."
for port in 3000 3001 8081; do
    if lsof -ti :$port >/dev/null 2>&1; then
        PID=$(lsof -ti :$port)
        PROCESS_INFO=$(ps -p $PID -o pid,ppid,cmd --no-headers 2>/dev/null || echo "Process not found")
        echo "  ⚠️  Port $port still occupied by PID $PID"
        echo "      Process: $PROCESS_INFO"
        
        # 只对明确是项目相关的进程进行处理
        if echo "$PROCESS_INFO" | grep -q "$PROJECT_DIR\|react-scripts\|node.*server"; then
            echo "      🔧 This appears to be a project process, sending SIGKILL..."
            kill -9 $PID 2>/dev/null && echo "      ✅ Process terminated"
        else
            echo "      ⚠️  This doesn't appear to be a project process, skipping"
        fi
    else
        echo "  ✅ Port $port is free"
    fi
done

# 最终状态检查
echo ""
echo "🔍 Final status check..."
ISSUES=0

# 检查项目相关进程
if pgrep -f "$PROJECT_DIR/server/index.js" >/dev/null 2>&1; then
    echo "  ⚠️  Backend server process still running"
    ISSUES=$((ISSUES + 1))
fi

if pgrep -f "react-scripts start" >/dev/null 2>&1; then
    REACT_PIDS=$(pgrep -f "react-scripts start")
    for pid in $REACT_PIDS; do
        if ps -p $pid -o cmd --no-headers | grep -q "$PROJECT_DIR"; then
            echo "  ⚠️  Project frontend server still running (PID: $pid)"
            ISSUES=$((ISSUES + 1))
        fi
    done
fi

# 检查端口
for port in 3000 3001 8081; do
    if lsof -ti :$port >/dev/null 2>&1; then
        echo "  ⚠️  Port $port still occupied"
        ISSUES=$((ISSUES + 1))
    fi
done

if [ $ISSUES -eq 0 ]; then
    echo ""
    echo "✅ All Model Deployment UI services stopped successfully"
    echo ""
    echo "📊 Status:"
    echo "  • Frontend (port 3000): ✅ Stopped"
    echo "  • Backend API (port 3001): ✅ Stopped"
    echo "  • WebSocket (port 8081): ✅ Stopped"
else
    echo ""
    echo "⚠️  $ISSUES issues detected. Some processes or ports may still be in use"
    echo ""
    echo "🔧 Manual investigation commands:"
    echo "   ps aux | grep '$PROJECT_DIR'          # Check project processes"
    echo "   ss -tlnp | grep -E ':(3000|3001|8081)' # Check port usage"
    echo "   lsof -i :PORT                         # Check specific port"
fi

echo ""
echo "🚀 To restart the services, run: ./start.sh"
