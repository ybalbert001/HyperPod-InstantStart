# Docker 开发环境

## 快速启动

```bash
# 开发模式（代码实时同步）
./start-docker-dev.sh
```

## 文件说明

- `Dockerfile.dev` - 开发环境镜像定义
- `start-docker-dev.sh` - 开发模式启动脚本
- `start-container.sh` - 容器内启动脚本
- `.dockerignore` - Docker 构建忽略文件

## 开发模式特点

✅ **代码实时同步** - 本地修改立即生效  
✅ **依赖预安装** - Node.js + Python 环境完整  
✅ **环境隔离** - 避免本地权限问题  
✅ **kubectl 访问** - 可控制 host 的 Kubernetes  

## 常用命令

```bash
# 查看日志
docker logs -f ui-panel-dev

# 停止服务
docker stop ui-panel-dev

# 重新构建
docker stop ui-panel-dev && docker rm ui-panel-dev && ./start-docker-dev.sh
```

## 访问地址

- 前端：http://your-ip:3099
- 后端 API：http://localhost:3001
- WebSocket：ws://localhost:8081
