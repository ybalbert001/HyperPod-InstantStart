source init_envs

aws cloudformation describe-stacks --stack-name $CLOUD_FORMATION_FULL_STACK_NAME --region $AWS_REGION --query 'Stacks[0].Outputs' --output json | jq -r '
def map_output_to_env:
  if .OutputKey == "EKSClusterName" then "export EKS_CLUSTER_NAME=" + .OutputValue
  elif .OutputKey == "EKSClusterArn" then "export EKS_CLUSTER_ARN=" + .OutputValue
  elif .OutputKey == "S3BucketName" then "export LIFECYCLE_S3_BUCKET_NAME=" + .OutputValue
  elif .OutputKey == "SageMakerIAMRoleArn" then "export EXECUTION_ROLE=" + .OutputValue
  elif .OutputKey == "VpcId" then "export VPC_ID=" + .OutputValue
  elif .OutputKey == "PrivateSubnetId" then "export PRIVATE_SUBNET_ID=" + .OutputValue
  elif .OutputKey == "SecurityGroupId" then "export SECURITY_GROUP_ID=" + .OutputValue
  else empty
  end;

(.[] | map_output_to_env)
' > stack_envs
