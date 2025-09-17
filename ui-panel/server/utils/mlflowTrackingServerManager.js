const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

class MLflowTrackingServerManager {
  constructor() {
    this.managedClustersPath = path.join(__dirname, '../../managed_clusters_info');
  }

  // 获取活跃集群信息
  getActiveCluster() {
    const activeClusterPath = path.join(this.managedClustersPath, 'active_cluster.json');
    if (!fs.existsSync(activeClusterPath)) {
      throw new Error('No active cluster found');
    }
    
    const activeClusterInfo = fs.readJsonSync(activeClusterPath);
    const activeCluster = activeClusterInfo.activeCluster;
    
    if (!activeCluster) {
      throw new Error('No active cluster selected');
    }
    
    return activeCluster;
  }

  // 获取环境变量
  async getEnvVar(varName, activeCluster = null) {
    if (!activeCluster) {
      activeCluster = this.getActiveCluster();
    }
    
    const initEnvsPath = path.join(this.managedClustersPath, activeCluster, 'config/init_envs');
    const cmd = `source ${initEnvsPath} && echo $${varName}`;
    
    try {
      const result = execSync(cmd, { shell: '/bin/bash', encoding: 'utf8' });
      return result.trim();
    } catch (error) {
      console.warn(`Failed to get environment variable ${varName}:`, error.message);
      return null;
    }
  }

  // 获取S3 bucket名称
  async getS3BucketFromMetadata() {
    try {
      const files = await fs.readdir('/s3-workspace-metadata');
      if (files.length === 0) {
        throw new Error('No S3 bucket metadata found');
      }
      
      // 文件名格式: CURRENT_BUCKET_{actual-bucket-name}
      const bucketFile = files[0];
      if (!bucketFile.startsWith('CURRENT_BUCKET_')) {
        throw new Error('Invalid S3 bucket metadata format');
      }
      
      // 移除前缀获取实际bucket名称
      const actualBucketName = bucketFile.replace('CURRENT_BUCKET_', '');
      return actualBucketName;
    } catch (error) {
      throw new Error(`Failed to get S3 bucket from metadata: ${error.message}`);
    }
  }

