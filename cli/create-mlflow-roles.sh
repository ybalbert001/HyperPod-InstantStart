#!/bin/bash

# Create IAM role for MLflow Service Account
set -e

source init_envs
source stack_envs

kubectl create serviceaccount mlflow-service-account -n default

OIDC_ISSUER=$(aws eks describe-cluster --name $EKS_CLUSTER_NAME --region $AWS_REGION --query 'cluster.identity.oidc.issuer' --output text)
OIDC_ID=$(echo $OIDC_ISSUER | cut -d'/' -f5)

echo "OIDC Issuer: $OIDC_ISSUER"
echo "OIDC ID: $OIDC_ID"

# Set variables
SERVICE_ACCOUNT_NAME="mlflow-service-account"
NAMESPACE="default"
ROLE_NAME="EKS-MLflow-ServiceAccount-Role-${CLUSTER_TAG}"

cat > /tmp/mlflow-trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/oidc.eks.${AWS_REGION}.amazonaws.com/id/${OIDC_ID}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.${AWS_REGION}.amazonaws.com/id/${OIDC_ID}:sub": "system:serviceaccount:${NAMESPACE}:${SERVICE_ACCOUNT_NAME}",
          "oidc.eks.${AWS_REGION}.amazonaws.com/id/${OIDC_ID}:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
EOF

cat > /tmp/mlflow-permissions-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sagemaker:CreateExperiment",
        "sagemaker:CreateTrial",
        "sagemaker:CreateTrialComponent",
        "sagemaker:UpdateExperiment",
        "sagemaker:UpdateTrial",
        "sagemaker:UpdateTrialComponent",
        "sagemaker:DescribeExperiment",
        "sagemaker:DescribeTrial",
        "sagemaker:DescribeTrialComponent",
        "sagemaker:ListExperiments",
        "sagemaker:ListTrials",
        "sagemaker:ListTrialComponents",
        "sagemaker:AddTags",
        "sagemaker:ListTags",
        "sagemaker-mlflow:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "*"
      ]
    }
  ]
}
EOF


if aws iam get-role --role-name $ROLE_NAME --region $AWS_REGION 2>/dev/null; then
    echo "Role $ROLE_NAME already exists, skipping creation"
else
    aws iam create-role \
        --role-name $ROLE_NAME \
        --assume-role-policy-document file:///tmp/mlflow-trust-policy.json \
        --region $AWS_REGION
    echo "IAM role $ROLE_NAME created"
fi


POLICY_NAME="EKS-MLflow-Policy-${CLUSTER_TAG}"
POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"

if aws iam get-policy --policy-arn $POLICY_ARN --region $AWS_REGION 2>/dev/null; then
    echo "Policy $POLICY_NAME already exists, skipping creation"
else
    aws iam create-policy \
        --policy-name $POLICY_NAME \
        --policy-document file:///tmp/mlflow-permissions-policy.json \
        --region $AWS_REGION
    echo "IAM policy $POLICY_NAME created"
fi

# Attach policy to role
aws iam attach-role-policy \
    --role-name $ROLE_NAME \
    --policy-arn $POLICY_ARN \
    --region $AWS_REGION


ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

kubectl annotate serviceaccount $SERVICE_ACCOUNT_NAME \
    -n $NAMESPACE \
    eks.amazonaws.com/role-arn=$ROLE_ARN \
    --overwrite


kubectl get serviceaccount $SERVICE_ACCOUNT_NAME -n $NAMESPACE -o yaml

rm -f /tmp/mlflow-trust-policy.json /tmp/mlflow-permissions-policy.json
echo "Temporary files cleaned up"
