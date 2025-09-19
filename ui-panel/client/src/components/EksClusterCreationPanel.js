import React, { useState, useEffect } from 'react';
import globalRefreshManager from '../hooks/useGlobalRefresh';
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
            status: clusterInfo.status || 'IN_PROGRESS', // 使用实际状态
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
      // 检查creating-clusters状态（这是权威状态源）
      const creatingResponse = await fetch('/api/cluster/creating-clusters');
      const creatingResult = await creatingResponse.json();
      console.log('📊 Creating clusters check result:', creatingResult);
      
      if (creatingResult.success && creatingResult.clusters[clusterTag]) {
        // 仍在创建中
        const clusterInfo = creatingResult.clusters[clusterTag];
        console.log('📊 Cluster info from creating-clusters:', clusterInfo);
        
        // 更新UI状态显示当前阶段
        setCreationStatus(prev => ({
          ...prev,
          phase: clusterInfo.phase || clusterInfo.currentStackStatus,
          currentStackStatus: clusterInfo.currentStackStatus,
          lastChecked: new Date().toISOString()
        }));
        
        console.log('🔄 Still creating, current phase:', clusterInfo.phase);
        
      } else {
        // 不在creating-clusters中 = 真正完成
        console.log('✅ Cluster not in creating-clusters, fully completed');
        setCreationStatus(prev => ({ ...prev, status: 'COMPLETED' }));
        message.success(`Cluster ${clusterTag} created successfully! Configure dependencies in Cluster Information.`);
      }
      
    } catch (error) {
      console.error('❌ Failed to check creation status:', error);
    } finally {
      setStatusLoading(false);
    }
  };

  // 取消创建
  const cancelCreation = async () => {
    if (!creationStatus?.clusterTag) return;
    
    try {
      const response = await fetch(`/api/cluster/cancel-creation/${creationStatus.clusterTag}`, {
        method: 'POST'
      });
      
      const result = await response.json();
      if (result.success) {
        message.success('Cluster creation cancelled successfully');
        setCreationStatus(null); // 清理UI状态
      } else {
        message.error(result.error || 'Failed to cancel cluster creation');
      }
    } catch (error) {
      message.error('Failed to cancel cluster creation');
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
  const handleCreateCluster = async () => {
    try {
      // 验证表单
      const values = await form.validateFields();
      
      setLoading(true);
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
      setLoading(false);
    }
  };



  // 获取当前AWS region作为默认值
  const fetchCurrentRegion = async () => {
    try {
      const response = await fetch('/api/aws/current-region');
      const result = await response.json();
      if (result.success && result.region) {
        form.setFieldsValue({
          awsRegion: result.region
        });
      }
    } catch (error) {
      console.error('Failed to fetch current region:', error);
      // 如果获取失败，使用默认值
      form.setFieldsValue({
        awsRegion: 'us-west-1'
      });
    }
  };

  // 生成默认集群标签
  const generateClusterTag = () => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const uuid4 = crypto.randomUUID().substring(0, 4);
    return `hypd-${month}${day}-${uuid4}`;
  };

  // 初始化默认值并恢复创建状态
  useEffect(() => {
    // 设置默认集群标签
    form.setFieldsValue({
      clusterTag: generateClusterTag()
    });
    
    // 获取当前region作为默认值
    fetchCurrentRegion();
    
    // 恢复创建状态（如果有的话）
    restoreCreationStatus();
  }, []);

  // 集成全局刷新系统
  useEffect(() => {
    const componentId = 'eks-cluster-creation';
    
    const refreshFunction = async () => {
      if (creationStatus?.clusterTag) {
        await checkCreationStatus(creationStatus.clusterTag);
      } else {
        await restoreCreationStatus();
      }
    };

    globalRefreshManager.subscribe(componentId, refreshFunction, {
      priority: 7
    });

    return () => {
      globalRefreshManager.unsubscribe(componentId);
    };
  }, [creationStatus]);

  // 获取当前步骤（简化版）
  const getCurrentStep = () => {
    if (!creationStatus) return 0;
    if (creationStatus.status === 'IN_PROGRESS') return 1;
    if (creationStatus.status === 'COMPLETED') return 2;
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
                    <Input placeholder="us-east-1" disabled />
                  </Form.Item>
                </Col>
              </Row>



              {/* 创建按钮 */}
              <Form.Item style={{ marginTop: 24 }}>
                <Space>
                  <Button
                    type="primary"
                    onClick={handleCreateCluster}
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
                {creationStatus && creationStatus.status !== 'COMPLETED' && (
                  <Button 
                    size="small" 
                    danger
                    onClick={cancelCreation}
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
                      title: 'Cluster Created',
                      status: creationStatus.status === 'COMPLETED' ? 'finish' : 'wait',
                      description: 'EKS cluster ready. Configure dependencies in Cluster Information.'
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
                      title: 'Cluster Created',
                      status: 'wait',
                      description: 'Ready to register cluster'
                    }
                  ]}
                />
                
                <div style={{ marginTop: 24, textAlign: 'center', color: '#999' }}>
                  <Text type="secondary">Ready to create cluster</Text>
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
