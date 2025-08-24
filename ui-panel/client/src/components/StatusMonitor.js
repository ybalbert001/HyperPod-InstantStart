import React, { useState } from 'react';
import { 
  Tabs, 
  Table, 
  Tag, 
  Space, 
  Badge,
  Tooltip,
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
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { CONFIG } from '../config/constants';

const { TabPane } = Tabs;
const { Text } = Typography;

const StatusMonitor = ({ pods, services, onRefresh, activeTab }) => {
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // 使用自动刷新Hook
  const { manualRefresh, config } = useAutoRefresh(
    'status-monitor',
    async () => {
      if (onRefresh) {
        try {
          await onRefresh();
          setLastUpdate(new Date());
        } catch (error) {
          console.error('Auto-refresh error in StatusMonitor:', error);
        }
      }
    },
    { 
      enabled: !!onRefresh,
      immediate: false // 不立即执行，因为数据已经通过props传入
    }
  );

  // 手动刷新功能
  const handleRefresh = async () => {
    if (!onRefresh) {
      message.error('Refresh function not available');
      return;
    }
    
    setLoading(true);
    try {
      await onRefresh();
      setLastUpdate(new Date());
      message.success('Data refreshed successfully', CONFIG.MESSAGE_DURATION.SUCCESS);
    } catch (error) {
      console.error('Error refreshing data:', error);
      message.error('Failed to refresh data');
    } finally {
      setLoading(false);
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
          <Text code style={{ fontSize: '12px' }}>{text}</Text>
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
              backgroundColor: readyCount === totalCount && totalCount > 0 ? '#52c41a' : '#faad14' 
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
          <Text type={totalRestarts > 0 ? 'warning' : 'secondary'}>
            {totalRestarts}
          </Text>
        );
      },
    },
    {
      title: 'Age',
      key: 'age',
      render: (_, pod) => {
        const creationTime = new Date(pod.metadata?.creationTimestamp);
        const now = new Date();
        const diffMs = now - creationTime;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);
        
        let ageText;
        if (diffDays > 0) {
          ageText = `${diffDays}d`;
        } else if (diffHours > 0) {
          ageText = `${diffHours}h`;
        } else {
          ageText = `${diffMins}m`;
        }
        
        return <Text type="secondary">{ageText}</Text>;
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
          <Text code style={{ fontSize: '12px' }}>{text}</Text>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        {lastUpdate && (
          <Text type="secondary" style={{ fontSize: '11px' }}>
            Last updated: {lastUpdate.toLocaleTimeString()}
          </Text>
        )}
        <Text type="secondary" style={{ fontSize: '11px', color: '#52c41a' }}>
          • Auto-refresh every {Math.floor(config.INTERVAL / 60000)} min
        </Text>
        <Button 
          size="small" 
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={handleRefresh}
        >
          Refresh
        </Button>
      </div>
    ) : null;

    if (activeTab === 'pods') {
      return (
        <div>
          {/* Pod统计 */}
          <div style={{ 
            marginBottom: 16, 
            padding: 12, 
            backgroundColor: '#f5f5f5', 
            borderRadius: 6,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <Space size="large">
              <Space>
                <Badge status="success" />
                <Text>Running: {podStats.running}</Text>
              </Space>
              <Space>
                <Badge status="processing" />
                <Text>Pending: {podStats.pending}</Text>
              </Space>
              <Space>
                <Badge status="error" />
                <Text>Failed: {podStats.failed}</Text>
              </Space>
            </Space>
            
            {onRefresh && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {lastUpdate && (
                  <Text type="secondary" style={{ fontSize: '11px' }}>
                    Last updated: {lastUpdate.toLocaleTimeString()}
                  </Text>
                )}
                <Text type="secondary" style={{ fontSize: '11px', color: '#52c41a' }}>
                  • Auto-refresh every {Math.floor(config.INTERVAL / 60000)} min
                </Text>
                <Button 
                  size="small" 
                  icon={<ReloadOutlined />}
                  loading={loading}
                  onClick={handleRefresh}
                >
                  Refresh
                </Button>
              </div>
            )}
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
          {/* Service统计 */}
          <div style={{ 
            marginBottom: 16, 
            padding: 12, 
            backgroundColor: '#f5f5f5', 
            borderRadius: 6,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <Space size="large">
              <Space>
                <Badge status="default" />
                <Text>Total: {serviceStats.total}</Text>
              </Space>
              <Space>
                <Badge status="processing" />
                <Text>LoadBalancer: {serviceStats.loadBalancer}</Text>
              </Space>
              <Space>
                <Badge status="success" />
                <Text>Ready: {serviceStats.ready}</Text>
              </Space>
            </Space>
            
            {onRefresh && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {lastUpdate && (
                  <Text type="secondary" style={{ fontSize: '11px' }}>
                    Last updated: {lastUpdate.toLocaleTimeString()}
                  </Text>
                )}
                <Text type="secondary" style={{ fontSize: '11px', color: '#52c41a' }}>
                  • Auto-refresh every {Math.floor(config.INTERVAL / 60000)} min
                </Text>
                <Button 
                  size="small" 
                  icon={<ReloadOutlined />}
                  loading={loading}
                  onClick={handleRefresh}
                >
                  Refresh
                </Button>
              </div>
            )}
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
  }

  // 原来的tabs模式（向后兼容）
  return (
    <div>
      <Tabs 
        activeKey="pods" 
        size="small"
        tabBarExtraContent={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {lastUpdate && (
              <Text type="secondary" style={{ fontSize: '11px' }}>
                Last updated: {lastUpdate.toLocaleTimeString()}
              </Text>
            )}
            <Text type="secondary" style={{ fontSize: '11px', color: '#52c41a' }}>
              • Auto-refresh every {Math.floor(config.INTERVAL / 60000)} min
            </Text>
            <Button 
              size="small" 
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={handleRefresh}
            >
              Refresh
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
                count={podStats.total} 
                style={{ backgroundColor: '#1890ff' }}
              />
            </Space>
          } 
          key="pods"
        >
          {/* Pod统计 */}
          <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#f5f5f5', borderRadius: 6 }}>
            <Space size="large">
              <Space>
                <Badge status="success" />
                <Text>Running: {podStats.running}</Text>
              </Space>
              <Space>
                <Badge status="processing" />
                <Text>Pending: {podStats.pending}</Text>
              </Space>
              <Space>
                <Badge status="error" />
                <Text>Failed: {podStats.failed}</Text>
              </Space>
            </Space>
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
        </TabPane>

        <TabPane 
          tab={
            <Space>
              <ApiOutlined />
              Services
              <Badge 
                count={serviceStats.total} 
                style={{ backgroundColor: '#52c41a' }}
              />
            </Space>
          } 
          key="services"
        >
          {/* Service统计 */}
          <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#f5f5f5', borderRadius: 6 }}>
            <Space size="large">
              <Space>
                <Badge status="default" />
                <Text>Total: {serviceStats.total}</Text>
              </Space>
              <Space>
                <Badge status="processing" />
                <Text>LoadBalancer: {serviceStats.loadBalancer}</Text>
              </Space>
              <Space>
                <Badge status="success" />
                <Text>Ready: {serviceStats.ready}</Text>
              </Space>
            </Space>
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
        </TabPane>
      </Tabs>
    </div>
  );
};

export default StatusMonitor;
