import React, { useState, useEffect } from 'react';
import { 
  Form, 
  Input,
  Button, 
  Select, 
  Card, 
  Typography, 
  Space,
  Divider,
  Alert,
  message,
  Spin
} from 'antd';
import { 
  SendOutlined, 
  CopyOutlined, 
  ApiOutlined,
  ThunderboltOutlined,
  CodeOutlined,
  LinkOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { CONFIG } from '../config/constants';

const { TextArea } = Input;
const { Option } = Select;
const { Text, Paragraph } = Typography;

const TestPanel = ({ services, onRefresh }) => {
  const [form] = Form.useForm();
  const [curlCommand, setCurlCommand] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [selectedService, setSelectedService] = useState(null);
  const [modelType, setModelType] = useState('ollama'); // 'ollama' or 'vllm'
  const [fetchingModelId, setFetchingModelId] = useState(false); // 正在获取模型ID

  // 过滤出模型相关的服务
  const modelServices = services.filter(service => 
    service.metadata.name.includes('vllm') || 
    service.metadata.name.includes('olm') ||
    service.metadata.name.includes('model') ||
    service.metadata.name.includes('gpt') ||
    service.metadata.name.includes('nlb') ||
    service.spec.type === 'LoadBalancer'
  );

  // 通过API直接获取真实的模型ID
  const fetchRealModelIdFromAPI = async (service) => {
    if (!service) return 'unknown';
    
    const serviceUrl = getServiceUrl(service);
    const modelType = detectModelType(service);
    
    console.log('fetchRealModelIdFromAPI called:', {
      serviceName: service.metadata.name,
      serviceUrl,
      modelType
    });
    
    try {
      let apiPath;
      if (modelType === 'vllm') {
        apiPath = '/v1/models';
      } else if (modelType === 'sglang') {
        apiPath = '/v1/models'; // SGLang也使用OpenAI兼容的API
      } else if (modelType === 'ollama') {
        apiPath = '/api/tags';
      } else {
        console.error('Unknown model type:', modelType);
        return 'unknown';
      }
      
      const fullUrl = `${serviceUrl}${apiPath}`;
      console.log('Calling API through proxy:', fullUrl);
      
      // 通过后端代理调用API
      const response = await fetch('/api/proxy-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: fullUrl,
          method: 'GET' // 指定使用GET方法
        }),
      });
      
      const result = await response.json();
      console.log('Proxy response:', result);
      
      if (result.success) {
        const data = result.data;
        
        if (modelType === 'vllm') {
          // VLLM: 从data.data[0].id获取
          if (data.data && data.data.length > 0) {
            const modelId = data.data[0].id;
            console.log(`VLLM API returned model ID: ${modelId}`);
            return modelId; // 例如: "/s3/Qwen-Qwen3-0.6B"
          }
        } else if (modelType === 'sglang') {
          // SGLang: 也使用OpenAI兼容格式，从data.data[0].id获取
          if (data.data && data.data.length > 0) {
            const modelId = data.data[0].id;
            console.log(`SGLang API returned model ID: ${modelId}`);
            return modelId;
          }
        } else if (modelType === 'ollama') {
          // Ollama: 从data.models[0].name获取
          if (data.models && data.models.length > 0) {
            const modelName = data.models[0].name;
            console.log(`Ollama API returned model name: ${modelName}`);
            return modelName; // 例如: "gpt-oss:20b"
          }
        }
      } else {
        console.error('Proxy request failed:', result.error);
      }
    } catch (error) {
      console.error(`Failed to fetch model ID from API for ${service.metadata.name}:`, error);
    }
    
    // 如果API调用失败，返回unknown
    console.log('Returning unknown due to API failure');
    return 'unknown';
  };

  // 手动刷新服务列表
  const handleRefresh = async () => {
    try {
      setFetchingModelId(true);
      
      // 如果父组件提供了刷新函数，先调用它来刷新服务列表
      if (onRefresh) {
        console.log('Calling parent refresh function...');
        await onRefresh();
      }
      
      // 如果有选中的服务，重新获取其模型ID并更新表单
      if (selectedService) {
        console.log('Refreshing model ID for selected service:', selectedService.metadata.name);
        const detectedType = detectModelType(selectedService);
        await updateFormDefaults(detectedType, selectedService);
        message.success('Services and model information refreshed');
      } else {
        message.success('Services refreshed');
      }
    } catch (error) {
      console.error('Error refreshing:', error);
      message.error('Failed to refresh');
    } finally {
      setFetchingModelId(false);
    }
  };

  // 获取真实的模型ID
  const getRealModelId = async (service) => {
    if (!service) return 'unknown';
    
    console.log('Fetching model ID for:', service.metadata.name);
    return await fetchRealModelIdFromAPI(service);
  };

  // 检测模型类型
  const detectModelType = (service) => {
    if (!service) return 'ollama';
    
    const serviceName = service.metadata.name.toLowerCase();
    
    // 检查服务标签来确定类型
    const labels = service.metadata.labels || {};
    
    // 优先通过model-type标签检测
    if (labels['model-type'] === 'sglang') {
      return 'sglang';
    } else if (labels['model-type'] === 'vllm') {
      return 'vllm';
    } else if (labels['model-type'] === 'ollama') {
      return 'ollama';
    }
    
    // 备用：通过framework标签检测
    if (labels.framework === 'sglang') {
      return 'sglang';
    } else if (labels.framework === 'vllm') {
      return 'vllm';
    } else if (labels.framework === 'ollama') {
      return 'ollama';
    }
    
    // 通过服务名称检测
    if (serviceName.includes('sglang')) {
      return 'sglang';
    } else if (serviceName.includes('vllm')) {
      return 'vllm';
    } else if (serviceName.includes('olm') || serviceName.includes('ollama')) {
      return 'ollama';
    }
    
    // 默认返回vllm（因为大多数部署可能是vllm兼容的）
    return 'vllm';
  };

  useEffect(() => {
    if (modelServices.length > 0 && !selectedService) {
      const firstService = modelServices[0];
      setSelectedService(firstService);
      const detectedType = detectModelType(firstService);
      setModelType(detectedType);
      
      // 根据模型类型设置默认值（异步）
      updateFormDefaults(detectedType, firstService);
    }
  }, [modelServices, selectedService]);

  // 更新表单默认值
  const updateFormDefaults = async (type, service) => {
    setFetchingModelId(true);
    try {
      console.log('updateFormDefaults called with:', { type, serviceName: service?.metadata?.name });
      const realModelId = await getRealModelId(service);
      console.log('Got real model ID:', realModelId);
      
      // 统一使用相同的payload格式，只调整model参数
      form.setFieldsValue({
        apiPath: '/v1/chat/completions',
        payload: JSON.stringify({
          model: realModelId, // 使用真实的模型ID
          system: "You are an AI assistant.",
          messages: [
            {
              role: "user",
              content: "Hello, how are you today?"
            }
          ],
          max_tokens: 100,
          temperature: 0.7
        }, null, 2)
      });
      console.log('Form values updated successfully');
    } catch (error) {
      console.error('Failed to update form defaults:', error);
      message.error('Failed to fetch model information');
    } finally {
      setFetchingModelId(false);
    }
  };

  const getServiceUrl = (service) => {
    if (!service) return '';
    
    // 尝试获取LoadBalancer的外部IP
    const ingress = service.status?.loadBalancer?.ingress?.[0];
    if (ingress) {
      const host = ingress.hostname || ingress.ip;
      const port = service.spec.ports?.[0]?.port || 8000;
      return `http://${host}:${port}`;
    }
    
    // 如果没有外部IP，使用ClusterIP
    const clusterIP = service.spec.clusterIP;
    const port = service.spec.ports?.[0]?.port || 8000;
    return `http://${clusterIP}:${port}`;
  };

  const handleServiceChange = async (serviceName) => {
    const service = modelServices.find(s => s.metadata.name === serviceName);
    setSelectedService(service);
    
    // 检测并设置模型类型
    const detectedType = detectModelType(service);
    setModelType(detectedType);
    
    // 更新表单默认值
    await updateFormDefaults(detectedType, service);
  };

  const generateCurlCommand = async (values) => {
    if (!selectedService) {
      message.error('Please select a service first');
      return;
    }

    setLoading(true);
    try {
      const serviceUrl = getServiceUrl(selectedService);
      const { apiPath, payload } = values;
      
      // 验证JSON payload
      let parsedPayload;
      try {
        parsedPayload = JSON.parse(payload);
      } catch (error) {
        message.error('Invalid JSON format in payload');
        setLoading(false);
        return;
      }

      const fullUrl = `${serviceUrl}${apiPath}`;
      
      const curlCmd = `curl -X POST "${fullUrl}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(parsedPayload, null, 2)}'`;
      
      setCurlCommand(curlCmd);
      
    } catch (error) {
      console.error('Error generating curl command:', error);
      message.error('Failed to generate curl command');
    } finally {
      setLoading(false);
    }
  };

  const testModelDirectly = async (values) => {
    if (!selectedService) {
      message.error('Please select a service first');
      return;
    }

    setTestLoading(true);
    setResponse('');
    
    try {
      const serviceUrl = getServiceUrl(selectedService);
      const { apiPath, payload } = values;
      
      // 验证JSON payload
      let parsedPayload;
      try {
        parsedPayload = JSON.parse(payload);
      } catch (error) {
        message.error('Invalid JSON format in payload');
        setTestLoading(false);
        return;
      }

      const fullUrl = `${serviceUrl}${apiPath}`;
      
      // 通过后端代理请求
      const response = await fetch('/api/proxy-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: fullUrl,
          payload: parsedPayload
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        setResponse(JSON.stringify(result.data, null, 2));
        message.success('Request successful');
      } else {
        setResponse(`Error (${result.status}): ${result.error}\n\nDetails:\n${JSON.stringify(result.data, null, 2)}`);
        message.warning('Request returned an error (see response for details)');
      }
      
    } catch (error) {
      console.error('Error testing model:', error);
      setResponse(`Network Error: ${error.message}`);
      message.error('Failed to test model');
    } finally {
      setTestLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success('Copied to clipboard');
    });
  };

  const getServiceStatus = (service) => {
    if (!service) return 'unknown';
    
    const ingress = service.status?.loadBalancer?.ingress;
    if (ingress && ingress.length > 0) {
      return 'ready';
    }
    
    if (service.spec.type === 'LoadBalancer') {
      return 'pending';
    }
    
    return 'internal';
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'ready': return 'success';
      case 'pending': return 'warning';
      case 'internal': return 'processing';
      default: return 'default';
    }
  };

  return (
    <div>
      {/* 服务选择 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong>
              <ApiOutlined /> Select Model Service
            </Text>
            <Button 
              type="text" 
              icon={<ReloadOutlined />} 
              onClick={handleRefresh}
              loading={fetchingModelId}
              size="small"
              title="Refresh model information"
            >
              Refresh
            </Button>
          </div>
          
          {modelServices.length === 0 ? (
            <Alert
              message="No model services found"
              description="Deploy a model first to see available services"
              type="info"
              showIcon
            />
          ) : (
            <Select
              style={{ width: '100%' }}
              placeholder="Select a service"
              value={selectedService?.metadata.name}
              onChange={handleServiceChange}
            >
              {modelServices.map(service => {
                const serviceType = detectModelType(service);
                return (
                  <Option key={service.metadata.name} value={service.metadata.name}>
                    {service.metadata.name}
                  </Option>
                );
              })}
            </Select>
          )}

          {/* 显示选中服务的URL */}
          {selectedService && (
            <div style={{ marginTop: 8, padding: 8, backgroundColor: '#f6f8fa', borderRadius: 4 }}>
              <Text strong>Base URL: </Text>
              <Text code>{getServiceUrl(selectedService)}</Text>
            </div>
          )}
        </Space>
      </Card>

      {/* 测试表单 */}
      <Spin spinning={fetchingModelId} tip="正在获取模型信息...">
        <Form
          form={form}
          layout="vertical"
          onFinish={generateCurlCommand}
        >
        <Form.Item
          label={
            <Space>
              <LinkOutlined />
              API Path
            </Space>
          }
          name="apiPath"
          rules={[
            { required: true, message: 'Please input API path!' },
            { pattern: /^\//, message: 'API path must start with /' }
          ]}
        >
          <Input 
            placeholder="/api/generate"
            addonBefore="Base URL"
          />
        </Form.Item>

        <Form.Item
          label={
            <Space>
              <CodeOutlined />
              JSON Payload
            </Space>
          }
          name="payload"
          rules={[
            { required: true, message: 'Please input JSON payload!' },
            {
              validator: (_, value) => {
                try {
                  JSON.parse(value);
                  return Promise.resolve();
                } catch (error) {
                  return Promise.reject(new Error('Invalid JSON format'));
                }
              }
            }
          ]}
        >
          <TextArea
            rows={6}
            placeholder="Enter JSON payload here..."
            style={{ fontFamily: 'monospace', fontSize: '13px' }}
          />
        </Form.Item>

        <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#f6f8fa', borderRadius: 6 }}>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: 8 }}>
            <strong>{modelType.toUpperCase()} API示例：</strong>
          </div>
          <div style={{ fontSize: '11px', color: '#888', fontFamily: 'monospace' }}>
            {modelType === 'vllm' ? (
              <>
                /v1/chat/completions - 对话API (OpenAI兼容)<br/>
                /v1/completions - 文本补全API<br/>
                /v1/models - 模型列表 (GET请求)<br/>
                /health - 健康检查<br/>
                <Text style={{ color: '#0066cc', fontSize: '11px' }}>
                  当前模型: {fetchingModelId ? '获取中...' : '请查看JSON payload中的model字段'}
                </Text>
              </>
            ) : modelType === 'sglang' ? (
              <>
                /v1/chat/completions - 对话API (OpenAI兼容)<br/>
                /v1/completions - 文本补全API<br/>
                /v1/models - 模型列表 (GET请求)<br/>
                /health - 健康检查<br/>
                <Text style={{ color: '#0066cc', fontSize: '11px' }}>
                  当前模型: {fetchingModelId ? '获取中...' : '请查看JSON payload中的model字段'}
                </Text>
              </>
            ) : (
              <>
                /v1/chat/completions - 对话API (OpenAI兼容)<br/>
                /api/generate - Prompt文本生成<br/>
                /api/chat - 对话API<br/>
                /api/tags - 模型列表 (GET请求，payload为空)<br/>
                / - 健康检查<br/>
                <Text style={{ color: '#0066cc', fontSize: '11px' }}>
                  当前模型: {fetchingModelId ? '获取中...' : '请查看JSON payload中的model字段'}
                </Text>
              </>
            )}
          </div>
        </div>

        <Space style={{ width: '100%' }} size="middle">
          <Button 
            type="primary" 
            htmlType="submit" 
            loading={loading}
            icon={<ThunderboltOutlined />}
            style={{ flex: 1 }}
            disabled={!selectedService}
          >
            Generate cURL
          </Button>
          
          <Button 
            type="default" 
            loading={testLoading}
            icon={<SendOutlined />}
            style={{ flex: 1 }}
            disabled={!selectedService}
            onClick={() => {
              form.validateFields().then(values => {
                testModelDirectly(values);
              });
            }}
          >
            Test Directly
          </Button>
        </Space>
      </Form>
      </Spin>

      <Divider />

      {/* cURL命令展示 */}
      {curlCommand && (
        <Card 
          title={
            <Space>
              <ThunderboltOutlined />
              Generated cURL Command
            </Space>
          }
          size="small"
          extra={
            <Button 
              size="small" 
              icon={<CopyOutlined />}
              onClick={() => copyToClipboard(curlCommand)}
            >
              Copy
            </Button>
          }
          style={{ marginBottom: 16 }}
        >
          <Paragraph
            code
            copyable
            style={{ 
              backgroundColor: '#f6f8fa', 
              padding: 12, 
              borderRadius: 6,
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}
          >
            {curlCommand}
          </Paragraph>
        </Card>
      )}

      {/* 响应结果展示 */}
      {(response || testLoading) && (
        <Card 
          title={
            <Space>
              <SendOutlined />
              Response
            </Space>
          }
          size="small"
          extra={
            response && (
              <Button 
                size="small" 
                icon={<CopyOutlined />}
                onClick={() => copyToClipboard(response)}
              >
                Copy
              </Button>
            )
          }
        >
          {testLoading ? (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <Spin size="large" />
              <div style={{ marginTop: 16 }}>Testing model...</div>
            </div>
          ) : (
            <pre style={{ 
              backgroundColor: '#f6f8fa', 
              padding: 12, 
              borderRadius: 6,
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: '300px',
              overflow: 'auto'
            }}>
              {response}
            </pre>
          )}
        </Card>
      )}

      {/* 服务状态信息 */}
      {selectedService && (
        <Card 
          title="Service Details" 
          size="small" 
          style={{ marginTop: 16 }}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              <Text strong>Name:</Text> {selectedService.metadata.name}
            </div>
            <div>
              <Text strong>Type:</Text> {selectedService.spec.type}
            </div>
            <div>
              <Text strong>Model Type:</Text> {modelType.toUpperCase()}
            </div>
            <div>
              <Text strong>Model ID:</Text>{' '}
              {fetchingModelId ? (
                <Text type="secondary">
                  <Spin size="small" style={{ marginRight: 8 }} />
                  获取中...
                </Text>
              ) : (
                <Text type="secondary">请查看JSON payload中的model字段</Text>
              )}
            </div>
            <div>
              <Text strong>Status:</Text>{' '}
              <Text type={getStatusColor(getServiceStatus(selectedService))}>
                {getServiceStatus(selectedService)}
              </Text>
            </div>
            <div>
              <Text strong>Labels:</Text>{' '}
              <Space wrap>
                {Object.entries(selectedService.metadata.labels || {}).map(([key, value]) => (
                  <Text key={key} code style={{ fontSize: '11px' }}>
                    {key}={value}
                  </Text>
                ))}
              </Space>
            </div>
            {selectedService.status?.loadBalancer?.ingress?.[0] && (
              <div>
                <Text strong>External Endpoint:</Text>{' '}
                <Text code>
                  {selectedService.status.loadBalancer.ingress[0].hostname || 
                   selectedService.status.loadBalancer.ingress[0].ip}
                </Text>
              </div>
            )}
          </Space>
        </Card>
      )}
    </div>
  );
};

export default TestPanel;
