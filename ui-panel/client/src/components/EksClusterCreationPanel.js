import React, { useState, useEffect } from 'react';
import {
  Card,
  Form,
  Input,
  Button,
  Alert,
  Space,
  Typography,
  message,
  Steps,
  Row,
  Col
} from 'antd';
import {
  CloudServerOutlined,
  PlayCircleOutlined,
  InfoCircleOutlined,
  ReloadOutlined
} from '@ant-design/icons';

const { Text } = Typography;

const EksClusterCreationPanel = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [creationStatus, setCreationStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);

  // 恢复创建状态
  const restoreCreationStatus = async () => {
    try {
      console.log('🔄 Restoring creation status...');
      const response = await fetch('/api/cluster/creating-clusters');
      const result = await response.json();
      
      console.log('📊 Creating clusters response:', result);
      
      if (result.success && result.clusters) {
        // 查找EKS类型的创建中集群
        const creatingEksClusters = Object.entries(result.clusters).filter(
          ([tag, info]) => info.type === 'eks'
        );
        
        console.log('🔍 Found EKS clusters:', creatingEksClusters);
        
        if (creatingEksClusters.length > 0) {
          // 取第一个创建中的集群（通常只有一个）
          const [clusterTag, clusterInfo] = creatingEksClusters[0];
          
          console.log('✅ Restoring cluster:', clusterTag, clusterInfo);
          
          const restoredStatus = {
            status: 'IN_PROGRESS',
            clusterTag: clusterTag,
            stackName: clusterInfo.stackName,
            stackId: clusterInfo.stackId,
            region: clusterInfo.region,
            currentStackStatus: clusterInfo.currentStackStatus,
            logs: 'Restored creation status...'
          };
          
          setCreationStatus(restoredStatus);
          console.log('📝 Set creation status:', restoredStatus);
          
          // 立即检查最新状态并更新metadata
          await checkCreationStatus(clusterTag);
        } else {
          console.log('ℹ️ No creating EKS clusters found');
          // 如果没有创建中的集群，清理UI状态
          if (creationStatus) {
            console.log('🧹 Clearing completed creation status');
            setCreationStatus(null);
          }
        }
      } else {
        console.log('❌ Failed to get creating clusters or no clusters');
        // 清理UI状态
        if (creationStatus) {
          console.log('🧹 Clearing creation status due to API failure');
          setCreationStatus(null);
        }
      }
    } catch (error) {
      console.error('❌ Failed to restore creation status:', error);
      // 清理UI状态
      if (creationStatus) {
        console.log('🧹 Clearing creation status due to error');
        setCreationStatus(null);
      }
    }
  };

  // 检查创建状态
  const checkCreationStatus = async (clusterTag) => {
    if (!clusterTag) return;
    
    console.log('🔍 Checking creation status for:', clusterTag);
    setStatusLoading(true);
    try {
      // 1. 先调用creating-clusters API触发后端状态检查和清理
      const creatingResponse = await fetch('/api/cluster/creating-clusters');
      const creatingResult = await creatingResponse.json();
      console.log('📊 Creating clusters check result:', creatingResult);
      
      // 2. 再检查具体集群的创建状态
      const response = await fetch(`/api/cluster/creation-status/${clusterTag}`);
      const result = await response.json();
      
      console.log('📊 Creation status response:', result);
      
      if (result.success) {
        setCreationStatus(prev => ({
          ...prev,
          currentStackStatus: result.stackStatus,
          lastChecked: new Date().toISOString()
        }));
        
        console.log('📝 Updated status with:', result.stackStatus);
        
        // 如果创建完成或失败，停止检查
        if (result.stackStatus === 'CREATE_COMPLETE' || 
            result.stackStatus.includes('FAILED') || 
            result.stackStatus.includes('ROLLBACK')) {
          setCreationStatus(prev => ({ ...prev, status: 'COMPLETED' }));
          console.log('✅ Creation completed with status:', result.stackStatus);
          
          // 如果创建成功，显示成功消息并自动清理UI状态
          if (result.stackStatus === 'CREATE_COMPLETE') {
            message.success(`Cluster ${clusterTag} created successfully! It will appear in the cluster list.`);
            
            // 3秒后自动清理UI状态
            setTimeout(() => {
              setCreationStatus(null);
              console.log('🧹 Auto-cleared completed creation status');
            }, 3000);
          }
        }
      } else {
        console.log('❌ Failed to get creation status:', result.error);
      }
    } catch (error) {
      console.error('❌ Failed to check creation status:', error);
    } finally {
      setStatusLoading(false);
    }
  };

  // 获取有效CIDR（同步调用）
  const getValidCidr = async (region) => {
    try {
      const response = await fetch(`/api/cluster/generate-cidr?region=${region}`);
      const result = await response.json();
      if (result.success) {
        return result.cidr;
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Failed to generate CIDR:', error.message);
      throw error;
    }
  };

  // 创建集群
  const handleCreateCluster = async (values) => {
    setLoading(true);
    try {
      console.log('Creating cluster with values:', values);
      
      // 同步获取有效的CIDR
      console.log('Generating CIDR for region:', values.awsRegion);
      const vpcCidr = await getValidCidr(values.awsRegion);
      console.log('Generated CIDR:', vpcCidr);
      
      const response = await fetch('/api/cluster/create-eks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          customVpcCidr: vpcCidr
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        message.success('Cluster creation started successfully!');
        setCreationStatus({
          status: 'IN_PROGRESS',
          clusterTag: values.clusterTag,
          stackName: result.stackName,
          stackId: result.stackId,
          region: values.awsRegion,
          logs: 'CloudFormation stack creation initiated...'
        });
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Failed to create cluster:', error);
      message.error(`Failed to create cluster: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };



  // 初始化默认值并恢复创建状态
  useEffect(() => {
    form.setFieldsValue({
      awsRegion: 'us-east-1'
    });
    
    // 恢复创建状态（如果有的话）
    restoreCreationStatus();
  }, []);

  // 获取当前步骤
  const getCurrentStep = () => {
    if (!creationStatus) return 0;
    if (creationStatus.status === 'IN_PROGRESS') return 1;
    if (creationStatus.status === 'CONFIGURING_DEPENDENCIES') return 2;
    if (creationStatus.status === 'COMPLETED') return 3;
    return 0;
  };

  return (
    <div style={{ padding: '24px' }}>
      <Row gutter={24}>
        {/* 左侧：创建表单 */}
        <Col span={10}>
          <Card
            title={
              <Space>
                <CloudServerOutlined />
                <span>Create EKS Cluster</span>
              </Space>
            }
            extra={
              <Button 
                icon={<InfoCircleOutlined />} 
                type="link"
                onClick={() => message.info('This will create a new EKS cluster with HyperPod support')}
              >
                Help
              </Button>
            }
          >
            <Form
              form={form}
              layout="vertical"
              onFinish={handleCreateCluster}
              disabled={loading || creationStatus?.status === 'IN_PROGRESS'}
            >
              {/* 基本配置 */}
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="clusterTag"
                    label="Cluster Tag"
                    rules={[{ required: true, message: 'Please enter cluster tag' }]}
                  >
                    <Input placeholder="hypd-instrt-0914" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="awsRegion"
                    label="AWS Region"
                    rules={[{ required: true, message: 'Please enter AWS region' }]}
                  >
                    <Input placeholder="us-east-1" />
                  </Form.Item>
                </Col>
              </Row>



              {/* 创建按钮 */}
              <Form.Item style={{ marginTop: 24 }}>
                <Space>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={loading}
                    icon={<PlayCircleOutlined />}
                    size="large"
                  >
                    Create Cluster
                  </Button>
                  <Button onClick={() => form.resetFields()}>
                    Reset
                  </Button>
                </Space>
              </Form.Item>

              {/* 预估时间提示 */}
              {!creationStatus && (
                <Alert
                  type="info"
                  message="Cluster creation typically takes 10-15 minutes"
                  description="You will be able to monitor the progress in real-time once creation starts."
                  showIcon
                  style={{ marginTop: 16 }}
                />
              )}
            </Form>
          </Card>
        </Col>

        {/* 右侧：创建进度 */}
        <Col span={14}>
          <Card
            title="Cluster Creation Progress"
            extra={
              <Space>
                <Button 
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={statusLoading}
                  onClick={() => {
                    if (creationStatus?.clusterTag) {
                      checkCreationStatus(creationStatus.clusterTag);
                    } else {
                      // 没有创建中的集群时，检查是否有遗留的创建状态
                      restoreCreationStatus();
                    }
                  }}
                  title="Refresh Status"
                >
                  Refresh
                </Button>
                {creationStatus?.status === 'COMPLETED' && (
                  <Button 
                    size="small"
                    onClick={() => {
                      setCreationStatus(null);
                      message.success('Creation status cleared');
                    }}
                    title="Clear Completed Status"
                  >
                    Clear
                  </Button>
                )}
                {creationStatus && (
                  <Button 
                    size="small" 
                    danger
                    onClick={() => {
                      // TODO: 实现取消创建功能
                      message.info('Cancel will delete CloudFormation stack and clear all metadata');
                    }}
                  >
                    Cancel Creation
                  </Button>
                )}
              </Space>
            }
          >
            {creationStatus ? (
              // 有创建状态时显示进度
              <>
                <Steps
                  direction="vertical"
                  size="small"
                  current={getCurrentStep()}
                  items={[
                    {
                      title: 'Validating Parameters',
                      status: 'finish',
                      description: 'Cluster configuration validated'
                    },
                    {
                      title: 'Creating CloudFormation Stack',
                      status: creationStatus.status === 'IN_PROGRESS' ? 'process' : 
                             (getCurrentStep() > 1 ? 'finish' : 'wait'),
                      description: `Stack: ${creationStatus.stackName}`
                    },
                    {
                      title: 'Configuring Dependencies',
                      status: creationStatus.status === 'CONFIGURING_DEPENDENCIES' ? 'process' : 
                             (getCurrentStep() > 2 ? 'finish' : 'wait'),
                      description: 'Installing cluster dependencies'
                    },
                    {
                      title: 'Registering Cluster',
                      status: creationStatus.status === 'COMPLETED' ? 'finish' : 'wait',
                      description: 'Adding to cluster management'
                    }
                  ]}
                />

                {creationStatus.logs && (
                  <div style={{ marginTop: 16 }}>
                    <Text strong>CloudFormation Events:</Text>
                    <div style={{ 
                      background: '#f5f5f5', 
                      padding: 12, 
                      marginTop: 8, 
                      borderRadius: 4,
                      maxHeight: 200,
                      overflowY: 'auto',
                      fontFamily: 'monospace',
                      fontSize: '12px'
                    }}>
                      {creationStatus.logs.split('\n').map((line, index) => (
                        <div key={index}>{line}</div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              // 没有创建状态时显示灰色步骤
              <>
                <Steps
                  direction="vertical"
                  size="small"
                  current={-1}
                  status="wait"
                  items={[
                    {
                      title: 'Validating Parameters',
                      status: 'wait',
                      description: 'Ready to validate cluster configuration'
                    },
                    {
                      title: 'Creating CloudFormation Stack',
                      status: 'wait',
                      description: 'Ready to create infrastructure'
                    },
                    {
                      title: 'Registering Cluster',
                      status: 'wait',
                      description: 'Ready to add to cluster management'
                    }
                  ]}
                />
                
                <div style={{ marginTop: 24, textAlign: 'center', color: '#999' }}>
                  <CloudServerOutlined style={{ fontSize: '48px', marginBottom: '16px' }} />
                  <div>Fill in the form and click "Create Cluster" to start</div>
                </div>
              </>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default EksClusterCreationPanel;
