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
  --namespace kube-system \\
  --create-namespace \\
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

  /**
   * 安装通用依赖
   */
  static async installGeneralDependencies(clusterConfigDir) {
    console.log('Installing general dependencies...');
    
    const commands = `cd ${clusterConfigDir} && bash -c 'source init_envs && source stack_envs && 
    
    # kubectl apply -f https://example.com/manifest.yaml
    # curl -fsSL https://example.com/install.sh | bash
    # helm repo add myrepo https://example.com/charts
    # helm install myapp myrepo/myapp --namespace mynamespace --create-namespace
    
    echo "General dependencies installation completed"
    '`;
    
    execSync(commands, { stdio: 'inherit' });
  }

  /**
   * 完整的集群依赖配置流程
   */
  static async configureClusterDependencies(clusterTag, clusterManager) {
    try {
      console.log(`Configuring dependencies for cluster: ${clusterTag}`);
      
      // 获取集群配置目录
      const clusterDir = clusterManager.getClusterDir(clusterTag);
      const configDir = path.join(clusterDir, 'config');
      
      // 验证配置目录存在
      if (!fs.existsSync(configDir)) {
        throw new Error(`Cluster config directory not found: ${configDir}`);
      }
      
      // 1. 获取CloudFormation outputs
      await this.fetchCloudFormationOutputs(configDir);
      
      // 2. 配置kubectl和OIDC
      await this.configureKubectlAndOIDC(configDir);
      
      // 3. 安装helm依赖
      await this.installHelmDependencies(configDir);
      
      // 4. 安装通用依赖
      await this.installGeneralDependencies(configDir);
      
      console.log(`Successfully configured dependencies for cluster: ${clusterTag}`);
      return { success: true };
      
    } catch (error) {
      console.error(`Error configuring dependencies for cluster ${clusterTag}:`, error);
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
