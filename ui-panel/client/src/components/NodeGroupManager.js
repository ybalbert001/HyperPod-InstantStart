import React, { useState, useEffect } from 'react';
import { Card, Table, Button, message, Tag, Space, Modal, InputNumber, Form } from 'antd';
import { ReloadOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import globalRefreshManager from '../hooks/useGlobalRefresh';
import operationRefreshManager from '../hooks/useOperationRefresh';

const NodeGroupManager = () => {
  const [loading, setLoading] = useState(false);
  const [eksNodeGroups, setEksNodeGroups] = useState([]);
  const [hyperPodGroups, setHyperPodGroups] = useState([]);
  const [scaleModalVisible, setScaleModalVisible] = useState(false);
  const [scaleTarget, setScaleTarget] = useState(null);
  const [form] = Form.useForm();

  const fetchNodeGroups = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/cluster/nodegroups');
      const data = await response.json();
      
      if (response.ok) {
        setEksNodeGroups(data.eksNodeGroups || []);
        setHyperPodGroups(data.hyperPodInstanceGroups || []);
      } else {
        message.error(`Failed to fetch node groups: ${data.error}`);
      }
    } catch (error) {
      message.error(`Error fetching node groups: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNodeGroups();

    // 注册到全局刷新系统
    globalRefreshManager.subscribe('nodegroup-manager', fetchNodeGroups, {
      priority: 7
    });

    // 注册到操作刷新系统
    operationRefreshManager.subscribe('nodegroup-manager', fetchNodeGroups);

    return () => {
      globalRefreshManager.unsubscribe('nodegroup-manager');
      operationRefreshManager.unsubscribe('nodegroup-manager');
    };
  }, []);

  const renderStatus = (status) => {
    const statusColors = {
      'ACTIVE': 'green',
      'InService': 'green',
      'CREATING': 'blue',
      'UPDATING': 'orange',
      'DELETING': 'red',
      'CREATE_FAILED': 'red',
      'DELETE_FAILED': 'red'
    };
    return <Tag color={statusColors[status] || 'default'}>{status}</Tag>;
  };

  const renderScaling = (record) => {
    const { minSize, maxSize, desiredSize } = record.scalingConfig || {};
    return `${minSize}/${maxSize}/${desiredSize}`;
  };

  const renderCount = (record) => {
    return `${record.currentCount}/${record.targetCount}`;
  };

  const handleScale = (record, type) => {
    setScaleTarget({ ...record, type });
    
    if (type === 'eks') {
      form.setFieldsValue({
        minSize: record.scalingConfig.minSize,
        maxSize: record.scalingConfig.maxSize,
        desiredSize: record.scalingConfig.desiredSize
      });
    } else {
      form.setFieldsValue({
        targetCount: record.targetCount
      });
    }
    
    setScaleModalVisible(true);
  };

  const handleScaleSubmit = async () => {
    try {
      const values = await form.validateFields();
      
      const endpoint = scaleTarget.type === 'eks' 
        ? `/api/cluster/nodegroups/${scaleTarget.name}/scale`
        : `/api/cluster/hyperpod/instances/${scaleTarget.name}/scale`;
      
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });

      if (response.ok) {
        message.success(`${scaleTarget.type === 'eks' ? 'Node group' : 'Instance group'} scaling updated successfully`);
        setScaleModalVisible(false);
        form.resetFields();
        fetchNodeGroups();
      } else {
        const error = await response.json();
        message.error(`Failed to update scaling: ${error.error}`);
      }
    } catch (error) {
      message.error(`Error updating scaling: ${error.message}`);
    }
  };

  const renderEKSActions = (record) => (
    <Space>
      <Button 
        size="small" 
        icon={<EditOutlined />}
        onClick={() => handleScale(record, 'eks')}
      >
        Scale
      </Button>
    </Space>
  );

  const renderHyperPodActions = (record) => (
    <Space>
      <Button 
        size="small" 
        icon={<EditOutlined />}
        onClick={() => handleScale(record, 'hyperpod')}
      >
        Scale
      </Button>
    </Space>
  );

  const eksColumns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Status', dataIndex: 'status', key: 'status', render: renderStatus },
    { title: 'Instance Types', dataIndex: 'instanceTypes', key: 'instanceTypes', render: types => types?.join(', ') },
    { title: 'Capacity', dataIndex: 'capacityType', key: 'capacityType' },
    { title: 'Min/Max/Desired', key: 'scaling', render: renderScaling },
    { title: 'Actions', key: 'actions', render: renderEKSActions }
  ];

  const hyperPodColumns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Status', dataIndex: 'status', key: 'status', render: renderStatus },
    { title: 'Instance Type', dataIndex: 'instanceType', key: 'instanceType' },
    { title: 'Current/Target', key: 'count', render: renderCount },
    { title: 'Actions', key: 'actions', render: renderHyperPodActions }
  ];

  return (
    <div style={{ height: '100%' }}>
      <Card 
        title="HyperPod Instance Groups"
        extra={
          <Button 
            icon={<ReloadOutlined />} 
            onClick={fetchNodeGroups}
            loading={loading}
            size="small"
          >
            Refresh
          </Button>
        }
        style={{ marginBottom: '16px' }}
        size="small"
      >
        <Table 
          columns={hyperPodColumns}
          dataSource={hyperPodGroups}
          rowKey="name"
          loading={loading}
          size="small"
          pagination={false}
        />
      </Card>

      <Card 
        title="EKS Node Groups" 
        extra={
          <Button 
            icon={<ReloadOutlined />} 
            onClick={fetchNodeGroups}
            loading={loading}
            size="small"
          >
            Refresh
          </Button>
        }
        size="small"
      >
        <Table 
          columns={eksColumns}
          dataSource={eksNodeGroups}
          rowKey="name"
          loading={loading}
          size="small"
          pagination={false}
        />
      </Card>

      <Modal
        title={`Scale ${scaleTarget?.type === 'eks' ? 'EKS Node Group' : 'HyperPod Instance Group'}: ${scaleTarget?.name}`}
        open={scaleModalVisible}
        onOk={handleScaleSubmit}
        onCancel={() => {
          setScaleModalVisible(false);
          form.resetFields();
        }}
        okText="Update"
      >
        <Form form={form} layout="vertical">
          {scaleTarget?.type === 'eks' ? (
            <>
              <Form.Item 
                name="minSize" 
                label="Minimum Size"
                rules={[{ required: true, message: 'Please input minimum size' }]}
              >
                <InputNumber min={0} max={100} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item 
                name="maxSize" 
                label="Maximum Size"
                rules={[{ required: true, message: 'Please input maximum size' }]}
              >
                <InputNumber min={1} max={100} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item 
                name="desiredSize" 
                label="Desired Size"
                rules={[{ required: true, message: 'Please input desired size' }]}
              >
                <InputNumber min={0} max={100} style={{ width: '100%' }} />
              </Form.Item>
            </>
          ) : (
            <Form.Item 
              name="targetCount" 
              label="Target Count"
              rules={[{ required: true, message: 'Please input target count' }]}
            >
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
};

export default NodeGroupManager;
