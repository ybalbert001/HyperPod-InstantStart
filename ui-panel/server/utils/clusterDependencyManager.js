const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class ClusterDependencyManager {
  
  /**
   * 获取CloudFormation Stack的输出信息
   */
  static async fetchCloudFormationOutputs(clusterConfigDir) {
    console.log('Fetching CloudFormation outputs...');
    
    const fetchCmd = `cd ${clusterConfigDir} && bash -c 'source init_envs && 
aws cloudformation describe-stacks --stack-name $CLOUD_FORMATION_FULL_STACK_NAME --region $AWS_REGION --query "Stacks[0].Outputs[*].[OutputKey,OutputValue]" --output text | 
while read -r key value; do
  case $key in
    "OutputEKSClusterName") echo "export EKS_CLUSTER_NAME=$value" ;;
    "OutputEKSClusterArn") echo "export EKS_CLUSTER_ARN=$value" ;;
    "OutputS3BucketName") echo "export LIFECYCLE_S3_BUCKET_NAME=$value" ;;
    "OutputSageMakerIAMRoleArn") echo "export EXECUTION_ROLE=$value" ;;
    "OutputVpcId") echo "export VPC_ID=$value" ;;
    "OutputPrivateSubnetIds") echo "export PRIVATE_SUBNET_ID=$value" ;;
    "OutputSecurityGroupId") echo "export SECURITY_GROUP_ID=$value" ;;
    "OutputHyperPodClusterName") echo "export HP_CLUSTER_NAME=$value" ;;
    "OutputHyperPodClusterArn") echo "export HP_CLUSTER_ARN=$value" ;;
  esac
done > stack_envs'`;
    
    execSync(fetchCmd, { stdio: 'inherit' });
    
    // 验证stack_envs文件是否创建成功
    const stackEnvsPath = path.join(clusterConfigDir, 'stack_envs');
    if (!fs.existsSync(stackEnvsPath)) {
      throw new Error('Failed to create stack_envs file');
    }
    
    return stackEnvsPath;
  }

  /**
   * 配置kubectl和OIDC provider
   */
  static async configureKubectlAndOIDC(clusterConfigDir) {
    console.log('Configuring kubectl and OIDC...');
    
    const kubectlCmd = `cd ${clusterConfigDir} && bash -c 'source init_envs && source stack_envs && 
aws eks update-kubeconfig --name $EKS_CLUSTER_NAME --region $AWS_REGION && 
eksctl utils associate-iam-oidc-provider --region $AWS_REGION --cluster $EKS_CLUSTER_NAME --approve'`;
    
    execSync(kubectlCmd, { stdio: 'inherit' });
  }

  /**
   * 安装Helm依赖
   */
  static async installHelmDependencies(clusterConfigDir) {
    console.log('Installing helm dependencies...');
    
    // 分步执行，便于调试和错误处理
    await this.setupHelmRepos(clusterConfigDir);
    await this.cloneHyperPodCLI(clusterConfigDir);
    await this.createNamespaces(clusterConfigDir);
    await this.installHyperPodChart(clusterConfigDir);
  }

  /**
   * 设置Helm仓库
   */
  static async setupHelmRepos(clusterConfigDir) {
    console.log('Setting up helm repositories...');
    
    const repoCmd = `cd ${clusterConfigDir} && 
helm repo add eks https://aws.github.io/eks-charts && 
helm repo add nvidia https://nvidia.github.io/k8s-device-plugin && 
helm repo update`;
    
    execSync(repoCmd, { stdio: 'inherit' });
  }

  /**
   * 克隆HyperPod CLI仓库
   */
  static async cloneHyperPodCLI(clusterConfigDir) {
    console.log('Cloning SageMaker HyperPod CLI repository...');
    
    const cloneCmd = `cd ${clusterConfigDir} && 
if [ ! -d "./sagemaker-hyperpod-cli" ]; then
  echo "Cloning SageMaker HyperPod CLI repository..."
  git clone https://github.com/aws/sagemaker-hyperpod-cli.git
else
  echo "SageMaker HyperPod CLI repository already exists, skipping clone..."
fi`;
    
    execSync(cloneCmd, { stdio: 'inherit' });
  }

  /**
   * 创建必要的命名空间
   */
  static async createNamespaces(clusterConfigDir) {
    console.log('Creating namespaces...');
    
    const namespaceCmd = `cd ${clusterConfigDir} && bash -c 'source init_envs && source stack_envs && 
kubectl create namespace aws-hyperpod --dry-run=client -o yaml | kubectl apply -f -'`;
    
    execSync(namespaceCmd, { stdio: 'inherit' });
  }

  /**
   * 安装HyperPod Helm Chart
   */
  static async installHyperPodChart(clusterConfigDir) {
    console.log('Installing HyperPod helm chart...');
    
    const installCmd = `cd ${clusterConfigDir} && bash -c 'source init_envs && source stack_envs && 
helm dependency build sagemaker-hyperpod-cli/helm_chart/HyperPodHelmChart && 
helm upgrade --install hyperpod-dependencies ./sagemaker-hyperpod-cli/helm_chart/HyperPodHelmChart \\
  --kube-context arn:aws:eks:$AWS_REGION:$(aws sts get-caller-identity --query Account --output text):cluster/$EKS_CLUSTER_NAME \\
  --namespace kube-system \\
  --set neuron-device-plugin.devicePlugin.enabled=false \\
  --set nvidia-device-plugin.devicePlugin.enabled=true \\
  --set aws-efa-k8s-device-plugin.devicePlugin.enabled=true \\
  --set health-monitoring-agent.enabled=true \\
  --set hyperpod-patching.enabled=true \\
  --set mpi-operator.enabled=true \\
  --set trainingOperators.enabled=true \\
  --set deep-health-check.enabled=false \\
  --set job-auto-restart.enabled=false'`;
    
    execSync(installCmd, { stdio: 'inherit' });
  }


  static async installGeneralDependencies(clusterConfigDir) {
    console.log('Installing EKS general dependencies...');
    
    const commands = `cd ${clusterConfigDir} && bash -c 'source init_envs && source stack_envs && 
    
    # 安装S3 CSI驱动程序
    echo "=== Installing S3 CSI Driver ==="
    
    # 获取账户ID
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    ROLE_NAME=SM_HP_S3_CSI_ROLE_$EKS_CLUSTER_NAME
    
    # 创建IAM服务账户和角色
    echo "Creating IAM service account for S3 CSI driver..."
    eksctl create iamserviceaccount \\
        --name s3-csi-driver-sa \\
        --namespace kube-system \\
        --override-existing-serviceaccounts \\
        --cluster $EKS_CLUSTER_NAME \\
        --attach-policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess \\
        --role-name $ROLE_NAME \\
        --approve \\
        --role-only || echo "S3 CSI service account already exists"
    
    # 获取角色ARN
    ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --query "Role.Arn" --output text)
    
    # 安装S3 CSI驱动程序addon
    echo "Installing S3 CSI driver addon..."
    eksctl create addon \\
        --name aws-mountpoint-s3-csi-driver \\
        --cluster $EKS_CLUSTER_NAME \\
        --service-account-role-arn $ROLE_ARN \\
        --force || echo "S3 CSI driver addon already exists"
    
    echo "S3 CSI Driver installation completed"
    
    # 安装KubeRay Operator（用于Ray训练，不依赖HyperPod）
    echo "=== Installing KubeRay Operator ==="
    helm repo add kuberay https://ray-project.github.io/kuberay-helm/
    helm repo update
    helm install kuberay-operator kuberay/kuberay-operator --version 1.2.0 --namespace kube-system || echo "KubeRay Operator already exists"
    
    echo "EKS general dependencies installation completed"
    '`;
    
    execSync(commands, { stdio: 'inherit' });
  }

  static async installnlbDependencies(clusterConfigDir) {
    console.log('Installing NLB dependencies...');
    
    const commands = `cd ${clusterConfigDir} && bash -c 'source init_envs && source stack_envs && 
    
    # 下载ALB IAM策略
    curl -o /tmp/alb-iam-policy.json https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.13.0/docs/install/iam_policy.json

    # 创建IAM策略（如果不存在）
    aws iam create-policy \\
        --policy-name AWSLoadBalancerControllerIAMPolicy \\
        --policy-document file:///tmp/alb-iam-policy.json || echo "Policy already exists"

    # 创建IAM服务账户
    eksctl create iamserviceaccount \\
      --cluster=$EKS_CLUSTER_NAME \\
      --namespace=kube-system \\
      --name=aws-load-balancer-controller \\
      --attach-policy-arn=arn:aws:iam::\$(aws sts get-caller-identity --query Account --output text):policy/AWSLoadBalancerControllerIAMPolicy \\
      --override-existing-serviceaccounts \\
      --region=$AWS_REGION \\
      --approve || echo "Service account already exists"

    # 获取公有子网并添加ELB标签
    echo "Tagging public subnets for ELB..."
    PUBLIC_SUBNETS=\$(aws ec2 describe-subnets \\
        --filters "Name=vpc-id,Values=\${VPC_ID}" "Name=map-public-ip-on-launch,Values=true" \\
        --query "Subnets[*].SubnetId" \\
        --output text)
    
    for SUBNET_ID in \$PUBLIC_SUBNETS; do
        echo "Tagging public subnet: \$SUBNET_ID"
        aws ec2 create-tags --resources \$SUBNET_ID --tags Key=kubernetes.io/role/elb,Value=1 || echo "Failed to tag \$SUBNET_ID"
    done

    echo "NLB dependencies installation completed"
    '`;
    
    execSync(commands, { stdio: 'inherit' });
  }



  static async installCertificationDependency(clusterConfigDir) {
    console.log('Installing certification dependencies...');
    
    const commands = `cd ${clusterConfigDir} && bash -c 'source init_envs && source stack_envs && 

    # 提取SageMaker执行角色名称
    EXEC_ROLE_NAME=\${EXECUTION_ROLE##*/}
    echo "Using execution role: \$EXEC_ROLE_NAME"

    # 1. 为SageMaker执行角色添加DescribeClusterNode权限
    echo "Adding SageMaker DescribeClusterNode policy..."
    aws iam put-role-policy \\
        --role-name \$EXEC_ROLE_NAME \\
        --policy-name SageMakerDescribeClusterNode \\
        --policy-document '"'"'{
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
        }'"'"'

    # 2. 更新角色信任策略，允许EKS Pod Identity
    echo "Updating assume role policy for EKS Pod Identity..."
    aws iam update-assume-role-policy \\
        --role-name \$EXEC_ROLE_NAME \\
        --policy-document '"'"'{
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
    }'"'"'

    # 3. 创建EKS Pod Identity Agent addon
    echo "Creating EKS Pod Identity Agent addon..."
    aws eks create-addon \\
        --cluster-name \$EKS_CLUSTER_NAME \\
        --addon-name eks-pod-identity-agent \\
        --region \$AWS_REGION \\
        --resolve-conflicts OVERWRITE || echo "Pod Identity Agent addon already exists"

    # 4. 创建Pod Identity Association
    echo "Creating Pod Identity Association..."
    aws eks create-pod-identity-association \\
        --cluster-name \$EKS_CLUSTER_NAME \\
        --role-arn \$EXECUTION_ROLE \\
        --namespace aws-hyperpod \\
        --service-account hp-training-operator-controller-manager \\
        --region \$AWS_REGION || echo "Pod Identity Association already exists"

    # 5. 创建cert-manager addon
    echo "Creating cert-manager addon..."
    aws eks create-addon \\
        --cluster-name \$EKS_CLUSTER_NAME \\
        --addon-name cert-manager \\
        --region \$AWS_REGION \\
        --resolve-conflicts OVERWRITE || echo "cert-manager addon already exists"

    echo "Waiting for cert-manager to be ready..."
    sleep 60
    '`;
    
    execSync(commands, { stdio: 'inherit' });
  }

  /**
   * EKS集群基础依赖配置流程（不包含HyperPod专用依赖）
   */
  static async configureClusterDependencies(clusterTag, clusterManager) {
    try {
      console.log(`Configuring EKS cluster dependencies for: ${clusterTag}`);
      
      // 获取集群配置目录
      const clusterDir = clusterManager.getClusterDir(clusterTag);
      const configDir = path.join(clusterDir, 'config');
      
      // 验证配置目录存在
      if (!fs.existsSync(configDir)) {
        throw new Error(`Cluster config directory not found: ${configDir}`);
      }
      
      await this.fetchCloudFormationOutputs(configDir);
      
      await this.configureKubectlAndOIDC(configDir);
      
      await this.installHelmDependencies(configDir);

      await this.installnlbDependencies(configDir);

      await this.installCertificationDependency(configDir);
      
      await this.installGeneralDependencies(configDir);
      
      console.log(`Successfully configured EKS cluster dependencies for: ${clusterTag}`);
      return { success: true };
      
    } catch (error) {
      console.error(`Error configuring EKS cluster dependencies for ${clusterTag}:`, error);
      throw error;
    }
  }

  /**
   * 检查依赖配置状态
   */
  static async checkDependencyStatus(clusterConfigDir) {
    try {
      // 检查stack_envs文件是否存在
      const stackEnvsPath = path.join(clusterConfigDir, 'stack_envs');
      const hasStackEnvs = fs.existsSync(stackEnvsPath);
      
      // 检查helm chart是否安装
      const helmCheckCmd = `cd ${clusterConfigDir} && bash -c 'source init_envs && source stack_envs && helm list -n kube-system | grep hyperpod-dependencies'`;
      let hasHelmChart = false;
      
      try {
        execSync(helmCheckCmd, { stdio: 'pipe' });
        hasHelmChart = true;
      } catch (error) {
        hasHelmChart = false;
      }
      
      return {
        hasStackEnvs,
        hasHelmChart,
        isConfigured: hasStackEnvs && hasHelmChart
      };
      
    } catch (error) {
      console.error('Error checking dependency status:', error);
      return {
        hasStackEnvs: false,
        hasHelmChart: false,
        isConfigured: false,
        error: error.message
      };
    }
  }

  /**
   * 清理依赖配置（用于重新配置或错误恢复）
   */
  static async cleanupDependencies(clusterConfigDir) {
    try {
      console.log('Cleaning up cluster dependencies...');
      
      // 卸载helm chart
      const uninstallCmd = `cd ${clusterConfigDir} && bash -c 'source init_envs && source stack_envs && 
helm uninstall hyperpod-dependencies -n kube-system || true'`;
      
      execSync(uninstallCmd, { stdio: 'inherit' });
      
      // 删除stack_envs文件
      const stackEnvsPath = path.join(clusterConfigDir, 'stack_envs');
      if (fs.existsSync(stackEnvsPath)) {
        fs.unlinkSync(stackEnvsPath);
      }
      
      // 删除克隆的仓库
      const repoPath = path.join(clusterConfigDir, 'sagemaker-hyperpod-cli');
      if (fs.existsSync(repoPath)) {
        execSync(`rm -rf ${repoPath}`, { stdio: 'inherit' });
      }
      
      console.log('Successfully cleaned up dependencies');
      return { success: true };
      
    } catch (error) {
      console.error('Error cleaning up dependencies:', error);
      throw error;
    }
  }
}

module.exports = ClusterDependencyManager;
