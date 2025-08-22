#!/bin/bash

# aws eks create-access-entry \
#  --cluster-name $EKS_CLUSTER_NAME \
#  --principal-arn arn:aws:iam::xxxxxxxxxxxx:role/ExampleRole \
#  --type STANDARD \
#  --region $AWS_REGION

source init_envs

./fetch-mlflow-server-info.sh &
./fetch-creation-cf-info.sh

execute_aws_command() {
    local command="$1"
    
    OUTPUT=$(eval "$command" 2>&1)
    EXIT_CODE=$?
    
    if [ $EXIT_CODE -eq 0 ]; then
        echo "$OUTPUT"
    else
        echo "[EXECUTING] $command"
        echo "[WARNING] $OUTPUT"
    fi
    
    return $EXIT_CODE
}

# curl -O https://raw.githubusercontent.com/aws-samples/awsome-distributed-training/refs/heads/main/1.architectures/7.sagemaker-hyperpod-eks/create_config.sh 

# chmod +x create_config.sh

# ./create_config.sh
# rm create_config.sh

source stack_envs

aws eks update-kubeconfig --name $EKS_CLUSTER_NAME --region $AWS_REGION

eksctl utils associate-iam-oidc-provider \
    --region ${AWS_REGION} \
    --cluster ${EKS_CLUSTER_NAME} \
    --approve

curl -o /tmp/iam-policy.json https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.10.0/docs/install/iam_policy.json

execute_aws_command "aws iam create-policy \
      --policy-name AWSLoadBalancerControllerIAMPolicy \
      --policy-document file:///tmp/iam-policy.json"


curl -o /tmp/alb-iam-policy.json https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.13.0/docs/install/iam_policy.json

policy_arn="arn:aws:iam::${ACCOUNT_ID}:policy/AWSLoadBalancerControllerIAMPolicy"

execute_aws_command "aws iam delete-policy --policy-arn $policy_arn"

execute_aws_command "aws iam create-policy \
    --policy-name AWSLoadBalancerControllerIAMPolicy \
    --policy-document file:///tmp/alb-iam-policy.json"


execute_aws_command "eksctl create iamserviceaccount \
--cluster=${EKS_CLUSTER_NAME} \
--namespace=kube-system \
--name=aws-load-balancer-controller \
--attach-policy-arn=arn:aws:iam::${ACCOUNT_ID}:policy/AWSLoadBalancerControllerIAMPolicy \
--override-existing-serviceaccounts \
--region=${AWS_REGION} \
--approve"

# kubectl delete serviceaccount -n kube-system aws-load-balancer-controller


## Add eks helm charts
helm repo add eks https://aws.github.io/eks-charts
## Make sure you update to the latest version
helm repo update eks

execute_aws_command "helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=${HP_CLUSTER_NAME} \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set vpcId=${VPC_ID} \
  --set region=${AWS_REGION}"

# kubectl rollout restart deployment/aws-load-balancer-controller -n kube-system
# kubectl get deployment -n kube-system aws-load-balancer-controller
# kubectl logs -n kube-system aws-load-balancer-controller-86799fd799-gnf8h --tail=10

helm ls -n kube-system

PUBLIC_SUBNETS=$(aws ec2 describe-subnets --filters "[ {\"Name\":\"vpc-id\",\"Values\":[\"${VPC_ID}\"]}, {\"Name\":\"map-public-ip-on-launch\",\"Values\":[\"true\"]} ]" --query 'Subnets[*].{SubnetId:SubnetId}' --output text)
for SUBNET_ID in $PUBLIC_SUBNETS; do
    aws ec2 create-tags --resources $SUBNET_ID --tags Key=kubernetes.io/role/elb,Value=1
done

echo ""
echo "=========================================================================="
echo ""


# aws s3 mb s3://$DEPLOY_MODEL_S3_BUCKET --region ${AWS_REGION}

