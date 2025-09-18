# Model Pool Scheduler 集成设计文档

## 📋 项目概述

将ModelPoolScheduler的动态调度能力集成到HyperPod UI Panel中，实现模型池部署和业务Service的灵活分配管理。

**设计日期**: 2025-09-17  
**版本**: v1.2  
**状态**: Phase 2 已完成，Phase 3 待开始

## 🎯 核心设计理念

### **三层架构设计**
```
1. 模型池部署 (Model Pool Deployment) ✅ 已完成
   ↓
2. 业务Service配置 (Business Service Configuration) ✅ 已完成
   ↓
3. Pod动态分配 (Dynamic Pod Assignment) 🚧 开发中
```

### **设计原则**
- **渐进式集成**: 不破坏现有功能，用户可选择部署模式
- **职责分离**: 模型池部署 → Service配置 → Pod分配，逻辑清晰
- **灵活调度**: 支持动态Pod分配，实现零停机业务切换
- **UI一致性**: 复用现有组件和交互模式

## 🏗️ 系统架构

### **标签体系设计**
```yaml
# Pod标签
labels:
  model: "qwen-06b"           # 模型标识（固定）
  business: "production"      # 业务分配（动态）
  pool-type: "vllm"          # 引擎类型
  deployment-type: "model-pool"

# Service选择器
selector:
  model: "qwen-06b"
  business: "production"
```

### **资源命名规则**
```
模型池: vllm-qwen-06b-pool
业务Service: production-chat-nlb, testing-api-nlb
Pod: vllm-qwen-06b-pool-xxx (business标签动态变化)
```

## 🎨 UI设计方案

### **1. ConfigPanel增强** ✅ 已完成

在现有Model Configuration中添加模型池选项：

```javascript
<Form.Item
  name="deployAsPool"
  valuePropName="checked"
  style={{ marginBottom: 16 }}
>
  <Checkbox>
    <Space>
      <ThunderboltOutlined />
      <span>Deploy as Model Pool</span>
      <Tooltip title="Create a model pool for dynamic service allocation. Pods can be assigned to different services later.">
        <InfoCircleOutlined />
      </Tooltip>
    </Space>
  </Checkbox>
</Form.Item>
```

**实现状态**: ✅ 完成
- 添加了"Deploy as Model Pool"复选框
- 动态按钮文字切换
- 表单验证和提交逻辑

### **2. 配置标签页整合** ✅ 已完成

在Inference页面左侧配置区域内部添加标签页切换：

```javascript
<Card title="Configuration" className="theme-card compute">
  <Tabs 
    activeKey={configTab} 
    onChange={setConfigTab}
    size="small"
    items={[
      {
        key: 'model-config',
        label: 'Model Configuration',
        children: <ConfigPanel />
      },
      {
        key: 'service-config', 
        label: 'Service Configuration',
        children: <ServiceConfigPanel />
      }
    ]}
  />
</Card>
```

**实现状态**: ✅ 完成
- 左侧配置区域内部标签页切换（类似Container/Ollama关系）
- Model Configuration和Service Configuration平行切换
- 右侧TestPanel保持完全不变

### **3. UI设计预览** 🎨 新增

#### **StatusMonitor Pods标签页增强**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Pod Name                         Status    Business         Action          │
├─────────────────────────────────────────────────────────────────────────────┤
│ vllm-model-pool-abc              Running   [production ▼]   ✓              │
│ vllm-model-pool-def              Running   [testing ▼]      ✓              │  
│ vllm-model-pool-ghi              Running   [unassigned ▼]   ✓              │
│ vllm-model-pool-jkl              Running   [unassigned ▼]   ✓              │
│ vllm-standard-xyz                Running   N/A              -              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**关键设计要点**：
- **Pod识别**: `pod.labels.business === 'unassigned'` 且有model标签（不是undefined检查）
- **Business列**: 只对模型池Pod显示下拉选择器，普通Pod显示"N/A"
- **选项来源**: 动态获取业务Service列表 + "unassigned"选项（无硬编码）
- **操作反馈**: 分配成功显示✓，失败显示错误提示

