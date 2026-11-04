import { Route, Routes } from 'react-router-dom';
import JobTime from './JobTime';
import MyTime from './MyTime';

export default function TimeScreen() {
  return (
    <Routes>
      <Route index element={<MyTime />} />
      <Route path="job/:id" element={<JobTime />} />
    </Routes>
  );
}