aws iam put-role-policy \
  --role-name ${EXECUTION_ROLE##*/} \
  --policy-name S3ReadModelAccess \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:ListBucket","s3:GetObject"],"Resource":["arn:aws:s3:::*","arn:aws:s3:::*/*"]}]}'

cat <<EOF> /tmp/s3accesspolicy.json
{
   "Version": "2012-10-17",
   "Statement": [
        {
            "Sid": "MountpointFullBucketAccess",
            "Effect": "Allow",
            "Action": [
                "s3:ListBucket"
            ],
            "Resource": [
                "*"
            ]
        },
        {
            "Sid": "MountpointFullObjectAccess",
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:AbortMultipartUpload",
                "s3:DeleteObject"
            ],
            "Resource": [
                "*"
            ]
        }
   ]
}
EOF

s3_policy_ts=$(date +%Y%m%d_%H%M%S)
# aws iam create-policy \
#     --policy-name S3MountpointAccessPolicy-$EKS_CLUSTER_NAME \
#     --policy-document file:///tmp/s3accesspolicy.json

# 'Policy.{PolicyName:PolicyName,Arn:Arn}'

s3_policy_arn=$(aws iam create-policy \
    --policy-name S3MountpointAccessPolicy-$EKS_CLUSTER_NAME \
    --policy-document file:///tmp/s3accesspolicy.json \
    --query 'Policy.Arn' \
    --output text)

ROLE_NAME=SM_HP_S3_CSI_ROLE_$EKS_CLUSTER_NAME

eksctl create iamserviceaccount \
    --name s3-csi-driver-sa \
    --namespace kube-system \
    --override-existing-serviceaccounts \
    --cluster $EKS_CLUSTER_NAME \
    --attach-policy-arn $s3_policy_arn \
    --approve \
    --role-name $ROLE_NAME \
    --region $AWS_REGION \
    --role-only

# kubectl annotate serviceaccount s3-csi-driver-sa -n kube-system eks.amazonaws.com/role-arn=arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME --overwrite

ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME  --query 'Role.Arn' --output text)
eksctl create addon --name aws-mountpoint-s3-csi-driver --cluster $EKS_CLUSTER_NAME --service-account-role-arn $ROLE_ARN --force

cat <<EOF> /tmp/pv_s3.yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: s3-pv
spec:
  capacity:
    storage: 1200Gi # ignored, required
  accessModes:
    - ReadWriteMany # supported options: ReadWriteMany / ReadOnlyMany
  mountOptions:
    - allow-delete
    - region $AWS_REGION
  csi:
    driver: s3.csi.aws.com # required
    volumeHandle: s3-csi-driver-volume
    volumeAttributes:
      bucketName: $DEPLOY_MODEL_S3_BUCKET
EOF

kubectl apply -f /tmp/pv_s3.yaml

cat <<EOF> /tmp/pvc_s3.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: s3-claim
spec:
  accessModes:
    - ReadWriteMany # supported options: ReadWriteMany / ReadOnlyMany
  storageClassName: "" # required for static provisioning
  resources:
    requests:
      storage: 1200Gi # ignored, required
  volumeName: s3-pv
EOF

kubectl apply -f /tmp/pvc_s3.yaml

echo ""
echo "=========================================================================="
echo ""

EXEC_ROLE_NAME=${EXECUTION_ROLE##*/}

aws iam put-role-policy \
    --role-name $EXEC_ROLE_NAME \
    --policy-name SageMakerDescribeClusterNode \
    --policy-document '{
      "Version": "2012-10-17",
      "Statement": [
        {
          "Effect": "Allow",
          "Action": [
            "sagemaker:DescribeClusterNode"
          ],
          "Resource": "*"
        }
      ]
    }'


aws iam update-assume-role-policy \
    --role-name $EXEC_ROLE_NAME \
    --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Service": "sagemaker.amazonaws.com"
            },
            "Action": "sts:AssumeRole"
        },
        {
            "Sid": "AllowEksAuthToAssumeRoleForPodIdentity",
            "Effect": "Allow",
            "Principal": {
                "Service": "pods.eks.amazonaws.com"
            },
            "Action": [
                "sts:AssumeRole",
                "sts:TagSession"
            ]
        }
    ]
}'

aws eks create-addon \
 --cluster-name $EKS_CLUSTER_NAME \
 --addon-name eks-pod-identity-agent \
 --region $AWS_REGION

aws eks create-pod-identity-association \
--cluster-name $EKS_CLUSTER_NAME \
--role-arn $EXECUTION_ROLE \
--namespace aws-hyperpod \
--service-account hp-training-operator-controller-manager \
--region $AWS_REGION

# {
#     "association": {
#         "clusterName": "eks-cluster-1",
#         "namespace": "aws-hyperpod",
#         "serviceAccount": "hp-training-operator-controller-manager",
#         "roleArn": "arn:aws:iam::633205212955:role/eks-cluster-1-SMHP-Exec-Role-us-west-2",
#         "associationArn": "arn:aws:eks:us-west-2:633205212955:podidentityassociation/eks-cluster-1/a-sn0l3nidbxmvyw9ct",
#         "associationId": "a-sn0l3nidbxmvyw9ct",
#         "tags": {},
#         "createdAt": "2025-08-09T00:20:38.662000+00:00",
#         "modifiedAt": "2025-08-09T00:20:38.662000+00:00",
#         "disableSessionTags": false
#     }
# }

aws eks list-pod-identity-associations --cluster-name $EKS_CLUSTER_NAME
# {
#     "associations": [
#         {
#             "clusterName": "eks-cluster-1",
#             "namespace": "aws-hyperpod",
#             "serviceAccount": "hp-training-operator-controller-manager",
#             "associationArn": "arn:aws:eks:us-west-2:633205212955:podidentityassociation/eks-cluster-1/a-sn0l3nidbxmvyw9ct",
#             "associationId": "a-sn0l3nidbxmvyw9ct"
#         }
#     ]
# }


# kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.2/cert-manager.yaml
# --addon-version v1.18.2-eksbuild.1 \
aws eks create-addon \
    --cluster-name $EKS_CLUSTER_NAME \
    --addon-name cert-manager \
    --region $AWS_REGION

sleep 60

aws eks create-addon \
  --cluster-name $EKS_CLUSTER_NAME \
  --addon-name amazon-sagemaker-hyperpod-training-operator \
  --resolve-conflicts OVERWRITE

# {
#     "addon": {
#         "addonName": "amazon-sagemaker-hyperpod-training-operator",
#         "clusterName": "eks-cluster-1",
#         "status": "CREATING",
#         "addonVersion": "v1.0.1-eksbuild.1",
#         "health": {
#             "issues": []
#         },
#         "addonArn": "arn:aws:eks:us-west-2:633205212955:addon/eks-cluster-1/amazon-sagemaker-hyperpod-training-operator/0acc461a-7b69-e5ad-f00c-2a1acef1bffe",
#         "createdAt": "2025-08-09T00:22:18.300000+00:00",
#         "modifiedAt": "2025-08-09T00:22:18.316000+00:00",
#         "tags": {}
#     }
# }

