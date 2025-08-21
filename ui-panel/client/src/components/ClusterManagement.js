import React, { useState, useEffect } from 'react';
import { 
  Card, 
  Form, 
  Input, 
  Button, 
  Steps, 
  Space, 
  Switch, 
  InputNumber, 
  Alert, 
  Divider,
  Row,
  Col,
  Typography,
  Tag,
  Spin,
  message
} from 'antd';
import { 
  CloudServerOutlined, 
  SettingOutlined, 
  ReloadOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons';

const { Title, Text } = Typography;
const { Step } = Steps;

const ClusterManagement = () => {
  const [form] = Form.useForm();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [step1Status, setStep1Status] = useState('wait'); // wait, process, finish, error
  const [step2Status, setStep2Status] = useState('wait');
  const [step1Result, setStep1Result] = useState(null);
  const [step2Result, setStep2Result] = useState(null);
  const [enableFtp, setEnableFtp] = useState(false);
  const [cloudFormationStatus, setCloudFormationStatus] = useState(null);
  
  // 新增状态管理
  const [step1Details, setStep1Details] = useState(null);
  const [step2Details, setStep2Details] = useState(null);
  const [logs, setLogs] = useState({ launch: '', configure: '' });
  const [logOffset, setLogOffset] = useState({ launch: 0, configure: 0 });
  const [activeLogTab, setActiveLogTab] = useState('launch');
  
  // 添加实时预览状态
  const [previewClusterTag, setPreviewClusterTag] = useState(defaultConfig.clusterTag);

  // 默认配置值 - 基于新的 init_envs 结构
  const defaultConfig = {
    clusterTag: 'hypd-instrt-0821t1',
    awsRegion: 'us-west-2',
    ftpName: '',
    gpuCapacityAz: 'us-west-2a',
    gpuInstanceType: 'ml.g6.12xlarge',
    gpuInstanceCount: 2
  };

  useEffect(() => {
    // 初始化表单默认值
    form.setFieldsValue(defaultConfig);
  }, [form]);

  // 检查步骤状态的函数
  const checkStepStatus = async () => {
    try {
      // 检查 Step 1 状态
      const step1Response = await fetch('/api/cluster/step1-status');
      const step1Result = await step1Response.json();
      
      if (step1Result.success) {
        const cfStatus = step1Result.data.status;
        setStep1Details(step1Result.data);
        setStep1Status(cfStatus === 'completed' ? 'finish' : 
                      cfStatus === 'running' ? 'process' : 
                      cfStatus === 'failed' ? 'error' : 'wait');
        
        // 只有 Step 1 完成后才检查 Step 2
        if (cfStatus === 'completed') {
          const step2Response = await fetch('/api/cluster/step2-status');
          const step2Result = await step2Response.json();
          
          if (step2Result.success) {
            const k8sStatus = step2Result.data.status;
            setStep2Details(step2Result.data);
            setStep2Status(k8sStatus === 'completed' ? 'finish' : 
                          k8sStatus === 'partial' ? 'process' : 
                          k8sStatus === 'error' ? 'error' : 'wait');
          }
        }
      }
    } catch (error) {
      console.error('Error checking status:', error);
    }
  };

  // 获取日志内容
  const fetchLogs = async (step) => {
    try {
      const currentOffset = logOffset[step] || 0;
      const response = await fetch(`/api/cluster/logs/${step}?offset=${currentOffset}`);
      const result = await response.json();
      
      if (result.success && result.data.content) {
        setLogs(prev => ({
          ...prev,
          [step]: prev[step] + result.data.content
        }));
        setLogOffset(prev => ({
          ...prev,
          [step]: result.data.totalLength
        }));
      }
    } catch (error) {
      console.error('Error fetching logs:', error);
    }
  };

  // 手动刷新状态和日志
  const refreshStatus = () => {
    setLoading(true);
    checkStepStatus();
    fetchLogs('launch');
    fetchLogs('configure');
    setTimeout(() => setLoading(false), 1000); // 给用户一个加载反馈
  };

  // 保存配置到 init_envs
  const saveConfiguration = async (values) => {
    try {
      const config = {
        ...values,
        enableFtp
      };

      const response = await fetch('/api/cluster/save-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });

      const result = await response.json();
      if (result.success) {
        message.success('Configuration saved successfully');
        return true;
      } else {
        message.error(`Failed to save configuration: ${result.error}`);
        return false;
      }
    } catch (error) {
      message.error(`Error saving configuration: ${error.message}`);
      return false;
    }
  };

  // 执行 Step 1: 集群启动
  const executeStep1 = async () => {
    setLoading(true);
    setStep1Status('process');
    
    try {
      const response = await fetch('/api/cluster/launch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();
      
      if (result.success) {
        message.success('Cluster launch started in background. Use "Refresh Status" to check progress.');
        // 立即检查一次状态
        setTimeout(checkStepStatus, 2000);
      } else {
        setStep1Status('error');
        message.error(`Cluster launch failed: ${result.error}`);
      }
    } catch (error) {
      setStep1Status('error');
      message.error(`Error launching cluster: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 执行 Step 2: 集群配置
  const executeStep2 = async () => {
    setLoading(true);
    setStep2Status('process');
    
    try {
      const response = await fetch('/api/cluster/configure', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();
      
      if (result.success) {
        message.success('Cluster configuration started in background');
        // 立即开始检查状态
        setTimeout(checkStepStatus, 2000);
      } else {
        setStep2Status('error');
        message.error(`Cluster configuration failed: ${result.error}`);
      }
    } catch (error) {
      setStep2Status('error');
      message.error(`Error configuring cluster: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 刷新 CloudFormation 状态
  const refreshCloudFormationStatus = async () => {
    try {
      const stackName = form.getFieldValue('cloudFormationFullStackName');
      if (!stackName) {
        message.warning('Please enter CloudFormation stack name first');
        return;
      }

      const response = await fetch(`/api/cluster/cloudformation-status?stackName=${stackName}`);
      const result = await response.json();
      
      if (result.success) {
        setCloudFormationStatus(result.data);
      } else {
        message.error(`Failed to get CloudFormation status: ${result.error}`);
      }
    } catch (error) {
      message.error(`Error getting CloudFormation status: ${error.message}`);
    }
  };

  // 处理表单提交
  const handleFormSubmit = async (values) => {
    const saved = await saveConfiguration(values);
    if (saved) {
      setCurrentStep(0);
    }
  };

  // 获取状态标签
  const getStatusTag = (status) => {
    switch (status) {
      case 'wait':
        return <Tag color="default">Waiting</Tag>;
      case 'process':
        return <Tag color="processing">Processing</Tag>;
      case 'finish':
        return <Tag color="success">Completed</Tag>;
      case 'error':
        return <Tag color="error">Failed</Tag>;
      default:
        return <Tag color="default">Unknown</Tag>;
    }
  };

  // 获取 CloudFormation 状态标签
  const getCloudFormationStatusTag = (status) => {
    if (!status) return <Tag color="default">Unknown</Tag>;
    
    switch (status.toUpperCase()) {
      case 'CREATE_COMPLETE':
      case 'UPDATE_COMPLETE':
        return <Tag color="success">{status}</Tag>;
      case 'CREATE_IN_PROGRESS':
      case 'UPDATE_IN_PROGRESS':
        return <Tag color="processing">{status}</Tag>;
      case 'CREATE_FAILED':
      case 'UPDATE_FAILED':
      case 'DELETE_FAILED':
        return <Tag color="error">{status}</Tag>;
      case 'DELETE_COMPLETE':
        return <Tag color="warning">{status}</Tag>;
      default:
        return <Tag color="default">{status}</Tag>;
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      
      <Row gutter={[24, 24]} style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* 左侧：配置表单 */}
        <Col xs={24} lg={8} style={{ display: 'flex' }}>
          <Card title="Cluster Configuration" className="theme-card compute" style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <Form
                form={form}
                layout="vertical"
                onFinish={handleFormSubmit}
                initialValues={defaultConfig}
                style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}
              >
              {/* 第一行：Cluster Tag - 核心字段 */}
              <Form.Item
                label="Cluster Tag"
                name="clusterTag"
                rules={[{ required: true, message: 'Please enter cluster tag' }]}
                extra="This tag will be used to generate all resource names automatically"
              >
                <Input placeholder="hypd-instrt-0821t1" />
              </Form.Item>

              {/* 第二行：AWS Region */}
              <Form.Item
                label="AWS Region"
                name="awsRegion"
                rules={[{ required: true, message: 'Please enter AWS region' }]}
              >
                <Input placeholder="us-west-2" />
              </Form.Item>

              {/* 第三行：FTP 配置 */}
              <Row gutter={12} style={{ margin: 0 }}>
                <Col span={8} style={{ paddingLeft: 0, paddingRight: 4 }}>
                  <Form.Item label="Enable FTP">
                    <div style={{ paddingTop: '5px' }}>
                      <Switch 
                        checked={enableFtp} 
                        onChange={setEnableFtp}
                        checkedChildren="ON"
                        unCheckedChildren="OFF"
                      />
                    </div>
                  </Form.Item>
                </Col>
                <Col span={16} style={{ paddingLeft: 4, paddingRight: 0 }}>
                  {enableFtp && (
                    <Form.Item
                      label="FTP Name"
                      name="ftpName"
                      rules={[{ required: enableFtp, message: 'Please enter FTP name' }]}
                    >
                      <Input placeholder="your-ftp-name" />
                    </Form.Item>
                  )}
                </Col>
              </Row>

              {/* 第四行：GPU 配置 */}
              <Form.Item
                label="GPU Capacity AZ"
                name="gpuCapacityAz"
                rules={[{ required: true, message: 'Please enter availability zone' }]}
              >
                <Input placeholder="us-west-2a" />
              </Form.Item>

              {/* 第五行：GPU Instance 配置 */}
              <Row gutter={12} style={{ margin: 0 }}>
                <Col span={16} style={{ paddingLeft: 0, paddingRight: 6 }}>
                  <Form.Item
                    label="GPU Instance Type"
                    name="gpuInstanceType"
                    rules={[{ required: true, message: 'Please enter GPU instance type' }]}
                  >
                    <Input placeholder="ml.g6.12xlarge" />
                  </Form.Item>
                </Col>
                <Col span={8} style={{ paddingLeft: 6, paddingRight: 0 }}>
                  <Form.Item
                    label="GPU Instance Count"
                    name="gpuInstanceCount"
                    rules={[{ required: true, message: 'Please enter instance count' }]}
                  >
                    <InputNumber min={1} max={100} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>

              {/* 自动生成的资源名称预览 */}
              <Divider orientation="left" style={{ fontSize: '14px', margin: '16px 0 8px 0' }}>
                Auto-generated Resource Names
              </Divider>
              
              <div style={{ 
                background: '#f5f5f5', 
                padding: '12px', 
                borderRadius: '6px', 
                fontSize: '12px',
                marginBottom: '16px'
              }}>
                <div><strong>CloudFormation Stack:</strong> full-stack-{previewClusterTag}</div>
                <div><strong>EKS Cluster:</strong> eks-cluster-{previewClusterTag}</div>
                <div><strong>HyperPod Cluster:</strong> hp-cluster-{previewClusterTag}</div>
                <div><strong>S3 Bucket:</strong> cluster-mount-{previewClusterTag}</div>
              </div>

              <Form.Item>
                <Button type="primary" htmlType="submit" size="large" block>
                  Save Configuration
                </Button>
              </Form.Item>
            </Form>
            </div>
          </Card>
        </Col>

        {/* 中间：执行步骤和状态 */}
        <Col xs={24} lg={8} style={{ display: 'flex' }}>
          <Card 
            title="Deployment Steps" 
            className="theme-card analytics" 
            style={{ width: '100%', display: 'flex', flexDirection: 'column' }}
            extra={
              <Button 
                type="text" 
                icon={<ReloadOutlined />} 
                onClick={refreshStatus}
                loading={loading}
                size="small"
              >
                Refresh Status
              </Button>
            }
          >
            <div style={{ flex: 1, overflow: 'auto' }}>
            <Steps
              current={currentStep}
              direction="vertical"
              items={[
                {
                  title: 'Cluster Launch',
                  description: 'Create CloudFormation stack and launch cluster',
                  status: step1Status,
                  icon: step1Status === 'process' ? <Spin size="small" /> : <PlayCircleOutlined />
                },
                {
                  title: 'Cluster Configuration',
                  description: 'Configure cluster settings and dependencies',
                  status: step2Status,
                  icon: step2Status === 'process' ? <Spin size="small" /> : <SettingOutlined />
                }
              ]}
            />

            <Divider />

            {/* Step 1 控制 */}
            <div style={{ marginBottom: '16px' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={executeStep1}
                  loading={loading && step1Status === 'process'}
                  disabled={step1Status === 'process' || step2Status === 'process'}
                  block
                >
                  Execute Step 1: Cluster Launch
                </Button>
                {getStatusTag(step1Status)}
              </Space>
            </div>

            {/* Step 2 控制 */}
            <div style={{ marginBottom: '16px' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button
                  type="primary"
                  icon={<SettingOutlined />}
                  onClick={executeStep2}
                  loading={loading && step2Status === 'process'}
                  disabled={step1Status !== 'finish' || step2Status === 'process'}
                  block
                >
                  Execute Step 2: Cluster Configuration
                </Button>
                {getStatusTag(step2Status)}
              </Space>
            </div>

            <Divider />

            {/* CloudFormation 状态 */}
            <div style={{ marginBottom: '16px' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <div>
                  <Space>
                    <Text strong>CloudFormation Status:</Text>
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      onClick={refreshCloudFormationStatus}
                    >
                      Refresh
                    </Button>
                  </Space>
                </div>
                {cloudFormationStatus ? (
                  <div>
                    {getCloudFormationStatusTag(cloudFormationStatus.StackStatus)}
                    <br />
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      Last Updated: {new Date(cloudFormationStatus.LastUpdatedTime || cloudFormationStatus.CreationTime).toLocaleString()}
                    </Text>
                  </div>
                ) : (
                  <Text type="secondary">Click refresh to check status</Text>
                )}
              </Space>
            </div>

            {/* 执行结果显示 */}
            {step1Result && (
              <Alert
                message="Step 1 Result"
                description={
                  <pre style={{ fontSize: '11px', maxHeight: '120px', overflow: 'auto' }}>
                    {JSON.stringify(step1Result, null, 2)}
                  </pre>
                }
                type={step1Status === 'finish' ? 'success' : 'error'}
                style={{ marginBottom: '16px' }}
              />
            )}

            {step2Result && (
              <Alert
                message="Step 2 Result"
                description={
                  <pre style={{ fontSize: '11px', maxHeight: '120px', overflow: 'auto' }}>
                    {JSON.stringify(step2Result, null, 2)}
                  </pre>
                }
                type={step2Status === 'finish' ? 'success' : 'error'}
              />
            )}
            </div>
          </Card>
        </Col>

        {/* 右侧：部署日志 */}
        <Col xs={24} lg={8} style={{ display: 'flex' }}>
          <Card 
            title="Deployment Logs" 
            className="theme-card storage"
            style={{ width: '100%', display: 'flex', flexDirection: 'column' }}
            extra={
              <Button 
                size="small" 
                icon={<ReloadOutlined />}
                onClick={refreshStatus}
                loading={loading}
              >
                Refresh
              </Button>
            }
          >
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* 日志选择 Tabs - 最小化空间 */}
              <div style={{ marginBottom: '4px', flexShrink: 0 }}>
                <Space size="small">
                  <Button 
                    size="small" 
                    type={activeLogTab === 'launch' ? 'primary' : 'default'}
                    onClick={() => setActiveLogTab('launch')}
                  >
                    Step 1
                  </Button>
                  <Button 
                    size="small" 
                    type={activeLogTab === 'configure' ? 'primary' : 'default'}
                    onClick={() => setActiveLogTab('configure')}
                  >
                    Step 2
                  </Button>
                </Space>
              </div>

              {/* 日志显示区域 - 占用绝大部分空间 */}
              <div
                style={{
                  flex: 1,
                  backgroundColor: '#1e1e1e',
                  color: '#d4d4d4',
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  fontSize: '12px',
                  padding: '8px',
                  overflow: 'auto',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  whiteSpace: 'pre-wrap',
                  minHeight: '400px'
                }}
              >
                {logs[activeLogTab] || (
                  activeLogTab === 'launch' ? 
                    'Click "Execute Step 1" to start cluster launch and view logs...' :
                    'Complete Step 1 first, then execute Step 2 to view configuration logs...'
                )}
              </div>

              {/* 状态栏 - 极简显示 */}
              <div style={{ 
                marginTop: '4px', 
                padding: '4px 6px', 
                backgroundColor: '#f8f9fa', 
                borderRadius: '3px',
                fontSize: '9px',
                color: '#666',
                flexShrink: 0,
                lineHeight: '1.2'
              }}>
                <Space size="small" style={{ fontSize: '9px' }}>
                  {activeLogTab === 'launch' ? getStatusTag(step1Status) : getStatusTag(step2Status)}
                  <span>•</span>
                  <span>Manual Refresh</span>
                  <span>•</span>
                  <span>{new Date().toLocaleTimeString().slice(0, 5)}</span>
                </Space>
              </div>

              {/* 详细状态信息 - 条件显示，极简格式 */}
              {activeLogTab === 'launch' && step1Details && (
                <div style={{ 
                  marginTop: '3px', 
                  padding: '4px 6px', 
                  backgroundColor: '#e6f7ff', 
                  borderRadius: '3px',
                  fontSize: '9px',
                  flexShrink: 0,
                  lineHeight: '1.2'
                }}>
                  <Text style={{ fontSize: '9px' }}>
                    CF: {step1Details.cloudFormationStatus} | {step1Details.stackName}
                  </Text>
                </div>
              )}

              {activeLogTab === 'configure' && step2Details && (
                <div style={{ 
                  marginTop: '3px', 
                  padding: '4px 6px', 
                  backgroundColor: '#f6ffed', 
                  borderRadius: '3px',
                  fontSize: '9px',
                  flexShrink: 0,
                  lineHeight: '1.2'
                }}>
                  <Text style={{ fontSize: '9px' }}>
                    K8s: {step2Details.summary?.ready || 0}/{step2Details.summary?.total || 0} ready
                    {step2Details.checks?.filter(c => c.status !== 'ready').length > 0 && (
                      <span style={{ color: '#fa8c16', marginLeft: '6px' }}>
                        ({step2Details.checks?.filter(c => c.status !== 'ready').map(c => c.name).join(', ')})
                      </span>
                    )}
                  </Text>
                </div>
              )}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default ClusterManagement;
