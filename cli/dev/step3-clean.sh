#!/bin/bash

source init_envs
source env_vars

echo "1. 清理 Kubernetes PVC 和 PV..."
kubectl delete pvc s3-claim --ignore-not-found=true
kubectl delete pv s3-pv --ignore-not-found=true
eksctl delete addon --name aws-mountpoint-s3-csi-driver --cluster $EKS_CLUSTER_NAME --region $AWS_REGION
kubectl delete serviceaccount s3-csi-driver-sa -n kube-system --ignore-not-found=true

sleep 60
