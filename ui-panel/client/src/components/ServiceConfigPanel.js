import React, { useState, useEffect } from 'react';
import { 
  Form, 
  Input, 
  Button, 
  Space, 
  Alert,
  Tooltip,
  Typography,
  Checkbox,
  Select,
  Card
} from 'antd';
import { 
  RocketOutlined, 
  InfoCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  GlobalOutlined,
  ThunderboltOutlined,
  LinkOutlined
} from '@ant-design/icons';

const { Option } = Select;

const ServiceConfigPanel = ({ onDeploy, deploymentStatus }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [modelPools, setModelPools] = useState([]);

  // 获取可用的模型池
  const fetchModelPools = async () => {
    try {
      const response = await fetch('/api/deployments');
      const data = await response.json();
      
      // 过滤出模型池类型的部署
      const pools = data.filter(deployment => 
        deployment.deploymentName.includes('-pool') || 
        deployment.deploymentType === 'Model Pool'
      );
      
      setModelPools(pools);
    } catch (error) {
      console.error('Error fetching model pools:', error);
    }
  };

  useEffect(() => {
    fetchModelPools();
  }, []);

  const handleSubmit = async (values) => {
    setLoading(true);
    try {
      await onDeploy(values);
    } catch (error) {
      console.error('Error in service deployment:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusAlert = () => {
    if (!deploymentStatus) return null;
    
    const { status, message } = deploymentStatus;
    
    if (status === 'success') {
      return (
        <Alert
          message="Service Deployment Successful"
          description={message}
          type="success"
          icon={<CheckCircleOutlined />}
          showIcon
          closable
          style={{ marginBottom: 16 }}
        />
      );
    } else if (status === 'error') {
      return (
        <Alert
          message="Service Deployment Failed"
          description={message}
          type="error"
          icon={<ExclamationCircleOutlined />}
          showIcon
          closable
          style={{ marginBottom: 16 }}
        />
      );
    }
    
    return null;
  };

  return (
    <Card 
      title={
        <Space>
          <LinkOutlined />
          Business Service Configuration
        </Space>
      }
      style={{ height: '100%' }}
    >
      {getStatusAlert()}
      
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{
          isExternal: true
        }}
      >
        <Form.Item
          label={
            <Space>
              Service Name
              <Tooltip title="Name for the business service (e.g., production-chat, testing-api)">
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
          name="serviceName"
          rules={[
            { required: true, message: 'Please input service name!' },
            { pattern: /^[a-z0-9-]+$/, message: 'Only lowercase letters, numbers and hyphens allowed' }
          ]}
        >
          <Input 
            placeholder="e.g., production-chat, testing-api"
            style={{ fontFamily: 'monospace' }}
          />
        </Form.Item>

        <Form.Item
          label={
            <Space>
              Model Pool
              <Tooltip title="Select the model pool to connect this service to">
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
          name="modelPool"
          rules={[
            { required: true, message: 'Please select a model pool!' }
          ]}
        >
          <Select 
            placeholder="Select model pool"
            loading={modelPools.length === 0}
          >
            {modelPools.map(pool => (
              <Option key={pool.deploymentName} value={pool.deploymentName}>
                {pool.deploymentName} ({pool.deploymentType})
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          label={
            <Space>
              Business Tag
              <Tooltip title="Business identifier for pod assignment (e.g., production, testing, development)">
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          }
          name="businessTag"
          rules={[
            { required: true, message: 'Please input business tag!' },
            { pattern: /^[a-z0-9-]+$/, message: 'Only lowercase letters, numbers and hyphens allowed' }
          ]}
        >
          <Input 
            placeholder="e.g., production, testing, development"
            style={{ fontFamily: 'monospace' }}
          />
        </Form.Item>

        <Form.Item
          name="isExternal"
          valuePropName="checked"
        >
          <Checkbox>
            <Space>
              <GlobalOutlined />
              <span>External Access</span>
              <Tooltip title="Enable internet-facing LoadBalancer for external access">
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          </Checkbox>
        </Form.Item>

        <Form.Item>
          <Button 
            type="primary" 
            htmlType="submit" 
            loading={loading}
            icon={<RocketOutlined />}
            size="large"
            block
          >
            {loading ? 'Deploying Service...' : 'Deploy Business Service'}
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
};

export default ServiceConfigPanel;
