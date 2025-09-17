/**
 * 全局刷新按钮组件
 * 提供统一的刷新控制界面
 */

import React, { useState, useEffect } from 'react';
import { 
  Button, 
  Switch, 
  Space, 
  Tooltip, 
  message, 
  Dropdown, 
  Badge,
  Typography,
  Divider,
  Card,
  Statistic,
  Row,
  Col
} from 'antd';
import { 
  ReloadOutlined, 
  InfoCircleOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';
import globalRefreshManager from '../hooks/useGlobalRefresh';

const { Text } = Typography;

const GlobalRefreshButton = ({ style = {} }) => {
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [stats, setStats] = useState({});
  const [componentStatus, setComponentStatus] = useState([]);
  const [lastRefreshResult, setLastRefreshResult] = useState(null);

  // 更新统计信息
  const updateStats = () => {
    try {
      console.log('updateStats called, globalRefreshManager:', globalRefreshManager);
      const refreshStats = globalRefreshManager.getRefreshStats();
      const components = globalRefreshManager.getComponentStatus();
      
      console.log('refreshStats:', refreshStats);
      console.log('components:', components);
      
      setStats(refreshStats);
      setComponentStatus(components);
    } catch (error) {
      console.error('Error in updateStats:', error);
      console.error('globalRefreshManager state:', globalRefreshManager);
    }
  };

  // 初始化和定时更新统计信息
  useEffect(() => {
    updateStats();
    
    const interval = setInterval(updateStats, 5000); // 每5秒更新一次统计
    
    return () => clearInterval(interval);
  }, []);

  // 处理全局刷新
  const handleGlobalRefresh = async () => {
    setLoading(true);
    
    try {
      const result = await globalRefreshManager.triggerGlobalRefresh({
        source: 'manual'
      });
      
      setLastRefreshResult(result);
      
      if (result.success) {
        const successCount = (result.results || []).length;
        const errorCount = (result.errors || []).length;
        
        if (errorCount === 0) {
          message.success(`All ${successCount} components refreshed successfully`);
        } else {
          message.warning(`${successCount} components refreshed, ${errorCount} failed`);
        }
      } else if (result.reason === 'already_refreshing') {
        message.info('Refresh already in progress');
      } else {
        message.error('Global refresh failed');
      }
      
    } catch (error) {
      console.error('Global refresh error:', error);
      message.error(`Refresh failed: ${error.message}`);
    } finally {
      setLoading(false);
      updateStats(); // 立即更新统计信息
    }
  };

  // 处理自动刷新切换
  const handleAutoRefreshToggle = (enabled) => {
    setAutoRefresh(enabled);
    globalRefreshManager.setAutoRefresh(enabled);
    
    message.info(`Auto refresh ${enabled ? 'enabled' : 'disabled'}`);
    updateStats();
  };

  // 格式化时间
  const formatTime = (date) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleTimeString();
  };

  // 格式化持续时间
  const formatDuration = (ms) => {
    if (!ms) return '0ms';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // 创建统计信息下拉菜单
  const createStatsDropdown = () => {
    // 添加安全检查，确保componentStatus是数组
    const safeComponentStatus = Array.isArray(componentStatus) ? componentStatus : [];
    const enabledComponents = safeComponentStatus.filter(c => c.enabled);
    const disabledComponents = safeComponentStatus.filter(c => c.enabled === false);

    return (
      <Card 
        size="small" 
        style={{ width: 400, maxHeight: 500, overflow: 'auto' }}
        title={
          <Space>
            <InfoCircleOutlined />
            <span>Refresh Statistics</span>
          </Space>
        }
      >
        {/* 总体统计 */}
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={8}>
            <Statistic 
              title="Total" 
              value={stats.totalRefreshes || 0} 
              prefix={<ReloadOutlined />}
            />
          </Col>
          <Col span={8}>
            <Statistic 
              title="Success Rate" 
              value={stats.successRate || 0} 
              suffix="%" 
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            />
          </Col>
          <Col span={8}>
            <Statistic 
              title="Avg Duration" 
              value={stats.averageDuration || 0} 
              suffix="ms" 
              prefix={<ClockCircleOutlined />}
            />
          </Col>
        </Row>

        <Divider />

        {/* 组件状态 */}
        <div style={{ marginBottom: 12 }}>
          <Text strong>Active Components ({enabledComponents.length})</Text>
        </div>
        
        {enabledComponents.length > 0 ? (
          <div style={{ marginBottom: 16 }}>
            {enabledComponents.map(component => (
              <div key={component.id} style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                padding: '4px 0',
                borderBottom: '1px solid #f0f0f0'
              }}>
                <Space>
                  <Badge 
                    status="success" 
                    text={component.id} 
                  />
                  <Text type="secondary">({component.priority})</Text>
                </Space>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  {formatTime(component.lastRefresh)}
                </Text>
              </div>
            ))}
          </div>
        ) : (
          <Text type="secondary">No active components</Text>
        )}

        {disabledComponents.length > 0 && (
          <>
            <div style={{ marginBottom: 8 }}>
              <Text strong>Disabled Components ({disabledComponents.length})</Text>
            </div>
            <div style={{ marginBottom: 16 }}>
              {disabledComponents.map(component => (
                <div key={component.id} style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  padding: '4px 0'
                }}>
                  <Badge 
                    status="default" 
                    text={component.id} 
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {/* 最近刷新结果 */}
        {lastRefreshResult && (
          <>
            <Divider />
            <div style={{ marginBottom: 8 }}>
              <Text strong>Last Refresh Result</Text>
            </div>
            <div>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text>Status:</Text>
                  <Badge 
                    status={lastRefreshResult.success ? 'success' : 'error'} 
                    text={lastRefreshResult.success ? 'Success' : 'Failed'} 
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text>Duration:</Text>
                  <Text>{formatDuration(lastRefreshResult.totalDuration)}</Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text>Components:</Text>
                  <Text>{(lastRefreshResult.results || []).length} success, {(lastRefreshResult.errors || []).length} errors</Text>
                </div>
              </Space>
            </div>
          </>
        )}

        {/* 操作按钮 */}
        <Divider />
        <Space style={{ width: '100%', justifyContent: 'center' }}>
          <Button 
            size="small" 
            onClick={() => {
              globalRefreshManager.resetStats();
              updateStats();
              message.success('Statistics reset');
            }}
          >
            Reset Stats
          </Button>
        </Space>
      </Card>
    );
  };

  const dropdownItems = [
    {
      key: 'stats',
      label: createStatsDropdown(),
    }
  ];

  return (
    <div style={{ display: 'flex', alignItems: 'center', ...style }}>
      <Space size="middle">
        {/* 1. 刷新时间 */}
        {stats.lastRefreshTime && (
          <Tooltip title={`Last refresh: ${formatTime(stats.lastRefreshTime)}`}>
            <Text 
              type="secondary" 
              style={{ 
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <ClockCircleOutlined style={{ marginRight: 4 }} />
              {formatTime(stats.lastRefreshTime)}
            </Text>
          </Tooltip>
        )}

        {/* 2. 自动刷新开关 */}
        <Tooltip title="Enable automatic refresh every 60 seconds">
          <Switch
            size="small"
            checkedChildren="Auto"
            unCheckedChildren="Manual"
            checked={autoRefresh}
            onChange={handleAutoRefreshToggle}
            loading={loading}
          />
        </Tooltip>

        {/* 3. 全局刷新按钮（小图标） */}
        <Tooltip title="Refresh all components">
          <Button
            type="default"
            icon={<ReloadOutlined spin={loading} />}
            loading={loading}
            onClick={handleGlobalRefresh}
            size="small"
            style={{ 
              display: 'flex', 
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              padding: 0
            }}
          />
        </Tooltip>

        {/* 4. 统计信息按钮（小图标） */}
        <Dropdown
          menu={{ items: dropdownItems }}
          trigger={['click']}
          placement="bottomRight"
          overlayStyle={{ padding: 0 }}
        >
          <Tooltip title="View refresh statistics">
            <Button
              icon={<InfoCircleOutlined />}
              size="small"
              style={{ 
                display: 'flex', 
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                padding: 0,
                position: 'relative'
              }}
            >
              <Badge 
                count={stats.subscriberCount || 0} 
                size="small" 
                style={{ 
                  backgroundColor: '#52c41a',
                  position: 'absolute',
                  top: '-2px',
                  right: '-2px',
                  fontSize: '10px',
                  minWidth: '16px',
                  height: '16px',
                  lineHeight: '16px'
                }}
              />
            </Button>
          </Tooltip>
        </Dropdown>

        {/* 刷新进行中指示器 */}
        {stats.isRefreshing && (
          <Badge 
            status="processing" 
            text="Refreshing..." 
            style={{ fontSize: '12px' }}
          />
        )}
      </Space>
    </div>
  );
};

export default GlobalRefreshButton;
