import { Route, Routes } from 'react-router-dom';
import JobDetail from './JobDetail';
import JobEditor from './JobEditor';
import { JobsList } from './JobsList';

export default function JobsScreen() {
  return (
    <Routes>
      <Route index element={<JobsList />} />
      <Route path="new" element={<JobEditor />} />
      <Route path=":id" element={<JobDetail />} />
    </Routes>
  );
}
