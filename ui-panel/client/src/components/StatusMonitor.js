import React, { useState, useEffect } from 'react';
import { 
  Tabs, 
  Table, 
  Tag, 
  Space, 
  Badge,
  Button,
  Typography,
  message,
  Popconfirm
} from 'antd';
import { 
  CheckCircleOutlined, 
  ExclamationCircleOutlined, 
  ClockCircleOutlined,
  LoadingOutlined,
  ReloadOutlined,
  ApiOutlined,
  ContainerOutlined,
  DeleteOutlined
} from '@ant-design/icons';
import globalRefreshManager from '../hooks/useGlobalRefresh';
import operationRefreshManager from '../hooks/useOperationRefresh';
import { CONFIG } from '../config/constants';

const { TabPane } = Tabs;
const { Text } = Typography;

const StatusMonitor = ({ pods, services, onRefresh, activeTab }) => {
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [rayJobs, setRayJobs] = useState([]);

  // 获取RayJobs
  const fetchRayJobs = async () => {
    try {
      const response = await fetch('/api/rayjobs');
      const data = await response.json();
      setRayJobs(data);
    } catch (error) {
      console.error('Error fetching RayJobs:', error);
      setRayJobs([]);
    }
  };

  // 删除RayJob
  const handleDeleteRayJob = async (jobName) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/rayjobs/${jobName}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        message.success(`RayJob ${jobName} deletion initiated`);
        // 刷新会通过WebSocket自动触发
      } else {
        const error = await response.json();
        message.error(`Failed to delete RayJob: ${error.error}`);
      }
    } catch (error) {
      console.error('Error deleting RayJob:', error);
      message.error('Failed to delete RayJob');
    } finally {
      setLoading(false);
    }
  };

  // 注册到全局刷新管理器，替代useAutoRefresh
  useEffect(() => {
    const componentId = 'status-monitor';
    
    const refreshFunction = async () => {
      if (onRefresh) {
        try {
          await onRefresh();
          await fetchRayJobs(); // 同时获取RayJobs
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

    // 初始获取RayJobs
    fetchRayJobs();

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
    const containerStatuses = pod.status?.containerStatuses || [];
    
    // 检查容器状态，优先显示容器的实际状态
    for (const containerStatus of containerStatuses) {
      if (containerStatus.state?.waiting) {
        return containerStatus.state.waiting.reason?.toLowerCase() || 'waiting';
      }
      if (containerStatus.state?.terminated) {
        return containerStatus.state.terminated.reason?.toLowerCase() || 'terminated';
      }
    }
    
    if (phase === 'Running') {
      const readyCondition = conditions.find(c => c.type === 'Ready');
      return readyCondition?.status === 'True' ? 'running' : 'not-ready';
    }
    
    return phase?.toLowerCase() || 'unknown';
  };

  const getPodStatusColor = (status) => {
    switch (status) {
      case 'running': return 'success';
      case 'succeeded': return 'success';
      case 'completed': return 'success';
      case 'failed': return 'error';
      case 'error': return 'error';
      case 'imagepullbackoff': return 'error';
      case 'errimagepull': return 'error';
      case 'crashloopbackoff': return 'error';
      case 'not-ready': return 'warning';
      case 'terminating': return 'warning';
      default: return 'processing'; // 其他状态默认为处理中
    }
  };

  const getPodStatusIcon = (status) => {
    switch (status) {
      case 'running': return <CheckCircleOutlined />;
      case 'succeeded': return <CheckCircleOutlined />;
      case 'completed': return <CheckCircleOutlined />;
      case 'failed': return <ExclamationCircleOutlined />;
      case 'error': return <ExclamationCircleOutlined />;
      case 'imagepullbackoff': return <ExclamationCircleOutlined />;
      case 'errimagepull': return <ExclamationCircleOutlined />;
      case 'crashloopbackoff': return <ExclamationCircleOutlined />;
      case 'not-ready': return <ExclamationCircleOutlined />;
      case 'terminating': return <LoadingOutlined />;
      default: return <LoadingOutlined />; // 其他状态默认为加载图标
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

  // RayJob表格列定义
  const rayJobColumns = [
    {
      title: 'Job Name',
      dataIndex: ['metadata', 'name'],
      key: 'name',
      render: (name) => <Text strong>{name}</Text>
    },
    {
      title: 'Job Status',
      dataIndex: ['status', 'jobStatus'],
      key: 'jobStatus',
      render: (status) => {
        const statusConfig = {
          'RUNNING': { color: 'processing', icon: <LoadingOutlined /> },
          'SUCCEEDED': { color: 'success', icon: <CheckCircleOutlined /> },
          'FAILED': { color: 'error', icon: <ExclamationCircleOutlined /> },
          'PENDING': { color: 'warning', icon: <ClockCircleOutlined /> }
        };
        const config = statusConfig[status] || { color: 'default', icon: null };
        return <Tag color={config.color} icon={config.icon}>{status || 'Unknown'}</Tag>;
      }
    },
    {
      title: 'Ray Cluster',
      dataIndex: ['status', 'rayClusterName'],
      key: 'rayClusterName',
      render: (name) => <Text code>{name}</Text>
    },
    {
      title: 'Start Time',
      dataIndex: ['status', 'startTime'],
      key: 'startTime',
      render: (time) => time ? new Date(time).toLocaleString() : 'N/A'
    },
    {
      title: 'Age',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'age',
      render: (timestamp) => {
        if (!timestamp) return 'N/A';
        const age = Date.now() - new Date(timestamp).getTime();
        const minutes = Math.floor(age / 60000);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        return `${minutes}m`;
      }
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => (
        <Popconfirm
          title="Delete RayJob"
          description={`Are you sure you want to delete "${record.metadata.name}"?`}
          onConfirm={() => handleDeleteRayJob(record.metadata.name)}
          okText="Yes"
          cancelText="No"
        >
          <Button
            type="primary"
            danger
            size="small"
            icon={<DeleteOutlined />}
            loading={loading}
          >
            Delete
          </Button>
        </Popconfirm>
      )
    }
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

    if (activeTab === 'rayjobs') {
      return (
        <div>
          {refreshButton}
          <Table
            columns={rayJobColumns}
            dataSource={rayJobs}
            rowKey={(job) => job.metadata.uid}
            size="small"
            pagination={{ pageSize: 10 }}
            loading={loading}
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

      <TabPane 
        tab={
          <Space>
            <ApiOutlined />
            RayJobs
            <Badge count={rayJobs.length} style={{ backgroundColor: '#722ed1' }} />
          </Space>
        } 
        key="rayjobs"
      >
        <div style={{ padding: '16px' }}>
          {!activeTab && (
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginBottom: '16px' 
            }}>
              <div>
                {lastUpdate && (
                  <Text type="secondary" style={{ fontSize: '12px' }}>
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
            columns={rayJobColumns}
            dataSource={rayJobs}
            rowKey={(job) => job.metadata.uid}
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
