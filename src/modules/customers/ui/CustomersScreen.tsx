import { Route, Routes } from 'react-router-dom';
import { CustomerDetail } from './CustomerDetail';
import { CustomerList } from './CustomerList';

export default function CustomersScreen() {
  return (
    <Routes>
      <Route index element={<CustomerList />} />
      <Route path=":id" element={<CustomerDetail />} />
    </Routes>
  );
}
