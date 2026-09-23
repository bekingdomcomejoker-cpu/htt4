export type BatteryInfo = {
  health?: string;
  status?: string;
  plugged?: string;
  temperature?: number;
  voltage?: number;
  percentage?: number;
  level?: number;
};

export type ConnectorInfo = {
  name: string;
  description: string;
  available: boolean;
  status: string;
  detail: string;
};
