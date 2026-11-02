import { Route, Routes } from 'react-router-dom';
import JobCostDetail from './JobCostDetail';
import { JobCostingOverview } from './JobCostingOverview';

export default function JobCostingScreen() {
  return (
    <Routes>
      <Route index element={<JobCostingOverview />} />
      <Route path=":id" element={<JobCostDetail />} />
    </Routes>
  );
}
