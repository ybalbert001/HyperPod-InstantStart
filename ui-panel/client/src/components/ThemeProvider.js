import React, { useEffect } from 'react';
import { ConfigProvider } from 'antd';
import { getActiveTheme } from '../config/themeConfig';

const ThemeProvider = ({ children }) => {
  const theme = getActiveTheme();

  useEffect(() => {
    // 动态注入CSS变量
    const root = document.documentElement;
    
    // 设置颜色变量
    Object.entries(theme.colors).forEach(([key, value]) => {
      root.style.setProperty(`--theme-${key}`, value);
    });
    
    // 设置字体变量
    root.style.setProperty('--theme-font-family', theme.typography.fontFamily);
    root.style.setProperty('--theme-header-size', theme.typography.headerSize);
    root.style.setProperty('--theme-header-weight', theme.typography.headerWeight);
    
    // 设置布局变量
    root.style.setProperty('--theme-header-gradient', theme.layout.headerGradient);
    root.style.setProperty('--theme-header-border', theme.layout.headerBorder);
    root.style.setProperty('--theme-card-radius', theme.layout.cardRadius);
    root.style.setProperty('--theme-button-radius', theme.layout.buttonRadius);
    
    // 设置品牌变量
    root.style.setProperty('--theme-show-service-icons', theme.branding.showServiceIcons ? '1' : '0');
    root.style.setProperty('--theme-show-gradients', theme.branding.showGradients ? '1' : '0');
    root.style.setProperty('--theme-emphasize-status', theme.branding.emphasizeStatus ? '1' : '0');
    
    // 添加主题类名到body
    document.body.className = document.body.className.replace(/theme-\w+/g, '');
    document.body.classList.add(`theme-${theme.name}`);
    
  }, [theme]);

  // Ant Design 主题配置
  const antdTheme = {
    token: {
      colorPrimary: theme.colors.primary,
      colorSuccess: theme.colors.success,
      colorWarning: theme.colors.warning,
      colorError: theme.colors.error,
      colorInfo: theme.colors.info,
      fontFamily: theme.typography.fontFamily,
      borderRadius: parseInt(theme.layout.cardRadius),
      colorBgContainer: theme.colors.gray50,
      colorBgElevated: '#ffffff',
      colorBorder: theme.colors.gray300,
      colorText: theme.colors.gray900,
      colorTextSecondary: theme.colors.gray600,
      colorTextTertiary: theme.colors.gray500,
    },
    components: {
      Layout: {
        headerBg: 'transparent',
        headerHeight: 64,
        headerPadding: '0 24px',
      },
      Card: {
        borderRadius: parseInt(theme.layout.cardRadius),
        headerBg: theme.colors.gray50,
      },
      Button: {
        borderRadius: parseInt(theme.layout.buttonRadius),
        primaryShadow: `0 2px 4px ${theme.colors.primary}20`,
      },
      Table: {
        headerBg: theme.colors.gray100,
        headerColor: theme.colors.gray800,
        borderColor: theme.colors.gray200,
      },
      Tabs: {
        inkBarColor: theme.colors.primary,
        itemActiveColor: theme.colors.primary,
        itemHoverColor: theme.colors.primaryLight,
      }
    }
  };

  return (
    <ConfigProvider theme={antdTheme}>
      {children}
    </ConfigProvider>
  );
};

export default ThemeProvider;
