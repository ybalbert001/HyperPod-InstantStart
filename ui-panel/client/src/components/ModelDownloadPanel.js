import React, { useState } from 'react';
import { Form, Input, Button, Card, Space, Collapse, message, Typography } from 'antd';
import { DownloadOutlined, KeyOutlined, RobotOutlined } from '@ant-design/icons';
import operationRefreshManager from '../hooks/useOperationRefresh';

const { Panel } = Collapse;
const { Text } = Typography;

const ModelDownloadPanel = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const handleDownload = async (values) => {
    try {
      setLoading(true);
      console.log('🚀 Starting model download with values:', values);
      
      const response = await fetch('/api/download-model', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          modelId: values.modelId,
          hfToken: values.hfToken || null,
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        // 🚀 触发操作刷新 - 立即刷新相关组件
        operationRefreshManager.triggerOperationRefresh('model-download', {
          modelId: values.modelId,
          timestamp: new Date().toISOString(),
          source: 'model-download-panel'
        });
        
        console.log('✅ Model download initiated and refresh triggered');
        form.resetFields();
      } else {
        message.error(`Download failed: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Error downloading model:', error);
      message.error('Failed to initiate model download');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '16px' }}>
      <Form
        form={form}
        layout="vertical"
        onFinish={handleDownload}
        autoComplete="off"
      >
        {/* HuggingFace Model ID */}
        <Form.Item
          label={
            <Space>
              <RobotOutlined />
              <Text strong>HuggingFace Model ID</Text>
            </Space>
          }
          name="modelId"
          rules={[
            { required: true, message: 'Please input the HuggingFace model ID!' },
            { 
              pattern: /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/, 
              message: 'Please enter a valid model ID (e.g., microsoft/DialoGPT-medium)' 
            }
          ]}
        >
          <Input
            placeholder="e.g., microsoft/DialoGPT-medium, Qwen/Qwen2.5-7B-Instruct"
            size="large"
            prefix={<RobotOutlined style={{ color: '#1890ff' }} />}
          />
        </Form.Item>

        {/* HuggingFace Token (Collapsible) */}
        <Form.Item label={<Text strong>Authentication (Optional)</Text>}>
          <Collapse 
            ghost 
            onChange={(keys) => setShowToken(keys.length > 0)}
            items={[
              {
                key: 'token',
                label: (
                  <Space>
                    <KeyOutlined />
                    <Text>HuggingFace Token</Text>
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      (Required for private models)
                    </Text>
                  </Space>
                ),
                children: (
                  <Form.Item
                    name="hfToken"
                    style={{ marginBottom: 0 }}
                  >
                    <Input.Password
                      placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      size="large"
                      prefix={<KeyOutlined style={{ color: '#52c41a' }} />}
                    />
                  </Form.Item>
                )
              }
            ]}
          />
        </Form.Item>

        {/* Download Button */}
        <Form.Item style={{ marginTop: '24px' }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            size="large"
            icon={<DownloadOutlined />}
            block
            className="download-btn"
          >
            {loading ? 'Downloading Model...' : 'Start Download'}
          </Button>
        </Form.Item>
      </Form>

      {/* Information Card */}
      <Card 
        size="small" 
        style={{ marginTop: '16px', backgroundColor: '#f6ffed', border: '1px solid #b7eb8f' }}
      >
        <Space direction="vertical" size="small">
          <Text strong style={{ color: '#389e0d' }}>Download Information:</Text>
          <Text style={{ fontSize: '12px' }}>
            • Models will be downloaded to the S3 storage mounted at /s3
          </Text>
          <Text style={{ fontSize: '12px' }}>
            • Large models may take significant time to download
          </Text>
          <Text style={{ fontSize: '12px' }}>
            • Private models require a valid HuggingFace token
          </Text>
          <Text style={{ fontSize: '12px' }}>
            • Check the S3 Storage panel to monitor download progress
          </Text>
        </Space>
      </Card>
    </div>
  );
};

export default ModelDownloadPanel;
