const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class HyperPodDependencyManager {
  
  /**
   * HyperPod集群创建完成后的完整依赖配置流程
   */
  static async configureHyperPodDependencies(clusterTag, clusterManager) {
    try {
      console.log(`Configuring HyperPod dependencies for cluster: ${clusterTag}`);
      
      const clusterDir = clusterManager.getClusterDir(clusterTag);
      const configDir = path.join(clusterDir, 'config');
      
      if (!fs.existsSync(configDir)) {
        throw new Error(`Cluster config directory not found: ${configDir}`);
      }
      
      // 等待HyperPod集群就绪
      await this.waitForHyperPodReady(configDir);
      
      // 安装HyperPod专用依赖
      await this.installHyperPodDependencies(configDir);
      
      console.log(`Successfully configured HyperPod dependencies for cluster: ${clusterTag}`);
      return { success: true };
      
    } catch (error) {
      console.error(`Error configuring HyperPod dependencies for cluster ${clusterTag}:`, error);
      throw error;
    }
  }

  /**
   * 等待HyperPod集群就绪
   */
  static async waitForHyperPodReady(configDir) {
    console.log('Waiting for HyperPod cluster to be ready...');
    
    const waitCmd = `cd ${configDir} && bash -c 'source init_envs && 
    
    # 等待HyperPod集群状态变为InService
    echo "Checking HyperPod cluster status..."
    
    MAX_ATTEMPTS=30
    ATTEMPT=0
    
    while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
      STATUS=$(aws sagemaker describe-cluster --cluster-name $HP_CLUSTER_NAME --region $AWS_REGION --query "ClusterStatus" --output text 2>/dev/null || echo "NOT_FOUND")
      
      if [ "$STATUS" = "InService" ]; then
        echo "HyperPod cluster is ready (InService)"
        break
      elif [ "$STATUS" = "Failed" ]; then
        echo "ERROR: HyperPod cluster creation failed"
        exit 1
      else
        echo "HyperPod cluster status: $STATUS, waiting... (attempt $((ATTEMPT+1))/$MAX_ATTEMPTS)"
        sleep 30
        ATTEMPT=$((ATTEMPT+1))
      fi
    done
    
    if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
      echo "WARNING: Timeout waiting for HyperPod cluster to be ready"
      exit 1
    fi
    
    '`;
    
    execSync(waitCmd, { stdio: 'inherit' });
  }

  /**
   * 安装HyperPod专用依赖
   */
  static async installHyperPodDependencies(configDir) {
    console.log('Installing HyperPod-specific dependencies...');
    
    const commands = `cd ${configDir} && bash -c 'source init_envs && 

    # 创建HyperPod Training Operator addon
    echo "Creating HyperPod Training Operator addon..."
    aws eks create-addon \\
        --cluster-name \$EKS_CLUSTER_NAME \\
        --addon-name amazon-sagemaker-hyperpod-training-operator \\
        --region \$AWS_REGION \\
        --resolve-conflicts OVERWRITE || echo "HyperPod Training Operator addon already exists"

    echo "=== All HyperPod dependencies installed successfully ==="
    '`;
    
    execSync(commands, { stdio: 'inherit' });
  }

  /**
   * 检查HyperPod依赖配置状态
   */
  static async checkHyperPodDependencyStatus(configDir) {
    try {
      const checkCmd = `cd ${configDir} && bash -c 'source init_envs && 
      
      # 检查HyperPod Training Operator addon状态
      if [ -f "stack_envs" ]; then
        source stack_envs
        aws eks describe-addon --cluster-name $EKS_CLUSTER_NAME --addon-name amazon-sagemaker-hyperpod-training-operator --region $AWS_REGION --query "addon.status" --output text 2>/dev/null || echo "NOT_INSTALLED"
      else
        echo "NO_CLOUDFORMATION"
      fi
      
      '`;
      
      const result = execSync(checkCmd, { encoding: 'utf8' }).trim();
      
      return {
        success: true,
        status: result,
        isConfigured: result === 'ACTIVE'
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        isConfigured: false
      };
    }
  }

  /**
   * 清理HyperPod依赖配置
   */
  static async cleanupHyperPodDependencies(configDir) {
    try {
      console.log('Cleaning up HyperPod dependencies...');
      
      const cleanupCmd = `cd ${configDir} && bash -c 'source init_envs && 
      
      if [ -f "stack_envs" ]; then
        source stack_envs
        
        # 删除HyperPod Training Operator addon
        aws eks delete-addon --cluster-name $EKS_CLUSTER_NAME --addon-name amazon-sagemaker-hyperpod-training-operator --region $AWS_REGION || true
        
        # 删除Pod Identity Association
        aws eks delete-pod-identity-association --cluster-name $EKS_CLUSTER_NAME --association-arn $(aws eks list-pod-identity-associations --cluster-name $EKS_CLUSTER_NAME --region $AWS_REGION --query "associations[?serviceAccount==\`hp-training-operator-controller-manager\`].associationArn" --output text) --region $AWS_REGION || true
        
        echo "HyperPod dependencies cleanup completed"
      else
        echo "No CloudFormation stack found, skipping cleanup"
      fi
      
      '`;
      
      execSync(cleanupCmd, { stdio: 'inherit' });
      
      return { success: true };
      
    } catch (error) {
      console.error('Error cleaning up HyperPod dependencies:', error);
      throw error;
    }
  }
}

module.exports = HyperPodDependencyManager;
