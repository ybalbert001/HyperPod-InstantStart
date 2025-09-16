const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class EksNodeGroupDependencyManager {
  
  /**
   * EKS节点组创建完成后的依赖配置流程
   */
  static async configureNodeGroupDependencies(clusterTag, nodeGroupName, clusterManager) {
    try {
      console.log(`Configuring EKS node group dependencies for: ${clusterTag}/${nodeGroupName}`);
      
      const clusterDir = clusterManager.getClusterDir(clusterTag);
      const configDir = path.join(clusterDir, 'config');
      
      if (!fs.existsSync(configDir)) {
        throw new Error(`Cluster config directory not found: ${configDir}`);
      }
      
      // 等待节点组就绪
      await this.waitForNodeGroupReady(configDir, nodeGroupName);
      
      // 安装自定义依赖
      await this.installCustomDependencies(configDir, nodeGroupName);
      
      console.log(`Successfully configured node group dependencies for: ${clusterTag}/${nodeGroupName}`);
      return { success: true };
      
    } catch (error) {
      console.error('Error configuring node group dependencies:', error);
      throw error;
    }
  }
  
  /**
   * 等待节点组就绪
   */
  static async waitForNodeGroupReady(configDir, nodeGroupName) {
    console.log(`Waiting for node group to be ready: ${nodeGroupName}`);
    
    const maxAttempts = 30; // 最多等待15分钟
    const delayMs = 30000;  // 30秒间隔
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const checkCmd = `cd ${configDir} && bash -c 'source init_envs && aws eks describe-nodegroup --cluster-name $EKS_CLUSTER_NAME --nodegroup-name ${nodeGroupName} --region $AWS_REGION --query "nodegroup.status" --output text'`;
        const status = execSync(checkCmd, { encoding: 'utf8' }).trim();
        
        console.log(`Node group ${nodeGroupName} status: ${status} (attempt ${attempt}/${maxAttempts})`);
        
        if (status === 'ACTIVE') {
          // 额外检查节点是否Ready
          await this.waitForNodesReady(configDir, nodeGroupName);
          console.log(`Node group ${nodeGroupName} is ready`);
          return;
        }
        
        if (status.includes('FAILED') || status.includes('DELETE')) {
          throw new Error(`Node group creation failed with status: ${status}`);
        }
        
        // 等待30秒后重试
        await new Promise(resolve => setTimeout(resolve, delayMs));
        
      } catch (error) {
        if (attempt === maxAttempts) {
          throw new Error(`Timeout waiting for node group to be ready: ${error.message}`);
        }
        console.log(`Attempt ${attempt} failed, retrying: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  /**
   * 等待节点Ready
   */
  static async waitForNodesReady(configDir, nodeGroupName) {
    console.log(`Checking if nodes are ready for node group: ${nodeGroupName}`);
    
    const maxAttempts = 10;
    const delayMs = 30000;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const checkCmd = `cd ${configDir} && bash -c 'source init_envs && kubectl get nodes -l eks.amazonaws.com/nodegroup=${nodeGroupName} --no-headers | grep -v Ready | wc -l'`;
        const notReadyCount = parseInt(execSync(checkCmd, { encoding: 'utf8' }).trim());
        
        if (notReadyCount === 0) {
          console.log(`All nodes in node group ${nodeGroupName} are ready`);
          return;
        }
        
        console.log(`${notReadyCount} nodes not ready yet, waiting... (attempt ${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        
      } catch (error) {
        console.log(`Error checking node readiness: ${error.message}`);
        if (attempt === maxAttempts) {
          console.log(`Warning: Could not verify all nodes are ready, proceeding anyway`);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  /**
   * 安装自定义依赖
   */
  static async installCustomDependencies(configDir, nodeGroupName) {
    console.log(`Installing custom dependencies for node group: ${nodeGroupName}`);
    
    const commands = `cd ${configDir} && bash -c 'source init_envs && 
    kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.17.3/deployments/static/nvidia-device-plugin.yml
    helm install efa eks/aws-efa-k8s-device-plugin -n kube-system
    '`;
    
    try {
      execSync(commands, { stdio: 'inherit' });
      console.log(`Custom dependencies installed successfully for node group: ${nodeGroupName}`);
    } catch (error) {
      console.error(`Error installing custom dependencies: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * 检查依赖状态
   */
  static async checkDependencyStatus(configDir, nodeGroupName) {
    try {
      const commands = `cd ${configDir} && bash -c 'source init_envs && 
      echo "=== Node Group Status ==="
      aws eks describe-nodegroup --cluster-name $EKS_CLUSTER_NAME --nodegroup-name ${nodeGroupName} --region $AWS_REGION --query "nodegroup.status" --output text
      
      echo "=== Node Status ==="
      kubectl get nodes -l eks.amazonaws.com/nodegroup=${nodeGroupName}
      
      echo "=== GPU Device Plugin Status ==="
      kubectl get daemonset nvidia-device-plugin-daemonset -n kube-system || echo "GPU device plugin not found"
      '`;
      
      const result = execSync(commands, { encoding: 'utf8' });
      return { success: true, output: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = EksNodeGroupDependencyManager;
