import React, { useState, useEffect } from 'react';
import { 
  Table, 
  Progress, 
  Tag, 
  Button, 
  Space,
  Statistic,
  Row,
  Col,
  Card,
  message,
  Alert,
  Tooltip,
  Spin
} from 'antd';
import { 
  ReloadOutlined, 
  CheckCircleOutlined, 
  ExclamationCircleOutlined,
  ClusterOutlined,
  WarningOutlined
} from '@ant-design/icons';
import globalRefreshManager from '../hooks/useGlobalRefresh';

const ClusterStatusV2 = ({ clusterData = [], onRefresh }) => {
  const [loading, setLoading] = useState(false);

  // 注册到全局刷新管理器
  useEffect(() => {
    const componentId = 'cluster-status';
    
    const refreshFunction = async () => {
      if (onRefresh) {
        await onRefresh();
      }
    };

    globalRefreshManager.subscribe(componentId, refreshFunction, {
      priority: 9 // 高优先级，与app-status相同
    });

    return () => {
      globalRefreshManager.unsubscribe(componentId);
    };
  }, [onRefresh]);

  // 计算集群统计信息
  const calculateStats = (nodes) => {
    return nodes.reduce((stats, node) => ({
      totalNodes: stats.totalNodes + 1,
      readyNodes: stats.readyNodes + (node.nodeReady ? 1 : 0),
      totalGPUs: stats.totalGPUs + node.totalGPU,
      usedGPUs: stats.usedGPUs + node.usedGPU,
      availableGPUs: stats.availableGPUs + node.availableGPU,
      allocatableGPUs: stats.allocatableGPUs + node.allocatableGPU,
      pendingGPUs: stats.pendingGPUs + (node.pendingGPU || 0),
      errorNodes: stats.errorNodes + (node.error ? 1 : 0)
    }), {
      totalNodes: 0,
      readyNodes: 0,
      totalGPUs: 0,
      usedGPUs: 0,
      availableGPUs: 0,
      allocatableGPUs: 0,
      pendingGPUs: 0,
      errorNodes: 0
    });
  };

  const stats = calculateStats(clusterData);

  // 手动刷新 - 适配全局刷新管理器
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
      if (showMessage && !isGlobalRefresh) {
        message.success('Cluster status refreshed');
      }
    } catch (error) {
      console.error('Error refreshing cluster status:', error);
      if (!isGlobalRefresh) {
        message.error('Failed to refresh cluster status');
      }
      throw error; // 重新抛出错误，让全局刷新管理器处理
    } finally {
      if (!isGlobalRefresh) {
        setLoading(false);
      }
    }
  };

  // 表格列定义
  const columns = [
    {
      title: 'Node Name',
      dataIndex: 'nodeName',
      key: 'nodeName',
      render: (text, record) => (
        <div>
          <Space>
            <ClusterOutlined />
            <span style={{ fontFamily: 'monospace' }}>{text}</span>
            {!record.nodeReady && (
              <Tooltip title="Node not ready">
                <WarningOutlined style={{ color: '#faad14' }} />
              </Tooltip>
            )}
          </Space>
          {record.instanceType && record.instanceType !== 'Unknown' && (
            <div style={{ fontSize: '12px', color: '#666', marginTop: 2 }}>
              {record.instanceType}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'GPU Usage',
      key: 'gpuUsage',
      render: (_, record) => {
        const { totalGPU, usedGPU, availableGPU, allocatableGPU, pendingGPU } = record;
        const percentage = totalGPU > 0 ? (usedGPU / totalGPU) * 100 : 0;
        
        return (
          <div>
            <Progress 
              percent={Math.round(percentage)} 
              size="small"
              status={percentage > 80 ? 'exception' : percentage > 60 ? 'active' : 'success'}
              format={() => `${usedGPU}/${totalGPU}`}
            />
            <div style={{ fontSize: '12px', color: '#666', marginTop: 4 }}>
              <Space size="small">
                <span>Available: {availableGPU}</span>
                {allocatableGPU !== totalGPU && (
                  <Tooltip title={`Total capacity: ${totalGPU}, Allocatable: ${allocatableGPU}`}>
                    <span style={{ color: '#1890ff' }}>
                      (Alloc: {allocatableGPU})
                    </span>
                  </Tooltip>
                )}
                {pendingGPU > 0 && (
                  <Tooltip title={`GPU requests from Pending pods (not counted in usage)`}>
                    <span style={{ color: '#faad14' }}>
                      Pending: {pendingGPU}
                    </span>
                  </Tooltip>
                )}
              </Space>
            </div>
          </div>
        );
      },
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, record) => {
        const { totalGPU, availableGPU, error, nodeReady } = record;
        
        if (error) {
          return (
            <Tooltip title={error}>
              <Tag color="red" icon={<ExclamationCircleOutlined />}>
                Error
              </Tag>
            </Tooltip>
          );
        }
        
        if (!nodeReady) {
          return (
            <Tag color="orange" icon={<WarningOutlined />}>
              Not Ready
            </Tag>
          );
        }
        
        if (availableGPU === 0 && totalGPU > 0) {
          return (
            <Tag color="orange" icon={<ExclamationCircleOutlined />}>
              Full
            </Tag>
          );
        }
        
        return (
          <Tag color="green" icon={<CheckCircleOutlined />}>
            Available
          </Tag>
        );
      },
    },
  ];

  return (
    <Spin spinning={loading} tip="Refreshing cluster status...">
      <div>
        {/* 总体统计 */}
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="Nodes"
                value={stats.readyNodes}
                suffix={`/ ${stats.totalNodes}`}
                prefix={<ClusterOutlined />}
                valueStyle={{ 
                  color: stats.readyNodes === stats.totalNodes ? '#52c41a' : '#faad14' 
                }}
              />
              {stats.errorNodes > 0 && (
                <div style={{ fontSize: '12px', color: '#cf1322', marginTop: 4 }}>
                  {stats.errorNodes} error(s)
                </div>
              )}
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="Total GPUs"
                value={stats.totalGPUs}
                valueStyle={{ color: '#1890ff' }}
              />
              {stats.allocatableGPUs !== stats.totalGPUs && (
                <div style={{ fontSize: '12px', color: '#666', marginTop: 4 }}>
                  Allocatable: {stats.allocatableGPUs}
                </div>
              )}
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="Used GPUs"
                value={stats.usedGPUs}
                valueStyle={{ color: '#cf1322' }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="Available GPUs"
                value={stats.availableGPUs}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="Pending GPUs"
                value={stats.pendingGPUs}
                valueStyle={{ color: '#faad14' }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="Total Requests GPUs"
                value={stats.usedGPUs + stats.pendingGPUs}
                valueStyle={{ 
                  color: (stats.usedGPUs + stats.pendingGPUs) > stats.totalGPUs ? '#cf1322' : '#666'
                }}
              />
            </Card>
          </Col>
        </Row>

        {/* 刷新按钮 */}
        <div style={{ 
          marginBottom: 16, 
          display: 'flex', 
          justifyContent: 'flex-end'
        }}>
          <Button 
            icon={<ReloadOutlined />} 
            onClick={handleRefresh}
            loading={loading}
            size="small"
          >
            Refresh
          </Button>
        </div>

        {/* 节点详情表格 */}
        <Table
          columns={columns}
          dataSource={clusterData}
          rowKey="nodeName"
          size="small"
          pagination={false}
          scroll={{ y: 300 }}
          locale={{
            emptyText: loading ? 'Refreshing cluster data...' : 'No cluster data available'
          }}
          rowClassName={(record) => {
            if (record.error) return 'cluster-row-error';
            if (!record.nodeReady) return 'cluster-row-warning';
            return '';
          }}
        />

        <style jsx>{`
          .cluster-row-error {
            background-color: #fff2f0;
          }
          .cluster-row-warning {
            background-color: #fffbe6;
          }
        `}</style>
      </div>
    </Spin>
  );
};

export default ClusterStatusV2;
