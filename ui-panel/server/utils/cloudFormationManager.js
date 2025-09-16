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
   * 创建EKS集群Stack
   * @param {Object} config - 集群配置
   * @param {Object} cidrConfig - CIDR配置
   * @returns {Promise<Object>} 创建结果
   */
  static async createEKSStack(config, cidrConfig) {
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
   * 获取Stack输出信息（用于HyperPod部署）
   * @param {string} stackName - 现有EKS Stack名称
   * @param {string} region - AWS区域
   * @returns {Promise<Object>} Stack输出信息
   */
  static async fetchStackInfo(stackName, region) {
    try {
      const command = `aws cloudformation describe-stacks --stack-name ${stackName} --region ${region} --query 'Stacks[0].Outputs' --output json`;
      const result = execSync(command, { encoding: 'utf8' });
      const outputs = JSON.parse(result);
      
      // 解析关键输出
      const stackInfo = {};
      outputs.forEach(output => {
        switch(output.OutputKey) {
          case 'OutputVpcId':
            stackInfo.VPC_ID = output.OutputValue;
            break;
          case 'OutputSecurityGroupId':
            stackInfo.SECURITY_GROUP_ID = output.OutputValue;
            break;
          case 'OutputEKSClusterName':
            stackInfo.EKS_CLUSTER_NAME = output.OutputValue;
            break;
          case 'OutputSageMakerIAMRoleArn':
            stackInfo.SAGEMAKER_ROLE_ARN = output.OutputValue;
            // 提取role名称
            stackInfo.SAGEMAKER_ROLE_NAME = output.OutputValue.split('/').pop();
            break;
          case 'OutputS3BucketName':
            stackInfo.S3_BUCKET_NAME = output.OutputValue;
            break;
        }
      });
      
      // 获取NAT Gateway
      if (stackInfo.VPC_ID) {
        stackInfo.NAT_GATEWAY_ID = await this.getNatGatewayId(stackInfo.VPC_ID, region);
      }
      
      return stackInfo;
    } catch (error) {
      console.error('Error fetching stack info:', error);
      throw error;
    }
  }

  /**
   * 获取子网信息
   * @param {string} vpcId - VPC ID
   * @param {string} region - AWS区域
   * @returns {Promise<Object>} 子网信息
   */
  static async fetchSubnetInfo(vpcId, region) {
    try {
      // 获取所有子网
      const subnetsCmd = `aws ec2 describe-subnets --filters "Name=vpc-id,Values=${vpcId}" --region ${region} --output json`;
      const subnetsResult = execSync(subnetsCmd, { encoding: 'utf8' });
      const subnetsData = JSON.parse(subnetsResult);
      
      const publicSubnets = [];
      const privateSubnets = [];
      
      for (const subnet of subnetsData.Subnets) {
        // 检查路由表判断是否为公有子网
        const routeTablesCmd = `aws ec2 describe-route-tables --filters "Name=association.subnet-id,Values=${subnet.SubnetId}" --region ${region} --output json`;
        const routeTablesResult = execSync(routeTablesCmd, { encoding: 'utf8' });
        const routeTablesData = JSON.parse(routeTablesResult);
        
        let isPublic = false;
        for (const routeTable of routeTablesData.RouteTables) {
          for (const route of routeTable.Routes) {
            if (route.GatewayId && route.GatewayId.startsWith('igw-')) {
              isPublic = true;
              break;
            }
          }
          if (isPublic) break;
        }
        
        const subnetInfo = {
          subnetId: subnet.SubnetId,
          availabilityZone: subnet.AvailabilityZone,
          cidrBlock: subnet.CidrBlock,
          name: subnet.Tags?.find(tag => tag.Key === 'Name')?.Value || subnet.SubnetId
        };
        
        if (isPublic) {
          publicSubnets.push(subnetInfo);
        } else {
          privateSubnets.push(subnetInfo);
        }
      }
      
      return { publicSubnets, privateSubnets };
    } catch (error) {
      console.error('Error fetching subnet info:', error);
      throw error;
    }
  }

  /**
   * 检查实例类型是否支持EFA
   * @param {string} instanceType - 实例类型
   * @returns {Promise<boolean>} 是否支持EFA
   */
  static async checkEfaSupport(instanceType) {
    try {
      const { execSync } = require('child_process');
      const result = execSync(
        `aws ec2 describe-instance-types --instance-types ${instanceType} --query 'InstanceTypes[0].NetworkInfo.EfaSupported' --output text`,
        { encoding: 'utf8', timeout: 10000 }
      );
      return result.trim().toLowerCase() === 'true';
    } catch (error) {
      console.warn(`Failed to check EFA support for ${instanceType}:`, error.message);
      // 默认返回false，避免配置错误
      return false;
    }
  }

  /**
   * 创建EKS节点组
   * @param {Object} nodeGroupConfig - 节点组配置
   * @param {string} region - AWS区域
   * @param {string} clusterName - EKS集群名称
   * @param {string} vpcId - VPC ID
   * @param {string} securityGroupId - 安全组ID
   * @param {Array} allSubnets - 所有子网信息
   * @returns {Promise<Object>} 创建结果
   */
  static async createEksNodeGroup(nodeGroupConfig, region, clusterName, vpcId, securityGroupId, allSubnets) {
    try {
      const fs = require('fs');
      const { spawn } = require('child_process');
      
      // 生成eksctl配置
      const spotConfig = nodeGroupConfig.useSpotInstances ? `
    instanceType: ${nodeGroupConfig.instanceType}
    spot: true` : `
    instanceType: ${nodeGroupConfig.instanceType}`;

      // 构建VPC私有子网配置：找到用户选择的HyperPod subnet和另一个不同AZ的private subnet
      const selectedSubnet = allSubnets.privateSubnets.find(s => s.subnetId === nodeGroupConfig.subnetId);
      if (!selectedSubnet) {
        throw new Error(`Selected subnet ${nodeGroupConfig.subnetId} not found in private subnets`);
      }
      
      const selectedAZ = selectedSubnet.availabilityZone;
      
      // 找到另一个不同AZ的private subnet
      const otherSubnet = allSubnets.privateSubnets.find(s => 
        s.availabilityZone !== selectedAZ
      );
      
      if (!otherSubnet) {
        throw new Error(`No private subnet found in different AZ from ${selectedAZ}`);
      }

      // 获取目标子网的AZ
      const targetAZ = selectedAZ;

      // 检查实例类型是否支持EFA
      const efaSupported = await this.checkEfaSupport(nodeGroupConfig.instanceType);
      console.log(`Instance type ${nodeGroupConfig.instanceType} EFA support: ${efaSupported}`);

      const eksctlConfig = `apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig

metadata:
  name: ${clusterName}
  region: ${region}

vpc:
  id: ${vpcId}
  securityGroup: ${securityGroupId}
  subnets:
    private:
      ${selectedAZ}:
        id: ${selectedSubnet.subnetId}
      ${otherSubnet.availabilityZone}:
        id: ${otherSubnet.subnetId}

managedNodeGroups:
  - name: ${nodeGroupConfig.nodeGroupName}${spotConfig}
    volumeSize: ${nodeGroupConfig.volumeSize || 200}
    minSize: ${nodeGroupConfig.minSize}
    maxSize: ${nodeGroupConfig.maxSize}
    desiredCapacity: ${nodeGroupConfig.desiredCapacity}
    availabilityZones: ["${targetAZ}"]
    efaEnabled: ${efaSupported}
    privateNetworking: true
`;

    // labels:
    //   node-type: gpu
    // taints:
    //   - key: nvidia.com/gpu
    //     value: "true"
    //     effect: NoSchedule
      
      // 生成临时配置文件
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
      const configFileName = `eksctl-nodegroup-${nodeGroupConfig.nodeGroupName}-${timestamp}.yaml`;
      const configFilePath = path.join('/tmp', configFileName);
      
      fs.writeFileSync(configFilePath, eksctlConfig);
      
      return {
        configFile: configFilePath,
        configFileName: configFileName,
        nodeGroupName: nodeGroupConfig.nodeGroupName
      };
    } catch (error) {
      console.error('Error creating EKS node group config:', error);
      throw error;
    }
  }

  /**
   * 获取HyperPod模板路径
   * @returns {string} HyperPod模板文件的绝对路径
   */
  static getHyperPodTemplatePath() {
    const envTemplatePath = process.env.HYPERPOD_TEMPLATE_PATH;
    
    if (!envTemplatePath) {
      throw new Error('HyperPod template path not configured. Please set HYPERPOD_TEMPLATE_PATH in client/user.env');
    }
    
    // 使用挂载的项目根目录
    const projectRoot = path.join(__dirname, '../../hyperpod-instantstart');
    return path.join(projectRoot, envTemplatePath);
  }

  /**
   * 创建HyperPod Stack
   * @param {string} stackName - Stack名称
   * @param {string} region - AWS区域
   * @param {Object} stackInfo - 从EKS stack获取的基础设施信息
   * @param {Object} userConfig - 用户配置
   * @returns {Promise<Object>} 创建结果
   */
  static async createHyperPodStack(stackName, region, stackInfo, userConfig) {
    try {
      // 获取HyperPod模板路径
      const templatePath = this.getHyperPodTemplatePath();
      
      if (!fs.existsSync(templatePath)) {
        throw new Error(`HyperPod template not found: ${templatePath}`);
      }
      
      // 构建HyperPod参数
      const parameters = [
        `ParameterKey=ExistingVpcId,ParameterValue=${stackInfo.VPC_ID}`,
        `ParameterKey=ExistingSecurityGroupId,ParameterValue=${stackInfo.SECURITY_GROUP_ID}`,
        `ParameterKey=ExistingEKSClusterName,ParameterValue=${stackInfo.EKS_CLUSTER_NAME}`,
        `ParameterKey=ExistingSageMakerRoleName,ParameterValue=${stackInfo.SAGEMAKER_ROLE_NAME}`,
        `ParameterKey=ExistingS3BucketName,ParameterValue=${stackInfo.S3_BUCKET_NAME}`,
        `ParameterKey=ExistingNatGatewayId,ParameterValue=${stackInfo.NAT_GATEWAY_ID}`,
        ...Object.entries(userConfig).map(([key, value]) => 
          `ParameterKey=${key},ParameterValue=${value}`
        )
      ];
      
      const parameterString = parameters.join(' ');
      
      const command = `aws cloudformation create-stack \\
        --stack-name ${stackName} \\
        --template-body file://${templatePath} \\
        --region ${region} \\
        --capabilities CAPABILITY_IAM \\
        --parameters ${parameterString}`;
      
      console.log(`Creating HyperPod stack: ${stackName}`);
      const result = execSync(command, { encoding: 'utf8' });
      
      return {
        success: true,
        stackName,
        region,
        stackId: JSON.parse(result).StackId,
        createdAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error creating HyperPod stack:', error);
      throw error;
    }
  }

  /**
   * 获取VPC中的NAT Gateway ID
   * @param {string} vpcId - VPC ID
   * @param {string} region - AWS区域
   * @returns {Promise<string>} NAT Gateway ID
   */
  static async getNatGatewayId(vpcId, region) {
    try {
      const command = `aws ec2 describe-nat-gateways --region ${region} --filter "Name=vpc-id,Values=${vpcId}" "Name=state,Values=available" --query 'NatGateways[0].NatGatewayId' --output text`;
      const result = execSync(command, { encoding: 'utf8' }).trim();
      
      if (result === 'None' || !result) {
        console.warn(`No available NAT Gateway found in VPC ${vpcId}`);
        return 'nat-placeholder';
      }
      
      return result;
    } catch (error) {
      console.error('Error getting NAT Gateway:', error);
      return 'nat-placeholder';
    }
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
