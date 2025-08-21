source init_envs
source env_vars

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






















