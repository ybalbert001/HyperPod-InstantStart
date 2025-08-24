source init_envs

CURRENT_ROLE_ARN=$(aws sts get-caller-identity --query Arn --output text)
CURRENT_ROLE_NAME=$(echo "$CURRENT_ROLE_ARN" | sed 's/.*role\///g' | sed 's/\/.*//g')
IAM_ROLE_ARN=arn:aws:iam::$ACCOUNT_ID:role/$CURRENT_ROLE_NAME

# aws sagemaker create-mlflow-tracking-server \
#     --tracking-server-name "$HP_CLUSTER_NAME-mlflow-server" \
#     --artifact-store-uri "s3://${DEPLOY_MODEL_S3_BUCKET}" \
#     --tracking-server-size "Small" \
#     --mlflow-version "3.0" \
#     --role-arn $IAM_ROLE_ARN \
#     --region $AWS_REGION

# aws sagemaker describe-mlflow-tracking-server \
#     --tracking-server-name "$HP_CLUSTER_NAME-mlflow-server" \
#     --region ${AWS_REGION}

aws sagemaker describe-mlflow-tracking-server \
    --tracking-server-name $MLFLOW_SERVER_NAME \
    --region ${AWS_REGION} | jq '.' > mlflow-server-info.json

# aws sagemaker describe-mlflow-tracking-server \
#     --tracking-server-name "$HP_CLUSTER_NAME-mlflow-server" \
#     --region ${AWS_REGION} \
#     --query 'TrackingServerUrl' \
#     --output text