/**
 * CloudFormation管理工具
 * 处理EKS集群的CloudFormation Stack创建和管理
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

// 读取client/user.env配置
require('dotenv').config({ path: path.join(__dirname, '../../client/user.env') });

class CloudFormationManager {
  /**
   * 获取CloudFormation模板路径
   * @param {string} templatePath - 可选的模板路径覆盖
   * @returns {string} 模板文件的绝对路径
   */
  static getTemplatePath(templatePath = null) {
    // 从client/user.env获取模板路径，或使用传入的路径
    const envTemplatePath = templatePath || process.env.CF_TEMPLATE_PATH;
    
    if (!envTemplatePath) {
      throw new Error('CloudFormation template path not configured. Please set CF_TEMPLATE_PATH in client/user.env');
    }
    
    // 使用挂载的项目根目录
    const projectRoot = path.join(__dirname, '../../hyperpod-instantstart');
    return path.join(projectRoot, envTemplatePath);
  }

  /**
   * 创建CloudFormation Stack
   * @param {Object} config - 集群配置
   * @param {Object} cidrConfig - CIDR配置
   * @returns {Promise<Object>} 创建结果
   */
  static async createStack(config, cidrConfig) {
    try {
      const { clusterTag, awsRegion, stackName } = config;
      
      // 使用传入的stackName或生成默认名称
      const finalStackName = stackName || `full-stack-${clusterTag}`;
      const eksClusterName = `eks-cluster-${clusterTag}`;
      
      // 构建CloudFormation参数
      const parameters = this.buildCloudFormationParameters(
        clusterTag,
        eksClusterName,
        cidrConfig
      );
      
      // 获取模板文件路径
      const templatePath = this.getTemplatePath();
      
      if (!fs.existsSync(templatePath)) {
        throw new Error(`CloudFormation template not found: ${templatePath}`);
      }
      
      // 构建AWS CLI命令
      const command = this.buildCreateStackCommand(finalStackName, templatePath, awsRegion, parameters);
      
      console.log(`Creating CloudFormation stack: ${finalStackName}`);
      console.log(`Command: ${command}`);
      
      // 执行创建命令
      const result = execSync(command, { encoding: 'utf8' });
      
      return {
        success: true,
        stackName: finalStackName,
        eksClusterName,
        region: awsRegion,
        stackId: JSON.parse(result).StackId,
        parameters: parameters,
        createdAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error creating CloudFormation stack:', error);
      throw error;
    }
  }

  /**
   * 获取Stack状态
   * @param {string} stackName - Stack名称
   * @param {string} region - AWS区域
   * @returns {Promise<Object>} Stack状态
   */
  static async getStackStatus(stackName, region) {
    try {
      const command = `aws cloudformation describe-stacks --stack-name ${stackName} --region ${region}`;
      const result = execSync(command, { encoding: 'utf8' });
      const stacks = JSON.parse(result).Stacks;
      
      if (stacks.length === 0) {
        throw new Error(`Stack not found: ${stackName}`);
      }
      
      const stack = stacks[0];
      return {
        stackName: stack.StackName,
        stackStatus: stack.StackStatus,
        creationTime: stack.CreationTime,
        lastUpdatedTime: stack.LastUpdatedTime,
        stackStatusReason: stack.StackStatusReason,
        outputs: stack.Outputs || []
      };
    } catch (error) {
      if (error.message.includes('does not exist')) {
        return {
          stackName,
          stackStatus: 'NOT_FOUND',
          error: 'Stack does not exist'
        };
      }
      throw error;
    }
  }

  /**
   * 获取Stack事件
   * @param {string} stackName - Stack名称
   * @param {string} region - AWS区域
   * @returns {Promise<Array>} Stack事件列表
   */
  static async getStackEvents(stackName, region) {
    try {
      const command = `aws cloudformation describe-stack-events --stack-name ${stackName} --region ${region}`;
      const result = execSync(command, { encoding: 'utf8' });
      const events = JSON.parse(result).StackEvents;
      
      return events.map(event => ({
        timestamp: event.Timestamp,
        logicalResourceId: event.LogicalResourceId,
        resourceType: event.ResourceType,
        resourceStatus: event.ResourceStatus,
        resourceStatusReason: event.ResourceStatusReason
      }));
    } catch (error) {
      console.error('Error getting stack events:', error);
      return [];
    }
  }

  /**
   * 取消Stack创建
   * @param {string} stackName - Stack名称
   * @param {string} region - AWS区域
   * @returns {Promise<Object>} 取消结果
   */
  static async cancelStackCreation(stackName, region) {
    try {
      const command = `aws cloudformation cancel-update-stack --stack-name ${stackName} --region ${region}`;
      execSync(command, { encoding: 'utf8' });
      
      return {
        success: true,
        message: `Stack creation cancelled: ${stackName}`
      };
    } catch (error) {
      // 如果是CREATE_IN_PROGRESS状态，使用delete-stack
      try {
        const deleteCommand = `aws cloudformation delete-stack --stack-name ${stackName} --region ${region}`;
        execSync(deleteCommand, { encoding: 'utf8' });
        
        return {
          success: true,
          message: `Stack deletion initiated: ${stackName}`
        };
      } catch (deleteError) {
        throw new Error(`Failed to cancel stack creation: ${deleteError.message}`);
      }
    }
  }

  /**
   * 构建CloudFormation参数
   * @param {string} clusterTag - 集群标识
   * @param {string} eksClusterName - EKS集群名称
   * @param {Object} cidrConfig - CIDR配置
   * @returns {Array} 参数数组
   */
  static buildCloudFormationParameters(clusterTag, eksClusterName, cidrConfig) {
    return [
      `ParameterKey=EKSClusterName,ParameterValue=${eksClusterName}`,
      `ParameterKey=ResourceNamePrefix,ParameterValue=${clusterTag}`,
      `ParameterKey=VpcCIDR,ParameterValue=${cidrConfig.vpcCidr}`,
      `ParameterKey=PublicSubnet1CIDR,ParameterValue=${cidrConfig.publicSubnet1Cidr}`,
      `ParameterKey=PublicSubnet2CIDR,ParameterValue=${cidrConfig.publicSubnet2Cidr}`,
      `ParameterKey=EKSPrivateSubnet1CIDR,ParameterValue=${cidrConfig.eksPrivateSubnet1Cidr}`,
      `ParameterKey=EKSPrivateSubnet2CIDR,ParameterValue=${cidrConfig.eksPrivateSubnet2Cidr}`,
      `ParameterKey=CreatePrivateSubnetStack,ParameterValue=false`,
      `ParameterKey=CreateS3EndpointStack,ParameterValue=false`,
      `ParameterKey=CreateHelmChartStack,ParameterValue=false`
    ];
  }

  /**
   * 构建创建Stack的AWS CLI命令
   * @param {string} stackName - Stack名称
   * @param {string} templatePath - 模板文件路径
   * @param {string} region - AWS区域
   * @param {Array} parameters - 参数数组
   * @returns {string} AWS CLI命令
   */
  static buildCreateStackCommand(stackName, templatePath, region, parameters) {
    const parameterString = parameters.join(' ');
    
    return `aws cloudformation create-stack \\
      --stack-name ${stackName} \\
      --template-body file://${templatePath} \\
      --region ${region} \\
      --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \\
      --parameters ${parameterString}`;
  }

  /**
   * 等待Stack创建完成
   * @param {string} stackName - Stack名称
   * @param {string} region - AWS区域
   * @param {Function} progressCallback - 进度回调函数
   * @returns {Promise<Object>} 完成结果
   */
  static async waitForStackCreation(stackName, region, progressCallback = null) {
    const maxWaitTime = 20 * 60 * 1000; // 20分钟
    const pollInterval = 30 * 1000; // 30秒
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const status = await this.getStackStatus(stackName, region);
        
        if (progressCallback) {
          progressCallback(status);
        }
        
        if (status.stackStatus === 'CREATE_COMPLETE') {
          return {
            success: true,
            status: status,
            message: 'Stack creation completed successfully'
          };
        }
        
        if (status.stackStatus === 'CREATE_FAILED' || 
            status.stackStatus === 'ROLLBACK_COMPLETE' ||
            status.stackStatus === 'ROLLBACK_FAILED') {
          return {
            success: false,
            status: status,
            message: `Stack creation failed: ${status.stackStatusReason}`
          };
        }
        
        // 继续等待
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        console.error('Error waiting for stack creation:', error);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    
    return {
      success: false,
      message: 'Stack creation timeout after 20 minutes'
    };
  }
}

module.exports = CloudFormationManager;
