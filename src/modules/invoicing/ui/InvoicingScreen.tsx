import { Route, Routes } from 'react-router-dom';
import InvoiceDetail from './InvoiceDetail';
import InvoiceEditor from './InvoiceEditor';
import { InvoicesList } from './InvoicesList';

export default function InvoicingScreen() {
  return (
    <Routes>
      <Route index element={<InvoicesList />} />
      <Route path="new" element={<InvoiceEditor />} />
      <Route path=":id" element={<InvoiceDetail />} />
      <Route path=":id/edit" element={<InvoiceEditor />} />
    </Routes>
  );
}
