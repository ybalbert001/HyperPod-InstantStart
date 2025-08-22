const fs = require('fs');
const path = require('path');

class ClusterManager {
  constructor() {
    this.baseDir = path.join(__dirname, '..', 'managed_clusters_info'); // 修正路径
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

  // 检查集群是否存在
  clusterExists(clusterTag) {
    return fs.existsSync(this.getClusterDir(clusterTag));
  }
}

module.exports = ClusterManager;
