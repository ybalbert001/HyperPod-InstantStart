import React, { useState, useEffect } from 'react';
import { 
  Table, 
  Button, 
  Space, 
  Tag, 
  Popconfirm,
  message,
  Card,
  Tooltip,
  Modal,
  Descriptions,
  Typography,
  Collapse,
  Empty,
  Spin,
  Form,
  Input
} from 'antd';
import { 
  ReloadOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  ExperimentOutlined,
  BarChartOutlined,
  SettingOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const { Text, Title } = Typography;
const { Panel } = Collapse;

const TrainingHistoryPanel = () => {
  const [trainingHistory, setTrainingHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedRun, setSelectedRun] = useState(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [hasInitialLoad, setHasInitialLoad] = useState(false); // 添加初始加载标识
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [mlflowConfig, setMlflowConfig] = useState({
    tracking_uri: 'arn:aws:sagemaker:us-west-2:633205212955:mlflow-tracking-server/pdx-mlflow3'
  });
  const [configForm] = Form.useForm();

  const fetchTrainingHistory = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/training-history');
      const result = await response.json();
      
      if (result.success) {
        setTrainingHistory(result.data || []);
      } else {
        message.error(`Failed to fetch training history: ${result.error}`);
        setTrainingHistory([]);
      }
    } catch (error) {
      console.error('Error fetching training history:', error);
      message.error('Failed to fetch training history');
      setTrainingHistory([]);
    } finally {
      setLoading(false);
      setHasInitialLoad(true); // 标记已经进行过初始加载
    }
  };

  // 使用自动刷新Hook，但不启用自动刷新和立即执行
  const { manualRefresh, config } = useAutoRefresh(
    'training-history',
    fetchTrainingHistory,
    { 
      enabled: false, // 禁用自动刷新
      immediate: false // 不通过hook立即执行
    }
  );

  // 组件挂载时立即加载数据和配置
  useEffect(() => {
    fetchMlflowConfig();
    fetchTrainingHistory();
  }, []); // 空依赖数组，只在组件挂载时执行一次

  // 获取MLflow配置
  const fetchMlflowConfig = async () => {
    try {
      const response = await fetch('/api/mlflow-metric-config');
      const result = await response.json();
      
      if (result.success) {
        setMlflowConfig(result.config);
        configForm.setFieldsValue(result.config);
      }
    } catch (error) {
      console.error('Error fetching MLflow config:', error);
      // 使用默认配置
      const defaultConfig = {
        tracking_uri: 'arn:aws:sagemaker:us-west-2:633205212955:mlflow-tracking-server/pdx-mlflow3'
      };
      setMlflowConfig(defaultConfig);
      configForm.setFieldsValue(defaultConfig);
    }
  };

  // 保存MLflow配置
  const saveMlflowConfig = async (values) => {
    try {
      const response = await fetch('/api/mlflow-metric-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      });
      
      const result = await response.json();
      
      if (result.success) {
        setMlflowConfig(values);
        setConfigModalVisible(false);
        message.success('MLflow configuration saved successfully');
        // 重新获取训练历史数据
        fetchTrainingHistory();
      } else {
        message.error(`Failed to save configuration: ${result.error}`);
      }
    } catch (error) {
      console.error('Error saving MLflow config:', error);
      message.error('Failed to save MLflow configuration');
    }
  };

  // 显示配置Modal
  const showConfigModal = () => {
    configForm.setFieldsValue(mlflowConfig);
    setConfigModalVisible(true);
  };

  // 测试MLflow连接
  const testMlflowConnection = async () => {
    const values = configForm.getFieldsValue();
    
    try {
      const response = await fetch('/api/mlflow-metric-config/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      });
      
      const result = await response.json();
      
      if (result.success) {
        message.success(`Connection successful! Found ${result.experiments_count} experiments.`);
      } else {
        message.error(`Connection failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Error testing MLflow connection:', error);
      message.error('Failed to test MLflow connection');
    }
  };

  const showRunDetails = (record) => {
    setSelectedRun(record);
    setDetailModalVisible(true);
  };

  const getStatusTag = (status) => {
    const statusConfig = {
      'FINISHED': { color: 'success', icon: <CheckCircleOutlined /> },
      'RUNNING': { color: 'processing', icon: <ClockCircleOutlined /> },
      'FAILED': { color: 'error', icon: <CloseOutlined /> },
      'KILLED': { color: 'error', icon: <CloseOutlined /> },
      'SCHEDULED': { color: 'default', icon: <ClockCircleOutlined /> }
    };
    
    const config = statusConfig[status] || { color: 'default', icon: <InfoCircleOutlined /> };
    
    return (
      <Tag color={config.color} icon={config.icon}>
        {status}
      </Tag>
    );
  };

  const formatDuration = (duration) => {
    if (!duration) return 'N/A';
    
    // 解析duration字符串，例如 "0:45:30.123456"
    const parts = duration.split(':');
    if (parts.length >= 3) {
      const hours = parseInt(parts[0]);
      const minutes = parseInt(parts[1]);
      const seconds = parseFloat(parts[2]);
      
      if (hours > 0) {
        return `${hours}h ${minutes}m ${Math.floor(seconds)}s`;
      } else if (minutes > 0) {
        return `${minutes}m ${Math.floor(seconds)}s`;
      } else {
        return `${Math.floor(seconds)}s`;
      }
    }
    
    return duration;
  };

  const formatDateTime = (dateTimeStr) => {
    if (!dateTimeStr) return 'N/A';
    
    try {
      const date = new Date(dateTimeStr);
      return date.toLocaleString();
    } catch (e) {
      return dateTimeStr;
    }
  };

  const formatMetricValue = (value) => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'number') {
      // 对于很小的数值使用科学计数法
      if (value < 0.001 && value > 0) {
        return value.toExponential(3);
      }
      // 对于正常数值保留4位小数
      return value.toFixed(4);
    }
    return value.toString();
  };

  // 格式化标题，为长标题添加换行
  const getFormattedTitle = (tagKey) => {
    const titleMap = {
      'instance_type': 'Instance\nType',
      'replica_count': 'Replica\nCount', 
      'proc_per_node': 'Proc Per\nNode',
      'batch_size': 'Batch\nSize',
      'cutoff_len': 'Cutoff\nLen',
      'deepspeed_conf': 'Zero\nConf'
    };
    
    if (titleMap[tagKey]) {
      return titleMap[tagKey].split('\n').map((line, index) => (
        <div key={index}>{line}</div>
      ));
    }
    
    // 默认格式化：下划线转空格，首字母大写
    return tagKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // 定义我们关心的tag列（基于实际数据）
  const importantTags = [
    'model',
    'dataset', 
    'instance_type',
    'replica_count',
    'proc_per_node',
    'batch_size',
    'cutoff_len',
    'deepspeed_conf'
  ];

  // 动态生成tag列，优先显示重要的tags
  const generateTagColumns = () => {
    if (!trainingHistory || trainingHistory.length === 0) return [];
    
    // 收集所有可能的tag键
    const allTagKeys = new Set();
    trainingHistory.forEach(record => {
      if (record.tags) {
        Object.keys(record.tags).forEach(key => {
          // 过滤掉一些系统内部的tags
          if (!key.startsWith('mlflow.') && key !== 'mlflow.runName') {
            allTagKeys.add(key);
          }
        });
      }
    });
    
    // 按重要性排序：重要的tags在前，其他的按字母顺序
    const sortedTagKeys = [];
    
    // 先添加重要的tags（如果存在）
    importantTags.forEach(tag => {
      if (allTagKeys.has(tag)) {
        sortedTagKeys.push(tag);
        allTagKeys.delete(tag);
      }
    });
    
    // 再添加其他tags（按字母顺序）
    const remainingTags = Array.from(allTagKeys).sort();
    sortedTagKeys.push(...remainingTags);
    
    // 为每个tag创建一列
    return sortedTagKeys.map(tagKey => {
      // 根据tag类型设置不同的列宽
      let width = 100;
      if (tagKey === 'model') width = 140;
      else if (tagKey === 'dataset') width = 120;
      else if (tagKey === 'instance_type') width = 130;
      else if (tagKey === 'deepspeed_conf') width = 120;
      
      return {
        title: (
          <div style={{ textAlign: 'center', lineHeight: '1.2' }}>
            {getFormattedTitle(tagKey)}
          </div>
        ),
        key: `tag_${tagKey}`,
        width: width,
        ellipsis: true,
        render: (_, record) => {
          const tagValue = record.tags?.[tagKey];
          if (!tagValue) {
            return <Text type="secondary">-</Text>;
          }
          
          // 移除instance_type和replica_count的颜色标识，正常显示
          return (
            <Tooltip title={`${tagKey}: ${tagValue}`}>
              <Text>{tagValue}</Text>
            </Tooltip>
          );
        },
      };
    });
  };

  const tagColumns = generateTagColumns();

  const columns = [
    {
      title: 'Experiment',
      dataIndex: 'experiment_name',
      key: 'experiment_name',
      width: 120,
      ellipsis: true,
      render: (text) => (
        <Tooltip title={text}>
          <Text strong>{text}</Text>
        </Tooltip>
      ),
    },
    {
      title: (
        <div style={{ textAlign: 'center', lineHeight: '1.2' }}>
          Run<br/>Name
        </div>
      ),
      dataIndex: 'run_name',
      key: 'run_name',
      width: 150,
      ellipsis: true,
      render: (text) => (
        <Tooltip title={text}>
          <Text>{text}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (status) => getStatusTag(status),
    },
    // 动态插入所有tag列
    ...tagColumns,
    {
      title: (
        <Space>
          <ThunderboltOutlined style={{ color: '#faad14' }} />
          Samples/s
        </Space>
      ),
      key: 'train_samples_per_second',
      width: 90,
      render: (_, record) => {
        const value = record.metrics?.train_samples_per_second;
        if (value === null || value === undefined) {
          return <Text type="secondary">-</Text>;
        }
        
        // 根据样本处理速度设置不同的颜色和样式
        let textColor = '#1890ff'; // 默认蓝色
        let backgroundColor = '#e6f7ff';
        let borderColor = '#91d5ff';
        
        if (value >= 2.0) {
          textColor = '#389e0d'; // 深绿色 - 高效
          backgroundColor = '#f6ffed';
          borderColor = '#b7eb8f';
        } else if (value >= 1.0) {
          textColor = '#d48806'; // 深橙色 - 中等
          backgroundColor = '#fffbe6';
          borderColor = '#ffd666';
        } else if (value < 0.5) {
          textColor = '#cf1322'; // 深红色 - 较慢
          backgroundColor = '#fff2f0';
          borderColor = '#ffadd2';
        }
        
        return (
          <div style={{
            padding: '3px 8px',
            borderRadius: '6px',
            backgroundColor: backgroundColor,
            border: `1px solid ${borderColor}`,
            display: 'inline-block',
            minWidth: '55px',
            textAlign: 'center'
          }}>
            <Text strong style={{ color: textColor, fontSize: '13px' }}>
              {formatMetricValue(value)}
            </Text>
          </div>
        );
      },
    },
    {
      title: 'Steps/s',
      key: 'train_steps_per_second',
      width: 70,
      render: (_, record) => (
        <Text>{formatMetricValue(record.metrics?.train_steps_per_second)}</Text>
      ),
    },
    {
      title: (
        <div style={{ textAlign: 'center', lineHeight: '1.2' }}>
          Start<br/>Time
        </div>
      ),
      dataIndex: 'start_time',
      key: 'start_time',
      width: 130,
      render: (time) => (
        <Text style={{ fontSize: '12px' }}>
          {formatDateTime(time)}
        </Text>
      ),
    },
    {
      title: 'Duration',
      dataIndex: 'duration',
      key: 'duration',
      width: 80,
      render: (duration) => (
        <Text>{formatDuration(duration)}</Text>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      fixed: 'right',
      render: (_, record) => (
        <Button
          icon={<InfoCircleOutlined />}
          onClick={() => showRunDetails(record)}
          size="small"
        >
          Details
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Card
        title={
          <Space>
            <ExperimentOutlined />
            Training History
            {loading && <Spin size="small" />}
          </Space>
        }
        extra={
          <Space>
            <Button
              icon={<SettingOutlined />}
              onClick={showConfigModal}
              title="Configure MLflow Settings"
            >
              Config
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={manualRefresh}
              loading={loading}
            >
              Refresh
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={trainingHistory}
          rowKey="run_id"
          loading={loading && hasInitialLoad} // 只有在已经加载过的情况下才显示表格loading
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => 
              `${range[0]}-${range[1]} of ${total} training runs`,
          }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  loading && !hasInitialLoad ? 
                    "Loading training history from MLflow..." : 
                    (hasInitialLoad ? 
                      "No training history found" : 
                      "Loading training history from MLflow..."
                    )
                }
              />
            ),
          }}
          scroll={{ 
            x: Math.max(1400, 600 + tagColumns.length * 110) // 基础宽度 + 动态tag列宽度
          }}
          components={{
            header: {
              cell: (props) => (
                <th 
                  {...props} 
                  style={{
                    ...props.style,
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    lineHeight: '1.2',
                    padding: '8px 16px',
                    minHeight: '44px'
                  }}
                />
              ),
            },
          }}
        />
      </Card>

      {/* 详情Modal */}
      <Modal
        title={
          <Space>
            <ExperimentOutlined />
            Training Run Details
          </Space>
        }
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setDetailModalVisible(false)}>
            Close
          </Button>
        ]}
        width={800}
      >
        {selectedRun && (
          <div>
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="Experiment" span={2}>
                {selectedRun.experiment_name}
              </Descriptions.Item>
              <Descriptions.Item label="Run Name" span={2}>
                {selectedRun.run_name}
              </Descriptions.Item>
              <Descriptions.Item label="Run ID" span={2}>
                <Text code>{selectedRun.run_id}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                {getStatusTag(selectedRun.status)}
              </Descriptions.Item>
              <Descriptions.Item label="Duration">
                {formatDuration(selectedRun.duration)}
              </Descriptions.Item>
              <Descriptions.Item label="Start Time">
                {formatDateTime(selectedRun.start_time)}
              </Descriptions.Item>
              <Descriptions.Item label="End Time">
                {formatDateTime(selectedRun.end_time)}
              </Descriptions.Item>
            </Descriptions>

            <div style={{ marginTop: 16 }}>
              <Collapse>
                <Panel 
                  header={
                    <Space>
                      <BarChartOutlined />
                      Metrics ({Object.keys(selectedRun.metrics || {}).length})
                    </Space>
                  } 
                  key="metrics"
                >
                  {selectedRun.metrics && Object.keys(selectedRun.metrics).length > 0 ? (
                    <div>
                      {Object.entries(selectedRun.metrics).map(([key, value]) => (
                        <div key={key} style={{ marginBottom: 8 }}>
                          <Text strong>{key}:</Text> {typeof value === 'number' ? value.toFixed(6) : value}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Text type="secondary">No metrics recorded</Text>
                  )}
                </Panel>
                
                <Panel 
                  header={
                    <Space>
                      <SettingOutlined />
                      Parameters ({Object.keys(selectedRun.params || {}).length})
                    </Space>
                  } 
                  key="params"
                >
                  {selectedRun.params && Object.keys(selectedRun.params).length > 0 ? (
                    <div>
                      {Object.entries(selectedRun.params).map(([key, value]) => (
                        <div key={key} style={{ marginBottom: 8 }}>
                          <Text strong>{key}:</Text> <Text code>{value}</Text>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Text type="secondary">No parameters recorded</Text>
                  )}
                </Panel>
                
                {selectedRun.tags && Object.keys(selectedRun.tags).length > 0 && (
                  <Panel 
                    header={
                      <Space>
                        <InfoCircleOutlined />
                        Tags ({Object.keys(selectedRun.tags).length})
                      </Space>
                    } 
                    key="tags"
                  >
                    <div>
                      {Object.entries(selectedRun.tags).map(([key, value]) => (
                        <div key={key} style={{ marginBottom: 8 }}>
                          <Text strong>{key}:</Text> {value}
                        </div>
                      ))}
                    </div>
                  </Panel>
                )}
              </Collapse>
            </div>
          </div>
        )}
      </Modal>

      {/* MLflow配置Modal */}
      <Modal
        title={
          <Space>
            <SettingOutlined />
            MLflow Configuration
          </Space>
        }
        open={configModalVisible}
        onCancel={() => setConfigModalVisible(false)}
        footer={[
          <Button key="test" onClick={testMlflowConnection}>
            Test Connection
          </Button>,
          <Button key="cancel" onClick={() => setConfigModalVisible(false)}>
            Cancel
          </Button>,
          <Button 
            key="save" 
            type="primary" 
            onClick={() => configForm.submit()}
          >
            Save
          </Button>
        ]}
        width={600}
      >
        <Form
          form={configForm}
          layout="vertical"
          onFinish={saveMlflowConfig}
          initialValues={mlflowConfig}
        >
          <Form.Item
            label="MLflow Tracking Server URI"
            name="tracking_uri"
            rules={[
              { required: true, message: 'Please enter the MLflow tracking server URI' },
              { 
                pattern: /^(https?:\/\/|arn:aws:)/,
                message: 'URI must start with http://, https://, or arn:aws:'
              }
            ]}
            extra="Enter the MLflow tracking server URI. For AWS SageMaker, use ARN format."
          >
            <Input.TextArea
              rows={3}
              placeholder="arn:aws:sagemaker:us-west-2:633205212955:mlflow-tracking-server/pdx-mlflow3"
            />
          </Form.Item>
          
          <div style={{ 
            backgroundColor: '#f6ffed', 
            border: '1px solid #b7eb8f', 
            borderRadius: '6px', 
            padding: '12px',
            marginTop: '16px'
          }}>
            <Typography.Text strong style={{ color: '#389e0d' }}>
              💡 Configuration Tips:
            </Typography.Text>
            <ul style={{ marginTop: '8px', marginBottom: '0', color: '#52c41a' }}>
              <li><strong>AWS SageMaker:</strong> Use ARN format starting with "arn:aws:sagemaker:"</li>
              <li><strong>Local MLflow:</strong> Use "http://localhost:5000" or your server URL</li>
              <li><strong>Remote MLflow:</strong> Use "https://your-mlflow-server.com"</li>
            </ul>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default TrainingHistoryPanel;
