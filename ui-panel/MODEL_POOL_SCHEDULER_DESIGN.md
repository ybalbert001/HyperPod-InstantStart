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

### **3. Pod分配UI (StatusMonitor增强)** ❌ 待实现

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

## 🔧 技术实现

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

### **Phase 3: 动态调度功能** ❌ 待开始
- [ ] 在StatusMonitor中添加Pod分配UI
- [ ] 实现Pod标签修改API (`/api/assign-pod`)
- [ ] 添加业务Service列表API (`/api/business-services`)
- [ ] 添加模型池状态监控API (`/api/pool-status/:model`)
- [ ] 集成到全局刷新系统

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

## 🚨 开发过程中的注意事项

### **1. 向后兼容性** ✅ 已确保
- 保持现有标准部署功能不变
- 新功能作为可选增强，不影响现有用户
- 模型池选项默认为false

### **2. 代码重复声明问题** ⚠️ 已解决
**问题**: 在App.js中重复声明handleServiceDeploy函数导致编译错误
**解决**: 删除重复声明，确保函数只定义一次
**教训**: 大文件修改时需要仔细检查是否有重复代码

### **4. UI结构调整** ✅ 已解决
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

### **立即任务 (Phase 3 - 核心功能实现)**
1. **Pod分配API**: 实现`/api/assign-pod`端点
   ```javascript
   POST /api/assign-pod
   Body: { podName, businessTag, modelName }
   ```

2. **业务Service列表API**: 实现`/api/business-services`端点
   ```javascript
   GET /api/business-services
   Response: [{ name, businessTag, modelName, selector }]
   ```

3. **StatusMonitor增强**: 在Pods标签页添加分配下拉框
   ```javascript
   // 为模型池Pod添加业务分配选择器
   const isPoolPod = pod.labels?.model && pod.labels?.business !== undefined;
   ```

4. **模型池状态API**: 实现`/api/pool-status/:model`端点
   ```javascript
   GET /api/pool-status/qwen-06b
   Response: { totalPods, assignedPods, unassignedPods, businessDistribution }
   ```

### **关键实现要点**
- **Pod标签修改**: `kubectl label pod {podName} business={businessTag} --overwrite`
- **Service选择器匹配**: 确保Service能正确路由到分配的Pod
- **状态同步**: 集成到全局刷新系统，实时更新UI
- **错误处理**: Pod分配失败时的回滚机制

### **技术债务**
1. **错误处理**: 完善Pod分配失败时的回滚机制
2. **性能优化**: 大量Pod时的UI响应性能
3. **用户体验**: 添加操作确认和进度提示
4. **状态验证**: 验证Pod分配后流量路由的正确性

## 📊 当前开发状态总结 (2025-09-17)

### **✅ 已完成功能**
1. **模型池部署**: 
   - ConfigPanel中"Deploy as Pool"选项 ✅
   - 模型池模板文件 (`vllm-sglang-model-pool-template.yaml`) ✅
   - 后端API支持 (`deployAsPool`参数) ✅

2. **Service配置**: 
   - ServiceConfigPanel组件 ✅
   - 业务Service模板 (`business-service-template.yaml`) ✅
   - `/api/deploy-service` API端点 ✅
   - 左侧配置区域内部标签页切换 ✅

### **❌ 待实现功能 (Phase 3核心)**
1. **Pod动态分配**: StatusMonitor中的分配UI
2. **Pod标签修改**: `/api/assign-pod` API端点
3. **业务Service列表**: `/api/business-services` API端点
4. **模型池状态监控**: `/api/pool-status/:model` API端点
5. **刷新系统集成**: Pod分配操作的状态同步

### **🔍 功能完整度**
```
Phase 1: 基础模型池功能    ████████████ 100%
Phase 2: Service配置功能   ████████████ 100%
Phase 3: 动态调度功能      ░░░░░░░░░░░░   0%
Phase 4: 增强功能          ░░░░░░░░░░░░   0%

总体进度: ██████░░░░░░ 50%
```

### **⚠️ 关键缺失**
**Pod动态分配**是整个Model Pool Scheduler的核心价值，目前完全未实现。没有这个功能，模型池只是普通的Deployment，无法实现动态调度的核心目标。

---

**文档维护者**: HyperPod InstantStart Team  
**最后更新**: 2025-09-17 23:32  
**当前状态**: Phase 2 完成，Phase 3 待开始  
**下次里程碑**: 实现Pod动态分配核心功能
