import React, { useState, useEffect } from 'react';
import { Layout, Row, Col, Card, message, Tabs, Space, Badge, Button } from 'antd';
import { ContainerOutlined, ApiOutlined, ReloadOutlined, RocketOutlined, ExperimentOutlined, DatabaseOutlined, CloudServerOutlined } from '@ant-design/icons';
import ThemeProvider from './components/ThemeProvider';
import ConfigPanel from './components/ConfigPanel';
import ClusterStatusV2 from './components/ClusterStatusV2';
import TestPanel from './components/TestPanel';
import StatusMonitor from './components/StatusMonitor';
import DeploymentManager from './components/DeploymentManager';
import TrainingConfigPanel from './components/TrainingConfigPanel';
import HyperPodRecipes from './components/HyperPodRecipes';
import TrainingMonitorPanel from './components/TrainingMonitorPanel';
import TrainingHistoryPanel from './components/TrainingHistoryPanel';
import ModelDownloadPanel from './components/ModelDownloadPanel';
import S3StoragePanel from './components/S3StoragePanel';
import HyperPodJobManager from './components/HyperPodJobManager';
import { refreshManager } from './hooks/useAutoRefresh';
import { getActiveTheme } from './config/themeConfig';
import './App.css';
import './styles/dynamic-theme.css';

const { Header, Content } = Layout;
const { TabPane } = Tabs;

