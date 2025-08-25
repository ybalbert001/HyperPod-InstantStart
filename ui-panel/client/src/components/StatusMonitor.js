import React, { useState, useEffect } from 'react';
import { 
  Tabs, 
  Table, 
  Tag, 
  Space, 
  Badge,
  Button,
  Typography,
  message
} from 'antd';
import { 
  CheckCircleOutlined, 
  ExclamationCircleOutlined, 
  ClockCircleOutlined,
  ReloadOutlined,
  ApiOutlined,
  ContainerOutlined
} from '@ant-design/icons';
import globalRefreshManager from '../hooks/useGlobalRefresh';
import operationRefreshManager from '../hooks/useOperationRefresh';
import { CONFIG } from '../config/constants';

const { TabPane } = Tabs;
const { Text } = Typography;

const StatusMonitor = ({ pods, services, onRefresh, activeTab }) => {
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // 注册到全局刷新管理器，替代useAutoRefresh
  useEffect(() => {
    const componentId = 'status-monitor';
    
    const refreshFunction = async () => {
      if (onRefresh) {
        try {
          await onRefresh();
          setLastUpdate(new Date());
        } catch (error) {
          console.error('Refresh error in StatusMonitor:', error);
          throw error; // 重新抛出给全局刷新管理器处理
        }
      }
    };

    globalRefreshManager.subscribe(componentId, refreshFunction, {
      priority: 8 // 高优先级
    });

    // 🚀 注册到操作刷新管理器
    operationRefreshManager.subscribe(componentId, refreshFunction);

    return () => {
      globalRefreshManager.unsubscribe(componentId);
      operationRefreshManager.unsubscribe(componentId);
    };
  }, [onRefresh]);

  // 手动刷新功能 - 适配全局刷新管理器
  const handleRefresh = async (showMessage = true) => {
    if (!onRefresh) {
      if (showMessage) {
        message.error('Refresh function not available');
      }
      return;
    }
    
    // 如果是从全局刷新管理器调用，不显示loading状态（避免冲突）
    const isGlobalRefresh = showMessage === undefined;
    
    if (!isGlobalRefresh) {
      setLoading(true);
    }
    
    try {
      await onRefresh();
      setLastUpdate(new Date());
      if (showMessage && !isGlobalRefresh) {
        message.success('Data refreshed successfully', CONFIG.MESSAGE_DURATION.SUCCESS);
      }
    } catch (error) {
      console.error('Error refreshing data:', error);
      if (!isGlobalRefresh) {
        message.error('Failed to refresh data');
      }
      throw error; // 重新抛出错误，让全局刷新管理器处理
    } finally {
      if (!isGlobalRefresh) {
        setLoading(false);
      }
    }
  };

  // Pod状态映射
  const getPodStatus = (pod) => {
    const phase = pod.status?.phase;
    const conditions = pod.status?.conditions || [];
    
    if (phase === 'Running') {
      const readyCondition = conditions.find(c => c.type === 'Ready');
      return readyCondition?.status === 'True' ? 'running' : 'not-ready';
    }
    
    return phase?.toLowerCase() || 'unknown';
  };

  const getPodStatusColor = (status) => {
    switch (status) {
      case 'running': return 'success';
      case 'pending': return 'processing';
      case 'failed': return 'error';
      case 'not-ready': return 'warning';
      default: return 'default';
    }
  };

  const getPodStatusIcon = (status) => {
    switch (status) {
      case 'running': return <CheckCircleOutlined />;
      case 'pending': return <ClockCircleOutlined />;
      case 'failed': return <ExclamationCircleOutlined />;
      case 'not-ready': return <ExclamationCircleOutlined />;
      default: return <ClockCircleOutlined />;
    }
  };

  // Pod表格列定义
  const podColumns = [
    {
      title: 'Pod Name',
      dataIndex: ['metadata', 'name'],
      key: 'name',
      render: (text) => (
        <Space>
          <ContainerOutlined />
          <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{text}</span>
        </Space>
      ),
      ellipsis: true,
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, pod) => {
        const status = getPodStatus(pod);
        return (
          <Tag 
            color={getPodStatusColor(status)} 
            icon={getPodStatusIcon(status)}
          >
            {status.toUpperCase()}
          </Tag>
        );
      },
    },
    {
      title: 'Ready',
      key: 'ready',
      render: (_, pod) => {
        const containerStatuses = pod.status?.containerStatuses || [];
        const readyCount = containerStatuses.filter(c => c.ready).length;
        const totalCount = containerStatuses.length;
        
        return (
          <Badge 
            count={`${readyCount}/${totalCount}`}
            style={{ 
              backgroundColor: readyCount === totalCount ? '#52c41a' : '#faad14' 
            }}
          />
        );
      },
    },
    {
      title: 'Restarts',
      key: 'restarts',
      render: (_, pod) => {
        const containerStatuses = pod.status?.containerStatuses || [];
        const totalRestarts = containerStatuses.reduce((sum, c) => sum + (c.restartCount || 0), 0);
        
        return (
          <Badge 
            count={totalRestarts}
            style={{ 
              backgroundColor: totalRestarts === 0 ? '#52c41a' : '#ff4d4f' 
            }}
          />
        );
      },
    },
    {
      title: 'Age',
      key: 'age',
      render: (_, pod) => {
        const creationTime = new Date(pod.metadata.creationTimestamp);
        const now = new Date();
        const ageMs = now - creationTime;
        const ageMinutes = Math.floor(ageMs / 60000);
        
        if (ageMinutes < 60) {
          return `${ageMinutes}m`;
        } else if (ageMinutes < 1440) {
          return `${Math.floor(ageMinutes / 60)}h`;
        } else {
          return `${Math.floor(ageMinutes / 1440)}d`;
        }
      },
    },
  ];

  // Service表格列定义
  const serviceColumns = [
    {
      title: 'Service Name',
      dataIndex: ['metadata', 'name'],
      key: 'name',
      render: (text) => (
        <Space>
          <ApiOutlined />
          <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{text}</span>
        </Space>
      ),
      ellipsis: true,
    },
    {
      title: 'Type',
      dataIndex: ['spec', 'type'],
      key: 'type',
      render: (type) => (
        <Tag color={type === 'LoadBalancer' ? 'blue' : 'default'}>
          {type}
        </Tag>
      ),
    },
    {
      title: 'Cluster IP',
      dataIndex: ['spec', 'clusterIP'],
      key: 'clusterIP',
      render: (ip) => <Text code>{ip}</Text>,
    },
    {
      title: 'External IP',
      key: 'externalIP',
      render: (_, service) => {
        const ingress = service.status?.loadBalancer?.ingress;
        if (ingress && ingress.length > 0) {
          const externalIP = ingress[0].hostname || ingress[0].ip;
          return <Text code>{externalIP}</Text>;
        }
        
        if (service.spec.type === 'LoadBalancer') {
          return <Text type="secondary">Pending...</Text>;
        }
        
        return <Text type="secondary">-</Text>;
      },
    },
    {
      title: 'Ports',
      key: 'ports',
      render: (_, service) => {
        const ports = service.spec?.ports || [];
        return (
          <Space wrap>
            {ports.map((port, index) => (
              <Tag key={index} color="geekblue">
                {port.port}:{port.targetPort}
              </Tag>
            ))}
          </Space>
        );
      },
    },
  ];

  // 统计信息
  const podStats = {
    total: pods.length,
    running: pods.filter(p => getPodStatus(p) === 'running').length,
    pending: pods.filter(p => getPodStatus(p) === 'pending').length,
    failed: pods.filter(p => getPodStatus(p) === 'failed').length,
  };

  const serviceStats = {
    total: services.length,
    loadBalancer: services.filter(s => s.spec.type === 'LoadBalancer').length,
    ready: services.filter(s => s.status?.loadBalancer?.ingress?.length > 0).length,
  };

  // 如果指定了activeTab，只显示对应的内容
  if (activeTab) {
    const refreshButton = onRefresh ? (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '16px' 
      }}>
        <div>
          {lastUpdate && (
            <Text type="secondary" style={{ fontSize: '11px' }}>
              Last updated: {lastUpdate.toLocaleTimeString()}
            </Text>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Text type="secondary" style={{ fontSize: '11px', color: '#1890ff' }}>
            • Managed by Global Refresh
          </Text>
          <Button 
            size="small" 
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => handleRefresh(true)}
            style={{ fontSize: '11px', height: '20px', padding: '0 6px' }}
          >
            Refresh
          </Button>
        </div>
      </div>
    ) : null;

    if (activeTab === 'pods') {
      return (
        <div>
          {refreshButton}
          
          {/* Pod统计 */}
          <div style={{ 
            marginBottom: 16, 
            padding: 12, 
            backgroundColor: '#f5f5f5', 
            borderRadius: 6,
            display: 'flex',
            justifyContent: 'space-around'
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#1890ff' }}>
                {podStats.total}
              </div>
              <div style={{ fontSize: '12px', color: '#666' }}>Total</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#52c41a' }}>
                {podStats.running}
              </div>
              <div style={{ fontSize: '12px', color: '#666' }}>Running</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#faad14' }}>
                {podStats.pending}
              </div>
              <div style={{ fontSize: '12px', color: '#666' }}>Pending</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#ff4d4f' }}>
                {podStats.failed}
              </div>
              <div style={{ fontSize: '12px', color: '#666' }}>Failed</div>
            </div>
          </div>

          <Table
            columns={podColumns}
            dataSource={pods}
            rowKey={(pod) => pod.metadata.uid}
            size="small"
            pagination={false}
            scroll={{ y: 200 }}
            loading={loading}
            locale={{
              emptyText: 'No pods found'
            }}
          />
        </div>
      );
    }

    if (activeTab === 'services') {
      return (
        <div>
          {refreshButton}
          
          {/* Service统计 */}
          <div style={{ 
            marginBottom: 16, 
            padding: 12, 
            backgroundColor: '#f5f5f5', 
            borderRadius: 6,
            display: 'flex',
            justifyContent: 'space-around'
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#1890ff' }}>
                {serviceStats.total}
              </div>
              <div style={{ fontSize: '12px', color: '#666' }}>Total</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#722ed1' }}>
                {serviceStats.loadBalancer}
              </div>
              <div style={{ fontSize: '12px', color: '#666' }}>LoadBalancer</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#52c41a' }}>
                {serviceStats.ready}
              </div>
              <div style={{ fontSize: '12px', color: '#666' }}>Ready</div>
            </div>
          </div>

          <Table
            columns={serviceColumns}
            dataSource={services}
            rowKey={(service) => service.metadata.uid}
            size="small"
            pagination={false}
            scroll={{ y: 200 }}
            loading={loading}
            locale={{
              emptyText: 'No services found'
            }}
          />
        </div>
      );
    }

    return <div>Unsupported tab: {activeTab}</div>;
  }

  // 完整的Tabs视图（当没有指定activeTab时）
  return (
    <Tabs defaultActiveKey="pods" size="small">
      <TabPane 
        tab={
          <Space>
            <ContainerOutlined />
            Pods
            <Badge count={pods.length} style={{ backgroundColor: '#1890ff' }} />
          </Space>
        } 
        key="pods"
      >
        <div style={{ padding: '16px' }}>
          {onRefresh && (
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginBottom: '16px' 
            }}>
              <div>
                {lastUpdate && (
                  <Text type="secondary" style={{ fontSize: '11px' }}>
                    Last updated: {lastUpdate.toLocaleTimeString()}
                  </Text>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Text type="secondary" style={{ fontSize: '11px', color: '#1890ff' }}>
                  • Managed by Global Refresh
                </Text>
                <Button 
                  size="small" 
                  icon={<ReloadOutlined />}
                  loading={loading}
                  onClick={() => handleRefresh(true)}
                  style={{ fontSize: '11px', height: '20px', padding: '0 6px' }}
                >
                  Refresh
                </Button>
              </div>
            </div>
          )}

          <Table
            columns={podColumns}
            dataSource={pods}
            rowKey={(pod) => pod.metadata.uid}
            size="small"
            pagination={{ pageSize: 10 }}
            loading={loading}
          />
        </div>
      </TabPane>

      <TabPane 
        tab={
          <Space>
            <ApiOutlined />
            Services
            <Badge count={services.length} style={{ backgroundColor: '#52c41a' }} />
          </Space>
        } 
        key="services"
      >
        <div style={{ padding: '16px' }}>
          {onRefresh && (
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginBottom: '16px' 
            }}>
              <div>
                {lastUpdate && (
                  <Text type="secondary" style={{ fontSize: '11px' }}>
                    Last updated: {lastUpdate.toLocaleTimeString()}
                  </Text>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Text type="secondary" style={{ fontSize: '11px', color: '#1890ff' }}>
                  • Managed by Global Refresh
                </Text>
                <Button 
                  size="small" 
                  icon={<ReloadOutlined />}
                  loading={loading}
                  onClick={() => handleRefresh(true)}
                  style={{ fontSize: '11px', height: '20px', padding: '0 6px' }}
                >
                  Refresh
                </Button>
              </div>
            </div>
          )}

          <Table
            columns={serviceColumns}
            dataSource={services}
            rowKey={(service) => service.metadata.uid}
            size="small"
            pagination={{ pageSize: 10 }}
            loading={loading}
          />
        </div>
      </TabPane>
    </Tabs>
  );
};

export default StatusMonitor;