#### **DeploymentManager增强 - 新增Scale功能**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Deployment: vllm-model-pool                                    [Scale ▼]    │
│ Type: Model Pool | Replicas: 4 | Ready: 4                                  │
│ Assignment: production(2) | testing(1) | unassigned(1)                     │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ Target Replicas: [4] [Scale] ⚠️ Can only scale down unassigned pods    │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│ Deployment: vllm-standard-inference                         [Scale ▼]       │
│ Type: Standard | Replicas: 2 | Ready: 2                                    │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ Target Replicas: [2] [Scale]                                            │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

**扩缩容设计要点**：
- **所有Deployment**: 都显示Scale按钮和当前replica信息
- **普通Deployment**: 直接修改replica数量，无限制
- **Pool Deployment**: 
  - Scale Up: 新Pod自动标记`business=unassigned`
  - Scale Down: 只能删除unassigned Pod，显示限制提示
  - 显示Pod分配统计: `production(2) | testing(1) | unassigned(1)`
- **输入验证**: Pool缩容时检查unassigned Pod数量是否足够

#### **扩缩容交互流程**
```
普通Deployment扩缩容:
用户输入目标数量 → 直接执行kubectl scale → 刷新UI

Pool Deployment扩容:
用户输入目标数量 → kubectl scale → 新Pod自动标记business=unassigned → 刷新UI

Pool Deployment缩容:
用户输入目标数量 → 检查unassigned Pod数量 → 
  ✅ 足够: 执行kubectl scale → 刷新UI
  ❌ 不足: 显示错误 "需要X个unassigned Pod，但只有Y个可用"
```

在App Status → Pods标签页中为模型池Pod添加业务分配功能：

```javascript
const PodActionColumn = ({ pod }) => {
  const isPoolPod = pod.labels?.model && pod.labels?.business !== undefined;
  
  if (!isPoolPod) return null;
  
  return (
    <Select 
      value={pod.labels.business}
      onChange={(business) => handlePodAssign(pod.name, business)}
      style={{ width: 120 }}
      placeholder="Assign to..."
    >
      <Option value="unassigned">Unassigned</Option>
      {availableServices.map(service => (
        <Option key={service.businessTag} value={service.businessTag}>
          {service.name}
        </Option>
      ))}
    </Select>
  );
};
```

## 🔧 Phase 3 技术实现详解

### **关键设计原则**

#### **1. Pod标签识别逻辑**
```javascript
// ✅ 正确的模型池Pod识别
const isPoolPod = (pod) => {
  return pod.labels?.model && 
         pod.labels?.business === 'unassigned' && // 注意：检查值为unassigned
         pod.labels?.['deployment-type'] === 'model-pool';
};

// ❌ 错误识别方式
// pod.labels?.business !== undefined  // 会包含已分配的Pod
```

#### **2. 扩缩容安全规则**
```javascript
// Pool Deployment扩缩容逻辑
const scalePoolDeployment = async (deploymentName, targetReplicas) => {
  const currentPods = await getPodsByDeployment(deploymentName);
  const currentReplicas = currentPods.length;
  
  if (targetReplicas > currentReplicas) {
    // Scale Up: 新Pod自动标记为 business: "unassigned"
    return await kubectl.scale(deploymentName, targetReplicas);
  }
  
  if (targetReplicas < currentReplicas) {
    // Scale Down: 只能删除 business: "unassigned" 的Pod
    const unassignedPods = currentPods.filter(p => p.labels.business === 'unassigned');
    const podsToRemove = currentReplicas - targetReplicas;
    
    if (unassignedPods.length < podsToRemove) {
      throw new Error(`Cannot scale down: need ${podsToRemove} unassigned pods, but only ${unassignedPods.length} available`);
    }
    
    return await kubectl.scale(deploymentName, targetReplicas);
  }
};
```

#### **3. 动态业务Service发现**
```javascript
// ✅ 动态获取业务Service，无硬编码
const getBusinessServices = async () => {
  const services = await kubectl.get('services', {
    labelSelector: 'service-type=business-service'
  });
  
  return services.map(svc => ({
    name: svc.metadata.name,
    businessTag: svc.labels.business,
    displayName: svc.labels.business || svc.metadata.name,
    modelName: svc.labels.model
  }));
};

// ❌ 避免硬编码业务标签
// const businessOptions = ['biz-a', 'biz-b']; // 不要这样做
```

