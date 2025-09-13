#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');

// 数据迁移脚本：从单集群到多集群
class DataMigration {
  constructor() {
    this.oldTmpDir = path.join(__dirname, 'tmp/cluster-management');
    this.newBaseDir = path.join(__dirname, 'managed_clusters_info'); // 修正路径
    this.cliDir = path.join(__dirname, '../cli');
  }

  async migrate() {
    console.log('🚀 Starting migration from single-cluster to multi-cluster...');
    
    try {
      // 1. 检查是否有现有数据需要迁移
      const hasOldData = await this.checkOldData();
      
      if (!hasOldData) {
        console.log('✅ No existing data found. Migration not needed.');
        return;
      }

      // 2. 读取现有的 init_envs 获取集群标识
      const clusterTag = await this.extractClusterTag();
      
      if (!clusterTag) {
        console.log('⚠️  No valid cluster tag found in init_envs. Skipping migration.');
        return;
      }

      console.log(`📋 Found existing cluster: ${clusterTag}`);

      // 3. 创建新的集群目录结构
      await this.createClusterDirs(clusterTag);

      // 4. 迁移配置文件
      await this.migrateConfigFiles(clusterTag);

      // 5. 迁移日志文件
      await this.migrateLogFiles(clusterTag);

      // 6. 迁移元数据
      await this.migrateMetadata(clusterTag);

      // 7. 设置为活跃集群
      await this.setActiveCluster(clusterTag);

      // 8. 清理旧数据（可选）
      await this.cleanupOldData();

      console.log('✅ Migration completed successfully!');
      console.log(`🎯 Active cluster set to: ${clusterTag}`);
      console.log(`📁 Data migrated to: ${path.join(this.newBaseDir, clusterTag)}`);

    } catch (error) {
      console.error('❌ Migration failed:', error.message);
      process.exit(1);
    }
  }

  async checkOldData() {
    const checks = [
      fs.existsSync(this.oldTmpDir),
      fs.existsSync(path.join(this.cliDir, 'init_envs')),
      fs.existsSync(path.join(this.cliDir, 'stack_envs')),
      fs.existsSync(path.join(this.cliDir, 'mlflow-server-info.json'))
    ];

    return checks.some(check => check);
  }

