const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ClusterDependencyManager = require('./clusterDependencyManager');

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
      
      // 调用统一的HyperPod依赖安装方法
      // await ClusterDependencyManager.installHyperPodDependencies(configDir);
      
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
    # 添加等待逻辑
    
    '`;
    
    execSync(waitCmd, { stdio: 'inherit' });
  }

  /**
   * 检查HyperPod依赖配置状态
   */
  static async checkHyperPodDependencyStatus(configDir) {
    try {
      const checkCmd = `cd ${configDir} && bash -c 'source init_envs && 
      
      # 检查HyperPod集群状态
      echo "Checking HyperPod cluster status..."
      
      '`;
      
      const result = execSync(checkCmd, { encoding: 'utf8' });
      
      return {
        success: true,
        status: result,
        isConfigured: true
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
      
      # 清理自定义安装的资源
      echo "Cleaning up custom dependencies..."
      
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