  // 获取当前IAM role ARN
  async getCurrentIAMRole() {
    try {
      // 获取assumed role ARN
      const assumedRoleResult = execSync('aws sts get-caller-identity --query "Arn" --output text', { encoding: 'utf8' });
      const assumedRole = assumedRoleResult.trim();
      
      // 从assumed-role中提取role名称
      const roleName = assumedRole.replace(/.*assumed-role\//, '').replace(/\/.*/, '');
      
      // 获取原始role ARN
      const roleResult = execSync(`aws iam get-role --role-name ${roleName} --query "Role.Arn" --output text`, { encoding: 'utf8' });
      return roleResult.trim();
    } catch (error) {
      throw new Error(`Failed to get IAM role: ${error.message}`);
    }
  }

  // 创建MLflow tracking server
  async createTrackingServer(serverName, serverSize = 'Small') {
    try {
      console.log(`Creating MLflow tracking server: ${serverName}`);
      
      // 获取所有必需参数
      const region = await this.getEnvVar('AWS_REGION') || 'us-west-2';
      const s3Bucket = await this.getS3BucketFromMetadata();
      const iamRoleArn = await this.getCurrentIAMRole();
      
      console.log(`Parameters: Region=${region}, S3Bucket=${s3Bucket}, IAMRole=${iamRoleArn}`);
      
      // 构建AWS CLI命令
      const cmd = `aws sagemaker create-mlflow-tracking-server \
        --tracking-server-name ${serverName} \
        --artifact-store-uri "s3://${s3Bucket}" \
        --tracking-server-size "${serverSize}" \
        --mlflow-version "3.0" \
        --role-arn ${iamRoleArn} \
        --region ${region}`;
      
      console.log('Executing command:', cmd);
      
      // 执行命令
      const result = execSync(cmd, { encoding: 'utf8' });
      
      console.log('MLflow tracking server created successfully');
      console.log('Result:', result);
      
      // 解析返回结果
      const serverInfo = JSON.parse(result);
      
      // 保存服务器信息到集群配置
      await this.saveTrackingServerInfo(serverInfo, {
        serverName,
        serverSize,
        region,
        s3Bucket,
        iamRoleArn
      });
      
      return {
        success: true,
        message: `MLflow tracking server "${serverName}" created successfully`,
        serverInfo: serverInfo
      };
      
    } catch (error) {
      console.error('Error creating MLflow tracking server:', error);
      throw new Error(`Failed to create MLflow tracking server: ${error.message}`);
    }
  }

  // 保存tracking server信息到集群配置
  async saveTrackingServerInfo(serverInfo, additionalInfo) {
    try {
      const activeCluster = this.getActiveCluster();
      const configDir = path.join(this.managedClustersPath, activeCluster, 'config');
      
      // 确保配置目录存在
      await fs.ensureDir(configDir);
      
      // 保存完整的服务器信息
      const trackingServerInfoPath = path.join(configDir, 'mlflow-server-info.json');
      const completeInfo = {
        ...serverInfo,
        ...additionalInfo,
        createdAt: new Date().toISOString(),
        clusterTag: activeCluster
      };
      
      await fs.writeJson(trackingServerInfoPath, completeInfo, { spaces: 2 });
      
      console.log(`MLflow server info saved to: ${trackingServerInfoPath}`);
      
    } catch (error) {
      console.error('Error saving tracking server info:', error);
      // 不抛出错误，因为服务器已经创建成功
    }
  }

  // 获取tracking server状态
  async getTrackingServerStatus(serverName, region = null) {
    try {
      if (!region) {
        region = await this.getEnvVar('AWS_REGION') || 'us-west-2';
      }
      
      const cmd = `aws sagemaker describe-mlflow-tracking-server --tracking-server-name ${serverName} --region ${region}`;
      const result = execSync(cmd, { encoding: 'utf8' });
      
      return JSON.parse(result);
      
    } catch (error) {
      if (error.message.includes('does not exist')) {
        return null;
      }
      throw new Error(`Failed to get tracking server status: ${error.message}`);
    }
  }

  // 列出所有tracking servers
  async listTrackingServers(region = null) {
    try {
      if (!region) {
        region = await this.getEnvVar('AWS_REGION') || 'us-west-2';
      }
      
      const cmd = `aws sagemaker list-mlflow-tracking-servers --region ${region}`;
      const result = execSync(cmd, { encoding: 'utf8' });
      
      return JSON.parse(result);
      
    } catch (error) {
      throw new Error(`Failed to list tracking servers: ${error.message}`);
    }
  }

  // 删除tracking server
  async deleteTrackingServer(serverName, region = null) {
    try {
      if (!region) {
        region = await this.getEnvVar('AWS_REGION') || 'us-west-2';
      }
      
      const cmd = `aws sagemaker delete-mlflow-tracking-server --tracking-server-name ${serverName} --region ${region}`;
      const result = execSync(cmd, { encoding: 'utf8' });
      
      // 删除本地保存的服务器信息
      await this.removeTrackingServerInfo();
      
      return {
        success: true,
        message: `MLflow tracking server "${serverName}" deleted successfully`
      };
      
    } catch (error) {
      throw new Error(`Failed to delete tracking server: ${error.message}`);
    }
  }

  // 删除本地保存的tracking server信息
  async removeTrackingServerInfo() {
    try {
      const activeCluster = this.getActiveCluster();
      const trackingServerInfoPath = path.join(this.managedClustersPath, activeCluster, 'config', 'mlflow-server-info.json');
      
      if (await fs.pathExists(trackingServerInfoPath)) {
        await fs.remove(trackingServerInfoPath);
        console.log('Local MLflow server info removed');
      }
      
    } catch (error) {
      console.error('Error removing local tracking server info:', error);
      // 不抛出错误
    }
  }

  // 验证服务器名称
  validateServerName(serverName) {
    if (!serverName) {
      throw new Error('Server name is required');
    }
    
    if (!/^[a-zA-Z0-9-]+$/.test(serverName)) {
      throw new Error('Server name can only contain alphanumeric characters and hyphens');
    }
    
    if (serverName.length > 63) {
      throw new Error('Server name cannot exceed 63 characters');
    }
    
    return true;
  }

  // 验证服务器大小
  validateServerSize(serverSize) {
    const validSizes = ['Small', 'Medium', 'Large'];
    if (!validSizes.includes(serverSize)) {
      throw new Error(`Invalid server size. Must be one of: ${validSizes.join(', ')}`);
    }
    
    return true;
  }
}

module.exports = MLflowTrackingServerManager;
