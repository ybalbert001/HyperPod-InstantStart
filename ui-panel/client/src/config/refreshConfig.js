/**
 * 全局刷新配置文件
 * 定义刷新相关的默认设置和策略
 */

export const REFRESH_CONFIG = {
  // 默认设置
  DEFAULT: {
    autoRefreshEnabled: false,        // 默认关闭自动刷新
    autoRefreshInterval: 60000,       // 自动刷新间隔60秒
    maxConcurrentRefresh: 5,          // 最大并发刷新数
    refreshTimeout: 60000,            // 单个刷新超时60秒
    retryAttempts: 2,                 // 失败重试次数
    showRefreshNotifications: true,   // 显示刷新通知
    enableDebugLogs: process.env.NODE_ENV === 'development' // 开发环境启用调试日志
  },
  
  // 组件优先级配置
  COMPONENT_PRIORITIES: {
    'cluster-management': 10,         // 最高优先级 - 集群管理
    'app-status': 9,                  // 高优先级 - App状态（公共组件）
    'cluster-status': 9,              // 高优先级 - 集群状态（公共组件）
    'pods-services': 8,               // 高优先级 - Pods和Services数据
    'training-monitor': 8,            // 高优先级 - 训练监控
    'deployment-manager': 7,          // 高优先级 - 部署管理
    's3-storage-manager': 6,          // 中高优先级 - S3存储管理
    'training-history': 6,            // 中高优先级 - 训练历史
    'status-monitor': 4,              // 中优先级 - 状态监控（已被app-status替代）
    'config-panel': 2,                // 低优先级 - 配置面板
    'test-components': 1              // 最低优先级 - 测试组件
  },
  
  // 操作触发刷新配置（为第二阶段准备）
  OPERATION_REFRESH: {
    'cluster-launch': {
      immediate: ['cluster-status'],
      delayed: [
        { components: ['cluster-status'], delay: 5000 },
        { components: ['all'], delay: 30000 },
        { components: ['all'], delay: 120000 }
      ]
    },
    'cluster-configure': {
      immediate: ['cluster-status'],
      delayed: [
        { components: ['cluster-status'], delay: 5000 },
        { components: ['all'], delay: 30000 }
      ]
    },
    'model-deploy': {
      immediate: ['deployment-manager', 'status-monitor', 'pods-services'],
      delayed: [
        { components: ['status-monitor', 'cluster-status'], delay: 3000 },
        { components: ['all'], delay: 10000 }
      ]
    },
    'model-undeploy': {
      immediate: ['deployment-manager', 'status-monitor', 'app-status', 'pods-services'],
      delayed: [
        { components: ['cluster-status'], delay: 3000 }, // 等待资源清理完成
        { components: ['all'], delay: 8000 } // 确保所有相关状态更新
      ]
    },
    'model-download': {
      immediate: ['status-monitor', 'app-status', 'pods-services'],
      delayed: [
        { components: ['cluster-status', 'deployment-manager'], delay: 3000 },
        { components: ['all'], delay: 8000 } // 8秒后全局刷新，确保下载完成
      ]
    },
    'training-start': {
      immediate: ['training-monitor', 'status-monitor', 'app-status', 'pods-services'],
      delayed: [
        { components: ['cluster-status'], delay: 5000 },
        { components: ['all'], delay: 10000 } // 10秒后全局刷新，确保训练启动
      ]
    },
    'training-stop': {
      immediate: ['training-monitor', 'status-monitor', 'app-status', 'pods-services'],
      delayed: [
        { components: ['cluster-status'], delay: 3000 },
        { components: ['all'], delay: 5000 }
      ]
    },
    'rayjob-delete': {
      immediate: ['training-monitor', 'training-history', 'status-monitor', 'app-status', 'pods-services'],
      delayed: [
        { components: ['cluster-status'], delay: 5000 },
        { components: ['all'], delay: 10000 }
      ]
    },
    'training-delete': {
      immediate: ['training-monitor', 'training-history', 'status-monitor', 'app-status', 'pods-services'],
      delayed: [
        { components: ['cluster-status'], delay: 5000 }, // 等待K8s资源清理
        { components: ['all'], delay: 10000 } // 确保训练日志和历史记录更新
      ]
    }
  },
  
  // 刷新策略配置
  REFRESH_STRATEGIES: {
    // 立即刷新策略
    IMMEDIATE: {
      timeout: 5000,
      retries: 1
    },
    
    // 标准刷新策略
    STANDARD: {
      timeout: 15000,
      retries: 2
    },
    
    // 深度刷新策略（用于全局刷新）
    DEEP: {
      timeout: 30000,
      retries: 3
    }
  },
  
  // 缓存配置
  CACHE: {
    enabled: true,
    defaultTTL: 30000,                // 默认缓存30秒
    maxSize: 100,                     // 最大缓存条目数
    strategies: {
      'cluster-status': { ttl: 60000 },    // 集群状态缓存1分钟
      'pod-status': { ttl: 30000 },        // Pod状态缓存30秒
      'service-status': { ttl: 60000 },    // Service状态缓存1分钟
      'training-jobs': { ttl: 30000 },     // 训练任务缓存30秒
      'deployment-status': { ttl: 45000 }  // 部署状态缓存45秒
    }
  },
  
  // 用户界面配置
  UI: {
    showRefreshProgress: true,        // 显示刷新进度
    showComponentStatus: true,        // 显示组件状态
    showRefreshStats: true,           // 显示刷新统计
    compactMode: false,               // 紧凑模式
    animationDuration: 300,           // 动画持续时间（毫秒）
    notificationDuration: 3000        // 通知显示时间（毫秒）
  },
  
  // 开发和调试配置
  DEBUG: {
    enablePerformanceLogging: process.env.NODE_ENV === 'development',
    enableRefreshTracing: process.env.NODE_ENV === 'development',
    logRefreshHistory: true,
    maxLogHistory: 100
  }
};

// 环境特定配置覆盖
const ENVIRONMENT_OVERRIDES = {
  development: {
    DEFAULT: {
      showRefreshNotifications: true,
      enableDebugLogs: true
    },
    DEBUG: {
      enablePerformanceLogging: true,
      enableRefreshTracing: true
    }
  },
  
  production: {
    DEFAULT: {
      showRefreshNotifications: false,
      enableDebugLogs: false
    },
    DEBUG: {
      enablePerformanceLogging: false,
      enableRefreshTracing: false
    }
  }
};

// 应用环境特定覆盖
const currentEnv = process.env.NODE_ENV || 'development';
const envOverrides = ENVIRONMENT_OVERRIDES[currentEnv] || {};

// 深度合并配置
const mergeDeep = (target, source) => {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = mergeDeep(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  
  return result;
};

// 导出最终配置
export const FINAL_REFRESH_CONFIG = mergeDeep(REFRESH_CONFIG, envOverrides);

// 便捷访问函数
export const getRefreshConfig = (section = null) => {
  if (section) {
    return FINAL_REFRESH_CONFIG[section] || {};
  }
  return FINAL_REFRESH_CONFIG;
};

export const getComponentPriority = (componentId) => {
  return FINAL_REFRESH_CONFIG.COMPONENT_PRIORITIES[componentId] || 0;
};

export const getOperationRefreshConfig = (operationType = null) => {
  if (operationType) {
    return FINAL_REFRESH_CONFIG.OPERATION_REFRESH[operationType] || null;
  }
  return FINAL_REFRESH_CONFIG.OPERATION_REFRESH;
};

export default FINAL_REFRESH_CONFIG;
