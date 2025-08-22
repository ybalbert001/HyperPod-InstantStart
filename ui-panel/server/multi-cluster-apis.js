const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const ClusterManager = require('./cluster-manager');
const MultiClusterLogManager = require('./multi-cluster-log-manager');

// 多集群管理API
class MultiClusterAPIs {
  constructor() {
    this.clusterManager = new ClusterManager();
  }

  // 获取所有集群列表
  async handleGetClusters(req, res) {
    try {
      const clusters = this.clusterManager.getAllClusters();
      const activeCluster = this.clusterManager.getActiveCluster();
      
      res.json({
        success: true,
        clusters,
        activeCluster
      });
    } catch (error) {
      console.error('Error getting clusters:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // 切换活跃集群
  async handleSwitchCluster(req, res) {
    try {
      const { clusterTag } = req.body;
      
      if (!clusterTag) {
        return res.status(400).json({
          success: false,
          error: 'clusterTag is required'
        });
      }

      // 验证集群是否存在
      if (!this.clusterManager.clusterExists(clusterTag)) {
        return res.status(404).json({
          success: false,
          error: 'Cluster not found'
        });
      }

      console.log(`Switching to cluster: ${clusterTag}`);

      // 设置为活跃集群
      this.clusterManager.setActiveCluster(clusterTag);
      
      // 恢复该集群的配置到 CLI 目录
      this.clusterManager.restoreClusterConfig(clusterTag);
      
      try {
        // 同步执行kubectl配置切换，确保完成后再返回
        await this.switchKubectlConfig(clusterTag);
        console.log(`Successfully switched kubectl config to cluster: ${clusterTag}`);
        
        res.json({
          success: true,
          activeCluster: clusterTag,
          message: `Successfully switched to cluster: ${clusterTag}`
        });
      } catch (kubectlError) {
        console.error(`Failed to switch kubectl config for ${clusterTag}:`, kubectlError.message);
        
        // 即使kubectl切换失败，也返回成功，但包含警告信息
        res.json({
          success: true,
          activeCluster: clusterTag,
          message: `Switched to cluster: ${clusterTag}. Warning: kubectl config switch failed - ${kubectlError.message}`,
          kubectlWarning: kubectlError.message
        });
      }
      
    } catch (error) {
      console.error('Error switching cluster:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // 切换kubectl配置到指定集群
  async switchKubectlConfig(clusterTag) {
    try {
      // 读取集群配置获取AWS_REGION和EKS集群名称
      const configDir = this.clusterManager.getClusterConfigDir(clusterTag);
      const initEnvsPath = path.join(configDir, 'init_envs');
      
      if (!fs.existsSync(initEnvsPath)) {
        console.warn(`No init_envs found for cluster ${clusterTag}, skipping kubectl config switch`);
        return;
      }

      const envContent = fs.readFileSync(initEnvsPath, 'utf8');
      
      // 提取AWS_REGION和EKS集群名称
      const awsRegionMatch = envContent.match(/export AWS_REGION=(.+)/);
      const eksClusterMatch = envContent.match(/export EKS_CLUSTER_NAME=(.+)/);
      
      if (!awsRegionMatch || !eksClusterMatch) {
        console.warn(`Missing AWS_REGION or EKS_CLUSTER_NAME in ${clusterTag} config`);
        return;
      }

      const awsRegion = awsRegionMatch[1].replace(/['"]/g, '').trim();
      let eksClusterName = eksClusterMatch[1].replace(/['"]/g, '').trim();
      
      // 如果EKS集群名称包含变量，需要替换
      if (eksClusterName.includes('$CLUSTER_TAG')) {
        eksClusterName = eksClusterName.replace('$CLUSTER_TAG', clusterTag);
      }

      console.log(`Updating kubectl config for cluster: ${eksClusterName} in region: ${awsRegion}`);

      // 执行aws eks update-kubeconfig命令
      const command = `aws eks update-kubeconfig --region ${awsRegion} --name ${eksClusterName}`;
      
      return new Promise((resolve, reject) => {
        exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
          if (error) {
            console.error(`Failed to update kubectl config: ${error.message}`);
            console.error(`Command: ${command}`);
            console.error(`Stderr: ${stderr}`);
            reject(error);
          } else {
            console.log(`Successfully updated kubectl config for cluster: ${eksClusterName}`);
            console.log(`Stdout: ${stdout}`);
            resolve(stdout);
          }
        });
      });

    } catch (error) {
      console.error(`Error in switchKubectlConfig: ${error.message}`);
      throw error;
    }
  }

  // 保存集群配置（支持多集群）
  async handleSaveConfig(req, res) {
    try {
      const config = req.body;
      console.log('Saving cluster configuration:', config);

      // 构建环境变量内容
      const envContent = `export CLUSTER_TAG=${config.clusterTag}
export AWS_REGION=${config.awsRegion}
${config.enableFtp && config.ftpName ? `export FTP_NAME=${config.ftpName}` : '# export FTP_NAME=your-ftp-name'}
export GPU_CAPACITY_AZ=${config.gpuCapacityAz}
export GPU_INSTANCE_TYPE=${config.gpuInstanceType}
export GPU_INSTANCE_COUNT=${config.gpuInstanceCount}

# Automatic fill
export CLOUD_FORMATION_FULL_STACK_NAME=full-stack-$CLUSTER_TAG
export EKS_CLUSTER_NAME=eks-cluster-$CLUSTER_TAG
export HP_CLUSTER_NAME=hp-cluster-$CLUSTER_TAG
export DEPLOY_MODEL_S3_BUCKET=cluster-mount-$CLUSTER_TAG
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export STACK_ID=$CLOUD_FORMATION_FULL_STACK_NAME
export AWS_AZ=$(aws ec2 describe-availability-zones --region $AWS_REGION --query "AvailabilityZones[?ZoneName=='$GPU_CAPACITY_AZ'].ZoneId" --output text)`;

      // 提取集群标识
      const clusterTag = config.clusterTag;
      
      // 创建集群目录结构
      this.clusterManager.createClusterDirs(clusterTag);
      
      // 保存集群专用的 init_envs
      const clusterConfigDir = this.clusterManager.getClusterConfigDir(clusterTag);
      const clusterInitEnvs = path.join(clusterConfigDir, 'init_envs');
      await fs.writeFile(clusterInitEnvs, envContent);
      
      // 更新 CLI 目录的 init_envs (用于执行脚本)
      const cliInitEnvs = path.join(this.clusterManager.cliDir, 'init_envs');
      
      // 备份原文件
      if (fs.existsSync(cliInitEnvs)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${cliInitEnvs}.backup.${timestamp}`;
        await fs.copy(cliInitEnvs, backupPath);
        console.log(`Backed up original init_envs to: ${backupPath}`);
      }
      
      await fs.writeFile(cliInitEnvs, envContent);
      
      // 保存集群基本信息
      this.clusterManager.saveClusterInfo(clusterTag, config);
      
      // 设置为活跃集群
      this.clusterManager.setActiveCluster(clusterTag);
      
      // 清除该集群的状态缓存
      this.clusterManager.clearClusterCache(clusterTag);
      
      console.log(`Configuration saved for cluster: ${clusterTag}`);

      res.json({
        success: true,
        message: 'Configuration saved successfully',
        clusterTag,
        backupCreated: true
      });

    } catch (error) {
      console.error('Error saving cluster configuration:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // 执行集群启动 (Step 1) - 支持多集群
  async handleLaunch(req, res) {
    try {
      const activeCluster = this.clusterManager.getActiveCluster();
      
      if (!activeCluster) {
        return res.status(400).json({
          success: false,
          error: 'No active cluster. Please save configuration first.'
        });
      }

      console.log(`Launching cluster (Step 1) for: ${activeCluster}`);
      
      // 清除 Step 1 缓存
      this.clusterManager.clearClusterCache(activeCluster);
      
      // 创建集群专用的日志管理器
      const logManager = new MultiClusterLogManager(activeCluster);
      const logFilePath = logManager.createLogFile('launch');
      
      // 执行脚本
      const cliPath = this.clusterManager.cliDir;
      const command = `cd "${cliPath}" && nohup bash -c 'echo "y" | bash 1-cluster-launch.sh' > "${logFilePath}" 2>&1 &`;
      
      exec(command, (error) => {
        if (error) {
          console.error('Failed to start launch script:', error);
        } else {
          console.log('Launch script started successfully');
          
          // 5秒后开始监控并备份生成的文件
          setTimeout(() => {
            this.clusterManager.backupGeneratedFiles(activeCluster, 'step1');
          }, 5000);
        }
      });

      res.json({
        success: true,
        message: `Step 1 launched for cluster: ${activeCluster}`,
        clusterTag: activeCluster
      });

    } catch (error) {
      console.error('Error launching cluster:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // 执行集群配置 (Step 2) - 支持多集群
  async handleConfigure(req, res) {
    try {
      const activeCluster = this.clusterManager.getActiveCluster();
      
      if (!activeCluster) {
        return res.status(400).json({
          success: false,
          error: 'No active cluster. Please save configuration first.'
        });
      }

      console.log(`Configuring cluster (Step 2) for: ${activeCluster}`);
      
      // 清除 Step 2 缓存
      this.clusterManager.clearClusterCache(activeCluster);
      
      // 创建集群专用的日志管理器
      const logManager = new MultiClusterLogManager(activeCluster);
      const logFilePath = logManager.createLogFile('configure');
      
      // 执行脚本
      const cliPath = this.clusterManager.cliDir;
      const command = `cd "${cliPath}" && nohup bash -c 'echo "y" | bash 2-cluster-configs.sh' > "${logFilePath}" 2>&1 &`;
      
      exec(command, (error) => {
        if (error) {
          console.error('Failed to start configure script:', error);
        } else {
          console.log('Configure script started successfully');
          
          // 10秒后开始监控并备份生成的文件
          setTimeout(() => {
            this.clusterManager.backupGeneratedFiles(activeCluster, 'step2');
          }, 10000);
        }
      });

      res.json({
        success: true,
        message: `Step 2 launched for cluster: ${activeCluster}`,
        clusterTag: activeCluster
      });

    } catch (error) {
      console.error('Error configuring cluster:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // 获取日志内容 - 支持多集群
  async handleGetLogs(req, res) {
    try {
      const { step } = req.params;
      const offset = parseInt(req.query.offset) || 0;
      const activeCluster = this.clusterManager.getActiveCluster();
      
      if (!activeCluster) {
        return res.json({
          success: true,
          data: { content: '', offset: 0, exists: false },
          message: 'No active cluster'
        });
      }

      const logManager = new MultiClusterLogManager(activeCluster);
      const result = logManager.readLogContent(step, offset);
      
      res.json({
        success: true,
        data: result,
        clusterTag: activeCluster
      });

    } catch (error) {
      console.error('Error getting logs:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // 获取历史日志列表 - 支持多集群
  async handleGetLogsHistory(req, res) {
    try {
      const activeCluster = this.clusterManager.getActiveCluster();
      
      if (!activeCluster) {
        return res.json({
          success: true,
          data: [],
          message: 'No active cluster'
        });
      }

      const logManager = new MultiClusterLogManager(activeCluster);
      const logFiles = logManager.getLogHistory();
      
      res.json({
        success: true,
        data: logFiles,
        clusterTag: activeCluster
      });

    } catch (error) {
      console.error('Error getting log history:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // 手动切换kubectl配置
  async handleSwitchKubectlConfig(req, res) {
    try {
      const activeCluster = this.clusterManager.getActiveCluster();
      
      if (!activeCluster) {
        return res.status(400).json({
          success: false,
          error: 'No active cluster'
        });
      }

      console.log(`Manually switching kubectl config for cluster: ${activeCluster}`);
      
      await this.switchKubectlConfig(activeCluster);
      
      res.json({
        success: true,
        message: `Kubectl config updated for cluster: ${activeCluster}`,
        clusterTag: activeCluster
      });

    } catch (error) {
      console.error('Error switching kubectl config:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // 清除状态缓存 - 支持多集群
  async handleClearStatusCache(req, res) {
    try {
      const activeCluster = this.clusterManager.getActiveCluster();
      
      if (!activeCluster) {
        return res.json({
          success: true,
          message: 'No active cluster'
        });
      }

      this.clusterManager.clearClusterCache(activeCluster);
      
      res.json({
        success: true,
        message: `Status cache cleared for cluster: ${activeCluster}`,
        clusterTag: activeCluster
      });

    } catch (error) {
      console.error('Error clearing status cache:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = MultiClusterAPIs;
