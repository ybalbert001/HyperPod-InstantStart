# EKS集群节点组管理功能规划

## 📋 功能概述

为HyperPod InstantStart UI Panel添加集群节点组管理功能，支持EKS节点组和HyperPod实例组的统一管理。

## 🎯 核心需求

### 1. 显示当前集群节点组状态 ✅
- **EKS节点组**: 显示节点组名称、状态、实例类型、当前/期望节点数
- **HyperPod实例组**: 显示实例组名称、状态、实例类型、当前/目标实例数
- **实时状态更新**: 集成到全局刷新系统

### 2. 节点组规模管理 ✅
- **EKS节点组**: 修改min/max/desired节点数量
- **HyperPod实例组**: 修改target实例数量
- **操作反馈**: WebSocket实时状态更新

### 3. 节点组创建和删除 (Phase 2) 🔄
- **创建EKS节点组**: 配置实例类型、子网、IAM角色等
- **添加HyperPod实例组**: 通过集群更新添加新实例组
- **删除节点组**: 安全删除确认机制

## 🏗️ 技术架构

### API选择: AWS CLI ✅
```bash
# EKS节点组操作
aws eks list-nodegroups --cluster-name {cluster} --region {region}
aws eks describe-nodegroup --cluster-name {cluster} --nodegroup-name {name} --region {region}
aws eks update-nodegroup-config --cluster-name {cluster} --nodegroup-name {name} --scaling-config {...}

# HyperPod集群操作  
aws sagemaker describe-cluster --cluster-name {cluster} --region {region}
aws sagemaker update-cluster --cluster-name {cluster} --instance-groups {...}
```

### 数据结构设计 ✅
```javascript
// API返回格式
{
  "eksNodeGroups": [
    {
      "name": "spot-ng-with-hypd",
      "status": "ACTIVE",
      "instanceTypes": ["m5.large"],
      "scalingConfig": {
        "minSize": 1,
        "maxSize": 2,
        "desiredSize": 1
      },
      "capacityType": "ON_DEMAND",
      "amiType": "AL2023_x86_64_NVIDIA",
      "subnets": ["subnet-09b6268053cfc9263"],
      "nodeRole": "arn:aws:iam::633205212955:role/EKS-NodeRole-..."
    }
  ],
  "hyperPodInstanceGroups": [
    {
      "name": "accelerated-worker-group-1", 
      "status": "InService",
      "instanceType": "ml.g6.12xlarge",
      "currentCount": 1,
      "targetCount": 1,
      "executionRole": "arn:aws:iam::633205212955:role/...-SMHP-Exec-Role-..."
    }
  ]
}
```

## 🎨 UI设计 ✅

### 组件结构
```javascript
// 在ClusterManagement.js中新增标签页
<Tabs>
  <TabPane tab="Cluster Information" key="info">
    <ClusterInfo />
  </TabPane>
  <TabPane tab="Node Groups" key="nodegroups">     // ✅ 已实现
    <NodeGroupManager />
  </TabPane>
  <TabPane tab="Create New Cluster" key="create">
    <CreateCluster />
  </TabPane>
</Tabs>
```

### NodeGroupManager组件设计 ✅
```javascript
<div>
  {/* EKS节点组部分 */}
  <Card title="EKS Node Groups" extra={<Button icon={<ReloadOutlined />}>Refresh</Button>}>
    <Table 
      columns={eksColumns}
      dataSource={eksNodeGroups}
      rowKey="name"
    />
  </Card>

  {/* HyperPod实例组部分 */}
  <Card title="HyperPod Instance Groups" extra={<Button icon={<ReloadOutlined />}>Refresh</Button>}>
    <Table 
      columns={hyperPodColumns} 
      dataSource={hyperPodInstanceGroups}
      rowKey="name"
    />
  </Card>
</div>
```

### 表格列设计 ✅
```javascript
// EKS节点组表格列
const eksColumns = [
  { title: 'Name', dataIndex: 'name', key: 'name' },
  { title: 'Status', dataIndex: 'status', key: 'status', render: renderStatus },
  { title: 'Instance Types', dataIndex: 'instanceTypes', key: 'instanceTypes' },
  { title: 'Capacity', dataIndex: 'capacityType', key: 'capacityType' },
  { title: 'Min/Max/Desired', key: 'scaling', render: renderScaling },
  { title: 'Actions', key: 'actions', render: renderEKSActions }
];

// HyperPod实例组表格列
const hyperPodColumns = [
  { title: 'Name', dataIndex: 'name', key: 'name' },
  { title: 'Status', dataIndex: 'status', key: 'status', render: renderStatus },
  { title: 'Instance Type', dataIndex: 'instanceType', key: 'instanceType' },
  { title: 'Current/Target', key: 'count', render: renderCount },
  { title: 'Actions', key: 'actions', render: renderHyperPodActions }
];
```

## 🔧 API端点设计 ✅

### 后端API
```javascript
// server/index.js 已实现端点
GET    /api/cluster/nodegroups                    // ✅ 获取所有节点组信息
PUT    /api/cluster/nodegroups/:name/scale        // ✅ 更新EKS节点组规模
PUT    /api/cluster/hyperpod/instances/:name/scale // ✅ 更新HyperPod实例数量
POST   /api/cluster/nodegroups                    // 🔄 创建EKS节点组 (Phase 2)
DELETE /api/cluster/nodegroups/:name              // 🔄 删除EKS节点组 (Phase 2)
```