### **API端点设计**

#### **1. Pod分配管理**
```javascript
// Pod标签修改
POST /api/assign-pod
Body: { 
  podName: string,
  businessTag: string,  // "unassigned" | 动态业务标签
  modelName: string     // 用于验证
}

// 业务Service列表
GET /api/business-services
Response: [{
  name: "service-a-nlb",
  businessTag: "production", 
  displayName: "Production Service",
  modelName: "qwen-model-pool"
}]
```

#### **2. Pool扩缩容管理**
```javascript
// 普通Deployment扩缩容
POST /api/scale-deployment
Body: {
  deploymentName: string,
  targetReplicas: number
}
Response: {
  success: boolean,
  currentReplicas: number,
  targetReplicas: number
}

// Pool智能扩缩容
POST /api/scale-pool-deployment
Body: {
  deploymentName: string,
  targetReplicas: number
}
Response: {
  success: boolean,
  currentReplicas: number,
  targetReplicas: number,
  unassignedPods: number,
  error?: string  // 缩容时unassigned Pod不足的错误信息
}
```

#### **3. Pool状态监控**
```javascript
// 模型池状态统计
GET /api/pool-status/:deploymentName
Response: {
  totalPods: number,
  podDistribution: {
    "unassigned": 2,
    "production": 1,
    "testing": 1
  },
  availableForScaleDown: number  // unassigned Pod数量
}
```

### **UI组件设计**

#### **1. StatusMonitor Pods标签页增强**
```javascript
const PodBusinessSelector = ({ pod, businessServices }) => {
  if (!isPoolPod(pod)) return <span>-</span>;
  
  return (
    <Select 
      value={pod.labels.business}
      onChange={(business) => handlePodAssign(pod.metadata.name, business)}
      style={{ width: 140 }}
      size="small"
    >
      <Option value="unassigned">
        <Text type="secondary">Unassigned</Text>
      </Option>
      {businessServices.map(svc => (
        <Option key={svc.businessTag} value={svc.businessTag}>
          <Text>{svc.displayName}</Text>
        </Option>
      ))}
    </Select>
  );
};
```

#### **2. DeploymentManager扩缩容增强**
```javascript
const DeploymentScaleButton = ({ deployment, isPool }) => {
  const handleScale = async (newReplicas) => {
    if (isPool) {
      // Pool特殊逻辑：检查unassigned Pod数量
      const result = await scalePoolDeployment(deployment.name, newReplicas);
      if (!result.success) {
        message.error(result.error);
        return;
      }
    } else {
      // 普通Deployment直接scale
      await scaleDeployment(deployment.name, newReplicas);
    }
    
    // 触发刷新
    operationRefreshManager.triggerOperationRefresh('deployment-scale');
  };

  return (
    <Space>
      <InputNumber 
        min={0} 
        max={20} 
        defaultValue={deployment.replicas}
        onPressEnter={(e) => handleScale(parseInt(e.target.value))}
      />
      <Button size="small" onClick={() => handleScale(inputValue)}>
        Scale
      </Button>
      {isPool && (
        <Tooltip title="Pool deployments can only scale down unassigned pods">
          <InfoCircleOutlined />
        </Tooltip>
      )}
    </Space>
  );
};
```

#### **3. Pool统计显示**
```javascript
const PoolStatsDisplay = ({ deployment, poolStats }) => {
  if (!deployment.isPool) return null;
  
  return (
    <div style={{ marginTop: 8 }}>
      <Text type="secondary">Pod Assignment: </Text>
      {Object.entries(poolStats.podDistribution).map(([business, count]) => (
        <Tag key={business} color={business === 'unassigned' ? 'default' : 'blue'}>
          {business}: {count}
        </Tag>
      ))}
      <Text type="secondary" style={{ marginLeft: 8 }}>
        (Available for scale-down: {poolStats.availableForScaleDown})
      </Text>
    </div>
  );
};
```