function App() {
  const [clusterData, setClusterData] = useState([]);
  const [pods, setPods] = useState([]);
  const [services, setServices] = useState([]);
  const [deploymentStatus, setDeploymentStatus] = useState(null);
  const [ws, setWs] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [refreshing, setRefreshing] = useState(false);
  const [activeMainTab, setActiveMainTab] = useState('model-management'); // 新增主标签状态

  const connectWebSocket = () => {
    console.log('Attempting to connect to WebSocket...');
    
    const websocket = new WebSocket('ws://localhost:8081');
    
    // 设置连接超时
    const connectionTimeout = setTimeout(() => {
      if (websocket.readyState === WebSocket.CONNECTING) {
        console.log('WebSocket connection timeout, closing...');
        websocket.close();
        setConnectionStatus('error');
      }
    }, 10000); // 10秒连接超时
    
    websocket.onopen = () => {
      console.log('WebSocket connected successfully');
      clearTimeout(connectionTimeout);
      setWs(websocket);
      setConnectionStatus('connected');
    };
    
    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WebSocket message received:', data.type);
        
        switch (data.type) {
          case 'status_update':
            console.log('Status update:', data.pods?.length, 'pods,', data.services?.length, 'services');
            setPods(data.pods || []);
            setServices(data.services || []);
            break;
          case 'deployment':
            setDeploymentStatus(data);
            if (data.status === 'success') {
              message.success(data.message);
            } else {
              message.error(data.message);
            }
            break;
          case 'training_launch':
            // 处理训练任务部署状态
            if (data.status === 'success') {
              message.success(data.message);
            } else {
              message.error(data.message);
            }
            break;
          case 'undeployment':
            if (data.status === 'success') {
              message.success(data.message);
            } else {
              message.error(data.message);
            }
            break;
          case 'training_job_deleted':
            // 处理训练任务删除状态
            if (data.status === 'success') {
              message.success(data.message);
            } else {
              message.error(data.message);
            }
            break;
          case 'model_download':
            // 处理模型下载状态
            if (data.status === 'success') {
              message.success(data.message);
            } else {
              message.error(data.message);
            }
            break;
          default:
            console.log('Unknown message type:', data.type);
            break;
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    websocket.onclose = (event) => {
      console.log('WebSocket disconnected:', event.code, event.reason);
      clearTimeout(connectionTimeout);
      setWs(null);
      setConnectionStatus('disconnected');
      
      // 自动重连机制（5秒后重连）
      if (event.code !== 1000) { // 不是正常关闭
        console.log('Attempting to reconnect in 5 seconds...');
        setTimeout(() => {
          if (!ws || ws.readyState === WebSocket.CLOSED) {
            connectWebSocket();
          }
        }, 5000);
      }
    };
    
    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      clearTimeout(connectionTimeout);
      setConnectionStatus('error');
    };
    
    return websocket;
  };

  useEffect(() => {
    // 延迟连接WebSocket，给后端服务器启动时间
    const connectTimer = setTimeout(() => {
      connectWebSocket();
    }, 1000); // 延迟1秒连接
    
    // 初始加载集群状态
    fetchClusterStatus();
    
    // 初始加载pods和services（作为备用）
    fetchPodsAndServices();
    
    return () => {
      clearTimeout(connectTimer);
      if (ws) {
        ws.close(1000, 'Component unmounting'); // 正常关闭
      }
    };
  }, []);

  const fetchClusterStatus = async () => {
    try {
      console.log('Fetching cluster status...');
      const response = await fetch('/api/cluster-status');
      const data = await response.json();
      console.log('Cluster status response:', data);
      setClusterData(data.nodes || []);
    } catch (error) {
      console.error('Error fetching cluster status:', error);
      message.error('Failed to fetch cluster status');
    }
  };

  // 配置：是否使用 V2 API（可以通过环境变量或配置文件控制）
  const USE_V2_API = true; // 默认使用 V2 API

  const fetchPodsAndServices = async () => {
    try {
      setRefreshing(true);
      console.log(`Fetching pods and services using ${USE_V2_API ? 'V2' : 'V1'} API...`);
      
      if (USE_V2_API) {
        // 使用 V2 优化 API
        const response = await fetch('/api/v2/app-status');
        const data = await response.json();
        
        console.log('App Status V2 response:', {
          pods: data.pods?.length || 0,
          services: data.services?.length || 0,
          fetchTime: data.fetchTime,
          cached: data.cached
        });
        
        // V2 API 返回处理过的数据，需要提取原始数据给现有组件使用
        setPods(data.rawPods || data.pods || []);
        setServices(data.rawServices || data.services || []);
        
        // 可以选择性地显示性能信息
        if (data.fetchTime && !data.cached) {
          console.log(`Fresh data fetched in ${data.fetchTime}ms`);
        } else if (data.cached) {
          console.log('Using cached data');
        }
      } else {
        // 使用原有 V1 API
        const [podsResponse, servicesResponse] = await Promise.all([
          fetch('/api/pods'),
          fetch('/api/services')
        ]);
        
        const podsData = await podsResponse.json();
        const servicesData = await servicesResponse.json();
        
        console.log('Pods response:', podsData.length, 'pods');
        console.log('Services response:', servicesData.length, 'services');
        
        setPods(podsData);
        setServices(servicesData);
      }
    } catch (error) {
      console.error('Error fetching pods and services:', error);
      message.error('Failed to fetch pods and services');
    } finally {
      setRefreshing(false);
    }
  };

  // 新增：刷新所有App Status数据的函数
  const refreshAllAppStatus = async () => {
    setRefreshing(true);
    try {
      console.log('Refreshing all App Status data...');
      
      if (USE_V2_API) {
        // 使用 V2 API 强制刷新
        const response = await fetch('/api/v2/app-status?force=true');
        const data = await response.json();
        
        console.log('Forced refresh V2 response:', {
          pods: data.pods?.length || 0,
          services: data.services?.length || 0,
          fetchTime: data.fetchTime
        });
        
        setPods(data.rawPods || data.pods || []);
        setServices(data.rawServices || data.services || []);
      } else {
        // 直接刷新pods和services数据
        await fetchPodsAndServices();
      }
      
      // 同时使用全局刷新管理器触发其他组件刷新
      refreshManager.triggerRefresh();
      
      message.success('All App Status data refreshed successfully');
    } catch (error) {
      console.error('Error refreshing all app status:', error);
      message.error('Failed to refresh all app status data');
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeploy = async (config) => {
    console.log('handleDeploy called with config:', config);
    try {
      console.log('Deploying with config:', config);
      const response = await fetch('/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });
      
      console.log('Response received:', response);
      const result = await response.json();
      console.log('Response JSON:', result);
      
      if (result.success) {
        // 移除重复的message.success，让WebSocket处理通知
        // message.success('Deployment initiated successfully');
        // 刷新集群状态
        fetchClusterStatus();
        // 刷新pods和services
        fetchPodsAndServices();
      } else {
        message.error(`Deployment failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Error deploying:', error);
      message.error('Failed to deploy model');
    }
  };

  const handleTrainingLaunch = async (config) => {
    try {
      console.log('Launching training job with config:', config);
      const response = await fetch('/api/launch-training', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });
      
      const result = await response.json();
      
      if (result.success) {
        // 移除重复的message.success，让WebSocket处理通知
        // message.success('Training job deployed successfully');
        // 刷新集群状态
        fetchClusterStatus();
        // 刷新pods和services
        fetchPodsAndServices();
      } else {
        message.error(`Training launch failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Error launching training job:', error);
      message.error('Failed to launch training job');
    }
  };

  const getConnectionStatusDisplay = () => {
    const config = refreshManager.getConfig();
    const intervalMinutes = Math.floor(config.INTERVAL / 60000);
    
    switch (connectionStatus) {
      case 'connected':
        return `🟢 Real-time Updates (${intervalMinutes}min)`;
      case 'connecting':
        return '🟡 Connecting...';
      case 'disconnected':
        return '🟠 Offline (Refresh to reconnect)';
      case 'error':
        return '🔴 Connection Error';
      default:
        return '🔴 Unknown';
    }
  };

  const theme = getActiveTheme();

  return (
    <ThemeProvider>
      <Layout className="app-layout">
        <Header className={`theme-header ${theme.name === 'aws' ? 'aws-header' : ''}`}>
          <h1 className="theme-header-title">
            <CloudServerOutlined style={{ marginRight: '8px' }} />
            HyperPod InstantStart
            <span className="theme-header-subtitle">
              Unified Platform
            </span>
          </h1>
          <div style={{ marginLeft: 'auto', color: 'white', fontSize: '12px' }}>
            Status: {getConnectionStatusDisplay()}
          </div>
        </Header>
      
      <Content className="app-content">
        {/* 主标签切换区域 */}
        <div style={{ marginBottom: '16px' }}>
          <Tabs 
            activeKey={activeMainTab}
            onChange={setActiveMainTab}
            size="large"
            items={[
              {
                key: 'model-management',
                label: (
                  <Space>
                    <DatabaseOutlined />
                    Model Management
                  </Space>
                ),
              },
              {
                key: 'inference',
                label: (
                  <Space>
                    <RocketOutlined />
                    Inference
                  </Space>
                ),
              },
              {
                key: 'training',
                label: (
                  <Space>
                    <ExperimentOutlined />
                    Training
                  </Space>
                ),
              },
              {
                key: 'training-history',
                label: (
                  <Space>
                    <DatabaseOutlined />
                    Training History
                  </Space>
                ),
              }
            ]}
          />
        </div>
        
        {/* 中间动态内容区域 */}
        <div style={{ marginBottom: '16px' }}>
          <Row gutter={[16, 16]} style={{ display: activeMainTab === 'inference' ? 'flex' : 'none' }}>
            {/* Inference - 左侧：模型配置 */}
            <Col xs={24} lg={12}>
              <Card 
                title="Model Configuration" 
                className="theme-card compute"
                style={{ height: '50vh', overflow: 'auto' }}
              >
                <ConfigPanel 
                  onDeploy={handleDeploy}
                  deploymentStatus={deploymentStatus}
                />
              </Card>
            </Col>
            
            {/* Inference - 右侧：模型测试 */}
            <Col xs={24} lg={12}>
              <Card 
                title="Model Testing"
                className="theme-card ml"
                style={{ height: '50vh', overflow: 'auto' }}
              >
                <TestPanel 
                  services={services} 
                  onRefresh={fetchPodsAndServices}
                />
              </Card>
            </Col>
          </Row>
          
          <Row gutter={[16, 16]} style={{ display: activeMainTab === 'training' ? 'flex' : 'none' }}>
            {/* Training - 左侧：训练配置 */}
            <Col xs={24} lg={12}>
              <Card 
                title="HyperPodPytorchJob Recipes" 
                className="theme-card compute"
                style={{ height: '50vh', overflow: 'auto' }}
              >
                <HyperPodRecipes 
                  onLaunch={handleTrainingLaunch}
                  deploymentStatus={deploymentStatus}
                />
              </Card>
            </Col>
            
            {/* Training - 右侧：训练监控 */}
            <Col xs={24} lg={12}>
              <Card 
                title="Training Job Monitor"
                className="theme-card analytics"
                style={{ height: '50vh', overflow: 'auto' }}
              >
                <TrainingMonitorPanel />
              </Card>
            </Col>
          </Row>
          
          <div style={{ 
            padding: '0 16px',
            display: activeMainTab === 'training-history' ? 'block' : 'none'
          }}>
            <TrainingHistoryPanel />
          </div>
          
          <Row gutter={[16, 16]} style={{ display: activeMainTab === 'model-management' ? 'flex' : 'none' }}>
            {/* Model Management - 左侧：模型下载 */}
            <Col xs={24} lg={12}>
              <Card 
                title="Model Download" 
                className="theme-card storage"
                style={{ height: '50vh', overflow: 'auto' }}
              >
                <ModelDownloadPanel />
              </Card>
            </Col>
            
            {/* Model Management - 右侧：S3存储 */}
            <Col xs={24} lg={12}>
              <Card 
                title="S3 Storage"
                className="theme-card storage"
                style={{ height: '50vh', overflow: 'auto' }}
              >
                <S3StoragePanel />
              </Card>
            </Col>
          </Row>
        </div>
        
        {/* 底部监控区域 (共享) */}
        <Row gutter={[16, 16]}>
          {/* 左下：集群状态 */}
          <Col xs={24} lg={12}>
            <Card 
              title="Cluster Status" 
              className="theme-card analytics"
              style={{ height: '45vh', overflow: 'auto' }}
            >
              <ClusterStatusV2 
                clusterData={clusterData}
                onRefresh={fetchClusterStatus}
              />
            </Card>
          </Col>
          
          {/* 右下：状态监控和部署管理 */}
          <Col xs={24} lg={12}>
            <Card 
              title="App Status"
              className="theme-card database"
              style={{ height: '45vh', overflow: 'auto' }}
              bodyStyle={{ padding: 0 }}
            >
              <Tabs 
                defaultActiveKey="pods" 
                size="small"
                tabBarExtraContent={
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px' }}>
                    <span style={{ fontSize: '11px', color: '#52c41a' }}>
                      • Auto-refresh every {Math.floor(refreshManager.getConfig().INTERVAL / 60000)} min
                    </span>
                    <Button 
                      size="small"
                      icon={<ReloadOutlined />}
                      loading={refreshing}
                      onClick={refreshAllAppStatus}
                    >
                      Refresh All
                    </Button>
                  </div>
                }
              >
                <TabPane 
                  tab={
                    <Space>
                      <ContainerOutlined />
                      Pods
                      <Badge 
                        count={pods.length} 
                        style={{ backgroundColor: '#1890ff' }}
                      />
                    </Space>
                  } 
                  key="pods"
                >
                  <div style={{ padding: '16px' }}>
                    <StatusMonitor 
                      pods={pods}
                      services={[]}
                      onRefresh={fetchPodsAndServices}
                      activeTab="pods"
                    />
                  </div>
                </TabPane>
                <TabPane 
                  tab={
                    <Space>
                      <ApiOutlined />
                      Services
                      <Badge 
                        count={services.length} 
                        style={{ backgroundColor: '#52c41a' }}
                      />
                    </Space>
                  } 
                  key="services"
                >
                  <div style={{ padding: '16px' }}>
                    <StatusMonitor 
                      pods={[]}
                      services={services}
                      onRefresh={fetchPodsAndServices}
                      activeTab="services"
                    />
                  </div>
                </TabPane>
                <TabPane 
                  tab={
                    <Space>
                      <ContainerOutlined />
                      Deployments
                    </Space>
                  } 
                  key="deployments"
                >
                  <div style={{ padding: '16px' }}>
                    <DeploymentManager />
                  </div>
                </TabPane>
                <TabPane 
                  tab={
                    <Space>
                      <ExperimentOutlined />
                      HyperPod PytorchJob
                    </Space>
                  } 
                  key="hyperpod-jobs"
                >
                  <div style={{ padding: '16px' }}>
                    <HyperPodJobManager />
                  </div>
                </TabPane>
              </Tabs>
            </Card>
          </Col>
        </Row>
      </Content>
    </Layout>
    </ThemeProvider>
  );
}

export default App;
