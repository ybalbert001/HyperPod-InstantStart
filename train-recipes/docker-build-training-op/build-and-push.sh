# algorithm_name=sm-training-op-torch26-smhp-op
algorithm_name=sm-training-op-torch26-smhp-op-v2

# region=$(aws configure get region)
region=us-west-2
account=$(aws sts get-caller-identity --query Account --output text)

# If the repository doesn't exist in ECR, create it.

aws ecr describe-repositories --region $region --repository-names "${algorithm_name}" > /dev/null 2>&1
if [ $? -ne 0 ]
then
echo "create repository:" "${algorithm_name}"
aws ecr create-repository --region $region  --repository-name "${algorithm_name}" > /dev/null
fi

#load public ECR image
# aws ecr-public get-login-password --region ${region} | docker login --username AWS --password-stdin public.ecr.aws

aws ecr get-login-password --region ${region}|docker login --username AWS --password-stdin "${account}.dkr.ecr.${region}.amazonaws.com"
aws ecr get-login-password --region ${region}|docker login --username AWS --password-stdin "763104351884.dkr.ecr.${region}.amazonaws.com"
aws ecr-public get-login-password --region ${region} | docker login --username AWS --password-stdin public.ecr.aws

docker build -t ${algorithm_name} -f Dockerfile .

fullname="${account}.dkr.ecr.${region}.amazonaws.com/${algorithm_name}:latest"
docker tag ${algorithm_name} ${fullname}
docker push ${fullname}

echo $fullname