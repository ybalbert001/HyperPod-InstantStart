import React, { useState, useEffect, useRef } from 'react';
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
  message,
  Select,
  Tooltip,
  Modal,
  Drawer,
  Tabs
} from 'antd';
import { 
  CloudServerOutlined, 
  SettingOutlined, 
  ReloadOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  DownOutlined,
  CopyOutlined,
  ExclamationCircleOutlined,
  ClusterOutlined,
  PlusOutlined,
  ImportOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import globalRefreshManager from '../hooks/useGlobalRefresh';
import operationRefreshManager from '../hooks/useOperationRefresh';

const { Title, Text } = Typography;
const { Step } = Steps;
const { Option } = Select;

const ClusterManagement = () => {
  // 多集群状态管理
  const [clusters, setClusters] = useState([]);
  const [activeCluster, setActiveCluster] = useState(null);
  const [clustersLoading, setClustersLoading] = useState(false);
  
  // 导入现有集群状态
  const [showImportModal, setShowImportModal] = useState(false);
  const [importForm] = Form.useForm();
  const [importLoading, setImportLoading] = useState(false);
  
  // 标签页状态
  const [activeTab, setActiveTab] = useState('manage');
  // 自定义滚动条样式 - 深色主题
  const customScrollbarStyle = `
    .custom-scrollbar::-webkit-scrollbar {
      width: 8px;
    }
    
    .custom-scrollbar::-webkit-scrollbar-track {
      background: #2a2a2a;
      border-radius: 4px;
    }
    
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background: #555;
      border-radius: 4px;
      border: 1px solid #333;
    }
    
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background: #666;
    }
    
    .custom-scrollbar::-webkit-scrollbar-thumb:active {
      background: #777;
    }
    
    .custom-scrollbar::-webkit-scrollbar-corner {
      background: #2a2a2a;
    }
  `;

  // 默认配置值 - 基于新的 init_envs 结构 - 移到最前面
  const defaultConfig = {
    clusterTag: 'hypd-instrt-0801',
    awsRegion: 'us-west-2',
    ftpName: '',
    gpuCapacityAz: 'us-west-2c',
    gpuInstanceType: 'ml.g6.12xlarge',
    gpuInstanceCount: 2
  };

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
  const [mlflowInfo, setMlflowInfo] = useState(null);
  const [logs, setLogs] = useState({ launch: '', configure: '' });
  const [logOffset, setLogOffset] = useState({ launch: 0, configure: 0 });
  const [activeLogTab, setActiveLogTab] = useState('launch');
  
  // 添加日志容器的 ref，用于自动滚动
  const logContainerRef = useRef(null);
  
  // 切换日志标签的函数，包含自动滚动
  const switchLogTab = (tab) => {
    setActiveLogTab(tab);
    // 切换后自动滚动到底部
    setTimeout(() => {
      if (logContainerRef.current) {
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      }
    }, 100);
  };

  // 导入现有集群
  const importExistingCluster = async (values) => {
    setImportLoading(true);
    try {
      const response = await fetch('/api/cluster/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });
      
      const result = await response.json();
      if (result.success) {
        message.success(`Successfully imported cluster: ${values.eksClusterName}`);
        setShowImportModal(false);
        importForm.resetFields();
        
        // 刷新集群列表
        await fetchClusters();
        
        // 设置为活跃集群
        setActiveCluster(values.eksClusterName);
        
        // 刷新状态
        setTimeout(() => {
          refreshAllStatus(false);
        }, 2000);
        
      } else {
        message.error(`Failed to import cluster: ${result.error}`);
      }
    } catch (error) {
      console.error('Error importing cluster:', error);
      message.error(`Error importing cluster: ${error.message}`);
    } finally {
      setImportLoading(false);
    }
  };

  // 测试集群连接
  const testClusterConnection = async () => {
    const values = importForm.getFieldsValue();
    if (!values.eksClusterName || !values.awsRegion) {
      message.warning('Please fill in EKS Cluster Name and AWS Region first');
      return;
    }
    
    setImportLoading(true);
    try {
      const response = await fetch('/api/cluster/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });
      
      const result = await response.json();
      if (result.success) {
        message.success(`Connection successful! Found ${result.nodeCount || 0} nodes`);
      } else {
        message.error(`Connection failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Error testing connection:', error);
      message.error(`Error testing connection: ${error.message}`);
    } finally {
      setImportLoading(false);
    }
  };

  // 多集群管理函数
  const fetchClusters = async () => {
    setClustersLoading(true);
    try {
      const response = await fetch('/api/multi-cluster/list');
      const result = await response.json();
      if (result.success) {
        setClusters(result.clusters);
        
        // 只有当 activeCluster 真正改变时才更新
        if (result.activeCluster !== activeCluster) {
          setActiveCluster(result.activeCluster);
          
          // 如果有活跃集群，加载其配置到表单
          if (result.activeCluster) {
            const activeClusterInfo = result.clusters.find(c => c.clusterTag === result.activeCluster);
            if (activeClusterInfo && activeClusterInfo.config) {
              form.setFieldsValue(activeClusterInfo.config);
              setEnableFtp(activeClusterInfo.config.enableFtp || false);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch clusters:', error);
      message.error('Failed to load clusters');
    } finally {
      setClustersLoading(false);
    }
  };

  const switchCluster = async (clusterTag) => {
    if (clusterTag === activeCluster) return;
    
    setClustersLoading(true);
    try {
      const response = await fetch('/api/multi-cluster/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusterTag })
      });
      
      const result = await response.json();
      if (result.success) {
        setActiveCluster(clusterTag);
        
        // 检查是否有kubectl警告
        if (result.kubectlWarning) {
          message.warning(`Switched to cluster: ${clusterTag}. Kubectl config issue: ${result.kubectlWarning}`);
        } else {
          message.success(`Successfully switched to cluster: ${clusterTag}`);
        }
        
        // 加载切换后集群的配置
        const clusterInfo = clusters.find(c => c.clusterTag === clusterTag);
        if (clusterInfo && clusterInfo.config) {
          form.setFieldsValue(clusterInfo.config);
          setEnableFtp(clusterInfo.config.enableFtp || false);
        }
        
        // 重置状态，因为切换到了不同的集群
        setStep1Status('wait');
        setStep2Status('wait');
        setStep1Details(null);
        setStep2Details(null);
        setLogs({ launch: '', configure: '' });
        setLogOffset({ launch: 0, configure: 0 });
        
        // 清除集群状态缓存
        try {
          await fetch('/api/cluster-status/clear-cache', { method: 'POST' });
          console.log('Cleared cluster status cache');
        } catch (cacheError) {
          console.warn('Failed to clear cache:', cacheError);
        }
        
        // 延迟5秒刷新状态，给kubectl配置切换足够时间
        message.info('Updating kubectl configuration and refreshing cluster status...', 3);
        setTimeout(() => {
          refreshAllStatus(false); // 不显示成功消息
        }, 5000);
        
      } else {
        message.error(result.error || 'Failed to switch cluster');
      }
    } catch (error) {
      console.error('Failed to switch cluster:', error);
      message.error('Failed to switch cluster');
    } finally {
      setClustersLoading(false);
    }
  };

  const createNewCluster = () => {
    // 重置表单为默认值，生成新的集群标识
    const newClusterTag = `hypd-instrt-${new Date().toISOString().slice(5, 10).replace('-', '')}-${Math.random().toString(36).substr(2, 3)}`;
    const newConfig = { ...defaultConfig, clusterTag: newClusterTag };
    
    form.setFieldsValue(newConfig);
    setEnableFtp(false);
    setActiveCluster(null);
    
    // 重置状态
    setStep1Status('wait');
    setStep2Status('wait');
    setStep1Details(null);
    setStep2Details(null);
    setLogs({ launch: '', configure: '' });
    setLogOffset({ launch: 0, configure: 0 });
    
    // 切换到创建标签页
    setActiveTab('create');
    
    message.info(`Ready to create new cluster: ${newClusterTag}`);
  };

  // 手动切换kubectl配置
  const switchKubectlConfig = async () => {
    if (!activeCluster) {
      message.warning('No active cluster selected');
      return;
    }

    setClustersLoading(true);
    try {
      const response = await fetch('/api/multi-cluster/switch-kubectl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const result = await response.json();
      if (result.success) {
        message.success(`Kubectl config updated for cluster: ${activeCluster}`);
        // 刷新状态以显示新的集群信息
        setTimeout(() => {
          refreshAllStatus();
        }, 2000);
      } else {
        message.error(result.error || 'Failed to switch kubectl config');
      }
    } catch (error) {
      console.error('Failed to switch kubectl config:', error);
      message.error('Failed to switch kubectl config');
    } finally {
      setClustersLoading(false);
    }
  };

  useEffect(() => {
    console.log('ClusterManagement: Initial useEffect triggered');
    
    // 注册到全局刷新管理器
    const componentId = 'cluster-management';
    globalRefreshManager.subscribe(componentId, refreshAllStatus, {
      priority: 10 // 最高优先级
    });
    
    // 注册到操作刷新管理器
    operationRefreshManager.subscribe(componentId, refreshAllStatus);
    
    // 初始化多集群和表单默认值
    const initializeComponent = async () => {
      try {
        console.log('ClusterManagement: Starting initialization');
        // 1. 获取集群列表
        await fetchClusters();
        
        // 2. 检查当前状态，恢复按钮状态
        setTimeout(async () => {
          try {
            await refreshAllStatus(false); // 不显示成功消息
            console.log('ClusterManagement: Initial status check completed');
          } catch (error) {
            console.error('Error during initial status check:', error);
          }
        }, 1000); // 给集群列表加载一些时间
        
        console.log('ClusterManagement: Initialization completed');
      } catch (error) {
        console.error('Failed to initialize component:', error);
        // 如果初始化失败，至少设置默认值
        form.setFieldsValue(defaultConfig);
      }
    };
    
    initializeComponent();
    
    // 清理函数
    return () => {
      globalRefreshManager.unsubscribe(componentId);
      operationRefreshManager.unsubscribe(componentId);
    };
  }, []); // 只在组件挂载时执行一次

  // 单独的 useEffect 处理 activeCluster 变化
  useEffect(() => {
    console.log('ClusterManagement: activeCluster changed to:', activeCluster);
    if (!activeCluster) {
      form.setFieldsValue(defaultConfig);
    }
  }, [activeCluster]); // 当 activeCluster 变化时设置默认值

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
        const hasNewContent = result.data.content.length > 0;
        
        setLogs(prev => ({
          ...prev,
          [step]: prev[step] + result.data.content
        }));
        setLogOffset(prev => ({
          ...prev,
          [step]: result.data.totalLength
        }));
        
        // 如果有新内容且当前显示的是这个步骤的日志，自动滚动到底部
        if (hasNewContent && step === activeLogTab && logContainerRef.current) {
          setTimeout(() => {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
          }, 100);
        }
      }
    } catch (error) {
      console.error('Error fetching logs:', error);
    }
  };

  // 获取 MLFlow 服务器信息
  const fetchMLFlowInfo = async () => {
    try {
      const response = await fetch('/api/cluster/mlflow-info');
      const result = await response.json();
      
      if (result.success) {
        setMlflowInfo(result.data);
      } else {
        console.error('Error fetching MLFlow info:', result.error);
        setMlflowInfo({ status: 'error', error: result.error });
      }
    } catch (error) {
      console.error('Error fetching MLFlow info:', error);
      setMlflowInfo({ status: 'error', error: error.message });
    }
  };

  // 统一的全局刷新函数 - 适配全局刷新管理器
  const refreshAllStatus = async (showSuccessMessage = true) => {
    // 如果是从全局刷新管理器调用，不显示loading状态（避免冲突）
    const isGlobalRefresh = showSuccessMessage === undefined;
    
    if (!isGlobalRefresh) {
      setLoading(true);
    }
    
    try {
      // 并行执行所有刷新操作
      await Promise.all([
        checkStepStatus(),
        refreshCloudFormationStatus(),
        fetchLogs('launch'),
        fetchLogs('configure'),
        fetchMLFlowInfo() // 添加 MLFlow 信息获取
      ]);
      
      if (showSuccessMessage && !isGlobalRefresh) {
        message.success('Status refreshed successfully');
      }
    } catch (error) {
      console.error('Error refreshing status:', error);
      if (!isGlobalRefresh) {
        message.error(`Error refreshing status: ${error.message}`);
      }
      throw error; // 重新抛出错误，让全局刷新管理器处理
    } finally {
      if (!isGlobalRefresh) {
        setTimeout(() => setLoading(false), 500); // 给用户一个加载反馈
      }
    }
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
        
        // 配置保存后，清除状态缓存并重新检查状态
        await fetch('/api/cluster/clear-status-cache', { method: 'POST' });
        setTimeout(() => {
          refreshAllStatus();
        }, 1000);
        
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
        message.success('Cluster launch started in background. Use "Refresh All" to check progress.');
        
        // 🚀 触发操作刷新 - 替代原有的setTimeout刷新
        operationRefreshManager.triggerOperationRefresh('cluster-launch', {
          clusterTag: form.getFieldValue('clusterTag') || activeCluster,
          timestamp: new Date().toISOString()
        });
        
      } else {
        setStep1Status('error');
        message.error(`Cluster launch failed: ${result.error}`);
      }
    } catch (error) {
      setStep1Status('error');
      message.error(`Error launching cluster: ${error.message}`);
    } finally {
      // 延迟设置 loading 为 false，避免与刷新冲突
      setTimeout(() => setLoading(false), 500);
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
        
        // 🚀 触发操作刷新 - 替代原有的setTimeout刷新
        operationRefreshManager.triggerOperationRefresh('cluster-configure', {
          clusterTag: form.getFieldValue('clusterTag') || activeCluster,
          timestamp: new Date().toISOString()
        });
        
      } else {
        setStep2Status('error');
        message.error(`Cluster configuration failed: ${result.error}`);
      }
    } catch (error) {
      setStep2Status('error');
      message.error(`Error configuring cluster: ${error.message}`);
    } finally {
      // 延迟设置 loading 为 false，避免与刷新冲突
      setTimeout(() => setLoading(false), 500);
    }
  };

  // 刷新 CloudFormation 状态 - 从 init_envs 获取堆栈名称
  const refreshCloudFormationStatus = async () => {
    try {
      // 不再从表单获取，而是从后端 init_envs 获取
      const response = await fetch('/api/cluster/cloudformation-status');
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
    <>
      {/* 注入自定义滚动条样式 */}
      <style dangerouslySetInnerHTML={{ __html: customScrollbarStyle }} />
      
      <div style={{ padding: '24px' }}>
        
        <Card 
          title={
            <Space>
              <ClusterOutlined />
              <span>Cluster Management</span>
            </Space>
          } 
          style={{ marginBottom: 24 }}
        >
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: 'manage',
                label: (
                  <Space>
                    <InfoCircleOutlined />
                    <span>Cluster Information</span>
                  </Space>
                ),
                children: (
                  <div>
                    {/* 集群选择器和管理功能 */}
                    <Row gutter={16} align="middle" style={{ marginBottom: 24 }}>
                      <Col flex="auto">
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <div>
                            <Text strong>Active Cluster:</Text>
                            <Select
                              value={activeCluster}
                              onChange={switchCluster}
                              style={{ width: '100%', marginTop: 8 }}
                              placeholder="Select a cluster or import/create one"
                              loading={clustersLoading}
                              allowClear
                              showSearch
                              optionFilterProp="children"
                            >
                              {clusters.map(cluster => (
                                <Option key={cluster.clusterTag} value={cluster.clusterTag}>
                                  <Space>
                                    <span>{cluster.clusterTag}</span>
                                    <Tag color={cluster.type === 'imported' ? 'blue' : 'green'} size="small">
                                      {cluster.type === 'imported' ? 'Imported' : 'Created'}
                                    </Tag>
                                    <Text type="secondary" style={{ fontSize: '12px' }}>
                                      {new Date(cluster.lastModified).toLocaleDateString()}
                                    </Text>
                                  </Space>
                                </Option>
                              ))}
                            </Select>
                          </div>
                          {activeCluster && (
                            <Alert
                              message={`Currently managing cluster: ${activeCluster}`}
                              type="info"
                              showIcon
                              style={{ marginTop: 8 }}
                            />
                          )}
                          {!activeCluster && clusters.length === 0 && (
                            <Alert
                              message="No clusters found. Import an existing cluster or create a new one."
                              type="warning"
                              showIcon
                              style={{ marginTop: 8 }}
                            />
                          )}
                        </Space>
                      </Col>
                      <Col>
                        <Space direction="vertical" align="center">
                          <Text type="secondary" style={{ fontSize: '12px' }}>
                            Total Clusters
                          </Text>
                          <Tag color="blue" style={{ fontSize: '16px', padding: '4px 12px' }}>
                            {clusters.length}
                          </Tag>
                        </Space>
                      </Col>
                    </Row>

                    {/* 管理操作按钮 */}
                    <Row gutter={16} style={{ marginBottom: 24 }}>
                      <Col>
                        <Button 
                          icon={<ReloadOutlined />} 
                          onClick={fetchClusters}
                          loading={clustersLoading}
                        >
                          Refresh Clusters
                        </Button>
                      </Col>
                      {activeCluster && (
                        <Col>
                          <Tooltip title="Switch kubectl config to active cluster">
                            <Button 
                              icon={<SettingOutlined />} 
                              onClick={switchKubectlConfig}
                              loading={clustersLoading}
                              type="default"
                            >
                              Switch Kubectl
                            </Button>
                          </Tooltip>
                        </Col>
                      )}
                      <Col>
                        <Button 
                          type="default"
                          icon={<ImportOutlined />} 
                          onClick={() => setShowImportModal(true)}
                        >
                          Import Existing Cluster
                        </Button>
                      </Col>
                    </Row>

                    {/* 集群信息显示 */}
                    {activeCluster && (
                      <Card title="Cluster Details" size="small">
                        {(() => {
                          const cluster = clusters.find(c => c.clusterTag === activeCluster);
                          if (!cluster) return <Text type="secondary">Loading cluster information...</Text>;
                          
                          if (cluster.type === 'imported') {
                            return (
                              <Row gutter={[16, 16]}>
                                <Col span={12}>
                                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                    <div>
                                      <Text strong>EKS Cluster Name:</Text>
                                      <br />
                                      <Text code>{cluster.config?.eksClusterName || 'N/A'}</Text>
                                    </div>
                                    <div>
                                      <Text strong>AWS Region:</Text>
                                      <br />
                                      <Text code>{cluster.config?.awsRegion || 'N/A'}</Text>
                                    </div>
                                  </Space>
                                </Col>
                                <Col span={12}>
                                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                    <div>
                                      <Text strong>S3 Bucket:</Text>
                                      <br />
                                      <Text code>{cluster.config?.s3BucketName || 'N/A'}</Text>
                                    </div>
                                    <div>
                                      <Text strong>Cluster Type:</Text>
                                      <br />
                                      <Tag color="blue">Imported</Tag>
                                    </div>
                                  </Space>
                                </Col>
                              </Row>
                            );
                          } else {
                            return (
                              <Row gutter={[16, 16]}>
                                <Col span={12}>
                                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                    <div>
                                      <Text strong>Cluster Tag:</Text>
                                      <br />
                                      <Text code>{cluster.config?.clusterTag || 'N/A'}</Text>
                                    </div>
                                    <div>
                                      <Text strong>AWS Region:</Text>
                                      <br />
                                      <Text code>{cluster.config?.awsRegion || 'N/A'}</Text>
                                    </div>
                                  </Space>
                                </Col>
                                <Col span={12}>
                                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                                    <div>
                                      <Text strong>GPU Instance Type:</Text>
                                      <br />
                                      <Text code>{cluster.config?.gpuInstanceType || 'N/A'}</Text>
                                    </div>
                                    <div>
                                      <Text strong>Cluster Type:</Text>
                                      <br />
                                      <Tag color="green">Created</Tag>
                                    </div>
                                  </Space>
                                </Col>
                              </Row>
                            );
                          }
                        })()}
                      </Card>
                    )}
                  </div>
                )
              },
              {
                key: 'create',
                label: (
                  <Space>
                    <PlusOutlined />
                    <span>Create New Cluster</span>
                  </Space>
                ),
                children: (
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
                            onClick={() => refreshAllStatus(true)}
                            loading={loading}
                            size="small"
                          >
                            Refresh All Status
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
                              disabled={step1Status === 'process' || step2Status === 'process' || step1Status === 'finish'}
                              block
                            >
                              {step1Status === 'finish' ? 'Step 1: Completed' : 'Execute Step 1: Cluster Launch'}
                            </Button>
                            {step1Status === 'finish' && (
                              <div style={{ fontSize: '12px', color: '#52c41a', marginTop: '4px' }}>
                                ✓ CloudFormation stack already exists. Step 1 is complete.
                              </div>
                            )}
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
                              disabled={step1Status !== 'finish' || step2Status === 'process' || step2Status === 'finish'}
                              block
                            >
                              {step2Status === 'finish' ? 'Step 2: Completed' : 'Execute Step 2: Cluster Configuration'}
                            </Button>
                            {step2Status === 'finish' && (
                              <div style={{ fontSize: '12px', color: '#52c41a', marginTop: '4px' }}>
                                ✓ All Kubernetes components are ready. Step 2 is complete.
                              </div>
                            )}
                          </Space>
                        </div>

                        <Divider />

                        {/* 集群状态显示 */}
                        <div style={{ marginBottom: '16px' }}>
                          <Space direction="vertical" style={{ width: '100%' }}>
                            {/* CloudFormation Status (Step 1) */}
                            <div>
                              <Text strong>Launch Status (CloudFormation):</Text>
                              {step1Details ? (
                                <div style={{ marginTop: '4px' }}>
                                  {getCloudFormationStatusTag(step1Details.stackStatus || step1Details.status)}
                                  <br />
                                  <Text type="secondary" style={{ fontSize: '12px' }}>
                                    Stack: {step1Details.stackName} | Last Updated: {step1Details.details?.lastUpdatedTime ? new Date(step1Details.details.lastUpdatedTime).toLocaleString() : 'N/A'}
                                  </Text>
                                </div>
                              ) : (
                                <div style={{ marginTop: '4px' }}>
                                  <Text type="secondary">Click "Refresh All Status" to check</Text>
                                </div>
                              )}
                            </div>

                            <Divider style={{ margin: '8px 0' }} />

                            {/* Cluster Configuration Status (Step 2) */}
                            <div>
                              <Text strong>Configuration Status (Kubernetes):</Text>
                              {step2Details ? (
                                <div style={{ marginTop: '4px' }}>
                                  {step2Details.status === 'completed' ? (
                                    <Tag color="success">All Components Ready</Tag>
                                  ) : step2Details.status === 'partial' ? (
                                    <Tag color="processing">Partially Ready</Tag>
                                  ) : step2Details.status === 'error' ? (
                                    <Tag color="error">Configuration Error</Tag>
                                  ) : (
                                    <Tag color="default">Not Started</Tag>
                                  )}
                                  <br />
                                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                    <Text type="secondary" style={{ fontSize: '12px' }}>
                                      Ready: {step2Details.summary?.ready || 0}/{step2Details.summary?.total || 0} components
                                    </Text>
                                    {step2Details.checks && step2Details.checks.length > 0 && (
                                      <>
                                        {step2Details.checks.map((check, index) => (
                                          <Tag 
                                            key={index}
                                            size="small" 
                                            color={check.status === 'ready' ? 'green' : check.status === 'missing' ? 'orange' : 'red'}
                                            style={{ fontSize: '11px', margin: 0 }}
                                          >
                                            {check.name}
                                          </Tag>
                                        ))}
                                      </>
                                    )}
                                  </div>
                                  
                                  {/* MLFlow 信息显示 - 只在 Step 2 完成后显示 */}
                                  {step2Details.status === 'completed' && (
                                    <>
                                      <Divider style={{ margin: '8px 0' }} />
                                      
                                      <div>
                                        <Text strong>SageMaker Managed MLFlow Tracking Server ARN:</Text>
                                        {mlflowInfo ? (
                                          mlflowInfo.status === 'found' && mlflowInfo.trackingServerArn ? (
                                            <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                              <Text 
                                                style={{ 
                                                  fontSize: '12px', 
                                                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                                                  backgroundColor: '#f6f8fa',
                                                  padding: '2px 6px',
                                                  borderRadius: '3px',
                                                  border: '1px solid #d1d9e0',
                                                  color: '#0969da',
                                                  wordBreak: 'break-all',
                                                  flex: 1
                                                }}
                                              >
                                                {mlflowInfo.trackingServerArn}
                                              </Text>
                                              <Button
                                                size="small"
                                                icon={<CopyOutlined />}
                                                onClick={() => {
                                                  navigator.clipboard.writeText(mlflowInfo.trackingServerArn);
                                                  message.success('ARN copied to clipboard');
                                                }}
                                                title="Copy ARN"
                                                style={{ flexShrink: 0 }}
                                              />
                                            </div>
                                          ) : mlflowInfo.status === 'not_found' ? (
                                            <div style={{ marginTop: '4px' }}>
                                              <Tag color="processing" size="small">Creating...</Tag>
                                              <Text type="secondary" style={{ fontSize: '11px', marginLeft: '8px' }}>
                                                MLflow server info not available yet
                                              </Text>
                                            </div>
                                          ) : mlflowInfo.status === 'error' ? (
                                            <div style={{ marginTop: '4px' }}>
                                              <Tag color="error" size="small">Error</Tag>
                                              <Text type="secondary" style={{ fontSize: '11px', marginLeft: '8px' }}>
                                                {mlflowInfo.error || 'Failed to load MLflow info'}
                                              </Text>
                                            </div>
                                          ) : (
                                            <div style={{ marginTop: '4px' }}>
                                              <Tag color="orange" size="small">Unknown Status</Tag>
                                              <Text type="secondary" style={{ fontSize: '11px', marginLeft: '8px' }}>
                                                Unexpected MLflow status: {mlflowInfo.status}
                                              </Text>
                                            </div>
                                          )
                                        ) : (
                                          <div style={{ marginTop: '4px' }}>
                                            <Tag color="default" size="small">Loading...</Tag>
                                          </div>
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>
                              ) : (
                                <div style={{ marginTop: '4px' }}>
                                  <Text type="secondary">Complete Step 1 first, then refresh to check</Text>
                                </div>
                              )}
                            </div>
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
                          <Space size="small">
                            <Button 
                              size="small" 
                              icon={<ReloadOutlined />}
                              onClick={() => refreshAllStatus(true)}
                              loading={loading}
                            >
                              Refresh
                            </Button>
                            <Button 
                              size="small" 
                              icon={<DownOutlined />}
                              onClick={() => {
                                if (logContainerRef.current) {
                                  logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
                                }
                              }}
                              title="Scroll to bottom"
                            >
                              Bottom
                            </Button>
                          </Space>
                        }
                      >
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                          {/* 日志选择 Tabs - 最小化空间 */}
                          <div style={{ marginBottom: '4px', flexShrink: 0 }}>
                            <Space size="small">
                              <Button 
                                size="small" 
                                type={activeLogTab === 'launch' ? 'primary' : 'default'}
                                onClick={() => switchLogTab('launch')}
                              >
                                Step 1
                              </Button>
                              <Button 
                                size="small" 
                                type={activeLogTab === 'configure' ? 'primary' : 'default'}
                                onClick={() => switchLogTab('configure')}
                              >
                                Step 2
                              </Button>
                            </Space>
                          </div>

                          {/* 日志显示区域 - 固定高度，支持滚动，自定义滚动条样式 */}
                          <div
                            ref={logContainerRef}
                            style={{
                              height: '400px', // 固定高度，不再使用 flex: 1
                              backgroundColor: '#1e1e1e',
                              color: '#d4d4d4',
                              fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                              fontSize: '12px',
                              padding: '8px',
                              overflowY: 'auto', // 垂直滚动
                              overflowX: 'hidden', // 隐藏水平滚动
                              border: '1px solid #333',
                              borderRadius: '4px',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word', // 长行自动换行
                              
                              // 自定义滚动条样式 - 深色主题
                              scrollbarWidth: 'thin', // Firefox
                              scrollbarColor: '#555 #2a2a2a', // Firefox: thumb track
                            }}
                            className="custom-scrollbar"
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
                                CF: {step1Details.stackStatus || step1Details.status} | {step1Details.stackName}
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
                )
              }
            ]}
          />
        </Card>
      </div>
    
    {/* 导入现有集群 Modal */}
    <Modal
      title={
        <Space>
          <ImportOutlined />
          <span>Import Existing Cluster</span>
        </Space>
      }
      open={showImportModal}
      onCancel={() => {
        setShowImportModal(false);
        importForm.resetFields();
      }}
      footer={null}
      width={600}
    >
      <Alert
        message="Import Existing EKS Cluster"
        description="Connect to your existing EKS cluster with HyperPod nodegroups. Only 3 fields required - other information will be auto-detected."
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />
      
      <Form
        form={importForm}
        layout="vertical"
        onFinish={importExistingCluster}
      >
        <Form.Item
          label="EKS Cluster Name"
          name="eksClusterName"
          rules={[{ required: true, message: 'Please enter EKS cluster name' }]}
          extra="The name of your existing EKS cluster"
        >
          <Input placeholder="my-eks-cluster" />
        </Form.Item>

        <Form.Item
          label="AWS Region"
          name="awsRegion"
          rules={[{ required: true, message: 'Please enter AWS region' }]}
          extra="The AWS region where your EKS cluster is located"
        >
          <Input placeholder="us-west-2" />
        </Form.Item>

        <Form.Item
          label="S3 Bucket for Models"
          name="s3BucketName"
          rules={[{ required: true, message: 'Please enter S3 bucket name' }]}
          extra="S3 bucket for storing and downloading models"
        >
          <Input placeholder="my-models-bucket" />
        </Form.Item>

        <Divider />

        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Button 
            onClick={testClusterConnection}
            loading={importLoading}
            icon={<CheckCircleOutlined />}
          >
            Test Connection
          </Button>
          
          <Space>
            <Button onClick={() => {
              setShowImportModal(false);
              importForm.resetFields();
            }}>
              Cancel
            </Button>
            <Button 
              type="primary" 
              htmlType="submit"
              loading={importLoading}
              icon={<ImportOutlined />}
            >
              Import Cluster
            </Button>
          </Space>
        </Space>
      </Form>
    </Modal>
    </>
  );
};

export default ClusterManagement;
