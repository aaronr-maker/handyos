import { Route, Routes } from 'react-router-dom';
import JobTime from './JobTime';
import MyTime from './MyTime';
import StandardTimes from './StandardTimes';

export default function TimeScreen() {
  return (
    <Routes>
      <Route index element={<MyTime />} />
      <Route path="job/:id" element={<JobTime />} />
      <Route path="standards" element={<StandardTimes />} />
    </Routes>
  );
}