### **1. 模板文件** ✅ 已完成

#### **模型池模板 (vllm-sglang-model-pool-template.yaml)**
```yaml
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: SERVENGINE-MODEL_TAG-pool
  labels:
    model: "MODEL_TAG"
spec:
  replicas: REPLICAS_COUNT
  selector:
    matchLabels:
      model: "MODEL_TAG"
  template:
    metadata:
      labels:
        model: "MODEL_TAG"
        business: "unassigned"
    spec:
      # ... 容器配置同现有模板
```

#### **业务Service模板 (business-service-template.yaml)** ✅ 已完成
```yaml
---
apiVersion: v1
kind: Service
metadata:
  name: SERVICE_NAME-nlb
  labels:
    business: "BUSINESS_TAG"
    model: "MODEL_NAME"
    service-type: "business-service"
  annotations:NLB_ANNOTATIONS
spec:
  selector:
    model: "MODEL_NAME"
    business: "BUSINESS_TAG"
  type: LoadBalancer
  ports:
    - port: 8000
      protocol: TCP
      targetPort: http
```

### **2. API端点设计** 

```javascript
// 模型池管理 ✅ 已完成
POST /api/deploy               // 支持deployAsPool参数
GET  /api/deployments          // 显示所有部署（包括模型池）

// 业务Service管理 ✅ 已完成
POST /api/deploy-service       // 部署业务Service
GET  /api/business-services    // 获取业务Service列表（❌ 待实现）

// Pod分配管理 ❌ 待实现
POST /api/assign-pod           // 分配Pod到业务
POST /api/distribute-pods      // 按比例分配Pod
GET  /api/pool-status/:model   // 获取模型池状态
```

### **3. 后端实现要点** ✅ 已完成

#### **部署逻辑修改**
```javascript
// server/index.js - /api/deploy 修改
app.post('/api/deploy', async (req, res) => {
  const { deployAsPool, ...otherConfig } = req.body;
  
  if (deployAsPool) {
    // 使用模型池模板，不创建Service
    templatePath = path.join(__dirname, '../templates/vllm-sglang-model-pool-template.yaml');
  } else {
    // 使用标准模板，创建Service
    templatePath = path.join(__dirname, '../templates/vllm-sglang-template.yaml');
  }
  
  // ... 模板处理逻辑
});
```

#### **Service部署API** ✅ 已完成
```javascript
app.post('/api/deploy-service', async (req, res) => {
  const { serviceName, modelPool, businessTag, isExternal } = req.body;
  
  // 从模型池名称提取模型名称
  let modelName = modelPool.replace('-pool', '');
  
  // 生成Service YAML并部署
  // ...
});
```

## 📊 数据流设计

### **1. 模型池部署流程** ✅ 已完成
```
用户勾选"Deploy as Pool" → 
ConfigPanel提交 → 
后端选择model-pool-template → 
创建Deployment（无Service） → 
Pod启动，business=unassigned
```

### **2. 业务Service创建流程** ✅ 已完成
```
ServiceConfigPanel配置 → 
选择目标模型池 → 
指定业务标签 → 
创建Service（selector: model + business）
```

### **3. Pod分配流程** ❌ 待实现
```
StatusMonitor显示模型池Pod → 
用户选择业务Service → 
修改Pod的business标签 → 
流量自动路由到对应Service
```

## 🎯 实现进度

### **Phase 1: 基础模型池功能** ✅ 已完成
- [x] 修改ConfigPanel添加"Deploy as Pool"选项
- [x] 创建模型池模板文件 (`vllm-sglang-model-pool-template.yaml`)
- [x] 修改后端API支持模型池部署
- [x] 更新DeploymentManager显示模型池

### **Phase 2: Service配置功能** ✅ 已完成
- [x] 创建ServiceConfigPanel组件
- [x] 创建业务Service模板 (`business-service-template.yaml`)
- [x] 实现业务Service部署API (`/api/deploy-service`)
- [x] 在Inference左侧配置区域添加内部标签页切换
- [x] 实现Model Configuration和Service Configuration平行切换

