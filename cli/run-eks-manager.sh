#!/bin/bash

# 构建EKS管理容器
docker build -f Dockerfile.eks-manager -t eks-manager .

# 运行容器，挂载AWS凭证和当前目录
docker run -it --rm \
  -v ~/.aws:/root/.aws:ro \
  -v $(pwd):/workspace \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --network host \
  eks-manager bash

echo "容器已启动，现在可以在容器内执行 ./2-cluster-configs.sh"
