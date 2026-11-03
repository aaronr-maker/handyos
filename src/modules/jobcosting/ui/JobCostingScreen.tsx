import { Route, Routes } from 'react-router-dom';
import JobCostDetail from './JobCostDetail';
import CompanyRate from './CompanyRate';
import PayoutsReport from './PayoutsReport';
import { JobCostingOverview } from './JobCostingOverview';

export default function JobCostingScreen() {
  return (
    <Routes>
      <Route index element={<JobCostingOverview />} />
      <Route path="rate" element={<CompanyRate />} />
      <Route path="payouts" element={<PayoutsReport />} />
      <Route path=":id" element={<JobCostDetail />} />
    </Routes>
  );
}
