# 主题配置指南

## 🎨 概述

本系统支持多种可配置的UI主题风格，通过修改代码配置来切换，无需在用户界面中暴露选项。

## 🚀 快速切换主题

### 1. 修改主题配置

编辑文件：`client/src/config/themeConfig.js`

```javascript
// 在第3行修改 ACTIVE_THEME 的值
export const ACTIVE_THEME = 'aws'; // 改为你想要的主题
```

### 2. 可用主题选项

| 主题名称 | 描述 | 适用场景 |
|---------|------|----------|
| `'aws'` | AWS官方风格 - 橙色主题，专业云服务外观 | **推荐** - 体现AWS品牌，专业感强 |
| `'neutral'` | 中性风格 - 蓝紫渐变，通用企业级外观 | 通用企业应用，避免品牌风险 |
| `'modern'` | 现代风格 - 紫色主题，时尚科技感外观 | 面向开发者，现代化界面 |
| `'classic'` | 经典风格 - 传统蓝色，保守商务外观 | 传统企业，稳重风格 |

### 3. 重启应用

```bash
# 停止当前应用
npm run stop

# 重新启动
npm start
```

## 🎯 主题特色对比

### AWS主题 (`'aws'`)
- **颜色方案**: 橙色 (#FF9900) + 深蓝 (#232F3E)
- **字体**: Amazon Ember 字体系列
- **特色元素**: 
  - 统一的云图标 ☁️ 在标题中间
  - 服务类型图标和颜色编码
  - AWS服务特定的颜色方案
  - 渐变按钮效果
- **品牌体现**: 明显的AWS风格，专业云服务感
- **标题格式**: "☁️ HyperPod InstantStart Unified Platform"

### 中性主题 (`'neutral'`)
- **颜色方案**: 蓝色 (#1890ff) + 紫色 (#722ed1)
- **字体**: 系统默认字体
- **特色元素**: 
  - 蓝紫渐变效果
  - 通用图标设计
  - 平衡的色彩搭配
- **品牌体现**: 无特定品牌倾向，通用企业风格

### 现代主题 (`'modern'`)
- **颜色方案**: 紫色 (#6366f1) + 深灰 (#1f2937)
- **字体**: Inter 现代字体
- **特色元素**: 
  - 大圆角设计
  - 毛玻璃效果
  - 现代渐变色彩
- **品牌体现**: 科技感强，面向开发者

### 经典主题 (`'classic'`)
- **颜色方案**: 传统蓝色 (#2f54eb)
- **字体**: Times New Roman 衬线字体
- **特色元素**: 
  - 小圆角，传统边框
  - 无渐变效果
  - 保守的色彩搭配
- **品牌体现**: 传统商务风格

## 🛠️ 高级自定义

### 1. 创建自定义主题

在 `themeConfig.js` 中添加新主题：

```javascript
const customTheme = {
  name: 'custom',
  colors: {
    primary: '#your-color',
    // ... 其他颜色配置
  },
  typography: {
    fontFamily: "'Your Font', sans-serif",
    // ... 其他字体配置
  },
  // ... 其他配置
};

// 添加到主题映射
const themes = {
  aws: awsTheme,
  neutral: neutralTheme,
  modern: modernTheme,
  classic: classicTheme,
  custom: customTheme  // 新增
};
```

### 2. 修改特定组件样式

编辑 `client/src/styles/dynamic-theme.css` 添加自定义样式：

```css
/* 自定义主题特定样式 */
.theme-custom .theme-card {
  /* 你的自定义样式 */
}
```

### 3. 服务类型颜色映射

在主题配置中修改服务特定颜色：

```javascript
colors: {
  // 服务特定颜色
  compute: '#FF9900',    // 计算服务 (EC2, EKS)
  storage: '#3F48CC',    // 存储服务 (S3)
  database: '#C925D1',   // 数据库服务
  ml: '#01A88D',         // 机器学习服务 (SageMaker)
  analytics: '#8C4FFF',  // 分析服务
}
```

## 📋 组件样式类名

### 卡片类型映射
- `compute` - 计算相关 (模型配置、训练配置)
- `ml` - 机器学习 (模型测试)
- `analytics` - 分析监控 (集群状态、训练监控)
- `storage` - 存储相关 (模型下载、S3存储)
- `database` - 数据管理 (应用状态)

### CSS类名规范
- `.theme-card` - 主题卡片
- `.theme-header` - 主题头部
- `.theme-btn-primary` - 主要按钮
- `.theme-btn-secondary` - 次要按钮
- `.theme-status-*` - 状态指示器

## 🔧 故障排除

### 1. 主题不生效
- 检查 `ACTIVE_THEME` 配置是否正确
- 确认重启了应用
- 检查浏览器缓存

### 2. 样式冲突
- 检查是否有旧的CSS类名残留
- 清除浏览器缓存
- 检查CSS变量是否正确设置

### 3. 字体不显示
- 确认字体文件可访问
- 检查网络连接
- 使用系统字体作为备选

## 💡 最佳实践

### 1. 生产环境建议
- 使用 `'aws'` 主题体现专业性
- 避免频繁切换主题
- 测试所有功能在新主题下的表现

### 2. 开发环境
- 可以使用 `'modern'` 主题提升开发体验
- 定期测试不同主题的兼容性

### 3. 合规考虑
- `'aws'` 主题：适度体现AWS特色，避免过度品牌化
- `'neutral'` 主题：最安全的选择，无品牌风险
- 根据部署环境选择合适主题

## 📝 更新日志

- **v1.0** - 初始版本，支持4种主题
- 支持动态CSS变量
- 支持Ant Design主题集成
- 支持响应式设计

---

**配置位置**: `client/src/config/themeConfig.js`  
**样式文件**: `client/src/styles/dynamic-theme.css`  
**主题提供者**: `client/src/components/ThemeProvider.js`
