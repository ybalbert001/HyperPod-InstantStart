const fs = require('fs');
const path = require('path');

class ClusterManager {
  constructor() {
    this.baseDir = path.join(__dirname, '..', 'managed_clusters_info'); // 修正路径
    this.clustersDir = this.baseDir; // 添加clustersDir属性
    this.cliDir = path.join(__dirname, '..', '..', 'cli'); // 修正路径
    this.activeClusterFile = path.join(this.baseDir, 'active_cluster.json');
    
    // 确保基础目录存在
    this.ensureBaseDir();
  }

  ensureBaseDir() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  // 从 init_envs 内容提取集群标识
  extractClusterTag(initEnvsContent) {
    const match = initEnvsContent.match(/export CLUSTER_TAG=(.+)/);
    if (!match) {
      throw new Error('CLUSTER_TAG not found in configuration');
    }
    return match[1].replace(/['"]/g, '').trim();
  }

  // 获取集群目录路径
  getClusterDir(clusterTag) {
    return path.join(this.baseDir, clusterTag);
  }

  getClusterConfigDir(clusterTag) {
    return path.join(this.getClusterDir(clusterTag), 'config');
  }

  getClusterLogsDir(clusterTag) {
    return path.join(this.getClusterDir(clusterTag), 'logs');
  }

  getClusterCurrentDir(clusterTag) {
    return path.join(this.getClusterDir(clusterTag), 'current');
  }

  getClusterMetadataDir(clusterTag) {
    return path.join(this.getClusterDir(clusterTag), 'metadata');
  }

  // 创建集群目录结构
  createClusterDirs(clusterTag) {
    const dirs = [
      this.getClusterDir(clusterTag),
      this.getClusterConfigDir(clusterTag),
      this.getClusterLogsDir(clusterTag),
      this.getClusterCurrentDir(clusterTag),
      this.getClusterMetadataDir(clusterTag)
    ];

    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  // 获取活跃集群
  getActiveCluster() {
    try {
      if (fs.existsSync(this.activeClusterFile)) {
        const data = JSON.parse(fs.readFileSync(this.activeClusterFile, 'utf8'));
        return data.activeCluster;
      }
    } catch (error) {
      console.warn('Failed to read active cluster:', error.message);
    }
    return null;
  }

  // 设置活跃集群
  setActiveCluster(clusterTag) {
    const data = { activeCluster: clusterTag, lastUpdated: new Date().toISOString() };
    fs.writeFileSync(this.activeClusterFile, JSON.stringify(data, null, 2));
  }

  // 获取所有集群列表
  getAllClusters() {
    const clusters = [];
    
    try {
      if (!fs.existsSync(this.baseDir)) {
        return clusters;
      }

      const dirs = fs.readdirSync(this.baseDir);
      
      for (const dir of dirs) {
        if (dir === 'active_cluster.json') continue;
        
        const clusterInfoPath = path.join(this.getClusterMetadataDir(dir), 'cluster_info.json');
        if (fs.existsSync(clusterInfoPath)) {
          try {
            const clusterInfo = JSON.parse(fs.readFileSync(clusterInfoPath, 'utf8'));
            clusters.push(clusterInfo);
          } catch (error) {
            console.warn(`Failed to read cluster info for ${dir}:`, error.message);
          }
        }
      }
    } catch (error) {
      console.error('Failed to get clusters:', error.message);
    }

    return clusters.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
  }

  // 保存集群信息
  saveClusterInfo(clusterTag, config) {
    const clusterInfo = {
      clusterTag,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      config: config,
      status: 'configured'
    };

    const clusterInfoPath = path.join(this.getClusterMetadataDir(clusterTag), 'cluster_info.json');
    fs.writeFileSync(clusterInfoPath, JSON.stringify(clusterInfo, null, 2));
    
    return clusterInfo;
  }

  // 备份生成的配置文件
  backupGeneratedFiles(clusterTag, step) {
    const configDir = this.getClusterConfigDir(clusterTag);
    
    const filesToBackup = {
      'step1': ['stack_envs'],
      'step2': ['mlflow-server-info.json']
    };

    const files = filesToBackup[step] || [];
    
    for (const file of files) {
      const sourcePath = path.join(this.cliDir, file);
      const targetPath = path.join(configDir, file);
      
      if (fs.existsSync(sourcePath)) {
        try {
          fs.copyFileSync(sourcePath, targetPath);
          console.log(`Backed up ${file} for cluster ${clusterTag}`);
        } catch (error) {
          console.warn(`Failed to backup ${file}:`, error.message);
        }
      }
    }
  }

  // 恢复集群配置到 CLI 目录
  restoreClusterConfig(clusterTag) {
    const configDir = this.getClusterConfigDir(clusterTag);
    const filesToRestore = ['init_envs', 'stack_envs', 'mlflow-server-info.json'];
    
    for (const file of filesToRestore) {
      const sourcePath = path.join(configDir, file);
      const targetPath = path.join(this.cliDir, file);
      
      if (fs.existsSync(sourcePath)) {
        try {
          fs.copyFileSync(sourcePath, targetPath);
          console.log(`Restored ${file} for cluster ${clusterTag}`);
        } catch (error) {
          console.warn(`Failed to restore ${file}:`, error.message);
        }
      }
    }
  }

  // 清除集群状态缓存
  clearClusterCache(clusterTag) {
    const metadataDir = this.getClusterMetadataDir(clusterTag);
    const cacheFiles = [
      'step1_status_cache.json',
      'step2_status_cache.json'
    ];

    cacheFiles.forEach(file => {
      const filePath = path.join(metadataDir, file);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log(`Cleared cache file: ${file}`);
        } catch (error) {
          console.warn(`Failed to clear cache ${file}:`, error.message);
        }
      }
    });
  }

  /**
   * 保存HyperPod配置
   * @param {string} clusterTag - 集群标识
   * @param {Object} hyperPodConfig - HyperPod配置
   */
  async saveHyperPodConfig(clusterTag, hyperPodConfig) {
    try {
      const clusterDir = path.join(this.clustersDir, clusterTag);
      const metadataDir = path.join(clusterDir, 'metadata');
      
      // 确保目录存在
      if (!fs.existsSync(metadataDir)) {
        fs.mkdirSync(metadataDir, { recursive: true });
      }
      
      // 保存HyperPod配置
      const hyperPodConfigPath = path.join(metadataDir, 'hyperpod-config.json');
      fs.writeFileSync(hyperPodConfigPath, JSON.stringify({
        hyperPodCluster: hyperPodConfig,
        savedAt: new Date().toISOString()
      }, null, 2));
      
      console.log(`HyperPod configuration saved for cluster: ${clusterTag}`);
    } catch (error) {
      console.error('Error saving HyperPod configuration:', error);
      throw error;
    }
  }

  /**
   * 获取HyperPod配置
   * @param {string} clusterTag - 集群标识
   * @returns {Object|null} HyperPod配置
   */
  async getHyperPodConfig(clusterTag) {
    try {
      const hyperPodConfigPath = path.join(this.clustersDir, clusterTag, 'metadata', 'hyperpod-config.json');
      
      if (await fs.pathExists(hyperPodConfigPath)) {
        const config = await fs.readJson(hyperPodConfigPath);
        return config.hyperPodCluster;
      }
      
      return null;
    } catch (error) {
      console.error('Error getting HyperPod configuration:', error);
      return null;
    }
  }

  // 保存导入集群配置
  async saveImportConfig(clusterTag, importConfig, accessInfo = null) {
    const configDir = this.getClusterConfigDir(clusterTag);
    const initEnvsPath = path.join(configDir, 'init_envs');
    
    // 生成init_envs内容
    let content = '#!/bin/bash\n\n';
    content += '# Imported cluster configuration\n';
    
    Object.entries(importConfig).forEach(([key, value]) => {
      content += `export ${key}="${value}"\n`;
    });
    
    fs.writeFileSync(initEnvsPath, content);
    console.log(`Saved import config for cluster: ${clusterTag}`);
    
    // 创建导入元数据
    const metadataDir = this.getClusterMetadataDir(clusterTag);
    const importMetadata = {
      type: 'imported',
      importedAt: new Date().toISOString(),
      eksClusterName: importConfig.EKS_CLUSTER_NAME,
      awsRegion: importConfig.AWS_REGION,
      accessEntry: accessInfo ? {
        action: accessInfo.action,
        roleArn: accessInfo.roleArn,
        policies: accessInfo.policies || [],
        configuredAt: new Date().toISOString(),
        message: accessInfo.message
      } : null
    };
    
    fs.writeFileSync(
      path.join(metadataDir, 'import_metadata.json'),
      JSON.stringify(importMetadata, null, 2)
    );
    
    // 创建cluster_info.json以便在集群列表中显示
    const clusterInfo = {
      clusterTag,
      status: 'imported',
      lastModified: new Date().toISOString(),
      config: {
        clusterTag,
        awsRegion: importConfig.AWS_REGION,
        eksClusterName: importConfig.EKS_CLUSTER_NAME,
        clusterType: 'imported'
      },
      type: 'imported'
    };
    
    fs.writeFileSync(
      path.join(metadataDir, 'cluster_info.json'),
      JSON.stringify(clusterInfo, null, 2)
    );
    
    console.log(`Created cluster info for imported cluster: ${clusterTag}`);
  }

  // 检查集群是否存在
  clusterExists(clusterTag) {
    return fs.existsSync(this.getClusterDir(clusterTag));
  }

  // 保存EKS集群创建配置
  async saveCreationConfig(clusterTag, clusterConfig, cidrConfig, stackResult) {
    // 创建集群目录结构
    this.createClusterDirs(clusterTag);
    
    const configDir = this.getClusterConfigDir(clusterTag);
    const metadataDir = this.getClusterMetadataDir(clusterTag);
    
    // 生成init_envs文件
    const initEnvsContent = this.generateInitEnvsContent(clusterConfig, stackResult.stackName);
    const initEnvsPath = path.join(configDir, 'init_envs');
    fs.writeFileSync(initEnvsPath, initEnvsContent);
    
    // 保存创建元数据
    const creationMetadata = {
      type: 'created',
      createdAt: new Date().toISOString(),
      creationMethod: 'ui-panel',
      userConfig: clusterConfig,
      cidrConfiguration: cidrConfig,
      cloudFormation: {
        stackName: stackResult.stackName,
        stackId: stackResult.stackId,
        templateFile: '1-main-stack-eks-control.yaml',
        status: 'CREATE_IN_PROGRESS',
        parameters: stackResult.parameters
      }
    };
    
    fs.writeFileSync(
      path.join(metadataDir, 'creation_metadata.json'),
      JSON.stringify(creationMetadata, null, 2)
    );
    
    // 保存CIDR配置
    fs.writeFileSync(
      path.join(metadataDir, 'cidr_configuration.json'),
      JSON.stringify(cidrConfig, null, 2)
    );
    
    // 注意：cluster_info.json 应该在创建完成后由 registerCompletedCluster() 生成
    // 这样可以避免未完成的集群出现在 Active Cluster 列表中
    
    console.log(`✅ Saved creation config for cluster: ${clusterTag}`);
    
    console.log(`Saved creation config for cluster: ${clusterTag}`);
  }

  // 生成init_envs文件内容
  generateInitEnvsContent(config, stackName = null) {
    const { clusterTag, awsRegion, gpuInstanceType, gpuInstanceCount, gpuCapacityAz } = config;
    
    return `#!/bin/bash

# EKS Cluster Configuration - Generated by UI Panel
export CLUSTER_TAG=${clusterTag}
export AWS_REGION=${awsRegion}
export GPU_CAPACITY_AZ=${gpuCapacityAz || 'undefined'}
export GPU_INSTANCE_TYPE=${gpuInstanceType || 'undefined'}
export GPU_INSTANCE_COUNT=${gpuInstanceCount || 'undefined'}

# Automatic fill
export CLOUD_FORMATION_FULL_STACK_NAME=${stackName || `full-stack-${clusterTag}`}
export EKS_CLUSTER_NAME=eks-cluster-${clusterTag}
export HP_CLUSTER_NAME=hp-cluster-${clusterTag}
export MLFLOW_SERVER_NAME=mlflow-server-${clusterTag}
export DEPLOY_MODEL_S3_BUCKET=cluster-mount-${clusterTag}
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export STACK_ID=${stackName || `full-stack-${clusterTag}`}
export AWS_AZ=$(aws ec2 describe-availability-zones --region ${awsRegion} --query "AvailabilityZones[?ZoneName=='${gpuCapacityAz || ''}'].ZoneId" --output text)

export CURRENT_ROLE_ARN=$(aws sts get-caller-identity --query Arn --output text)
export CURRENT_ROLE_NAME=$(echo "$CURRENT_ROLE_ARN" | sed 's/.*role\\///' | sed 's/\\/.*//')
export IAM_ROLE_ARN=arn:aws:iam::$ACCOUNT_ID:role/$CURRENT_ROLE_NAME

export CURRENT_ROLE_ARN=$(aws sts get-caller-identity --query Arn --output text)
export CURRENT_ROLE_NAME=$(echo "$CURRENT_ROLE_ARN" | sed 's/.*role\\///' | sed 's/\\/.*//')
export IAM_ROLE_ARN=arn:aws:iam::$ACCOUNT_ID:role/$CURRENT_ROLE_NAME

# Generated by UI Panel on ${new Date().toISOString()}
`;
  }

  // 获取集群信息
  async getClusterInfo(clusterTag) {
    try {
      const clusterInfoPath = path.join(this.getClusterMetadataDir(clusterTag), 'cluster_info.json');
      if (fs.existsSync(clusterInfoPath)) {
        return JSON.parse(fs.readFileSync(clusterInfoPath, 'utf8'));
      }
      return null;
    } catch (error) {
      console.error(`Error getting cluster info for ${clusterTag}:`, error);
      return null;
    }
  }

  // 更新集群状态
  async updateClusterStatus(clusterTag, status, additionalInfo = {}) {
    try {
      const clusterInfo = await this.getClusterInfo(clusterTag);
      if (clusterInfo) {
        clusterInfo.status = status;
        clusterInfo.lastModified = new Date().toISOString();
        Object.assign(clusterInfo, additionalInfo);
        
        const clusterInfoPath = path.join(this.getClusterMetadataDir(clusterTag), 'cluster_info.json');
        fs.writeFileSync(clusterInfoPath, JSON.stringify(clusterInfo, null, 2));
      }
    } catch (error) {
      console.error(`Error updating cluster status for ${clusterTag}:`, error);
    }
  }
}

module.exports = ClusterManager;
