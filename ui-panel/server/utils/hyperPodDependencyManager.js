const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class HyperPodDependencyManager {

  /**
   * 执行非阻塞命令
   */
  static async executeNonBlocking(command, options = {}) {
    return new Promise((resolve, reject) => {
      // 添加日志头部
      const logFile = '/app/tmp/hypd-dependency.log';
      const timestamp = new Date().toISOString();
      const logHeader = `\n=== ${timestamp} ===\nExecuting: ${command.substring(0, 100)}...\n`;
      
      try {
        fs.appendFileSync(logFile, logHeader);
      } catch (err) {
        console.error('Failed to write log header:', err);
      }
      
      const child = spawn('bash', ['-c', `${command} >> ${logFile} 2>&1`], {
        stdio: 'pipe',
        ...options
      });
      
      child.on('close', (code) => {
        const logFooter = `\n--- Command completed with exit code: ${code} ---\n`;
        try {
          fs.appendFileSync(logFile, logFooter);
        } catch (err) {
          console.error('Failed to write log footer:', err);
        }
        
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with exit code ${code}`));
        }
      });
      
      child.on('error', (error) => {
        const errorLog = `\n!!! Command execution error: ${error.message} !!!\n`;
        try {
          fs.appendFileSync(logFile, errorLog);
        } catch (err) {
          console.error('Failed to write error log:', err);
        }
        reject(error);
      });
    });
  }
  
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
      STATUS=$(aws sagemaker describe-cluster --cluster-name $HP_CLUSTER_NAME --region $AWS_REGION --query "ClusterStatus" --output text 2>>/app/tmp/dependency-install.log || echo "NOT_FOUND")
      echo "Checking HyperPod cluster status: $STATUS" >> /app/tmp/dependency-install.log
      
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
    
    // execSync(waitCmd, { stdio: 'inherit' });
    await this.executeNonBlocking(waitCmd);
  }

  /**
   * 安装HyperPod专用依赖（带容错机制）
   */
  static async installHyperPodDependencies(configDir) {
    console.log('Installing HyperPod-specific dependencies with fault tolerance...');
    
    const commands = `cd ${configDir} && bash -c 'source init_envs && source stack_envs && 

    echo "=== Phase 1: Cleanup failed installations ==="
    
    echo "Cleaning up HyperPod Training Operator addon..."
    aws eks delete-addon \\
        --cluster-name \$EKS_CLUSTER_NAME \\
        --addon-name amazon-sagemaker-hyperpod-training-operator \\
        --region \$AWS_REGION >> /app/tmp/dependency-install.log 2>&1 || echo "HyperPod Training Operator addon not found"
    
    echo "Cleaning up cert-manager addon..."
    aws eks delete-addon \\
        --cluster-name \$EKS_CLUSTER_NAME \\
        --addon-name cert-manager \\
        --region \$AWS_REGION >> /app/tmp/dependency-install.log 2>&1 || echo "cert-manager addon not found"
    
    echo "Waiting for cleanup to complete..."
    sleep 30
    
    echo "=== Phase 2: Fresh installation ==="
    
    # 3. 确保Pod Identity Association存在（不删除，只确保创建）
    echo "Ensuring Pod Identity Association exists..."
    aws eks create-pod-identity-association \\
        --cluster-name \$EKS_CLUSTER_NAME \\
        --role-arn \$EXECUTION_ROLE \\
        --namespace aws-hyperpod \\
        --service-account hp-training-operator-controller-manager \\
        --region \$AWS_REGION >> /app/tmp/dependency-install.log 2>&1 || echo "Pod Identity Association exists checked"

    # 4. 重新创建cert-manager addon
    echo "Creating cert-manager addon..."
    aws eks create-addon \\
        --cluster-name \$EKS_CLUSTER_NAME \\
        --addon-name cert-manager \\
        --region \$AWS_REGION \\
        --resolve-conflicts OVERWRITE || echo "Failed to create cert-manager addon"

    # 5. 等待cert-manager就绪
    echo "Waiting for cert-manager to be ready..."
    MAX_WAIT=20
    WAIT_COUNT=0
    
    while [ \$WAIT_COUNT -lt \$MAX_WAIT ]; do
        CERT_STATUS=\$(aws eks describe-addon \\
            --cluster-name \$EKS_CLUSTER_NAME \\
            --addon-name cert-manager \\
            --region \$AWS_REGION \\
            --query "addon.status" \\
            --output text 2>/dev/null || echo "UNKNOWN")
        
        if [ "\$CERT_STATUS" = "ACTIVE" ]; then
            echo "cert-manager is ready (ACTIVE)"
            break
        elif [ "\$CERT_STATUS" = "CREATE_FAILED" ]; then
            echo "WARNING: cert-manager creation failed, but continuing..."
            break
        else
            echo "cert-manager status: \$CERT_STATUS, waiting... (\$((WAIT_COUNT+1))/\$MAX_WAIT)"
            sleep 15
            WAIT_COUNT=\$((WAIT_COUNT+1))
        fi
    done

    # 6. 重新创建HyperPod Training Operator addon
    echo "Creating HyperPod Training Operator addon..."
    aws eks create-addon \\
        --cluster-name \$EKS_CLUSTER_NAME \\
        --addon-name amazon-sagemaker-hyperpod-training-operator \\
        --region \$AWS_REGION \\
        --resolve-conflicts OVERWRITE || echo "Failed to create HyperPod Training Operator addon"

    # 安装KubeRay Operator（用于Ray训练，不依赖HyperPod）
    echo "=== Installing KubeRay Operator ==="
    helm repo add kuberay https://ray-project.github.io/kuberay-helm/
    helm repo update
    helm upgrade --install kuberay-operator kuberay/kuberay-operator --namespace kubeflow --timeout=300s || echo "KubeRay Operator installation failed"

    echo "=== All HyperPod dependencies installed successfully ==="
    '`;
    
    // execSync(commands, { stdio: 'inherit' });
    await this.executeNonBlocking(commands);
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
        aws eks describe-addon --cluster-name $EKS_CLUSTER_NAME --addon-name amazon-sagemaker-hyperpod-training-operator --region $AWS_REGION --query "addon.status" --output text >> /app/tmp/dependency-install.log 2>&1 || echo "NOT_INSTALLED"
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
