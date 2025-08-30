import React, { useState } from 'react';
import { 
  Form, 
  Input, 
  InputNumber, 
  Button, 
  Space, 
  Alert,
  Divider,
  Tooltip,
  Tabs,
  Collapse,
  Typography,
  Checkbox,
  Row,
  Col,
  Select,
  AutoComplete
} from 'antd';
import { 
  RocketOutlined, 
  InfoCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CodeOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  LinkOutlined,
  GlobalOutlined,
  LockOutlined,
  DockerOutlined
} from '@ant-design/icons';

const { TextArea } = Input;
const { TabPane } = Tabs;
const { Panel } = Collapse;
const { Link } = Typography;

const ConfigPanel = ({ onDeploy, deploymentStatus }) => {
  const [vllmForm] = Form.useForm();
  const [ollamaForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('vllm');
  const [selectedDockerImage, setSelectedDockerImage] = useState('');

  // Docker镜像预设选项
  const dockerImageOptions = [
    {
      value: 'vllm/vllm-openai:latest',
      label: 'vllm/vllm-openai:latest'
    },
    {
      value: 'lmsysorg/sglang:latest',
      label: 'lmsysorg/sglang:latest'
    },
    {
      value: 'vllm/vllm-openai:gptoss',
      label: 'vllm/vllm-openai:gptoss'
    }
  ];

  // 根据Docker镜像获取对应的默认命令
  const getDefaultCommandByImage = (dockerImage) => {
    if (dockerImage.includes('sglang')) {
      return `python3 -m sglang.launch_server \\
--model-path Qwen/Qwen3-0.6B \\
--tp-size 1 \\
--host 0.0.0.0 \\
--port 8000 \\
--trust-remote-code`;
    } else if (dockerImage.includes('gptoss')) {
      return `vllm serve \\
/s3/openai/gpt-oss-120b \\
--tensor-parallel-size 2 \\
--host 0.0.0.0 \\
--port 8000 \\
--trust-remote-code`;
    } else {
      // 默认VLLM serve命令
      return `vllm serve \\
/s3/Qwen-Qwen3-0.6B \\
--max-num-seqs 32 \\
--max-model-len 1280 \\
--tensor-parallel-size 1 \\
--host 0.0.0.0 \\
--port 8000 \\
--trust-remote-code`;
    }
  };

  // 处理Docker镜像选择变化
  const handleDockerImageChange = (value) => {
    setSelectedDockerImage(value);
    const newCommand = getDefaultCommandByImage(value);
    vllmForm.setFieldsValue({ vllmCommand: newCommand });
  };

  // 校验Container Entry命令格式
  const validateVllmCommand = (_, value) => {
    if (!value) {
      return Promise.reject(new Error('Please input entry command!'));
    }

    // 只检查命令是否为空，不限制命令格式
    const cleanCommand = value
      .replace(/\\\s*\n/g, ' ')  // 处理反斜杠换行
      .replace(/\s+/g, ' ')      // 合并多个空格
      .trim();

    if (!cleanCommand) {
      return Promise.reject(new Error('Please input a valid command!'));
    }

    return Promise.resolve();
  };

  // 处理标签切换
  const handleTabChange = (key) => {
    console.log('Tab changed to:', key);
    setActiveTab(key);
  };

  const handleSubmit = async (values) => {
    console.log('handleSubmit called with values:', values);
    console.log('activeTab:', activeTab);
    
    // 对于Ollama部署，过滤掉不需要的字段
    let cleanValues = { ...values };
    if (activeTab === 'ollama') {
      // 移除VLLM特有的字段
      delete cleanValues.dockerImage;
      delete cleanValues.vllmCommand;
    }
    
    console.log('Cleaned values:', cleanValues);
    
    setLoading(true);
    try {
      const deploymentConfig = {
        ...cleanValues,
        deploymentType: activeTab
      };
      
      console.log('deploymentConfig:', deploymentConfig);
      
      // 如果是VLLM部署，从命令中提取模型ID
      if (activeTab === 'vllm' && values.vllmCommand) {
        const modelId = extractModelIdFromVllmCommand(values.vllmCommand);
        if (modelId) {
          deploymentConfig.modelId = modelId;
        }
      }
      
      console.log('Calling onDeploy with config:', deploymentConfig);
      await onDeploy(deploymentConfig);
      console.log('onDeploy completed successfully');
    } catch (error) {
      console.error('Error in handleSubmit:', error);
    } finally {
      setLoading(false);
    }
  };

  // 从VLLM命令中提取模型ID
  const extractModelIdFromVllmCommand = (command) => {
    try {
      // 清理命令字符串
      const cleanCommand = command
        .replace(/\\\s*\n/g, ' ')  // 处理反斜杠换行
        .replace(/\s+/g, ' ')      // 合并多个空格
        .trim();
      
      // 分割为数组
      const parts = cleanCommand.split(' ').filter(part => part.trim());
      
      // 1. 优先检查新的 vllm serve 格式
      // 格式: vllm serve /path/to/model [其他参数]
      const vllmServeIndex = parts.findIndex(part => part === 'serve');
      if (vllmServeIndex !== -1 && vllmServeIndex + 1 < parts.length) {
        // 检查前一个参数是否是 vllm 相关
        if (vllmServeIndex > 0 && parts[vllmServeIndex - 1].includes('vllm')) {
          const modelPath = parts[vllmServeIndex + 1];
          // 确保不是以 -- 开头的参数
          if (!modelPath.startsWith('--')) {
            return modelPath;
          }
        }
      }
      
      // 2. 检查传统的 --model 参数
      const modelIndex = parts.findIndex(part => part === '--model');
      if (modelIndex !== -1 && modelIndex + 1 < parts.length) {
        return parts[modelIndex + 1];
      }
      
      // 3. 检查 --model-path 参数 (SGLang)
      const modelPathIndex = parts.findIndex(part => part === '--model-path');
      if (modelPathIndex !== -1 && modelPathIndex + 1 < parts.length) {
        return parts[modelPathIndex + 1];
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting model ID from VLLM command:', error);
      return null;
    }
  };


  const getStatusAlert = () => {
    if (!deploymentStatus) return null;
    
    const { status, message } = deploymentStatus;
    
    if (status === 'success') {
      return (
        <Alert
          message="Deployment Successful"
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
          message="Deployment Failed"
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

  const defaultVllmCommand = getDefaultCommandByImage('vllm/vllm-openai:latest');

  const VLLMForm = () => (
    <Form
      form={vllmForm}
      layout="vertical"
      onFinish={handleSubmit}
      initialValues={{
        replicas: 1,
        isExternal: true
      }}
    >
      <Form.Item
        label={
          <Space>
            Replicas
            <Tooltip title="Number of model replicas to deploy">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        }
        name="replicas"
        rules={[
          { required: true, message: 'Please input replicas count!' },
          { type: 'number', min: 1, max: 10, message: 'Replicas must be between 1 and 10' }
        ]}
      >
        <InputNumber 
          min={1} 
          max={10} 
          style={{ width: '100%' }}
          placeholder="Number of replicas"
        />
      </Form.Item>

      <Form.Item
        label={
          <Space>
            <DockerOutlined />
            Docker Image
            <Tooltip title="选择预设镜像或输入自定义镜像地址">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        }
        name="dockerImage"
        rules={[{ required: true, message: 'Please select or input docker image!' }]}
      >
        <AutoComplete
          options={dockerImageOptions}
          placeholder="选择预设镜像或输入自定义镜像"
          style={{ fontFamily: 'monospace' }}
          onChange={handleDockerImageChange}
          filterOption={false}
          allowClear
        />
      </Form.Item>

      <Form.Item
        label={
          <Space>
            <CodeOutlined />
            EntryPoint Command
            <Tooltip title="任意EntryPoint及参数，如python3 -m project.main --model HuggingfaceID">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        }
        name="vllmCommand"
        rules={[{ validator: validateVllmCommand }]}
      >
        <TextArea
          rows={8}
          placeholder={defaultVllmCommand}
          style={{ fontFamily: 'monospace', fontSize: '12px' }}
        />
      </Form.Item>

      <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#f0f9ff', borderRadius: 6 }}>
        <div style={{ fontSize: '12px', color: '#0369a1', marginBottom: 8 }}>
          <strong>容器部署说明：</strong>
        </div>
        <div style={{ fontSize: '11px', color: '#0c4a6e' }}>
          • 支持任意EntryPoint及参数，如python3 -m project.main --model HuggingfaceID<br/>
          • 系统会尝试从命令中提取模型信息，部署名称将基于提取的模型ID<br/>
          • 支持vLLM、SGLang及任意自定义容器<br/>
          • 确保命令在容器环境中可执行
        </div>
      </div>

      {/* 部署选项 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Form.Item>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
              icon={<RocketOutlined />}
              size="large"
              block
              className="deploy-btn"
            >
              {loading ? 'Deploying VLLM Model...' : 'Deploy VLLM Model'}
            </Button>
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="isExternal"
            valuePropName="checked"
            style={{ marginTop: 8 }}
          >
            <Checkbox>
              <Space>
                <GlobalOutlined />
                <span>External Access</span>
                <Tooltip title="Enable internet-facing LoadBalancer for external access. Uncheck for internal-only access.">
                  <InfoCircleOutlined />
                </Tooltip>
              </Space>
            </Checkbox>
          </Form.Item>
        </Col>
      </Row>
    </Form>
  );

  const OllamaForm = () => (
    <Form
      form={ollamaForm}
      layout="vertical"
      onFinish={handleSubmit}
      onFinishFailed={(errorInfo) => {
        console.log('Form validation failed:', errorInfo);
      }}
      initialValues={{
        replicas: 1,
        ollamaModelId: 'gpt-oss:20b',
        gpuCount: 1,
        isExternal: true
      }}
    >
      <Form.Item
        label={
          <Space>
            Replicas
            <Tooltip title="Number of model replicas to deploy">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        }
        name="replicas"
        rules={[
          { required: true, message: 'Please input replicas count!' },
          { type: 'number', min: 1, max: 10, message: 'Replicas must be between 1 and 10' }
        ]}
      >
        <InputNumber 
          min={1} 
          max={10} 
          style={{ width: '100%' }}
          placeholder="Number of replicas"
        />
      </Form.Item>

      <Form.Item
        label={
          <Space>
            Ollama Model ID
            <Tooltip title={
              <div>
                The model ID that Ollama will pull and run.<br/>
                <Link href="https://ollama.com/search" target="_blank" rel="noopener noreferrer">
                  <LinkOutlined /> Browse available models at ollama.com/search
                </Link>
              </div>
            }>
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        }
        name="ollamaModelId"
        rules={[{ required: true, message: 'Please input Ollama model ID!' }]}
      >
        <Input
          placeholder="e.g., gpt-oss:20b, llama2:7b, mistral"
          style={{ width: '100%' }}
        />
      </Form.Item>

      <Form.Item
        label={
          <Space>
            GPU Count
            <Tooltip title="Number of GPUs allocated per replica">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        }
        name="gpuCount"
        rules={[
          { required: true, message: 'Please input GPU count!' },
          { type: 'number', min: 1, max: 8, message: 'GPU count must be between 1 and 8' }
        ]}
      >
        <InputNumber 
          min={1} 
          max={8} 
          style={{ width: '100%' }}
          placeholder="Number of GPUs per replica"
        />
      </Form.Item>

      <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#f0f9ff', borderRadius: 6 }}>
        <div style={{ fontSize: '12px', color: '#0369a1', marginBottom: 8 }}>
          <strong>Ollama 部署说明：</strong>
        </div>
        <div style={{ fontSize: '11px', color: '#0c4a6e' }}>
          • Ollama会自动拉取指定的模型<br/>
          • 服务将在端口11434上运行<br/>
          • 支持标准的Ollama API格式<br/>
          • 模型会缓存在持久存储中<br/>
          • 部署名称将基于模型ID自动生成
        </div>
      </div>

      {/* 部署选项 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Form.Item>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
              icon={<ThunderboltOutlined />}
              size="large"
              block
              className="deploy-btn"
              onClick={() => {
                console.log('Deploy button clicked!');
                console.log('Form values:', ollamaForm.getFieldsValue());
              }}
            >
              {loading ? 'Deploying Ollama Model...' : 'Deploy Ollama Model'}
            </Button>
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="isExternal"
            valuePropName="checked"
            style={{ marginTop: 8 }}
          >
            <Checkbox>
              <Space>
                <GlobalOutlined />
                <span>External Access</span>
                <Tooltip title="Enable internet-facing LoadBalancer for external access. Uncheck for internal-only access.">
                  <InfoCircleOutlined />
                </Tooltip>
              </Space>
            </Checkbox>
          </Form.Item>
        </Col>
      </Row>
    </Form>
  );

  return (
    <div>
      {getStatusAlert()}
      
      <Tabs 
        activeKey={activeTab} 
        onChange={handleTabChange}
        type="card"
        size="small"
      >
        <TabPane 
          tab={
            <Space>
              <RocketOutlined />
              Container
            </Space>
          } 
          key="vllm"
        >
          <VLLMForm />
        </TabPane>
        <TabPane 
          tab={
            <Space>
              <ThunderboltOutlined />
              Ollama
            </Space>
          } 
          key="ollama"
        >
          <OllamaForm />
        </TabPane>
      </Tabs>

      <div style={{ marginTop: 16, fontSize: '12px', color: '#666' }}>
        <strong>Note:</strong> 系统会根据选择的部署类型和访问模式生成相应的Kubernetes配置。
        确保EKS集群有足够的GPU资源。
      </div>
    </div>
  );
};

export default ConfigPanel;