  async extractClusterTag() {
    try {
      const initEnvsPath = path.join(this.cliDir, 'init_envs');
      
      if (!fs.existsSync(initEnvsPath)) {
        return null;
      }

      const content = await fs.readFile(initEnvsPath, 'utf8');
      const match = content.match(/export CLUSTER_TAG=(.+)/);
      
      if (match) {
        return match[1].replace(/['"]/g, '').trim();
      }
      
      return null;
    } catch (error) {
      console.warn('Failed to extract cluster tag:', error.message);
      return null;
    }
  }

  async createClusterDirs(clusterTag) {
    const clusterDir = path.join(this.newBaseDir, clusterTag);
    const dirs = [
      clusterDir,
      path.join(clusterDir, 'config'),
      path.join(clusterDir, 'logs'),
      path.join(clusterDir, 'current'),
      path.join(clusterDir, 'metadata')
    ];

    for (const dir of dirs) {
      await fs.ensureDir(dir);
      console.log(`📁 Created directory: ${dir}`);
    }
  }

  async migrateConfigFiles(clusterTag) {
    const configDir = path.join(this.newBaseDir, clusterTag, 'config');
    const filesToMigrate = ['init_envs', 'stack_envs', 'mlflow-server-info.json'];

    for (const file of filesToMigrate) {
      const sourcePath = path.join(this.cliDir, file);
      const targetPath = path.join(configDir, file);

      if (fs.existsSync(sourcePath)) {
        await fs.copy(sourcePath, targetPath);
        console.log(`📄 Migrated config file: ${file}`);
      }
    }
  }

  async migrateLogFiles(clusterTag) {
    const oldLogsDir = path.join(this.oldTmpDir, 'logs');
    const newLogsDir = path.join(this.newBaseDir, clusterTag, 'logs');
    const newCurrentDir = path.join(this.newBaseDir, clusterTag, 'current');

    if (fs.existsSync(oldLogsDir)) {
      const logFiles = await fs.readdir(oldLogsDir);
      
      for (const file of logFiles) {
        if (file.endsWith('.log')) {
          const sourcePath = path.join(oldLogsDir, file);
          const targetPath = path.join(newLogsDir, file);
          
          await fs.copy(sourcePath, targetPath);
          console.log(`📋 Migrated log file: ${file}`);
        }
      }
    }

    // 迁移软链接
    const oldCurrentDir = path.join(this.oldTmpDir, 'current');
    if (fs.existsSync(oldCurrentDir)) {
      const currentFiles = await fs.readdir(oldCurrentDir);
      
      for (const file of currentFiles) {
        const oldLinkPath = path.join(oldCurrentDir, file);
        
        if (fs.lstatSync(oldLinkPath).isSymbolicLink()) {
          // 读取原始链接目标
          const linkTarget = await fs.readlink(oldLinkPath);
          const newLinkPath = path.join(newCurrentDir, file);
          
          // 创建新的软链接
          await fs.symlink(linkTarget, newLinkPath);
          console.log(`🔗 Migrated symlink: ${file}`);
        }
      }
    }
  }

  async migrateMetadata(clusterTag) {
    const oldMetadataDir = path.join(this.oldTmpDir, 'metadata');
    const newMetadataDir = path.join(this.newBaseDir, clusterTag, 'metadata');

    if (fs.existsSync(oldMetadataDir)) {
      const metadataFiles = await fs.readdir(oldMetadataDir);
      
      for (const file of metadataFiles) {
        const sourcePath = path.join(oldMetadataDir, file);
        const targetPath = path.join(newMetadataDir, file);
        
        await fs.copy(sourcePath, targetPath);
        console.log(`🗃️  Migrated metadata: ${file}`);
      }
    }

    // 创建集群信息文件
    const clusterInfo = {
      clusterTag,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      config: await this.extractConfigFromInitEnvs(clusterTag),
      status: 'migrated'
    };

    const clusterInfoPath = path.join(newMetadataDir, 'cluster_info.json');
    await fs.writeFile(clusterInfoPath, JSON.stringify(clusterInfo, null, 2));
    console.log(`📋 Created cluster info: cluster_info.json`);
  }

  async extractConfigFromInitEnvs(clusterTag) {
    try {
      const initEnvsPath = path.join(this.newBaseDir, clusterTag, 'config', 'init_envs');
      
      if (!fs.existsSync(initEnvsPath)) {
        return {};
      }

      const content = await fs.readFile(initEnvsPath, 'utf8');
      
      const extractValue = (key) => {
        const match = content.match(new RegExp(`export ${key}=(.+)`));
        return match ? match[1].replace(/['"]/g, '').trim() : '';
      };

      return {
        clusterTag: extractValue('CLUSTER_TAG'),
        awsRegion: extractValue('AWS_REGION'),
        ftpName: extractValue('FTP_NAME'),
        gpuCapacityAz: extractValue('GPU_CAPACITY_AZ'),
        gpuInstanceType: extractValue('GPU_INSTANCE_TYPE'),
        gpuInstanceCount: parseInt(extractValue('GPU_INSTANCE_COUNT')) || 1,
        enableFtp: !!extractValue('FTP_NAME')
      };
    } catch (error) {
      console.warn('Failed to extract config from init_envs:', error.message);
      return {};
    }
  }

  async setActiveCluster(clusterTag) {
    const activeClusterFile = path.join(this.newBaseDir, 'active_cluster.json');
    const data = {
      activeCluster: clusterTag,
      lastUpdated: new Date().toISOString()
    };

    await fs.writeFile(activeClusterFile, JSON.stringify(data, null, 2));
    console.log(`🎯 Set active cluster: ${clusterTag}`);
  }

  async cleanupOldData() {
    const answer = await this.askQuestion('Do you want to remove old data in tmp/cluster-management? (y/N): ');
    
    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      if (fs.existsSync(this.oldTmpDir)) {
        await fs.remove(this.oldTmpDir);
        console.log('🗑️  Removed old tmp data');
      }
    } else {
      console.log('📁 Old data preserved in tmp/cluster-management');
    }
  }

  askQuestion(question) {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}

// 运行迁移
if (require.main === module) {
  const migration = new DataMigration();
  migration.migrate();
}

module.exports = DataMigration;
