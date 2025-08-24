#!/bin/bash

source init_envs
printenv | grep -E "(CLOUD_FORMATION|AWS_|EKS_|HP_|GPU_|DEPLOY_|ACCOUNT_|STACK_)"

# # 要求用户确认
# echo ""
# echo "请检查上述环境变量是否正确。"
# read -p "是否继续执行? (y/n): " -n 1 -r
# echo ""
# if [[ ! $REPLY =~ ^[Yy]$ ]]; then
#     echo "取消执行"
#     exit 1
# fi

# echo "继续执行..."

aws s3 mb s3://$DEPLOY_MODEL_S3_BUCKET --region ${AWS_REGION}
sleep 10

if [ -n "$FTP_NAME" ]; then
    echo "FTP_NAME is set: $FTP_NAME"
    aws s3 cp smhp-cluster-stack-ftpdev.yaml s3://$DEPLOY_MODEL_S3_BUCKET/
    
    # Create parameters JSON with FTP-specific configuration
    cat > /tmp/$CLOUD_FORMATION_FULL_STACK_NAME-params.json << EOL 
[
  {"ParameterKey": "KubernetesVersion", "ParameterValue": "1.32"},
  {"ParameterKey": "EKSClusterName", "ParameterValue": "$EKS_CLUSTER_NAME"},
  {"ParameterKey": "HyperPodClusterName", "ParameterValue": "$HP_CLUSTER_NAME"},
  {"ParameterKey": "ResourceNamePrefix", "ParameterValue": "$EKS_CLUSTER_NAME"},
  {"ParameterKey": "AvailabilityZoneId", "ParameterValue": "$AWS_AZ"},
  {"ParameterKey": "AcceleratedInstanceType", "ParameterValue": "$GPU_INSTANCE_TYPE"},
  {"ParameterKey": "AcceleratedInstanceCount", "ParameterValue": "$GPU_INSTANCE_COUNT"},
  {"ParameterKey": "AcceleratedEBSVolumeSize", "ParameterValue": "500"},
  {"ParameterKey": "CreateGeneralPurposeInstanceGroup", "ParameterValue": "false"},
  {"ParameterKey": "NodeRecovery", "ParameterValue": "None"},
  {"ParameterKey": "EnableInstanceStressCheck", "ParameterValue": "false"},
  {"ParameterKey": "EnableInstanceConnectivityCheck", "ParameterValue": "false"},
  {"ParameterKey": "AcceleratedThreadsPerCore", "ParameterValue": "2"},
  {"ParameterKey": "HyperPodTemplateBucketName", "ParameterValue": "$DEPLOY_MODEL_S3_BUCKET"},
  {"ParameterKey": "AcceleratedTrainingPlanArn", "ParameterValue": "arn:aws:sagemaker:$AWS_REGION:$ACCOUNT_ID:training-plan/$FTP_NAME"}
]
EOL

    TEMPLATE_FILE="main-stack-ftpdev.yaml"
    
else
    cat > /tmp/$CLOUD_FORMATION_FULL_STACK_NAME-params.json << EOL 
[
  {"ParameterKey": "KubernetesVersion", "ParameterValue": "1.32"},
  {"ParameterKey": "EKSClusterName", "ParameterValue": "$EKS_CLUSTER_NAME"},
  {"ParameterKey": "HyperPodClusterName", "ParameterValue": "$HP_CLUSTER_NAME"},
  {"ParameterKey": "ResourceNamePrefix", "ParameterValue": "$EKS_CLUSTER_NAME"},
  {"ParameterKey": "AvailabilityZoneId", "ParameterValue": "$AWS_AZ"},
  {"ParameterKey": "AcceleratedInstanceType", "ParameterValue": "$GPU_INSTANCE_TYPE"},
  {"ParameterKey": "AcceleratedInstanceCount", "ParameterValue": "$GPU_INSTANCE_COUNT"},
  {"ParameterKey": "AcceleratedEBSVolumeSize", "ParameterValue": "500"},
  {"ParameterKey": "CreateGeneralPurposeInstanceGroup", "ParameterValue": "false"},
  {"ParameterKey": "NodeRecovery", "ParameterValue": "None"},
  {"ParameterKey": "EnableInstanceStressCheck", "ParameterValue": "false"},
  {"ParameterKey": "EnableInstanceConnectivityCheck", "ParameterValue": "false"}
]
EOL

    curl -o /tmp/main-stack.yaml https://raw.githubusercontent.com/aws-samples/awsome-distributed-training/refs/heads/main/1.architectures/7.sagemaker-hyperpod-eks/cfn-templates/nested-stacks/main-stack.yaml 
    TEMPLATE_FILE="/tmp/main-stack.yaml"
fi


CURRENT_ROLE_ARN=$(aws sts get-caller-identity --query Arn --output text)
CURRENT_ROLE_NAME=$(echo "$CURRENT_ROLE_ARN" | sed 's/.*role\///g' | sed 's/\/.*//g')
IAM_ROLE_ARN=arn:aws:iam::$ACCOUNT_ID:role/$CURRENT_ROLE_NAME

aws sagemaker create-mlflow-tracking-server \
    --tracking-server-name $MLFLOW_SERVER_NAME \
    --artifact-store-uri "s3://${DEPLOY_MODEL_S3_BUCKET}" \
    --tracking-server-size "Small" \
    --mlflow-version "3.0" \
    --role-arn $IAM_ROLE_ARN \
    --region $AWS_REGION

# Create CloudFormation stack
echo "Creating CloudFormation stack: $CLOUD_FORMATION_FULL_STACK_NAME"
aws cloudformation create-stack \
--stack-name $CLOUD_FORMATION_FULL_STACK_NAME \
--template-body file://$TEMPLATE_FILE \
--region $AWS_REGION \
--capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
--parameters file:///tmp/$CLOUD_FORMATION_FULL_STACK_NAME-params.json

# Wait for stack creation to complete
echo "Waiting for stack creation to complete..."
aws cloudformation wait stack-create-complete --stack-name $CLOUD_FORMATION_FULL_STACK_NAME

echo "Stack creation completed successfully!"
