import React from 'react';
import { Card } from 'antd';
import { 
  CloudServerOutlined, 
  DatabaseOutlined, 
  RobotOutlined, 
  ClusterOutlined,
  ApiOutlined,
  BarChartOutlined
} from '@ant-design/icons';

const serviceIcons = {
  compute: CloudServerOutlined,
  storage: DatabaseOutlined,
  ml: RobotOutlined,
  analytics: ClusterOutlined,
  api: ApiOutlined,
  monitoring: BarChartOutlined
};

const AWSCard = ({ 
  title, 
  children, 
  serviceType = 'compute', 
  extra, 
  loading = false,
  className = '',
  ...props 
}) => {
  const IconComponent = serviceIcons[serviceType] || CloudServerOutlined;
  
  return (
    <Card
      title={
        <div className="aws-card-title">
          <div className={`aws-service-icon ${serviceType}`}>
            <IconComponent />
          </div>
          <span>{title}</span>
        </div>
      }
      extra={extra}
      loading={loading}
      className={`aws-card ${serviceType} ${className}`}
      {...props}
    >
      {children}
    </Card>
  );
};

export default AWSCard;
