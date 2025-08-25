/**
 * 操作反馈组件
 * 显示用户操作的实时反馈和状态
 */

import React, { useState, useEffect } from 'react';
import { Tag, Space, Typography, Tooltip, Progress } from 'antd';
import { 
  LoadingOutlined, 
  CheckCircleOutlined, 
  ExclamationCircleOutlined,
  ClockCircleOutlined
} from '@ant-design/icons';
import operationRefreshManager from '../hooks/useOperationRefresh';

const { Text } = Typography;

const OperationFeedback = ({ 
  position = 'fixed', 
  style = {},
  maxOperations = 5,
  autoHideDelay = 3000 
}) => {
  const [activeOperations, setActiveOperations] = useState([]);

  useEffect(() => {
    // 监听操作事件
    const handleOperationStart = (data) => {
      const { operationId, operationType, operationData } = data;
      
      setActiveOperations(prev => {
        // 避免重复添加
        if (prev.find(op => op.id === operationId)) {
          return prev;
        }
        
        const newOperation = {
          id: operationId,
          type: operationType,
          data: operationData,
          startTime: Date.now(),
          status: 'running',
          progress: 0
        };
        
        // 限制显示的操作数量
        const updated = [newOperation, ...prev].slice(0, maxOperations);
        return updated;
      });
    };

    const handleOperationComplete = (data) => {
      const { operationId } = data;
      
      setActiveOperations(prev => 
        prev.map(op => 
          op.id === operationId 
            ? { ...op, status: 'completed', progress: 100, endTime: Date.now() }
            : op
        )
      );
      
      // 延迟移除完成的操作
      setTimeout(() => {
        setActiveOperations(prev => prev.filter(op => op.id !== operationId));
      }, autoHideDelay);
    };

    const handleOperationError = (data) => {
      const { operationId, error } = data;
      
      setActiveOperations(prev => 
        prev.map(op => 
          op.id === operationId 
            ? { ...op, status: 'failed', error: error.message, endTime: Date.now() }
            : op
        )
      );
      
      // 延迟移除失败的操作
      setTimeout(() => {
        setActiveOperations(prev => prev.filter(op => op.id !== operationId));
      }, autoHideDelay * 2); // 失败的操作显示更长时间
    };

    // 注册事件监听器
    operationRefreshManager.on('operation-start', handleOperationStart);
    operationRefreshManager.on('operation-complete', handleOperationComplete);
    operationRefreshManager.on('operation-error', handleOperationError);

    return () => {
      operationRefreshManager.off('operation-start', handleOperationStart);
      operationRefreshManager.off('operation-complete', handleOperationComplete);
      operationRefreshManager.off('operation-error', handleOperationError);
    };
  }, [maxOperations, autoHideDelay]);

  // 格式化操作类型显示名称
  const formatOperationType = (type) => {
    const typeMap = {
      'cluster-launch': 'Cluster Launch',
      'cluster-configure': 'Cluster Configure',
      'model-deploy': 'Model Deploy',
      'model-undeploy': 'Model Undeploy',
      'training-start': 'Training Start',
      'training-delete': 'Training Delete'
    };
    return typeMap[type] || type.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // 获取状态图标
  const getStatusIcon = (status) => {
    switch (status) {
      case 'running':
        return <LoadingOutlined spin />;
      case 'completed':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'failed':
        return <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />;
      default:
        return <ClockCircleOutlined />;
    }
  };

  // 获取状态颜色
  const getStatusColor = (status) => {
    switch (status) {
      case 'running':
        return 'processing';
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      default:
        return 'default';
    }
  };

  // 计算操作持续时间
  const getDuration = (operation) => {
    const endTime = operation.endTime || Date.now();
    const duration = endTime - operation.startTime;
    
    if (duration < 1000) {
      return `${duration}ms`;
    } else if (duration < 60000) {
      return `${(duration / 1000).toFixed(1)}s`;
    } else {
      return `${(duration / 60000).toFixed(1)}m`;
    }
  };

  // 如果没有活跃操作，不显示组件
  if (activeOperations.length === 0) {
    return null;
  }

  const containerStyle = {
    ...(position === 'fixed' ? {
      position: 'fixed',
      top: 70,
      right: 20,
      zIndex: 1000
    } : {}),
    ...style
  };

  return (
    <div style={containerStyle}>
      <Space direction="vertical" size="small">
        {activeOperations.map(operation => (
          <div
            key={operation.id}
            style={{
              backgroundColor: 'white',
              border: '1px solid #d9d9d9',
              borderRadius: '6px',
              padding: '8px 12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              minWidth: '200px',
              maxWidth: '300px'
            }}
          >
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              {/* 操作标题和状态 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  {getStatusIcon(operation.status)}
                  <Text strong style={{ fontSize: '12px' }}>
                    {formatOperationType(operation.type)}
                  </Text>
                </Space>
                <Tag 
                  color={getStatusColor(operation.status)} 
                  size="small"
                  style={{ margin: 0, fontSize: '10px' }}
                >
                  {operation.status.toUpperCase()}
                </Tag>
              </div>

              {/* 进度条（仅在运行时显示） */}
              {operation.status === 'running' && (
                <Progress 
                  percent={operation.progress} 
                  size="small" 
                  showInfo={false}
                  strokeColor="#1890ff"
                />
              )}

              {/* 操作详情 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text type="secondary" style={{ fontSize: '10px' }}>
                  Duration: {getDuration(operation)}
                </Text>
                
                {operation.error && (
                  <Tooltip title={operation.error}>
                    <ExclamationCircleOutlined 
                      style={{ color: '#ff4d4f', fontSize: '12px' }} 
                    />
                  </Tooltip>
                )}
              </div>

              {/* 操作数据（如果有的话） */}
              {operation.data && Object.keys(operation.data).length > 0 && (
                <div style={{ fontSize: '10px', color: '#666' }}>
                  {Object.entries(operation.data).slice(0, 2).map(([key, value]) => (
                    <div key={key} style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between',
                      marginTop: '2px'
                    }}>
                      <Text type="secondary">{key}:</Text>
                      <Text type="secondary" style={{ 
                        maxWidth: '100px', 
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {String(value)}
                      </Text>
                    </div>
                  ))}
                </div>
              )}
            </Space>
          </div>
        ))}
      </Space>
    </div>
  );
};

export default OperationFeedback;
