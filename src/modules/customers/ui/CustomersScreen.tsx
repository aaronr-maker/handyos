import { Route, Routes } from 'react-router-dom';
import { CustomerDetail } from './CustomerDetail';
import { CustomerList } from './CustomerList';
import CleanupScreen from './CleanupScreen';
import DuplicatesScreen from './DuplicatesScreen';
import ImportScreen from './ImportScreen';

export default function CustomersScreen() {
  return (
    <Routes>
      <Route index element={<CustomerList />} />
      <Route path="cleanup" element={<CleanupScreen />} />
      <Route path="duplicates" element={<DuplicatesScreen />} />
      <Route path="import" element={<ImportScreen />} />
      <Route path=":id" element={<CustomerDetail />} />
    </Routes>
  );
}