### API实现示例 ✅
```javascript
// 获取节点组信息
app.get('/api/cluster/nodegroups', async (req, res) => {
  try {
    // 读取活跃集群配置
    const ClusterManager = require('./cluster-manager');
    const clusterManager = new ClusterManager();
    const activeClusterName = clusterManager.getActiveCluster();
    
    // 解析init_envs文件获取集群名称和区域
    const configDir = clusterManager.getClusterConfigDir(activeClusterName);
    const initEnvsPath = path.join(configDir, 'init_envs');
    const initEnvsContent = fs.readFileSync(initEnvsPath, 'utf8');
    
    // 调用AWS CLI获取EKS和HyperPod信息
    const eksCmd = `aws eks list-nodegroups --cluster-name ${clusterName} --region ${region}`;
    const hpCmd = `aws sagemaker describe-cluster --cluster-name ${hpClusterName} --region ${region}`;
    
    res.json({
      eksNodeGroups: parseEKSNodeGroups(eksResult),
      hyperPodInstanceGroups: parseHyperPodGroups(hpResult)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

## 🔄 刷新系统集成 ✅

### 全局刷新配置
```javascript
// refreshConfig.js 已更新配置
COMPONENT_PRIORITIES: {
  'nodegroup-manager': 7,  // ✅ 节点组管理优先级
}

OPERATION_REFRESH_CONFIG: {
  'nodegroup-scale': {     // ✅ 节点组规模调整操作
    immediate: ['nodegroup-manager', 'cluster-status', 'pods-services'],
    delayed: [
      { components: ['app-status'], delay: 5000 },
      { components: ['all'], delay: 10000 }
    ]
  }
}
```

### WebSocket消息处理 ✅
```javascript
// App.js 已添加消息处理
case 'nodegroup_updated':
  if (data.status === 'success') {
    message.success(data.message);
    operationRefreshManager.triggerOperationRefresh('nodegroup-scale', data);
  } else {
    message.error(data.message);
  }
  break;
```

## 📁 文件结构 ✅

### 新增文件
```
src/components/
├── NodeGroupManager.js              # ✅ 节点组管理主组件

server/
└── index.js                         # ✅ 新增API端点
```

### 修改文件
```
src/components/ClusterManagement.js  # ✅ 新增Node Groups标签页
src/config/refreshConfig.js         # ✅ 新增刷新配置
src/App.js                          # ✅ 新增WebSocket消息处理
```

## 🚀 实施计划

### Phase 1: 核心功能 ✅ 已完成
- ✅ 显示EKS节点组和HyperPod实例组状态
- ✅ 修改节点/实例数量
- ✅ 实时状态更新和操作反馈
- ✅ 集成到全局刷新系统

### Phase 2: 扩展功能 (优先级: 中) 🔄
- 创建新EKS节点组
- 删除EKS节点组
- 添加新HyperPod实例组
- 高级配置选项 (实例类型、子网等)

### Phase 3: 优化功能 (优先级: 低) 🔄
- 节点组性能监控
- 成本估算显示
- 批量操作支持
- 操作历史记录

## 📊 当前集群状态

**活跃集群**: `eks-cluster-hypd-instrt-0824-p1s`

**EKS节点组**:
- 名称: `spot-ng-with-hypd`
- 状态: ACTIVE
- 规模: 1/2/1 (min/max/desired)
- 实例类型: AL2023_x86_64_NVIDIA
- 容量类型: ON_DEMAND

**HyperPod实例组**:
- 名称: `accelerated-worker-group-1`
- 状态: InService
- 实例类型: ml.g6.12xlarge
- 规模: 1/1 (current/target)

## ✅ API测试结果

```bash
curl http://localhost:3001/api/cluster/nodegroups
```

**返回数据**: ✅ 正常工作
```json
{
  "eksNodeGroups": [
    {
      "name": "spot-ng-with-hypd",
      "status": "ACTIVE",
      "capacityType": "ON_DEMAND",
      "scalingConfig": {"minSize": 1, "maxSize": 2, "desiredSize": 1}
    }
  ],
  "hyperPodInstanceGroups": [
    {
      "name": "accelerated-worker-group-1",
      "status": "InService",
      "instanceType": "ml.g6.12xlarge",
      "currentCount": 1,
      "targetCount": 1
    }
  ]
}
```

## ⚠️ 注意事项

### 权限要求 ✅
- EKS节点组管理需要 `eks:*` 权限 - 当前IAM role已配置
- HyperPod管理需要 `sagemaker:*` 权限 - 当前IAM role已配置

### 安全考虑 ✅
- 节点组删除需要确认对话框 (Phase 2)
- 规模调整需要合理性验证 (0-100范围) - 已实现
- 操作日志记录和审计 - WebSocket通知已实现

### 性能优化 ✅
- 节点组信息缓存机制 - 集成全局刷新系统
- 避免频繁AWS API调用 - 通过刷新管理器控制
- 异步操作状态轮询 - WebSocket实时更新

## 📊 成功指标

- ✅ 用户可以查看所有节点组状态
- ✅ 用户可以方便地调整节点数量 (UI已实现)
- ✅ 操作响应时间 < 3秒 (API测试通过)
- ✅ 状态更新实时性 < 10秒 (刷新系统集成)
- ✅ 错误处理和用户反馈完善 (WebSocket通知)

---

**文档版本**: v1.1  
**创建时间**: 2025-09-13  
**更新时间**: 2025-09-13 07:58  
**负责人**: HyperPod InstantStart Team

**Phase 1 状态**: ✅ 完成 - 基本功能已实现并测试通过  
**下一步**: Phase 2 实施 - 节点组创建和删除功能