### **Phase 3: 动态调度功能** 🚧 开发中
#### **Phase 3A: Pod分配核心功能**
- [ ] 实现Pod标签修改API (`/api/assign-pod`)
- [ ] 实现业务Service列表API (`/api/business-services`) 
- [ ] 在StatusMonitor Pods标签页添加Pod分配UI
- [ ] 集成到全局刷新系统

#### **Phase 3B: 扩缩容和统计增强**
- [ ] 在DeploymentManager中添加Scale按钮（所有Deployment类型）
- [ ] 实现普通Deployment扩缩容API (`/api/scale-deployment`)
- [ ] 实现Pool Deployment智能扩缩容API (`/api/scale-pool-deployment`)
- [ ] 添加Pool Deployment Pod分配统计显示
- [ ] 添加模型池状态监控API (`/api/pool-status/:deploymentName`)
- [ ] 扩缩容操作的错误处理和用户提示

### **Phase 4: 增强功能** 📋 计划中
- [ ] 批量Pod分配（按比例）
- [ ] 模型池调度历史
- [ ] 性能监控和负载均衡
- [ ] 拖拽式Pod分配界面

## 🔍 关键技术点

### **1. 标签选择器匹配** ✅ 已验证
确保Service的selector能正确匹配到分配的Pod：
```yaml
Service selector: { model: "qwen-06b", business: "production" }
Pod labels: { model: "qwen-06b", business: "production" }  # 匹配 ✅
Pod labels: { model: "qwen-06b", business: "testing" }     # 不匹配 ❌
```

### **2. 零停机切换** ❌ 待验证
Pod标签修改是原子操作，流量路由立即生效：
```bash
kubectl label pod qwen-06b-pool-xxx business=production --overwrite
```

### **3. 状态同步** ❌ 待集成
- WebSocket通知Pod分配变化
- 全局刷新系统自动更新UI
- 操作刷新确保状态一致性

## 🛠️ 模板标签修改指南 (2025-09-18)

### **标签分类与修改规则**

#### **🔒 不能修改的标签（代码硬编码识别）**

**Model Pool Template**:
```yaml
deployment-type: "model-pool"  # ❌ 硬编码在 StatusMonitor.js:70 和 ServiceConfigPanel.js:41
model-type: "model-pool"       # ❌ 硬编码在 server/index.js:2791,3017
```

**Business Service Template**:
```yaml
service-type: "business-service"  # ❌ 硬编码在 server/index.js:2969
```

#### **🔄 动态分配的标签（运行时会改变）**

**Model Pool Pod 标签**:
```yaml
business: "unassigned"  # ✅ 初始值，运行时会动态改为 "biz-a", "biz-b" 等
```

**说明**: `business`标签是整个系统的核心，Pod分配功能就是通过修改这个标签值来实现动态调度的。

#### **🔄 必须配对修改的标签键名**

**关键匹配对**：
```yaml
# Model Pool Pod 标签 ↔ Service Selector
model: "MODEL_TAG"     # 键名必须一致，值会自动匹配
business: "BUSINESS_TAG"  # 键名必须一致，值会动态分配
```

**修改规则**：
- 如果要修改`model`标签的**键名**（如改为`model-name`），必须同时修改Service selector
- 如果要修改`business`标签的**键名**（如改为`business-unit`），必须同时修改Service selector
- 标签的**值**会由系统自动处理，不需要手动修改

#### **✅ 可以自由修改的标签**

**Model Pool Template**:
```yaml
# Deployment metadata labels (不影响功能)
model: "MODEL_TAG"  # 可改键名，但需配对修改Service
# 可添加自定义标签
team: "ai-team"
version: "v1.0"
environment: "production"
owner: "data-science-team"
```

**Business Service Template**:
```yaml
# Service metadata labels (仅用于标识，不影响Pod匹配)
business: "BUSINESS_TAG"  # 仅用于标识
model: "MODEL_NAME"       # 仅用于标识
# 可添加自定义标签
team: "ai-team"
cost-center: "ml-ops"
```

### **动态标签分配流程**

