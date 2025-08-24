import React from 'react';
import { Empty, Typography } from 'antd';
import { RocketOutlined } from '@ant-design/icons';

const { Text } = Typography;

const VerlRecipePanel = () => {
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center',
      height: '300px',
      textAlign: 'center'
    }}>
      <Empty
        image={<RocketOutlined style={{ fontSize: 48, color: '#1890ff' }} />}
        description={
          <div>
            <Text strong style={{ fontSize: 16 }}>VERL Recipe</Text>
            <br />
            <Text type="secondary">Coming Soon...</Text>
          </div>
        }
      />
    </div>
  );
};

export default VerlRecipePanel;
