# 容器化EKS集群配置

## 快速开始

### 1. 启动EKS管理容器
```bash
cd /home/ubuntu/workspace/HyperPod-InstantStart-BASE/cli/
./run-eks-manager.sh
```

### 2. 在容器内执行集群配置
```bash
# 容器启动后，在容器内执行：
./2-cluster-configs.sh
```

### 3. 后续kubectl操作

**方式1: 在同一容器内继续操作**
```bash
# 容器内直接执行kubectl命令
kubectl get nodes
kubectl get pods -A
```

**方式2: 重新进入容器执行kubectl**
```bash
# 退出容器后，重新启动容器
./run-eks-manager.sh

# 或者进入已运行的容器
docker exec -it $(docker ps -q --filter ancestor=eks-manager) bash
```

**方式3: 在宿主机使用kubectl (需要安装kubectl)**
```bash
# 如果宿主机已安装kubectl，配置文件已自动同步
kubectl get nodes
```

## 常用操作示例

### 部署应用
```bash
# 进入容器
./run-eks-manager.sh

# 在容器内操作
kubectl apply -f your-app.yaml
kubectl get pods
kubectl logs pod-name
```

### 管理KubeRay
```bash
# 查看KubeRay operator状态
kubectl get pods -n kube-system | grep kuberay

# 部署Ray集群
kubectl apply -f kuberay-cluster.yaml

# 查看Ray集群状态
kubectl get rayclusters
```

## 优势

- **环境隔离**: 不会污染用户本地环境
- **依赖管理**: 所有工具都预装在容器中
- **一致性**: 确保所有用户使用相同的工具版本
- **便携性**: 可以在任何支持Docker的环境中运行

## 宿主机要求

**仅需安装:**
- Docker (运行容器)
- AWS凭证配置 (IAM角色或 `~/.aws/credentials`)

**无需安装:**
- ❌ AWS CLI
- ❌ kubectl  
- ❌ eksctl
- ❌ helm
- ❌ 其他工具依赖

## 包含的工具

- AWS CLI v2
- kubectl
- eksctl  
- helm
- 其他必要的Linux工具