**Pod生命周期中的标签变化**：
```yaml
# 1. 初始部署时
labels:
  model: "vllm-qwen-2025-09-18-00-29-55"
  business: "unassigned"  # 初始状态
  deployment-type: "model-pool"

# 2. 分配给业务A后
labels:
  model: "vllm-qwen-2025-09-18-00-29-55"  # 不变
  business: "biz-a"  # 动态改变
  deployment-type: "model-pool"  # 不变

# 3. 重新分配给业务B
labels:
  model: "vllm-qwen-2025-09-18-00-29-55"  # 不变
  business: "biz-b"  # 再次改变
  deployment-type: "model-pool"  # 不变
```

**Service匹配逻辑**：
```yaml
# Service A 只匹配分配给它的Pod
selector:
  model: "vllm-qwen-2025-09-18-00-29-55"
  business: "biz-a"  # 只匹配 business="biz-a" 的Pod

# Service B 只匹配分配给它的Pod  
selector:
  model: "vllm-qwen-2025-09-18-00-29-55"
  business: "biz-b"  # 只匹配 business="biz-b" 的Pod
```

### **修改注意事项**

1. **代码同步**：修改标签键名时，需要同步修改：
   - `StatusMonitor.js` - Pod识别逻辑
   - `ServiceConfigPanel.js` - 模型池过滤逻辑
   - `server/index.js` - 业务Service过滤逻辑

2. **测试验证**：修改后需要验证：
   - Pod分配功能正常
   - Service能正确显示Pod数量
   - 模型池识别正确

3. **向后兼容**：修改标签可能影响现有部署，建议逐步迁移

### **安全修改示例**

**场景**: 将`business`标签键名改为`business-unit`

**步骤1**: 修改模型池模板
```yaml
# vllm-sglang-model-pool-template.yaml
template:
  metadata:
    labels:
      model: "MODEL_TAG"
      business-unit: "unassigned"  # 改键名
      deployment-type: "model-pool"
```

**步骤2**: 修改Service模板
```yaml
# business-service-template.yaml
spec:
  selector:
    model: "MODEL_NAME"
    business-unit: "BUSINESS_TAG"  # 改键名
```

**步骤3**: 修改代码中的硬编码引用
```javascript
// StatusMonitor.js
const isPoolPod = (pod) => {
  const labels = pod.metadata?.labels || {};
  return labels.model && 
         labels['business-unit'] !== undefined &&  // 改键名
         labels['deployment-type'] === 'model-pool';
};

// Pod分配时的标签键名
const currentBusiness = pod.metadata.labels?.['business-unit'] || 'unassigned';
```

**步骤4**: 更新Pod分配API
```javascript
// server/index.js - /api/assign-pod
const labelCommand = `kubectl label pod ${podName} business-unit=${businessTag} --overwrite`;
```

### **标签匹配逻辑验证**

**正确的匹配流程**：
```
1. 模型池部署 → Pod标签: {model: "deployment-name", business: "unassigned"}
2. Service部署 → Selector: {model: "deployment-name", business: "business-tag"}
3. Pod分配 → Pod标签: {model: "deployment-name", business: "business-tag"}
4. Service匹配 → 显示Pod数量: 1
```

---

## 🚨 开发过程中的注意事项

### **1. 向后兼容性** ✅ 已确保
- 保持现有标准部署功能不变
- 新功能作为可选增强，不影响现有用户
- 模型池选项默认为false

### **2. 代码重复声明问题** ⚠️ 已解决
**问题**: 在App.js中重复声明handleServiceDeploy函数导致编译错误
**解决**: 删除重复声明，确保函数只定义一次
**教训**: 大文件修改时需要仔细检查是否有重复代码

### **5. 标签匹配问题修复** ✅ 已解决 (2025-09-18)
**问题**: Service无法正确显示其关联的Pod数量
**原因**: 
1. 模型池模板中Pod的`business`标签值不一致（`unassigned` vs `"unassigned"`）
2. Service部署时模型名称提取逻辑错误
3. 模板中deployment命名不一致

