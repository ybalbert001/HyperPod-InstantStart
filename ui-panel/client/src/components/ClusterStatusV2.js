import React, { useState } from 'react';
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

const ClusterStatusV2 = ({ clusterData = [], onRefresh }) => {
  const [loading, setLoading] = useState(false);

  // 计算集群统计信息
  const calculateStats = (nodes) => {
    return nodes.reduce((stats, node) => ({
      totalNodes: stats.totalNodes + 1,
      readyNodes: stats.readyNodes + (node.nodeReady ? 1 : 0),
      totalGPUs: stats.totalGPUs + node.totalGPU,
      usedGPUs: stats.usedGPUs + node.usedGPU,
      availableGPUs: stats.availableGPUs + node.availableGPU,
      allocatableGPUs: stats.allocatableGPUs + node.allocatableGPU,
      errorNodes: stats.errorNodes + (node.error ? 1 : 0)
    }), {
      totalNodes: 0,
      readyNodes: 0,
      totalGPUs: 0,
      usedGPUs: 0,
      availableGPUs: 0,
      allocatableGPUs: 0,
      errorNodes: 0
    });
  };

  const stats = calculateStats(clusterData);

  // 手动刷新
  const handleRefresh = async () => {
    if (!onRefresh) {
      message.error('Refresh function not available');
      return;
    }
    
    setLoading(true);
    try {
      await onRefresh();
      message.success('Cluster status refreshed');
    } catch (error) {
      console.error('Error refreshing cluster status:', error);
      message.error('Failed to refresh cluster status');
    } finally {
      setLoading(false);
    }
  };

  // 表格列定义
  const columns = [
    {
      title: 'Node Name',
      dataIndex: 'nodeName',
      key: 'nodeName',
      render: (text, record) => (
        <Space>
          <ClusterOutlined />
          <span style={{ fontFamily: 'monospace' }}>{text}</span>
          {!record.nodeReady && (
            <Tooltip title="Node not ready">
              <WarningOutlined style={{ color: '#faad14' }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'GPU Usage',
      key: 'gpuUsage',
      render: (_, record) => {
        const { totalGPU, usedGPU, availableGPU, allocatableGPU } = record;
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
          <Col span={6}>
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
          <Col span={6}>
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
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="Used GPUs"
                value={stats.usedGPUs}
                valueStyle={{ color: '#cf1322' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="Available"
                value={stats.availableGPUs}
                valueStyle={{ color: '#52c41a' }}
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
