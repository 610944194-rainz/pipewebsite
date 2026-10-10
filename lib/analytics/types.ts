export type AnalyticsStats = {
  totalViews: number;
  totalVisitors: number;
  last7Views: number;
  last7Visitors: number;
  last30Views: number;
  last30Visitors: number;
  daily: { date: string; views: number; visitors: number }[];
  topPages: { path: string; views: number }[];
};