**解决方案**:
1. **模板修复**:
   ```yaml
   # 修复前
   business: unassigned          # 无引号
   name: SERVENGINE-MODEL_TAG-pool  # 包含-pool后缀
   
   # 修复后  
   business: "unassigned"        # 有引号，确保字符串类型
   name: SERVENGINE-MODEL_TAG    # 移除-pool后缀
   ```

2. **代码修复**:
   ```javascript
   // 修复前：错误地移除-pool后缀
   let modelName = modelPool.replace('-pool', '');
   
   // 修复后：直接使用modelPool作为modelName
   const modelName = modelPool;
   ```

**验证方法**:
```bash
# 检查Pod标签
kubectl get pods -o jsonpath='{.items[*].metadata.labels}'

# 检查Service selector
kubectl get service -o jsonpath='{.items[*].spec.selector}'

# 验证匹配
kubectl get pods -l model="deployment-name",business="business-tag"
```

### **6. Pod分配功能实现** ✅ 已完成 (2025-09-18)
**功能**: 在StatusMonitor的Pods标签页中为模型池Pod添加业务分配下拉选择器

**实现要点**:
1. **Pod识别逻辑**:
   ```javascript
   const isPoolPod = (pod) => {
     const labels = pod.metadata?.labels || {};
     return labels.model && 
            labels.business !== undefined &&
            labels['deployment-type'] === 'model-pool';
   };
   ```

2. **动态业务Service获取**:
   ```javascript
   // 通过API动态获取，无硬编码
   const businessServices = await fetch('/api/business-services');
   ```

3. **Pod分配API**:
   ```javascript
   POST /api/assign-pod
   Body: { podName, businessTag, modelName }
   // 使用 kubectl label pod {podName} business={businessTag} --overwrite
   ```

**UI特性**:
- 只对模型池Pod显示分配下拉选择器
- 普通Pod显示"N/A"
- 支持"unassigned"选项
- 分配过程中显示loading状态
**问题**: 初始设计将配置功能放在页面级别的子标签页，导致右侧TestPanel重新渲染
**解决**: 改为左侧配置区域内部的标签页切换，右侧TestPanel保持稳定
**优势**: 
- 避免了TestPanel的重新渲染和状态重置
- 配置逻辑更集中，用户体验更流畅
- 类似Container/Ollama的交互模式，用户更容易理解
**问题**: 原有白名单过滤机制不适合显示所有部署
**解决**: 移除名称过滤，显示所有Deployment
**优势**: 用户可以看到完整的集群状态

### **4. 模板文件路径** ✅ 已确认
- 模型池模板: `templates/vllm-sglang-model-pool-template.yaml`
- 业务Service模板: `templates/business-service-template.yaml`
- 部署文件保存: `deployments/` 目录

### **5. API命名约定** ✅ 已统一
- 模型部署: `/api/deploy` (支持deployAsPool参数)
- Service部署: `/api/deploy-service`
- WebSocket消息: `deployment` 和 `service_deployment`

## 📈 测试验证

### **已测试功能** ✅
1. **模型池部署**: 勾选"Deploy as Pool"成功创建仅包含Deployment的资源
2. **Service配置**: ServiceConfigPanel能正确获取模型池列表并配置Service
3. **UI集成**: 子标签页切换正常，组件间通信正常

### **待测试功能** ❌ 全部待测试
1. **Pod标签修改**: kubectl label命令的执行和效果
2. **流量路由**: Service selector变化后的流量分配
3. **状态同步**: Pod分配后UI状态的实时更新

## 🔄 下一步开发计划

### **立即任务 (Phase 3A - 核心Pod分配功能)**

#### **1. Pod分配API实现** 
```javascript
POST /api/assign-pod
Body: { podName, businessTag, modelName }
功能: 使用 kubectl label pod {podName} business={businessTag} --overwrite
```

#### **2. 业务Service列表API实现**
```javascript
GET /api/business-services  
功能: 动态获取所有 service-type=business-service 的Service
返回: [{ name, businessTag, displayName, modelName }]
```

#### **3. StatusMonitor Pods标签页增强**
- 为模型池Pod添加业务分配下拉选择器
- 识别逻辑: `pod.labels.business === 'unassigned'` 且有model标签
- 选项来源: 动态获取的业务Service列表

### **后续任务 (Phase 3B - 扩缩容和统计)**

#### **4. Pool智能扩缩容API**
```javascript
POST /api/scale-pool-deployment
功能: 
- Scale Up: 新Pod默认 business=unassigned
- Scale Down: 验证有足够的unassigned Pod，否则报错
```

#### **5. DeploymentManager增强**
- 添加Scale按钮（区分普通和Pool Deployment）
- 显示Pool Pod分配统计
- Pool缩容安全提示

#### **6. 模型池状态监控API**
```javascript
GET /api/pool-status/:deploymentName
返回: { totalPods, podDistribution, availableForScaleDown }
```

### **关键实现要点**
- **无硬编码**: 所有业务标签动态获取，不硬编码biz-a/biz-b等测试值
- **安全缩容**: Pool Deployment只能删除unassigned Pod
- **状态同步**: 集成到全局刷新系统，实时更新UI
- **错误处理**: Pod分配失败时的回滚机制和用户提示

### **技术债务**
1. **错误处理**: 完善Pod分配失败时的回滚机制
2. **性能优化**: 大量Pod时的UI响应性能
3. **用户体验**: 添加操作确认和进度提示
4. **状态验证**: 验证Pod分配后流量路由的正确性

## 📊 当前开发状态总结 (2025-09-18)

### **✅ 已完成功能**
1. **模型池部署**: 
   - ConfigPanel中"Deploy as Pool"选项 ✅
   - 模型池模板文件 (`vllm-sglang-model-pool-template.yaml`) ✅
   - 后端API支持 (`deployAsPool`参数) ✅
   - Kubernetes标签规范修复 ✅

2. **Service配置**: 
   - ServiceConfigPanel组件 ✅
   - 业务Service模板 (`business-service-template.yaml`) ✅
   - `/api/deploy-service` API端点 ✅
   - 左侧配置区域内部标签页切换 ✅
   - 模型池识别和选择功能 ✅

3. **Pod动态分配** (2025-09-18 新增): 
   - StatusMonitor中的Pod分配UI ✅
   - `/api/assign-pod` API端点 ✅
   - `/api/business-services` API端点 ✅
   - Pod标签修改功能 ✅
   - Service Pod数量显示修复 ✅

### **🚧 开发中功能 (Phase 3B)**
1. **Pool智能扩缩容**: 区分普通和Pool Deployment的Scale逻辑
2. **统计显示**: DeploymentManager中的Pod分配统计
3. **模型池状态监控**: `/api/pool-status/:deploymentName` API端点

### **❌ 待实现功能 (Phase 4)**
1. **刷新系统集成**: Pod分配操作的状态同步
2. **批量Pod分配**: 按比例分配Pod功能
3. **调度历史**: 模型池调度历史记录
4. **性能监控**: 负载均衡和性能监控

### **🔍 功能完整度**
```
Phase 1: 基础模型池功能    ████████████ 100%
Phase 2: Service配置功能   ████████████ 100%
Phase 3A: Pod动态分配     ████████████ 100% ✅ 新完成
Phase 3B: 扩缩容和统计    ██░░░░░░░░░░  20%
Phase 4: 增强功能          ░░░░░░░░░░░░   0%

总体进度: ██████████░░ 80%
```

### **⚠️ 当前状态**
- **核心功能完成**: Pod分配功能已实现，用户可以在UI中动态分配Pod ✅
- **Service显示修复**: Service能正确显示其关联的Pod数量 ✅
- **标签匹配修复**: 模板标签匹配逻辑已修复 ✅
- **下一步目标**: 实现Pool智能扩缩容和统计显示功能

### **🎯 下一个里程碑**
**实现Pool智能扩缩容功能**，让用户能够安全地扩缩容模型池，并显示Pod分配统计信息。

---

**文档维护者**: HyperPod InstantStart Team  
**最后更新**: 2025-09-17 23:32  
**当前状态**: Phase 2 完成，Phase 3 待开始  
**下次里程碑**: 实现Pod动态分配核心功能
